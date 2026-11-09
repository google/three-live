/**
 * @license
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

/**
 * @fileoverview Multi-Light Depth Shadow Maps Plugin (`shadowMapsPlugin`).
 *
 * Renders up to 4 directional, spot, and point shadow-casting lights into a
 * single `DEPTH_COMPONENT24` `gl.TEXTURE_2D_ARRAY` on texture unit 9 with
 * hardware comparison (`COMPARE_REF_TO_TEXTURE`, `LEQUAL`), rotated 8-tap
 * Vogel-disk PCF, scale-invariant normal-offset bias, CAD section-plane
 * clipping, and an FNV-1a dirty digest so static camera orbits execute zero
 * shadow depth passes.
 *
 * Pure module with no top-level side effects so à-la-carte ESM consumers can
 * tree-shake it cleanly when unused.
 */

import {
  mat4Create,
  mat4LookAt,
  mat4Multiply,
  mat4Ortho,
  mat4Perspective,
} from '../math';
import {
  getSharedRegistry,
  type ShadowMapShaderChunk,
  type ShadowMapsMode,
  type ThreeLivePlugin,
} from '../plugin';

/** Maximum simultaneous shadow-casting lights in the depth array texture. */
export const MAX_SHADOW_LIGHTS = 4;

/** Texture unit reserved for `sampler2DArrayShadow uShadowMap`. */
export const SHADOW_MAP_TEXTURE_UNIT = 9;

const MAX_ARRAY_VRAM_BYTES = 32 * 1024 * 1024;
const IDENTITY_MAT4 = mat4Create();
const INACTIVE_SLOTS = new Int32Array([-1, -1]);

function clampShd(v: unknown, lo: number, hi: number, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
}

/** World-space scene bounding volume used to fit light frustums tightly. */
export interface WorldSceneBounds {
  readonly center: [number, number, number];
  readonly radius: number;
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

/** Resolved per-light shadow slice ready for WebGL2 or WebGPU rendering. */
export interface ResolvedShadowSlice {
  readonly slot: number;
  readonly viewProj: Float32Array;
  readonly rayDir: [number, number, number];
  readonly depthBias: number;
  readonly normalBiasWorld: number;
  readonly uvRadius: number;
}

/** Complete per-frame shadow plan shared between WebGL2 and WebGPU. */
export interface ResolvedShadowPlan {
  readonly mode: ShadowMapsMode;
  readonly mapSize: number;
  readonly slices: readonly ResolvedShadowSlice[];
  readonly dirSlots: [number, number];
  readonly ptSlots: [number, number];
  readonly promoteAllCasters: boolean;
  readonly promoteAllReceivers: boolean;
  readonly digest: number;
  readonly sectionPlane: {
    readonly enabled: boolean;
    readonly normal: [number, number, number];
    readonly constant: number;
  } | null;
}

/** Diagnostic counters returned by `getShadowMapStats(viewer)`. */
export interface ShadowMapStats {
  readonly renderedPasses: number;
  readonly cacheHits: number;
  readonly activeLights: number;
  readonly mapSize: number;
}

interface ShadowLightLike {
  readonly type?: string;
  readonly position?: readonly number[];
  readonly direction?: readonly number[];
  readonly range?: number;
  readonly outerConeAngle?: number;
  readonly shadow?: {
    readonly cast?: boolean;
    readonly mapSize?: number;
    readonly bias?: number;
    readonly normalBias?: number;
    readonly radius?: number;
  };
}

interface ShadowPrimLike {
  readonly vao?: WebGLVertexArrayObject;
  readonly instanced?: boolean;
  readonly instanceCount?: number;
  readonly translations?: Float32Array;
  readonly indexCount: number;
  readonly indexType: number;
  readonly indices?: Uint16Array | Uint32Array | null;
  readonly positions?: Float32Array | null;
  readonly alphaMode?: string;
  readonly baseColor?: readonly number[] | Float32Array;
  readonly isTransmissive?: boolean;
}

interface ShadowMeshLike {
  readonly name?: string;
  readonly visible?: boolean;
  readonly worldSpace?: boolean;
  readonly worldMatrix?: Float32Array;
  readonly isPluginMesh?: boolean;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly transform: Float32Array;
  readonly instanceMatrices?: Float32Array;
  readonly extras?: {
    readonly shadow?: {readonly cast?: boolean; readonly receive?: boolean};
    readonly xr?: Record<string, unknown>;
  };
  readonly userData?: {
    readonly xr?: Record<string, unknown>;
  };
  readonly primitives: readonly ShadowPrimLike[];
}

interface ShadowViewerLike {
  readonly gl?: WebGL2RenderingContext;
  readonly canvas?: {readonly width?: number; readonly height?: number};
  readonly container?: {
    readonly getAttribute?: (name: string) => string | null;
  } | null;
  readonly shadowMaps?: string;
  readonly meshes?: readonly ShadowMeshLike[];
  readonly lights?: readonly ShadowLightLike[];
  readonly bounds?: {
    readonly center: [number, number, number];
    readonly radius: number;
    readonly min: [number, number, number];
    readonly max: [number, number, number];
  };
  readonly modelRootMatrix?: Float32Array;
  readonly xrSessionActive?: boolean;
  readonly uRender?: Record<string, WebGLUniformLocation | null>;
  readonly recompileRenderProgram?: () => void;
}

interface ViewerShadowGLState {
  texArray: WebGLTexture | null;
  fbo: WebGLFramebuffer | null;
  allocSize: number;
  allocLayers: number;
  lastDigest: number;
  renderedPasses: number;
  cacheHits: number;
  activeLights: number;
  vpFlat: Float32Array;
  paramsFlat: Float32Array;
  dirSlots: Int32Array;
  ptSlots: Int32Array;
  promoteAllReceivers: boolean;
}

interface ContextShadowShared {
  prog: WebGLProgram | null;
  uLightVP: WebGLUniformLocation | null;
  uModel: WebGLUniformLocation | null;
  uBiasRay: WebGLUniformLocation | null;
  uInstanced: WebGLUniformLocation | null;
  uSecPlane: WebGLUniformLocation | null;
  uSecOn: WebGLUniformLocation | null;
  dummyArrayTex: WebGLTexture | null;
}

const localPrimBoundsCache = new WeakMap<
  Float32Array,
  readonly [number, number, number, number, number, number]
>();
const viewerStates = new WeakMap<object, ViewerShadowGLState>();
const contextShared = new WeakMap<
  WebGL2RenderingContext,
  ContextShadowShared
>();

const _lookView = mat4Create();
const _projMat = mat4Create();
const _modelScratch = mat4Create();
const _instScratch = mat4Create();
const _f32HashBuf = new Float32Array(1);
const _u32HashView = new Uint32Array(_f32HashBuf.buffer);

/** Normalizes `<three-live shadow-maps="...">` attribute values. */
export function normalizeShadowMapsMode(raw: unknown): ShadowMapsMode {
  if (typeof raw !== 'string') return 'auto';
  const s = raw.trim().toLowerCase();
  return s === 'pcf' || s === 'off' ? s : 'auto';
}

function getLocalPositionsBox(
  pos: Float32Array,
): readonly [number, number, number, number, number, number] {
  const cached = localPrimBoundsCache.get(pos);
  if (cached) return cached;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const box: readonly [number, number, number, number, number, number] =
    Number.isFinite(minX)
      ? [minX, minY, minZ, maxX, maxY, maxZ]
      : [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5];
  localPrimBoundsCache.set(pos, box);
  return box;
}

function expandWorldAabbByMatrix(
  box: readonly [number, number, number, number, number, number],
  m: ArrayLike<number>,
  outMin: [number, number, number],
  outMax: [number, number, number],
): void {
  const cx = (box[0] + box[3]) * 0.5;
  const cy = (box[1] + box[4]) * 0.5;
  const cz = (box[2] + box[5]) * 0.5;
  const hx = Math.max(0, (box[3] - box[0]) * 0.5);
  const hy = Math.max(0, (box[4] - box[1]) * 0.5);
  const hz = Math.max(0, (box[5] - box[2]) * 0.5);
  const wcx = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
  const wcy = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
  const wcz = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
  const whx = Math.abs(m[0]) * hx + Math.abs(m[4]) * hy + Math.abs(m[8]) * hz;
  const why = Math.abs(m[1]) * hx + Math.abs(m[5]) * hy + Math.abs(m[9]) * hz;
  const whz = Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * hz;
  if (wcx - whx < outMin[0]) outMin[0] = wcx - whx;
  if (wcy - why < outMin[1]) outMin[1] = wcy - why;
  if (wcz - whz < outMin[2]) outMin[2] = wcz - whz;
  if (wcx + whx > outMax[0]) outMax[0] = wcx + whx;
  if (wcy + why > outMax[1]) outMax[1] = wcy + why;
  if (wcz + whz > outMax[2]) outMax[2] = wcz + whz;
}

/**
 * Computes tight dynamic world-space scene bounds across visible meshes (with
 * `modelRootMatrix` turntable applied), enforcing `radius >= 0.05` so flat
 * zero-thickness planes never produce singular frustums.
 */
export function computeWorldSceneBounds(viewerObj: unknown): WorldSceneBounds {
  const viewer = (viewerObj || {}) as ShadowViewerLike;
  const rm = viewer.modelRootMatrix ?? IDENTITY_MAT4;
  const wMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const wMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const mesh of viewer.meshes ?? []) {
    if (!isShadowEligibleMesh(mesh)) continue;
    if (mesh.worldSpace === true) {
      _modelScratch.set(mesh.transform);
    } else {
      mat4Multiply(_modelScratch, rm, mesh.transform);
    }
    const instMats = mesh.instanceMatrices;
    for (const prim of mesh.primitives ?? []) {
      if (!prim.positions || prim.positions.length < 3) continue;
      const lbox = getLocalPositionsBox(prim.positions);
      if (instMats && instMats.length >= 16) {
        const count = instMats.length >> 4;
        const step = count > 64 ? Math.ceil(count / 64) : 1;
        for (let i = 0; i < count; i += step) {
          mat4Multiply(
            _instScratch,
            _modelScratch,
            instMats.subarray(i * 16, i * 16 + 16),
          );
          expandWorldAabbByMatrix(lbox, _instScratch, wMin, wMax);
        }
        if (step > 1) {
          const last = count - 1;
          mat4Multiply(
            _instScratch,
            _modelScratch,
            instMats.subarray(last * 16, last * 16 + 16),
          );
          expandWorldAabbByMatrix(lbox, _instScratch, wMin, wMax);
        }
      } else {
        expandWorldAabbByMatrix(lbox, _modelScratch, wMin, wMax);
      }
    }
  }

  if (!Number.isFinite(wMin[0])) {
    const b = viewer.bounds;
    if (b && Array.isArray(b.min) && Array.isArray(b.max)) {
      expandWorldAabbByMatrix(
        [b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]],
        rm,
        wMin,
        wMax,
      );
    }
  }
  if (!Number.isFinite(wMin[0])) {
    wMin[0] = wMin[1] = wMin[2] = -1;
    wMax[0] = wMax[1] = wMax[2] = 1;
  }

  const cx = (wMin[0] + wMax[0]) * 0.5;
  const cy = (wMin[1] + wMax[1]) * 0.5;
  const cz = (wMin[2] + wMax[2]) * 0.5;
  const hx = Math.max(0.03, (wMax[0] - wMin[0]) * 0.5);
  const hy = Math.max(0.03, (wMax[1] - wMin[1]) * 0.5);
  const hz = Math.max(0.03, (wMax[2] - wMin[2]) * 0.5);
  return {
    center: [cx, cy, cz],
    radius: Math.max(0.05, Math.hypot(hx, hy, hz)),
    min: [cx - hx, cy - hy, cz - hz],
    max: [cx + hx, cy + hy, cz + hz],
  };
}

/**
 * Fits a tight OpenGL clip-space (`z in [-1, 1]`) orthographic view-projection
 * matrix around `worldBounds` for a directional light whose `dirToLight` vector
 * points toward the light source.
 */
export function fitDirectionalShadowMatrix(
  out: Float32Array,
  dirToLight: readonly number[],
  worldBounds: WorldSceneBounds,
): Float32Array {
  let ux = Number(dirToLight[0]) || 0;
  let uy = Number(dirToLight[1]) || 0;
  let uz = Number(dirToLight[2]) || 0;
  const len = Math.hypot(ux, uy, uz);
  if (len > 1e-6) {
    ux /= len;
    uy /= len;
    uz /= len;
  } else {
    ux = 0.37139067;
    uy = 0.74278135;
    uz = 0.59422508;
  }

  const r = Math.max(0.05, worldBounds.radius);
  const [cx, cy, cz] = worldBounds.center;
  const dist = r * 2.2;
  const eye: [number, number, number] = [
    cx + ux * dist,
    cy + uy * dist,
    cz + uz * dist,
  ];
  const up: [number, number, number] =
    Math.abs(uy) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  mat4LookAt(_lookView, eye, worldBounds.center, up);

  const vMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const vMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  expandWorldAabbByMatrix(
    [...worldBounds.min, ...worldBounds.max],
    _lookView,
    vMin,
    vMax,
  );

  const pad = Math.max(0.02, r * 0.05);
  const near = Math.max(0.01, -vMax[2] - pad);
  const far = Math.max(near + 0.1, -vMin[2] + pad);
  mat4Ortho(
    _projMat,
    vMin[0] - pad,
    Math.max(vMin[0] + 0.05, vMax[0]) + pad,
    vMin[1] - pad,
    Math.max(vMin[1] + 0.05, vMax[1]) + pad,
    near,
    far,
  );
  return mat4Multiply(out, _projMat, _lookView);
}

/**
 * Fits a tight OpenGL clip-space (`z in [-1, 1]`) perspective view-projection
 * matrix for a spot (or 120-degree point) light at `pos` shining along `rayDir`.
 */
export function fitSpotShadowMatrix(
  out: Float32Array,
  pos: readonly number[],
  rayDir: readonly number[],
  outerConeRad: number,
  range: number | undefined,
  worldBounds: WorldSceneBounds,
): Float32Array {
  const px = Number(pos[0]) || 0;
  const py = Number(pos[1]) || 0;
  const pz = Number(pos[2]) || 0;
  let rx = Number(rayDir[0]) || 0;
  let ry = Number(rayDir[1]) || 0;
  let rz = Number(rayDir[2]) || 0;
  let rLen = Math.hypot(rx, ry, rz);
  if (rLen <= 1e-6) {
    rx = worldBounds.center[0] - px;
    ry = worldBounds.center[1] - py;
    rz = worldBounds.center[2] - pz;
    rLen = Math.hypot(rx, ry, rz);
  }
  if (rLen > 1e-6) {
    rx /= rLen;
    ry /= rLen;
    rz /= rLen;
  } else {
    rx = 0;
    ry = -1;
    rz = 0;
  }

  const up: [number, number, number] =
    Math.abs(ry) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  mat4LookAt(_lookView, [px, py, pz], [px + rx, py + ry, pz + rz], up);

  const vMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const vMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  expandWorldAabbByMatrix(
    [...worldBounds.min, ...worldBounds.max],
    _lookView,
    vMin,
    vMax,
  );
  const minD = -vMax[2];
  const maxD = -vMin[2];

  const r = Math.max(0.05, worldBounds.radius);
  const centerDist = Math.hypot(
    worldBounds.center[0] - px,
    worldBounds.center[1] - py,
    worldBounds.center[2] - pz,
  );
  const rawFar = Math.max(0.5, maxD + r * 0.25, centerDist + r);
  const far =
    range && range > 0 ? Math.max(0.25, Math.min(range, rawFar)) : rawFar;
  const nearFloor = Math.max(0.02, far / 1500);
  const near = Math.min(
    far * 0.4,
    Math.max(nearFloor, Number.isFinite(minD) ? minD - r * 0.05 : nearFloor),
  );
  const fov = Math.max(0.08, Math.min(2.35, outerConeRad * 2 * 1.04));
  mat4Perspective(_projMat, fov, 1, near, Math.max(near + 0.1, far));
  return mat4Multiply(out, _projMat, _lookView);
}

/** Parses CAD section-plane clipping state on `viewer` (shared with WebGPU). */
export function resolveShadowSectionPlane(viewerObj: unknown): {
  enabled: boolean;
  normal: [number, number, number];
  constant: number;
} | null {
  const viewer = (viewerObj || {}) as ShadowViewerLike;
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
    const match =
      /^([+-]?[xyz])\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/.exec(raw);
    if (!match) return null;
    const sign = match[1].startsWith('-') ? -1 : 1;
    const axis = match[1].replace(/^[+-]/, '');
    const val = Math.max(-1000, Math.min(1000, Number(match[2]) || 0));
    localN =
      axis === 'x' ? [sign, 0, 0] : axis === 'y' ? [0, sign, 0] : [0, 0, sign];
    localC = val * sign;
  }
  const rm = viewer.modelRootMatrix ?? IDENTITY_MAT4;
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

function isShadowEligibleMesh(mesh: ShadowMeshLike): boolean {
  if (mesh.visible === false || mesh.isPluginMesh) return false;
  if (
    mesh.name === '__contact_shadow__' ||
    mesh.name === '__xr_reticle__' ||
    mesh.name === '__xr_section_gizmo__'
  ) {
    return false;
  }
  const xr = mesh.extras?.xr ?? mesh.userData?.xr;
  if (xr?.['splatUrl'] || xr?.['splat']) return false;
  return true;
}

/** Returns true when `mesh` should cast shadows under `promoteAllCasters`. */
export function doesMeshCastShadow(
  mesh: ShadowMeshLike,
  promoteAllCasters: boolean,
): boolean {
  if (!isShadowEligibleMesh(mesh)) return false;
  const explicit = mesh.castShadow ?? mesh.extras?.shadow?.cast;
  if (explicit === false) return false;
  return promoteAllCasters ? true : explicit === true;
}

/** Returns true when `mesh` should receive shadows under `promoteAllReceivers`. */
export function doesMeshReceiveShadow(
  mesh: unknown,
  promoteAllReceivers: boolean,
): boolean {
  if (!mesh || typeof mesh !== 'object') return false;
  const m = mesh as ShadowMeshLike;
  if (!isShadowEligibleMesh(m)) return false;
  const explicit = m.receiveShadow ?? m.extras?.shadow?.receive;
  if (explicit !== undefined) return Boolean(explicit);
  return promoteAllReceivers;
}

function isOpaqueShadowPrim(prim: ShadowPrimLike): boolean {
  if (prim.isTransmissive) return false;
  if (prim.alphaMode === 'BLEND') return false;
  if ((prim.baseColor?.[3] ?? 1) < 0.98) return false;
  return true;
}

function hashU32(h: number, v: number): number {
  return Math.imul((h ^ (v >>> 0)) >>> 0, 16777619) >>> 0;
}

function hashF32(h: number, v: number): number {
  _f32HashBuf[0] = v || 0;
  return hashU32(h, _u32HashView[0]);
}

function hashF32Array(h: number, arr: ArrayLike<number>, limit = 64): number {
  const n = arr.length;
  h = hashU32(h, n);
  if (n <= limit) {
    for (let i = 0; i < n; i++) h = hashF32(h, arr[i]);
  } else {
    const step = Math.max(1, Math.floor(n / limit));
    for (let i = 0; i < n; i += step) h = hashF32(h, arr[i]);
    h = hashF32(h, arr[n - 1]);
  }
  return h;
}

/**
 * Resolves active shadow-casting lights (aligned with `ThreeView.bindLights` &
 * `writeSceneUniforms` directional/point slots), tight frustums, scale-invariant
 * biases, and an FNV-1a dirty digest over caster transforms + light state.
 */
export function resolveActiveShadowLights(
  viewerObj: unknown,
): ResolvedShadowPlan {
  const viewer = (viewerObj || {}) as ShadowViewerLike;
  const rawMode =
    viewer.shadowMaps ??
    viewer.container?.getAttribute?.('shadow-maps') ??
    'auto';
  const mode = normalizeShadowMapsMode(rawMode);
  const dirSlots: [number, number] = [-1, -1];
  const ptSlots: [number, number] = [-1, -1];
  const emptyPlan = (promote = false): ResolvedShadowPlan => ({
    mode,
    mapSize: 0,
    slices: [],
    dirSlots,
    ptSlots,
    promoteAllCasters: promote,
    promoteAllReceivers: promote,
    digest: 0,
    sectionPlane: null,
  });

  if (mode === 'off') return emptyPlan();

  interface PendingLight {
    readonly kind: 'directional' | 'spot' | 'point';
    readonly subIdx: number;
    readonly light: ShadowLightLike;
  }
  const pending: PendingLight[] = [];
  let firstDir: ShadowLightLike | null = null;
  let firstPt: {kind: 'spot' | 'point'; light: ShadowLightLike} | null = null;
  let hasHemi = false;
  let dirIdx = 0;
  let ptIdx = 0;

  for (const l of viewer.lights ?? []) {
    if (l.type === 'hemisphere') {
      hasHemi = true;
    } else if (l.type === 'directional' && dirIdx < 2) {
      if (!firstDir) firstDir = l;
      if (l.shadow?.cast && pending.length < MAX_SHADOW_LIGHTS) {
        pending.push({kind: 'directional', subIdx: dirIdx, light: l});
      }
      dirIdx++;
    } else if ((l.type === 'spot' || l.type === 'point') && ptIdx < 2) {
      if (!firstPt) firstPt = {kind: l.type, light: l};
      if (l.shadow?.cast && pending.length < MAX_SHADOW_LIGHTS) {
        pending.push({kind: l.type, subIdx: ptIdx, light: l});
      }
      ptIdx++;
    }
  }

  if (mode === 'pcf' && pending.length === 0) {
    if (firstDir) {
      pending.push({kind: 'directional', subIdx: 0, light: firstDir});
    } else if (!hasHemi) {
      pending.push({
        kind: 'directional',
        subIdx: 0,
        light: {type: 'directional', direction: [0.5, 1.0, 0.8]},
      });
    } else if (firstPt) {
      pending.push({kind: firstPt.kind, subIdx: 0, light: firstPt.light});
    }
  }

  if (pending.length === 0) return emptyPlan();

  const meshes = viewer.meshes ?? [];
  let hasExplicitMeshShadow = false;
  for (const m of meshes) {
    if (
      m.castShadow !== undefined ||
      m.receiveShadow !== undefined ||
      m.extras?.shadow !== undefined
    ) {
      hasExplicitMeshShadow = true;
      break;
    }
  }
  const promoteAllCasters = mode === 'pcf' || !hasExplicitMeshShadow;
  const promoteAllReceivers = promoteAllCasters;

  // Verify at least one eligible opaque caster exists before allocating VRAM.
  let hasAnyCaster = false;
  for (const m of meshes) {
    if (!doesMeshCastShadow(m, promoteAllCasters)) continue;
    for (const p of m.primitives ?? []) {
      if (isOpaqueShadowPrim(p) && p.indexCount > 0) {
        hasAnyCaster = true;
        break;
      }
    }
    if (hasAnyCaster) break;
  }
  if (!hasAnyCaster) return emptyPlan(promoteAllCasters);

  let requestedSize = 1024;
  for (const item of pending) {
    const req = item.light.shadow?.mapSize;
    if (typeof req === 'number' && Number.isFinite(req)) {
      requestedSize = Math.max(requestedSize, Math.round(req));
    }
  }
  let mapSize = Math.max(256, Math.min(2048, requestedSize));
  const layerCount = pending.length;
  while (
    mapSize > 256 &&
    mapSize * mapSize * layerCount * 4 > MAX_ARRAY_VRAM_BYTES
  ) {
    mapSize = Math.max(256, mapSize >> 1);
  }

  const worldBounds = computeWorldSceneBounds(viewer);
  const texelWorld = (worldBounds.radius * 2.2) / mapSize;
  const slices: ResolvedShadowSlice[] = [];

  for (let slot = 0; slot < pending.length; slot++) {
    const item = pending[slot];
    const l = item.light;
    const sh = l.shadow;
    const vp = mat4Create();
    let rayDir: [number, number, number];

    if (item.kind === 'directional') {
      dirSlots[item.subIdx] = slot;
      const d = l.direction ?? [0.5, 1.0, 0.8];
      const dl = Math.hypot(d[0] ?? 0.5, d[1] ?? 1, d[2] ?? 0.8) || 1;
      rayDir = [-(d[0] ?? 0.5) / dl, -(d[1] ?? 1) / dl, -(d[2] ?? 0.8) / dl];
      fitDirectionalShadowMatrix(vp, d, worldBounds);
    } else {
      ptSlots[item.subIdx] = slot;
      const pos = l.position ?? [0, 2, 0];
      if (item.kind === 'spot') {
        const sd = l.direction ?? [0, -1, 0];
        const sl = Math.hypot(sd[0] ?? 0, sd[1] ?? -1, sd[2] ?? 0) || 1;
        rayDir = [(sd[0] ?? 0) / sl, (sd[1] ?? -1) / sl, (sd[2] ?? 0) / sl];
        const outer = Math.max(
          0.02,
          Math.min(Math.PI / 2, l.outerConeAngle ?? Math.PI / 3),
        );
        fitSpotShadowMatrix(vp, pos, rayDir, outer, l.range, worldBounds);
      } else {
        const dx = worldBounds.center[0] - (pos[0] ?? 0);
        const dy = worldBounds.center[1] - (pos[1] ?? 0);
        const dz = worldBounds.center[2] - (pos[2] ?? 0);
        const dl = Math.hypot(dx, dy, dz);
        rayDir = dl > 1e-6 ? [dx / dl, dy / dl, dz / dl] : [0, -1, 0];
        fitSpotShadowMatrix(vp, pos, rayDir, Math.PI / 3, l.range, worldBounds);
      }
    }

    const rawBias = clampShd(sh?.bias, -0.05, 0.05, -0.0005);
    const rawNormalBias = clampShd(sh?.normalBias, 0, 0.5, 0.015);
    const rawRadius = clampShd(sh?.radius, 0, 16, 1.5);

    slices.push({
      slot,
      viewProj: vp,
      rayDir,
      depthBias: rawBias,
      normalBiasWorld: (rawNormalBias / 0.015) * 1.75 * texelWorld,
      uvRadius: (rawRadius * 1.35) / mapSize,
    });
  }

  const sectionPlane = resolveShadowSectionPlane(viewer);
  let h = 2166136261;
  h = hashU32(h, mode === 'pcf' ? 2 : 1);
  h = hashU32(h, mapSize);
  h = hashU32(h, slices.length);
  for (const s of slices) {
    h = hashF32Array(h, s.viewProj, 16);
    h = hashF32(h, s.depthBias);
    h = hashF32(h, s.normalBiasWorld);
  }
  if (sectionPlane?.enabled) {
    h = hashU32(h, 1);
    h = hashF32(h, sectionPlane.normal[0]);
    h = hashF32(h, sectionPlane.normal[1]);
    h = hashF32(h, sectionPlane.normal[2]);
    h = hashF32(h, sectionPlane.constant);
  } else {
    h = hashU32(h, 0);
  }
  const rm = viewer.modelRootMatrix ?? IDENTITY_MAT4;
  h = hashF32Array(h, rm, 16);
  let casterIdx = 0;
  for (const m of meshes) {
    if (!doesMeshCastShadow(m, promoteAllCasters)) {
      casterIdx++;
      continue;
    }
    h = hashU32(h, casterIdx++);
    h = hashF32Array(h, m.transform, 16);
    if (m.instanceMatrices) h = hashF32Array(h, m.instanceMatrices, 64);
    for (const p of m.primitives ?? []) {
      if (!isOpaqueShadowPrim(p)) continue;
      h = hashU32(h, p.indexCount);
      if (p.translations) h = hashF32Array(h, p.translations, 48);
    }
  }
  if (h === 0) h = 1;

  return {
    mode,
    mapSize,
    slices,
    dirSlots,
    ptSlots,
    promoteAllCasters,
    promoteAllReceivers,
    digest: h,
    sectionPlane,
  };
}

/** Returns shadow-map pass & cache-hit diagnostics for `viewer`. */
export function getShadowMapStats(viewer: object): ShadowMapStats {
  const st = viewerStates.get(viewer);
  if (!st) {
    return {renderedPasses: 0, cacheHits: 0, activeLights: 0, mapSize: 0};
  }
  return {
    renderedPasses: st.renderedPasses,
    cacheHits: st.cacheHits,
    activeLights: st.activeLights,
    mapSize: st.allocSize,
  };
}

const VS_SHADOW_DEPTH = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=3) in vec3 aOff;
layout(location=8) in vec4 aInst0;
layout(location=9) in vec4 aInst1;
layout(location=10) in vec4 aInst2;
layout(location=11) in vec4 aInst3;
uniform mat4 uLightVP,uModel;
uniform vec4 uBiasRay;
uniform int uInstanced;
out vec3 vWorldPos;
void main(){
mat4 m=uInstanced==1?uModel*mat4(aInst0,aInst1,aInst2,aInst3):uModel;
vec4 wp=m*vec4(aPos+aOff,1.0);
vec3 wn=mat3(m)*aNormal;
float nl=length(wn);
if(nl>1e-5&&uBiasRay.w>0.0){
wn/=nl;
wp.xyz+=wn*(uBiasRay.w*max(1.0-abs(dot(wn,uBiasRay.xyz)),0.15));
}
vWorldPos=wp.xyz;
gl_Position=uLightVP*wp;
}`;

const FS_SHADOW_DEPTH = `#version 300 es
precision highp float;
in vec3 vWorldPos;
uniform vec4 uSecPlane;
uniform int uSecOn;
void main(){
if(uSecOn==1&&dot(vWorldPos,uSecPlane.xyz)>uSecPlane.w)discard;
}`;

const SHD_UNIFORMS_GLSL = `
uniform highp sampler2DArrayShadow uShadowMap;
uniform mat4 uShadowVP[4];
uniform vec4 uShadowParams[4];
uniform int uDirShdSlot[2],uPtShdSlot[2],uReceiveShadow;
const vec2 _VD[8]=vec2[8](
vec2(0.1768,0.0),vec2(-0.2265,0.2078),vec2(0.0355,-0.4150),vec2(0.3204,0.3888),
vec2(-0.5562,-0.1455),vec2(0.4916,-0.3806),vec2(-0.1419,0.6596),vec2(-0.5177,-0.5150));
float shdEval(int s,vec3 wp,vec3 N,vec3 L){
if(s<0||uReceiveShadow==0)return 1.0;
float nl=dot(N,L);
if(nl<=0.0)return 0.0;
mat4 vp=s==0?uShadowVP[0]:s==1?uShadowVP[1]:s==2?uShadowVP[2]:uShadowVP[3];
vec4 p=s==0?uShadowParams[0]:s==1?uShadowParams[1]:s==2?uShadowParams[2]:uShadowParams[3];
vec4 sc=vp*vec4(wp+N*(p.y*(1.0-nl)),1.0);
if(sc.w<=1e-6)return 1.0;
vec3 u=sc.xyz/sc.w*0.5+0.5;
if(u.x<=0.002||u.x>=0.998||u.y<=0.002||u.y>=0.998||u.z>1.0||u.z<0.0)return 1.0;
float rz=clamp(u.z+p.x,0.0,1.0);
if(p.z<=1e-6)return texture(uShadowMap,vec4(u.xy,float(s),rz));
float a=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))*6.2831853;
float ca=cos(a),sa=sin(a),sum=0.0;
mat2 rot=mat2(ca,sa,-sa,ca);
for(int k=0;k<8;k++)sum+=texture(uShadowMap,vec4(u.xy+rot*_VD[k]*p.z,float(s),rz));
return sum*0.125;
}`;

const SHADOW_UNIFORM_NAMES = [
  'uShadowMap',
  'uShadowVP',
  'uShadowParams',
  'uDirShdSlot',
  'uPtShdSlot',
  'uReceiveShadow',
] as const;

function getViewerGLState(viewer: object): ViewerShadowGLState {
  let st = viewerStates.get(viewer);
  if (!st) {
    st = {
      texArray: null,
      fbo: null,
      allocSize: 0,
      allocLayers: 0,
      lastDigest: 0,
      renderedPasses: 0,
      cacheHits: 0,
      activeLights: 0,
      vpFlat: new Float32Array(64),
      paramsFlat: new Float32Array(16),
      dirSlots: new Int32Array([-1, -1]),
      ptSlots: new Int32Array([-1, -1]),
      promoteAllReceivers: false,
    };
    viewerStates.set(viewer, st);
  }
  return st;
}

function allocDepthCompareArray(
  gl: WebGL2RenderingContext,
  size: number,
  layers: number,
): WebGLTexture | null {
  const tex = gl.createTexture?.();
  if (!tex) return null;
  const target = gl.TEXTURE_2D_ARRAY || 35866;
  gl.bindTexture(target, tex);
  if (typeof gl.texStorage3D === 'function') {
    gl.texStorage3D(
      target,
      1,
      gl.DEPTH_COMPONENT24 || 33190,
      size,
      size,
      layers,
    );
  } else if (typeof gl.texImage3D === 'function') {
    gl.texImage3D(
      target,
      0,
      gl.DEPTH_COMPONENT24 || 33190,
      size,
      size,
      layers,
      0,
      gl.DEPTH_COMPONENT || 6402,
      gl.UNSIGNED_INT || 5125,
      null,
    );
  } else {
    gl.deleteTexture?.(tex);
    return null;
  }
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(
    target,
    gl.TEXTURE_COMPARE_MODE || 34892,
    gl.COMPARE_REF_TO_TEXTURE || 34894,
  );
  gl.texParameteri(target, gl.TEXTURE_COMPARE_FUNC || 34893, gl.LEQUAL || 515);
  return tex;
}

function ensureContextShared(gl: WebGL2RenderingContext): ContextShadowShared {
  let shared = contextShared.get(gl);
  if (
    shared &&
    (shared.prog === null || gl.isProgram?.(shared.prog) !== false)
  ) {
    return shared;
  }

  let prog: WebGLProgram | null = null;
  const vs = gl.createShader?.(gl.VERTEX_SHADER);
  const fs = gl.createShader?.(gl.FRAGMENT_SHADER);
  if (vs && fs) {
    gl.shaderSource(vs, VS_SHADOW_DEPTH);
    gl.compileShader(vs);
    gl.shaderSource(fs, FS_SHADOW_DEPTH);
    gl.compileShader(fs);
    const p = gl.createProgram();
    if (p) {
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.detachShader?.(p, vs);
      gl.detachShader?.(p, fs);
      if (gl.getProgramParameter(p, gl.LINK_STATUS) !== false) {
        prog = p;
      } else {
        gl.deleteProgram(p);
      }
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }

  shared = {
    prog,
    uLightVP: prog ? gl.getUniformLocation(prog, 'uLightVP') : null,
    uModel: prog ? gl.getUniformLocation(prog, 'uModel') : null,
    uBiasRay: prog ? gl.getUniformLocation(prog, 'uBiasRay') : null,
    uInstanced: prog ? gl.getUniformLocation(prog, 'uInstanced') : null,
    uSecPlane: prog ? gl.getUniformLocation(prog, 'uSecPlane') : null,
    uSecOn: prog ? gl.getUniformLocation(prog, 'uSecOn') : null,
    dummyArrayTex: allocDepthCompareArray(gl, 1, 1),
  };
  contextShared.set(gl, shared);
  return shared;
}

const shadowShaderChunk: ShadowMapShaderChunk = {
  uniformsGLSL: SHD_UNIFORMS_GLSL,
  dirGLSL: '*shdEval(uDirShdSlot[i],vWorldPos,N,normalize(uDirLightDir[i]))',
  ptGLSL: '*shdEval(uPtShdSlot[i],vWorldPos,N,L)',
  uniformNames: SHADOW_UNIFORM_NAMES,

  bind(
    gl: WebGL2RenderingContext,
    u: Record<string, WebGLUniformLocation | null>,
    viewerObj: unknown,
    meshObj: unknown,
  ): void {
    const uMap = u['uShadowMap'];
    if (uMap === undefined) return;
    const st =
      viewerObj && typeof viewerObj === 'object'
        ? viewerStates.get(viewerObj)
        : undefined;
    const shared = ensureContextShared(gl);
    const active = Boolean(st && st.activeLights > 0 && st.texArray);
    const tex = active ? st!.texArray : shared.dummyArrayTex;
    if (tex) {
      gl.activeTexture(gl.TEXTURE9 || 33993);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY || 35866, tex);
    }
    if (uMap) gl.uniform1i(uMap, SHADOW_MAP_TEXTURE_UNIT);
    const uDir = u['uDirShdSlot'];
    const uPt = u['uPtShdSlot'];
    const uRecv = u['uReceiveShadow'];
    if (!active) {
      if (uDir) gl.uniform1iv?.(uDir, INACTIVE_SLOTS);
      if (uPt) gl.uniform1iv?.(uPt, INACTIVE_SLOTS);
      if (uRecv) gl.uniform1i?.(uRecv, 0);
      return;
    }
    if (uDir) gl.uniform1iv?.(uDir, st!.dirSlots);
    if (uPt) gl.uniform1iv?.(uPt, st!.ptSlots);
    const uVP = u['uShadowVP'];
    if (uVP) gl.uniformMatrix4fv?.(uVP, false, st!.vpFlat);
    const uParams = u['uShadowParams'];
    if (uParams) gl.uniform4fv?.(uParams, st!.paramsFlat);
    if (uRecv) {
      gl.uniform1i?.(
        uRecv,
        doesMeshReceiveShadow(meshObj, st!.promoteAllReceivers) ? 1 : 0,
      );
    }
  },
};

function drawShadowPrim(
  gl: WebGL2RenderingContext,
  prim: ShadowPrimLike,
): void {
  if (prim.indices) {
    gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, prim.indexCount);
  }
}

/**
 * Real-time Multi-Light Depth Shadow Maps plugin (`<three-live shadow-maps>`).
 */
export const shadowMapsPlugin: ThreeLivePlugin = {
  name: 'shadow-maps',

  onRegister(): void {
    getSharedRegistry().shadowMapShader = shadowShaderChunk;
  },

  onLoadModel(viewer: unknown): void {
    if (viewer && typeof viewer === 'object') {
      const st = viewerStates.get(viewer);
      if (st) st.lastDigest = 0;
    }
  },

  onClearScene(viewer: unknown): void {
    if (viewer && typeof viewer === 'object') {
      const st = viewerStates.get(viewer);
      if (st) {
        st.lastDigest = 0;
        st.activeLights = 0;
      }
    }
  },

  onContextRestored(gl: WebGL2RenderingContext, viewer: unknown): void {
    contextShared.delete(gl);
    if (viewer && typeof viewer === 'object') {
      const st = viewerStates.get(viewer);
      if (st) {
        st.texArray = null;
        st.fbo = null;
        st.allocSize = 0;
        st.allocLayers = 0;
        st.lastDigest = 0;
        st.activeLights = 0;
      }
    }
  },

  onDestroy(gl: WebGL2RenderingContext, viewer?: unknown): void {
    if (viewer && typeof viewer === 'object') {
      const st = viewerStates.get(viewer);
      if (st) {
        if (st.texArray) gl.deleteTexture?.(st.texArray);
        if (st.fbo) gl.deleteFramebuffer?.(st.fbo);
        viewerStates.delete(viewer);
      }
    } else if (gl) {
      const shared = contextShared.get(gl);
      if (shared) {
        if (shared.prog) gl.deleteProgram?.(shared.prog);
        if (shared.dummyArrayTex) gl.deleteTexture?.(shared.dummyArrayTex);
        contextShared.delete(gl);
      }
    }
  },

  onBeforeDrawScene(viewerObj: unknown, gl: WebGL2RenderingContext): void {
    if (!viewerObj || typeof viewerObj !== 'object') return;
    const viewer = viewerObj as ShadowViewerLike;
    const reg = getSharedRegistry();
    if (!reg.shadowMapShader) {
      reg.shadowMapShader = shadowShaderChunk;
    }
    if (viewer.uRender && !('uShadowMap' in viewer.uRender)) {
      viewer.recompileRenderProgram?.();
    }
    // Skip redundant WebGL2 depth passes when WebGPU owns scene rendering.
    if (reg.gpuSceneAccelerator?.willRenderScene?.(viewerObj)) {
      return;
    }

    const st = getViewerGLState(viewerObj);
    const plan = resolveActiveShadowLights(viewer);
    st.promoteAllReceivers = plan.promoteAllReceivers;
    st.dirSlots[0] = plan.dirSlots[0];
    st.dirSlots[1] = plan.dirSlots[1];
    st.ptSlots[0] = plan.ptSlots[0];
    st.ptSlots[1] = plan.ptSlots[1];

    if (
      plan.slices.length === 0 ||
      typeof gl.framebufferTextureLayer !== 'function'
    ) {
      st.activeLights = 0;
      return;
    }

    const shared = ensureContextShared(gl);
    if (!shared.prog) {
      st.activeLights = 0;
      return;
    }

    const neededLayers = plan.slices.length;
    const resized =
      !st.texArray ||
      !st.fbo ||
      st.allocSize !== plan.mapSize ||
      st.allocLayers < neededLayers;
    if (resized) {
      if (st.texArray) gl.deleteTexture?.(st.texArray);
      const allocLayers = Math.max(st.allocLayers, neededLayers);
      st.texArray = allocDepthCompareArray(gl, plan.mapSize, allocLayers);
      if (!st.fbo) st.fbo = gl.createFramebuffer?.() ?? null;
      if (!st.texArray || !st.fbo) {
        st.activeLights = 0;
        return;
      }
      st.allocSize = plan.mapSize;
      st.allocLayers = allocLayers;
      st.lastDigest = 0;
    }

    st.activeLights = neededLayers;
    st.vpFlat.fill(0);
    st.paramsFlat.fill(0);
    for (const s of plan.slices) {
      st.vpFlat.set(s.viewProj, s.slot * 16);
      const b = s.slot * 4;
      st.paramsFlat[b] = s.depthBias;
      st.paramsFlat[b + 1] = s.normalBiasWorld * 0.5;
      st.paramsFlat[b + 2] = s.uvRadius;
    }

    if (st.lastDigest === plan.digest) {
      st.cacheHits++;
      return;
    }
    st.lastDigest = plan.digest;

    const prevFbo =
      (gl.getParameter?.(
        gl.FRAMEBUFFER_BINDING || 36006,
      ) as WebGLFramebuffer | null) ?? null;
    const rawVp = gl.getParameter?.(gl.VIEWPORT || 2978) as
      | Int32Array
      | number[]
      | null;
    const prevVp: [number, number, number, number] =
      rawVp && rawVp.length >= 4
        ? [rawVp[0], rawVp[1], rawVp[2], rawVp[3]]
        : [
            0,
            0,
            Math.max(1, viewer.canvas?.width || 1),
            Math.max(1, viewer.canvas?.height || 1),
          ];

    const rm = viewer.modelRootMatrix ?? IDENTITY_MAT4;
    const meshes = viewer.meshes ?? [];

    gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
    gl.drawBuffers?.([gl.NONE || 0]);
    gl.readBuffer?.(gl.NONE || 0);
    gl.viewport(0, 0, plan.mapSize, plan.mapSize);
    gl.colorMask?.(false, false, false, false);
    gl.depthMask?.(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL || 32823);
    gl.polygonOffset?.(1.5, 4.0);
    gl.useProgram(shared.prog);

    if (shared.uSecOn) {
      if (plan.sectionPlane?.enabled) {
        gl.uniform1i(shared.uSecOn, 1);
        if (shared.uSecPlane) {
          gl.uniform4f(
            shared.uSecPlane,
            plan.sectionPlane.normal[0],
            plan.sectionPlane.normal[1],
            plan.sectionPlane.normal[2],
            plan.sectionPlane.constant,
          );
        }
      } else {
        gl.uniform1i(shared.uSecOn, 0);
      }
    }

    for (const slice of plan.slices) {
      gl.framebufferTextureLayer(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        st.texArray,
        0,
        slice.slot,
      );
      gl.clear(gl.DEPTH_BUFFER_BIT);
      if (shared.uLightVP) {
        gl.uniformMatrix4fv(shared.uLightVP, false, slice.viewProj);
      }
      if (shared.uBiasRay) {
        gl.uniform4f(
          shared.uBiasRay,
          slice.rayDir[0],
          slice.rayDir[1],
          slice.rayDir[2],
          slice.normalBiasWorld,
        );
      }

      for (const mesh of meshes) {
        if (!doesMeshCastShadow(mesh, plan.promoteAllCasters)) continue;
        if (mesh.worldSpace === true) {
          _modelScratch.set(mesh.transform);
        } else {
          mat4Multiply(_modelScratch, rm, mesh.transform);
        }
        const instMats = mesh.instanceMatrices;

        for (const prim of mesh.primitives ?? []) {
          if (!prim.vao || prim.indexCount <= 0 || !isOpaqueShadowPrim(prim)) {
            continue;
          }
          gl.bindVertexArray(prim.vao);
          gl.vertexAttrib3f?.(3, 0, 0, 0);
          if (shared.uInstanced) gl.uniform1i(shared.uInstanced, 0);
          if (shared.uModel) {
            gl.uniformMatrix4fv(shared.uModel, false, _modelScratch);
          }

          if (prim.instanceCount !== undefined) {
            gl.drawElementsInstanced(
              gl.TRIANGLES,
              prim.indexCount,
              prim.indexType,
              0,
              prim.instanceCount,
            );
          } else if (
            instMats &&
            instMats.length >= 16 &&
            prim.instanced &&
            shared.uInstanced
          ) {
            const count = instMats.length >> 4;
            gl.uniform1i(shared.uInstanced, 1);
            if (prim.indices) {
              gl.drawElementsInstanced(
                gl.TRIANGLES,
                prim.indexCount,
                prim.indexType,
                0,
                count,
              );
            } else {
              gl.drawArraysInstanced(gl.TRIANGLES, 0, prim.indexCount, count);
            }
            gl.uniform1i(shared.uInstanced, 0);
          } else if (instMats && instMats.length >= 16) {
            const count = instMats.length >> 4;
            for (let k = 0; k < count; k++) {
              mat4Multiply(
                _instScratch,
                _modelScratch,
                instMats.subarray(k * 16, k * 16 + 16),
              );
              if (shared.uModel) {
                gl.uniformMatrix4fv(shared.uModel, false, _instScratch);
              }
              drawShadowPrim(gl, prim);
            }
          } else {
            drawShadowPrim(gl, prim);
          }
        }
      }
      st.renderedPasses++;
    }

    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL || 32823);
    gl.colorMask?.(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
  },
};
