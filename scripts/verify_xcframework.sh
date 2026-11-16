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
# Verifies that a built ThreeLiveCompiler.xcframework or ThreeLiveKernels.xcframework is complete
# and usable:
#   * every declared slice directory contains a static library,
#   * every static library exports the full C ABI and nothing else (no Rust standard library,
#     compiler-rt or crate symbols, which would clash with another Rust library in the app),
#   * ThreeLiveKernels.xcframework contains zero Boa JavaScript engine symbols,
#   * no library is suspiciously small.
#
# Usage: verify_xcframework.sh [--kernels] <path-to-xcframework> [expected-slice-count]
#
# Written for bash 3.2, which is what macOS ships as /bin/bash.

set -euo pipefail

MODE="compiler"
if [[ "${1:-}" == "--kernels" ]]; then
    MODE="kernels"
    shift
fi

XCFRAMEWORK="${1:-}"
EXPECTED_SLICES="${2:-0}"

if [[ -z "${XCFRAMEWORK}" || ! -d "${XCFRAMEWORK}" ]]; then
    echo "Error: usage: $(basename "$0") [--kernels] <path-to-xcframework> [expected-slice-count]" >&2
    exit 1
fi

if [[ "$(basename "${XCFRAMEWORK}")" == "ThreeLiveKernels.xcframework" ]]; then
    MODE="kernels"
fi

if [[ "${MODE}" == "kernels" ]]; then
    REQUIRED_SYMBOLS="
_three_live_kernels_abi_version
_three_live_kernels_table
_three_live_kernel_free
_three_live_kernel_box
_three_live_kernel_sphere
_three_live_kernel_cylinder
_three_live_kernel_plane
_three_live_kernel_torus
_three_live_kernel_torus_knot
_three_live_kernel_csg_boolean
_three_live_kernel_material_preset
_three_live_kernel_seam_blend
_three_live_kernel_derive_texture_maps
_three_live_kernel_encode_rgba_png
_three_live_kernel_decode_b64_image
_three_live_kernel_decode_png
_three_live_kernel_compress_png_uri
_three_live_kernel_crc32
_three_live_kernel_utf8_encode
_three_live_kernel_utf8_decode
_three_live_kernel_f32_array
_three_live_kernel_index_array
_three_live_kernel_compute_vertex_normals
_three_live_kernel_format_usda_points
_three_live_kernel_format_usda_uvs
_three_live_kernel_format_usda_ints
_three_live_kernel_build_usdz_zip
"
    ALLOWED_PREFIX="^_three_live_kernel"
    MIN_LIB_BYTES=$((32 * 1024))
else
    # The complete C ABI surface. Mach-O prefixes C symbols with an underscore.
    # Strictly disallow `_three_live_kernel*` so compiler and kernels archives stay disjoint.
    REQUIRED_SYMBOLS="
_three_live_compile
_three_live_compile_usdz
_three_live_glb_to_usdz
_three_live_free_buffer
_three_live_free_error
_three_live_ai_call
_three_live_free_string
"
    ALLOWED_PREFIX="^(_three_live_compile|_three_live_compile_usdz|_three_live_glb_to_usdz|_three_live_free_buffer|_three_live_free_error|_three_live_ai_call|_three_live_free_string)$"
    # A slice that is only a few KB means the Rust build silently produced a stub.
    MIN_LIB_BYTES=$((256 * 1024))
fi

if [[ ! -f "${XCFRAMEWORK}/Info.plist" ]]; then
    echo "Error: ${XCFRAMEWORK} has no Info.plist; it is not a valid XCFramework." >&2
    exit 1
fi

echo "Verifying $(basename "${XCFRAMEWORK}") (${MODE})"

slice_count=0
failures=0

while IFS= read -r lib; do
    slice=$(basename "$(dirname "${lib}")")
    slice_count=$((slice_count + 1))

    size=$(wc -c < "${lib}" | tr -d '[:space:]')
    if [[ "${size}" -lt "${MIN_LIB_BYTES}" ]]; then
        echo "  FAIL ${slice}: library is only ${size} bytes (expected at least ${MIN_LIB_BYTES})" >&2
        failures=$((failures + 1))
        continue
    fi

    # Collect defined external symbols across every architecture in the archive.
    # Pass `--no-llvm-bc` first so Xcode's `llvm-nm` reads the native Mach-O symbol
    # table directly instead of choking on newer Rust/LLVM bitcode attributes when LTO
    # is enabled. Filter at collection time and use a here-string so `grep -q` early
    # exit never triggers SIGPIPE (exit 141) under `set -o pipefail`.
    symbols=$( { nm --no-llvm-bc -gUj "${lib}" 2>/dev/null || nm --no-llvm-bc -gU "${lib}" 2>/dev/null || nm -gUj "${lib}" 2>/dev/null || nm -gU "${lib}" 2>/dev/null || true; } | grep 'three_live_' || true )

    missing=""
    for symbol in ${REQUIRED_SYMBOLS}; do
        if ! grep -Eq "(^|[[:space:]])${symbol}$" <<< "${symbols}"; then
            missing="${missing} ${symbol}"
        fi
    done

    architectures=$(lipo -archs "${lib}" 2>/dev/null || echo "unknown")

    # Every other defined external symbol leaks the library's internals (member headers end in
    # a colon).
    leaked=$( { nm --no-llvm-bc -gUj "${lib}" 2>/dev/null || nm -gUj "${lib}" 2>/dev/null || true; } \
        | grep -E -v -e "${ALLOWED_PREFIX}" -e ':$' -e '^$' | sort -u || true )

    boa_symbols=""
    if [[ "${MODE}" == "kernels" ]]; then
        boa_symbols=$( { nm --no-llvm-bc -j "${lib}" 2>/dev/null || nm -j "${lib}" 2>/dev/null || true; } \
            | grep -i 'boa_engine' | head -n 5 || true )
    fi

    if [[ -n "${missing}" ]]; then
        echo "  FAIL ${slice} [${architectures}]: missing symbols:${missing}" >&2
        failures=$((failures + 1))
    elif [[ -n "${leaked}" ]]; then
        echo "  FAIL ${slice} [${architectures}]: exports $(wc -l <<< "${leaked}" | tr -d '[:space:]') internal symbols, e.g.:" >&2
        head -n 5 <<< "${leaked}" | sed 's/^/         /' >&2
        failures=$((failures + 1))
    elif [[ -n "${boa_symbols}" ]]; then
        echo "  FAIL ${slice} [${architectures}]: kernels library contains boa_engine symbols:" >&2
        sed 's/^/         /' <<< "${boa_symbols}" >&2
        failures=$((failures + 1))
    else
        echo "  ok   ${slice} [${architectures}] $((size / 1024)) KB"
    fi
done < <(find "${XCFRAMEWORK}" -name '*.a' -type f | sort)

if [[ "${slice_count}" -eq 0 ]]; then
    echo "Error: no static libraries found inside ${XCFRAMEWORK}." >&2
    exit 1
fi

if [[ "${EXPECTED_SLICES}" -gt 0 && "${slice_count}" -ne "${EXPECTED_SLICES}" ]]; then
    echo "Error: expected ${EXPECTED_SLICES} slices but found ${slice_count}." >&2
    exit 1
fi

if [[ "${failures}" -gt 0 ]]; then
    echo "Error: ${failures} slice(s) failed verification." >&2
    exit 1
fi

echo "XCFramework verification passed (${slice_count} slices)."
