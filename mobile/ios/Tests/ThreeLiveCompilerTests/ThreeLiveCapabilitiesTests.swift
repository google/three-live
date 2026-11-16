// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import XCTest
import simd

@testable import ThreeLiveCompiler

/// End-to-end security tests covering all 9 `ThreeLiveCapabilities` on iOS / macOS.
final class ThreeLiveCapabilitiesTests: XCTestCase {

  private final class DeniedBox: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [CapabilityDeniedEvent] = []
    func append(_ event: CapabilityDeniedEvent) {
      lock.lock()
      items.append(event)
      lock.unlock()
    }
    var all: [CapabilityDeniedEvent] {
      lock.lock()
      defer { lock.unlock() }
      return items
    }
  }

  private final class FakeLiveTransport: GeminiLiveTransport, @unchecked Sendable {
    var onMessage: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?
    var sent: [[String: Any]] = []
    func send(_ message: [String: Any]) { sent.append(message) }
    func close() {}
  }

  private final class FakeAIProvider: AIProvider {
    func complete(_ messages: [AIChatMessage]) async throws -> String {
      "```js\nscene.add(new THREE.Mesh());\n```"
    }
  }

  private final class FakeObjectDetector: XRObjectDetector, @unchecked Sendable {
    func detect(
      frame: XRCapturedFrame, completion: @escaping @Sendable ([XRDetections.Box]) -> Void
    ) {
      completion([XRDetections.Box(box: [0.4, 0.4, 0.6, 0.6], label: "cup")])
    }
  }

  override func setUp() {
    super.setUp()
    ThreeLiveCapabilities.defaultPolicy = .default
    ThreeLiveCapabilities.onDenied = nil
  }

  override func tearDown() {
    ThreeLiveCapabilities.defaultPolicy = .default
    ThreeLiveCapabilities.onDenied = nil
    XRHandJointSources.register(nil)
    XRObjectDetectors.register(nil)
    super.tearDown()
  }

  func testDefaultPresetAndParseMatchWebSyntax() {
    let def = ThreeLiveCapabilities.default
    XCTAssertTrue(def.has(.scripts))
    XCTAssertFalse(def.has(.network, url: "https://cdn.example.com/a.glb"))
    XCTAssertFalse(def.has(.remoteContent, url: "https://cdn.example.com/a.glb"))
    XCTAssertFalse(def.has(.camera))
    XCTAssertFalse(def.has(.microphone))
    XCTAssertFalse(def.has(.sensors))
    XCTAssertFalse(def.has(.storage))
    XCTAssertFalse(def.has(.ai, url: "https://api.example.com/v1"))
    XCTAssertFalse(def.has(.externalHandoff))

    XCTAssertFalse(ThreeLiveCapabilities.none.has(.scripts))

    let viewer = ThreeLiveCapabilities.parse("viewer")
    XCTAssertFalse(viewer.scripts)
    XCTAssertTrue(viewer.network)
    XCTAssertTrue(viewer.remoteContent)
    XCTAssertTrue(viewer.camera)
    XCTAssertTrue(viewer.externalHandoff)
    XCTAssertFalse(viewer.microphone)
    XCTAssertFalse(viewer.sensors)
    XCTAssertFalse(viewer.storage)
    XCTAssertFalse(viewer.ai)

    let scoped = ThreeLiveCapabilities.parse(
      "all -ai -microphone network:https@https://cdn.example.com:443/models")
    XCTAssertTrue(scoped.scripts)
    XCTAssertFalse(scoped.ai)
    XCTAssertFalse(scoped.microphone)
    XCTAssertTrue(scoped.has(.network, url: "https://cdn.example.com/scene.glb"))
    XCTAssertFalse(scoped.has(.network, url: "wss://cdn.example.com/live"))
    XCTAssertFalse(scoped.has(.network, url: "https://other.example.com/scene.glb"))
    XCTAssertFalse(scoped.has(.network, url: "http://localhost:8080/scene.glb"))
  }

  func testDiagnosticURLSanitizationAndFrameDedup() {
    XCTAssertEqual(
      ThreeLiveCapabilities.sanitizeDiagnosticURL(
        "https://alice:super-secret@API.EXAMPLE.COM:8443/v1/live?key=AIzaSy123#token=xyz"),
      "https://api.example.com:8443/v1/live"
    )
    XCTAssertEqual(
      ThreeLiveCapabilities.sanitizeDiagnosticURL(
        "https://alice:super-secret@api.example.com/v1/live?bad query with spaces#frag"),
      "https://api.example.com/v1/live"
    )
    XCTAssertEqual(
      ThreeLiveCapabilities.sanitizeDiagnosticURL("data:model/gltf-binary;base64,AAAA"),
      "data:<local>"
    )

    let guardObj = CapabilityGuard()
    let denied = DeniedBox()
    for _ in 0..<10 {
      XCTAssertFalse(
        guardObj.check(
          policy: .default,
          capability: .sensors,
          feature: "handTracking",
          dedup: true,
          onDenied: { denied.append($0) }
        )
      )
    }
    XCTAssertEqual(denied.all.count, 1)
    guardObj.reset()
    XCTAssertFalse(
      guardObj.check(
        policy: .default,
        capability: .sensors,
        feature: "handTracking",
        dedup: true,
        onDenied: { denied.append($0) }
      )
    )
    XCTAssertEqual(denied.all.count, 2)
  }

  func testScriptsCapabilityGatesThreeCompiler() async {
    let denied = DeniedBox()
    do {
      _ = try await ThreeCompiler.compile(
        "scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));",
        capabilities: .zero,
        onCapabilityDenied: { denied.append($0) }
      )
      XCTFail("Expected compilationFailed error when scripts=false")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let msg) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertTrue(msg.contains("scripts"))
    } catch {
      XCTFail("Unexpected error \(error)")
    }
    XCTAssertEqual(denied.all.map(\.capability), [.scripts])
  }

  func testRemoteContentAudioCameraMicAiAndStorageGates() async throws {
    let denied = DeniedBox()
    ThreeLiveCapabilities.onDenied = { denied.append($0) }

    // 1. Remote content (`SplatParser.loadURL` + `SpatialAudio.EmitterController`).
    do {
      _ = try await SplatParser.loadURL(
        "https://cdn.example.com/room.spz?token=SECRET",
        capabilities: .default
      )
      XCTFail("Expected urlRejected on SplatParser.loadURL when remoteContent=false")
    } catch {
      XCTAssertEqual(error as? SplatParserError, .urlRejected)
    }
    XCTAssertTrue(denied.all.contains { $0.capability == .remoteContent })
    XCTAssertFalse(denied.all.compactMap(\.url).joined().contains("SECRET"))

    let audioJSON = """
      {"asset":{"version":"2.0"},"scenes":[{"nodes":[0,1]}],
       "nodes":[
         {"name":"RemoteStream","extras":{"xr":{"audioEmitter":{"src":"https://cdn.example.com/a.mp3","autoplay":false,"playOnSelect":true}}}},
         {"name":"DualStream","extras":{"xr":{"audioEmitter":{"preset":"hum","src":"https://evil.example.com/spy.mp3","autoplay":false,"playOnSelect":true}}}}
       ]}
      """
    let session = try XCTUnwrap(XRLiveRuntimeSession(gltfJSONData: Data(audioJSON.utf8)))
    var played: [SpatialAudio.PlayEvent] = []
    let audio = SpatialAudio.EmitterController(session: session, capabilities: .default) {
      played.append($0)
    }
    XCTAssertNil(audio.trigger(nodeIndex: 0))
    XCTAssertTrue(played.isEmpty)
    // Dual preset+src plays synthesized preset but strips `src`.
    XCTAssertNotNil(audio.trigger(nodeIndex: 1))
    XCTAssertEqual(played.count, 1)
    XCTAssertNil(played[0].src)

    // 2. Camera (`XRObjectDetectionLoop`).
    let loop = XRObjectDetectionLoop(
      captureFrame: { done in
        done(
          XRCapturedFrame(
            jpeg: Data([1]), width: 16, height: 16,
            cameraWorld: matrix_identity_float4x4,
            projection: matrix_identity_float4x4,
            timestamp: 1))
      },
      detector: FakeObjectDetector()
    ) { _ in }
    loop.capabilities = ThreeLiveCapabilities.default
    XCTAssertFalse(loop.tick())
    loop.capabilities = ThreeLiveCapabilities(camera: true)
    XCTAssertTrue(loop.tick())

    // 3. AI + Network + Microphone + Camera (`XRGeminiLiveController`, `URLSessionLiveTransport`, `AIEditor`, `AIVoiceSession`).
    XCTAssertNil(
      URLSessionLiveTransport(
        url: URL(string: "wss://generativelanguage.googleapis.com/ws")!,
        capabilities: .default
      )
    )

    let transport = FakeLiveTransport()
    let live = XRGeminiLiveController(frameProvider: { $0(Data([0xFF, 0xD8])) })
    live.capabilities = ThreeLiveCapabilities.default
    live.connect(transport, streamFrames: false)
    XCTAssertTrue(transport.sent.isEmpty)

    live.capabilities = ThreeLiveCapabilities(network: true, ai: true)
    live.connect(transport, streamFrames: false)
    XCTAssertEqual(transport.sent.count, 1)
    live.sendAudioChunk(Data([0, 0]), sampleRate: 16000)
    XCTAssertEqual(transport.sent.count, 1, "microphone still disabled")
    XCTAssertFalse(live.sendFrame(), "camera still disabled")

    live.capabilities = ThreeLiveCapabilities(
      network: true, camera: true, microphone: true, ai: true)
    live.sendAudioChunk(Data([0, 0]), sampleRate: 16000)
    XCTAssertEqual(transport.sent.count, 2)
    XCTAssertTrue(live.sendFrame())
    XCTAssertEqual(transport.sent.count, 3)

    let editor = AIEditor(
      source: "scene.add(new THREE.Mesh());",
      provider: FakeAIProvider()
    ) { _ in }
    editor.capabilities = ThreeLiveCapabilities.default
    let editRes = await editor.editScene("make it blue")
    XCTAssertFalse(editRes.applied)
    XCTAssertTrue((editRes.error ?? "").contains("ai"))

    let voice = try AIVoiceSession(editor: editor, transport: transport)
    voice.capabilities = ThreeLiveCapabilities(network: true, microphone: false, ai: true)
    _ = try await voice.start()
    let beforeVoiceAudio = transport.sent.count
    voice.sendAudio(Data([1, 0, 2, 0]))
    XCTAssertEqual(transport.sent.count, beforeVoiceAudio, "microphone capability blocks sendAudio")
    voice.capabilities = ThreeLiveCapabilities(network: true, microphone: true, ai: true)
    voice.sendAudio(Data([1, 0, 2, 0]))
    XCTAssertEqual(transport.sent.count, beforeVoiceAudio + 1)
    voice.close()

    // 4. Storage, Sensors, and External Handoff policy checks.
    var policy = ThreeLiveCapabilities.default
    XCTAssertFalse(policy.check(.storage, feature: "persistentAnchors"))
    XCTAssertFalse(policy.check(.sensors, feature: "handTracking"))
    XCTAssertFalse(policy.check(.externalHandoff, feature: "quickLook"))
    policy = ThreeLiveCapabilities(sensors: true, storage: true, externalHandoff: true)
    XCTAssertTrue(policy.check(.storage, feature: "persistentAnchors"))
    XCTAssertTrue(policy.check(.sensors, feature: "handTracking"))
    XCTAssertTrue(policy.check(.externalHandoff, feature: "quickLook"))

    // 5. Audit Regression Coverage: >256-char OAuth/JWT userinfo sanitization & IPv6 loopback splats.
    let longJWT = "SECRET_JWT_" + String(repeating: "x", count: 320)
    let cleanLong = ThreeLiveCapabilities.sanitizeDiagnosticURL(
      "https://oauth2:\(longJWT)@api.example.com/v1/chat?token=T"
    )
    XCTAssertFalse(cleanLong.contains("SECRET_JWT_"))
    XCTAssertFalse(cleanLong.contains("oauth2"))
    XCTAssertEqual(cleanLong, "https://api.example.com/v1/chat")

    let cleanMalformed = ThreeLiveCapabilities.sanitizeDiagnosticURL(
      "https://oauth2:\(longJWT)@[bad/path?token=T"
    )
    XCTAssertFalse(cleanMalformed.contains("SECRET_JWT_"))

    XCTAssertNotNil(SplatParser.resolveSplatURL("http://[::1]:8080/scene.splat"))
  }
}
