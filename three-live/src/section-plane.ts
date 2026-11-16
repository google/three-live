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

/**
 * @fileoverview Shared CAD `section-plane` resolution used by the core WebGL2
 * color pass (`ThreeView.render`), the WebGPU scene accelerator, and the
 * shadow-map depth pass so all three clip against the exact same plane.
 */

/** World-space clipping plane: fragments with `dot(p, normal) > constant` are discarded. */
export interface ResolvedSectionPlane {
  enabled: boolean;
  normal: [number, number, number];
  constant: number;
}

interface SectionViewerLike {
  readonly container?: {
    readonly getAttribute?: (name: string) => string | null;
  } | null;
  readonly meshes?: ReadonlyArray<{
    readonly name?: string;
    readonly visible?: boolean;
    readonly worldMatrix?: ArrayLike<number>;
  }>;
  readonly bounds?: {readonly center: readonly number[]};
  readonly modelRootMatrix?: ArrayLike<number>;
}

const IDENTITY: readonly number[] = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

const SPEC_RE = /^([+-]?[xyz])\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/;

/**
 * Resolves the active world-space section plane for `viewerObj`.
 *
 * Priority: a visible `<xr-live>` interactive section gizmo
 * (`__xr_section_gizmo__`) wins; otherwise the host element's
 * `section-plane` attribute (authored in scene/model space, transformed by
 * `modelRootMatrix`). Returns `null` when clipping is disabled.
 */
export function resolveSectionPlane(
  viewerObj: unknown,
): ResolvedSectionPlane | null {
  const viewer = (viewerObj || {}) as SectionViewerLike;
  for (const m of viewer.meshes ?? []) {
    if (
      m.name === '__xr_section_gizmo__' &&
      m.visible !== false &&
      m.worldMatrix &&
      m.worldMatrix.length >= 16
    ) {
      const wm = m.worldMatrix;
      const nl = Math.hypot(wm[8], wm[9], wm[10]) || 1;
      const nx = wm[8] / nl;
      const ny = wm[9] / nl;
      const nz = wm[10] / nl;
      return {
        enabled: true,
        normal: [nx, ny, nz],
        constant: nx * wm[12] + ny * wm[13] + nz * wm[14],
      };
    }
  }
  const raw = (viewer.container?.getAttribute?.('section-plane') ?? '')
    .trim()
    .toLowerCase();
  if (!raw || raw === 'none' || raw === 'false') return null;
  let localN: [number, number, number] = [1, 0, 0];
  let localC = 0;
  if (raw === 'interactive') {
    localC = viewer.bounds?.center[0] ?? 0;
  } else {
    const match = SPEC_RE.exec(raw);
    if (!match) return null;
    const sign = match[1].startsWith('-') ? -1 : 1;
    const axis = match[1].replace(/^[+-]/, '');
    const val = Math.max(-1000, Math.min(1000, Number(match[2]) || 0));
    localN =
      axis === 'x' ? [sign, 0, 0] : axis === 'y' ? [0, sign, 0] : [0, 0, sign];
    localC = val * sign;
  }
  const rm = viewer.modelRootMatrix ?? IDENTITY;
  const wnx = rm[0] * localN[0] + rm[4] * localN[1] + rm[8] * localN[2];
  const wny = rm[1] * localN[0] + rm[5] * localN[1] + rm[9] * localN[2];
  const wnz = rm[2] * localN[0] + rm[6] * localN[1] + rm[10] * localN[2];
  const wnl = Math.hypot(wnx, wny, wnz) || 1;
  const unx = wnx / wnl;
  const uny = wny / wnl;
  const unz = wnz / wnl;
  const px = localN[0] * localC;
  const py = localN[1] * localC;
  const pz = localN[2] * localC;
  const wpx = rm[0] * px + rm[4] * py + rm[8] * pz + rm[12];
  const wpy = rm[1] * px + rm[5] * py + rm[9] * pz + rm[13];
  const wpz = rm[2] * px + rm[6] * py + rm[10] * pz + rm[14];
  return {
    enabled: true,
    normal: [unx, uny, unz],
    constant: unx * wpx + uny * wpy + unz * wpz,
  };
}
