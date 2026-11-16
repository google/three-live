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

import java.nio.ByteBuffer
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.withContext

/**
 * Default JNI-backed [ThreeCompilerBackend] shipped in `com.google.threelive:compiler`
 * (`libthree_live_compiler.so`, Rust + Boa).
 *
 * Automatically discovered by [ThreeCompiler] when `com.google.threelive:compiler` is on the
 * runtime classpath.
 */
object NativeThreeCompilerBackend : ThreeCompilerBackend, NativeLibraryBackedCompiler {

  override var isNativeLibraryLoaded: Boolean = false
    private set

  @OptIn(ExperimentalCoroutinesApi::class)
  private val compilerDispatcher: CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1)

  init {
    try {
      System.loadLibrary("three_live_compiler")
      isNativeLibraryLoaded = true
    } catch (e: UnsatisfiedLinkError) {
      System.err.println(
        "NativeThreeCompilerBackend: Native library libthree_live_compiler not found on library path: ${e.message}"
      )
    }
  }

  @JvmStatic
  @Throws(ThreeCompilerException::class)
  external fun nativeCompileToDirectBuffer(script: String): ByteBuffer

  @JvmStatic
  @Throws(ThreeCompilerException::class)
  external fun nativeCompileToByteArray(script: String): ByteArray

  @JvmStatic
  @Throws(ThreeCompilerException::class)
  external fun nativeCompileToUsdz(script: String): ByteArray

  @JvmStatic
  @Throws(ThreeCompilerException::class)
  external fun nativeGlbToUsdz(glbBytes: ByteArray): ByteArray

  @JvmStatic external fun nativeFreeDirectBuffer(address: Long, capacity: Long)

  @JvmStatic external fun nativeGetDirectBufferAddress(buffer: ByteBuffer): Long

  @JvmStatic external fun nativeAiCall(request: String): String

  override suspend fun compileToGlbBuffer(script: String): GlbBuffer =
    withContext(compilerDispatcher) {
      checkNativeLibraryLoaded()
      val buffer = nativeCompileToDirectBuffer(script)
      val capacity = buffer.capacity().toLong()
      GlbBuffer.fromNativeDirectBuffer(
        buffer,
        extractDirectAddress(buffer),
        capacity,
        NativeThreeCompilerBackend::nativeFreeDirectBuffer,
      )
    }

  override suspend fun compileToGlb(script: String): ByteArray =
    withContext(compilerDispatcher) {
      checkNativeLibraryLoaded()
      nativeCompileToByteArray(script)
    }

  override suspend fun compileToUsdz(script: String): ByteArray =
    withContext(compilerDispatcher) {
      checkNativeLibraryLoaded()
      nativeCompileToUsdz(script)
    }

  override suspend fun glbToUsdz(glbBytes: ByteArray): ByteArray =
    withContext(compilerDispatcher) {
      checkNativeLibraryLoaded()
      nativeGlbToUsdz(glbBytes)
    }

  override suspend fun aiCall(requestJson: String, usesEngine: Boolean): String {
    val dispatcher = if (usesEngine) compilerDispatcher else Dispatchers.Default
    return withContext(dispatcher) {
      checkNativeLibraryLoaded()
      nativeAiCall(requestJson)
    }
  }

  private fun checkNativeLibraryLoaded() {
    if (!isNativeLibraryLoaded) {
      throw ThreeCompilerException(
        "libthree_live_compiler is not loaded. Ensure the AAR ships a .so for this device's ABI " +
          "(arm64-v8a, armeabi-v7a, x86_64) and that it was not stripped by packaging."
      )
    }
  }

  private fun extractDirectAddress(buffer: ByteBuffer): Long {
    val address =
      if (!buffer.isDirect) {
        0L
      } else {
        try {
          nativeGetDirectBufferAddress(buffer)
        } catch (e: UnsatisfiedLinkError) {
          throw ThreeCompilerException("Failed to resolve direct buffer address", e)
        }
      }
    if (address == 0L) {
      throw ThreeCompilerException(
        "Compiler returned a buffer with no resolvable native address " +
          "(isDirect=${buffer.isDirect}); refusing to return a buffer that can never be freed."
      )
    }
    return address
  }
}
