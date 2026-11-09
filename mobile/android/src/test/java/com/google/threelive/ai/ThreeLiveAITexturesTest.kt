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
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * JVM tests for Android AI textures (B5d). [FakeTextureCore] stands in for the Rust ops; their real
 * behavior (keys, image preparation, pack validation) is covered by `ai_texture.rs`.
 */
class ThreeLiveAITexturesTest {

  /** Two prompts: "moss" on Wall and "terrazzo" on Floor. Pack = set of keys. */
  private class FakeTextureCore : AICore {
    val ops = CopyOnWriteArrayList<String>()
    @Volatile var installed: Set<String> = emptySet()

    override suspend fun call(request: Map<String, Any?>): Map<String, Any?> {
      val op = request["op"] as String
      ops += op
      return when (op) {
        "texture_pack_set" -> {
          val pack = request["pack"] as String?
          if (pack != null && !pack.startsWith("{")) return mapOf("ok" to false, "error" to "bad pack")
          installed = keysOf(pack)
          mapOf("ok" to true)
        }
        "texture_requests" ->
          mapOf(
            "requests" to
              listOf(
                req("k_moss", "moss", "Wall"),
                req("k_terrazzo", "terrazzo", "Floor"),
              )
          )
        "texture_image_request" -> {
          val spec = MiniJson.asMap(request["spec"])!!
          mapOf("body" to mapOf("prompt" to "${spec["prompt"]} SUFFIX", "model" to request["model"]))
        }
        "texture_image_parse" -> {
          val body = request["body"] as String
          if (body.contains("refused")) mapOf("error" to "image endpoint error: refused")
          else mapOf("image" to "aW1n")
        }
        "texture_pack_add" -> {
          val spec = MiniJson.asMap(request["spec"])!!
          val key = "k_${spec["prompt"]}"
          val keys = keysOf(request["pack"] as String?) + key
          mapOf("key" to key, "pack" to mapOf("keys" to keys.toList().sorted(), "prov" to request["provenance"]))
        }
        // Just enough of the editor ops for ThreeLiveAIEditor integration.
        "messages" -> mapOf("messages" to listOf(mapOf("role" to "user", "content" to "edit")))
        "extract" -> mapOf("code" to request["reply"])
        "validate" -> mapOf("ok" to true)
        else -> mapOf("error" to "unknown op $op")
      }
    }

    private fun req(key: String, prompt: String, mesh: String) =
      mapOf(
        "key" to key,
        "spec" to mapOf("prompt" to prompt, "size" to 512.0, "seed" to 1.0),
        "hit" to (key in installed),
        "meshes" to listOf(mesh),
      )

    companion object {
      fun keysOf(pack: String?): Set<String> =
        pack?.let { MiniJson.asList(MiniJson.parseObjectOrNull(it)?.get("keys")) }
          .orEmpty()
          .filterIsInstance<String>()
          .toSet()
    }
  }

  private class FakeProvider(private val refuse: Set<String> = emptySet()) : AIImageProvider {
    val prompts = CopyOnWriteArrayList<String>()
    override val name = "fake-images"
    override val model = "fake-1"

    override suspend fun generateImage(requestBody: Map<String, Any?>): String {
      val prompt = requestBody["prompt"] as String
      prompts += prompt
      return if (refuse.any { prompt.startsWith(it) }) "refused" else "{\"data\":[]}"
    }
  }

  @Test
  fun generatesMissingTexturesInstallsPackAndReusesCache() = runBlocking {
    val core = FakeTextureCore()
    val cache = Files.createTempDirectory("tl-tex").toFile()
    val provider = FakeProvider()
    val tex = ThreeLiveAITextures(provider, cache, core)
    val first = tex.generateTextures("scene")
    assertEquals(listOf("k_moss", "k_terrazzo"), first.generated)
    assertEquals(listOf("moss SUFFIX", "terrazzo SUFFIX"), provider.prompts)
    assertEquals(setOf("k_moss", "k_terrazzo"), core.installed)
    assertTrue(first.packJson!!.contains("fake-images"))
    assertTrue(java.io.File(cache, "k_moss.img").isFile)

    // Everything is in the pack now: nothing to do.
    val again = tex.generateTextures("scene")
    assertTrue(again.generated.isEmpty() && again.cached.isEmpty())

    // A fresh instance (no pack) reuses the cached provider images.
    val provider2 = FakeProvider()
    val core2 = FakeTextureCore()
    val fresh = ThreeLiveAITextures(provider2, cache, core2)
    val res = fresh.generateTextures("scene", meshes = listOf("Floor"))
    assertEquals(listOf("k_terrazzo"), res.cached)
    assertTrue(provider2.prompts.isEmpty())
    assertEquals(setOf("k_terrazzo"), core2.installed)
  }

  @Test
  fun failuresAreReportedPerTextureAndNoProviderIsAnError() = runBlocking {
    val core = FakeTextureCore()
    val tex = ThreeLiveAITextures(FakeProvider(refuse = setOf("terrazzo")), null, core)
    val res = tex.generateTextures("scene")
    assertEquals(listOf("k_moss"), res.generated)
    assertEquals("image endpoint error: refused", res.failed["k_terrazzo"])
    assertEquals(setOf("k_moss"), core.installed)

    val none = ThreeLiveAITextures(null, null, FakeTextureCore()).generateTextures("scene")
    assertTrue(none.failed.values.all { it.contains("no image provider") })
    assertNull(none.packJson)
  }

  @Test
  fun setPackValidatesAndForceRegenerates() = runBlocking {
    val core = FakeTextureCore()
    val provider = FakeProvider()
    val tex = ThreeLiveAITextures(provider, null, core)
    try {
      tex.setPack("not json")
      fail("expected rejection")
    } catch (e: AIEditException) {
      assertTrue(e.message!!.contains("bad pack"))
    }
    tex.setPack("{\"keys\":[\"k_moss\",\"k_terrazzo\"]}")
    assertEquals(listOf(true, true), tex.requests("scene").map { it.hit })
    val forced = tex.generateTextures("scene", meshes = listOf("Wall"), force = true)
    assertEquals(listOf("k_moss"), forced.generated)
    assertEquals(listOf("moss SUFFIX"), provider.prompts)
  }

  @Test
  fun autoModeGeneratesInBackgroundAndSkipsKnownFailures() = runBlocking {
    val core = FakeTextureCore()
    val provider = FakeProvider(refuse = setOf("terrazzo"))
    val tex = ThreeLiveAITextures(provider, null, core)
    assertEquals(ThreeLiveAITextures.Mode.AUTO, tex.mode)
    val starts = CopyOnWriteArrayList<List<String>>()
    tex.listener =
      object : ThreeLiveAITextures.Listener {
        override fun onTexturesStart(script: String, requests: List<AITextureRequest>) {
          starts += requests.map { it.key }
        }
      }
    val updates = CopyOnWriteArrayList<AITextureResult>()
    tex.sceneLoaded("scene") { updates += it }!!.join()
    assertEquals(listOf(listOf("k_moss", "k_terrazzo")), starts.toList())
    assertEquals(listOf("k_moss"), updates.single().generated)
    assertEquals(setOf("k_terrazzo"), updates.single().failed.keys)
    assertEquals(setOf("k_moss"), core.installed)

    // Moss is in the pack and terrazzo already failed: no provider calls, no update.
    val calls = provider.prompts.size
    tex.sceneLoaded("scene") { updates += it }!!.join()
    assertEquals(calls, provider.prompts.size)
    assertEquals(1, updates.size)
    tex.clearFailures()
    tex.sceneLoaded("scene")!!.join()
    assertEquals(calls + 1, provider.prompts.size)

    tex.mode = ThreeLiveAITextures.Mode.MANUAL
    assertNull(tex.sceneLoaded("scene"))
    val noProvider = ThreeLiveAITextures(null, null, FakeTextureCore())
    assertEquals(ThreeLiveAITextures.Mode.MANUAL, noProvider.mode)
    assertNull(noProvider.sceneLoaded("scene"))
  }

  @Test
  fun editorReappliesTheSceneWhenAutoTexturesArrive() = runBlocking {
    val core = FakeTextureCore()
    val applied = CopyOnWriteArrayList<String>()
    val chat =
      object : AIProvider {
        override suspend fun complete(messages: List<AIChatMessage>) = "scene2"
      }
    val editor = ThreeLiveAIEditor("scene", chat, { applied += it }, core)
    editor.textures = ThreeLiveAITextures(FakeProvider(), null, core)
    assertTrue(editor.editScene("add moss").applied)
    withTimeout(2000) { while (applied.size < 2) delay(5) }
    assertEquals(listOf("scene2", "scene2"), applied.toList())
    assertEquals(setOf("k_moss", "k_terrazzo"), core.installed)
  }

  @Test
  fun imagesProviderPostsJsonAndRejectsInsecureEndpoints() = runBlocking {
    val sent = ByteArrayOutputStream()
    val conn =
      object : HttpURLConnection(URL("https://proxy.example/v1/images/generations")) {
        val props = mutableMapOf<String, String>()
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getResponseCode() = 200
        override fun getOutputStream(): OutputStream = sent
        override fun getInputStream(): InputStream =
          ByteArrayInputStream("{\"data\":[{\"b64_json\":\"aW1n\"}]}".toByteArray())
        override fun setRequestProperty(key: String, value: String) {
          props[key] = value
        }
      }
    val p =
      AIImagesProvider(
        "https://proxy.example/v1/images/generations",
        model = "imagen",
        headers = mapOf("Authorization" to "Bearer t"),
        openConnection = { conn },
      )
    val reply = p.generateImage(mapOf("prompt" to "moss SUFFIX", "n" to 1))
    assertTrue(reply.contains("b64_json"))
    assertTrue(sent.toString(Charsets.UTF_8).contains("\"prompt\":\"moss SUFFIX\""))
    assertEquals("Bearer t", conn.props["Authorization"])
    try {
      AIImagesProvider("http://example.com/v1/images/generations")
      fail("expected rejection")
    } catch (e: IllegalArgumentException) {
      assertTrue(e.message!!.contains("https://"))
    }
  }
}
