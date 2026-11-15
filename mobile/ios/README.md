<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

<!-- disableFinding(LINK_RELATIVE_G3DOC) -->

# Three-Live iOS, visionOS, tvOS & macOS Swift Package

Native Swift bindings and C-ABI bridge for `three-live-compiler`.

## Platforms

Platform | Minimum | `ThreeCompiler` | `RealityKitHelper` | `QuickLookHelper`
-------- | ------- | :-------------: | :----------------: | :---------------:
iOS      | 15.0    | ✅               | ✅                  | ✅
visionOS | 1.0     | ✅               | ✅                  | ✅
macOS    | 12.0    | ✅               | ✅                  | —
tvOS     | 15.0    | ✅               | ✅ (tvOS 26+)       | —

On tvOS, the RealityKit layer requires tvOS 26 (the first release with
RealityKit) and Xcode 26; apps that only use `ThreeCompiler` keep the tvOS 15
floor. Post-processing (`enablePostProcessing(on:)`) stays iOS-only.
`QuickLookHelper` requires UIKit and QuickLook, which tvOS does not provide.

## Installation

### Swift Package Manager (Xcode)

In your `Package.swift` or Xcode Project:

```swift
dependencies: [
    .package(url: "https://github.com/google/three-live.git", from: "1.0.0")
]
```

Add `ThreeLiveCompiler` to your app target:

```swift
.target(
    name: "MyApp",
    dependencies: [
        .product(name: "ThreeLiveCompiler", package: "three-live")
    ]
)
```

> **Apps that already embed a JavaScript engine (Boa, JavaScriptCore,
> QuickJS):** Depend on
> `.product(name: "ThreeLiveRuntime", package: "three-live")` +
> `.product(name: "ThreeLiveKernels", package: "three-live")` instead of
> `ThreeLiveCompiler` so zero Boa symbols are linked into your app binary. Load
> `three-live-compiler-bundle.min.js` into your JS realm (wiring
> `globalThis.__three_live_host__` via `ThreeLiveKernels.descriptors()`) and
> call `ThreeCompiler.setBackend(hostBackend)`.

> **Non-SwiftPM static-archive integrators (Bazel, Buck, custom Xcode
> targets):** Pass `-ObjC` in `OTHER_LDFLAGS` when linking
> `ThreeLiveCompilerNative` statically so Objective-C runtime discovery resolves
> `ThreeLiveDefaultBackendProvider`, or call
> `ThreeCompiler.setBackend(NativeThreeCompilerBackend.shared)` at startup.

> **AR Quick Look requires a camera purpose string.** If your app calls
> `QuickLookHelper.presentAR`, add `NSCameraUsageDescription` to your
> `Info.plist`. AR Quick Look places models using the device camera, and App
> Store review rejects binaries that reach the camera without one.

## Quick Start

### 1. Compile Procedural Scene (Zero-Copy)

```swift
import ThreeLiveCompiler

Task {
    do {
        let script = """
            const g = new THREE.TorusKnotGeometry(0.6, 0.2, 64, 16);
            const m = new THREE.MeshStandardMaterial({ color: 0xff6600, metalness: 0.8 });
            scene.add(new THREE.Mesh(g, m));
        """

        // Runs on a dedicated serial queue, never on Swift Concurrency's cooperative
        // thread pool; wraps the native pointer with zero copies.
        let glbData: Data = try await ThreeCompiler.compile(script)

        print("Compiled GLB data size: \(glbData.count) bytes")
    } catch {
        print("Compilation failed: \(error.localizedDescription)")
    }
}
```

### 2. Stream to Apple RealityKit (3D Viewports)

```swift
import RealityKit
import ThreeLiveCompiler

@MainActor
func setupScene() async {
    do {
        // Compiles directly to USDZ with 64-byte RealityKit memory-alignment
        let entity = try await RealityKitHelper.loadEntity(from: script)
        realityViewContent.add(entity)
    } catch {
        print("Failed to load procedural entity: \(error)")
    }
}
```

### 3. Launch Apple AR Quick Look

```swift
import ThreeLiveCompiler

@MainActor
func openAR(viewController: UIViewController) async {
    do {
        // JIT compiles script to USDZ and launches native Apple AR Quick Look
        try await QuickLookHelper.presentAR(from: viewController, script: script)
    } catch {
        print("AR launch failed: \(error)")
    }
}
```

### 4. Run behaviors and spatial traits natively

Compiled `.glb` files carry `KHR_interactivity` behavior graphs and canonical
`extras.xr` traits (see [`docs/xr-live.md`](../../docs/xr-live.md)).
`XRLiveRuntimeSession` (platform-neutral) executes them;
`XRLiveRealityKitSession` binds it to RealityKit entities.

```swift
import ThreeLiveCompiler

@MainActor
func run(glb: Data) async throws -> XRLiveRealityKitSession? {
    let entity = try await RealityKitHelper.loadEntity(fromGLB: glb)
    guard let live = XRLiveRealityKitSession(glbData: glb, root: entity) else { return nil }
    live.installInputTargets()                       // collision + input targets for taps
    live.headPoseProvider = { /* world head pose */ nil }
    live.onInteractivityEvent = { id, json in print("event", id, json) }
    live.start()                                     // event/onStart + SceneEvents.Update
    return live
}
// iOS:      live.handleTap(at: point, in: arView)
// tvOS:     live.handleTap(at: reticleCenter, in: arView)  // Siri Remote Select
// visionOS: SpatialTapGesture().targetedToAnyEntity().onEnded { live.handleTap(on: $0.entity) }
```

Shared spatial algorithms are exposed as pure helpers: `XRSpatialMath` (lazy follow
spring, orbit), `ManipulationHandles`, `WorldUnderstanding.unprojectDetection`,
`TubeStrokeBuilder`, `ParticleEmitter`, and `SplatParser` (`.splat`, `.spz` v2/v3).

## Building the XCFramework locally

```bash
bash scripts/build_ios_xcframework.sh
```

Outputs: `mobile/ios/ThreeLiveKernels.xcframework` (Boa-free) and
`mobile/ios/ThreeLiveCompiler.xcframework` (gitignored). Pass `--kernels-only`
or `--compiler-only` to build a single XCFramework.

The framework carries seven slices:

Slice              | Architectures
------------------ | -----------------
iOS device         | `arm64`
iOS simulator      | `arm64`, `x86_64`
macOS              | `arm64`, `x86_64`
visionOS device    | `arm64`
visionOS simulator | `arm64`
tvOS device        | `arm64`
tvOS simulator     | `arm64`

visionOS and tvOS slices are skipped with a warning if the corresponding SDK is
not installed. Set `THREE_LIVE_REQUIRE_ALL_PLATFORMS=1` to make a missing SDK a
hard error; the release workflow does this so a release can never ship a partial
framework.

The build finishes by running `scripts/verify_xcframework.sh`, which asserts
every slice contains a non-stub static library exporting the complete C ABI.

When a local framework is present, `Package.swift` binds to it directly;
otherwise it downloads the release artifact. The release tag and SHA-256 in
`Package.swift` are written automatically by
`scripts/update_spm_binary_target.sh` during the release workflow, which then
verifies the published package by resolving and running it as an external
consumer.

## Keeping the C headers in sync

SwiftPM requires the public headers inside the `ThreeLiveCompilerC` and
`ThreeLiveKernelsC` targets, so the repository carries synced copies of them.
`compiler/include/three_live_compiler.h` and
`compiler/include/three_live_kernels.h` are canonical:

```bash
bash scripts/sync_c_header.sh          # regenerate the SwiftPM copies
bash scripts/sync_c_header.sh --check  # what CI runs
```
