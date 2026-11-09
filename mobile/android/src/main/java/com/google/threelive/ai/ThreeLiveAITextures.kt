/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.threelive.ai

import com.google.threelive.MiniJson
import com.google.threelive.gemini.LiveBase64
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * A pluggable image generator for AI textures (`userData.xr.material.prompt`, roadmap B5).
 * Mirrors `ThreeLiveImageProvider` on the web.
 */
interface AIImageProvider {
  /**
   * Sends one Images API request ([requestBody], built by the shared core so the prompt suffix and
   * shape match the web and CLI) and returns the response JSON.
   */
  suspend fun generateImage(requestBody: Map<String, Any?>): String

  /** Recorded as pack provenance. */
  val name: String
    get() = "custom"

  val model: String?
    get() = null
}

/**
 * OpenAI-compatible Images endpoint (`POST /v1/images/generations`, `b64_json`): OpenAI Images,
 * Gemini / Imagen through Gemini's OpenAI-compatible endpoint, or your own proxy.
 *
 * API keys never belong in an app: point [endpoint] at your own proxy, or pass short-lived
 * credentials in [headers]. [generateImage] returns the raw response JSON; [ThreeLiveAITextures]
 * parses it with the shared Rust core.
 *
 * @param endpoint full Images URL: `https://`, or `http://` to loopback only.
 */
class AIImagesProvider
@JvmOverloads
constructor(
  private val endpoint: String,
  override val model: String? = null,
  private val headers: Map<String, String> = emptyMap(),
  private val timeoutMs: Int = 180_000,
  private val openConnection: (URL) -> HttpURLConnection = {
    it.openConnection() as HttpURLConnection
  },
) : AIImageProvider {

  override val name: String = "openai-images"

  init {
    require(AIChatProvider.isAllowedEndpoint(endpoint)) {
      "ai-image: endpoint must be an https:// URL (or http:// on localhost)."
    }
  }

  override suspend fun generateImage(requestBody: Map<String, Any?>): String =
    withContext(Dispatchers.IO) {
      val conn = openConnection(URL(endpoint))
      try {
        conn.requestMethod = "POST"
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        for ((k, v) in headers) conn.setRequestProperty(k, v)
        conn.outputStream.use { it.write(MiniJson.stringify(requestBody).toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        if (code !in 200..299) {
          throw AIEditException("ai-image: HTTP $code from endpoint: ${text.take(300)}")
        }
        text
      } finally {
        conn.disconnect()
      }
    }
}

/** One AI texture a scene asks for. */
data class AITextureRequest(
  val key: String,
  val prompt: String,
  val size: Int,
  val seed: Long,
  /** True when the current pack already has it. */
  val hit: Boolean,
  val meshes: List<String>,
)

/** Result of [ThreeLiveAITextures.generateTextures]. */
data class AITextureResult(
  val generated: List<String>,
  val cached: List<String>,
  val failed: Map<String, String>,
  /** The updated texture pack JSON (save it next to the scene for reproducible results). */
  val packJson: String?,
)

/**
 * AI textures for native apps: holds the texture pack every compile uses, and generates the
 * textures a scene is missing (pack → [cacheDir] → [provider]). The compiler never calls a
 * provider; after [generateTextures] (or setting [packJson]) recompile the scene to see the new
 * textures. Key derivation, image preparation, and pack validation run in the shared Rust core, so
 * results match the web and the CLI.
 *
 * Like `ai-textures` on the web, [mode] is [Mode.AUTO] when a [provider] is configured: call
 * [sceneLoaded] after each load and missing textures are generated in the background, then
 * [Listener.onTexturesUpdated] (and the `onUpdated` callback) fire so you can recompile. Pass this
 * object to [ThreeLiveAIEditor.textures] and the editor does both for its edits.
 */
class ThreeLiveAITextures
@JvmOverloads
constructor(
  private val provider: AIImageProvider? = null,
  /** Raw provider images are cached here (`<key>.img`), e.g. `File(context.cacheDir, ...)`. */
  private val cacheDir: File? = null,
  private val core: AICore = NativeAICore,
) {
  /** When missing textures are generated. Mirrors `ai-textures="auto|manual"` on the web. */
  enum class Mode {
    /** [sceneLoaded] generates missing textures in the background (needs a provider). */
    AUTO,
    /** Only packs, the cache, and explicit [generateTextures] calls. */
    MANUAL,
  }

  /** Background generation events (called on a background thread). */
  interface Listener {
    /** [sceneLoaded] started generating [requests]. */
    fun onTexturesStart(script: String, requests: List<AITextureRequest>) {}

    /** Background generation finished; recompile [script] if anything was added. */
    fun onTexturesUpdated(script: String, result: AITextureResult) {}
  }

  /** Defaults to [Mode.AUTO] with a provider, [Mode.MANUAL] without. */
  @Volatile var mode: Mode = if (provider != null) Mode.AUTO else Mode.MANUAL

  @Volatile var listener: Listener? = null

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val generateLock = Mutex()
  private val failedKeys = ConcurrentHashMap.newKeySet<String>()
  @Volatile private var autoJob: Job? = null

  /** The current texture pack JSON (null = none). Set it with [setPack]. */
  @Volatile
  var packJson: String? = null
    private set

  /** Replaces the texture pack every compile uses (null clears it). */
  suspend fun setPack(json: String?) {
    val res = core.call(mapOf("op" to "texture_pack_set", "pack" to json))
    if (res["ok"] != true) {
      throw AIEditException((res["error"] as? String) ?: "texture pack rejected")
    }
    packJson = json
  }

  /** The AI textures [script] asks for, resolved against the current pack. */
  suspend fun requests(script: String): List<AITextureRequest> {
    val res = core.call(mapOf("op" to "texture_requests", "code" to script))
    (res["error"] as? String)?.let { throw AIEditException(it) }
    return MiniJson.asList(res["requests"]).orEmpty().mapNotNull { r ->
      val m = MiniJson.asMap(r) ?: return@mapNotNull null
      val spec = MiniJson.asMap(m["spec"]) ?: return@mapNotNull null
      AITextureRequest(
        key = m["key"] as? String ?: return@mapNotNull null,
        prompt = spec["prompt"] as? String ?: "",
        size = (spec["size"] as? Double)?.toInt() ?: 512,
        seed = (spec["seed"] as? Double)?.toLong() ?: 1L,
        hit = m["hit"] == true,
        meshes = MiniJson.asList(m["meshes"]).orEmpty().filterIsInstance<String>(),
      )
    }
  }

  /**
   * Generates (or loads from [cacheDir]) the textures [script] is missing, adds them to the pack,
   * and installs the updated pack. Recompile the scene afterwards.
   *
   * @param meshes only textures used by these node names (empty = all).
   * @param force regenerate even when the pack already has a texture.
   */
  @JvmOverloads
  suspend fun generateTextures(
    script: String,
    meshes: Collection<String> = emptyList(),
    force: Boolean = false,
  ): AITextureResult =
    generate(script, force) { r -> meshes.isEmpty() || r.meshes.any { it in meshes } }

  /**
   * Call after loading [script]. In [Mode.AUTO] (with a provider) this generates the textures the
   * pack is missing in the background — skipping ones that already failed, so a broken provider is
   * not retried on every edit — then notifies [listener] and [onUpdated]. A newer call cancels the
   * previous one. Returns the background job, or null when there is nothing to do.
   */
  @JvmOverloads
  fun sceneLoaded(
    script: String,
    onUpdated: (suspend (AITextureResult) -> Unit)? = null,
  ): Job? {
    autoJob?.cancel()
    if (mode != Mode.AUTO || provider == null) return null
    val job =
      scope.launch {
        try {
          val missing = requests(script).filter { !it.hit && it.key !in failedKeys }
          if (missing.isEmpty()) return@launch
          listener?.onTexturesStart(script, missing)
          val keys = missing.map { it.key }.toSet()
          val result = generate(script, force = false) { it.key in keys }
          failedKeys += result.failed.keys
          listener?.onTexturesUpdated(script, result)
          onUpdated?.invoke(result)
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
          throw e
        } catch (e: Exception) {
          // Background work must not crash the app; the scene keeps its presets.
        }
      }
    autoJob = job
    return job
  }

  /** Forgets failed keys so [sceneLoaded] retries them (e.g. after fixing the provider). */
  fun clearFailures() = failedKeys.clear()

  /** Cancels background generation; this object stays usable for manual calls. */
  fun close() {
    autoJob?.cancel()
  }

  /** Releases the background scope for good. */
  fun shutdown() = scope.cancel()

  private suspend fun generate(
    script: String,
    force: Boolean,
    include: (AITextureRequest) -> Boolean,
  ): AITextureResult = generateLock.withLock { generateLocked(script, force, include) }

  private suspend fun generateLocked(
    script: String,
    force: Boolean,
    include: (AITextureRequest) -> Boolean,
  ): AITextureResult {
    val wanted = requests(script).filter { r -> (force || !r.hit) && include(r) }
    val generated = mutableListOf<String>()
    val cached = mutableListOf<String>()
    val failed = linkedMapOf<String, String>()
    var pack: String? = packJson
    for (r in wanted) {
      try {
        val spec = mapOf("prompt" to r.prompt, "size" to r.size, "seed" to r.seed)
        val cacheFile = cacheDir?.let { File(it, "${r.key}.img") }
        var fromCache = false
        val image: String =
          if (!force && cacheFile != null && cacheFile.isFile) {
            fromCache = true
            withContext(Dispatchers.IO) { LiveBase64.encode(cacheFile.readBytes()) }
          } else {
            val p = provider ?: throw AIEditException("generateTextures: no image provider configured.")
            val req = core.call(mapOf("op" to "texture_image_request", "spec" to spec, "model" to p.model))
            val body = MiniJson.asMap(req["body"]) ?: throw AIEditException("invalid texture spec")
            val parsed = core.call(mapOf("op" to "texture_image_parse", "body" to p.generateImage(body)))
            (parsed["error"] as? String)?.let { throw AIEditException(it) }
            val b64 = parsed["image"] as? String ?: throw AIEditException("no image")
            if (cacheFile != null) {
              withContext(Dispatchers.IO) {
                cacheFile.parentFile?.mkdirs()
                cacheFile.writeBytes(LiveBase64.decode(b64))
              }
            }
            b64
          }
        val provenance =
          if (fromCache) null
          else
            buildMap<String, String> {
              put("provider", provider?.name ?: "custom")
              provider?.model?.let { put("model", it) }
              put("createdAt", isoNow())
            }
        val added =
          core.call(
            mapOf(
              "op" to "texture_pack_add",
              "pack" to pack,
              "spec" to spec,
              "image" to image,
              "provenance" to provenance,
            )
          )
        (added["error"] as? String)?.let { throw AIEditException(it) }
        pack = MiniJson.stringify(added["pack"])
        if (fromCache) cached += r.key else generated += r.key
      } catch (e: AIEditException) {
        failed[r.key] = e.message ?: "generation failed"
      }
    }
    if (generated.isNotEmpty() || cached.isNotEmpty()) setPack(pack)
    return AITextureResult(generated, cached, failed, packJson)
  }
}

private fun isoNow(): String =
  SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date())
