/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Architecture / AEC Domain Kit (`architectureKitPlugin` /
 * `THREE.Architecture`).
 *
 * Self-contained watertight 2-manifold `BufferGeometry` generators for building,
 * interior, BIM, RoomPlan, and simulation-greybox elements:
 * - `WallGeometry` (walls with rectangular, semicircular, segmental & pointed Gothic openings, segmented baseboards & cornices)
 * - `SlabGeometry` (horizontal floor, ceiling & balcony slabs with stairwell/atrium shaft cutouts)
 * - `StaircaseGeometry` (IBC code-compliant straight, L-landing, U-switchback, and spiral stairs with left/right turn handing)
 * - `RoofGeometry` (gable, hip, shed, mansard, gambrel, and flat-parapet roofs with overhangs & vaulted shells)
 * - `DoorGeometry` (swing, patio multi-slide OX/XO/OXXO, exposed-rail barn, split-jamb pocket & bifold doors across 10 panel/lite styles + hardware)
 * - `WindowGeometry` (fixed, picture, single-hung, double-hung, OX/XO/XOX/OXXO slider, casement, awning, hopper, mullion-grid & arched windows)
 * - `RailingGeometry` (IBC code-spaced baluster, horizontal-bar, and panel guardrails)
 * - `ColumnGeometry` (Tuscan/Doric classical entasis, fluted, square-pilaster, and H-columns)
 * - `ArchwayGeometry` (semicircular Roman, segmental, and pointed Gothic masonry portals)
 * - `codeStairSpec` (IBC 7-11 riser/tread calculator)
 *
 * NOTE: `installArchitectureKit` is serialized via `Function.prototype.toString()`
 * into sandboxed Web Workers and embedded in `three-author-engine.js`. Keep its
 * body 100% self-contained (no module-scoped runtime closures or ES2022 class fields).
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/** Maximum stair risers per staircase geometry. */
export const MAX_ARCH_STEPS = 128;
/** Maximum window/door openings per wall segment. */
export const MAX_ARCH_OPENINGS = 64;
/** Maximum balusters or mullions per architectural assembly. */
export const MAX_ARCH_PICKETS = 256;
/** Maximum radial/arc segments on columns and arches. */
export const MAX_ARCH_SEGMENTS = 128;

/** Computed IBC stair layout returned by `THREE.Architecture.codeStairSpec`. */
export interface StairCodeSpec {
  readonly steps: number;
  readonly riserHeight: number;
  readonly treadDepth: number;
  readonly totalRise: number;
  readonly totalRun: number;
  readonly slopeDeg: number;
  readonly ibcCompliant: boolean;
  valueOf(): number;
}

/** One door or window cutout inside `WallGeometry`. */
export interface WallOpeningSpec {
  /** Horizontal center along the wall (`0` = wall midpoint, meters). */
  x?: number;
  /** Sill height above floor `y = 0` (`0` for doors, e.g. `0.9` for windows). */
  y?: number;
  sillHeight?: number;
  /** Opening clear width in meters (defaults to `0.9`). */
  width?: number;
  /** Opening clear height in meters, including arch rise when `arch` is set. */
  height?: number;
  /** Optional arched top (`true` / `'semicircular'`, `'segmental'`, `'pointed'`, or `'none'`). */
  arch?: boolean | 'semicircular' | 'segmental' | 'pointed' | 'none';
}

/** One stairwell, elevator, or skylight shaft opening inside `SlabGeometry`. */
export interface SlabOpeningSpec {
  shape?: 'rect' | 'circle';
  x?: number;
  z?: number;
  width?: number;
  depth?: number;
  radius?: number;
}

/** Options for `THREE.Architecture.SlabGeometry`. */
export interface SlabOptions {
  width?: number;
  depth?: number;
  length?: number;
  thickness?: number;
  openings?: readonly SlabOpeningSpec[];
  origin?: 'top' | 'bottom' | 'center';
}

/** Options for `THREE.Architecture.WallGeometry`. */
export interface WallOptions {
  length?: number;
  width?: number;
  height?: number;
  thickness?: number;
  depth?: number;
  openings?: readonly WallOpeningSpec[];
  baseboardHeight?: number;
  baseboardProjection?: number;
  corniceHeight?: number;
  corniceProjection?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Architecture.StaircaseGeometry`. */
export interface StaircaseOptions {
  mode?: 'straight' | 'l-shape' | 'u-shape' | 'spiral';
  turn?: 'left' | 'right';
  rise?: number;
  height?: number;
  width?: number;
  treadDepth?: number;
  maxRiserHeight?: number;
  treadThickness?: number;
  nosing?: number;
  solid?: boolean;
  landingDepth?: number;
  flightGap?: number;
  turns?: number;
  innerRadius?: number;
  origin?: 'floor' | 'center';
}

/** Roof silhouette style for `THREE.Architecture.RoofGeometry`. */
export type RoofStyle =
  | 'gable'
  | 'hip'
  | 'shed'
  | 'mansard'
  | 'gambrel'
  | 'flat-parapet';

/** Options for `THREE.Architecture.RoofGeometry`. */
export interface RoofOptions {
  style?: RoofStyle;
  width?: number;
  depth?: number;
  length?: number;
  pitchDeg?: number;
  height?: number;
  overhang?: number;
  thickness?: number;
  fasciaHeight?: number;
  parapetThickness?: number;
  solid?: boolean;
  origin?: 'eave' | 'center';
}

/** Architectural door leaf style. */
export type DoorStyle =
  | 'flush'
  | 'panel-1'
  | 'panel-2'
  | 'panel-4'
  | 'panel-6'
  | 'vision-lite'
  | 'half-lite'
  | 'french'
  | 'louvered'
  | 'arched';

/** Architectural door operation mechanism. */
export type DoorOperation = 'swing' | 'slider' | 'barn' | 'pocket' | 'bifold';

/** Door hardware trim style. */
export type DoorHandleStyle = 'lever' | 'knob' | 'push-bar' | 'pull' | 'none';

/** Options for `THREE.Architecture.DoorGeometry`. */
export interface DoorOptions {
  style?: DoorStyle;
  operation?: DoorOperation;
  leaves?: 1 | 2 | 4;
  hinge?: 'left' | 'right';
  swingDirection?: 'in' | 'out';
  trackPattern?: string;
  slideSide?: 'left' | 'right' | 'bi-parting';
  handle?: DoorHandleStyle;
  width?: number;
  height?: number;
  thickness?: number;
  includeFrame?: boolean;
  frameWidth?: number;
  frameDepth?: number;
  openFraction?: number;
  openAngleDeg?: number;
  origin?: 'floor' | 'center';
}

/** Architectural window style and sash operation. */
export type WindowStyle =
  | 'fixed'
  | 'picture'
  | 'single-hung'
  | 'double-hung'
  | 'slider'
  | 'casement'
  | 'awning'
  | 'hopper'
  | 'mullion-grid'
  | 'arched';

/** Options for `THREE.Architecture.WindowGeometry`. */
export interface WindowOptions {
  style?: WindowStyle;
  width?: number;
  height?: number;
  frameWidth?: number;
  frameDepth?: number;
  openFraction?: number;
  topOpenFraction?: number;
  trackPattern?: string;
  hinge?: 'left' | 'right';
  leaves?: 1 | 2;
  casing?: boolean;
  mullionsX?: number;
  cols?: number;
  mullionsY?: number;
  rows?: number;
  sill?: boolean;
  sillDepth?: number;
  sillThickness?: number;
  origin?: 'center' | 'sill';
}

/** Options for `THREE.Architecture.RailingGeometry`. */
export interface RailingOptions {
  style?: 'baluster' | 'horizontal-bar' | 'panel';
  length?: number;
  height?: number;
  postSpacing?: number;
  balusterSpacing?: number;
  postSize?: number;
  railWidth?: number;
  railHeight?: number;
  horizontalBars?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Architecture.ColumnGeometry`. */
export interface ColumnOptions {
  style?: 'tuscan' | 'doric' | 'fluted' | 'square-pilaster' | 'h-column';
  height?: number;
  radius?: number;
  diameter?: number;
  entasis?: number;
  flutes?: number;
  baseHeight?: number;
  capitalHeight?: number;
  radialSegments?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Architecture.ArchwayGeometry`. */
export interface ArchwayOptions {
  profile?: 'semicircular' | 'segmental' | 'pointed';
  span?: number;
  innerWidth?: number;
  height?: number;
  innerHeight?: number;
  pierWidth?: number;
  crownHeight?: number;
  depth?: number;
  thickness?: number;
  keystone?: boolean;
  impost?: boolean;
  origin?: 'floor' | 'center';
}

/**
 * Self-contained installer attaching `THREE.Architecture` onto a `THREE`
 * namespace and plugin registry.
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installArchitectureKit(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.BufferGeometry || !threeNs.BufferAttribute) {
    return null;
  }
  if (reg?.authorNamespace?.Architecture?.WallGeometry) {
    return {
      Architecture: reg.authorNamespace.Architecture,
    };
  }

  const BufferGeometry = threeNs.BufferGeometry;
  const BufferAttribute = threeNs.BufferAttribute;

  const TAU = Math.PI * 2;
  const MAX_STEPS = 128;
  const MAX_OPENINGS = 64;
  const MAX_PICKETS = 256;
  const MAX_SEGS = 128;

  const num = (v: unknown, fb: number): number => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const clamp = (v: number, lo: number, hi: number): number => {
    const h = hi < lo ? lo : hi;
    return v < lo ? lo : v > h ? h : v;
  };
  const clampInt = (v: unknown, lo: number, hi: number, fb: number): number =>
    clamp(Math.round(num(v, fb)), lo, hi);

  type Pt2 = [number, number];
  interface RawBufs {
    pos: number[];
    nrm: number[];
    uv: number[];
    idx: number[];
  }

  function applyBuffers(
    // tslint:disable-next-line:no-any
    geom: any,
    b: RawBufs,
    typeName: string,
    params: Record<string, unknown>,
  ): void {
    const vCount = (b.pos.length / 3) | 0;
    geom.type = typeName;
    geom.parameters = params;
    geom.userData = geom.userData || {};
    geom.userData.arch = {type: typeName, ...params};
    // tslint:disable-next-line:no-any
    const g = typeof globalThis !== 'undefined' ? (globalThis as any) : null;
    const nF32 = g?.__three_live_native_f32_array__;
    const nIdx = g?.__three_live_native_index_array__;
    const mkF32 = (arr: number[], sz: number) =>
      new BufferAttribute(
        typeof nF32 === 'function' ? nF32(arr) : new Float32Array(arr),
        sz,
      );
    geom.setAttribute('position', mkF32(b.pos, 3));
    geom.setAttribute('normal', mkF32(b.nrm, 3));
    geom.setAttribute('uv', mkF32(b.uv, 2));
    geom.setIndex(
      new BufferAttribute(
        typeof nIdx === 'function'
          ? nIdx(b.idx)
          : new (vCount > 65535 ? Uint32Array : Uint16Array)(b.idx),
        1,
      ),
    );
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const pp = b.pos;
    for (let i = 0; i < pp.length; i += 3) {
      const x = pp[i];
      const y = pp[i + 1];
      const z = pp[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!pp.length) minX = minY = minZ = maxX = maxY = maxZ = 0;
    const V3 = threeNs.Vector3;
    const lo = V3 ? new V3(minX, minY, minZ) : {x: minX, y: minY, z: minZ};
    const hi = V3 ? new V3(maxX, maxY, maxZ) : {x: maxX, y: maxY, z: maxZ};
    geom.boundingBox = {min: lo, max: hi};
  }

  function mergeRaw(parts: readonly RawBufs[]): RawBufs {
    if (parts.length === 0) return {pos: [], nrm: [], uv: [], idx: []};
    if (parts.length === 1) return parts[0];
    let tP = 0;
    let tU = 0;
    let tI = 0;
    for (let k = 0; k < parts.length; k++) {
      tP += parts[k].pos.length;
      tU += parts[k].uv.length;
      tI += parts[k].idx.length;
    }
    const pos = new Array<number>(tP);
    const nrm = new Array<number>(tP);
    const uv = new Array<number>(tU);
    const idx = new Array<number>(tI);
    let pC = 0;
    let uC = 0;
    let iC = 0;
    let vOff = 0;
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      for (let i = 0; i < p.pos.length; i++) {
        pos[pC] = p.pos[i];
        nrm[pC] = p.nrm[i];
        pC++;
      }
      for (let i = 0; i < p.uv.length; i++) uv[uC++] = p.uv[i];
      for (let i = 0; i < p.idx.length; i++) idx[iC++] = p.idx[i] + vOff;
      vOff += (p.pos.length / 3) | 0;
    }
    return {pos, nrm, uv, idx};
  }

  function xformRaw(
    b: RawBufs,
    dx: number,
    dy: number,
    dz: number,
    rotY = 0,
    pivotX = 0,
    pivotZ = 0,
  ): RawBufs {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    for (let i = 0; i < b.pos.length; i += 3) {
      let x = b.pos[i] - pivotX;
      const y = b.pos[i + 1];
      let z = b.pos[i + 2] - pivotZ;
      if (rotY !== 0) {
        const rx = x * c + z * s;
        const rz = -x * s + z * c;
        x = rx;
        z = rz;
        const nx = b.nrm[i];
        const nz = b.nrm[i + 2];
        b.nrm[i] = nx * c + nz * s;
        b.nrm[i + 2] = -nx * s + nz * c;
      }
      b.pos[i] = x + pivotX + dx;
      b.pos[i + 1] = y + dy;
      b.pos[i + 2] = z + pivotZ + dz;
    }
    return b;
  }

  function xformRawX(
    b: RawBufs,
    dx: number,
    dy: number,
    dz: number,
    rotX = 0,
    pivotY = 0,
    pivotZ = 0,
  ): RawBufs {
    const c = Math.cos(rotX);
    const s = Math.sin(rotX);
    for (let i = 0; i < b.pos.length; i += 3) {
      let y = b.pos[i + 1] - pivotY;
      let z = b.pos[i + 2] - pivotZ;
      if (rotX !== 0) {
        const ry = y * c - z * s;
        const rz = y * s + z * c;
        y = ry;
        z = rz;
        const ny = b.nrm[i + 1];
        const nz = b.nrm[i + 2];
        b.nrm[i + 1] = ny * c - nz * s;
        b.nrm[i + 2] = ny * s + nz * c;
      }
      b.pos[i] += dx;
      b.pos[i + 1] = y + pivotY + dy;
      b.pos[i + 2] = z + pivotZ + dz;
    }
    return b;
  }

  function cloneRaw(b: RawBufs): RawBufs {
    return {
      pos: b.pos.slice(),
      nrm: b.nrm.slice(),
      uv: b.uv.slice(),
      idx: b.idx.slice(),
    };
  }

  function buildBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
  ): RawBufs {
    const hx = sx * 0.5;
    const hy = sy * 0.5;
    const hz = sz * 0.5;
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;
    // 6 outward CCW faces (24 verts, 36 indices)
    const faces: ReadonlyArray<
      [number[], [number, number, number], [number, number]]
    > = [
      [
        [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
        [0, 0, 1],
        [sx, sy],
      ], // +Z
      [
        [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0],
        [0, 0, -1],
        [sx, sy],
      ], // -Z
      [
        [x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1],
        [1, 0, 0],
        [sz, sy],
      ], // +X
      [
        [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0],
        [-1, 0, 0],
        [sz, sy],
      ], // -X
      [
        [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0],
        [0, 1, 0],
        [sx, sz],
      ], // +Y
      [
        [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1],
        [0, -1, 0],
        [sx, sz],
      ], // -Y
    ];
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let v = 0;
    for (const [pts, n, [uS, vS]] of faces) {
      pos.push(...pts);
      for (let k = 0; k < 4; k++) nrm.push(n[0], n[1], n[2]);
      uv.push(0, 0, uS, 0, uS, vS, 0, vS);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    return {pos, nrm, uv, idx};
  }

  // --- Polygon-with-Holes Ear-Clipper & Extruders (along Z or X or Y) ---
  function signedArea2D(loop: readonly Pt2[]): number {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a * 0.5;
  }

  function sanitizeLoop(raw: readonly Pt2[], wantCCW: boolean): Pt2[] {
    const out: Pt2[] = [];
    for (const p of raw) {
      const prev = out[out.length - 1];
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-8) {
        out.push([p[0], p[1]]);
      }
    }
    if (
      out.length > 1 &&
      Math.hypot(
        out[0][0] - out[out.length - 1][0],
        out[0][1] - out[out.length - 1][1],
      ) <= 1e-8
    ) {
      out.pop();
    }
    if (out.length < 3) return [];
    if (signedArea2D(out) > 0 !== wantCCW) out.reverse();
    return out;
  }

  function cross2(a: Pt2, b: Pt2, c: Pt2): number {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function ptInTri2D(p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean {
    return (
      cross2(a, b, p) >= -1e-10 &&
      cross2(b, c, p) >= -1e-10 &&
      cross2(c, a, p) >= -1e-10
    );
  }

  function samePt2(p: Pt2, q: Pt2): boolean {
    return Math.abs(p[0] - q[0]) < 1e-8 && Math.abs(p[1] - q[1]) < 1e-8;
  }

  function onSeg2(p: Pt2, q: Pt2, r: Pt2): boolean {
    return (
      Math.abs(cross2(p, q, r)) <= 1e-10 &&
      r[0] >= (p[0] < q[0] ? p[0] : q[0]) - 1e-9 &&
      r[0] <= (p[0] > q[0] ? p[0] : q[0]) + 1e-9 &&
      r[1] >= (p[1] < q[1] ? p[1] : q[1]) - 1e-9 &&
      r[1] <= (p[1] > q[1] ? p[1] : q[1]) + 1e-9
    );
  }

  function segsProperlyCross(a: Pt2, b: Pt2, c: Pt2, d: Pt2): boolean {
    const abMinX = a[0] < b[0] ? a[0] : b[0];
    const abMaxX = a[0] > b[0] ? a[0] : b[0];
    const cdMinX = c[0] < d[0] ? c[0] : d[0];
    const cdMaxX = c[0] > d[0] ? c[0] : d[0];
    if (abMaxX < cdMinX - 1e-9 || cdMaxX < abMinX - 1e-9) return false;
    const abMinY = a[1] < b[1] ? a[1] : b[1];
    const abMaxY = a[1] > b[1] ? a[1] : b[1];
    const cdMinY = c[1] < d[1] ? c[1] : d[1];
    const cdMaxY = c[1] > d[1] ? c[1] : d[1];
    if (abMaxY < cdMinY - 1e-9 || cdMaxY < abMinY - 1e-9) return false;
    if (samePt2(a, c) || samePt2(a, d) || samePt2(b, c) || samePt2(b, d)) {
      return false;
    }
    const d1 = cross2(a, b, c);
    const d2 = cross2(a, b, d);
    const d3 = cross2(c, d, a);
    const d4 = cross2(c, d, b);
    if (
      ((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
      ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))
    ) {
      return true;
    }
    return (
      onSeg2(a, b, c) || onSeg2(a, b, d) || onSeg2(c, d, a) || onSeg2(c, d, b)
    );
  }

  function isBridgeVisible(
    outer: readonly Pt2[],
    M: Pt2,
    hole: readonly Pt2[],
    mIdx: number,
    candIdx: number,
  ): boolean {
    const V = outer[candIdx];
    const on = outer.length;
    for (let i = 0; i < on; i++) {
      if (segsProperlyCross(M, V, outer[i], outer[(i + 1) % on])) return false;
    }
    const hn = hole.length;
    for (let i = 0; i < hn; i++) {
      if (i === mIdx || (i + 1) % hn === mIdx) continue;
      if (segsProperlyCross(M, V, hole[i], hole[(i + 1) % hn])) return false;
    }
    const prev = outer[(candIdx + on - 1) % on];
    const next = outer[(candIdx + 1) % on];
    if (cross2(prev, V, next) >= -1e-10) {
      return cross2(prev, V, M) > -1e-10 && cross2(V, next, M) > -1e-10;
    }
    return !(cross2(V, prev, M) >= 1e-10 && cross2(next, V, M) >= 1e-10);
  }

  function bridgeHoleIntoOuter(outer: Pt2[], hole: readonly Pt2[]): Pt2[] {
    let mIdx = 0;
    for (let i = 1; i < hole.length; i++) {
      if (
        hole[i][0] > hole[mIdx][0] ||
        (hole[i][0] === hole[mIdx][0] && hole[i][1] < hole[mIdx][1])
      ) {
        mIdx = i;
      }
    }
    const M = hole[mIdx];
    const mx = M[0];
    const my = M[1];
    const on = outer.length;

    let bestIx = Infinity;
    let edgeV = -1;
    for (let i = 0; i < on; i++) {
      const a = outer[i];
      const b = outer[(i + 1) % on];
      if (a[1] > my === b[1] > my) continue;
      const ix = a[0] + ((my - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (ix >= mx - 1e-9 && ix < bestIx) {
        bestIx = ix;
        edgeV = a[0] >= b[0] ? i : (i + 1) % on;
      }
    }

    let visIdx = -1;
    if (edgeV >= 0) {
      const P = outer[edgeV];
      let cand = edgeV;
      if (Math.hypot(P[0] - bestIx, P[1] - my) > 1e-8) {
        const I: Pt2 = [bestIx, my];
        const triA = M;
        const triB = P[1] > my ? I : P;
        const triC = P[1] > my ? P : I;
        let bestTan = Infinity;
        let bestDist = Infinity;
        for (let i = 0; i < on; i++) {
          const prev = outer[(i + on - 1) % on];
          const cur = outer[i];
          const next = outer[(i + 1) % on];
          if (cross2(prev, cur, next) >= 1e-10 || cur[0] < mx - 1e-9) continue;
          if (ptInTri2D(cur, triA, triB, triC)) {
            const dx = cur[0] - mx;
            const dy = Math.abs(cur[1] - my);
            const tan = dx > 1e-9 ? dy / dx : Infinity;
            const dist = Math.hypot(dx, dy);
            if (
              tan < bestTan - 1e-9 ||
              (Math.abs(tan - bestTan) <= 1e-9 && dist < bestDist)
            ) {
              bestTan = tan;
              bestDist = dist;
              cand = i;
            }
          }
        }
      }
      if (isBridgeVisible(outer, M, hole, mIdx, cand)) visIdx = cand;
    }

    if (visIdx < 0) {
      const order = new Array<number>(on);
      const dSq = new Array<number>(on);
      for (let i = 0; i < on; i++) {
        order[i] = i;
        const dx = outer[i][0] - mx;
        const dy = outer[i][1] - my;
        dSq[i] = dx * dx + dy * dy;
      }
      order.sort((a, b) => dSq[a] - dSq[b]);
      for (let k = 0; k < on; k++) {
        if (isBridgeVisible(outer, M, hole, mIdx, order[k])) {
          visIdx = order[k];
          break;
        }
      }
      if (visIdx < 0) visIdx = Math.max(0, edgeV);
    }

    const merged: Pt2[] = [];
    for (let i = 0; i <= visIdx; i++) merged.push(outer[i]);
    for (let k = 0; k <= hole.length; k++) {
      merged.push(hole[(mIdx + k) % hole.length]);
    }
    for (let i = visIdx; i < on; i++) merged.push(outer[i]);
    return merged;
  }

  function triangulatePolygonWithHoles(
    outerCCW: readonly Pt2[],
    holesCW: readonly Pt2[][],
  ): {verts: Pt2[]; tris: number[]} {
    let poly = outerCCW.map((p): Pt2 => [p[0], p[1]]);
    if (holesCW.length > 0) {
      const sorted = holesCW
        .filter((h) => h.length >= 3)
        .slice()
        .sort((a, b) => {
          const maxX = (l: readonly Pt2[]) =>
            l.reduce((m, p) => (p[0] > m ? p[0] : m), -Infinity);
          return maxX(b) - maxX(a);
        });
      for (const h of sorted) poly = bridgeHoleIntoOuter(poly, h);
    }

    const n = poly.length;
    if (n < 3) return {verts: poly, tris: []};
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const prev = new Int32Array(n);
    const next = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = poly[i][0];
      py[i] = poly[i][1];
      prev[i] = i === 0 ? n - 1 : i - 1;
      next[i] = i === n - 1 ? 0 : i + 1;
    }

    const reflexIds = new Int32Array(n);
    const reflexPos = new Int32Array(n);
    reflexPos.fill(-1);
    let reflexCount = 0;
    const syncReflex = (v: number) => {
      const p = prev[v];
      const q = next[v];
      const c =
        (px[v] - px[p]) * (py[q] - py[p]) - (py[v] - py[p]) * (px[q] - px[p]);
      const isRef = c <= 1e-10;
      const curSlot = reflexPos[v];
      if (isRef && curSlot < 0) {
        reflexPos[v] = reflexCount;
        reflexIds[reflexCount++] = v;
      } else if (!isRef && curSlot >= 0) {
        const lastV = reflexIds[--reflexCount];
        reflexIds[curSlot] = lastV;
        reflexPos[lastV] = curSlot;
        reflexPos[v] = -1;
      }
    };
    for (let i = 0; i < n; i++) syncReflex(i);

    const tris: number[] = [];
    let rem = n;
    let eps = 1e-11;
    let guard = 0;
    const maxGuard = n * n * 3 + 32;
    let cur = 0;
    let failsInPass = 0;

    while (rem > 3 && guard++ < maxGuard) {
      const i0 = prev[cur];
      const i1 = cur;
      const i2 = next[cur];
      const ax = px[i0];
      const ay = py[i0];
      const bx = px[i1];
      const by = py[i1];
      const cx = px[i2];
      const cy = py[i2];

      const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      let isEar = area2 > eps;
      if (isEar && reflexCount > 0) {
        const minX = (ax < bx ? (ax < cx ? ax : cx) : bx < cx ? bx : cx) - 1e-9;
        const maxX = (ax > bx ? (ax > cx ? ax : cx) : bx > cx ? bx : cx) + 1e-9;
        const minY = (ay < by ? (ay < cy ? ay : cy) : by < cy ? by : cy) - 1e-9;
        const maxY = (ay > by ? (ay > cy ? ay : cy) : by > cy ? by : cy) + 1e-9;
        for (let r = 0; r < reflexCount; r++) {
          const vk = reflexIds[r];
          if (vk === i0 || vk === i1 || vk === i2) continue;
          const vx = px[vk];
          if (vx < minX || vx > maxX) continue;
          const vy = py[vk];
          if (vy < minY || vy > maxY) continue;
          if (
            (Math.abs(vx - ax) < 1e-9 && Math.abs(vy - ay) < 1e-9) ||
            (Math.abs(vx - bx) < 1e-9 && Math.abs(vy - by) < 1e-9) ||
            (Math.abs(vx - cx) < 1e-9 && Math.abs(vy - cy) < 1e-9)
          ) {
            continue;
          }
          if (
            (bx - ax) * (vy - ay) - (by - ay) * (vx - ax) >= -1e-10 &&
            (cx - bx) * (vy - by) - (cy - by) * (vx - bx) >= -1e-10 &&
            (ax - cx) * (vy - cy) - (ay - cy) * (vx - cx) >= -1e-10
          ) {
            isEar = false;
            break;
          }
        }
      }

      if (isEar) {
        tris.push(i0, i1, i2);
        const slot = reflexPos[i1];
        if (slot >= 0) {
          const lastV = reflexIds[--reflexCount];
          reflexIds[slot] = lastV;
          reflexPos[lastV] = slot;
          reflexPos[i1] = -1;
        }
        next[i0] = i2;
        prev[i2] = i0;
        rem--;
        if (rem >= 3) {
          syncReflex(i0);
          syncReflex(i2);
        }
        cur = i2;
        failsInPass = 0;
      } else {
        cur = i2;
        failsInPass++;
        if (failsInPass >= rem) {
          if (eps > -1e-6) {
            eps = eps > 0 ? 0 : -1e-6;
            failsInPass = 0;
          } else {
            let bestV = -1;
            let bestArea = 0;
            let scan = cur;
            for (let k = 0; k < rem; k++) {
              const p0 = prev[scan];
              const p2 = next[scan];
              const a2 =
                (px[scan] - px[p0]) * (py[p2] - py[p0]) -
                (py[scan] - py[p0]) * (px[p2] - px[p0]);
              if (a2 > bestArea) {
                bestArea = a2;
                bestV = scan;
              }
              scan = p2;
            }
            const drop = bestV >= 0 ? bestV : cur;
            const d0 = prev[drop];
            const d2 = next[drop];
            if (bestV >= 0) tris.push(d0, drop, d2);
            const slot = reflexPos[drop];
            if (slot >= 0) {
              const lastV = reflexIds[--reflexCount];
              reflexIds[slot] = lastV;
              reflexPos[lastV] = slot;
              reflexPos[drop] = -1;
            }
            next[d0] = d2;
            prev[d2] = d0;
            rem--;
            if (rem >= 3) {
              syncReflex(d0);
              syncReflex(d2);
            }
            cur = d2;
            failsInPass = 0;
          }
        }
      }
    }
    if (rem === 3) tris.push(prev[cur], cur, next[cur]);
    return {verts: poly, tris};
  }

  /**
   * Extrudes a 2D elevation `(u, v)` along `axis`:
   * - `'z'`: `(x = u, y = v, z ∈ [z0, z1])` (walls, doors, windows, archways, gable roofs)
   * - `'x'`: `(x ∈ [z0, z1], y = v, z = -u)` (staircase flights along -Z/+Z with width X)
   * - `'y'`: `(x = u, y ∈ [z0, z1], z = -v)` (horizontal slabs, spiral treads, capitals)
   * All three mappings have determinant +1 so CCW `(u, v)` yields outward right-handed faces!
   */
  function extrudeProfile(
    rawOuter: readonly Pt2[],
    rawHoles: readonly Pt2[][],
    z0: number,
    z1: number,
    axis: 'x' | 'y' | 'z' = 'z',
  ): RawBufs {
    const outer = sanitizeLoop(rawOuter, true);
    if (outer.length < 3 || z1 <= z0 + 1e-9) {
      return {pos: [], nrm: [], uv: [], idx: []};
    }
    const holes: Pt2[][] = [];
    for (const h of rawHoles) {
      const sh = sanitizeLoop(h, false);
      if (sh.length >= 3) holes.push(sh);
    }
    const {verts, tris} = triangulatePolygonWithHoles(outer, holes);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    const mapPt = (
      u: number,
      v: number,
      w: number,
    ): [number, number, number] =>
      axis === 'z' ? [u, v, w] : axis === 'y' ? [u, w, -v] : [w, v, -u];
    const mapNrm = (
      nu: number,
      nv: number,
      nw: number,
    ): [number, number, number] =>
      axis === 'z'
        ? [nu, nv, nw]
        : axis === 'y'
          ? [nu, nw, -nv]
          : [nw, nv, -nu];

    // +W front cap (at w = z1, outward normal +W)
    let vOff = 0;
    const fN = mapNrm(0, 0, 1);
    for (const p of verts) {
      pos.push(...mapPt(p[0], p[1], z1));
      nrm.push(fN[0], fN[1], fN[2]);
      uv.push(p[0], p[1]);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i];
      const b = tris[i + 1];
      const c = tris[i + 2];
      if (Math.abs(cross2(verts[a], verts[b], verts[c])) > 1e-14) {
        idx.push(vOff + a, vOff + b, vOff + c);
      }
    }
    vOff += verts.length;

    // -W back cap (at w = z0, outward normal -W, reversed winding)
    const bN = mapNrm(0, 0, -1);
    for (const p of verts) {
      pos.push(...mapPt(p[0], p[1], z0));
      nrm.push(bN[0], bN[1], bN[2]);
      uv.push(p[0], p[1]);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i];
      const b = tris[i + 1];
      const c = tris[i + 2];
      if (Math.abs(cross2(verts[a], verts[b], verts[c])) > 1e-14) {
        idx.push(vOff + a, vOff + c, vOff + b);
      }
    }
    vOff += verts.length;

    // Side walls along outer (CCW) and holes (CW)
    const depth = z1 - z0;
    for (const loop of [outer, ...holes]) {
      const ln = loop.length;
      let perim = 0;
      for (let i = 0; i < ln; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % ln];
        const du = b[0] - a[0];
        const dv = b[1] - a[1];
        const el = Math.hypot(du, dv);
        if (el <= 1e-9) continue;
        // Outward normal in (u, v) for CCW outer / CW hole is (dv/el, -du/el)
        const en = mapNrm(dv / el, -du / el, 0);
        const u0 = perim;
        const u1 = perim + el;
        perim = u1;
        const base = vOff;
        pos.push(
          ...mapPt(a[0], a[1], z0),
          ...mapPt(b[0], a[1] + dv, z0),
          ...mapPt(a[0], a[1], z1),
          ...mapPt(b[0], b[1], z1),
        );
        for (let k = 0; k < 4; k++) nrm.push(en[0], en[1], en[2]);
        uv.push(u0, 0, u1, 0, u0, depth, u1, depth);
        // Outward side-wall quad: front cap emits (base+2 -> base+3) and back cap emits (base+1 -> base),
        // so side wall pairs them via (base -> base+1 -> base+3) and (base -> base+3 -> base+2).
        idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
        vOff += 4;
      }
    }

    return {pos, nrm, uv, idx};
  }

  function revolveClosedProfile(
    pts: readonly Pt2[],
    radialSegs: number,
  ): RawBufs {
    const clean: Pt2[] = [];
    for (const p of pts) {
      const r = Math.max(0, p[0]);
      const y = p[1];
      const prev = clean[clean.length - 1];
      if (!prev || Math.hypot(r - prev[0], y - prev[1]) > 1e-8) {
        clean.push([r, y]);
      }
    }
    if (
      clean.length > 1 &&
      Math.hypot(
        clean[0][0] - clean[clean.length - 1][0],
        clean[0][1] - clean[clean.length - 1][1],
      ) <= 1e-8
    ) {
      clean.pop();
    }
    if (clean.length < 3) return {pos: [], nrm: [], uv: [], idx: []};
    if (signedArea2D(clean) < 0) clean.reverse();

    const segs = clamp(Math.round(radialSegs), 8, MAX_SEGS);
    const m = clean.length;
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let vCur = 0;
    let arcAcc = 0;

    for (let i = 0; i < m; i++) {
      const [rA, yA] = clean[i];
      const [rB, yB] = clean[(i + 1) % m];
      if (rA <= 1e-8 && rB <= 1e-8) continue;
      const dr = rB - rA;
      const dy = yB - yA;
      const len = Math.hypot(dr, dy) || 1;
      const nr = dy / len;
      const ny = -dr / len;
      const v0 = arcAcc;
      const v1 = arcAcc + len;
      arcAcc = v1;
      const base = vCur;
      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const phi = u * TAU;
        const cp = j === segs ? 1 : Math.cos(phi);
        const sp = j === segs ? 0 : Math.sin(phi);
        pos.push(rA * cp, yA, -rA * sp, rB * cp, yB, -rB * sp);
        nrm.push(nr * cp, ny, -nr * sp, nr * cp, ny, -nr * sp);
        uv.push(u, v0, u, v1);
      }
      vCur += (segs + 1) * 2;
      for (let j = 0; j < segs; j++) {
        const a0 = base + j * 2;
        const b0 = a0 + 1;
        const a1 = a0 + 2;
        const b1 = a0 + 3;
        if (rA > 1e-8) idx.push(a0, a1, b1);
        if (rB > 1e-8) idx.push(a0, b1, b0);
      }
    }
    return {pos, nrm, uv, idx};
  }

  // --- IBC Stair Calculator ---
  function codeStairSpec(
    totalRise:
      | number
      | {rise?: number; maxRiserHeight?: number; treadDepth?: number} = 2.8,
    optsOrMaxRiser?: number | {maxRiserHeight?: number; treadDepth?: number},
    treadDepthArg?: number,
  ): StairCodeSpec {
    const objOpts =
      typeof totalRise === 'object' && totalRise !== null
        ? totalRise
        : typeof optsOrMaxRiser === 'object' && optsOrMaxRiser !== null
          ? optsOrMaxRiser
          : undefined;
    const rawRise =
      typeof totalRise === 'object' && totalRise !== null
        ? totalRise.rise
        : totalRise;
    const rawMaxR =
      typeof optsOrMaxRiser === 'number'
        ? optsOrMaxRiser
        : objOpts?.maxRiserHeight;
    const rawTread =
      typeof treadDepthArg === 'number' ? treadDepthArg : objOpts?.treadDepth;
    const rise = clamp(num(rawRise, 2.8), 0.15, 30);
    const maxR = clamp(num(rawMaxR, 0.178), 0.1, 0.25);
    const steps = clamp(Math.ceil(rise / maxR), 1, MAX_STEPS);
    const riserHeight = rise / steps;
    const treadDepth = clamp(
      num(rawTread, Math.max(0.279, 0.635 - 2 * riserHeight)),
      0.18,
      0.6,
    );
    const totalRun = Math.max(1, steps - 1) * treadDepth;
    const slopeDeg = (Math.atan2(riserHeight, treadDepth) * 180) / Math.PI;
    const ibcCompliant =
      riserHeight >= 0.102 && riserHeight <= 0.1785 && treadDepth >= 0.279;
    const res = {
      steps,
      riserHeight,
      treadDepth,
      totalRise: rise,
      totalRun,
      slopeDeg,
      ibcCompliant,
    } as StairCodeSpec;
    Object.defineProperty(res, 'valueOf', {
      value: () => steps,
      enumerable: false,
    });
    return res;
  }

  // Helper: build a CW opening hole in `(x, y)` with optional semicircular/segmental/pointed arch top
  function makeOpeningHoleCW(
    cx: number,
    y0: number,
    w: number,
    h: number,
    arch:
      | boolean
      | 'semicircular'
      | 'segmental'
      | 'pointed'
      | 'none'
      | undefined,
  ): Pt2[] {
    const hw = w * 0.5;
    const xL = cx - hw;
    const xR = cx + hw;
    const hasArch =
      arch === true ||
      arch === 'semicircular' ||
      arch === 'segmental' ||
      arch === 'pointed';
    if (!hasArch) {
      return [
        [xL, y0],
        [xL, y0 + h],
        [xR, y0 + h],
        [xR, y0],
      ];
    }
    const isSeg = arch === 'segmental';
    const isPointed = arch === 'pointed';
    const archRise = isPointed
      ? Math.min(h * 0.56, hw * 1.35)
      : Math.min(h * 0.48, isSeg ? hw * 0.45 : hw);
    const springY = y0 + h - archRise;
    const pts: Pt2[] = [
      [xL, y0],
      [xL, springY],
    ];
    const arcSegs = 12;
    if (isPointed) {
      const R = (hw * hw + archRise * archRise) / (2 * hw);
      const dC = R - hw;
      const topAng = Math.asin(clamp(archRise / R, 0, 1));
      const halfSegs = arcSegs / 2;
      for (let i = 1; i <= halfSegs; i++) {
        const a = Math.PI - (topAng * i) / halfSegs;
        pts.push([cx + dC + R * Math.cos(a), springY + R * Math.sin(a)]);
      }
      for (let i = 1; i < halfSegs; i++) {
        const a = topAng * (1 - i / halfSegs);
        pts.push([cx - dC + R * Math.cos(a), springY + R * Math.sin(a)]);
      }
    } else if (isSeg) {
      // Circular arc through (-hw, 0), (0, archRise), (+hw, 0)
      const R = (hw * hw + archRise * archRise) / (2 * archRise);
      const yCenter = springY + archRise - R;
      const halfAng = Math.asin(clamp(hw / R, 0, 1));
      for (let i = 1; i < arcSegs; i++) {
        const a = Math.PI * 0.5 + halfAng - (2 * halfAng * i) / arcSegs;
        pts.push([cx + R * Math.cos(a), yCenter + R * Math.sin(a)]);
      }
    } else {
      for (let i = 1; i < arcSegs; i++) {
        const a = Math.PI - (Math.PI * i) / arcSegs;
        pts.push([cx + hw * Math.cos(a), springY + archRise * Math.sin(a)]);
      }
    }
    pts.push([xR, springY], [xR, y0]);
    return pts;
  }

  // --- 1. WallGeometry ---
  class WallGeometry extends BufferGeometry {
    constructor(options: WallOptions = {}) {
      super();
      const len = clamp(num(options.length ?? options.width, 4.0), 0.2, 100);
      const h = clamp(num(options.height, 2.8), 0.2, 30);
      const t = clamp(num(options.thickness ?? options.depth, 0.2), 0.02, 4);
      const origin = options.origin ?? 'floor';
      const hL = len * 0.5;
      const hT = t * 0.5;

      // Clamp and deduplicate non-overlapping openings inside wall interior margin.
      const margin = Math.min(0.04, len * 0.05, h * 0.05);
      const rawOpenings = Array.isArray(options.openings)
        ? options.openings.slice(0, MAX_OPENINGS)
        : [];
      interface ClampedOp {
        cx: number;
        y0: number;
        w: number;
        h: number;
        arch?: boolean | 'semicircular' | 'segmental' | 'pointed' | 'none';
      }
      const doorNotches: ClampedOp[] = [];
      const windowHoles: Pt2[][] = [];
      const placed: Array<[number, number, number, number]> = [];

      for (const op of rawOpenings) {
        if (!op) continue;
        const w = clamp(num(op.width, 0.9), 0.08, len - 2 * margin);
        const yRaw = Math.max(0, num(op.y ?? op.sillHeight, 0));
        const isDoor = yRaw <= 0.02;
        const y0 = isDoor ? 0 : clamp(yRaw, margin, h - margin * 2 - 0.08);
        const oh = clamp(
          num(op.height, isDoor ? 2.1 : 1.2),
          0.08,
          h - y0 - margin,
        );
        const cx = clamp(
          num(op.x, 0),
          -hL + margin + w * 0.5,
          hL - margin - w * 0.5,
        );
        const x0 = cx - w * 0.5;
        const x1 = cx + w * 0.5;
        const y1 = y0 + oh;
        let overlaps = false;
        for (const [px0, py0, px1, py1] of placed) {
          if (
            x0 < px1 + margin * 0.5 &&
            x1 > px0 - margin * 0.5 &&
            y0 < py1 + margin * 0.5 &&
            y1 > py0 - margin * 0.5
          ) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        placed.push([x0, y0, x1, y1]);
        if (isDoor) {
          doorNotches.push({cx, y0: 0, w, h: oh, arch: op.arch});
        } else {
          windowHoles.push(makeOpeningHoleCW(cx, y0, w, oh, op.arch));
        }
      }

      doorNotches.sort((a, b) => a.cx - b.cx);
      const outer: Pt2[] = [[-hL, 0]];
      for (const dn of doorNotches) {
        const notchCW = makeOpeningHoleCW(dn.cx, 0, dn.w, dn.h, dn.arch);
        for (const p of notchCW) outer.push(p);
      }
      outer.push([hL, 0], [hL, h], [-hL, h]);

      const parts: RawBufs[] = [
        extrudeProfile(outer, windowHoles, -hT, hT, 'z'),
      ];

      const bbH = clamp(num(options.baseboardHeight, 0), 0, h * 0.25);
      const bbP = clamp(num(options.baseboardProjection, 0.015), 0.002, 0.2);
      if (bbH > 1e-4) {
        // Segment baseboards cleanly across wall runs between door openings!
        let curX = -hL;
        const runs: Array<[number, number]> = [];
        for (const dn of doorNotches) {
          const d0 = dn.cx - dn.w * 0.5 - 0.006;
          if (d0 - curX > 0.04) runs.push([curX, d0]);
          curX = dn.cx + dn.w * 0.5 + 0.006;
        }
        if (hL - curX > 0.04) runs.push([curX, hL]);
        for (const [rx0, rx1] of runs) {
          const rLen = rx1 - rx0;
          const rMid = (rx0 + rx1) * 0.5;
          parts.push(
            buildBox(rMid, bbH * 0.5, hT + bbP * 0.5 + 1e-4, rLen, bbH, bbP),
            buildBox(rMid, bbH * 0.5, -hT - bbP * 0.5 - 1e-4, rLen, bbH, bbP),
          );
        }
      }
      const crH = clamp(num(options.corniceHeight, 0), 0, h * 0.25);
      const crP = clamp(num(options.corniceProjection, 0.03), 0.002, 0.3);
      if (crH > 1e-4) {
        parts.push(
          buildBox(0, h - crH * 0.5, hT + crP * 0.5 + 1e-4, len, crH, crP),
          buildBox(0, h - crH * 0.5, -hT - crP * 0.5 - 1e-4, len, crH, crP),
        );
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -h * 0.5, 0);

      applyBuffers(this, merged, 'WallGeometry', {
        length: len,
        height: h,
        thickness: t,
        openingCount: placed.length,
        origin,
      });
    }
  }

  // --- 1b. SlabGeometry ---
  class SlabGeometry extends BufferGeometry {
    constructor(options: SlabOptions = {}) {
      super();
      const w = clamp(num(options.width, 6.0), 0.2, 200);
      const d = clamp(num(options.depth ?? options.length, 6.0), 0.2, 200);
      const t = clamp(num(options.thickness, 0.2), 0.02, 4);
      const origin = options.origin ?? 'top';
      const hW = w * 0.5;
      const hD = d * 0.5;

      // Extruded along 'y': (u = x, w = y, -v = z) => v = -z!
      const outer: Pt2[] = [
        [-hW, -hD],
        [hW, -hD],
        [hW, hD],
        [-hW, hD],
      ];
      const margin = Math.min(0.06, w * 0.05, d * 0.05);
      const rawOps = Array.isArray(options.openings)
        ? options.openings.slice(0, MAX_OPENINGS)
        : [];
      const holes: Pt2[][] = [];
      const placed: Array<[number, number, number, number]> = [];

      for (const op of rawOps) {
        if (!op) continue;
        if (
          op.shape === 'circle' ||
          (op.shape !== 'rect' && op.radius != null)
        ) {
          const r = clamp(
            num(op.radius, Math.min(w, d) * 0.15),
            0.05,
            Math.min(hW, hD) - margin,
          );
          const cx = clamp(num(op.x, 0), -hW + margin + r, hW - margin - r);
          const cz = clamp(num(op.z, 0), -hD + margin + r, hD - margin - r);
          const cv = -cz;
          let overlaps = false;
          for (const [px0, pv0, px1, pv1] of placed) {
            if (
              cx - r < px1 + margin * 0.5 &&
              cx + r > px0 - margin * 0.5 &&
              cv - r < pv1 + margin * 0.5 &&
              cv + r > pv0 - margin * 0.5
            ) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;
          placed.push([cx - r, cv - r, cx + r, cv + r]);
          const cPts: Pt2[] = [];
          for (let i = 0; i < 24; i++) {
            const a = -(i * TAU) / 24;
            cPts.push([cx + r * Math.cos(a), cv + r * Math.sin(a)]);
          }
          holes.push(cPts);
        } else {
          const ow = clamp(num(op.width, 1.2), 0.08, w - 2 * margin);
          const od = clamp(num(op.depth, 2.4), 0.08, d - 2 * margin);
          const cx = clamp(
            num(op.x, 0),
            -hW + margin + ow * 0.5,
            hW - margin - ow * 0.5,
          );
          const cz = clamp(
            num(op.z, 0),
            -hD + margin + od * 0.5,
            hD - margin - od * 0.5,
          );
          const cv = -cz;
          const x0 = cx - ow * 0.5;
          const x1 = cx + ow * 0.5;
          const v0 = cv - od * 0.5;
          const v1 = cv + od * 0.5;
          let overlaps = false;
          for (const [px0, pv0, px1, pv1] of placed) {
            if (
              x0 < px1 + margin * 0.5 &&
              x1 > px0 - margin * 0.5 &&
              v0 < pv1 + margin * 0.5 &&
              v1 > pv0 - margin * 0.5
            ) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;
          placed.push([x0, v0, x1, v1]);
          holes.push([
            [x0, v0],
            [x0, v1],
            [x1, v1],
            [x1, v0],
          ]);
        }
      }

      const y0 = origin === 'bottom' ? 0 : origin === 'center' ? -t * 0.5 : -t;
      const y1 = y0 + t;
      applyBuffers(
        this,
        extrudeProfile(outer, holes, y0, y1, 'y'),
        'SlabGeometry',
        {
          width: w,
          depth: d,
          thickness: t,
          openingCount: placed.length,
          origin,
        },
      );
    }
  }

  // Helper: build one straight flight along +Z (`z ∈ [0, steps * treadDepth]`, `y ∈ [0, steps * riserH]`)
  function buildFlight(
    steps: number,
    riserH: number,
    treadD: number,
    width: number,
    treadT: number,
    nosing: number,
    solid: boolean,
  ): RawBufs {
    const hW = width * 0.5;
    if (solid) {
      // Build profile in (u = z_along_run, v = y_up); extrude along X in [-hW, +hW] (`(w, v, -u)` -> negate u so +Z is forward!)
      // With `axis = 'x'`, `mapPt(u, v, w) = [w, v, -u]`, so `u ∈ [-run, 0]` maps to `z ∈ [0, +run]`.
      const pts: Pt2[] = [[0, 0]];
      for (let i = 0; i < steps; i++) {
        const zFront = -i * treadD;
        const zBack = -(i + 1) * treadD;
        const yBot = i * riserH;
        const yTop = (i + 1) * riserH;
        if (nosing > 1e-4 && treadT < riserH * 0.85) {
          pts.push(
            [zFront, yTop - treadT],
            [zFront + nosing, yTop - treadT],
            [zFront + nosing, yTop],
            [zBack, yTop],
          );
        } else {
          pts.push([zFront, yTop], [zBack, yTop]);
        }
        if (i === 0 && yBot > 0) void 0;
      }
      const totalRun = steps * treadD;
      const totalRise = steps * riserH;
      const waist = Math.max(riserH * 0.9, treadT * 2.2);
      // Underside sloped soffit or flat-seated soffit back to (0, 0)
      pts.push([-totalRun, Math.max(0, totalRise - waist)]);
      if (totalRise - waist > 0.01) {
        pts.push([-Math.min(totalRun, treadD * 0.8), 0]);
      }
      return extrudeProfile(pts, [], -hW, hW, 'x');
    }

    // Open-riser floating treads + twin side stringer beams
    const parts: RawBufs[] = [];
    const sThick = Math.min(0.05, width * 0.08);
    const innerW = Math.max(0.05, width - 2 * sThick - 0.002);
    for (let i = 0; i < steps; i++) {
      const yTop = (i + 1) * riserH;
      const zMid = (i + 0.5) * treadD;
      parts.push(
        buildBox(0, yTop - treadT * 0.5, zMid, innerW, treadT, treadD + nosing),
      );
    }
    const run = steps * treadD;
    const rise = steps * riserH;
    const beamH = Math.max(riserH * 1.15, 0.18);
    const stringerProfile: Pt2[] = [
      [0, 0],
      [0, Math.min(rise, beamH)],
      [-run, rise],
      [-run, Math.max(0, rise - beamH)],
    ];
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -hW : hW - sThick;
      parts.push(extrudeProfile(stringerProfile, [], x0, x0 + sThick, 'x'));
    }
    return mergeRaw(parts);
  }

  // --- 2. StaircaseGeometry ---
  class StaircaseGeometry extends BufferGeometry {
    constructor(options: StaircaseOptions = {}) {
      super();
      const mode = options.mode ?? 'straight';
      const turnDir = options.turn === 'left' ? -1 : 1;
      const rise = clamp(num(options.rise ?? options.height, 2.8), 0.2, 30);
      const width = clamp(num(options.width, 1.0), 0.3, 8);
      const spec = codeStairSpec(rise, {
        maxRiserHeight: options.maxRiserHeight,
        treadDepth: options.treadDepth,
      });
      const treadT = clamp(
        num(options.treadThickness, 0.04),
        0.015,
        spec.riserHeight * 0.8,
      );
      const nosing = clamp(
        num(options.nosing, 0.02),
        0,
        spec.treadDepth * 0.25,
      );
      const solid = options.solid !== false;
      const origin = options.origin ?? 'floor';

      let raw: RawBufs;
      if (mode === 'spiral') {
        const rIn = clamp(num(options.innerRadius, 0.1), 0.04, 4);
        const rOut = rIn + width;
        const turns = clamp(num(options.turns, 0.75), 0.25, 4);
        const totalAng = turns * TAU;
        const stepAng = totalAng / spec.steps;
        const parts: RawBufs[] = [
          revolveClosedProfile(
            [
              [0, 0],
              [rIn, 0],
              [rIn, rise + 0.95],
              [0, rise + 0.95],
            ],
            24,
          ),
        ];
        const rStepIn = rIn + 0.002;
        const sweep = stepAng * 1.08;
        const arcSegs = 6;
        for (let i = 0; i < spec.steps; i++) {
          const a0 = turnDir > 0 ? i * stepAng : -(i * stepAng + sweep);
          const a1 = a0 + sweep;
          const sector: Pt2[] = [];
          for (let k = 0; k <= arcSegs; k++) {
            const a = a0 + ((a1 - a0) * k) / arcSegs;
            sector.push([rOut * Math.cos(a), rOut * Math.sin(a)]);
          }
          for (let k = arcSegs; k >= 0; k--) {
            const a = a0 + ((a1 - a0) * k) / arcSegs;
            sector.push([rStepIn * Math.cos(a), rStepIn * Math.sin(a)]);
          }
          const yTop = (i + 1) * spec.riserHeight;
          parts.push(extrudeProfile(sector, [], yTop - treadT, yTop, 'y'));
        }
        raw = mergeRaw(parts);
      } else if (mode === 'l-shape' || mode === 'u-shape') {
        const s1 = Math.max(1, Math.floor(spec.steps / 2));
        const s2 = Math.max(1, spec.steps - s1);
        const landD = Math.max(width, num(options.landingDepth, width));
        const landY = s1 * spec.riserHeight;
        const landT = Math.min(landY, Math.max(treadT * 3, 0.16));
        const run1 = s1 * spec.treadDepth;
        const f1 = buildFlight(
          s1,
          spec.riserHeight,
          spec.treadDepth,
          width,
          treadT,
          nosing,
          solid,
        );
        const f2 = buildFlight(
          s2,
          spec.riserHeight,
          spec.treadDepth,
          width,
          treadT,
          nosing,
          solid,
        );
        if (mode === 'l-shape') {
          const landing = buildBox(
            0,
            landY - landT * 0.5,
            run1 + 0.001 + landD * 0.5,
            width,
            landT,
            landD,
          );
          xformRaw(
            f2,
            turnDir * (width * 0.5 + 0.002),
            landY,
            run1 + 0.001 + landD * 0.5,
            turnDir * Math.PI * 0.5,
          );
          raw = mergeRaw([f1, landing, f2]);
        } else {
          const gap = clamp(num(options.flightGap, 0.12), 0.02, 2);
          const spanX = width * 2 + gap;
          xformRaw(f1, -turnDir * (width + gap) * 0.5, 0, 0);
          const landing = buildBox(
            0,
            landY - landT * 0.5,
            run1 + 0.001 + landD * 0.5,
            spanX,
            landT,
            landD,
          );
          xformRaw(f2, turnDir * (width + gap) * 0.5, landY, run1, Math.PI);
          raw = mergeRaw([f1, landing, f2]);
        }
      } else {
        raw = buildFlight(
          spec.steps,
          spec.riserHeight,
          spec.treadDepth,
          width,
          treadT,
          nosing,
          solid,
        );
      }

      if (origin === 'center' && raw.pos.length >= 3) {
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;
        for (let i = 0; i < raw.pos.length; i += 3) {
          const x = raw.pos[i];
          const y = raw.pos[i + 1];
          const z = raw.pos[i + 2];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
        xformRaw(
          raw,
          -(minX + maxX) * 0.5,
          -(minY + maxY) * 0.5,
          -(minZ + maxZ) * 0.5,
        );
      }

      applyBuffers(this, raw, 'StaircaseGeometry', {
        mode,
        turn: turnDir < 0 ? 'left' : 'right',
        steps: spec.steps,
        riserHeight: spec.riserHeight,
        treadDepth: spec.treadDepth,
        rise,
        width,
        ibcCompliant: spec.ibcCompliant,
      });
    }
  }

  // --- 3. RoofGeometry ---
  class RoofGeometry extends BufferGeometry {
    constructor(options: RoofOptions = {}) {
      super();
      const style: RoofStyle = options.style ?? 'gable';
      const w = clamp(num(options.width, 6.0), 0.4, 100);
      const d = clamp(num(options.depth ?? options.length, 8.0), 0.4, 100);
      const ov = clamp(
        num(options.overhang, style === 'flat-parapet' ? 0 : 0.3),
        0,
        4,
      );
      const pitchDeg = clamp(num(options.pitchDeg, 30), 5, 75);
      const spanW = w + 2 * ov;
      const spanD = d + 2 * ov;
      const hW = spanW * 0.5;
      const hD = spanD * 0.5;
      const defaultH =
        style === 'flat-parapet'
          ? 0.9
          : hW * Math.tan((pitchDeg * Math.PI) / 180);
      const roofH = clamp(num(options.height, defaultH), 0.1, 40);
      const thick = clamp(
        num(options.thickness, 0.18),
        0.03,
        Math.min(roofH * 0.8, 1.5),
      );
      const fasciaH = clamp(num(options.fasciaHeight, thick), 0.03, 1.5);
      const solid = options.solid !== false;
      const origin = options.origin ?? 'eave';

      let raw: RawBufs;
      if (style === 'flat-parapet') {
        const pT = clamp(
          num(
            options.parapetThickness,
            Math.min(0.24, Math.min(hW, hD) * 0.18),
          ),
          0.06,
          Math.min(hW, hD) * 0.45,
        );
        const deckSlab = buildBox(0, fasciaH * 0.5, 0, spanW, fasciaH, spanD);
        const pOuter: Pt2[] = [
          [-hW, -hD],
          [hW, -hD],
          [hW, hD],
          [-hW, hD],
        ];
        const pHole: Pt2[] = [
          [-hW + pT, -hD + pT],
          [-hW + pT, hD - pT],
          [hW - pT, hD - pT],
          [hW - pT, -hD + pT],
        ];
        const parapetWall = extrudeProfile(
          pOuter,
          [pHole],
          fasciaH + 2e-4,
          fasciaH + roofH,
          'y',
        );
        raw = mergeRaw([deckSlab, parapetWall]);
      } else if (style === 'gambrel') {
        const knX = hW * 0.58;
        const knY = fasciaH + roofH * 0.66;
        const topY = fasciaH + roofH;
        const eaveW = Math.min(thick, hW * 0.25);
        const xFoot = hW - eaveW;
        const xInKnee = Math.max(hW * 0.14, knX - eaveW * 0.6);
        const yOuterAtInKnee = topY - (topY - knY) * (xInKnee / knX);
        const yInKnee = clamp(
          knY - thick,
          0.02,
          Math.max(0.025, yOuterAtInKnee - 0.02),
        );
        const yInTop = clamp(
          topY - thick,
          yInKnee + 0.01,
          Math.max(yInKnee + 0.015, topY - 0.02),
        );
        const profile: Pt2[] = solid
          ? [
              [-hW, 0],
              [hW, 0],
              [hW, fasciaH],
              [knX, knY],
              [0, topY],
              [-knX, knY],
              [-hW, fasciaH],
            ]
          : [
              [-hW, 0],
              [-xFoot, 0],
              [-xInKnee, yInKnee],
              [0, yInTop],
              [xInKnee, yInKnee],
              [xFoot, 0],
              [hW, 0],
              [hW, fasciaH],
              [knX, knY],
              [0, topY],
              [-knX, knY],
              [-hW, fasciaH],
            ];
        raw = extrudeProfile(profile, [], -hD, hD, 'z');
      } else if (style === 'gable') {
        const topY = fasciaH + roofH;
        const eaveW = Math.min(thick, hW * 0.35);
        const yInTop = clamp(
          topY - Math.max(thick, fasciaH),
          0.02,
          Math.max(0.025, topY - 0.02),
        );
        const profile: Pt2[] = solid
          ? [
              [-hW, 0],
              [hW, 0],
              [hW, fasciaH],
              [0, topY],
              [-hW, fasciaH],
            ]
          : [
              [-hW, 0],
              [-hW + eaveW, 0],
              [0, yInTop],
              [hW - eaveW, 0],
              [hW, 0],
              [hW, fasciaH],
              [0, topY],
              [-hW, fasciaH],
            ];
        raw = extrudeProfile(profile, [], -hD, hD, 'z');
      } else if (style === 'shed') {
        const profile: Pt2[] = solid
          ? [
              [-hW, 0],
              [hW, 0],
              [hW, fasciaH + roofH],
              [-hW, fasciaH],
            ]
          : [
              [-hW, 0],
              [hW, roofH],
              [hW, fasciaH + roofH],
              [-hW, fasciaH],
            ];
        raw = extrudeProfile(profile, [], -hD, hD, 'z');
      } else {
        // 'hip' or 'mansard': exact closed 2-manifold layered prismoid
        const pos: number[] = [];
        const nrm: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        let vC = 0;
        const pushQuad = (
          a: [number, number, number],
          b: [number, number, number],
          c: [number, number, number],
          p4: [number, number, number],
        ) => {
          const ux = b[0] - a[0];
          const uy = b[1] - a[1];
          const uz = b[2] - a[2];
          const vx = p4[0] - a[0];
          const vy = p4[1] - a[1];
          const vz = p4[2] - a[2];
          let nx = uy * vz - uz * vy;
          let ny = uz * vx - ux * vz;
          let nz = ux * vy - uy * vx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
          pos.push(...a, ...b, ...c, ...p4);
          for (let k = 0; k < 4; k++) nrm.push(nx, ny, nz);
          uv.push(0, 0, 1, 0, 1, 1, 0, 1);
          idx.push(vC, vC + 1, vC + 2, vC, vC + 2, vC + 3);
          vC += 4;
        };
        const pushTri = (
          a: [number, number, number],
          b: [number, number, number],
          c: [number, number, number],
        ) => {
          const ux = b[0] - a[0];
          const uy = b[1] - a[1];
          const uz = b[2] - a[2];
          const vx = c[0] - a[0];
          const vy = c[1] - a[1];
          const vz = c[2] - a[2];
          let nx = uy * vz - uz * vy;
          let ny = uz * vx - ux * vz;
          let nz = ux * vy - uy * vx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
          pos.push(...a, ...b, ...c);
          for (let k = 0; k < 3; k++) nrm.push(nx, ny, nz);
          uv.push(0, 0, 1, 0, 0.5, 1);
          idx.push(vC, vC + 1, vC + 2);
          vC += 3;
        };

        // Bottom soffit (y = 0, outward -Y) + vertical fascia ring (y ∈ [0, fasciaH])
        const b0: [number, number, number] = [-hW, 0, hD];
        const b1: [number, number, number] = [hW, 0, hD];
        const b2: [number, number, number] = [hW, 0, -hD];
        const b3: [number, number, number] = [-hW, 0, -hD];
        const e0: [number, number, number] = [-hW, fasciaH, hD];
        const e1: [number, number, number] = [hW, fasciaH, hD];
        const e2: [number, number, number] = [hW, fasciaH, -hD];
        const e3: [number, number, number] = [-hW, fasciaH, -hD];

        pushQuad(b3, b2, b1, b0); // bottom
        pushQuad(b0, b1, e1, e0); // +Z fascia
        pushQuad(b1, b2, e2, e1); // +X fascia
        pushQuad(b2, b3, e3, e2); // -Z fascia
        pushQuad(b3, b0, e0, e3); // -X fascia

        if (style === 'mansard') {
          const inset = Math.min(hW, hD) * 0.38;
          const deckY = fasciaH + roofH * 0.72;
          const capY = fasciaH + roofH;
          const m0: [number, number, number] = [-hW + inset, deckY, hD - inset];
          const m1: [number, number, number] = [hW - inset, deckY, hD - inset];
          const m2: [number, number, number] = [hW - inset, deckY, -hD + inset];
          const m3: [number, number, number] = [
            -hW + inset,
            deckY,
            -hD + inset,
          ];
          pushQuad(e0, e1, m1, m0);
          pushQuad(e1, e2, m2, m1);
          pushQuad(e2, e3, m3, m2);
          pushQuad(e3, e0, m0, m3);
          const inset2 = Math.min(hW, hD) * 0.72;
          const t0: [number, number, number] = [
            -hW + inset2,
            capY,
            hD - inset2,
          ];
          const t1: [number, number, number] = [hW - inset2, capY, hD - inset2];
          const t2: [number, number, number] = [
            hW - inset2,
            capY,
            -hD + inset2,
          ];
          const t3: [number, number, number] = [
            -hW + inset2,
            capY,
            -hD + inset2,
          ];
          pushQuad(m0, m1, t1, t0);
          pushQuad(m1, m2, t2, t1);
          pushQuad(m2, m3, t3, t2);
          pushQuad(m3, m0, t0, t3);
          pushQuad(t0, t1, t2, t3);
        } else {
          // Hip roof: ridge along the longer axis (or single apex when square)
          const topY = fasciaH + roofH;
          if (Math.abs(hD - hW) < 1e-4) {
            const apex: [number, number, number] = [0, topY, 0];
            pushTri(e0, e1, apex);
            pushTri(e1, e2, apex);
            pushTri(e2, e3, apex);
            pushTri(e3, e0, apex);
          } else if (hD > hW) {
            const rHalf = hD - hW;
            const rF: [number, number, number] = [0, topY, rHalf];
            const rB: [number, number, number] = [0, topY, -rHalf];
            pushTri(e0, e1, rF);
            pushQuad(e1, e2, rB, rF);
            pushTri(e2, e3, rB);
            pushQuad(e3, e0, rF, rB);
          } else {
            const rHalf = hW - hD;
            const rR: [number, number, number] = [rHalf, topY, 0];
            const rL: [number, number, number] = [-rHalf, topY, 0];
            pushQuad(e0, e1, rR, rL);
            pushTri(e1, e2, rR);
            pushQuad(e2, e3, rL, rR);
            pushTri(e3, e0, rL);
          }
        }
        raw = {pos, nrm, uv, idx};
      }

      if (origin === 'center') xformRaw(raw, 0, -(fasciaH + roofH) * 0.5, 0);

      applyBuffers(this, raw, 'RoofGeometry', {
        style,
        width: w,
        depth: d,
        overhang: ov,
        pitchDeg,
        height: roofH,
      });
    }
  }

  // Shared multi-track OX / XO / XOX / OXO / OXXO / XXX sliding panel solver
  function resolveSliderPanels(
    rawPat: unknown,
    clearW: number,
    clr: number,
    overlapW: number,
    openFrac: number,
  ): {
    pattern: string;
    trackCount: number;
    panels: Array<{cx: number; w: number; track: number; operable: boolean}>;
  } {
    const maxPanels = clamp(Math.floor((clearW - 2 * clr) / 0.075), 2, 6);
    const cleaned = String(rawPat ?? 'XO')
      .toUpperCase()
      .replace(/[^XO]/g, '')
      .slice(0, maxPanels);
    const pat = cleaned.length >= 2 ? cleaned : 'XO';
    const n = pat.length;
    const allX = !pat.includes('O');
    const effOverlap = Math.min(
      overlapW,
      Math.max(0, (clearW - 2 * clr) / (n * 3)),
    );
    const baseW = (clearW - 2 * clr + (n - 1) * effOverlap) / n;
    const xBase: number[] = [];
    for (let i = 0; i < n; i++) {
      xBase.push(-clearW * 0.5 + clr + baseW * 0.5 + i * (baseW - effOverlap));
    }
    const tracks: number[] = new Array<number>(n);
    const targets: number[] = new Array<number>(n);
    let maxTrack = 0;
    for (let i = 0; i < n; i++) {
      if (allX) {
        tracks[i] = i;
        targets[i] = 0;
      } else if (pat[i] === 'O') {
        tracks[i] = 0;
        targets[i] = i;
      } else {
        let tgt = i;
        if (i > 0 && pat[i - 1] === 'O') tgt = i - 1;
        else if (i + 1 < n && pat[i + 1] === 'O') tgt = i + 1;
        else {
          let bestD = 99;
          for (let j = 0; j < n; j++) {
            if (pat[j] === 'O' && Math.abs(j - i) < bestD) {
              bestD = Math.abs(j - i);
              tgt = j;
            }
          }
        }
        targets[i] = tgt;
        tracks[i] =
          i > 0 && pat[i - 1] === 'X' && targets[i - 1] === tgt
            ? tracks[i - 1] + 1
            : 1;
      }
      if (tracks[i] > maxTrack) maxTrack = tracks[i];
    }

    const panels: Array<{
      cx: number;
      w: number;
      track: number;
      operable: boolean;
    }> = [];
    for (let i = 0; i < n; i++) {
      let leftTrim = 0;
      let rightTrim = 0;
      if (i > 0 && tracks[i - 1] === tracks[i]) {
        leftTrim = effOverlap * 0.5 + clr * 0.6;
      }
      if (i + 1 < n && tracks[i + 1] === tracks[i]) {
        rightTrim = effOverlap * 0.5 + clr * 0.6;
      }
      const pw = Math.max(0.025, baseW - leftTrim - rightTrim);
      const xClosed = xBase[i] + (leftTrim - rightTrim) * 0.5;
      const operable = pat[i] === 'X';
      const dx = operable ? openFrac * (xBase[targets[i]] - xClosed) * 0.92 : 0;
      panels.push({cx: xClosed + dx, w: pw, track: tracks[i], operable});
    }
    return {pattern: pat, trackCount: maxTrack + 1, panels};
  }

  function buildFramedLitePanel(
    pw: number,
    ph: number,
    yBase: number,
    stileW: number,
    z0: number,
    z1: number,
    cols: number,
    rows: number,
  ): RawBufs {
    const hpw = pw * 0.5;
    const outer: Pt2[] = [
      [-hpw, yBase],
      [hpw, yBase],
      [hpw, yBase + ph],
      [-hpw, yBase + ph],
    ];
    const sw = Math.min(stileW, pw * 0.24, ph * 0.24);
    const mul = Math.min(sw * 0.5, pw * 0.08, ph * 0.08);
    const availW = pw - 2 * sw;
    const availH = ph - 2 * sw;
    const effCols = clamp(
      Math.min(cols, Math.floor((availW + mul) / (0.02 + mul))),
      1,
      16,
    );
    const effRows = clamp(
      Math.min(rows, Math.floor((availH + mul) / (0.02 + mul))),
      1,
      16,
    );
    const clearW = availW - (effCols - 1) * mul;
    const clearH = availH - (effRows - 1) * mul;
    const holes: Pt2[][] = [];
    if (clearW > 0.015 && clearH > 0.015) {
      const cw = clearW / effCols;
      const ch = clearH / effRows;
      for (let r = 0; r < effRows; r++) {
        for (let c = 0; c < effCols; c++) {
          const lx = -hpw + sw + c * (cw + mul) + cw * 0.5;
          const ly = yBase + sw + r * (ch + mul);
          holes.push(makeOpeningHoleCW(lx, ly, cw, ch, false));
        }
      }
    }
    return extrudeProfile(outer, holes, z0, z1, 'z');
  }

  // --- 4. DoorGeometry ---
  class DoorGeometry extends BufferGeometry {
    constructor(options: DoorOptions = {}) {
      super();
      const style: DoorStyle = options.style ?? 'panel-4';
      const operation: DoorOperation = options.operation ?? 'swing';
      const w = clamp(
        num(options.width, operation === 'slider' ? 1.8 : 0.9),
        0.4,
        8,
      );
      const h = clamp(num(options.height, 2.1), 1.0, 5);
      const leafT = clamp(num(options.thickness, 0.045), 0.02, 0.2);
      const includeFrame = options.includeFrame !== false;
      const fw = clamp(num(options.frameWidth, 0.075), 0.02, 0.3);
      const fd = clamp(num(options.frameDepth, 0.2), leafT + 0.04, 1.0);
      const hingeSide = options.hinge === 'right' ? 'right' : 'left';
      const swingDir = options.swingDirection === 'in' ? -1 : 1;
      const slideSide = options.slideSide ?? 'right';
      const openFrac = clamp(num(options.openFraction, 0), 0, 1);
      const hasExplicitAngle = options.openAngleDeg != null;
      const openDeg = clamp(
        hasExplicitAngle ? num(options.openAngleDeg, 0) : openFrac * 85,
        -170,
        170,
      );
      const handleStyle: DoorHandleStyle =
        options.handle ??
        (operation === 'slider' ||
        operation === 'barn' ||
        operation === 'pocket'
          ? 'pull'
          : operation === 'bifold'
            ? 'knob'
            : 'lever');
      const origin = options.origin ?? 'floor';

      const hW = w * 0.5;
      const parts: RawBufs[] = [];
      const isArched = style === 'arched' && operation === 'swing';

      // Build one door leaf centered at x = 0, y ∈ [yLeaf0, yLeaf0 + lh], z ∈ [-lt/2, +lt/2]
      const buildDoorLeaf = (
        lw: number,
        lh: number,
        yLeaf0: number,
        lt: number,
        latchSign: number,
        archMode: 'none' | 'full' | 'left-half' | 'right-half',
      ): RawBufs => {
        const lhw = lw * 0.5;
        const leafOuter: Pt2[] = [
          [-lhw, yLeaf0],
          [lhw, yLeaf0],
        ];
        if (archMode === 'full') {
          const archR = Math.min(lhw, lh * 0.48);
          const spY = yLeaf0 + lh - archR;
          for (let i = 0; i <= 14; i++) {
            const a = (Math.PI * i) / 14;
            leafOuter.push([lhw * Math.cos(a), spY + archR * Math.sin(a)]);
          }
        } else if (archMode === 'left-half' || archMode === 'right-half') {
          const portalArchRise = Math.min(h * 0.48, hW);
          const spY = Math.max(yLeaf0 + 0.08, h - portalArchRise);
          const archRy = Math.max(0.04, yLeaf0 + lh - spY);
          const isLeft = archMode === 'left-half';
          const segs = 10;
          for (let i = 0; i <= segs; i++) {
            // Walk CCW along top from x = +lhw to x = -lhw
            const xl = lhw - (lw * i) / segs;
            const uFrac = isLeft
              ? clamp((lhw - xl) / lw, 0, 1)
              : clamp((xl + lhw) / lw, 0, 1);
            const yArc =
              spY + archRy * Math.sqrt(Math.max(0, 1 - uFrac * uFrac));
            leafOuter.push([xl, yArc]);
          }
        } else {
          leafOuter.push([lhw, yLeaf0 + lh], [-lhw, yLeaf0 + lh]);
        }

        const stileW = Math.min(0.13, lw * 0.16);
        const leafParts: RawBufs[] = [];

        if (
          style === 'panel-1' ||
          style === 'panel-2' ||
          style === 'panel-4' ||
          style === 'panel-6'
        ) {
          const webT = lt * 0.4;
          const stileT = (lt - webT) * 0.5;
          leafParts.push(
            extrudeProfile(leafOuter, [], -webT * 0.5, webT * 0.5, 'z'),
          );
          const cols = style === 'panel-4' || style === 'panel-6' ? 2 : 1;
          const rows = style === 'panel-1' ? 1 : style === 'panel-6' ? 3 : 2;
          const pHoles: Pt2[][] = [];
          const usableW = lw - stileW * (cols + 1);
          const usableH = lh - stileW * (rows + 1.3);
          if (usableW > 0.04 && usableH > 0.06) {
            const pw = usableW / cols;
            const ph = usableH / rows;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                const cx = -lhw + stileW * (c + 1) + pw * (c + 0.5);
                const y0 = yLeaf0 + stileW * (1.15 + r) + ph * r;
                pHoles.push(makeOpeningHoleCW(cx, y0, pw, ph, false));
              }
            }
          }
          leafParts.push(
            extrudeProfile(
              leafOuter,
              pHoles,
              webT * 0.5 + 1e-4,
              webT * 0.5 + stileT,
              'z',
            ),
            extrudeProfile(
              leafOuter,
              pHoles,
              -webT * 0.5 - stileT,
              -webT * 0.5 - 1e-4,
              'z',
            ),
          );
        } else if (style === 'half-lite') {
          // Upper glass lite hole + lower recessed shaker panel
          const liteW = lw - 2 * stileW;
          const liteY0 = yLeaf0 + lh * 0.48;
          const liteH = lh * 0.52 - stileW * 1.1;
          const lowerH = lh * 0.48 - stileW * 2.2;
          const upperHoles =
            liteW > 0.025 && liteH > 0.03
              ? [makeOpeningHoleCW(0, liteY0, liteW, liteH, false)]
              : [];
          const webT = lt * 0.4;
          const stileT = (lt - webT) * 0.5;
          leafParts.push(
            extrudeProfile(leafOuter, upperHoles, -webT * 0.5, webT * 0.5, 'z'),
          );
          const faceHoles =
            liteW > 0.025 && lowerH > 0.03
              ? [
                  ...upperHoles,
                  makeOpeningHoleCW(
                    0,
                    yLeaf0 + stileW * 1.2,
                    liteW,
                    lowerH,
                    false,
                  ),
                ]
              : upperHoles;
          leafParts.push(
            extrudeProfile(
              leafOuter,
              faceHoles,
              webT * 0.5 + 1e-4,
              webT * 0.5 + stileT,
              'z',
            ),
            extrudeProfile(
              leafOuter,
              faceHoles,
              -webT * 0.5 - stileT,
              -webT * 0.5 - 1e-4,
              'z',
            ),
          );
        } else if (style === 'french') {
          const cols = lw > 0.7 ? 2 : 1;
          const rows = 4;
          const mul = stileW * 0.36;
          const clearW = lw - 2 * stileW - (cols - 1) * mul;
          const clearH = lh - stileW * 2.4 - (rows - 1) * mul;
          const fHoles: Pt2[][] = [];
          if (clearW > 0.04 && clearH > 0.08) {
            const cw = clearW / cols;
            const ch = clearH / rows;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                const cx = -lhw + stileW + c * (cw + mul) + cw * 0.5;
                const y0 = yLeaf0 + stileW * 1.4 + r * (ch + mul);
                fHoles.push(makeOpeningHoleCW(cx, y0, cw, ch, false));
              }
            }
          }
          leafParts.push(
            extrudeProfile(leafOuter, fHoles, -lt * 0.5, lt * 0.5, 'z'),
          );
        } else if (style === 'louvered') {
          const openW = lw - 2 * stileW;
          const openY0 = yLeaf0 + stileW * 1.3;
          const openH = lh - stileW * 2.4;
          if (openW > 0.025 && openH > 0.06) {
            leafParts.push(
              extrudeProfile(
                leafOuter,
                [makeOpeningHoleCW(0, openY0, openW, openH, false)],
                -lt * 0.5,
                lt * 0.5,
                'z',
              ),
            );
            const nSlats = clamp(Math.floor(openH / 0.055), 2, 32);
            const slatW = openW - 0.002;
            const slatStep = openH / (nSlats + 1);
            for (let s = 1; s <= nSlats; s++) {
              const sy = openY0 + s * slatStep;
              const slat = buildBox(0, 0, 0, slatW, 0.008, lt * 0.72);
              xformRawX(slat, 0, sy, 0, 0.48, 0, 0);
              leafParts.push(slat);
            }
          } else {
            leafParts.push(
              extrudeProfile(leafOuter, [], -lt * 0.5, lt * 0.5, 'z'),
            );
          }
        } else {
          const leafHoles: Pt2[][] = [];
          if (style === 'vision-lite' && lw * 0.3 > 0.02 && lh * 0.36 > 0.04) {
            leafHoles.push(
              makeOpeningHoleCW(
                0,
                yLeaf0 + lh * 0.52,
                lw * 0.3,
                lh * 0.36,
                false,
              ),
            );
          }
          leafParts.push(
            extrudeProfile(leafOuter, leafHoles, -lt * 0.5, lt * 0.5, 'z'),
          );
        }

        // Hardware trim on both faces of active leaf (2e-4 m proud of leaf surfaces)
        if (handleStyle !== 'none' && latchSign !== 0 && lw > 0.24) {
          const hy = yLeaf0 + Math.min(lh * 0.47, 0.98);
          const hx =
            latchSign * Math.max(0, lhw - Math.max(0.055, stileW * 0.5));
          for (const zSgn of [-1, 1]) {
            const zSurf = zSgn * (lt * 0.5 + 3e-4);
            if (handleStyle === 'push-bar') {
              const barW = lw * 0.74;
              leafParts.push(
                buildBox(
                  -barW * 0.38,
                  hy,
                  zSurf + zSgn * 0.018,
                  0.04,
                  0.05,
                  0.036,
                ),
                buildBox(
                  barW * 0.38,
                  hy,
                  zSurf + zSgn * 0.018,
                  0.04,
                  0.05,
                  0.036,
                ),
                buildBox(0, hy, zSurf + zSgn * 0.045, barW, 0.034, 0.016),
              );
            } else if (handleStyle === 'pull') {
              leafParts.push(
                buildBox(
                  hx,
                  hy + 0.08,
                  zSurf + zSgn * 0.014,
                  0.016,
                  0.016,
                  0.028,
                ),
                buildBox(
                  hx,
                  hy - 0.08,
                  zSurf + zSgn * 0.014,
                  0.016,
                  0.016,
                  0.028,
                ),
                buildBox(hx, hy, zSurf + zSgn * 0.036, 0.018, 0.22, 0.016),
              );
            } else if (handleStyle === 'knob') {
              const knob = revolveClosedProfile(
                [
                  [0, 0],
                  [0.026, 0],
                  [0.026, 0.008],
                  [0.011, 0.01],
                  [0.011, 0.032],
                  [0.027, 0.042],
                  [0.027, 0.058],
                  [0, 0.062],
                ],
                16,
              );
              xformRawX(
                knob,
                hx,
                hy,
                zSurf,
                zSgn > 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
                0,
                0,
              );
              leafParts.push(knob);
            } else {
              // 'lever'
              const leverLen = Math.min(0.115, lw * 0.28);
              leafParts.push(
                buildBox(hx, hy, zSurf + zSgn * 0.004, 0.046, 0.046, 0.008),
                buildBox(hx, hy, zSurf + zSgn * 0.024, 0.018, 0.018, 0.03),
                buildBox(
                  hx - latchSign * (leverLen * 0.5 - 0.009),
                  hy,
                  zSurf + zSgn * 0.046,
                  leverLen,
                  0.018,
                  0.012,
                ),
              );
            }
          }
        }
        return mergeRaw(leafParts);
      };

      // Helper for standard 3-sided doorway portal frame
      const emitPortalFrame = () => {
        const frameOuter: Pt2[] = [
          [-hW - fw, 0],
          [hW + fw, 0],
        ];
        if (isArched) {
          const innerArchRise = Math.min(h * 0.48, hW);
          const springOuterY = h - innerArchRise;
          const outerRx = hW + fw;
          const outerRy = innerArchRise + fw;
          for (let i = 0; i <= 14; i++) {
            const a = (Math.PI * i) / 14;
            frameOuter.push([
              outerRx * Math.cos(a),
              springOuterY + outerRy * Math.sin(a),
            ]);
          }
        } else {
          frameOuter.push([hW + fw, h + fw], [-hW - fw, h + fw]);
        }
        const innerCutCW = makeOpeningHoleCW(
          0,
          0,
          w,
          h,
          isArched ? 'semicircular' : false,
        );
        const portal: Pt2[] = [[-hW - fw, 0]];
        for (const p of innerCutCW) portal.push(p);
        portal.push([hW + fw, 0]);
        for (let i = 2; i < frameOuter.length; i++) portal.push(frameOuter[i]);
        parts.push(extrudeProfile(portal, [], -fd * 0.5, fd * 0.5, 'z'));
      };

      if (operation === 'slider') {
        const sillH = 0.025;
        if (includeFrame) {
          const fOuter: Pt2[] = [
            [-hW - fw, 0],
            [hW + fw, 0],
            [hW + fw, h + fw],
            [-hW - fw, h + fw],
          ];
          const fHole = makeOpeningHoleCW(0, sillH, w, h - sillH, false);
          parts.push(extrudeProfile(fOuter, [fHole], -fd * 0.5, fd * 0.5, 'z'));
        }
        const defaultPat =
          options.leaves === 4 ? 'OXXO' : options.leaves === 1 ? 'XO' : 'XO';
        const clr = 0.003;
        const overlapW = Math.min(0.06, w * 0.04);
        const solved = resolveSliderPanels(
          options.trackPattern ?? defaultPat,
          w,
          clr,
          overlapW,
          openFrac,
        );
        const pThick = Math.min(
          leafT,
          (fd * 0.82) / Math.max(2, solved.trackCount),
        );
        const zSpan = (solved.trackCount - 1) * (pThick + 0.006);
        for (let i = 0; i < solved.panels.length; i++) {
          const pan = solved.panels[i];
          const zMid = zSpan * 0.5 - pan.track * (pThick + 0.006);
          const latchSign = pan.operable ? (pan.cx <= 0 ? -1 : 1) : 0;
          const leaf = buildDoorLeaf(
            pan.w,
            h - sillH - 2 * clr,
            sillH + clr,
            pThick,
            latchSign,
            'none',
          );
          xformRaw(leaf, pan.cx, 0, zMid);
          parts.push(leaf);
        }
      } else if (operation === 'barn') {
        if (includeFrame) emitPortalFrame();
        const zLeafMid = (includeFrame ? fd * 0.5 : 0) + leafT * 0.5 + 0.02;
        const topFrameY = includeFrame ? h + fw : h;
        const railY = topFrameY + 0.055;
        const zRail = zLeafMid + leafT * 0.5 + 0.016;
        const biPart = slideSide === 'bi-parting' || options.leaves === 2;
        const railLen = biPart ? w * 2.15 : w * 2.08;
        const railShiftX = biPart
          ? 0
          : (slideSide === 'left' ? -1 : 1) * w * 0.48;
        // Exposed flat-bar steel track rail + wall standoffs
        parts.push(buildBox(railShiftX, railY, zRail, railLen, 0.042, 0.009));
        const standoffLen = Math.max(
          0.012,
          zRail - 0.005 - (includeFrame ? fd * 0.5 : 0) - 4e-4,
        );
        const zStandoff = zRail - 0.005 - standoffLen * 0.5 - 2e-4;
        for (let k = 0; k < 4; k++) {
          const sx = railShiftX - railLen * 0.44 + (railLen * 0.88 * k) / 3;
          parts.push(buildBox(sx, railY, zStandoff, 0.022, 0.022, standoffLen));
        }

        const nLeaves = biPart ? 2 : 1;
        const overW = w + 0.08;
        const singleW = nLeaves === 2 ? overW * 0.5 - 0.002 : overW;
        for (let k = 0; k < nLeaves; k++) {
          const dir =
            nLeaves === 2 ? (k === 0 ? -1 : 1) : slideSide === 'left' ? -1 : 1;
          const xClosed = nLeaves === 2 ? dir * (singleW * 0.5 + 0.001) : 0;
          const xCur = xClosed + dir * openFrac * singleW * 0.92;
          const leaf = buildDoorLeaf(
            singleW,
            h + 0.02,
            0.008,
            leafT,
            -dir,
            'none',
          );
          xformRaw(leaf, xCur, 0, zLeafMid);
          parts.push(leaf);
          // Twin vertical roller strap hangers + track wheels
          for (const sgn of [-1, 1]) {
            const hx = xCur + sgn * singleW * 0.34;
            const strapBot = h - 0.14;
            const strapTop = railY + 0.055;
            parts.push(
              buildBox(
                hx,
                (strapBot + strapTop) * 0.5,
                zLeafMid + leafT * 0.5 + 0.005,
                0.036,
                strapTop - strapBot,
                0.008,
              ),
            );
            const wheel = revolveClosedProfile(
              [
                [0, -0.006],
                [0.036, -0.006],
                [0.036, -0.002],
                [0.028, 0],
                [0.036, 0.002],
                [0.036, 0.006],
                [0, 0.006],
              ],
              18,
            );
            xformRawX(wheel, hx, railY + 0.032, zRail, Math.PI * 0.5, 0, 0);
            parts.push(wheel);
          }
        }
      } else if (operation === 'pocket') {
        const biPart = slideSide === 'bi-parting' || options.leaves === 2;
        const pDir = slideSide === 'left' ? -1 : 1;
        if (includeFrame) {
          // Header across full doorway + solid strike jamb (or split jambs on pocket side(s))
          parts.push(buildBox(0, h + fw * 0.5, 0, w + 2 * fw, fw, fd));
          const cheekT = Math.max(0.015, (fd - leafT - 0.012) * 0.5);
          const zCheek = fd * 0.5 - cheekT * 0.5;
          for (const side of [-1, 1]) {
            const jx = side * (hW + fw * 0.5);
            const isSplit = biPart || side === pDir;
            if (isSplit) {
              parts.push(
                buildBox(jx, h * 0.5 - 2e-4, zCheek, fw, h - 4e-4, cheekT),
                buildBox(jx, h * 0.5 - 2e-4, -zCheek, fw, h - 4e-4, cheekT),
              );
            } else {
              parts.push(buildBox(jx, h * 0.5 - 2e-4, 0, fw, h - 4e-4, fd));
            }
          }
        }
        const nLeaves = biPart ? 2 : 1;
        const lw = nLeaves === 2 ? hW - 0.002 : w - 0.004;
        for (let k = 0; k < nLeaves; k++) {
          const dir = nLeaves === 2 ? (k === 0 ? -1 : 1) : pDir;
          const xClosed = nLeaves === 2 ? dir * (lw * 0.5 + 0.001) : 0;
          const xSlide = xClosed + dir * openFrac * lw * 0.88;
          const leaf = buildDoorLeaf(lw, h - 0.008, 0.004, leafT, -dir, 'none');
          xformRaw(leaf, xSlide, 0, 0);
          parts.push(leaf);
        }
      } else if (operation === 'bifold') {
        if (includeFrame) emitPortalFrame();
        const gap = includeFrame ? 0.003 : 0;
        const nPairs = options.leaves === 4 ? 2 : 1;
        const pairW = (w - 2 * gap - (nPairs === 2 ? 0.004 : 0)) / nPairs;
        const panelW = (pairW - 0.004) * 0.5;
        const theta = openFrac * ((76 * Math.PI) / 180);
        for (let p = 0; p < nPairs; p++) {
          const anchorLeft = nPairs === 2 ? p === 0 : hingeSide === 'left';
          const sgn = anchorLeft ? 1 : -1;
          const xPin = anchorLeft ? -hW + gap : hW - gap;
          // Panel A hinged at outer jamb xPin
          const panA = buildDoorLeaf(
            panelW,
            h - gap - 0.008,
            0.004,
            leafT,
            0,
            'none',
          );
          xformRaw(panA, xPin + sgn * panelW * 0.5, 0, 0);
          const rotA = -sgn * swingDir * theta;
          xformRaw(panA, 0, 0, 0, rotA, xPin, swingDir * leafT * 0.5);
          parts.push(panA);

          // Hinge knuckle connecting Panel A to Panel B
          const xKnuckle = xPin + sgn * (panelW + 0.004) * Math.cos(theta);
          const zKnuckle = swingDir * (panelW + 0.004) * Math.sin(theta);
          const panB = buildDoorLeaf(
            panelW,
            h - gap - 0.008,
            0.004,
            leafT,
            -sgn,
            'none',
          );
          xformRaw(panB, xKnuckle + sgn * panelW * 0.5, 0, zKnuckle);
          xformRaw(panB, 0, 0, 0, -rotA, xKnuckle, zKnuckle);
          parts.push(panB);
        }
      } else {
        // 'swing': single or double (French/corridor/arched) hinged doors
        if (includeFrame) emitPortalFrame();
        const gap = includeFrame ? 0.003 : 0;
        const nLeaves = options.leaves === 2 ? 2 : 1;
        const lw = nLeaves === 2 ? (w - 2 * gap - 0.004) * 0.5 : w - 2 * gap;
        const lh = h - gap - 0.004;
        const effDeg = hasExplicitAngle ? openDeg : swingDir * openDeg;
        const angRad = (effDeg * Math.PI) / 180;

        for (let k = 0; k < nLeaves; k++) {
          const isRightHinge = nLeaves === 2 ? k === 1 : hingeSide === 'right';
          const latchSign = isRightHinge ? -1 : 1;
          const archMode = !isArched
            ? 'none'
            : nLeaves === 1
              ? 'full'
              : k === 0
                ? 'left-half'
                : 'right-half';
          const leaf = buildDoorLeaf(lw, lh, 0.004, leafT, latchSign, archMode);
          const cx =
            nLeaves === 2 ? (k === 0 ? -1 : 1) * (lw * 0.5 + 0.002) : 0;
          xformRaw(leaf, cx, 0, 0);
          if (Math.abs(angRad) > 1e-6) {
            const pivotX = cx + (isRightHinge ? lw * 0.5 : -lw * 0.5);
            const pivotZ = (angRad >= 0 ? 1 : -1) * leafT * 0.5;
            const rotY = (isRightHinge ? 1 : -1) * angRad;
            xformRaw(leaf, 0, 0, 0, rotY, pivotX, pivotZ);
          }
          parts.push(leaf);
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -h * 0.5, 0);

      applyBuffers(this, merged, 'DoorGeometry', {
        style,
        operation,
        leaves: options.leaves ?? 1,
        hinge: hingeSide,
        handle: handleStyle,
        width: w,
        height: h,
        thickness: leafT,
        includeFrame,
        openFraction: openFrac,
        openAngleDeg: openDeg,
      });
    }
  }

  // --- 5. WindowGeometry ---
  class WindowGeometry extends BufferGeometry {
    constructor(options: WindowOptions = {}) {
      super();
      const style: WindowStyle = options.style ?? 'mullion-grid';
      const w = clamp(num(options.width, 1.2), 0.3, 12);
      const h = clamp(num(options.height, 1.4), 0.3, 12);
      const fw = clamp(
        num(options.frameWidth, 0.065),
        0.02,
        Math.min(w, h) * 0.25,
      );
      const fd = clamp(num(options.frameDepth, 0.14), 0.03, 1.0);
      const openFrac = clamp(num(options.openFraction, 0), 0, 1);
      const topOpenFrac = clamp(num(options.topOpenFraction, 0), 0, 1);
      const hingeSide = options.hinge === 'right' ? 'right' : 'left';
      const hasSill = options.sill !== false;
      const hasCasing = Boolean(options.casing);
      const origin = options.origin ?? 'sill';

      const hW = w * 0.5;
      const isArched = style === 'arched';
      const isOperableSash =
        style === 'single-hung' ||
        style === 'double-hung' ||
        style === 'slider' ||
        style === 'casement' ||
        style === 'awning' ||
        style === 'hopper';

      const defaultCols =
        style === 'mullion-grid' || style === 'arched' ? 2 : 1;
      const defaultRows =
        style === 'mullion-grid' || style === 'arched' ? 2 : 1;
      const cols = clampInt(
        options.mullionsX ?? options.cols,
        1,
        16,
        defaultCols,
      );
      const rows = clampInt(
        options.mullionsY ?? options.rows,
        1,
        16,
        defaultRows,
      );

      const parts: RawBufs[] = [];

      if (isOperableSash) {
        // Outer perimeter window frame with single clear opening, plus inset operable sash sub-solids!
        const outer: Pt2[] = [
          [-hW, 0],
          [hW, 0],
          [hW, h],
          [-hW, h],
        ];
        const clearW = Math.max(0.08, w - 2 * fw);
        const clearH = Math.max(0.08, h - 2 * fw);
        parts.push(
          extrudeProfile(
            outer,
            [makeOpeningHoleCW(0, fw, clearW, clearH, false)],
            -fd * 0.5,
            fd * 0.5,
            'z',
          ),
        );

        const sw = Math.max(0.018, fw * 0.62);
        const sd = fd * 0.32;
        const clr = 0.0025;

        if (style === 'single-hung' || style === 'double-hung') {
          const sashW = clearW - 2 * clr;
          const sashH = clearH * 0.5 + sw * 0.45;
          const maxTravel = Math.max(0, clearH - sashH - 2 * clr);
          const yUpper =
            fw +
            clearH -
            clr -
            sashH -
            (style === 'double-hung' ? topOpenFrac * maxTravel : 0);
          const yLower = fw + clr + openFrac * maxTravel;
          // Upper sash on exterior (+Z) track, lower sash on interior (-Z) track
          parts.push(
            buildFramedLitePanel(
              sashW,
              sashH,
              yUpper,
              sw,
              0.003,
              0.003 + sd,
              cols,
              rows,
            ),
            buildFramedLitePanel(
              sashW,
              sashH,
              yLower,
              sw,
              -0.003 - sd,
              -0.003,
              cols,
              rows,
            ),
          );
        } else if (style === 'slider') {
          const solved = resolveSliderPanels(
            options.trackPattern ?? 'XO',
            clearW,
            clr,
            sw * 0.85,
            openFrac,
          );
          const pThick = Math.min(
            sd,
            (fd * 0.8) / Math.max(2, solved.trackCount),
          );
          const zSpan = (solved.trackCount - 1) * (pThick + 0.005);
          for (const pan of solved.panels) {
            const zMid = zSpan * 0.5 - pan.track * (pThick + 0.005);
            const sash = buildFramedLitePanel(
              pan.w,
              clearH - 2 * clr,
              fw + clr,
              sw,
              zMid - pThick * 0.5,
              zMid + pThick * 0.5,
              cols,
              rows,
            );
            xformRaw(sash, pan.cx, 0, 0);
            parts.push(sash);
          }
        } else if (style === 'casement') {
          const nLeaves = options.leaves === 2 ? 2 : 1;
          const sashW =
            nLeaves === 2 ? (clearW - 3 * clr) * 0.5 : clearW - 2 * clr;
          const sashH = clearH - 2 * clr;
          const ang = openFrac * ((72 * Math.PI) / 180);
          for (let k = 0; k < nLeaves; k++) {
            const rightHinged = nLeaves === 2 ? k === 1 : hingeSide === 'right';
            const sash = buildFramedLitePanel(
              sashW,
              sashH,
              fw + clr,
              sw,
              -sd * 0.5,
              sd * 0.5,
              cols,
              rows,
            );
            const cx =
              nLeaves === 2
                ? (k === 0 ? -1 : 1) * (sashW * 0.5 + clr * 0.5)
                : 0;
            xformRaw(sash, cx, 0, 0);
            if (ang > 1e-6) {
              const pivotX = cx + (rightHinged ? sashW * 0.5 : -sashW * 0.5);
              xformRaw(
                sash,
                0,
                0,
                0,
                (rightHinged ? 1 : -1) * ang,
                pivotX,
                sd * 0.5,
              );
            }
            parts.push(sash);
          }
        } else {
          // 'awning' (top-hinged outward +Z) or 'hopper' (bottom-hinged inward -Z)
          const sashW = clearW - 2 * clr;
          const sashH = clearH - 2 * clr;
          const sash = buildFramedLitePanel(
            sashW,
            sashH,
            fw + clr,
            sw,
            -sd * 0.5,
            sd * 0.5,
            cols,
            rows,
          );
          const isAwning = style === 'awning';
          const tiltRad = -openFrac * (((isAwning ? 45 : 35) * Math.PI) / 180);
          if (Math.abs(tiltRad) > 1e-6) {
            xformRawX(
              sash,
              0,
              0,
              0,
              tiltRad,
              isAwning ? fw + clr + sashH : fw + clr,
              isAwning ? sd * 0.5 : -sd * 0.5,
            );
          }
          parts.push(sash);
        }
      } else {
        // 'fixed', 'picture', 'mullion-grid', or 'arched'
        const outer: Pt2[] = [
          [-hW, 0],
          [hW, 0],
        ];
        if (isArched) {
          const archR = Math.min(hW, h * 0.45);
          const spY = h - archR;
          outer.push([hW, spY]);
          for (let i = 1; i < 14; i++) {
            const a = (Math.PI * i) / 14;
            outer.push([hW * Math.cos(a), spY + archR * Math.sin(a)]);
          }
          outer.push([-hW, spY]);
        } else {
          outer.push([hW, h], [-hW, h]);
        }

        const mulW = Math.min(fw * 0.48, w * 0.06, h * 0.06);
        const availW = Math.max(0.04, w - 2 * fw);
        const availH = Math.max(
          0.04,
          (isArched ? h - Math.min(hW, h * 0.45) : h) - 2 * fw,
        );
        const effCols = clamp(
          Math.min(cols, Math.floor((availW + mulW) / (0.025 + mulW))),
          1,
          16,
        );
        const effRows = clamp(
          Math.min(rows, Math.floor((availH + mulW) / (0.025 + mulW))),
          1,
          16,
        );
        const innerW = availW - (effCols - 1) * mulW;
        const innerH = availH - (effRows - 1) * mulW;
        const paneW = innerW / effCols;
        const paneH = innerH / effRows;
        const holes: Pt2[][] = [];

        if (paneW > 0.015 && paneH > 0.015) {
          for (let r = 0; r < effRows; r++) {
            for (let c = 0; c < effCols; c++) {
              const cx = -hW + fw + c * (paneW + mulW) + paneW * 0.5;
              const y0 = fw + r * (paneH + mulW);
              holes.push(makeOpeningHoleCW(cx, y0, paneW, paneH, false));
            }
          }
        }
        if (isArched) {
          const archR = Math.min(hW, h * 0.45);
          const yCenter = h - archR;
          const fanRx = hW - fw;
          const fanRy = archR - fw;
          const yBase = yCenter + mulW * 0.5;
          if (fanRx > 0.03 && fanRy > mulW * 0.5 + 0.02) {
            const s0 = clamp((yBase - yCenter) / fanRy, 0, 0.85);
            const a0 = Math.asin(s0);
            const fanPts: Pt2[] = [];
            const arcSegs = 12;
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI - a0 - ((Math.PI - 2 * a0) * i) / arcSegs;
              fanPts.push([fanRx * Math.cos(a), yCenter + fanRy * Math.sin(a)]);
            }
            holes.push(fanPts);
          }
        }
        parts.push(extrudeProfile(outer, holes, -fd * 0.5, fd * 0.5, 'z'));
      }

      if (hasCasing && !isArched) {
        const cw = fw * 0.85;
        const ct = 0.016;
        const cBot = 2e-4;
        const casingFace = hasSill
          ? extrudeProfile(
              [
                [-hW - cw, cBot],
                [-hW, cBot],
                [-hW, h],
                [hW, h],
                [hW, cBot],
                [hW + cw, cBot],
                [hW + cw, h + cw],
                [-hW - cw, h + cw],
              ],
              [],
              fd * 0.5 + 2e-4,
              fd * 0.5 + 2e-4 + ct,
              'z',
            )
          : extrudeProfile(
              [
                [-hW - cw, -cw],
                [hW + cw, -cw],
                [hW + cw, h + cw],
                [-hW - cw, h + cw],
              ],
              [makeOpeningHoleCW(0, 0, w, h, false)],
              fd * 0.5 + 2e-4,
              fd * 0.5 + 2e-4 + ct,
              'z',
            );
        const casingBack = cloneRaw(casingFace);
        xformRaw(casingBack, 0, 0, -(fd + 4e-4 + ct));
        parts.push(casingFace, casingBack);
      }

      if (hasSill) {
        const sD = clamp(num(options.sillDepth, fd + 0.07), fd + 0.02, 0.8);
        const sT = clamp(num(options.sillThickness, 0.04), 0.015, 0.2);
        parts.push(
          buildBox(0, -sT * 0.5 - 1e-4, (sD - fd) * 0.35, w + fw * 1.6, sT, sD),
        );
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -h * 0.5, 0);

      applyBuffers(this, merged, 'WindowGeometry', {
        style,
        width: w,
        height: h,
        cols,
        rows,
        openFraction: openFrac,
        sill: hasSill,
        casing: hasCasing,
      });
    }
  }

  // --- 6. RailingGeometry ---
  class RailingGeometry extends BufferGeometry {
    constructor(options: RailingOptions = {}) {
      super();
      const style = options.style ?? 'baluster';
      const len = clamp(num(options.length, 3.0), 0.3, 100);
      const h = clamp(num(options.height, 1.07), 0.4, 4);
      const postSp = clamp(num(options.postSpacing, 1.5), 0.3, 6);
      const balSp = clamp(num(options.balusterSpacing, 0.1), 0.05, 0.5);
      const postSz = clamp(
        num(options.postSize, 0.05),
        0.02,
        Math.min(0.3, len * 0.28),
      );
      const railW = clamp(num(options.railWidth, 0.06), postSz, 0.35);
      const railH = clamp(
        num(options.railHeight, 0.04),
        0.015,
        Math.min(0.2, h * 0.22),
      );
      const origin = options.origin ?? 'floor';

      const hL = len * 0.5;
      const maxBays = Math.max(1, Math.floor((len - postSz) / (postSz * 1.4)));
      const bays = clamp(Math.ceil(len / postSp), 1, Math.min(64, maxBays));
      const bayLen = (len - postSz) / bays;
      const parts: RawBufs[] = [];

      // Continuous top rail
      const yTopRailBot = h - railH;
      parts.push(
        buildBox(0, h - railH * 0.5, 0, len + postSz * 0.4, railH, railW),
      );

      // Posts (`y ∈ [0, yTopRailBot - 2e-4]`)
      const postH = Math.max(0.05, yTopRailBot - 2e-4);
      for (let b = 0; b <= bays; b++) {
        const px = -hL + postSz * 0.5 + b * bayLen;
        parts.push(buildBox(px, postH * 0.5, 0, postSz, postH, postSz));
      }

      // Bottom rail + infill per bay
      const botClear = Math.min(0.09, h * 0.12);
      const botRailH = railH * 0.75;
      const yInfill0 = botClear + botRailH + 2e-4;
      const yInfill1 = yTopRailBot - 2e-4;
      const infillH = Math.max(0.04, yInfill1 - yInfill0);

      for (let b = 0; b < bays; b++) {
        const xA = -hL + postSz + b * bayLen + 2e-4;
        const xB = -hL + b * bayLen + bayLen - 2e-4;
        const clearSpan = xB - xA;
        if (clearSpan <= 0.02) continue;
        const xMid = (xA + xB) * 0.5;
        parts.push(
          buildBox(
            xMid,
            botClear + botRailH * 0.5,
            0,
            clearSpan,
            botRailH,
            postSz * 0.7,
          ),
        );

        if (style === 'panel') {
          parts.push(
            buildBox(
              xMid,
              (yInfill0 + yInfill1) * 0.5,
              0,
              Math.max(0.02, clearSpan - 0.03),
              Math.max(0.02, infillH - 0.03),
              0.014,
            ),
          );
        } else if (style === 'horizontal-bar') {
          const nBars = clampInt(options.horizontalBars, 2, 16, 5);
          const barD = Math.min(0.016, infillH / (nBars * 2.5));
          for (let k = 1; k <= nBars; k++) {
            const by = yInfill0 + (infillH * k) / (nBars + 1);
            parts.push(buildBox(xMid, by, 0, clearSpan, barD, barD));
          }
        } else {
          const nBal = clamp(Math.floor(clearSpan / balSp), 1, MAX_PICKETS);
          const pSz = Math.min(0.018, postSz * 0.4);
          for (let k = 1; k <= nBal; k++) {
            const bx = xA + (clearSpan * k) / (nBal + 1);
            parts.push(
              buildBox(bx, (yInfill0 + yInfill1) * 0.5, 0, pSz, infillH, pSz),
            );
          }
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -h * 0.5, 0);

      applyBuffers(this, merged, 'RailingGeometry', {
        style,
        length: len,
        height: h,
        bays,
      });
    }
  }

  // --- 7. ColumnGeometry ---
  class ColumnGeometry extends BufferGeometry {
    constructor(options: ColumnOptions = {}) {
      super();
      const style = options.style ?? 'doric';
      const h = clamp(num(options.height, 3.0), 0.4, 40);
      const r = clamp(
        options.diameter != null
          ? num(options.diameter, 0.44) * 0.5
          : num(options.radius, 0.22),
        0.04,
        5,
      );
      const entasis = clamp(num(options.entasis, 0.86), 0.6, 1.0);
      const baseH = clamp(
        num(options.baseHeight, Math.min(h * 0.1, r * 1.1)),
        0.02,
        h * 0.3,
      );
      const capH = clamp(
        num(options.capitalHeight, Math.min(h * 0.1, r * 1.05)),
        0.02,
        h * 0.3,
      );
      const radialSegs = clampInt(options.radialSegments, 12, MAX_SEGS, 32);
      const origin = options.origin ?? 'floor';

      let raw: RawBufs;
      if (style === 'h-column') {
        const w = r * 2;
        const tf = w * 0.09;
        const tw = w * 0.065;
        const hw = w * 0.5;
        const profile: Pt2[] = [
          [-hw, -hw],
          [hw, -hw],
          [hw, -hw + tf],
          [tw * 0.5, -hw + tf],
          [tw * 0.5, hw - tf],
          [hw, hw - tf],
          [hw, hw],
          [-hw, hw],
          [-hw, hw - tf],
          [-tw * 0.5, hw - tf],
          [-tw * 0.5, -hw + tf],
          [-hw, -hw + tf],
        ];
        const parts: RawBufs[] = [
          buildBox(0, baseH * 0.25, 0, w * 1.45, baseH * 0.5, w * 1.45),
          extrudeProfile(
            profile,
            [],
            baseH * 0.5 + 2e-4,
            h - baseH * 0.3 - 2e-4,
            'y',
          ),
          buildBox(0, h - baseH * 0.15, 0, w * 1.35, baseH * 0.3, w * 1.35),
        ];
        raw = mergeRaw(parts);
      } else if (style === 'square-pilaster') {
        const w = r * 2;
        const wt = w * entasis;
        raw = mergeRaw([
          buildBox(0, baseH * 0.35, 0, w * 1.35, baseH * 0.7, w * 1.35),
          buildBox(0, baseH * 0.85 + 2e-4, 0, w * 1.15, baseH * 0.3, w * 1.15),
          buildBox(
            0,
            (baseH + h - capH) * 0.5,
            0,
            (w + wt) * 0.5,
            Math.max(0.05, h - baseH - capH - 8e-4),
            (w + wt) * 0.5,
          ),
          buildBox(
            0,
            h - capH * 0.75,
            0,
            wt * 1.2,
            capH * 0.5 - 2e-4,
            wt * 1.2,
          ),
          buildBox(
            0,
            h - capH * 0.25,
            0,
            w * 1.35,
            capH * 0.5 - 2e-4,
            w * 1.35,
          ),
        ]);
      } else {
        // Classical Tuscan / Doric / Fluted order with square plinth + square abacus + revolved echinus/torus!
        const plinthH = baseH * 0.42;
        const abacusH = capH * 0.42;
        const yShaft0 = baseH;
        const yShaft1 = h - capH;
        const rTop = r * entasis;
        const parts: RawBufs[] = [
          buildBox(0, plinthH * 0.5, 0, r * 2.65, plinthH, r * 2.65),
          buildBox(0, h - abacusH * 0.5, 0, r * 2.5, abacusH, r * 2.5),
        ];

        if (style === 'fluted') {
          const flutes = clampInt(options.flutes, 8, 32, 16);
          const ptsPerFlute = 4;
          const totalN = flutes * ptsPerFlute;
          const fluteContour: Pt2[] = [];
          const rMid = (r + rTop) * 0.5;
          const groove = rMid * 0.075;
          for (let i = 0; i < totalN; i++) {
            const a = (i * TAU) / totalN;
            const sub = (i % ptsPerFlute) / ptsPerFlute;
            const dR = -groove * Math.sin(sub * Math.PI);
            fluteContour.push([
              (rMid + dR) * Math.cos(a),
              (rMid + dR) * Math.sin(a),
            ]);
          }
          parts.push(
            revolveClosedProfile(
              [
                [0, plinthH + 2e-4],
                [r * 1.22, plinthH + 2e-4],
                [r * 1.24, plinthH + (baseH - plinthH) * 0.5],
                [r * 1.06, baseH - 2e-4],
                [0, baseH - 2e-4],
              ],
              radialSegs,
            ),
            extrudeProfile(fluteContour, [], yShaft0, yShaft1, 'y'),
            revolveClosedProfile(
              [
                [0, yShaft1 + 2e-4],
                [rMid * 1.04, yShaft1 + 2e-4],
                [r * 1.22, h - abacusH - 2e-4],
                [0, h - abacusH - 2e-4],
              ],
              radialSegs,
            ),
          );
        } else if (style === 'tuscan') {
          // Roman Tuscan order: single bold torus base + unfluted entasis shaft + astragal necking ring + smooth echinus
          const shaftSpan = Math.max(0.04, yShaft1 - yShaft0);
          const revPts: Pt2[] = [
            [0, plinthH + 2e-4],
            [r * 1.24, plinthH + 2e-4],
            [r * 1.26, plinthH + (baseH - plinthH) * 0.5],
            [r * 1.06, plinthH + (baseH - plinthH) * 0.85],
            [r, yShaft0],
            [r * (0.68 + 0.32 * entasis), yShaft0 + shaftSpan * 0.38],
            [r * (0.32 + 0.68 * entasis), yShaft0 + shaftSpan * 0.72],
            [rTop, yShaft0 + shaftSpan * 0.92],
            [rTop * 1.09, yShaft0 + shaftSpan * 0.95],
            [rTop, yShaft1],
            [rTop * 1.05, yShaft1 + (capH - abacusH) * 0.25],
            [r * 1.2, h - abacusH - 2e-4],
            [0, h - abacusH - 2e-4],
          ];
          parts.push(revolveClosedProfile(revPts, radialSegs));
        } else {
          // Classical Doric order: Attic double-torus + scotia base + entasis shaft + crisp necking groove & steeper echinus
          const bSpan = Math.max(0.01, baseH - plinthH);
          const shaftSpan = Math.max(0.04, yShaft1 - yShaft0);
          const revPts: Pt2[] = [
            [0, plinthH + 2e-4],
            [r * 1.26, plinthH + 2e-4],
            [r * 1.28, plinthH + bSpan * 0.28],
            [r * 1.12, plinthH + bSpan * 0.52],
            [r * 1.18, plinthH + bSpan * 0.76],
            [r, yShaft0],
            [r * (0.65 + 0.35 * entasis), yShaft0 + shaftSpan * 0.35],
            [r * (0.3 + 0.7 * entasis), yShaft0 + shaftSpan * 0.7],
            [rTop * 0.96, yShaft0 + shaftSpan * 0.96],
            [rTop, yShaft1],
            [rTop * 1.08, yShaft1 + (capH - abacusH) * 0.22],
            [r * 1.24, h - abacusH - 2e-4],
            [0, h - abacusH - 2e-4],
          ];
          parts.push(revolveClosedProfile(revPts, radialSegs));
        }
        raw = mergeRaw(parts);
      }

      if (origin === 'center') xformRaw(raw, 0, -h * 0.5, 0);

      applyBuffers(this, raw, 'ColumnGeometry', {
        style,
        height: h,
        radius: r,
        entasis,
      });
    }
  }

  // --- 8. ArchwayGeometry ---
  class ArchwayGeometry extends BufferGeometry {
    constructor(options: ArchwayOptions = {}) {
      super();
      const profile = options.profile ?? 'semicircular';
      const span = clamp(num(options.span ?? options.innerWidth, 1.8), 0.4, 20);
      const innerH = clamp(
        num(options.height ?? options.innerHeight, 2.6),
        0.6,
        25,
      );
      const pierW = clamp(num(options.pierWidth, 0.45), 0.1, 5);
      const crownH = clamp(num(options.crownHeight, 0.45), 0.1, 5);
      const depth = clamp(
        num(options.depth ?? options.thickness, 0.4),
        0.08,
        10,
      );
      const hasKeystone = options.keystone !== false;
      const hasImpost = options.impost !== false;
      const origin = options.origin ?? 'floor';

      const hs = span * 0.5;
      const totalW = span + 2 * pierW;
      const totalH = innerH + crownH;
      const hW = totalW * 0.5;
      const hD = depth * 0.5;

      let archRise = Math.min(hs, innerH * 0.48);
      if (profile === 'segmental')
        archRise = Math.min(hs * 0.45, innerH * 0.35);
      if (profile === 'pointed') archRise = Math.min(hs * 1.35, innerH * 0.58);
      const springY = innerH - archRise;

      // Build CCW portal elevation contour in `(x, y)`:
      // left pier base -> inner left jamb -> arch intrados -> inner right jamb -> right pier base -> outer top!
      const outer: Pt2[] = [
        [-hW, 0],
        [-hs, 0],
        [-hs, springY],
      ];
      const segs = 16;
      if (profile === 'pointed') {
        // Two-centered pointed Gothic arch meeting cleanly at `(0, innerH)`
        const R = (hs * hs + archRise * archRise) / (2 * hs);
        const cxR = R - hs; // center on +X for left intrados
        const topAng = Math.asin(clamp(archRise / R, 0, 1));
        for (let i = 1; i <= segs / 2; i++) {
          const a = Math.PI - (topAng * i) / (segs / 2);
          outer.push([cxR + R * Math.cos(a), springY + R * Math.sin(a)]);
        }
        const cxL = -cxR; // center on -X for right intrados
        for (let i = 1; i < segs / 2; i++) {
          const a = topAng * (1 - i / (segs / 2));
          outer.push([cxL + R * Math.cos(a), springY + R * Math.sin(a)]);
        }
      } else if (profile === 'segmental') {
        const R = (hs * hs + archRise * archRise) / (2 * archRise);
        const yc = springY + archRise - R;
        const ha = Math.asin(clamp(hs / R, 0, 1));
        for (let i = 1; i < segs; i++) {
          const a = Math.PI * 0.5 + ha - (2 * ha * i) / segs;
          outer.push([R * Math.cos(a), yc + R * Math.sin(a)]);
        }
      } else {
        for (let i = 1; i < segs; i++) {
          const a = Math.PI - (Math.PI * i) / segs;
          outer.push([hs * Math.cos(a), springY + archRise * Math.sin(a)]);
        }
      }
      outer.push([hs, springY], [hs, 0], [hW, 0], [hW, totalH], [-hW, totalH]);

      const parts: RawBufs[] = [extrudeProfile(outer, [], -hD, hD, 'z')];

      if (hasImpost && springY > 0.25) {
        const impH = Math.min(0.1, springY * 0.12);
        const impProj = 0.035;
        parts.push(
          buildBox(
            -hs - pierW * 0.5,
            springY - impH * 0.5,
            0,
            pierW + impProj * 2,
            impH,
            depth + impProj * 2,
          ),
          buildBox(
            hs + pierW * 0.5,
            springY - impH * 0.5,
            0,
            pierW + impProj * 2,
            impH,
            depth + impProj * 2,
          ),
        );
      }
      if (hasKeystone) {
        const kwBot = span * 0.08;
        const kwTop = span * 0.13;
        const kh = Math.min(
          crownH * 0.85,
          Math.max(0.08, archRise * 0.75),
          span * 0.4,
        );
        const drop = Math.min(kh * 0.12, archRise * 0.18);
        const keyPts: Pt2[] = [
          [-kwBot * 0.5, innerH - drop],
          [kwBot * 0.5, innerH - drop],
          [kwTop * 0.5, innerH + kh - drop],
          [-kwTop * 0.5, innerH + kh - drop],
        ];
        parts.push(extrudeProfile(keyPts, [], -hD - 0.035, hD + 0.035, 'z'));
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -totalH * 0.5, 0);

      applyBuffers(this, merged, 'ArchwayGeometry', {
        profile,
        span,
        height: innerH,
        totalWidth: totalW,
        totalHeight: totalH,
        depth,
      });
    }
  }

  const Architecture = {
    MAX_ARCH_STEPS: MAX_STEPS,
    MAX_ARCH_OPENINGS: MAX_OPENINGS,
    MAX_ARCH_PICKETS: MAX_PICKETS,
    MAX_ARCH_SEGMENTS: MAX_SEGS,
    codeStairSpec,
    WallGeometry,
    SlabGeometry,
    StaircaseGeometry,
    RoofGeometry,
    DoorGeometry,
    WindowGeometry,
    RailingGeometry,
    ColumnGeometry,
    ArchwayGeometry,
  };

  for (const Ctor of [
    WallGeometry,
    SlabGeometry,
    StaircaseGeometry,
    RoofGeometry,
    DoorGeometry,
    WindowGeometry,
    RailingGeometry,
    ColumnGeometry,
    ArchwayGeometry,
  ]) {
    try {
      Object.freeze(Ctor.prototype);
      Object.freeze(Ctor);
    } catch {
      // Ignore if host environment disallows freezing.
    }
  }
  try {
    Object.freeze(Architecture);
  } catch {
    // Ignore if host environment disallows freezing.
  }

  if (reg?.authorNamespace?.Architecture?.WallGeometry) {
    return {Architecture: reg.authorNamespace.Architecture};
  }
  const exportsMap = {
    Architecture,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) reg.authorNamespace = {};
    Object.assign(reg.authorNamespace, exportsMap);
  } else {
    try {
      threeNs.Architecture = Architecture;
    } catch {
      // Frozen THREE proxy resolves via reg.authorNamespace.
    }
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` domain kit plugin registering parametric
 * architectural / AEC geometries (`THREE.Architecture.*`).
 */
export const architectureKitPlugin: ThreeLivePlugin = {
  name: 'kit-architecture',
  onRegister(): void {
    registerWorkerExtensionInstaller(installArchitectureKit);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installArchitectureKit(threeNs, reg);
    }
  },
};
