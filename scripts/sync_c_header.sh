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
# Keeps the SwiftPM copies of the C headers byte-identical to the canonical ones.
#
# SwiftPM requires each public header to live inside its C target directory, so the repository
# necessarily carries copies for ThreeLiveCompilerC and ThreeLiveKernelsC. Nothing in the C
# compiler catches a divergence between them -- a mismatched declaration is an ABI bug, not a
# build error -- so the copies are generated and CI asserts they are current.
#
#   sync_c_header.sh          Regenerate the SwiftPM copies.
#   sync_c_header.sh --check  Fail if any copy is stale. Used by CI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPILER_CANONICAL="${ROOT_DIR}/compiler/include/three_live_compiler.h"
COMPILER_SWIFTPM="${ROOT_DIR}/mobile/ios/Sources/ThreeLiveCompilerC/include/ThreeLiveCompiler.h"

KERNELS_CANONICAL="${ROOT_DIR}/compiler/include/three_live_kernels.h"
KERNELS_SWIFTPM="${ROOT_DIR}/mobile/ios/Sources/ThreeLiveKernelsC/include/ThreeLiveKernels.h"

for hdr in "${COMPILER_CANONICAL}" "${KERNELS_CANONICAL}"; do
    if [[ ! -f "${hdr}" ]]; then
        echo "Error: canonical header not found at ${hdr}" >&2
        exit 1
    fi
done

if [[ "${1:-}" == "--check" ]]; then
    stale=0
    if ! diff -u "${COMPILER_CANONICAL}" "${COMPILER_SWIFTPM}"; then
        echo "" >&2
        echo "Error: ${COMPILER_SWIFTPM} is out of date." >&2
        stale=1
    fi
    if ! diff -u "${KERNELS_CANONICAL}" "${KERNELS_SWIFTPM}"; then
        echo "" >&2
        echo "Error: ${KERNELS_SWIFTPM} is out of date." >&2
        stale=1
    fi
    if [[ "${stale}" -ne 0 ]]; then
        echo "Run 'bash scripts/sync_c_header.sh' and commit the result." >&2
        exit 1
    fi
    echo "C header copies are up to date."
    exit 0
fi

mkdir -p "$(dirname "${COMPILER_SWIFTPM}")" "$(dirname "${KERNELS_SWIFTPM}")"
cp "${COMPILER_CANONICAL}" "${COMPILER_SWIFTPM}"
cp "${KERNELS_CANONICAL}" "${KERNELS_SWIFTPM}"
echo "Synced $(basename "${COMPILER_SWIFTPM}") and $(basename "${KERNELS_SWIFTPM}") from canonical headers."
