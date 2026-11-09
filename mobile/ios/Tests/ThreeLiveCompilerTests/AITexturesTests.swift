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

@testable import ThreeLiveCompiler

/// AI textures on iOS (B5d), exercised against the real shared Rust core (`texture_*` ops).
final class AITexturesTests: XCTestCase {

  private let scene = """
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2), new THREE.MeshStandardMaterial());
    wall.name = 'Wall';
    wall.position.y = 0.5;
    wall.userData.xr = { material: { preset: 'brick', prompt: 'ios mossy stone', size: 256 } };
    scene.add(wall);
    """

  /// A 1×1 PNG returned as `b64_json`.
  private final class FakeImages: AIImageProvider {
    let name = "fake-images"
    let model: String? = "fake-1"
    var prompts: [String] = []
    func generateImage(_ requestBody: [String: Any]) async throws -> Data {
      prompts.append(requestBody["prompt"] as? String ?? "")
      let png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
      return try JSONSerialization.data(withJSONObject: ["data": [["b64_json": png]]])
    }
  }

  override func tearDown() async throws {
    try await AITextures().setPack(nil)
  }

  func testGeneratesMissingTexturesThroughTheSharedCore() async throws {
    let images = FakeImages()
    let cache = FileManager.default.temporaryDirectory.appendingPathComponent(
      "tl-textures-\(UUID().uuidString)")
    let tex = AITextures(provider: images, cacheDirectory: cache)
    let before = try await tex.requests(scene)
    XCTAssertEqual(before.count, 1)
    XCTAssertFalse(before[0].hit)
    XCTAssertEqual(before[0].meshes, ["Wall"])

    let res = try await tex.generateTextures(scene)
    XCTAssertEqual(res.generated, [before[0].key])
    XCTAssertTrue(images.prompts[0].hasPrefix("ios mossy stone Seamless tileable"))
    XCTAssertNotNil(res.packJSON)
    let after = try await tex.requests(scene)
    XCTAssertTrue(after[0].hit)

    // A fresh instance reuses the cached provider image.
    try await tex.setPack(nil)
    let images2 = FakeImages()
    let res2 = try await AITextures(provider: images2, cacheDirectory: cache).generateTextures(
      scene)
    XCTAssertEqual(res2.cached, [before[0].key])
    XCTAssertTrue(images2.prompts.isEmpty)
  }

  private final class Box: @unchecked Sendable {
    var result: AITextureResult?
    var starts: [[String]] = []
  }

  func testAutoModeGeneratesInTheBackgroundOnSceneLoaded() async throws {
    let images = FakeImages()
    let tex = AITextures(provider: images)
    XCTAssertEqual(tex.mode, .auto)
    let box = Box()
    tex.onTexturesStart = { _, requests in box.starts.append(requests.map(\.key)) }
    await tex.sceneLoaded(scene) { result in box.result = result }?.value
    XCTAssertEqual(box.starts.count, 1)
    XCTAssertEqual(box.result?.generated.count, 1)
    XCTAssertEqual(images.prompts.count, 1)
    let after = try await tex.requests(scene)
    XCTAssertTrue(after[0].hit)

    // Everything is in the pack: a second load does nothing.
    await tex.sceneLoaded(scene)?.value
    XCTAssertEqual(images.prompts.count, 1)
    XCTAssertEqual(box.starts.count, 1)

    tex.mode = .manual
    XCTAssertNil(tex.sceneLoaded(scene))
    XCTAssertEqual(AITextures().mode, .manual)
    XCTAssertNil(AITextures().sceneLoaded(scene))
  }

  func testRejectsBadPacksAndMissingProviders() async throws {
    let tex = AITextures()
    do {
      try await tex.setPack("{\"format\": \"nope\"}")
      XCTFail("expected rejection")
    } catch let e as AIEditError {
      XCTAssertTrue(e.message.contains("format"))
    }
    let res = try await tex.generateTextures(scene)
    XCTAssertTrue(res.failed.values.allSatisfy { $0.contains("no image provider") })
    XCTAssertNil(AIImagesProvider(endpoint: "http://example.com/v1/images/generations"))
    XCTAssertNotNil(AIImagesProvider(endpoint: "http://localhost:8188/v1/images/generations"))
  }
}
