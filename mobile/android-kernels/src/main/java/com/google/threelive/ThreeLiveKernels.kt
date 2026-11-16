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

/**
 * Loader and C-ABI table accessor for `libthree_live_kernels.so` (`com.google.threelive:kernels`).
 *
 * Host applications that embed their own native JS engine (Boa, QuickJS, V8) can call
 * [ensureLoaded] and pass [tableAddress] (`const ThreeLiveKernelDescriptor*`) + [kernelCount] to
 * their native JNI layer (or link against `libthree_live_kernels.so` directly via `dlopen` /
 * `dlsym("three_live_kernels_table")`). Contains **zero** `boa_engine` symbols.
 */
object ThreeLiveKernels {

  const val ABI_VERSION: Int = 1

  @JvmStatic
  var isLoaded: Boolean = false
    private set

  init {
    try {
      System.loadLibrary("three_live_kernels")
      isLoaded = true
    } catch (_: UnsatisfiedLinkError) {
      // Expected in host-side JVM unit tests where native JNI libraries are absent.
    }
  }

  /** Ensures `libthree_live_kernels.so` is loaded and returns `true` if available. */
  @JvmStatic fun ensureLoaded(): Boolean = isLoaded

  /** Returns `THREE_LIVE_KERNELS_ABI_VERSION` (`1`) when loaded, or `0` when unavailable. */
  @JvmStatic fun abiVersion(): Int = if (isLoaded) nativeAbiVersion() else 0

  /** Returns the number of entries in `three_live_kernels_table` when loaded, or `0` otherwise. */
  @JvmStatic fun kernelCount(): Int = if (isLoaded) nativeKernelCount() else 0

  /**
   * Returns the process-virtual address of the static `ThreeLiveKernelDescriptor` array
   * (`three_live_kernels.h`), or `0L` when `libthree_live_kernels.so` is not loaded.
   */
  @JvmStatic fun tableAddress(): Long = if (isLoaded) nativeTableAddress() else 0L

  @JvmStatic external fun nativeAbiVersion(): Int

  @JvmStatic external fun nativeKernelCount(): Int

  @JvmStatic external fun nativeTableAddress(): Long
}
