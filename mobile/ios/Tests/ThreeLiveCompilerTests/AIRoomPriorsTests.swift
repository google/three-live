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

/// RoomPlan metric priors (B4): the platform-independent `fromRoomScan` mapping.
final class AIRoomPriorsTests: XCTestCase {

  /// Rotation about +Y by `deg`, then translation.
  private func pose(_ t: SIMD3<Float>, yawDeg: Float = 0) -> simd_float4x4 {
    let r = simd_float4x4(simd_quatf(angle: yawDeg * .pi / 180, axis: [0, 1, 0]))
    var m = r
    m.columns.3 = SIMD4<Float>(t.x, t.y, t.z, 1)
    return m
  }

  /// A horizontal surface: local Z (the normal) points up.
  private func floorPose(_ t: SIMD3<Float>) -> simd_float4x4 {
    var m = simd_float4x4(simd_quatf(angle: -.pi / 2, axis: [1, 0, 0]))
    m.columns.3 = SIMD4<Float>(t.x, t.y, t.z, 1)
    return m
  }

  func testMapsWallsFloorsAndFurniture() {
    let priors = AISpatialPriors.fromRoomScan(
      surfaces: [
        AIRoomSurface(
          kind: "wall", transform: pose([0, 1.25, -2], yawDeg: 0), dimensions: [4, 2.5, 0]),
        AIRoomSurface(
          kind: "door", transform: pose([1, 1, -2]), dimensions: [0.9, 2, 0]),
        AIRoomSurface(
          kind: "floor", transform: floorPose([0, 0.02, 0]), dimensions: [4, 3.5, 0]),
      ],
      objects: [
        AIRoomObject(
          category: "sofa", transform: pose([0.5, 0.4, -1.4], yawDeg: 90),
          dimensions: [2.1, 0.8, 0.9])
      ],
      camera: AICamera(eye: [0, 1.5, 2], target: [0, 1, 0]))

    XCTAssertEqual(priors.floorY, 0.02)
    XCTAssertEqual(priors.planes.map(\.label), ["floor", "wall", "door"])
    let floor = priors.planes[0]
    XCTAssertEqual(floor.orientation, "horizontal")
    XCTAssertEqual(floor.extent, [4, 3.5])
    XCTAssertEqual(floor.normal?[1] ?? 0, 1, accuracy: 1e-3)
    let wall = priors.planes[1]
    XCTAssertEqual(wall.orientation, "vertical")
    XCTAssertEqual(wall.center, [0, 1.25, -2])
    XCTAssertEqual(wall.normal ?? [], [0, 0, 1])

    let sofa = priors.objects.first
    XCTAssertEqual(sofa?.label, "sofa")
    XCTAssertEqual(sofa?.size, [2.1, 0.8, 0.9])
    XCTAssertEqual(sofa?.yawDeg ?? 0, 90, accuracy: 1e-3)

    let dict = priors.toDictionary()
    XCTAssertEqual((dict["planes"] as? [[String: Any]])?.count, 3)
    XCTAssertEqual((dict["objects"] as? [[String: Any]])?.count, 1)
    XCTAssertNotNil(dict["camera"])
  }

  func testFloorFallsBackToLowestWallOrObjectBottom() {
    // RoomPlan before iOS 17 reports no floors.
    let priors = AISpatialPriors.fromRoomScan(
      surfaces: [
        AIRoomSurface(kind: "wall", transform: pose([0, 1.3, -2]), dimensions: [4, 2.5, 0])
      ],
      objects: [
        AIRoomObject(category: "table", transform: pose([0, 0.4, 0]), dimensions: [1, 0.75, 1])
      ])
    XCTAssertEqual(priors.floorY ?? .nan, 0.025, accuracy: 1e-6)  // 0.4 − 0.75 / 2
  }

  func testDropsInvalidEntriesAndCapsAt32KeepingFloorsFirst() {
    var surfaces = (0..<40).map { i in
      AIRoomSurface(kind: "wall", transform: pose([Float(i), 1, 0]), dimensions: [1, 2, 0])
    }
    surfaces.append(
      AIRoomSurface(kind: "floor", transform: floorPose([0, 0, 0]), dimensions: [5, 5, 0]))
    surfaces.append(
      AIRoomSurface(kind: "ceiling", transform: floorPose([0, 2.5, 0]), dimensions: [5, 5, 0]))
    var broken = pose([0, 1, 0])
    broken.columns.3.x = .nan
    surfaces.append(AIRoomSurface(kind: "wall", transform: broken, dimensions: [1, 2, 0]))
    let objects = [
      AIRoomObject(category: "  ", transform: pose([0, 0, 0]), dimensions: [1, 1, 1]),
      AIRoomObject(category: "chair", transform: pose([0, 0.4, 0]), dimensions: [.nan, 1, 1]),
    ]
    let priors = AISpatialPriors.fromRoomScan(surfaces: surfaces, objects: objects)
    XCTAssertEqual(priors.planes.count, 32)
    XCTAssertEqual(priors.planes.first?.label, "floor")
    XCTAssertFalse(priors.planes.contains { $0.label == "ceiling" })
    XCTAssertTrue(priors.objects.isEmpty)
    XCTAssertEqual(priors.floorY, 0)
  }

  func testCategoryLabels() {
    XCTAssertEqual(AISpatialPriors.roomCategoryLabel("washerDryer"), "washer dryer")
    XCTAssertEqual(AISpatialPriors.roomCategoryLabel("sofa"), "sofa")
  }
}
