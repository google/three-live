// swift-tools-version: 5.9
//
// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// This is the only package manifest in the repository. Both consumers and CI resolve it, so
// there is a single code path to keep correct.

import Foundation
import PackageDescription

// MARK: - Binary target resolution
//
// Prebuilt XCFrameworks live in the working tree when `scripts/build_ios_xcframework.sh` has run;
// otherwise release artifacts are downloaded from GitHub Releases.
//
// The three constants below are rewritten automatically at release time by
// `scripts/update_spm_binary_target.sh`. Do not edit them by hand.
let releaseTag = "v1.3.2"
let releaseChecksum = "edbfe8c579b1bfe4f4c4e05cda4f987a24bab5e19774aff5ef4fd58ab06f83ca"
let releaseKernelsChecksum = "0000000000000000000000000000000000000000000000000000000000000000"

let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()

let candidateCompilerPaths = [
  "mobile/ios/ThreeLiveCompiler.xcframework",
  "ThreeLiveCompiler.xcframework",
]
let localFrameworkPath = candidateCompilerPaths.first {
  FileManager.default.fileExists(atPath: packageDir.appendingPathComponent($0).path)
}

let candidateKernelsPaths = [
  "mobile/ios/ThreeLiveKernels.xcframework",
  "ThreeLiveKernels.xcframework",
]
let localKernelsFrameworkPath = candidateKernelsPaths.first {
  FileManager.default.fileExists(atPath: packageDir.appendingPathComponent($0).path)
}

let hasPinnedCompilerChecksum = releaseChecksum.contains(where: { $0 != "0" })
let hasPinnedKernelsChecksum = releaseKernelsChecksum.contains(where: { $0 != "0" })

var products: [Product] = [
  .library(
    name: "ThreeLiveRuntime",
    targets: ["ThreeLiveRuntime"]
  )
]

var targets: [Target] = [
  .target(
    name: "ThreeLiveRuntime",
    path: "mobile/ios/Sources/ThreeLiveRuntime"
  )
]

// Boa-free native kernels (`ThreeLiveKernels`), available whenever built locally or published on
// the pinned release tag.
let hasKernelsTarget = (localKernelsFrameworkPath != nil) || hasPinnedKernelsChecksum
if hasKernelsTarget {
  targets.append(
    .target(
      name: "ThreeLiveKernelsC",
      path: "mobile/ios/Sources/ThreeLiveKernelsC",
      publicHeadersPath: "include"
    )
  )
  if let localKernelsFrameworkPath {
    targets.append(
      .binaryTarget(
        name: "ThreeLiveKernelsBinary",
        path: localKernelsFrameworkPath
      )
    )
  } else {
    targets.append(
      .binaryTarget(
        name: "ThreeLiveKernelsBinary",
        url: "https://github.com/google/three-live/releases/download/"
          + "\(releaseTag)/ThreeLiveKernels.xcframework.zip",
        checksum: releaseKernelsChecksum
      )
    )
  }
  targets.append(
    .target(
      name: "ThreeLiveKernels",
      dependencies: ["ThreeLiveKernelsC", "ThreeLiveKernelsBinary"],
      path: "mobile/ios/Sources/ThreeLiveKernels"
    )
  )
  products.append(
    .library(
      name: "ThreeLiveKernels",
      targets: ["ThreeLiveKernels"]
    )
  )
  targets.append(
    .testTarget(
      name: "ThreeLiveKernelsTests",
      dependencies: ["ThreeLiveRuntime", "ThreeLiveKernels"],
      path: "mobile/ios/Tests/ThreeLiveKernelsTests"
    )
  )
}

// Default Rust + Boa compiler (`ThreeLiveCompilerNative` and umbrella `ThreeLiveCompiler`).
let hasCompilerTarget = (localFrameworkPath != nil) || hasPinnedCompilerChecksum
if !hasCompilerTarget && !hasKernelsTarget {
  fatalError(
    """
    ThreeLiveCompiler has no pinned release checksum, so the prebuilt XCFramework \
    cannot be downloaded. This tag was not published by the release workflow. \
    Either check out a released tag, or build the framework locally with \
    `bash scripts/build_ios_xcframework.sh`.
    """
  )
}

if hasCompilerTarget {
  targets.append(
    .target(
      name: "ThreeLiveCompilerC",
      path: "mobile/ios/Sources/ThreeLiveCompilerC",
      publicHeadersPath: "include"
    )
  )
  if let localFrameworkPath {
    targets.append(
      .binaryTarget(
        name: "ThreeLiveCompilerBinary",
        path: localFrameworkPath
      )
    )
  } else {
    targets.append(
      .binaryTarget(
        name: "ThreeLiveCompilerBinary",
        url: "https://github.com/google/three-live/releases/download/"
          + "\(releaseTag)/ThreeLiveCompiler.xcframework.zip",
        checksum: releaseChecksum
      )
    )
  }
  targets.append(
    .target(
      name: "ThreeLiveCompilerNative",
      dependencies: [
        "ThreeLiveRuntime",
        "ThreeLiveCompilerC",
        "ThreeLiveCompilerBinary",
      ],
      path: "mobile/ios/Sources/ThreeLiveCompilerNative"
    )
  )
  targets.append(
    .target(
      name: "ThreeLiveCompiler",
      dependencies: [
        "ThreeLiveRuntime",
        "ThreeLiveCompilerNative",
      ],
      path: "mobile/ios/Sources/ThreeLiveCompiler"
    )
  )
  products.append(
    .library(
      name: "ThreeLiveCompilerNative",
      targets: ["ThreeLiveCompilerNative"]
    )
  )
  products.append(
    .library(
      name: "ThreeLiveCompiler",
      targets: ["ThreeLiveCompiler"]
    )
  )
  targets.append(
    .testTarget(
      name: "ThreeLiveCompilerTests",
      dependencies: ["ThreeLiveRuntime", "ThreeLiveCompiler"],
      path: "mobile/ios/Tests/ThreeLiveCompilerTests"
    )
  )
}

let package = Package(
  name: "ThreeLiveCompiler",
  platforms: [
    .iOS(.v15),
    .macOS(.v12),
    .visionOS(.v1),
    .tvOS(.v15),
  ],
  products: products,
  targets: targets
)
