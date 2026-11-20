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
@testable import ThreeLiveRuntime

/// `cutaway` dollhouse culling and `character.cameraEngage` (parity with the Web runtime).
final class XRCutawayAndCameraEngageTests: XCTestCase {

  private func pose(_ x: Float, _ y: Float, _ z: Float) -> XRPose {
    XRPose(position: SIMD3<Float>(x, y, z))
  }

  func testParseCutawayNormalizesAndRejectsInvalidInput() {
    XCTAssertEqual(
      XRLiveTraitParser.parseCutaway(["normal": [0.0, 0.0, 2.0]])?.normal, SIMD3<Float>(0, 0, 1))
    XCTAssertEqual(
      XRLiveTraitParser.parseCutaway([3.0, 0.0, 4.0])?.normal, SIMD3<Float>(0.6, 0, 0.8))
    XCTAssertNil(XRLiveTraitParser.parseCutaway(["normal": [0.0, 0.0, 0.0]]))
    XCTAssertNil(XRLiveTraitParser.parseCutaway(["normal": [1.0, 0.0, 0.0], "enabled": false]))
    XCTAssertNil(XRLiveTraitParser.parseCutaway("front"))
  }

  func testCutawayHidesCameraFacingWallsAndRestoresThem() {
    let gltf: [String: Any] = [
      "asset": ["version": "2.0"],
      "nodes": [
        [
          "name": "FrontWall", "translation": [0, 0, 2],
          "extras": ["xr": ["cutaway": ["normal": [0, 0, 1]]]],
        ],
        ["name": "BackWall", "translation": [0, 0, -2]],
      ],
    ]
    let s = XRLiveRuntimeSession(gltf: gltf)
    s.step(dt: 1.0 / 60, headPose: pose(0, 1.5, 8))
    XCTAssertTrue(s.isCutAway(0))
    XCTAssertFalse(s.isEffectivelyVisible(0))
    XCTAssertTrue(s.isVisible(0), "authored visibility is untouched")
    XCTAssertTrue(s.isEffectivelyVisible(1))

    s.step(dt: 1.0 / 60, headPose: pose(0, 1.5, -8))
    XCTAssertFalse(s.isCutAway(0))
    XCTAssertTrue(s.isEffectivelyVisible(0))

    s.step(dt: 1.0 / 60, headPose: pose(0, 1.5, 8))
    XCTAssertTrue(s.isCutAway(0))
    s.cutawayEnabled = false
    s.step(dt: 1.0 / 60, headPose: pose(0, 1.5, 8))
    XCTAssertFalse(s.isCutAway(0), "cutawayEnabled = false shows every wall")
  }

  func testCutawayUsesTheWorldRotationOfTheNode() {
    // Rotated 180 degrees about Y: the authored +Z normal now points to -Z.
    let gltf: [String: Any] = [
      "asset": ["version": "2.0"],
      "nodes": [
        [
          "name": "Wall", "translation": [0, 0, -2], "rotation": [0, 1, 0, 0],
          "extras": ["xr": ["cutaway": [0, 0, 1]]],
        ]
      ],
    ]
    let s = XRLiveRuntimeSession(gltf: gltf)
    s.step(dt: 1.0 / 60, headPose: pose(0, 1.5, -8))
    XCTAssertTrue(s.isCutAway(0))
    s.step(dt: 1.0 / 60, headPose: pose(0, 1.5, 8))
    XCTAssertFalse(s.isCutAway(0))
  }

  private func characterWorld(
    _ character: [String: Any], configure: (XRSimWorld) -> Void = { _ in }
  ) -> XRSimWorld {
    let gltf: [String: Any] = [
      "asset": ["version": "2.0"],
      "nodes": [["name": "Spawn", "translation": [2, 0, 1], "extras": ["xr": ["character": character]]]],
    ]
    let w = XRSimWorld(session: XRLiveRuntimeSession(gltf: gltf), gltf: gltf)
    configure(w)
    return w
  }

  private func run(_ w: XRSimWorld, frames: Int) {
    for _ in 0..<frames { w.step(dt: 1.0 / 60, headPose: pose(0, 1.6, 6)) }
  }

  func testOnInputCameraEngageWaitsForMovementOrJump() {
    XCTAssertEqual(XRSimTraits.parseCharacter(["cameraEngage": "on-input"])?.cameraEngage, "on-input")
    XCTAssertEqual(XRSimTraits.parseCharacter([String: Any]())?.cameraEngage, "immediate")

    let lazy = characterWorld(["cameraEngage": "on-input"])
    run(lazy, frames: 30)
    XCTAssertNil(CharacterController.cameraRig(lazy), "no follow camera before input")
    lazy.moveZ = 1
    run(lazy, frames: 6)
    lazy.moveZ = 0
    XCTAssertNotNil(CharacterController.cameraRig(lazy), "movement engages the follow camera")

    let jumper = characterWorld([:]) { $0.characterCamera = "on-input" }
    run(jumper, frames: 30)
    XCTAssertNil(CharacterController.cameraRig(jumper))
    jumper.jump()
    run(jumper, frames: 2)
    XCTAssertNotNil(CharacterController.cameraRig(jumper), "a jump engages the follow camera")

    let eager = characterWorld(["cameraEngage": "on-input"]) { $0.characterCamera = "immediate" }
    run(eager, frames: 2)
    XCTAssertNotNil(CharacterController.cameraRig(eager))

    let defaults = characterWorld([:])
    run(defaults, frames: 2)
    XCTAssertNotNil(CharacterController.cameraRig(defaults), "default engages immediately")
  }
}
