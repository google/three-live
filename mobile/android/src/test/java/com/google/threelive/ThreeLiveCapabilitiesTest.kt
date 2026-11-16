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

import com.google.threelive.ai.AICore
import com.google.threelive.ai.AIProvider
import com.google.threelive.ai.AIVoiceSession
import com.google.threelive.ai.ThreeLiveAIEditor
import com.google.threelive.gemini.FrameSource
import com.google.threelive.gemini.GeminiLiveOptions
import com.google.threelive.gemini.GeminiLiveTransport
import com.google.threelive.gemini.RendererFrameSource
import com.google.threelive.gemini.WebSocketLiveTransport
import com.google.threelive.gemini.XRGeminiLiveController
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** End-to-end JVM security tests covering all 9 [ThreeLiveCapabilities] on Android. */
class ThreeLiveCapabilitiesTest {

  @Before
  fun setUp() {
    ThreeLiveCapabilities.default = ThreeLiveCapabilities.DEFAULT
    ThreeLiveCapabilities.onDenied = null
  }

  @After
  fun tearDown() {
    ThreeLiveCapabilities.default = ThreeLiveCapabilities.DEFAULT
    ThreeLiveCapabilities.onDenied = null
    HandJointSources.register(null)
    ThreeLiveObjectDetectors.register(null)
  }

  @Test
  fun defaultPresetAllowsScriptsOnlyAndParseMatchesWebSyntax() {
    val def = ThreeLiveCapabilities.DEFAULT
    assertTrue(def.has(ThreeLiveCapability.SCRIPTS))
    assertFalse(def.has(ThreeLiveCapability.NETWORK, "https://cdn.example.com/a.glb"))
    assertFalse(def.has(ThreeLiveCapability.REMOTE_CONTENT, "https://cdn.example.com/a.glb"))
    assertFalse(def.has(ThreeLiveCapability.CAMERA))
    assertFalse(def.has(ThreeLiveCapability.MICROPHONE))
    assertFalse(def.has(ThreeLiveCapability.SENSORS))
    assertFalse(def.has(ThreeLiveCapability.STORAGE))
    assertFalse(def.has(ThreeLiveCapability.AI, "https://api.example.com/v1"))
    assertFalse(def.has(ThreeLiveCapability.EXTERNAL_HANDOFF))

    val none = ThreeLiveCapabilities.NONE
    assertFalse(none.has(ThreeLiveCapability.SCRIPTS))

    val viewer = ThreeLiveCapabilities.parse("viewer")
    assertFalse(viewer.scripts)
    assertTrue(viewer.network)
    assertTrue(viewer.remoteContent)
    assertTrue(viewer.camera)
    assertTrue(viewer.externalHandoff)
    assertFalse(viewer.microphone)
    assertFalse(viewer.sensors)
    assertFalse(viewer.storage)
    assertFalse(viewer.ai)

    val scoped =
      ThreeLiveCapabilities.parse(
        "all -ai -microphone network:https@https://cdn.example.com:443/models"
      )
    assertTrue(scoped.scripts)
    assertFalse(scoped.ai)
    assertFalse(scoped.microphone)
    assertTrue(scoped.has(ThreeLiveCapability.NETWORK, "https://cdn.example.com/scene.glb"))
    assertFalse(scoped.has(ThreeLiveCapability.NETWORK, "wss://cdn.example.com/live"))
    assertFalse(scoped.has(ThreeLiveCapability.NETWORK, "https://other.example.com/scene.glb"))
    assertFalse(scoped.has(ThreeLiveCapability.NETWORK, "http://localhost:8080/scene.glb"))
  }

  @Test
  fun diagnosticUrlsStripCredentialsQueryStringsAndFragmentsIncludingMalformedQueries() {
    assertEquals(
      "https://api.example.com:8443/v1/live",
      ThreeLiveCapabilities.sanitizeDiagnosticUrl(
        "https://alice:super-secret@API.EXAMPLE.COM:8443/v1/live?key=AIzaSy123#token=xyz"
      ),
    )
    assertEquals(
      "https://api.example.com/v1/live",
      ThreeLiveCapabilities.sanitizeDiagnosticUrl(
        "https://alice:super-secret@api.example.com/v1/live?bad query with spaces#frag"
      ),
    )
    assertEquals(
      "data:<local>",
      ThreeLiveCapabilities.sanitizeDiagnosticUrl("data:model/gltf-binary;base64,AAAA"),
    )

    val guard = CapabilityGuard()
    val denied = ArrayList<CapabilityDeniedEvent>()
    for (i in 0 until 10) {
      assertFalse(
        guard.check(
          policy = ThreeLiveCapabilities.DEFAULT,
          capability = ThreeLiveCapability.SENSORS,
          feature = "handTracking",
          dedup = true,
          listener = { denied.add(it) },
        )
      )
    }
    assertEquals("60 Hz frame-loop denials deduplicate per instance", 1, denied.size)
    guard.reset()
    assertFalse(
      guard.check(
        policy = ThreeLiveCapabilities.DEFAULT,
        capability = ThreeLiveCapability.SENSORS,
        feature = "handTracking",
        dedup = true,
        listener = { denied.add(it) },
      )
    )
    assertEquals(2, denied.size)
  }

  @Test
  fun scriptsCapabilityGatesThreeCompiler() = runBlocking {
    val denied = CopyOnWriteArrayList<CapabilityDeniedEvent>()
    try {
      ThreeCompiler.compile(
        "scene.add(new THREE.Mesh());",
        capabilities = ThreeLiveCapabilities.NONE,
        onCapabilityDenied = { denied.add(it) },
      )
      fail("Expected ThreeCompilerException when scripts capability is disabled")
    } catch (e: ThreeCompilerException) {
      assertTrue(e.message!!.contains("scripts"))
    }
    assertEquals(1, denied.size)
    assertEquals(ThreeLiveCapability.SCRIPTS, denied[0].capability)
  }

  @Test
  fun sceneTraitsCannotEscalatePrivilegesWithoutHostCapabilities() {
    val globalDenied = CopyOnWriteArrayList<CapabilityDeniedEvent>()
    ThreeLiveCapabilities.onDenied = CapabilityDeniedListener { globalDenied.add(it) }

    val glbJson =
      """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],
        "nodes":[{"name":"Escalator","translation":[0,0,-2],"extras":{"xr":{
          "grab":true,
          "splatUrl":"https://cdn.example.com/room.spz",
          "anchor":{"target":"floor","id":"desk","persist":true},
          "sync":true,
          "audioEmitter":{"src":"https://cdn.example.com/secret.mp3","autoplay":true,"playOnSelect":true}
        }}}]}"""

    val renderer = RecordingRenderer()
    val binding = ThreeLiveRuntimeBinding(renderer, glbOf(glbJson))
    // Default policy: scripts=true, all sensitive capabilities=false.
    val store = HashMap<String, String>()
    var splatFetched = false
    var sentMessages = 0
    val features =
      XRSpatialFeatures(
          binding,
          renderer,
          allowRemoteSplats = true,
          splatLoader = { _, _, _ ->
            splatFetched = true
            SplatData(1)
          },
          backgroundExecutor = Executor { it.run() },
        )
        .apply {
          persistentAnchorsNamespace = "test"
          anchorStoreGet = { store[it] }
          anchorStoreSet = { k, v -> if (v == null) store.remove(k) else store[k] = v }
          roomSend = { sentMessages++ }
        }

    // 1. Remote content (`splatUrl` + `audioEmitter.src`) refused; scene still loads & steps
    // cleanly.
    assertFalse(splatFetched)
    assertEquals(0, features.splatCount)

    val audioPlays = ArrayList<String>()
    val audio =
      SpatialAudio.EmitterController(binding.session) { _, name, preset, src, _, _, _ ->
        audioPlays.add("$name:$preset:$src")
      }
    assertNull(audio.trigger(0))
    assertTrue(audioPlays.isEmpty())

    // Even if both preset and src are present, src is stripped when preset plays.
    val dualSession =
      XRLiveRuntimeSession(
        """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],
        "nodes":[{"name":"HumBox","extras":{"xr":{"audioEmitter":{"preset":"hum","src":"https://evil.example.com/spy.mp3","autoplay":false,"playOnSelect":true}}}}]}"""
      )
    var leakedSrc: String? = "unset"
    val dualAudio =
      SpatialAudio.EmitterController(dualSession) { _, _, _, src, _, _, _ -> leakedSrc = src }
    assertNotNull(dualAudio.trigger(0))
    assertNull(leakedSrc)

    // 2. Storage (`persistentAnchors`) refused while in-memory export remains pure.
    assertEquals(0, features.savePersistedAnchors())
    assertTrue(store.isEmpty())
    assertTrue(features.exportAnchorState().isNotEmpty())
    assertEquals(0, features.restorePersistedAnchors())

    // 3. Network (`sharedRoom`) refused.
    assertFalse(
      features.broadcastPoseTick(
        doubleArrayOf(0.0, 1.6, 0.0),
        doubleArrayOf(0.0, 0.0, 0.0, 1.0),
        atMs = 1000L,
      )
    )
    assertEquals(0, sentMessages)

    // 4. Sensors (`handsEnabled`) refused.
    HandJointSources.register(HandJointSource { mapOf("wrist" to doubleArrayOf(0.0, 0.0, 0.0)) })
    var gestureFired = false
    binding.callbacks =
      object : ThreeLiveRuntimeBinding.Callbacks {
        override fun onGesture(event: XRHandGestureEvent) {
          gestureFired = true
        }
      }
    binding.handsEnabled = true
    renderer.listener!!.onFrame(
      1.0 / 60.0,
      FloatArray(16).apply {
        this[0] = 1f
        this[5] = 1f
        this[10] = 1f
        this[15] = 1f
      },
    )
    assertFalse(gestureFired)

    val deniedCaps = globalDenied.map { it.capability }.toSet()
    assertTrue(ThreeLiveCapability.REMOTE_CONTENT in deniedCaps)
    assertTrue(ThreeLiveCapability.STORAGE in deniedCaps)
    assertTrue(ThreeLiveCapability.NETWORK in deniedCaps)
    assertTrue(ThreeLiveCapability.SENSORS in deniedCaps)
    features.dispose()
    binding.dispose()
  }

  @Test
  fun cameraMicrophoneAiAndExternalHandoffAreGatedAndAllowWhenGranted() = runBlocking {
    val denied = CopyOnWriteArrayList<CapabilityDeniedEvent>()
    val listener = CapabilityDeniedListener { denied.add(it) }

    // Camera: RendererFrameSource & ObjectDetectionLoop.
    val renderer = RecordingRenderer().apply { hasCamera = true }
    val frameSource =
      RendererFrameSource(
        renderer,
        capabilities = ThreeLiveCapabilities.DEFAULT,
        onCapabilityDenied = listener,
      )
    var captured: ByteArray? = byteArrayOf(9)
    frameSource.captureJpeg { captured = it }
    assertNull(captured)
    assertTrue(denied.any { it.capability == ThreeLiveCapability.CAMERA })

    frameSource.capabilities = ThreeLiveCapabilities(camera = true)
    frameSource.captureJpeg { captured = it }
    assertNotNull(captured)

    val detector = ThreeLiveObjectDetector { _, cb ->
      cb(listOf(ThreeLiveDetections.Box(doubleArrayOf(0.4, 0.4, 0.6, 0.6), "mug")))
    }
    val loop = ObjectDetectionLoop(renderer, detector) {}
    assertFalse(loop.tick())
    loop.capabilities = ThreeLiveCapabilities(camera = true)
    assertTrue(loop.tick())

    // AI + Microphone + Camera on XRGeminiLiveController & WebSocketLiveTransport.
    try {
      WebSocketLiveTransport(
        url = "wss://generativelanguage.googleapis.com/ws?key=SECRET",
        capabilities = ThreeLiveCapabilities(ai = true, network = false),
        onCapabilityDenied = listener,
      )
      fail("Expected SecurityException when network is disabled")
    } catch (_: SecurityException) {}
    val wsDenied = denied.last()
    assertEquals(ThreeLiveCapability.NETWORK, wsDenied.capability)
    assertFalse(wsDenied.url!!.contains("SECRET"))

    val sent = ArrayList<Map<String, Any?>>()
    val transport =
      object : GeminiLiveTransport {
        override var listener: GeminiLiveTransport.Listener? = null

        override fun send(message: Map<String, Any?>) {
          sent.add(message)
        }

        override fun close() {}
      }
    val live =
      XRGeminiLiveController(
          frameSource = FrameSource { cb -> cb(byteArrayOf(0xFF.toByte(), 0xD8.toByte())) }
        )
        .apply {
          capabilities = ThreeLiveCapabilities.DEFAULT
          onCapabilityDenied = listener
        }
    val opts = GeminiLiveOptions(setup = mapOf("model" to "models/test"), streamFrames = false)
    live.connect(transport, opts)
    assertTrue("connect refused without AI+NETWORK", sent.isEmpty())

    live.capabilities = ThreeLiveCapabilities(ai = true, network = true)
    live.connect(transport, opts)
    assertEquals(1, sent.size) // setup sent
    live.sendAudioChunk(byteArrayOf(0, 0), 16000)
    assertEquals("microphone still off", 1, sent.size)
    assertFalse("camera still off", live.sendFrame())

    live.capabilities =
      ThreeLiveCapabilities(ai = true, network = true, microphone = true, camera = true)
    live.sendAudioChunk(byteArrayOf(0, 0), 16000)
    assertEquals(2, sent.size)
    assertTrue(live.sendFrame())
    assertEquals(3, sent.size)

    // AI editor + AIVoiceSession.
    val fakeCore = AICore {
      mapOf(
        "ok" to true,
        "messages" to listOf(mapOf("type" to "session.update")),
        "inputRate" to 24000.0,
        "code" to "scene.add(a);",
      )
    }
    val editor =
      ThreeLiveAIEditor(
          initialSource = "scene.add(a);",
          provider = AIProvider { "{}" },
          applyScene = {},
          core = fakeCore,
        )
        .apply {
          capabilities = ThreeLiveCapabilities.DEFAULT
          onCapabilityDenied = listener
        }
    val editDenied = editor.editScene("paint it blue")
    assertFalse(editDenied.applied)
    assertTrue(editDenied.error!!.contains("ai"))

    val voiceScope = CoroutineScope(SupervisorJob())
    try {
      val voice =
        AIVoiceSession(editor = editor, transport = transport, scope = voiceScope, core = fakeCore)
          .apply {
            capabilities = ThreeLiveCapabilities(ai = true, network = true, microphone = false)
            onCapabilityDenied = listener
          }
      voice.start()
      val sentBeforeAudio = sent.size
      voice.sendAudio(byteArrayOf(1, 0, 2, 0))
      assertEquals("microphone capability blocks sendAudio", sentBeforeAudio, sent.size)
      assertTrue(denied.any { it.capability == ThreeLiveCapability.MICROPHONE })
      voice.capabilities = ThreeLiveCapabilities(ai = true, network = true, microphone = true)
      voice.sendAudio(byteArrayOf(1, 0, 2, 0))
      assertEquals(sentBeforeAudio + 1, sent.size)
      voice.close()
    } finally {
      voiceScope.cancel()
    }

    // External handoff (Scene Viewer).
    assertNull(
      checkSceneViewerCapabilities(
        rawUri = "content://com.example.provider/model.glb",
        capabilities = ThreeLiveCapabilities.DEFAULT,
        onCapabilityDenied = listener,
      )
    )
    assertNotNull(
      checkSceneViewerCapabilities(
        rawUri = "content://com.example.provider/model.glb",
        capabilities = ThreeLiveCapabilities(externalHandoff = true),
        onCapabilityDenied = listener,
      )
    )
    assertNull(
      checkSceneViewerCapabilities(
        rawUri = "https://cdn.example.com/model.glb",
        capabilities = ThreeLiveCapabilities(externalHandoff = true, remoteContent = false),
        onCapabilityDenied = listener,
      )
    )
    assertNotNull(
      checkSceneViewerCapabilities(
        rawUri = "https://cdn.example.com/model.glb",
        capabilities =
          ThreeLiveCapabilities(externalHandoff = true, remoteContent = true, network = true),
        onCapabilityDenied = listener,
      )
    )
  }

  private class RecordingRenderer : ThreeLiveSceneRenderer {
    override var listener: ThreeLiveRendererListener? = null
    var hasCamera = false

    override fun cameraMatrices(world: FloatArray, projection: FloatArray): Boolean {
      if (!hasCamera) return false
      world.fill(0f)
      world[0] = 1f
      world[5] = 1f
      world[10] = 1f
      world[14] = 4f
      world[15] = 1f
      projection.fill(0f)
      projection[0] = 1f
      projection[5] = 1f
      projection[10] = -1f
      projection[11] = -1f
      projection[14] = -0.2f
      return true
    }

    override fun captureFrame(maxEdge: Int, callback: (CapturedFrame?) -> Unit) {
      val w = FloatArray(16)
      val p = FloatArray(16)
      if (!cameraMatrices(w, p)) callback(null)
      else callback(CapturedFrame(byteArrayOf(1, 2, 3), 64, 64, w, p, 42L))
    }

    override fun load(glb: ByteBuffer) {}

    override fun setCameraOptions(options: ThreeLiveCameraOptions) {}

    override fun setNodeTransform(
      nodeIndex: Int,
      translation: FloatArray,
      rotation: FloatArray,
      scale: FloatArray,
    ) {}

    override fun setNodeVisible(nodeIndex: Int, visible: Boolean) {}

    override fun setMaterialFactors(
      materialIndex: Int,
      baseColorFactor: FloatArray,
      emissiveFactor: FloatArray,
      metallicFactor: Float,
      roughnessFactor: Float,
    ) {}

    override fun dispose() {}
  }

  private fun glbOf(json: String): ByteBuffer {
    val jsonBytes = json.toByteArray(Charsets.UTF_8)
    val paddedLen = (jsonBytes.size + 3) and -4
    val totalLen = 12 + 8 + paddedLen
    val glb = ByteBuffer.allocateDirect(totalLen).order(ByteOrder.LITTLE_ENDIAN)
    glb.putInt(0x46546C67)
    glb.putInt(2)
    glb.putInt(totalLen)
    glb.putInt(paddedLen)
    glb.putInt(0x4E4F534A)
    glb.put(jsonBytes)
    while (glb.position() < totalLen) glb.put(0x20.toByte())
    glb.rewind()
    return glb
  }

  @Test
  fun auditRegressionsLongCredentialsIpv6LoopbackAndEditorProviderFallback() = runBlocking {
    val longJwt = "SECRET_JWT_" + "x".repeat(320)
    val sanitized =
      ThreeLiveCapabilities.sanitizeDiagnosticUrl(
        "https://oauth2:$longJwt@api.example.com/v1/chat?token=T"
      )
    assertFalse(sanitized.contains("SECRET_JWT_"))
    assertFalse(sanitized.contains("oauth2"))
    assertEquals("https://api.example.com/v1/chat", sanitized)

    val sanitizedMalformed =
      ThreeLiveCapabilities.sanitizeDiagnosticUrl("https://oauth2:$longJwt@[bad/path?token=T")
    assertFalse(sanitizedMalformed.contains("SECRET_JWT_"))

    assertEquals(
      "http://[::1]:8080/scene.splat",
      SplatParser.resolveSplatUrl("http://[::1]:8080/scene.splat"),
    )

    // Per-instance capabilities on ThreeLiveAIEditor propagate to AIChatProvider when default is
    // off.
    var httpCalled = false
    val chatProvider =
      com.google.threelive.ai.AIChatProvider(
        endpoint = "https://trusted.example.com/v1/chat",
        openConnection = {
          httpCalled = true
          throw java.io.IOException("stop_after_cap_check")
        },
      )
    val editor =
      com.google.threelive.ai.ThreeLiveAIEditor(
        initialSource = "",
        provider = chatProvider,
        applyScene = {},
        core = AICore { mapOf("messages" to listOf(mapOf("role" to "user", "content" to "hi"))) },
      )
    editor.capabilities = ThreeLiveCapabilities(scripts = true, ai = true, network = true)
    val res = editor.editScene("add a cube")
    assertTrue("AIChatProvider should inherit editor.capabilities", httpCalled)
    assertFalse(res.applied)
  }
}
