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
# Pins the release tag and XCFramework SHA-256 checksums into Package.swift.
#
# The checksums of release artifacts cannot be known until the artifacts are built, so the
# manifest committed on a tag is necessarily stale until this runs. The release workflow
# invokes this after publishing the release and then moves the tag.
#
# Usage: update_spm_binary_target.sh <tag> <compiler-sha256> [kernels-sha256]
#
# Written for bash 3.2, which is what macOS ships as /bin/bash.

set -euo pipefail

TAG="${1:-}"
CHECKSUM="${2:-}"
KERNELS_CHECKSUM="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${ROOT_DIR}/Package.swift"

if [[ -z "${TAG}" || -z "${CHECKSUM}" ]]; then
    echo "Error: usage: $(basename "$0") <tag> <compiler-sha256> [kernels-sha256]" >&2
    exit 1
fi

if ! echo "${TAG}" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
    echo "Error: tag '${TAG}' must match v<major>.<minor>.<patch>[-prerelease]." >&2
    exit 1
fi

validate_sha256() {
    local sum="$1"
    local label="$2"
    if ! echo "${sum}" | grep -qE '^[0-9a-f]{64}$'; then
        echo "Error: ${label} '${sum}' is not a lowercase 64-character hex SHA-256." >&2
        exit 1
    fi
    if ! echo "${sum}" | grep -qE '[1-9a-f]'; then
        echo "Error: refusing to pin an all-zero placeholder checksum for ${label}." >&2
        exit 1
    fi
}

validate_sha256 "${CHECKSUM}" "compiler-sha256"
if [[ -n "${KERNELS_CHECKSUM}" ]]; then
    validate_sha256 "${KERNELS_CHECKSUM}" "kernels-sha256"
fi

if [[ ! -f "${MANIFEST}" ]]; then
    echo "Error: ${MANIFEST} not found." >&2
    exit 1
fi

# Constants are declared on single lines in Package.swift specifically so that this
# rewrite stays a simple, reviewable substitution.
if [[ -n "${KERNELS_CHECKSUM}" ]]; then
    sed -i.bak -E \
        -e "s|^let releaseTag = \".*\"$|let releaseTag = \"${TAG}\"|" \
        -e "s|^let releaseChecksum = \"[0-9a-fA-F]{64}\"$|let releaseChecksum = \"${CHECKSUM}\"|" \
        -e "s|^let releaseKernelsChecksum = \"[0-9a-fA-F]{64}\"$|let releaseKernelsChecksum = \"${KERNELS_CHECKSUM}\"|" \
        "${MANIFEST}"
else
    sed -i.bak -E \
        -e "s|^let releaseTag = \".*\"$|let releaseTag = \"${TAG}\"|" \
        -e "s|^let releaseChecksum = \"[0-9a-fA-F]{64}\"$|let releaseChecksum = \"${CHECKSUM}\"|" \
        "${MANIFEST}"
fi
rm -f "${MANIFEST}.bak"

# Verify the substitutions actually landed; sed reports success even when nothing matched.
if ! grep -Fqx "let releaseTag = \"${TAG}\"" "${MANIFEST}"; then
    echo "Error: failed to pin release tag in ${MANIFEST}." >&2
    exit 1
fi

if ! grep -Fqx "let releaseChecksum = \"${CHECKSUM}\"" "${MANIFEST}"; then
    echo "Error: failed to pin release checksum in ${MANIFEST}." >&2
    exit 1
fi

if [[ -n "${KERNELS_CHECKSUM}" ]]; then
    if ! grep -Fqx "let releaseKernelsChecksum = \"${KERNELS_CHECKSUM}\"" "${MANIFEST}"; then
        echo "Error: failed to pin kernels release checksum in ${MANIFEST}." >&2
        exit 1
    fi
    echo "Pinned ThreeLiveCompiler.xcframework (${CHECKSUM}) and ThreeLiveKernels.xcframework (${KERNELS_CHECKSUM}) for ${TAG}."
else
    echo "Pinned ThreeLiveCompiler.xcframework for ${TAG} (sha256 ${CHECKSUM})."
fi
