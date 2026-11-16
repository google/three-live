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
import org.junit.Test

class ThreeLiveKernelsTest {

  @Test
  fun hostJvmWithoutJniReturnsCleanZeroFallbacks() {
    assertEquals(1, ThreeLiveKernels.ABI_VERSION)
    assertFalse(ThreeLiveKernels.ensureLoaded())
    assertEquals(0, ThreeLiveKernels.abiVersion())
    assertEquals(0, ThreeLiveKernels.kernelCount())
    assertEquals(0L, ThreeLiveKernels.tableAddress())
  }
}
