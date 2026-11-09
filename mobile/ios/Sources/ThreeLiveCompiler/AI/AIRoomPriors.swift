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

import Foundation
import simd

#if canImport(RoomPlan) && os(iOS)
  import RoomPlan
#endif

/// One scanned room surface (RoomPlan `CapturedRoom.Surface`), in ARKit world meters.
///
/// Like RoomPlan, `transform` places the surface's center, and a wall-like surface spans its
/// local X (`dimensions.x`, width) and Y (`dimensions.y`, height) axes with its normal along
/// local Z. Floors are always horizontal (normal +Y); their extent is their two non-zero
/// `dimensions`.
public struct AIRoomSurface: Sendable, Equatable {
  /// `wall`, `floor`, `door`, `window`, or `opening` (case-insensitive; others are ignored).
  public var kind: String
  public var transform: simd_float4x4
  public var dimensions: SIMD3<Float>

  public init(kind: String, transform: simd_float4x4, dimensions: SIMD3<Float>) {
    self.kind = kind
    self.transform = transform
    self.dimensions = dimensions
  }
}

/// One scanned piece of furniture or fixture (RoomPlan `CapturedRoom.Object`), in ARKit world
/// meters. `transform` places the bounding box center; `dimensions` is width (local X), height
/// (local Y), and depth (local Z).
public struct AIRoomObject: Sendable, Equatable {
  /// Category name, e.g. `sofa`, `table`, `washer dryer`.
  public var category: String
  public var transform: simd_float4x4
  public var dimensions: SIMD3<Float>

  public init(category: String, transform: simd_float4x4, dimensions: SIMD3<Float>) {
    self.category = category
    self.transform = transform
    self.dimensions = dimensions
  }
}

extension AISpatialPriors {
  /// Most planes and objects forwarded (the shared core reads at most this many of each).
  static let maxRoomPriors = 32

  /// Builds metric priors from a room scan (B4): walls, floors, doors, windows, and openings
  /// become planes; furniture becomes objects with size and yaw. `floorY` is the lowest floor
  /// surface, or, without one (RoomPlan before iOS 17), the lowest wall or object bottom.
  ///
  /// Floors come first, then walls, doors, windows, and openings, so the most useful planes
  /// survive the 32-plane cap.
  public static func fromRoomScan(
    surfaces: [AIRoomSurface],
    objects: [AIRoomObject] = [],
    camera: AICamera? = nil,
    cameraFovDeg: Double? = nil
  ) -> AISpatialPriors {
    let rank = ["floor": 0, "wall": 1, "door": 2, "window": 3, "opening": 4]
    // Kinds are matched case-insensitively (`WALL` from Android-style labels works too).
    let valid: [(kind: String, surface: AIRoomSurface)] = surfaces.compactMap { s in
      let kind = s.kind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      guard rank[kind] != nil, finite(s.transform), finite(s.dimensions) else { return nil }
      return (kind, s)
    }
    let ordered = valid.enumerated().sorted { a, b in
      let ra = rank[a.element.kind]!
      let rb = rank[b.element.kind]!
      return ra != rb ? ra < rb : a.offset < b.offset
    }.map(\.element)

    var floorY: Double?
    var bottoms: [Double] = []
    var planes: [AISpatialPlane] = []
    for (kind, s) in ordered {
      let m = s.transform
      let center = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
      let dims = SIMD3<Float>(abs(s.dimensions.x), abs(s.dimensions.y), abs(s.dimensions.z))
      let isFloor = kind == "floor"
      // The kind decides the orientation (floors are horizontal, everything else sits in a
      // wall), so an unexpected local axis convention can't flip it.
      let normal: SIMD3<Float>
      let extent: (Float, Float)
      if isFloor {
        normal = SIMD3<Float>(0, 1, 0)
        // Use the two non-zero sides, whichever local axes they are on.
        let sides = [dims.x, dims.y, dims.z].filter { $0 > 0 }
        extent = sides.count >= 2 ? (sides[0], sides[1]) : (0, 0)
        let y = Double(center.y)
        if floorY == nil || y < floorY! { floorY = y }
      } else {
        // Wall-like: normal along local Z, kept horizontal.
        let z = SIMD3<Float>(m.columns.2.x, 0, m.columns.2.z)
        normal = normalize3(z)
        extent = (dims.x, dims.y)
        if kind == "wall" { bottoms.append(Double(center.y) - Double(dims.y) / 2) }
      }
      guard planes.count < maxRoomPriors else { continue }
      let (w, h) = (Double(extent.0), Double(extent.1))
      planes.append(
        AISpatialPlane(
          orientation: isFloor ? "horizontal" : "vertical",
          center: vec(center),
          extent: w > 0 && h > 0 ? [round3(w), round3(h)] : nil,
          normal: normal == .zero ? nil : vec(normal),
          label: kind
        ))
    }

    var mapped: [AISpatialObject] = []
    for o in objects where finite(o.transform) && finite(o.dimensions) {
      let label = objectLabel(o.category)
      guard !label.isEmpty else { continue }
      let m = o.transform
      let center = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
      let size = SIMD3<Float>(abs(o.dimensions.x), abs(o.dimensions.y), abs(o.dimensions.z))
      bottoms.append(Double(center.y) - Double(size.y) / 2)
      guard mapped.count < maxRoomPriors else { continue }
      // Rotation about +Y (Three.js `rotation.y`): local +X maps to (cos θ, 0, −sin θ).
      let yaw = atan2(-Double(m.columns.0.z), Double(m.columns.0.x)) * 180 / .pi
      mapped.append(
        AISpatialObject(
          label: label,
          center: vec(center),
          size: size.x > 0 && size.y > 0 && size.z > 0 ? vec(size) : nil,
          yawDeg: yaw.isFinite ? round3(yaw) : nil
        ))
    }
    if floorY == nil { floorY = bottoms.min() }
    return AISpatialPriors(
      floorY: floorY.map(round3), camera: camera, cameraFovDeg: cameraFovDeg, planes: planes,
      objects: mapped)
  }

  /// Trimmed, lowercased, `_` → space (`"COFFEE_TABLE"` → `"coffee table"`).
  static func objectLabel(_ raw: String) -> String {
    raw.replacingOccurrences(of: "_", with: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  /// `"washerDryer"` → `"washer dryer"` (a space only where lowercase meets uppercase).
  static func roomCategoryLabel(_ raw: String) -> String {
    var out = ""
    var prevLower = false
    for ch in raw {
      if ch.isUppercase, prevLower { out.append(" ") }
      prevLower = ch.isLowercase
      out.append(contentsOf: ch.lowercased())
    }
    return out
  }

  private static func finite(_ m: simd_float4x4) -> Bool {
    [m.columns.0, m.columns.1, m.columns.2, m.columns.3].allSatisfy { c in
      c.x.isFinite && c.y.isFinite && c.z.isFinite && c.w.isFinite
    }
  }

  private static func finite(_ v: SIMD3<Float>) -> Bool {
    v.x.isFinite && v.y.isFinite && v.z.isFinite
  }

  private static func normalize3(_ v: SIMD3<Float>) -> SIMD3<Float> {
    let len = simd_length(v)
    return len > 1e-6 && len.isFinite ? v / len : .zero
  }

  // Millimeters; `+ 0` turns −0 into 0 so prompts never show "-0".
  private static func round3(_ v: Double) -> Double { (v * 1000).rounded() / 1000 + 0 }

  private static func vec(_ v: SIMD3<Float>) -> [Double] {
    [round3(Double(v.x)), round3(Double(v.y)), round3(Double(v.z))]
  }

  #if canImport(RoomPlan) && os(iOS)
    /// Metric priors from a RoomPlan scan (`RoomCaptureSession` / `RoomBuilder`). RoomPlan
    /// reports the room in the capture session's ARKit world frame, so take the reference
    /// photo's `camera` from the same `ARSession` (e.g. `fromARFrame(frame).camera`) and the
    /// planes, objects, and camera line up. Rooms merged into a `CapturedStructure` (iOS 17)
    /// may be re-aligned; use the per-session `CapturedRoom` with that session's camera.
    /// Floors need iOS 17; on iOS 16 `floorY` falls back to the lowest wall or object bottom.
    @available(iOS 16.0, *)
    public static func fromCapturedRoom(
      _ room: CapturedRoom, camera: AICamera? = nil, cameraFovDeg: Double? = nil
    ) -> AISpatialPriors {
      func surfaces(_ list: [CapturedRoom.Surface], _ kind: String) -> [AIRoomSurface] {
        list.map { AIRoomSurface(kind: kind, transform: $0.transform, dimensions: $0.dimensions) }
      }
      var all =
        surfaces(room.walls, "wall") + surfaces(room.doors, "door")
        + surfaces(room.windows, "window") + surfaces(room.openings, "opening")
      if #available(iOS 17.0, *) {
        all += surfaces(room.floors, "floor")
      }
      let objects = room.objects.map { o in
        AIRoomObject(
          // Case name only, in case a future SDK adds associated values ("table(...)").
          category: roomCategoryLabel(
            String(String(describing: o.category).prefix { $0 != "(" })),
          transform: o.transform, dimensions: o.dimensions)
      }
      return fromRoomScan(
        surfaces: all, objects: objects, camera: camera, cameraFovDeg: cameraFovDeg)
    }
  #endif
}
