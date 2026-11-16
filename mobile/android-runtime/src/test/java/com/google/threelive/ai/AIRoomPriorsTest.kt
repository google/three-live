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

import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Room-scan priors (`AISpatialPriors.fromRoomScan`); mirrors `AIRoomPriorsTests` on iOS. */
class AIRoomPriorsTest {

  /** Column-major rotation about +Y by [yawDeg], then translation. */
  private fun pose(x: Double, y: Double, z: Double, yawDeg: Double = 0.0): List<Double> {
    val a = Math.toRadians(yawDeg)
    val c = cos(a)
    val s = sin(a)
    return listOf(c, 0.0, -s, 0.0, 0.0, 1.0, 0.0, 0.0, s, 0.0, c, 0.0, x, y, z, 1.0)
  }

  /** A horizontal surface: local Z (the normal) points up. */
  private fun floorPose(x: Double, y: Double, z: Double): List<Double> =
    listOf(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, x, y, z, 1.0)

  @Test
  fun mapsWallsFloorsAndFurniture() {
    val priors =
      AISpatialPriors.fromRoomScan(
        surfaces =
          listOf(
            AIRoomSurface("wall", pose(0.0, 1.25, -2.0), listOf(4.0, 2.5, 0.0)),
            AIRoomSurface("door", pose(1.0, 1.0, -2.0), listOf(0.9, 2.0, 0.0)),
            AIRoomSurface("floor", floorPose(0.0, 0.02, 0.0), listOf(4.0, 3.5, 0.0)),
          ),
        objects =
          listOf(AIRoomObject("sofa", pose(0.5, 0.4, -1.4, yawDeg = 90.0), listOf(2.1, 0.8, 0.9))),
        camera = AICamera(listOf(0.0, 1.5, 2.0), listOf(0.0, 1.0, 0.0)),
      )

    assertEquals(0.02, priors.floorY!!, 1e-9)
    assertEquals(listOf("floor", "wall", "door"), priors.planes.map { it.label })
    val floor = priors.planes[0]
    assertEquals("horizontal", floor.orientation)
    assertEquals(listOf(4.0, 3.5), floor.extent)
    assertEquals(listOf(0.0, 1.0, 0.0), floor.normal)
    val wall = priors.planes[1]
    assertEquals("vertical", wall.orientation)
    assertEquals(listOf(0.0, 1.25, -2.0), wall.center)
    assertEquals(listOf(0.0, 0.0, 1.0), wall.normal)

    val sofa = priors.objects.single()
    assertEquals("sofa", sofa.label)
    assertEquals(listOf(2.1, 0.8, 0.9), sofa.size)
    assertEquals(90.0, sofa.yawDeg!!, 1e-9)

    val map = priors.toMap()
    assertEquals(3, (map["planes"] as List<*>).size)
    assertEquals(1, (map["objects"] as List<*>).size)
    assertNotNull(map["camera"])
  }

  @Test
  fun floorFallsBackToLowestWallOrObjectBottom() {
    val priors =
      AISpatialPriors.fromRoomScan(
        surfaces = listOf(AIRoomSurface("wall", pose(0.0, 1.3, -2.0), listOf(4.0, 2.5, 0.0))),
        objects = listOf(AIRoomObject("table", pose(0.0, 0.4, 0.0), listOf(1.0, 0.75, 1.0))),
      )
    assertEquals(0.025, priors.floorY!!, 1e-9) // 0.4 − 0.75 / 2
  }

  @Test
  fun dropsInvalidEntriesAndCapsAt32KeepingFloorsFirst() {
    val surfaces =
      (0 until 40).map {
        AIRoomSurface("wall", pose(it.toDouble(), 1.0, 0.0), listOf(1.0, 2.0, 0.0))
      } +
        AIRoomSurface("floor", floorPose(0.0, 0.0, 0.0), listOf(5.0, 5.0, 0.0)) +
        AIRoomSurface("ceiling", floorPose(0.0, 2.5, 0.0), listOf(5.0, 5.0, 0.0)) +
        AIRoomSurface(
          "wall",
          pose(0.0, 1.0, 0.0).toMutableList().also { it[12] = Double.NaN },
          listOf(1.0, 2.0, 0.0),
        ) +
        AIRoomSurface("wall", listOf(1.0, 0.0), listOf(1.0, 2.0, 0.0))
    val objects =
      listOf(
        AIRoomObject("  ", pose(0.0, 0.0, 0.0), listOf(1.0, 1.0, 1.0)),
        AIRoomObject("chair", pose(0.0, 0.4, 0.0), listOf(Double.NaN, 1.0, 1.0)),
      )
    val priors = AISpatialPriors.fromRoomScan(surfaces, objects)
    assertEquals(32, priors.planes.size)
    assertEquals("floor", priors.planes.first().label)
    assertFalse(priors.planes.any { it.label == "ceiling" })
    assertTrue(priors.objects.isEmpty())
    assertEquals(0.0, priors.floorY!!, 0.0)
  }

  @Test
  fun kindsAreCaseInsensitiveAndOrientationFollowsTheKind() {
    // A floor whose sides are on local X / Z and a wall whose local Z tilts slightly: the kind
    // still decides orientation, and the wall normal stays level.
    val tilted = pose(0.0, 1.2, -2.0).toMutableList().also { it[9] = 0.1 }
    val priors =
      AISpatialPriors.fromRoomScan(
        surfaces =
          listOf(
            AIRoomSurface(" WALL ", tilted, listOf(3.0, 2.4, 0.0)),
            AIRoomSurface("Floor", pose(0.0, -0.0001, 0.0), listOf(4.0, 0.0, 3.0)),
          ),
        objects =
          listOf(
            AIRoomObject(
              "COFFEE_TABLE",
              pose(0.0, 0.2, 0.0).map { it.toFloat() }.toFloatArray(),
              floatArrayOf(1f, 0.4f, 0.6f),
            )
          ),
      )
    assertEquals(listOf("floor", "wall"), priors.planes.map { it.label })
    assertEquals("horizontal", priors.planes[0].orientation)
    assertEquals(listOf(0.0, 1.0, 0.0), priors.planes[0].normal)
    assertEquals(listOf(4.0, 3.0), priors.planes[0].extent)
    assertEquals("vertical", priors.planes[1].orientation)
    assertEquals(listOf(0.0, 0.0, 1.0), priors.planes[1].normal)
    // −0.0001 rounds to 0, never −0 (List.equals tells them apart).
    assertEquals(listOf(0.0), listOf(priors.floorY))
    val table = priors.objects.single()
    assertEquals("coffee table", table.label)
    assertEquals(listOf(1.0, 0.4, 0.6), table.size)
  }
}
