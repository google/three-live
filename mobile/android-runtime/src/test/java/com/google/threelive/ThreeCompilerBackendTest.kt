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

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ThreeCompilerBackendTest {

  private class FakeHostBackend : ThreeCompilerBackend {
    val calls = mutableListOf<String>()

    override suspend fun compileToGlb(script: String): ByteArray {
      calls.add("glb:$script")
      return byteArrayOf(0x67, 0x6C, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0)
    }

    override suspend fun compileToUsdz(script: String): ByteArray {
      calls.add("usdz:$script")
      return byteArrayOf(0x50, 0x4B, 0x03, 0x04)
    }

    override suspend fun glbToUsdz(glbBytes: ByteArray): ByteArray {
      calls.add("glbToUsdz:${glbBytes.size}")
      return byteArrayOf(0x50, 0x4B, 0x03, 0x04, glbBytes.size.toByte())
    }

    override suspend fun aiCall(requestJson: String, usesEngine: Boolean): String {
      calls.add("ai:$usesEngine:$requestJson")
      return """{"ok":true,"usesEngine":$usesEngine}"""
    }
  }

  @After
  fun tearDown() {
    ThreeCompiler.setBackend(null)
  }

  @Test
  fun customBackendHandlesGlbUsdzAndAiWithoutNativeLibrary() = runBlocking {
    val backend = FakeHostBackend()
    ThreeCompiler.setBackend(backend)
    assertSame(backend, ThreeCompiler.getBackend())

    ThreeCompiler.compile("const m = 1;").use { glbBuf ->
      assertTrue("GlbBuffer.byteBuffer must be direct for Filament", glbBuf.byteBuffer.isDirect)
      assertEquals(12, glbBuf.size)
      val bytes = glbBuf.toByteArray()
      assertEquals('g'.code.toByte(), bytes[0])
      assertEquals('l'.code.toByte(), bytes[1])
      assertEquals('T'.code.toByte(), bytes[2])
      assertEquals('F'.code.toByte(), bytes[3])
    }

    val glbBytes = ThreeCompiler.compileToBytes("const m = 2;")
    assertEquals(12, glbBytes.size)

    val usdzBytes = ThreeCompiler.compileToUsdz("const m = 3;")
    assertArrayEquals(byteArrayOf(0x50, 0x4B, 0x03, 0x04), usdzBytes)

    val converted = ThreeCompiler.glbToUsdz(glbBytes)
    assertArrayEquals(byteArrayOf(0x50, 0x4B, 0x03, 0x04, 12), converted)

    val aiEngine = ThreeCompiler.aiCall("""{"op":"validate"}""")
    assertEquals("""{"ok":true,"usesEngine":true}""", aiEngine)

    val aiPure = ThreeCompiler.aiCallPure("""{"op":"describe"}""")
    assertEquals("""{"ok":true,"usesEngine":false}""", aiPure)

    assertEquals(
      listOf(
        "glb:const m = 1;",
        "glb:const m = 2;",
        "usdz:const m = 3;",
        "glbToUsdz:12",
        """ai:true:{"op":"validate"}""",
        """ai:false:{"op":"describe"}""",
      ),
      backend.calls,
    )
  }

  @Test
  fun capabilitiesBlockScriptCompilationBeforeReachingCustomBackend() = runBlocking {
    val backend = FakeHostBackend()
    ThreeCompiler.setBackend(backend)
    val noScripts = ThreeLiveCapabilities(scripts = false)
    val deniedFeatures = mutableListOf<String>()

    for (op in
      listOf<suspend () -> Any>(
        { ThreeCompiler.compile("1+1", noScripts) { deniedFeatures.add(it.feature) } },
        { ThreeCompiler.compileToBytes("1+1", noScripts) { deniedFeatures.add(it.feature) } },
        { ThreeCompiler.compileToUsdz("1+1", noScripts) { deniedFeatures.add(it.feature) } },
      )) {
      try {
        op()
        fail("Expected ThreeCompilerException when scripts capability is disabled")
      } catch (e: ThreeCompilerException) {
        assertTrue(e.message?.contains("scripts") == true)
      }
    }

    assertEquals(listOf("compile", "compile", "compile"), deniedFeatures)
    assertTrue("Backend must never be invoked when capability check fails", backend.calls.isEmpty())
  }

  @Test
  fun clearingCustomBackendInPureRuntimeReportsActionableConfigurationError() = runBlocking {
    ThreeCompiler.setBackend(null)
    try {
      ThreeCompiler.compileToBytes("scene.add(new THREE.Mesh());")
      fail("Expected ThreeCompilerException without backend or native lib")
    } catch (e: ThreeCompilerException) {
      assertTrue(
        "Expected actionable error naming libthree_live_compiler: ${e.message}",
        e.message?.contains("libthree_live_compiler") == true,
      )
    }
  }
}
