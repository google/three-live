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

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.floor
import kotlin.math.sign
import kotlin.math.sqrt

/**
 * One scanned room surface in world meters (+Y up), e.g. from Android XR labeled planes, a Meta
 * MRUK room, or your own scanner. Mirrors `AIRoomSurface` on iOS (RoomPlan conventions).
 *
 * @property kind `wall`, `floor`, `door`, `window`, or `opening` (case-insensitive, so
 *   `Plane.Label.WALL.toString()` works; other kinds are ignored).
 * @property transform 16 values, column-major (like ARCore `Pose.toMatrix` /
 *   `android.opengl.Matrix`): places the surface center. A wall-like surface spans local X
 *   (`dimensions[0]`, width) and local Y (`dimensions[1]`, height) with its normal along local Z.
 *   Floors are always horizontal; their extent is their two non-zero `dimensions`.
 * @property dimensions `[width, height, depth]` in meters.
 */
data class AIRoomSurface(
  val kind: String,
  val transform: List<Double>,
  val dimensions: List<Double>,
) {
  /** From float arrays, e.g. `FloatArray(16).also { pose.toMatrix(it, 0) }`. */
  constructor(
    kind: String,
    transform: FloatArray,
    dimensions: FloatArray,
  ) : this(kind, transform.map { it.toDouble() }, dimensions.map { it.toDouble() })
}

/**
 * One scanned piece of furniture or fixture in world meters (+Y up). Mirrors `AIRoomObject` on iOS.
 *
 * @property category label, e.g. `sofa`, `table`; trimmed, lowercased, `_` → space (`COFFEE_TABLE`
 *   → `coffee table`).
 * @property transform 16 floats, column-major: places the bounding-box center.
 * @property dimensions `[width (local X), height (local Y), depth (local Z)]` in meters.
 */
data class AIRoomObject(
  val category: String,
  val transform: List<Double>,
  val dimensions: List<Double>,
) {
  /** From float arrays, e.g. `FloatArray(16).also { pose.toMatrix(it, 0) }`. */
  constructor(
    category: String,
    transform: FloatArray,
    dimensions: FloatArray,
  ) : this(category, transform.map { it.toDouble() }, dimensions.map { it.toDouble() })
}

/** `AISpatialPriors.fromRoomScan`: the same mapping as the Swift version. */
internal object RoomScanPriors {
  const val MAX_PRIORS = 32
  private val RANK = mapOf("floor" to 0, "wall" to 1, "door" to 2, "window" to 3, "opening" to 4)

  fun map(
    surfaces: List<AIRoomSurface>,
    objects: List<AIRoomObject>,
    camera: AICamera?,
    cameraFovDeg: Double?,
  ): AISpatialPriors {
    // Kinds are matched case-insensitively (`WALL` from `Plane.Label` works too).
    val ordered =
      surfaces
        .mapIndexedNotNull { i, s ->
          val kind = s.kind.trim().lowercase()
          if (kind in RANK && valid(s.transform, 16) && valid(s.dimensions, 3)) Triple(i, kind, s)
          else null
        }
        .sortedWith(compareBy({ RANK.getValue(it.second) }, { it.first }))

    var floorY: Double? = null
    val bottoms = mutableListOf<Double>()
    val planes = mutableListOf<AISpatialPlane>()
    for ((_, kind, s) in ordered) {
      val m = s.transform
      val center = listOf(m[12], m[13], m[14])
      val dims = s.dimensions.take(3).map { abs(it) }
      val isFloor = kind == "floor"
      // The kind decides the orientation (floors are horizontal, everything else sits in a wall),
      // so an unexpected local axis convention can't flip it.
      val normal: List<Double>
      val extent: List<Double>
      if (isFloor) {
        normal = listOf(0.0, 1.0, 0.0)
        // Use the two non-zero sides, whichever local axes they are on.
        extent = dims.filter { it > 0 }.take(2)
        if (floorY == null || center[1] < floorY) floorY = center[1]
      } else {
        // Wall-like: normal along local Z, kept horizontal.
        normal = normalize(m[8], 0.0, m[10])
        extent = listOf(dims[0], dims[1])
        if (kind == "wall") bottoms += center[1] - dims[1] / 2
      }
      if (planes.size >= MAX_PRIORS) continue
      planes +=
        AISpatialPlane(
          orientation = if (isFloor) "horizontal" else "vertical",
          center = center.map(::round3),
          extent = if (extent.size == 2 && extent.all { it > 0 }) extent.map(::round3) else null,
          normal = if (normal.all { it == 0.0 }) null else normal.map(::round3),
          label = kind,
        )
    }

    val mapped = mutableListOf<AISpatialObject>()
    for (o in objects) {
      if (!valid(o.transform, 16) || !valid(o.dimensions, 3)) continue
      val label = objectLabel(o.category)
      if (label.isEmpty()) continue
      val m = o.transform
      val center = listOf(m[12], m[13], m[14])
      val size = o.dimensions.take(3).map { abs(it) }
      bottoms += center[1] - size[1] / 2
      if (mapped.size >= MAX_PRIORS) continue
      // Rotation about +Y (Three.js `rotation.y`): local +X maps to (cos θ, 0, −sin θ).
      val yaw = Math.toDegrees(atan2(-m[2], m[0]))
      mapped +=
        AISpatialObject(
          label = label,
          center = center.map(::round3),
          size = if (size.all { it > 0 }) size.map(::round3) else null,
          yawDeg = if (yaw.isFinite()) round3(yaw) else null,
        )
    }
    if (floorY == null) floorY = bottoms.minOrNull()
    return AISpatialPriors(
      floorY = floorY?.let(::round3),
      camera = camera,
      cameraFovDeg = cameraFovDeg,
      planes = planes,
      objects = mapped,
    )
  }

  /** Trimmed, lowercased, `_` → space (`"COFFEE_TABLE"` → `"coffee table"`). */
  fun objectLabel(raw: String): String = raw.replace('_', ' ').trim().lowercase()

  private fun valid(v: List<Double>, n: Int) = v.size >= n && v.take(n).all { it.isFinite() }

  private fun normalize(x: Double, y: Double, z: Double): List<Double> {
    val len = sqrt(x * x + y * y + z * z)
    return if (len > 1e-6 && len.isFinite()) listOf(x / len, y / len, z / len)
    else listOf(0.0, 0.0, 0.0)
  }

  // Millimeters, half away from zero (Swift `rounded()`); `+ 0.0` turns −0 into 0.
  private fun round3(v: Double): Double = sign(v) * floor(abs(v) * 1000 + 0.5) / 1000 + 0.0
}
