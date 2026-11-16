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

import Foundation
@_exported import ThreeLiveKernelsC

/// Boa-free native geometry, CSG, procedural texture, PNG/DEFLATE, UTF-8, and USDZ kernels
/// (`THREE_LIVE_KERNELS_ABI_VERSION == 1`) for host apps that run `three-live-compiler-bundle.min.js`
/// inside their own JavaScript engine.
public enum ThreeLiveKernels {
  /// Returns the ABI version implemented by the linked `ThreeLiveKernels` library (`1`).
  public static var abiVersion: UInt32 {
    three_live_kernels_abi_version()
  }

  /// Returns the static kernel descriptor table for generic host JS registration loops.
  public static func descriptors() -> UnsafeBufferPointer<ThreeLiveKernelDescriptor> {
    var count: Int = 0
    guard let base = three_live_kernels_table(&count), count > 0 else {
      return UnsafeBufferPointer(start: nil, count: 0)
    }
    return UnsafeBufferPointer(start: base, count: count)
  }

  /// Number of native kernels registered in `three_live_kernels_table`.
  public static var kernelCount: Int {
    descriptors().count
  }

  /// Looks up a kernel descriptor by its `__three_live_host__` method name (e.g. `"box"`).
  public static func descriptor(named name: String) -> ThreeLiveKernelDescriptor? {
    for desc in descriptors() {
      guard let cName = desc.name else { continue }
      if String(cString: cName) == name {
        return desc
      }
    }
    return nil
  }
}
