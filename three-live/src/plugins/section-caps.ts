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
 * `section-cap="solid"` renderer add-on (`three-live-studio`,
 * `xr-live-spatial`, and the full bundles). Builds flat poché caps for every
 * eligible closed mesh cut by the active section plane, uploads them once, and
 * hands `ThreeView` an unclipped world-space mesh to draw after the scene. The
 * core viewer only calls the `sectionCapRenderer` registry hook, so viewer
 * bundles without this add-on carry none of the slicing code.
 */

import {mat4Create} from '../math';
import {getSharedRegistry, type ThreeLivePlugin} from '../plugin';
import {buildSectionCaps, type SectionCapSource} from '../section-cap';

// tslint:disable:no-any Viewer internals (GL objects, glTF JSON, mesh records).

/** Default fill when `section-cap-color` is unset (`#6b7280`). */
export const DEFAULT_SECTION_CAP_COLOR: readonly [number, number, number] = [
  0x6b / 255,
  0x72 / 255,
  0x80 / 255,
];

const ids = new WeakMap<object, number>();
let nextId = 1;
function idOf(o: object): number {
  let id = ids.get(o);
  if (id === undefined) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
}

/**
 * Whether a viewer mesh gets a cap: visible, static, opaque scene meshes only.
 * Plugin / gizmo meshes, instanced, skinned, and morphed meshes,
 * `boundsIgnore` context meshes, and `sectionCap: false` opt-outs are skipped.
 */
export function isSectionCapEligible(mesh: any, gltf: any): boolean {
  const xr = mesh?.extras?.xr ?? mesh?.userData?.xr;
  return !(
    !mesh ||
    mesh.visible === false ||
    mesh.isPluginMesh ||
    String(mesh.name ?? '').startsWith('__') ||
    mesh.boundsIgnore ||
    mesh.extras?.boundsIgnore === true ||
    mesh.userData?.boundsIgnore === true ||
    xr?.boundsIgnore === true ||
    mesh.extras?.sectionCap === false ||
    mesh.userData?.sectionCap === false ||
    xr?.sectionCap === false ||
    mesh.instanceMatrices ||
    gltf?.nodes?.[mesh.nodeIndex]?.skin !== undefined ||
    !Array.isArray(mesh.primitives) ||
    mesh.primitives.some(
      (p: any) =>
        !p?.positions ||
        p.instanceCount !== undefined ||
        p.primitiveDef?.targets?.length ||
        p.alphaMode === 'BLEND' ||
        p.isTransmissive,
    )
  );
}

interface CapCache {
  sig: number;
  mesh: any | null;
}
const caches = new WeakMap<object, CapCache>();

function release(viewer: any): void {
  const old = caches.get(viewer)?.mesh;
  caches.delete(viewer);
  const gl = viewer?.getGLContext?.();
  if (!old || !gl) return;
  for (const prim of old.primitives) {
    for (const b of prim.buffers) gl.deleteBuffer?.(b);
    if (prim.vao) gl.deleteVertexArray?.(prim.vao);
  }
}

/** The cached cap mesh of `viewer` (for tests and debugging), or `null`. */
export function getSectionCapMesh(viewer: unknown): any | null {
  return (viewer && caches.get(viewer as object)?.mesh) ?? null;
}

/** Local AABB per positions array (cut early-out without copying). */
const boxes = new WeakMap<object, number[]>();
function boxOf(p: ArrayLike<number> & object): number[] {
  let b = boxes.get(p);
  if (!b) {
    b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < b[k]) b[k] = p[i + k];
        if (p[i + k] > b[k + 3]) b[k + 3] = p[i + k];
      }
    }
    boxes.set(p, b);
  }
  return b;
}

/** Whether the plane (in root space) passes through the mesh's bounds. */
function planeCutsMesh(mesh: any, n: number[], c: number): boolean {
  const m = mesh.transform;
  let neg = false;
  let pos = false;
  for (const prim of mesh.primitives) {
    const b = boxOf(prim.positions);
    for (let corner = 0; corner < 8; corner++) {
      const x = b[corner & 1 ? 3 : 0];
      const y = b[corner & 2 ? 4 : 1];
      const z = b[corner & 4 ? 5 : 2];
      const d =
        n[0] * (m[0] * x + m[4] * y + m[8] * z + m[12]) +
        n[1] * (m[1] * x + m[5] * y + m[9] * z + m[13]) +
        n[2] * (m[2] * x + m[6] * y + m[10] * z + m[14]) -
        c;
      if (d < 0) neg = true;
      else pos = true;
      if (neg && pos) return true;
    }
  }
  return false;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Returns the cap mesh for `viewer` cut by `plane`. Caps are built in model
 * root space (the plane is moved into it) and drawn with `modelRootMatrix`,
 * so turntable rotation, AR placement, and `section-plane` attributes (which
 * are authored in model space) keep hitting the cache. Only meshes whose
 * bounds the plane crosses are sliced. Passing a `null` plane releases the
 * cached GPU buffers.
 */
export function renderSectionCaps(
  viewer: any,
  plane: {normal: readonly number[]; constant: number} | null,
  color: readonly number[] | null,
  isHidden?: (mesh: any) => boolean,
): any | null {
  if (!plane) {
    release(viewer);
    return null;
  }
  const rgb = color ?? DEFAULT_SECTION_CAP_COLOR;
  const r: ArrayLike<number> = viewer.modelRootMatrix ?? mat4Create();
  // World plane n.p = c with p = A q + t  =>  (A^T n).q = c - n.t.
  const wn = plane.normal;
  const n = [
    r[0] * wn[0] + r[1] * wn[1] + r[2] * wn[2],
    r[4] * wn[0] + r[5] * wn[1] + r[6] * wn[2],
    r[8] * wn[0] + r[9] * wn[1] + r[10] * wn[2],
  ];
  const c = plane.constant - (wn[0] * r[12] + wn[1] * r[13] + wn[2] * r[14]);
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h = Math.imul(h ^ (Math.round(v * 1e5) | 0), 16777619);
  };
  n.forEach(mix);
  mix(c);
  rgb.forEach(mix);
  const eligible: any[] = [];
  for (const mesh of viewer.meshes ?? []) {
    if (!isSectionCapEligible(mesh, viewer.gltf)) continue;
    if (isHidden?.(mesh)) continue;
    if (!planeCutsMesh(mesh, n, c)) continue;
    eligible.push(mesh);
    mix(idOf(mesh));
    for (let k = 0; k < 16; k++) mix(mesh.transform[k]);
    for (const p of mesh.primitives) mix(idOf(p.positions));
  }
  mix(eligible.length);
  const cached = caches.get(viewer);
  if (cached?.sig === h) return cached.mesh;
  release(viewer);

  const sources: SectionCapSource[] = eligible.map((mesh) => {
    // One source per mesh, so loops may span primitives (multi-material).
    let vCount = 0;
    let iCount = 0;
    for (const p of mesh.primitives) {
      vCount += p.positions.length / 3;
      iCount += p.indices ? p.indices.length : p.positions.length / 3;
    }
    const positions = new Float32Array(vCount * 3);
    const indices = new Uint32Array(iCount);
    let vo = 0;
    let io = 0;
    for (const p of mesh.primitives) {
      const n = p.positions.length / 3;
      positions.set(p.positions, vo * 3);
      for (let i = 0; i < (p.indices ? p.indices.length : n); i++) {
        indices[io++] = (p.indices ? p.indices[i] : i) + vo;
      }
      vo += n;
    }
    return {positions, indices, matrix: mesh.transform};
  });
  const caps = buildSectionCaps(sources, {normal: n, constant: c});
  const gl = viewer.getGLContext?.();
  let mesh: any = null;
  if (caps.indices.length > 0 && typeof gl?.createVertexArray === 'function') {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers: unknown[] = [];
    const attr = (data: Float32Array, loc: number) => {
      const b = gl.createBuffer();
      buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    attr(caps.positions, 0);
    attr(caps.normals, 1);
    const ib = gl.createBuffer();
    buffers.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, caps.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    mesh = {
      name: '__section_cap__',
      nodeIndex: -1,
      transform: mat4Create(),
      normalMatrix: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      extras: {sectionCap: false},
      castShadow: false,
      boundsIgnore: true,
      // Root-space geometry (drawn with modelRootMatrix), never clipped.
      isPluginMesh: true,
      primitives: [
        {
          vao,
          indexCount: caps.indices.length,
          indexType: gl.UNSIGNED_INT,
          // `section-cap-color` is sRGB hex; the PBR base color is linear.
          baseColor: [
            srgbToLinear(rgb[0]),
            srgbToLinear(rgb[1]),
            srgbToLinear(rgb[2]),
            1,
          ],
          metallic: 0,
          roughness: 1,
          clearcoat: 0,
          clearcoatRoughness: 0,
          positions: caps.positions,
          normals: caps.normals,
          indices: caps.indices,
          texture: null,
          metallicRoughnessTexture: null,
          normalTexture: null,
          occlusionTexture: null,
          emissiveTexture: null,
          emissiveFactor: [0, 0, 0],
          normalScale: 1,
          occlusionStrength: 1,
          buffers,
          doubleSided: true,
        },
      ],
    };
  }
  caches.set(viewer, {sig: h, mesh});
  return mesh;
}

/** Installs the `section-cap="solid"` renderer into the shared registry. */
export const sectionCapsPlugin: ThreeLivePlugin = {
  name: 'section-caps',
  onRegister(): void {
    getSharedRegistry().sectionCapRenderer = renderSectionCaps;
  },
};
