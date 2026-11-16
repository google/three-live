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

package com.google.threelive

import java.net.URI
import java.util.Collections
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/** Canonical capability identifiers shared across Web, Android, and iOS. */
enum class ThreeLiveCapability(val wireName: String) {
  SCRIPTS("scripts"),
  NETWORK("network"),
  REMOTE_CONTENT("remote_content"),
  CAMERA("camera"),
  MICROPHONE("microphone"),
  SENSORS("sensors"),
  STORAGE("storage"),
  AI("ai"),
  EXTERNAL_HANDOFF("external_handoff");

  companion object {
    @JvmStatic
    fun fromToken(raw: String): ThreeLiveCapability? {
      val norm = raw.trim().lowercase(Locale.ROOT).replace('-', '_')
      return entries.firstOrNull { it.wireName == norm }
    }
  }
}

/** Structured diagnostic payload emitted whenever a capability check is refused. */
data class CapabilityDeniedEvent(
  val capability: ThreeLiveCapability,
  val feature: String,
  val message: String,
  val url: String? = null,
)

/** Listener notified when Three-Live blocks a sensitive operation under capability policy. */
fun interface CapabilityDeniedListener {
  fun onCapabilityDenied(event: CapabilityDeniedEvent)
}

/**
 * Capability-based security policy for Three-Live views, sessions, and helpers.
 *
 * Sensitive capabilities default to `false`; [scripts] defaults to `true` on native views (use
 * [NONE] when script execution should also be disabled).
 */
data class ThreeLiveCapabilities
@JvmOverloads
constructor(
  val scripts: Boolean = true,
  val network: Boolean = false,
  val remoteContent: Boolean = false,
  val camera: Boolean = false,
  val microphone: Boolean = false,
  val sensors: Boolean = false,
  val storage: Boolean = false,
  val ai: Boolean = false,
  val externalHandoff: Boolean = false,
  val networkSchemes: Set<String> = DEFAULT_NETWORK_SCHEMES,
  val explicitNetworkSchemes: Boolean = false,
  val networkOrigins: Set<String>? = null,
) {
  init {
    require(networkSchemes.all { it == it.lowercase(Locale.ROOT) && ':' !in it }) {
      "networkSchemes must contain lowercase scheme names without ':' (e.g. \"https\", \"wss\")"
    }
  }

  /** Returns `true` when [network] permits connecting to [rawUrl] (resolved against [baseUrl]). */
  @JvmOverloads
  fun isNetworkUrlPermitted(rawUrl: String? = null, baseUrl: String? = null): Boolean {
    if (!network) return false
    if (rawUrl == null) return true
    val trimmed = rawUrl.trim()
    if (trimmed.isEmpty()) return false
    if (isNonNetworkUrl(trimmed)) return true

    val uri = resolveUri(trimmed, baseUrl) ?: return false
    val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return false
    if (isNonNetworkUrl("$scheme:")) return true
    val host = uri.host?.lowercase(Locale.ROOT) ?: return false

    val loopback =
      (scheme == "http" || scheme == "ws") &&
        (host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1")
    val schemeAllowed = scheme in networkSchemes || (!explicitNetworkSchemes && loopback)
    if (!schemeAllowed) return false

    val allowedOrigins = networkOrigins
    if (allowedOrigins != null) {
      val normalizedAllowed = allowedOrigins.mapNotNullTo(HashSet()) { normalizeOrigin(it) }
      val origin = normalizeOrigin(uri.toString()) ?: return false
      if (origin !in normalizedAllowed) return false
    }
    return true
  }

  /** Evaluates whether this policy grants [capability] (and optional [url]). */
  @JvmOverloads
  fun has(capability: ThreeLiveCapability, url: String? = null, baseUrl: String? = null): Boolean =
    when (capability) {
      ThreeLiveCapability.SCRIPTS -> scripts
      ThreeLiveCapability.NETWORK -> isNetworkUrlPermitted(url, baseUrl)
      ThreeLiveCapability.REMOTE_CONTENT ->
        (url != null && isNonNetworkUrl(url)) ||
          (remoteContent && isNetworkUrlPermitted(url, baseUrl))
      ThreeLiveCapability.CAMERA -> camera
      ThreeLiveCapability.MICROPHONE -> microphone
      ThreeLiveCapability.SENSORS -> sensors
      ThreeLiveCapability.STORAGE -> storage
      ThreeLiveCapability.AI -> ai && isNetworkUrlPermitted(url, baseUrl)
      ThreeLiveCapability.EXTERNAL_HANDOFF -> externalHandoff
    }

  /**
   * Checks [capability] at a point of access. When refused, logs a diagnostic, invokes [listener]
   * and [ThreeLiveCapabilities.onDenied], and returns `false` without throwing.
   */
  @JvmOverloads
  fun check(
    capability: ThreeLiveCapability,
    feature: String,
    url: String? = null,
    baseUrl: String? = null,
    listener: CapabilityDeniedListener? = null,
    dedupSet: MutableSet<String>? = null,
  ): Boolean {
    if (capability == ThreeLiveCapability.REMOTE_CONTENT) {
      if (url != null && isNonNetworkUrl(url)) return true
      if (!remoteContent) {
        reportDenial(ThreeLiveCapability.REMOTE_CONTENT, feature, url, baseUrl, listener, dedupSet)
        return false
      }
      if (!isNetworkUrlPermitted(url, baseUrl)) {
        reportDenial(ThreeLiveCapability.NETWORK, feature, url, baseUrl, listener, dedupSet)
        return false
      }
      return true
    }
    if (capability == ThreeLiveCapability.AI) {
      if (!ai) {
        reportDenial(ThreeLiveCapability.AI, feature, url, baseUrl, listener, dedupSet)
        return false
      }
      if (!isNetworkUrlPermitted(url, baseUrl)) {
        reportDenial(ThreeLiveCapability.NETWORK, feature, url, baseUrl, listener, dedupSet)
        return false
      }
      return true
    }
    if (!has(capability, url, baseUrl)) {
      reportDenial(capability, feature, url, baseUrl, listener, dedupSet)
      return false
    }
    return true
  }

  companion object {
    /** Default allowed outbound schemes when [network] is enabled without an explicit list. */
    @JvmField val DEFAULT_NETWORK_SCHEMES: Set<String> = setOf("https", "wss")

    private val NON_NETWORK_SCHEMES =
      setOf("data", "blob", "asset", "file", "content", "android.resource")

    /** Default native policy: `scripts = true`, all sensitive capabilities `false`. */
    @JvmField val DEFAULT = ThreeLiveCapabilities()

    /** Strict zero-capability policy (`scripts = false` as well). */
    @JvmField val NONE = ThreeLiveCapabilities(scripts = false)

    /** Preset for static `.glb` / `.usdz` remote viewing and AR handoff. */
    @JvmField
    val VIEWER =
      ThreeLiveCapabilities(
        scripts = false,
        network = true,
        remoteContent = true,
        camera = true,
        externalHandoff = true,
      )

    /** Preset enabling all capabilities, intended for trusted demos and playgrounds. */
    @JvmField
    val ALL =
      ThreeLiveCapabilities(
        scripts = true,
        network = true,
        remoteContent = true,
        camera = true,
        microphone = true,
        sensors = true,
        storage = true,
        ai = true,
        externalHandoff = true,
      )

    /** Process-wide default capability policy consulted when no per-view policy is supplied. */
    @JvmStatic @Volatile var default: ThreeLiveCapabilities = DEFAULT

    /** Optional process-wide listener notified whenever any capability check is denied. */
    @JvmStatic @Volatile var onDenied: CapabilityDeniedListener? = null

    /** Returns `true` when [url] uses an in-memory or local non-network scheme. */
    @JvmStatic
    fun isNonNetworkUrl(url: String): Boolean {
      val trimmed = url.trim()
      val colon = trimmed.indexOf(':')
      if (colon <= 0) return false
      val scheme = trimmed.substring(0, colon).lowercase(Locale.ROOT)
      return scheme in NON_NETWORK_SCHEMES
    }

    /**
     * Normalizes an origin string to `scheme://host[:port]` (stripping default ports and paths).
     */
    @JvmStatic
    fun normalizeOrigin(raw: String): String? {
      return try {
        val uri = URI(raw.trim())
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        val port = uri.port
        val defaultPort =
          ((scheme == "https" || scheme == "wss") && port == 443) ||
            ((scheme == "http" || scheme == "ws") && port == 80)
        val portSuffix = if (port > 0 && !defaultPort) ":$port" else ""
        "$scheme://$host$portSuffix"
      } catch (_: Exception) {
        null
      }
    }

    /**
     * Sanitizes a URL for diagnostics/events by stripping credentials, query strings, and hashes.
     */
    @JvmStatic
    fun sanitizeDiagnosticUrl(raw: String, baseUrl: String? = null): String {
      val full = raw.trim().take(8192)
      if (isNonNetworkUrl(full)) {
        val colon = full.indexOf(':')
        return "${full.substring(0, colon + 1)}<local>"
      }
      val basePart = full.substringBefore('?').substringBefore('#')
      val uri = resolveUri(full, baseUrl) ?: resolveUri(basePart, baseUrl)
      val scheme = uri?.scheme
      val host = uri?.host
      if (uri != null && scheme != null && host != null) {
        val portSuffix = if (uri.port > 0) ":${uri.port}" else ""
        val path = uri.rawPath ?: ""
        return "${scheme.lowercase(Locale.ROOT)}://${host.lowercase(Locale.ROOT)}$portSuffix$path"
          .take(256)
      }
      return basePart
        .replace(Regex("//[^/@\\s]*@"), "//")
        .replace(Regex("^([a-zA-Z][a-zA-Z0-9+.-]*://)[^/\\s:@]+:[^/\\s@]*"), "$1")
        .take(128)
    }

    /**
     * Parses a capability policy string matching the Web `capabilities="..."` attribute syntax
     * (e.g. `"scripts network:https,wss@https://cdn.example.com remote_content -ai"`).
     */
    @JvmStatic
    @JvmOverloads
    fun parse(spec: String, base: ThreeLiveCapabilities = NONE): ThreeLiveCapabilities {
      val trimmed = spec.trim()
      if (trimmed.isEmpty()) return NONE
      var scripts = base.scripts
      var network = base.network
      var schemes = base.networkSchemes.toMutableSet()
      var explicitSchemes = base.explicitNetworkSchemes
      var origins: MutableSet<String>? = base.networkOrigins?.toMutableSet()
      var originsSpecified = false
      var remoteContent = base.remoteContent
      var camera = base.camera
      var microphone = base.microphone
      var sensors = base.sensors
      var storage = base.storage
      var ai = base.ai
      var externalHandoff = base.externalHandoff

      for (raw in trimmed.split(Regex("\\s+"))) {
        if (raw.isEmpty()) continue
        val neg = raw.length > 1 && raw.startsWith('-')
        val tok = if (neg) raw.substring(1) else raw
        val value = !neg
        val atIdx = tok.indexOf('@')
        val head = (if (atIdx >= 0) tok.substring(0, atIdx) else tok).lowercase(Locale.ROOT)
        val originPart = if (atIdx >= 0) tok.substring(atIdx + 1) else ""
        val colonIdx = head.indexOf(':')
        val name = (if (colonIdx >= 0) head.substring(0, colonIdx) else head).replace('-', '_')
        val schemePart = if (colonIdx >= 0) head.substring(colonIdx + 1) else ""

        when (name) {
          "none" ->
            if (value) {
              scripts = false
              network = false
              remoteContent = false
              camera = false
              microphone = false
              sensors = false
              storage = false
              ai = false
              externalHandoff = false
              schemes = DEFAULT_NETWORK_SCHEMES.toMutableSet()
              explicitSchemes = false
              origins = null
              originsSpecified = false
            }
          "all",
          "*" -> {
            scripts = value
            network = value
            remoteContent = value
            camera = value
            microphone = value
            sensors = value
            storage = value
            ai = value
            externalHandoff = value
            schemes = DEFAULT_NETWORK_SCHEMES.toMutableSet()
            explicitSchemes = false
            origins = null
            originsSpecified = false
          }
          "viewer" -> {
            network = value
            remoteContent = value
            camera = value
            externalHandoff = value
          }
          "scripts" -> scripts = value
          "network" -> {
            network = value
            if (value && schemePart.isNotEmpty()) {
              val parsed =
                schemePart
                  .split(',', '|')
                  .map { it.trim().removeSuffix(":").lowercase(Locale.ROOT) }
                  .filter { it.isNotEmpty() }
              if (parsed.isNotEmpty()) {
                schemes = parsed.toMutableSet()
                explicitSchemes = true
              }
            } else if (value && originPart.isEmpty()) {
              schemes = DEFAULT_NETWORK_SCHEMES.toMutableSet()
              explicitSchemes = false
              origins = null
              originsSpecified = false
            }
            if (value && originPart.isNotEmpty()) {
              if (!originsSpecified) {
                origins = LinkedHashSet()
                originsSpecified = true
              }
              val set = origins ?: LinkedHashSet<String>().also { origins = it }
              for (o in originPart.split(',', '|')) {
                normalizeOrigin(o)?.let(set::add)
              }
            }
          }
          "remote_content" -> remoteContent = value
          "camera" -> camera = value
          "microphone" -> microphone = value
          "sensors" -> sensors = value
          "storage" -> storage = value
          "ai" -> ai = value
          "external_handoff" -> externalHandoff = value
        }
      }

      return ThreeLiveCapabilities(
        scripts = scripts,
        network = network,
        remoteContent = remoteContent,
        camera = camera,
        microphone = microphone,
        sensors = sensors,
        storage = storage,
        ai = ai,
        externalHandoff = externalHandoff,
        networkSchemes = schemes.toSet(),
        explicitNetworkSchemes = explicitSchemes,
        networkOrigins = origins?.toSet(),
      )
    }

    private fun resolveUri(rawUrl: String, baseUrl: String?): URI? {
      if (rawUrl.startsWith("//")) return null
      return try {
        val candidate = URI(rawUrl)
        if (candidate.isAbsolute) {
          candidate
        } else if (!baseUrl.isNullOrBlank()) {
          URI(baseUrl.trim()).resolve(candidate)
        } else {
          null
        }
      } catch (_: Exception) {
        null
      }
    }

    private fun reportDenial(
      capability: ThreeLiveCapability,
      feature: String,
      url: String?,
      baseUrl: String?,
      listener: CapabilityDeniedListener?,
      dedupSet: MutableSet<String>?,
    ) {
      val safeUrl = url?.let { sanitizeDiagnosticUrl(it, baseUrl) }
      if (dedupSet != null) {
        val key = "${capability.wireName}:$feature:${safeUrl.orEmpty()}"
        if (!dedupSet.add(key)) return
      }
      val urlSuffix = if (safeUrl != null) " ($safeUrl)" else ""
      val message =
        "[Three-Live] Capability '${capability.wireName}' denied for $feature$urlSuffix. " +
          "Grant '${capability.wireName}' in ThreeLiveCapabilities to enable."
      val event = CapabilityDeniedEvent(capability, feature, message, safeUrl)
      logWarning(message)
      onDenied?.onCapabilityDenied(event)
      listener?.onCapabilityDenied(event)
    }

    private fun logWarning(message: String) {
      try {
        android.util.Log.w("ThreeLiveCapabilities", message)
      } catch (_: Throwable) {
        // Host JVM unit tests use stubbed android.util.Log.
      }
    }
  }
}

/** Per-instance capability evaluator that deduplicates repeated frame-loop denial diagnostics. */
internal class CapabilityGuard {
  private val seen: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())

  fun reset() {
    seen.clear()
  }

  fun check(
    policy: ThreeLiveCapabilities,
    capability: ThreeLiveCapability,
    feature: String,
    url: String? = null,
    baseUrl: String? = null,
    dedup: Boolean = false,
    listener: CapabilityDeniedListener? = null,
  ): Boolean =
    policy.check(
      capability = capability,
      feature = feature,
      url = url,
      baseUrl = baseUrl,
      listener = listener,
      dedupSet = if (dedup) seen else null,
    )
}
