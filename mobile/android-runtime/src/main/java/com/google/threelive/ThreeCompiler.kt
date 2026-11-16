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

/** Exception thrown when procedural Three.js scene compilation fails. */
class ThreeCompilerException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Pluggable compiler backend SPI for `ThreeCompiler`.
 *
 * Host applications that already embed a JavaScript engine (such as Boa, QuickJS, or V8) can link
 * `com.google.threelive:runtime` + `com.google.threelive:kernels` (without pulling in a second JS
 * engine) and register a custom [ThreeCompilerBackend] via [ThreeCompiler.setBackend] backed by
 * `three-live-compiler-bundle.min.js`.
 *
 * Standalone applications that depend on `com.google.threelive:compiler` automatically use
 * `NativeThreeCompilerBackend` with zero configuration.
 */
interface ThreeCompilerBackend {
  /** Compiles a Three.js scene script into binary GLB wire bytes. */
  @Throws(ThreeCompilerException::class) suspend fun compileToGlb(script: String): ByteArray

  /**
   * Compiles a Three.js scene script into an [AutoCloseable] [GlbBuffer] suitable for native
   * renderers such as Filament.
   *
   * Defaults to wrapping [compileToGlb] in a JVM-managed direct [ByteBuffer] so host JS backends
   * only need to implement byte-array operations, while `NativeThreeCompilerBackend` overrides this
   * with zero-copy native heap allocation.
   */
  @Throws(ThreeCompilerException::class)
  suspend fun compileToGlbBuffer(script: String): GlbBuffer =
    GlbBuffer.fromByteArray(compileToGlb(script))

  /** Compiles a Three.js scene script into an Apple 64-byte aligned binary USDZ archive. */
  @Throws(ThreeCompilerException::class) suspend fun compileToUsdz(script: String): ByteArray

  /** Transcodes binary GLB wire bytes into an Apple 64-byte aligned binary USDZ archive. */
  @Throws(ThreeCompilerException::class) suspend fun glbToUsdz(glbBytes: ByteArray): ByteArray

  /**
   * Executes one AI scene-editing, selection, texture, or voice JSON protocol request.
   *
   * Always returns a JSON string (`{"error": ...}` on invalid input).
   *
   * @param requestJson JSON request payload (`{"op": ...}`).
   * @param usesEngine `true` when the operation evaluates a scene script (`validate`, `select`,
   *   `texture_requests`, etc.); `false` for pure prompt/parse helpers.
   */
  suspend fun aiCall(requestJson: String, usesEngine: Boolean = true): String
}

/** Optional marker implemented by `NativeThreeCompilerBackend` to expose JNI load status. */
interface NativeLibraryBackedCompiler {
  val isNativeLibraryLoaded: Boolean
}

/**
 * Encapsulates a zero-copy direct memory buffer containing binary GLB data.
 *
 * Implements [AutoCloseable] so developers can use Kotlin's [use] block to guarantee prompt native
 * memory release when backed by native heap memory.
 */
class GlbBuffer
internal constructor(
  /**
   * The direct [ByteBuffer] view of the allocation.
   *
   * > **Warning:** Once [close] runs on a native-owned buffer, the memory is freed and any retained
   * > reference to this [ByteBuffer] dangles. Never let a reference to it outlive [GlbBuffer].
   */
  val byteBuffer: ByteBuffer,
  /** Native heap address of the allocation, or `0` when backed by a JVM-managed direct buffer. */
  val address: Long,
  /** Size of the allocation in bytes. */
  val capacity: Long,
  /** Deallocation hook invoked at most once on [close] when `address != 0L`. */
  private val freeNative: (Long, Long) -> Unit = { _, _ -> },
) : AutoCloseable {

  /** Total size of the binary GLB buffer in bytes. */
  val size: Int
    get() = capacity.toInt()

  @Volatile private var isClosed = false

  private val tracked = GlbBufferLeakDetector.track(this, address, capacity, freeNative)

  /** Deallocates any native heap memory. Safe to call multiple times and from any thread. */
  override fun close() {
    if (isClosed) return
    synchronized(this) {
      if (isClosed) return
      isClosed = true
      GlbBufferLeakDetector.untrack(tracked)
      if (address != 0L && capacity > 0L) {
        freeNative(address, capacity)
      }
    }
  }

  /**
   * Creates a copy of the GLB wire bytes into a standard JVM heap [ByteArray].
   *
   * @throws IllegalStateException if the buffer has already been closed.
   */
  fun toByteArray(): ByteArray =
    synchronized(this) {
      check(!isClosed) { "Cannot read from closed GlbBuffer" }
      val duplicate = byteBuffer.duplicate()
      duplicate.clear()
      val bytes = ByteArray(duplicate.remaining())
      duplicate.get(bytes)
      bytes
    }

  /**
   * Writes the GLB wire bytes to [targetFile] atomically while holding the buffer monitor so
   * [close] cannot race with the file write.
   *
   * @throws IllegalStateException if the buffer has already been closed.
   */
  fun writeToFile(targetFile: java.io.File): java.io.File =
    synchronized(this) {
      check(!isClosed) { "Cannot read from closed GlbBuffer" }
      val parentDir = targetFile.parentFile
      parentDir?.mkdirs()
      val tempFile =
        java.io.File.createTempFile(
          ".${targetFile.name}.",
          ".tmp",
          parentDir ?: targetFile.absoluteFile.parentFile,
        )
      try {
        val duplicate = byteBuffer.duplicate()
        duplicate.clear()
        java.io.FileOutputStream(tempFile).use { fos ->
          val channel = fos.channel
          while (duplicate.hasRemaining()) {
            channel.write(duplicate)
          }
        }
        if (!tempFile.renameTo(targetFile)) {
          tempFile.copyTo(targetFile, overwrite = true)
          tempFile.delete()
        }
      } catch (t: Throwable) {
        tempFile.delete()
        throw t
      }
      targetFile
    }

  companion object {
    /**
     * Wraps a JVM [ByteArray] in a direct [ByteBuffer]-backed [GlbBuffer] for custom
     * [ThreeCompilerBackend] implementations.
     */
    @JvmStatic
    fun fromByteArray(bytes: ByteArray): GlbBuffer {
      if (bytes.isEmpty()) {
        throw ThreeCompilerException("Compilation produced empty GLB output")
      }
      val direct = ByteBuffer.allocateDirect(bytes.size)
      direct.put(bytes)
      direct.flip()
      return GlbBuffer(direct, 0L, bytes.size.toLong())
    }

    /** Constructs a native-owned [GlbBuffer] with an explicit deallocation callback. */
    @JvmStatic
    fun fromNativeDirectBuffer(
      byteBuffer: ByteBuffer,
      address: Long,
      capacity: Long,
      freeNative: (Long, Long) -> Unit,
    ): GlbBuffer = GlbBuffer(byteBuffer, address, capacity, freeNative)
  }
}

/**
 * Facade for compiling procedural Three.js scripts into `.glb` / `.usdz` assets and running AI
 * scene-editing protocol operations via the active [ThreeCompilerBackend].
 */
object ThreeCompiler {

  private val lock = Any()
  @Volatile private var customBackend: ThreeCompilerBackend? = null
  @Volatile private var defaultBackendResolved = false
  @Volatile private var discoveredDefaultBackend: ThreeCompilerBackend? = null

  /**
   * Whether `libthree_live_compiler` was loaded by `NativeThreeCompilerBackend`, or `false` when
   * running with only `runtime` or in host-side JVM unit tests without native libraries.
   */
  @JvmStatic
  val isNativeLibraryLoaded: Boolean
    get() = (getBackend() as? NativeLibraryBackedCompiler)?.isNativeLibraryLoaded == true

  /**
   * Installs a custom [ThreeCompilerBackend] (or `null` to restore the default
   * `NativeThreeCompilerBackend` if `com.google.threelive:compiler` is on the classpath).
   */
  @JvmStatic
  fun setBackend(backend: ThreeCompilerBackend?) {
    synchronized(lock) { customBackend = backend }
  }

  /** Returns the currently active [ThreeCompilerBackend], or `null` if none is available. */
  @JvmStatic
  fun getBackend(): ThreeCompilerBackend? {
    customBackend?.let {
      return it
    }
    if (defaultBackendResolved) {
      return discoveredDefaultBackend
    }
    synchronized(lock) {
      customBackend?.let {
        return it
      }
      if (!defaultBackendResolved) {
        discoveredDefaultBackend = discoverNativeBackend()
        defaultBackendResolved = true
      }
      return discoveredDefaultBackend
    }
  }

  private fun discoverNativeBackend(): ThreeCompilerBackend? =
    try {
      val cls = Class.forName("com.google.threelive.NativeThreeCompilerBackend")
      val instanceField = cls.getDeclaredField("INSTANCE")
      instanceField.get(null) as? ThreeCompilerBackend
    } catch (_: ClassNotFoundException) {
      null
    } catch (_: Throwable) {
      null
    }

  private fun requireBackend(): ThreeCompilerBackend =
    getBackend()
      ?: throw ThreeCompilerException(
        "No ThreeCompilerBackend is installed and libthree_live_compiler is not on the classpath. " +
          "Either depend on 'com.google.threelive:compiler' for the built-in Rust+Boa backend, " +
          "or register your host JS engine via ThreeCompiler.setBackend(...)."
      )

  /**
   * Compiles a Three.js script into an [AutoCloseable] [GlbBuffer] using the active
   * [ThreeCompilerBackend].
   */
  suspend fun compile(
    script: String,
    capabilities: ThreeLiveCapabilities? = null,
    onCapabilityDenied: CapabilityDeniedListener? = null,
  ): GlbBuffer {
    requireScriptsCapability(capabilities, onCapabilityDenied)
    return requireBackend().compileToGlbBuffer(script)
  }

  /** Compiles a Three.js script into a standard [ByteArray] containing binary `.glb` wire bytes. */
  suspend fun compileToBytes(
    script: String,
    capabilities: ThreeLiveCapabilities? = null,
    onCapabilityDenied: CapabilityDeniedListener? = null,
  ): ByteArray {
    requireScriptsCapability(capabilities, onCapabilityDenied)
    return requireBackend().compileToGlb(script)
  }

  /** Compiles a Three.js script into an Apple 64-byte aligned binary `.usdz` archive. */
  suspend fun compileToUsdz(
    script: String,
    capabilities: ThreeLiveCapabilities? = null,
    onCapabilityDenied: CapabilityDeniedListener? = null,
  ): ByteArray {
    requireScriptsCapability(capabilities, onCapabilityDenied)
    return requireBackend().compileToUsdz(script)
  }

  /** Transcodes binary `.glb` wire bytes into an Apple 64-byte aligned binary `.usdz` archive. */
  suspend fun glbToUsdz(glbBytes: ByteArray): ByteArray = requireBackend().glbToUsdz(glbBytes)

  private fun requireScriptsCapability(
    capabilities: ThreeLiveCapabilities?,
    onCapabilityDenied: CapabilityDeniedListener?,
  ) {
    val policy = capabilities ?: ThreeLiveCapabilities.default
    if (!policy.check(ThreeLiveCapability.SCRIPTS, "compile", listener = onCapabilityDenied)) {
      throw ThreeCompilerException("Capability 'scripts' is disabled in ThreeLiveCapabilities.")
    }
  }

  /** Runs an AI core request that evaluates scripts (`validate`, `select`, etc.). */
  suspend fun aiCall(request: String): String = requireBackend().aiCall(request, usesEngine = true)

  /** Runs a pure AI core request (prompts, reply parsing, voice protocol). */
  suspend fun aiCallPure(request: String): String =
    requireBackend().aiCall(request, usesEngine = false)

  /**
   * Synchronous blocking wrapper for Java callers or background worker threads; prefer suspend
   * [compile].
   */
  @Deprecated("Prefer suspend ThreeCompiler.compile(script)", ReplaceWith("compile(script)"))
  @JvmStatic
  @Throws(ThreeCompilerException::class)
  fun compileToDirectBuffer(script: String): GlbBuffer =
    kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.Default) { compile(script) }

  /**
   * Synchronous blocking wrapper for Java callers or background worker threads; prefer suspend
   * [compileToBytes].
   */
  @Deprecated(
    "Prefer suspend ThreeCompiler.compileToBytes(script)",
    ReplaceWith("compileToBytes(script)"),
  )
  @JvmStatic
  @Throws(ThreeCompilerException::class)
  fun compileToByteArray(script: String): ByteArray =
    kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.Default) {
      compileToBytes(script)
    }
}
