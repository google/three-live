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

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** `cutaway` dollhouse culling and `character.cameraEngage` (parity with the Web runtime). */
class XRCutawayAndCameraEngageTest {

  private fun pose(x: Float, y: Float, z: Float) = XRPose(floatArrayOf(x, y, z))

  @Test
  fun parseCutawayNormalizesAndRejectsInvalidInput() {
    val t = XRLiveSceneCoreHelper.parseCutaway(mapOf("normal" to listOf(0.0, 0.0, 2.0)))!!
    assertEquals(listOf(0.0, 0.0, 1.0), t.normal)
    assertTrue("castShadow defaults to true", t.castShadow)
    val noShd =
      XRLiveSceneCoreHelper.parseCutaway(
        mapOf("normal" to listOf(0.0, 2.0, 0.0), "castShadow" to false)
      )!!
    assertEquals(listOf(0.0, 1.0, 0.0), noShd.normal)
    assertFalse("castShadow=false opts out", noShd.castShadow)
    assertEquals(
      listOf(0.6, 0.0, 0.8),
      XRLiveSceneCoreHelper.parseCutaway(listOf(3.0, 0.0, 4.0))!!.normal,
    )
    assertNull(XRLiveSceneCoreHelper.parseCutaway(mapOf("normal" to listOf(0.0, 0.0, 0.0))))
    assertNull(
      XRLiveSceneCoreHelper.parseCutaway(
        mapOf("normal" to listOf(1.0, 0.0, 0.0), "enabled" to false)
      )
    )
    assertNull(XRLiveSceneCoreHelper.parseCutaway("front"))
  }

  @Test
  fun cutawayCastShadowFalseSuppressesShadowsOnlyWhileCutAway() {
    val json =
      """{"asset":{"version":"2.0"},"nodes":[
        {"name":"Roof","translation":[0,3,0],"extras":{"xr":{"cutaway":{"normal":[0,1,0],"castShadow":false}}}},
        {"name":"FrontWall","translation":[0,0,2],"extras":{"xr":{"cutaway":{"normal":[0,0,1]}}}}]}"""
    val s = XRLiveRuntimeSession(json)
    s.step(1.0 / 60, pose(0f, 8f, 8f))
    assertTrue(s.isCutAway(0))
    assertTrue(s.isCutAwayShadowSuppressed(0))
    assertFalse(s.effectiveCastShadow(0, true))
    assertTrue(s.isCutAway(1))
    assertFalse("default cutaway keeps casting shadows", s.isCutAwayShadowSuppressed(1))
    assertTrue(s.effectiveCastShadow(1, true))

    s.step(1.0 / 60, pose(0f, 1f, 8f))
    assertFalse(s.isCutAway(0))
    assertFalse(s.isCutAwayShadowSuppressed(0))
    assertTrue(s.effectiveCastShadow(0, true))

    s.step(1.0 / 60, pose(0f, 8f, 8f))
    assertTrue(s.isCutAwayShadowSuppressed(0))
    s.cutawayEnabled = false
    s.step(1.0 / 60, pose(0f, 8f, 8f))
    assertFalse(s.isCutAwayShadowSuppressed(0))
    assertTrue(s.effectiveCastShadow(0, true))
  }

  @Test
  fun cutawayHidesCameraFacingWallsAndRestoresThem() {
    val json =
      """{"asset":{"version":"2.0"},"nodes":[
        {"name":"FrontWall","translation":[0,0,2],"extras":{"xr":{"cutaway":{"normal":[0,0,1]}}}},
        {"name":"BackWall","translation":[0,0,-2]}]}"""
    val s = XRLiveRuntimeSession(json)
    s.step(1.0 / 60, pose(0f, 1.5f, 8f))
    assertTrue(s.isCutAway(0))
    assertFalse(s.isEffectivelyVisible(0))
    assertTrue("authored visibility is untouched", s.isVisible(0))
    assertTrue(s.isEffectivelyVisible(1))

    s.step(1.0 / 60, pose(0f, 1.5f, -8f))
    assertFalse(s.isCutAway(0))
    assertTrue(s.isEffectivelyVisible(0))

    s.step(1.0 / 60, pose(0f, 1.5f, 8f))
    assertTrue(s.isCutAway(0))
    s.cutawayEnabled = false
    s.step(1.0 / 60, pose(0f, 1.5f, 8f))
    assertFalse("cutawayEnabled = false shows every wall", s.isCutAway(0))
    assertTrue(s.isEffectivelyVisible(0))
  }

  @Test
  fun cutawayUsesTheWorldRotationOfTheNode() {
    // Rotated 180 degrees about Y: the authored +Z normal now points to -Z.
    val json =
      """{"asset":{"version":"2.0"},"nodes":[
        {"name":"Wall","translation":[0,0,-2],"rotation":[0,1,0,0],
         "extras":{"xr":{"cutaway":[0,0,1]}}}]}"""
    val s = XRLiveRuntimeSession(json)
    s.step(1.0 / 60, pose(0f, 1.5f, -8f))
    assertTrue(s.isCutAway(0))
    s.step(1.0 / 60, pose(0f, 1.5f, 8f))
    assertFalse(s.isCutAway(0))
  }

  private fun characterWorld(characterXr: String, configure: XRSimWorld.() -> Unit = {}): XRSimWorld {
    val json =
      """{"asset":{"version":"2.0"},"nodes":[
        {"name":"Spawn","translation":[2,0,1],"extras":{"xr":{"character":$characterXr}}}]}"""
    val w = XRSimWorld(XRLiveRuntimeSession(json), json)
    w.configure()
    return w
  }

  private fun XRSimWorld.run(frames: Int) {
    repeat(frames) { step(1.0 / 60, pose(0f, 1.6f, 6f)) }
  }

  @Test
  fun onInputCameraEngageWaitsForMovementOrJump() {
    assertEquals(
      "on-input",
      XRSimTraits.parseCharacter(mapOf("cameraEngage" to "on-input"))!!.cameraEngage,
    )
    assertEquals("immediate", XRSimTraits.parseCharacter(mapOf<String, Any>())!!.cameraEngage)

    val lazy = characterWorld("""{"cameraEngage":"on-input"}""")
    lazy.run(30)
    assertNull("no follow camera before input", CharacterController.cameraRig(lazy))
    lazy.moveZ = 1.0
    lazy.run(6)
    lazy.moveZ = 0.0
    assertNotNull("movement engages the follow camera", CharacterController.cameraRig(lazy))

    val jumper = characterWorld("{}") { characterCamera = "on-input" }
    jumper.run(30)
    assertNull(CharacterController.cameraRig(jumper))
    jumper.jumpQueued = true
    jumper.run(2)
    assertNotNull("a jump engages the follow camera", CharacterController.cameraRig(jumper))

    val eager = characterWorld("""{"cameraEngage":"on-input"}""") { characterCamera = "immediate" }
    eager.run(2)
    assertNotNull(CharacterController.cameraRig(eager))

    val defaults = characterWorld("{}")
    defaults.run(2)
    assertNotNull("default engages immediately", CharacterController.cameraRig(defaults))

    // First-person spawn yaw (`thetaDeg`) and `character-controller="none"` viewHidden cleanup.
    val rotJson =
      """{"asset":{"version":"2.0"},"nodes":[
        {"name":"Spawn","translation":[0,0,0],"rotation":[0,0.70710678,0,0.70710678],
         "extras":{"xr":{"character":{"mode":"first-person","height":1.65}}}}]}"""
    val fpWorld = XRSimWorld(XRLiveRuntimeSession(rotJson), rotJson)
    fpWorld.run(2)
    val fpRig = CharacterController.cameraRig(fpWorld)!!
    assertEquals(90.0, fpRig.phiDeg, 1e-4)
    assertEquals(0.05, fpRig.distance, 1e-4)
    assertEquals(-90.0, fpRig.thetaDeg, 1e-2)
    assertTrue(fpWorld.bodies[0].viewHidden)

    val orbit = OrbitCameraState()
    orbit.setBounds(doubleArrayOf(0.0, 0.0, 0.0), 10.0)
    orbit.follow(fpRig.target)
    orbit.frameFollow(fpRig.phiDeg, fpRig.distance, fpRig.thetaDeg)
    orbit.snap()
    assertEquals(0.0, Math.toDegrees(orbit.phi), 1e-3)
    assertEquals(0.05, orbit.distance, 1e-4)
    assertEquals(-90.0, Math.toDegrees(orbit.theta), 1e-2)
    orbit.follow(null)
    orbit.snap()
    assertTrue("follow(null) restores scene orbit distance", orbit.distance > 10.0)

    fpWorld.characterMode = "none"
    fpWorld.run(2)
    assertFalse("character-controller=none restores viewHidden", fpWorld.bodies[0].viewHidden)
  }
}
