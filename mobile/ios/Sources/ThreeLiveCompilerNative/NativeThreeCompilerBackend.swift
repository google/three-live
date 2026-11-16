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
import ThreeLiveCompilerC
import ThreeLiveRuntime

/// Default zero-copy `ThreeCompilerBackend` backed by `ThreeLiveCompiler.xcframework` (Rust + Boa).
///
/// Automatically discovered by `ThreeCompiler` whenever `ThreeLiveCompiler` or
/// `ThreeLiveCompilerNative` is linked into the host binary.
public final class NativeThreeCompilerBackend: ThreeCompilerBackend, @unchecked Sendable {
  public static let shared = NativeThreeCompilerBackend()

  public init() {}

  public func compileToGLBSync(_ script: String) throws -> Data {
    let cScript = try ThreeCompiler.validateNullFreeUTF8(script)
    return try ThreeCompiler.performOnCompilerThread {
      let result = cScript.withUnsafeBufferPointer { ptr in
        three_live_compile(ptr.baseAddress)
      }
      return try Self.takeOwnership(of: result, operation: "compile")
    }
  }

  public func compileToUSDZSync(_ script: String) throws -> Data {
    let cScript = try ThreeCompiler.validateNullFreeUTF8(script)
    return try ThreeCompiler.performOnCompilerThread {
      let result = cScript.withUnsafeBufferPointer { ptr in
        three_live_compile_usdz(ptr.baseAddress)
      }
      return try Self.takeOwnership(of: result, operation: "compileUSDZ")
    }
  }

  public func glbToUSDZSync(_ glbData: Data) throws -> Data {
    guard !glbData.isEmpty else {
      throw ThreeCompilerError.compilationFailed("Null or empty GLB data provided")
    }
    return try ThreeCompiler.performOnCompilerThread {
      let result = glbData.withUnsafeBytes { rawBuffer -> ThreeLiveBuffer in
        guard let baseAddr = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
          return ThreeLiveBuffer(data: nil, len: 0, capacity: 0, error_msg: nil)
        }
        return three_live_glb_to_usdz(baseAddr, rawBuffer.count)
      }
      return try Self.takeOwnership(of: result, operation: "glbToUSDZ")
    }
  }

  public func aiCall(_ request: String, onCompilerThread: Bool) async throws -> String {
    let cRequest = try ThreeCompiler.validateNullFreeUTF8(request)
    let work: @Sendable () -> String = {
      let ptr = cRequest.withUnsafeBufferPointer { three_live_ai_call($0.baseAddress) }
      guard let ptr = ptr else { return "{\"error\":\"null response\"}" }
      defer { three_live_free_string(ptr) }
      return String(cString: ptr)
    }
    if onCompilerThread {
      return try await ThreeCompiler.offloadToCompilerThread(work)
    }
    return work()
  }

  /// Takes ownership of a native `ThreeLiveBuffer`, converting it into a zero-copy `Data`.
  private static func takeOwnership(
    of result: ThreeLiveBuffer,
    operation: String
  ) throws -> Data {
    if let errPtr = result.error_msg {
      let errorMsg = String(cString: errPtr)
      three_live_free_error(errPtr)
      if let dataPtr = result.data {
        three_live_free_buffer(dataPtr, result.capacity)
      }
      throw ThreeCompilerError.compilationFailed(errorMsg)
    }

    guard let dataPtr = result.data else {
      throw ThreeCompilerError.emptyResult(operation)
    }

    let capacity = result.capacity
    guard result.len > 0 else {
      three_live_free_buffer(dataPtr, capacity)
      throw ThreeCompilerError.emptyResult(operation)
    }

    return Data(
      bytesNoCopy: dataPtr,
      count: result.len,
      deallocator: .custom { (rawPtr, _) in
        three_live_free_buffer(rawPtr.bindMemory(to: UInt8.self, capacity: capacity), capacity)
      }
    )
  }
}

/// Objective-C runtime discovery registrar so `ThreeCompiler` automatically picks up
/// `NativeThreeCompilerBackend.shared` when `ThreeLiveCompiler` is linked.
@objc(ThreeLiveNativeCompilerBackendRegistrar)
public final class NativeThreeCompilerBackendRegistrar: NSObject, ThreeLiveDefaultBackendProvider {
  @objc public static func createDefaultThreeCompilerBackend() -> Any {
    NativeThreeCompilerBackend.shared
  }
}
