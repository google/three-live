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
import ThreeLiveKernels
import ThreeLiveRuntime
import XCTest

/// Verifies `ThreeLiveRuntime` + `ThreeLiveKernels` linked *without* `ThreeLiveCompiler` (zero Boa
/// JS engine linked into the test binary).
final class ThreeLiveKernelsTests: XCTestCase {

  private final class HostStubBackend: ThreeCompilerBackend, @unchecked Sendable {
    func compileToGLBSync(_ script: String) throws -> Data {
      Data([0x67, 0x6C, 0x54, 0x46, UInt8(script.utf8.count & 0xFF), 0, 0, 0])
    }

    func compileToUSDZSync(_ script: String) throws -> Data {
      Data([0x50, 0x4B, 0x03, 0x04, UInt8(script.utf8.count & 0xFF), 0, 0, 0])
    }

    func glbToUSDZSync(_ glbData: Data) throws -> Data {
      Data([0x50, 0x4B, 0x03, 0x04, UInt8(glbData.count & 0xFF), 0, 0, 0])
    }

    func aiCall(_ request: String, onCompilerThread: Bool) async throws -> String {
      "{\"ok\":true,\"len\":\(request.utf8.count)}"
    }
  }

  func testRuntimeWithoutNativeCompilerFailsCleanlyUntilBackendRegistered() async throws {
    ThreeCompiler.setBackend(nil)
    XCTAssertNil(
      ThreeCompiler.backend,
      "When ThreeLiveCompiler is not linked, ThreeCompiler.backend must be nil until setBackend"
    )

    do {
      _ = try await ThreeCompiler.compile("const x = 1;")
      XCTFail("Expected missing backend diagnostic when ThreeLiveCompiler is not linked")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let msg) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertTrue(msg.contains("setBackend"), "Unexpected diagnostic: \(msg)")
    }

    ThreeCompiler.setBackend(HostStubBackend())
    defer { ThreeCompiler.setBackend(nil) }

    let glb = try await ThreeCompiler.compile("const x = 1;")
    XCTAssertEqual(Array(glb.prefix(4)), [0x67, 0x6C, 0x54, 0x46])
  }

  func testKernelsCAbiTableAndUniformBoxInvocation() throws {
    XCTAssertEqual(ThreeLiveKernels.abiVersion, UInt32(THREE_LIVE_KERNELS_ABI_VERSION))
    XCTAssertEqual(ThreeLiveKernels.kernelCount, 24)

    let boxDesc = try XCTUnwrap(ThreeLiveKernels.descriptor(named: "box"))
    let invokeFn = try XCTUnwrap(boxDesc.invoke)

    let scalars: [Double] = [2.0, 3.0, 4.0]
    let out = scalars.withUnsafeBufferPointer { scalarBuf -> ThreeLiveKernelBuffer in
      invokeFn(scalarBuf.baseAddress, scalarBuf.count, nil, 0)
    }
    defer {
      three_live_kernel_free(out.data, out.capacity)
    }

    XCTAssertEqual(out.status, UInt32(THREE_LIVE_KERNEL_OK))
    let dataPtr = try XCTUnwrap(out.data)
    XCTAssertGreaterThan(out.len, 16)

    // Header: [pos_f32_len:u32, norm_f32_len:u32, uv_f32_len:u32, idx_u32_len:u32].
    // `out.data` is a 1-byte aligned `uint8_t*`, so use `loadUnaligned` rather than
    // `assumingMemoryBound(to: UInt32.self)`.
    let raw = UnsafeRawPointer(dataPtr)
    XCTAssertEqual(UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: 0, as: UInt32.self)), 72)
    XCTAssertEqual(UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: 4, as: UInt32.self)), 72)
    XCTAssertEqual(UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: 8, as: UInt32.self)), 48)
    XCTAssertEqual(UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: 12, as: UInt32.self)), 36)
  }
}
