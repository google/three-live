#!/usr/bin/env bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Builds the ThreeLiveKernels (Boa-free) and ThreeLiveCompiler (Rust + Boa) XCFrameworks covering
# every platform declared in Package.swift.
#
# Flags:
#   --kernels-only   Build only ThreeLiveKernels.xcframework (zero Boa dependencies).
#   --compiler-only  Build only ThreeLiveCompiler.xcframework.
#   (default)        Build both ThreeLiveKernels.xcframework and ThreeLiveCompiler.xcframework.
#
# By default, visionOS and tvOS slices are skipped with a warning if the corresponding SDK is
# not installed, so that a stock Xcode installation can still produce usable iOS/macOS
# frameworks. Set THREE_LIVE_REQUIRE_ALL_PLATFORMS=1 to turn a missing SDK into a hard error;
# the release workflow does this so a release can never ship a partial framework.

set -euo pipefail

BUILD_KERNELS=1
BUILD_COMPILER=1
if [[ "${1:-}" == "--kernels-only" ]]; then
    BUILD_COMPILER=0
elif [[ "${1:-}" == "--compiler-only" ]]; then
    BUILD_KERNELS=0
elif [[ -n "${1:-}" ]]; then
    echo "Error: unknown argument '$1' (expected --kernels-only or --compiler-only)." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPILER_DIR="${ROOT_DIR}/compiler"
IOS_DIR="${ROOT_DIR}/mobile/ios"
TARGET_ROOT="${CARGO_TARGET_DIR:-${ROOT_DIR}/target}"

OUTPUT_XCFRAMEWORK="${IOS_DIR}/ThreeLiveCompiler.xcframework"
OUTPUT_KERNELS_XCFRAMEWORK="${IOS_DIR}/ThreeLiveKernels.xcframework"
CARGO_LIB_NAME="libthree_live_compiler.a"
KERNELS_LIB_NAME="libthree_live_kernels.a"

EXPORTED_SYMBOLS="${IOS_DIR}/exported_symbols.txt"
EXPORTED_SYMBOLS_KERNELS="${IOS_DIR}/exported_symbols_kernels.txt"
REQUIRE_ALL="${THREE_LIVE_REQUIRE_ALL_PLATFORMS:-0}"

echo "=== Three-Live: Building Apple XCFramework(s) ==="

if ! command -v cargo &> /dev/null; then
    echo "Error: cargo is required but not installed." >&2
    exit 1
fi

if [[ -z "${DEVELOPER_DIR:-}" ]] && [[ "$(xcode-select -p 2>/dev/null || true)" == *"CommandLineTools"* ]]; then
    if [[ -d "/Applications/Xcode.app/Contents/Developer" ]]; then
        export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
    else
        DETECTED_XCODE_DEV="$(ls -d /Applications/Xcode*.app/Contents/Developer 2>/dev/null | sort -V | tail -n 1 || true)"
        if [[ -n "${DETECTED_XCODE_DEV}" ]] && [[ -d "${DETECTED_XCODE_DEV}" ]]; then
            export DEVELOPER_DIR="${DETECTED_XCODE_DEV}"
        fi
    fi
fi

if ! command -v xcodebuild &> /dev/null; then
    echo "Error: xcodebuild is required to package XCFramework (macOS with Xcode.app only)." >&2
    echo "If Xcode.app is installed, run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
    exit 1
fi

if ! xcrun --sdk iphoneos --show-sdk-path &>/dev/null; then
    echo "Error: iOS SDK (iphoneos) not found." >&2
    echo "1. Point xcode-select to Xcode.app:" >&2
    echo "     sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
    echo "2. If the iOS platform is not installed in Xcode yet, run:" >&2
    echo "     xcodebuild -downloadPlatform iOS" >&2
    exit 1
fi

AVAILABLE_SDKS="$(xcodebuild -showsdks 2>/dev/null || true)"

has_sdk() {
    echo "${AVAILABLE_SDKS}" | grep -q -- "-sdk $1"
}

# hide_internal_symbols <static-lib> <rust-target> <xcode-sdk> <exported-symbols-file> <obj-stem>
# Pre-links the library into one object that exports only the declared C ABI. Rust's standard
# library, compiler-rt and every crate become private to it, so the framework links into an app
# that already carries another Rust library without duplicate symbols or a shared Rust runtime.
hide_internal_symbols() {
    local lib="$1"
    local target="$2"
    local sdk="$3"
    local symbols_file="$4"
    local obj_stem="$5"
    local arch
    case "${target}" in
        aarch64-*) arch="arm64" ;;
        x86_64-*) arch="x86_64" ;;
        *)
            echo "Error: no architecture for Rust target ${target}." >&2
            exit 1
            ;;
    esac
    local platform min_version
    case "${sdk}" in
        iphoneos)         platform="ios";            min_version="15.0" ;;
        iphonesimulator)  platform="ios-simulator";  min_version="15.0" ;;
        macosx)           platform="macos";          min_version="12.0" ;;
        xros)             platform="xros";           min_version="1.0" ;;
        xrsimulator)      platform="xros-simulator"; min_version="1.0" ;;
        appletvos)        platform="tvos";           min_version="15.0" ;;
        appletvsimulator) platform="tvos-simulator"; min_version="15.0" ;;
        *)
            echo "Error: unknown Xcode SDK ${sdk}." >&2
            exit 1
            ;;
    esac
    local sdk_version
    sdk_version="$(xcrun --sdk "${sdk}" --show-sdk-version)"
    local work
    work="$(mktemp -d)"
    xcrun --sdk "${sdk}" ld -r -arch "${arch}" \
        -platform_version "${platform}" "${min_version}" "${sdk_version}" \
        -exported_symbols_list "${symbols_file}" \
        -force_load "${lib}" -o "${work}/${obj_stem}.o"
    rm -f "${lib}"
    xcrun --sdk "${sdk}" libtool -static -o "${lib}" "${work}/${obj_stem}.o"
    rm -rf "${work}"
}

# Detect optional Apple platforms once up front.
BUILD_VISIONOS=0
if has_sdk xros && rustup target add aarch64-apple-visionos aarch64-apple-visionos-sim 2>/dev/null; then
    BUILD_VISIONOS=1
elif [[ "${REQUIRE_ALL}" == "1" ]]; then
    echo "Error: visionOS SDK/target not installed, but THREE_LIVE_REQUIRE_ALL_PLATFORMS=1." >&2
    exit 1
else
    echo "  ! visionOS SDK or Rust std target not found; skipping visionOS slices." >&2
fi

BUILD_TVOS=0
if has_sdk appletvos && rustup target add aarch64-apple-tvos aarch64-apple-tvos-sim 2>/dev/null; then
    BUILD_TVOS=1
elif [[ "${REQUIRE_ALL}" == "1" ]]; then
    echo "Error: tvOS SDK/target not installed, but THREE_LIVE_REQUIRE_ALL_PLATFORMS=1." >&2
    exit 1
else
    echo "  ! tvOS SDK or Rust std target not found; skipping tvOS slices." >&2
fi

# build_slice <features> <out-lib-name> <symbols-file> <obj-stem> <rust-target> <xcode-sdk>
build_slice() {
    local features="$1"
    local out_lib_name="$2"
    local symbols_file="$3"
    local obj_stem="$4"
    local target="$5"
    local sdk="$6"
    local sdk_path
    sdk_path="$(xcrun --sdk "${sdk}" --show-sdk-path)"
    echo "  - [${features}] ${target} (SDK: ${sdk_path})"
    rustup target add "${target}"
    IPHONEOS_DEPLOYMENT_TARGET=15.0 \
    MACOSX_DEPLOYMENT_TARGET=12.0 \
    XROS_DEPLOYMENT_TARGET=1.0 \
    TVOS_DEPLOYMENT_TARGET=15.0 \
    SDKROOT="${sdk_path}" cargo build --release --no-default-features --features "${features}" --lib --target "${target}"
    local built_lib="${TARGET_ROOT}/${target}/release/${CARGO_LIB_NAME}"
    local dest_lib="${TARGET_ROOT}/${target}/release/${out_lib_name}"
    if [[ "${built_lib}" != "${dest_lib}" ]]; then
        cp -f "${built_lib}" "${dest_lib}"
    fi
    hide_internal_symbols "${dest_lib}" "${target}" "${sdk}" "${symbols_file}" "${obj_stem}"
}

# fat_slice <out-lib-name> <out-subdir> <target>...
fat_slice() {
    local out_lib_name="$1"
    local out_dir="${TARGET_ROOT}/$2"
    shift 2
    local inputs=()
    local target
    for target in "$@"; do
        inputs+=("${TARGET_ROOT}/${target}/release/${out_lib_name}")
    done
    mkdir -p "${out_dir}"
    lipo -create "${inputs[@]}" -output "${out_dir}/${out_lib_name}"
    echo "${out_dir}/${out_lib_name}"
}

# build_variant <features> <out-lib-name> <symbols-file> <obj-stem> <lipo-prefix> <output-xcf> <verify-mode>
build_variant() {
    local features="$1"
    local out_lib_name="$2"
    local symbols_file="$3"
    local obj_stem="$4"
    local lipo_prefix="$5"
    local output_xcf="$6"
    local verify_flag="$7"

    echo "--> Compiling Rust static libraries (${features})..."
    build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" aarch64-apple-ios iphoneos
    build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" aarch64-apple-ios-sim iphonesimulator
    build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" x86_64-apple-ios iphonesimulator
    build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" aarch64-apple-darwin macosx
    build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" x86_64-apple-darwin macosx

    if [[ "${BUILD_VISIONOS}" == "1" ]]; then
        build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" aarch64-apple-visionos xros
        build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" aarch64-apple-visionos-sim xrsimulator
    fi
    if [[ "${BUILD_TVOS}" == "1" ]]; then
        build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" aarch64-apple-tvos appletvos
        build_slice "${features}" "${out_lib_name}" "${symbols_file}" "${obj_stem}" aarch64-apple-tvos-sim appletvsimulator
    fi

    echo "--> Combining architecture slices (${features})..."
    local ios_sim_lib macos_lib
    ios_sim_lib="$(fat_slice "${out_lib_name}" "${lipo_prefix}-ios-sim-lipo" aarch64-apple-ios-sim x86_64-apple-ios)"
    macos_lib="$(fat_slice "${out_lib_name}" "${lipo_prefix}-macos-lipo" aarch64-apple-darwin x86_64-apple-darwin)"

    local xcf_args=(
        -library "${TARGET_ROOT}/aarch64-apple-ios/release/${out_lib_name}"
        -library "${ios_sim_lib}"
        -library "${macos_lib}"
    )
    if [[ "${BUILD_VISIONOS}" == "1" ]]; then
        xcf_args+=(
            -library "${TARGET_ROOT}/aarch64-apple-visionos/release/${out_lib_name}"
            -library "${TARGET_ROOT}/aarch64-apple-visionos-sim/release/${out_lib_name}"
        )
    fi
    if [[ "${BUILD_TVOS}" == "1" ]]; then
        xcf_args+=(
            -library "${TARGET_ROOT}/aarch64-apple-tvos/release/${out_lib_name}"
            -library "${TARGET_ROOT}/aarch64-apple-tvos-sim/release/${out_lib_name}"
        )
    fi

    echo "--> Packaging $(basename "${output_xcf}")..."
    rm -rf "${output_xcf}"
    # Headers are intentionally omitted: the ThreeLiveCompilerC / ThreeLiveKernelsC SwiftPM
    # targets supply the C headers and module maps.
    xcodebuild -create-xcframework "${xcf_args[@]}" -output "${output_xcf}"

    echo "--> Verifying $(basename "${output_xcf}")..."
    if [[ -n "${verify_flag}" ]]; then
        "${SCRIPT_DIR}/verify_xcframework.sh" "${verify_flag}" "${output_xcf}"
    else
        "${SCRIPT_DIR}/verify_xcframework.sh" "${output_xcf}"
    fi
    echo "=== Created ${output_xcf} ==="
}

cd "${COMPILER_DIR}"

if [[ "${BUILD_KERNELS}" == "1" ]]; then
    build_variant "kernels" "${KERNELS_LIB_NAME}" "${EXPORTED_SYMBOLS_KERNELS}" \
        "three_live_kernels" "kernels" "${OUTPUT_KERNELS_XCFRAMEWORK}" "--kernels"
fi

if [[ "${BUILD_COMPILER}" == "1" ]]; then
    build_variant "boa" "${CARGO_LIB_NAME}" "${EXPORTED_SYMBOLS}" \
        "three_live_compiler" "compiler" "${OUTPUT_XCFRAMEWORK}" ""
fi

echo "=== Success! Apple XCFramework build complete ==="
