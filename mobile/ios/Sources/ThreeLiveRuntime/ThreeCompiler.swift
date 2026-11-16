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

import Dispatch
import Foundation

/// Errors thrown by the ThreeLive compiler.
public enum ThreeCompilerError: Error, LocalizedError, Equatable {
  /// The native or host compiler reported a failure. The payload is the compiler diagnostic.
  case compilationFailed(String)

  /// The supplied script cannot be passed across the C boundary. The payload explains why.
  case invalidScript(String)

  /// The compiler reported success but produced no bytes.
  case emptyResult(String)

  public var errorDescription: String? {
    switch self {
    case .compilationFailed(let message):
      return "Three.js compilation failed: \(message)"
    case .invalidScript(let reason):
      return "Script could not be passed to the native compiler: \(reason)"
    case .emptyResult(let operation):
      return "Native compiler returned an empty buffer from \(operation)"
    }
  }
}

/// Pluggable compiler backend SPI for `ThreeCompiler`.
///
/// Host applications that already embed a JavaScript engine (such as Boa, JavaScriptCore, or
/// QuickJS) can depend on `ThreeLiveRuntime` + `ThreeLiveKernels` (without linking a second Boa
/// JavaScript engine) and register a custom `ThreeCompilerBackend` via
/// `ThreeCompiler.setBackend(_:)` backed by `three-live-compiler-bundle.min.js`.
///
/// Standalone applications that depend on `ThreeLiveCompiler` automatically use
/// `NativeThreeCompilerBackend` with zero configuration.
public protocol ThreeCompilerBackend: Sendable {
  /// Synchronously compiles a Three.js scene script into binary GLB `Data`.
  func compileToGLBSync(_ script: String) throws -> Data

  /// Asynchronously compiles a Three.js scene script into binary GLB `Data`.
  func compileToGLB(_ script: String) async throws -> Data

  /// Synchronously compiles a Three.js scene script into 64-byte aligned binary USDZ `Data`.
  func compileToUSDZSync(_ script: String) throws -> Data

  /// Asynchronously compiles a Three.js scene script into 64-byte aligned binary USDZ `Data`.
  func compileToUSDZ(_ script: String) async throws -> Data

  /// Synchronously transcodes binary GLB `Data` into 64-byte aligned binary USDZ `Data`.
  func glbToUSDZSync(_ glbData: Data) throws -> Data

  /// Asynchronously transcodes binary GLB `Data` into 64-byte aligned binary USDZ `Data`.
  func glbToUSDZ(_ glbData: Data) async throws -> Data

  /// Executes one AI scene-editing / selection / texture / voice JSON protocol request.
  ///
  /// Always returns a JSON string (`{"error": ...}` on invalid input).
  func aiCall(_ request: String, onCompilerThread: Bool) async throws -> String
}

extension ThreeCompilerBackend {
  public func compileToGLB(_ script: String) async throws -> Data {
    try await ThreeCompiler.offloadToCompilerThread {
      try compileToGLBSync(script)
    }
  }

  public func compileToUSDZ(_ script: String) async throws -> Data {
    try await ThreeCompiler.offloadToCompilerThread {
      try compileToUSDZSync(script)
    }
  }

  public func glbToUSDZ(_ glbData: Data) async throws -> Data {
    try await ThreeCompiler.offloadToCompilerThread {
      try glbToUSDZSync(glbData)
    }
  }
}

/// Objective-C runtime discovery hook implemented by `ThreeLiveCompilerNative` so linking
/// `ThreeLiveCompiler` registers `NativeThreeCompilerBackend` automatically without forcing
/// `ThreeLiveRuntime` to depend on `ThreeLiveCompilerC`.
@objc(ThreeLiveDefaultBackendProvider)
public protocol ThreeLiveDefaultBackendProvider {
  static func createDefaultThreeCompilerBackend() -> Any
}

/// High-performance procedural Three.js to binary glTF 2.0 (GLB) and USDZ compiler
/// for iOS, visionOS, tvOS, and macOS.
public enum ThreeCompiler {

  /// Dedicated OS thread with an 8 MiB stack used to run blocking JS / native compilation.
  ///
  /// Blocking compilation must NOT run on Swift Concurrency's cooperative thread pool, which is
  /// width-limited to roughly the core count. In addition, Darwin's `DispatchQueue` and Swift
  /// Concurrency worker threads allocate only a 512 KiB stack, whereas JS parsers/evaluators (such
  /// as Boa) expect multi-megabyte stack headroom and thread-local engine reuse.
  private final class CompilerWorkerThread: @unchecked Sendable {
    static let shared = CompilerWorkerThread()

    private let condition = NSCondition()
    private var queue: [@Sendable () -> Void] = []
    private var workerThread: Thread?

    private init() {
      let thread = Thread { [weak self] in
        self?.runLoop()
      }
      thread.name = "com.google.threelive.compile"
      thread.qualityOfService = .userInitiated
      thread.stackSize = 8 * 1024 * 1024
      self.workerThread = thread
      thread.start()
    }

    var isCurrentThread: Bool {
      Thread.current === workerThread
    }

    func enqueue(_ job: @escaping @Sendable () -> Void) {
      condition.lock()
      queue.append(job)
      condition.signal()
      condition.unlock()
    }

    func performSync<T: Sendable>(_ work: @escaping @Sendable () throws -> T) throws -> T {
      if isCurrentThread {
        return try work()
      }
      let box = SyncResultBox<T>()
      enqueue {
        box.complete(with: Result(catching: work))
      }
      return try box.wait()
    }

    private func runLoop() {
      while true {
        let job: @Sendable () -> Void
        condition.lock()
        while queue.isEmpty {
          condition.wait()
        }
        job = queue.removeFirst()
        condition.unlock()
        autoreleasepool {
          job()
        }
      }
    }
  }

  private final class SyncResultBox<T>: @unchecked Sendable {
    private let condition = NSCondition()
    private var result: Result<T, Error>?

    func complete(with value: Result<T, Error>) {
      condition.lock()
      result = value
      condition.signal()
      condition.unlock()
    }

    func wait() throws -> T {
      condition.lock()
      while result == nil {
        condition.wait()
      }
      let r = result!
      condition.unlock()
      return try r.get()
    }
  }

  private final class BackendRegistry: @unchecked Sendable {
    static let shared = BackendRegistry()

    private let lock = NSLock()
    private var customBackend: (any ThreeCompilerBackend)?
    private var defaultDiscoveryEnabled = true
    private var defaultResolved = false
    private var discoveredDefaultBackend: (any ThreeCompilerBackend)?

    func setCustom(_ backend: (any ThreeCompilerBackend)?) {
      lock.lock()
      customBackend = backend
      lock.unlock()
    }

    func setDefaultDiscoveryEnabled(_ enabled: Bool) {
      lock.lock()
      defaultDiscoveryEnabled = enabled
      lock.unlock()
    }

    func current() -> (any ThreeCompilerBackend)? {
      lock.lock()
      defer { lock.unlock() }
      if let customBackend {
        return customBackend
      }
      guard defaultDiscoveryEnabled else {
        return nil
      }
      if !defaultResolved {
        discoveredDefaultBackend = Self.discoverDefaultBackend()
        defaultResolved = true
      }
      return discoveredDefaultBackend
    }

    private static func discoverDefaultBackend() -> (any ThreeCompilerBackend)? {
      guard
        let cls = NSClassFromString("ThreeLiveNativeCompilerBackendRegistrar")
          as? ThreeLiveDefaultBackendProvider.Type
      else {
        return nil
      }
      return cls.createDefaultThreeCompilerBackend() as? any ThreeCompilerBackend
    }
  }

  // MARK: - Backend management & worker thread utilities

  /// Installs a custom `ThreeCompilerBackend` (or `nil` to restore the default
  /// `NativeThreeCompilerBackend` when `ThreeLiveCompiler` is linked).
  public static func setBackend(_ backend: (any ThreeCompilerBackend)?) {
    BackendRegistry.shared.setCustom(backend)
  }

  /// Enables or disables Objective-C auto-discovery of `NativeThreeCompilerBackend` in tests
  /// (for example under `swift test`, which links all package `.testTarget`s into a single
  /// `.xctest` bundle even when an individual test target only depends on `ThreeLiveRuntime`).
  @_spi(Testing)
  public static func setDefaultBackendDiscoveryEnabled(_ enabled: Bool) {
    BackendRegistry.shared.setDefaultDiscoveryEnabled(enabled)
  }

  /// The currently active `ThreeCompilerBackend`, or `nil` when `ThreeLiveRuntime` is linked
  /// standalone and no custom backend has been installed via `setBackend(_:)`.
  public static var backend: (any ThreeCompilerBackend)? {
    BackendRegistry.shared.current()
  }

  /// Runs blocking compilation work synchronously on the dedicated 8 MiB stack compiler thread.
  public static func performOnCompilerThread<T: Sendable>(
    _ work: @escaping @Sendable () throws -> T
  ) throws -> T {
    try CompilerWorkerThread.shared.performSync(work)
  }

  /// Runs blocking compilation work asynchronously on the dedicated 8 MiB stack compiler thread
  /// without occupying Swift Concurrency's cooperative thread pool.
  public static func offloadToCompilerThread<T: Sendable>(
    _ work: @escaping @Sendable () throws -> T
  ) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      CompilerWorkerThread.shared.enqueue {
        continuation.resume(with: Result(catching: work))
      }
    }
  }

  /// Converts a Swift `String` into a NUL-terminated UTF-8 buffer suitable for C ABIs, rejecting
  /// embedded U+0000 scalars rather than silently truncating at the first NUL byte.
  public static func validateNullFreeUTF8(_ script: String) throws -> [CChar] {
    var bytes = Array(script.utf8)
    if let nullIndex = bytes.firstIndex(of: 0) {
      throw ThreeCompilerError.invalidScript(
        "script contains an embedded NUL byte at offset \(nullIndex), "
          + "which cannot be represented as a C string"
      )
    }
    bytes.append(0)
    return bytes.map { CChar(bitPattern: $0) }
  }

  private static func requireBackend() throws -> any ThreeCompilerBackend {
    if let resolved = BackendRegistry.shared.current() {
      return resolved
    }
    throw ThreeCompilerError.compilationFailed(
      "No ThreeCompilerBackend is installed and ThreeLiveCompilerNative is not linked. "
        + "Either link the 'ThreeLiveCompiler' product for the built-in Rust+Boa backend, "
        + "or register your host JS engine via ThreeCompiler.setBackend(...)."
    )
  }

  // MARK: - Asynchronous entry points

  /// Compiles a Three.js scene script into binary GLB `Data`.
  public static func compile(
    _ script: String,
    capabilities: ThreeLiveCapabilities? = nil,
    onCapabilityDenied: (@Sendable (CapabilityDeniedEvent) -> Void)? = nil
  ) async throws -> Data {
    try requireScriptsCapability(capabilities, onCapabilityDenied: onCapabilityDenied)
    _ = try validateNullFreeUTF8(script)
    return try await requireBackend().compileToGLB(script)
  }

  /// Convenience alias for `compile(_:)` matching `compileUSDZ(_:)`.
  public static func compileGLB(
    _ script: String,
    capabilities: ThreeLiveCapabilities? = nil,
    onCapabilityDenied: (@Sendable (CapabilityDeniedEvent) -> Void)? = nil
  ) async throws -> Data {
    try await compile(script, capabilities: capabilities, onCapabilityDenied: onCapabilityDenied)
  }

  /// Compiles a Three.js scene script into 64-byte aligned binary USDZ `Data`.
  public static func compileUSDZ(
    _ script: String,
    capabilities: ThreeLiveCapabilities? = nil,
    onCapabilityDenied: (@Sendable (CapabilityDeniedEvent) -> Void)? = nil
  ) async throws -> Data {
    try requireScriptsCapability(capabilities, onCapabilityDenied: onCapabilityDenied)
    _ = try validateNullFreeUTF8(script)
    return try await requireBackend().compileToUSDZ(script)
  }

  /// Transcodes binary GLB `Data` directly into 64-byte aligned binary USDZ `Data`.
  public static func glbToUSDZ(_ glbData: Data) async throws -> Data {
    guard !glbData.isEmpty else {
      throw ThreeCompilerError.compilationFailed("Null or empty GLB data provided")
    }
    return try await requireBackend().glbToUSDZ(glbData)
  }

  // MARK: - Synchronous entry points

  /// Synchronous compilation entry point. Safe to call from background threads.
  public static func compileSync(
    _ script: String,
    capabilities: ThreeLiveCapabilities? = nil,
    onCapabilityDenied: ((CapabilityDeniedEvent) -> Void)? = nil
  ) throws -> Data {
    try requireScriptsCapability(capabilities, onCapabilityDenied: onCapabilityDenied)
    _ = try validateNullFreeUTF8(script)
    return try requireBackend().compileToGLBSync(script)
  }

  /// Convenience alias for `compileSync(_:)` matching `compileUSDZSync(_:)`.
  public static func compileGLBSync(
    _ script: String,
    capabilities: ThreeLiveCapabilities? = nil,
    onCapabilityDenied: ((CapabilityDeniedEvent) -> Void)? = nil
  ) throws -> Data {
    try compileSync(script, capabilities: capabilities, onCapabilityDenied: onCapabilityDenied)
  }

  /// Synchronous USDZ compilation entry point. Safe to call from background threads.
  public static func compileUSDZSync(
    _ script: String,
    capabilities: ThreeLiveCapabilities? = nil,
    onCapabilityDenied: ((CapabilityDeniedEvent) -> Void)? = nil
  ) throws -> Data {
    try requireScriptsCapability(capabilities, onCapabilityDenied: onCapabilityDenied)
    _ = try validateNullFreeUTF8(script)
    return try requireBackend().compileToUSDZSync(script)
  }

  /// Synchronous GLB to USDZ transcoding entry point. Safe to call from background threads.
  public static func glbToUSDZSync(_ glbData: Data) throws -> Data {
    guard !glbData.isEmpty else {
      throw ThreeCompilerError.compilationFailed("Null or empty GLB data provided")
    }
    return try requireBackend().glbToUSDZSync(glbData)
  }

  private static func requireScriptsCapability(
    _ capabilities: ThreeLiveCapabilities?,
    onCapabilityDenied: ((CapabilityDeniedEvent) -> Void)?
  ) throws {
    let policy = capabilities ?? ThreeLiveCapabilities.defaultPolicy
    guard policy.check(.scripts, feature: "compile", onDenied: onCapabilityDenied) else {
      throw ThreeCompilerError.compilationFailed(
        "Capability 'scripts' is disabled in ThreeLiveCapabilities.")
    }
  }

  // MARK: - AI core

  /// Runs one AI scene-editing / voice-protocol JSON request in the active `ThreeCompilerBackend`.
  /// Always returns JSON; failures come back as `{"error": ...}`.
  public static func aiCall(_ request: String, onCompilerThread: Bool) async throws -> String {
    _ = try validateNullFreeUTF8(request)
    return try await requireBackend().aiCall(request, onCompilerThread: onCompilerThread)
  }
}
