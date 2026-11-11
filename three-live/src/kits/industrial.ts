/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Industrial / Process / Warehouse Domain Kit
 * (`industrialKitPlugin` / `THREE.Industrial`).
 *
 * Self-contained watertight 2-manifold `BufferGeometry` generators for factory
 * digital twins, process piping, chemical plants, logistics warehouses, and OSHA
 * safety equipment:
 * - `nominalPipeSpec` (ANSI/ASME B36.10 / B16.5 DN & NPS pipe/flange lookup)
 * - `PipeRunGeometry` (3D waypoint-routed process pipe with bent elbows & weld-neck flanges)
 * - `PipeFittingGeometry` (`'elbow-90' | 'elbow-45' | 'tee' | 'cross' | 'reducer' | 'eccentric-reducer' | 'cap'`)
 * - `ValveGeometry` (`'gate-handwheel' | 'ball-lever' | 'butterfly' | 'pneumatic-control' | 'check'` with `openFraction`)
 * - `CentrifugalPumpGeometry` (ANSI end-suction volute pump + coupling guard + finned TEFC motor on steel skid)
 * - `PalletRackGeometry` (multi-bay, multi-level selective warehouse racking)
 * - `ConveyorGeometry` (`'roller' | 'belt'` horizontal or inclined conveyors with optional package side guides)
 * - `CatwalkPlatformGeometry` (elevated OSHA grating walkway/mezzanine with toeboards & guardrails)
 * - `IndustrialLadderGeometry` (OSHA fixed ladder with wall standoffs & safety hoop cage)
 * - `SafetyBarrierGeometry` (`'bollard' | 'guardrail-single' | 'guardrail-double' | 'handrail'`)
 * - `StorageTankGeometry` (`'vertical-dished' | 'horizontal-saddle' | 'cone-hopper' | 'flat-api650'` vessels)
 *
 * NOTE: `installIndustrialKit` is serialized via `Function.prototype.toString()`
 * into sandboxed Web Workers and embedded in `three-author-engine.js`. Keep its
 * body 100% self-contained (no module-scoped runtime closures or ES2022 class fields).
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/** Maximum 3D waypoints in a single `PipeRunGeometry`. */
export const MAX_IND_WAYPOINTS = 64;
/** Maximum radial/circumferential segments on pipes, rollers, and vessels. */
export const MAX_IND_SEGMENTS = 96;
/** Maximum bays or levels in racking/conveyors/ladders. */
export const MAX_IND_SPANS = 64;
/** Maximum rollers or rungs per industrial assembly. */
export const MAX_IND_RUNGS = 256;

/** Standard ANSI/ASME B36.10 / B16.5 Class 150 pipe & flange specification in meters. */
export interface NominalPipeSpec {
  readonly name: string;
  readonly dn: number;
  readonly outerDiameter: number;
  readonly wallThickness: number;
  readonly flangeDiameter: number;
  readonly flangeThickness: number;
  readonly boltCircleDiameter: number;
  readonly boltCount: number;
  readonly boltHoleDiameter: number;
  valueOf(): number;
}

/** Options for `THREE.Industrial.PipeRunGeometry`. */
export interface PipeRunOptions {
  size?: string;
  waypoints?: ReadonlyArray<readonly [number, number, number]>;
  outerDiameter?: number;
  radius?: number;
  bendRadius?: number;
  flangedEnds?: boolean;
  flangeDiameter?: number;
  flangeThickness?: number;
  radialSegments?: number;
  elbowSegments?: number;
}

/** Options for `THREE.Industrial.PipeFittingGeometry`. */
export interface PipeFittingOptions {
  kind?:
    | 'elbow-90'
    | 'elbow-45'
    | 'tee'
    | 'cross'
    | 'reducer'
    | 'eccentric-reducer'
    | 'cap';
  size?: string;
  secondarySize?: string;
  outerDiameter?: number;
  secondaryDiameter?: number;
  bendRadius?: number;
  legLength?: number;
  flanged?: boolean;
  radialSegments?: number;
}

/** Options for `THREE.Industrial.ValveGeometry`. */
export interface ValveOptions {
  kind?:
    | 'gate-handwheel'
    | 'ball-lever'
    | 'butterfly'
    | 'pneumatic-control'
    | 'check';
  size?: string;
  outerDiameter?: number;
  bodyLength?: number;
  openFraction?: number;
  radialSegments?: number;
}

/** Options for `THREE.Industrial.CentrifugalPumpGeometry`. */
export interface CentrifugalPumpOptions {
  suctionSize?: string;
  dischargeSize?: string;
  casingRadius?: number;
  motorPowerKw?: number;
  skidLength?: number;
  skidWidth?: number;
  radialSegments?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Industrial.PalletRackGeometry`. */
export interface PalletRackOptions {
  bays?: number;
  levels?: number;
  bayWidth?: number;
  depth?: number;
  height?: number;
  uprightWidth?: number;
  beamHeight?: number;
  deckBarsPerBay?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Industrial.ConveyorGeometry`. */
export interface ConveyorOptions {
  kind?: 'roller' | 'belt';
  length?: number;
  width?: number;
  height?: number;
  inclineDeg?: number;
  sideGuides?: boolean;
  guideHeight?: number;
  rollerRadius?: number;
  rollerPitch?: number;
  frameHeight?: number;
  legCount?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Industrial.CatwalkPlatformGeometry`. */
export interface CatwalkPlatformOptions {
  length?: number;
  width?: number;
  height?: number;
  guardrail?: 'both' | 'front' | 'none';
  railHeight?: number;
  gratingBars?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Industrial.IndustrialLadderGeometry`. */
export interface IndustrialLadderOptions {
  height?: number;
  width?: number;
  rungSpacing?: number;
  railRadius?: number;
  rungRadius?: number;
  standoffDepth?: number;
  includeCage?: boolean;
  cageStartHeight?: number;
  cageRadius?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Industrial.SafetyBarrierGeometry`. */
export interface SafetyBarrierOptions {
  kind?: 'bollard' | 'guardrail-single' | 'guardrail-double' | 'handrail';
  length?: number;
  height?: number;
  postRadius?: number;
  postSpacing?: number;
  baseplateSize?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Industrial.StorageTankGeometry`. */
export interface StorageTankOptions {
  kind?:
    | 'vertical-dished'
    | 'horizontal-saddle'
    | 'cone-hopper'
    | 'flat-api650';
  radius?: number;
  diameter?: number;
  shellHeight?: number;
  length?: number;
  legHeight?: number;
  legCount?: number;
  hopperHeight?: number;
  manway?: boolean;
  radialSegments?: number;
  origin?: 'floor' | 'center';
}

/**
 * Self-contained installer attaching `THREE.Industrial` onto a `THREE` namespace
 * and plugin registry.
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installIndustrialKit(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.BufferGeometry || !threeNs.BufferAttribute) {
    return null;
  }
  if (reg?.authorNamespace?.Industrial?.PipeRunGeometry) {
    return {Industrial: reg.authorNamespace.Industrial};
  }

  const BufferGeometry = threeNs.BufferGeometry;
  const BufferAttribute = threeNs.BufferAttribute;
  const Vector3 = threeNs.Vector3;

  const MAX_WP = 64;
  const MAX_SEGS = 96;
  const MAX_SPANS = 64;
  const MAX_RUNGS = 256;
  const TAU = Math.PI * 2;

  type Vec3 = [number, number, number];
  type Pt2 = [number, number];
  interface RawBufs {
    pos: number[];
    nrm: number[];
    uv: number[];
    idx: number[];
  }

  function num(v: unknown, fb: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }
  function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function clampInt(v: unknown, lo: number, hi: number, fb: number): number {
    const n = Number(v);
    if (!Number.isFinite(n)) return fb;
    return clamp(Math.round(n), lo, hi);
  }

  // ASME B36.10M / B16.5 Class 150 nominal pipe table:
  // [dn, odMm, wallMm, flangeOdMm, flangeThkMm, bcdMm, bolts, boltHoleMm]
  const PIPE_TABLE: Record<
    string,
    [number, number, number, number, number, number, number, number]
  > = {
    DN15: [15, 21.3, 2.77, 88.9, 11.2, 60.3, 4, 15.9],
    DN20: [20, 26.7, 2.87, 98.4, 12.7, 69.9, 4, 15.9],
    DN25: [25, 33.4, 3.38, 108.0, 14.2, 79.4, 4, 15.9],
    DN32: [32, 42.2, 3.56, 117.5, 15.7, 88.9, 4, 15.9],
    DN40: [40, 48.3, 3.68, 127.0, 17.5, 98.4, 4, 15.9],
    DN50: [50, 60.3, 3.91, 152.4, 19.1, 120.7, 4, 19.1],
    DN65: [65, 73.0, 5.16, 177.8, 22.4, 139.7, 4, 19.1],
    DN80: [80, 88.9, 5.49, 190.5, 23.9, 152.4, 4, 19.1],
    DN100: [100, 114.3, 6.02, 228.6, 23.9, 190.5, 8, 19.1],
    DN125: [125, 141.3, 6.55, 254.0, 23.9, 215.9, 8, 22.2],
    DN150: [150, 168.3, 7.11, 279.4, 25.4, 241.3, 8, 22.2],
    DN200: [200, 219.1, 8.18, 342.9, 28.4, 298.5, 8, 22.2],
    DN250: [250, 273.1, 9.27, 406.4, 30.2, 362.0, 12, 25.4],
    DN300: [300, 323.9, 9.53, 482.6, 31.8, 431.8, 12, 25.4],
  };
  const NPS_TO_DN: Record<string, string> = {
    '0.5': 'DN15',
    '1/2': 'DN15',
    '0.75': 'DN20',
    '3/4': 'DN20',
    '1': 'DN25',
    '1.25': 'DN32',
    '1.5': 'DN40',
    '2': 'DN50',
    '2.5': 'DN65',
    '3': 'DN80',
    '4': 'DN100',
    '5': 'DN125',
    '6': 'DN150',
    '8': 'DN200',
    '10': 'DN250',
    '12': 'DN300',
  };

  function nominalPipeSpec(spec = 'DN50', scale = 1): NominalPipeSpec {
    const s = clamp(num(scale, 1), 0.01, 100);
    const raw = String(spec ?? 'DN50')
      .trim()
      .toUpperCase();
    let key = 'DN50';
    if (PIPE_TABLE[raw]) {
      key = raw;
    } else {
      const npsMatch = raw.replace(/(IN|INCH|INCHES|"|\s)+$/g, '');
      if (NPS_TO_DN[npsMatch]) {
        key = NPS_TO_DN[npsMatch];
      } else {
        const dnNum = parseFloat(raw.replace(/^DN/, ''));
        if (Number.isFinite(dnNum)) {
          let best = 'DN50';
          let bestDiff = Infinity;
          for (const k of Object.keys(PIPE_TABLE)) {
            const diff = Math.abs(PIPE_TABLE[k][0] - dnNum);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = k;
            }
          }
          key = best;
        }
      }
    }
    const row = PIPE_TABLE[key];
    const k = 1e-3 * s;
    const res: NominalPipeSpec = {
      name: key,
      dn: row[0],
      outerDiameter: row[1] * k,
      wallThickness: row[2] * k,
      flangeDiameter: row[3] * k,
      flangeThickness: row[4] * k,
      boltCircleDiameter: row[5] * k,
      boltCount: row[6],
      boltHoleDiameter: row[7] * k,
      valueOf: () => row[1] * k,
    };
    Object.defineProperty(res, 'valueOf', {
      value: () => row[1] * k,
      enumerable: false,
    });
    return res;
  }

  function applyBuffers(
    // tslint:disable-next-line:no-any BufferGeometry instance target.
    geom: any,
    b: RawBufs,
    typeName: string,
    meta: Record<string, unknown>,
  ): void {
    const g = globalThis as Record<string, unknown>;
    const nativeF32 = g['__three_live_native_f32_array__'] as
      | ((src: number[]) => Float32Array)
      | undefined;
    const nativeIdx = g['__three_live_native_index_array__'] as
      | ((src: number[], useU32: boolean) => Uint16Array | Uint32Array)
      | undefined;

    const posArr = nativeF32 ? nativeF32(b.pos) : new Float32Array(b.pos);
    const nrmArr = nativeF32 ? nativeF32(b.nrm) : new Float32Array(b.nrm);
    const uvArr = nativeF32 ? nativeF32(b.uv) : new Float32Array(b.uv);
    const vCount = b.pos.length / 3;
    const useU32 = vCount > 65535;
    const idxArr = nativeIdx
      ? nativeIdx(b.idx, useU32)
      : useU32
        ? new Uint32Array(b.idx)
        : new Uint16Array(b.idx);

    geom.setAttribute('position', new BufferAttribute(posArr, 3));
    geom.setAttribute('normal', new BufferAttribute(nrmArr, 3));
    geom.setAttribute('uv', new BufferAttribute(uvArr, 2));
    geom.setIndex(new BufferAttribute(idxArr, 1));
    geom.type = typeName;
    geom.userData = {...(geom.userData || {}), kitPart: typeName, ...meta};

    if (Vector3) {
      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;
      const rawP = b.pos;
      for (let i = 0; i < rawP.length; i += 3) {
        const x = rawP[i];
        const y = rawP[i + 1];
        const z = rawP[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
      if (!Number.isFinite(minX)) {
        minX = minY = minZ = maxX = maxY = maxZ = 0;
      }
      geom.boundingBox = {
        min: new Vector3(minX, minY, minZ),
        max: new Vector3(maxX, maxY, maxZ),
      };
    } else if (typeof geom.computeBoundingBox === 'function') {
      geom.computeBoundingBox();
    }
  }

  function mergeRaw(parts: readonly RawBufs[]): RawBufs {
    let pLen = 0,
      uLen = 0,
      iLen = 0;
    for (const p of parts) {
      pLen += p.pos.length;
      uLen += p.uv.length;
      iLen += p.idx.length;
    }
    const pos = new Array<number>(pLen);
    const nrm = new Array<number>(pLen);
    const uv = new Array<number>(uLen);
    const idx = new Array<number>(iLen);
    let po = 0,
      uo = 0,
      io = 0,
      vBase = 0;
    for (const p of parts) {
      const pp = p.pos,
        pn = p.nrm,
        pu = p.uv,
        pi = p.idx;
      for (let i = 0; i < pp.length; i++) {
        pos[po + i] = pp[i];
        nrm[po + i] = pn[i];
      }
      po += pp.length;
      for (let i = 0; i < pu.length; i++) uv[uo + i] = pu[i];
      uo += pu.length;
      for (let i = 0; i < pi.length; i++) idx[io + i] = pi[i] + vBase;
      io += pi.length;
      vBase += pp.length / 3;
    }
    return {pos, nrm, uv, idx};
  }

  // Transform raw buffers by a 3x3 rotation matrix (default identity) + translation.
  function xformRaw(
    b: RawBufs,
    tx: number,
    ty: number,
    tz: number,
    m?: readonly [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  ): RawBufs {
    const p = b.pos;
    const n = b.nrm;
    if (!m) {
      for (let i = 0; i < p.length; i += 3) {
        p[i] += tx;
        p[i + 1] += ty;
        p[i + 2] += tz;
      }
      return b;
    }
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i],
        y = p[i + 1],
        z = p[i + 2];
      p[i] = m[0] * x + m[1] * y + m[2] * z + tx;
      p[i + 1] = m[3] * x + m[4] * y + m[5] * z + ty;
      p[i + 2] = m[6] * x + m[7] * y + m[8] * z + tz;
      const nx = n[i],
        ny = n[i + 1],
        nz = n[i + 2];
      n[i] = m[0] * nx + m[1] * ny + m[2] * nz;
      n[i + 1] = m[3] * nx + m[4] * ny + m[5] * nz;
      n[i + 2] = m[6] * nx + m[7] * ny + m[8] * nz;
    }
    return b;
  }

  // Build orthonormal 3x3 matrix mapping local +Y onto unit `dir = (dx, dy, dz)`.
  function basisFromY(
    dx: number,
    dy: number,
    dz: number,
  ): [number, number, number, number, number, number, number, number, number] {
    const l = Math.hypot(dx, dy, dz) || 1;
    const yx = dx / l,
      yy = dy / l,
      yz = dz / l;
    let rx = Math.abs(yy) < 0.9 ? 0 : 1;
    let ry = Math.abs(yy) < 0.9 ? 1 : 0;
    const rz = 0;
    // X = normalize(R x Y)
    let xx = ry * yz - rz * yy;
    let xy = rz * yx - rx * yz;
    let xz = rx * yy - ry * yx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl;
    xy /= xl;
    xz /= xl;
    // Z = X x Y
    const zx = xy * yz - xz * yy;
    const zy = xz * yx - xx * yz;
    const zz = xx * yy - xy * yx;
    rx = xx;
    ry = xy;
    return [rx, yx, zx, ry, yy, zy, xz, yz, zz];
  }

  function buildBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
  ): RawBufs {
    const hx = sx * 0.5,
      hy = sy * 0.5,
      hz = sz * 0.5;
    const x0 = cx - hx,
      x1 = cx + hx;
    const y0 = cy - hy,
      y1 = cy + hy;
    const z0 = cz - hz,
      z1 = cz + hz;
    const faces: Array<[Vec3, Vec3, Vec3, Vec3, Vec3, number, number]> = [
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], sx, sy],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], sx, sy],
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], sz, sy],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], sz, sy],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], sx, sz],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], sx, sz],
    ];
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let v = 0;
    for (const [a, b, c, d, n, uw, vh] of faces) {
      pos.push(...a, ...b, ...c, ...d);
      for (let k = 0; k < 4; k++) nrm.push(...n);
      uv.push(0, 0, uw, 0, uw, vh, 0, vh);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    return {pos, nrm, uv, idx};
  }

  function buildBoxStrut(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    wx: number,
    wz: number,
  ): RawBufs {
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 1e-6) return {pos: [], nrm: [], uv: [], idx: []};
    const raw = buildBox(0, 0, 0, wx, len, wz);
    return xformRaw(
      raw,
      (ax + bx) * 0.5,
      (ay + by) * 0.5,
      (az + bz) * 0.5,
      basisFromY(dx, dy, dz),
    );
  }

  // Revolve a closed 2D profile `(r >= 0, y)` around +Y (`[0, y0] -> outer -> [0, y1]` or closed loop).
  function revolveClosedProfile(pts: readonly Pt2[], radialSegs: number): RawBufs {
    const clean: Pt2[] = [];
    for (const p of pts) {
      const r = Math.max(0, p[0]);
      const y = p[1];
      const prev = clean[clean.length - 1];
      if (!prev || Math.hypot(r - prev[0], y - prev[1]) > 1e-8) {
        clean.push([r, y]);
      }
    }
    if (clean.length < 2) return {pos: [], nrm: [], uv: [], idx: []};
    const isLoop = clean[0][0] > 1e-8 || clean[clean.length - 1][0] > 1e-8;
    const segCount = isLoop ? clean.length : clean.length - 1;
    const segs = clamp(Math.round(radialSegs), 6, MAX_SEGS);

    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let vCur = 0;

    for (let s = 0; s < segCount; s++) {
      const pA = clean[s];
      const pB = clean[(s + 1) % clean.length];
      const rA = pA[0],
        yA = pA[1];
      const rB = pB[0],
        yB = pB[1];
      const dr = rB - rA;
      const dy = yB - yA;
      const len = Math.hypot(dr, dy);
      if (len <= 1e-9 || (rA <= 1e-8 && rB <= 1e-8)) continue;
      const nr = dy / len;
      const ny = -dr / len;
      const base = vCur;
      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const th = j === segs ? 0 : u * TAU;
        const ct = Math.cos(th);
        const st = Math.sin(th);
        pos.push(rA * ct, yA, -rA * st, rB * ct, yB, -rB * st);
        nrm.push(nr * ct, ny, -nr * st, nr * ct, ny, -nr * st);
        uv.push(u, 0, u, len);
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

  function buildCylBetween(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    radius: number,
    segs: number,
  ): RawBufs {
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 1e-6 || radius <= 1e-6) return {pos: [], nrm: [], uv: [], idx: []};
    const hL = len * 0.5;
    const raw = revolveClosedProfile(
      [
        [0, -hL],
        [radius, -hL],
        [radius, hL],
        [0, hL],
      ],
      segs,
    );
    return xformRaw(
      raw,
      (ax + bx) * 0.5,
      (ay + by) * 0.5,
      (az + bz) * 0.5,
      basisFromY(dx, dy, dz),
    );
  }

  function buildFlangeCollar(
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    flangeR: number,
    flangeThk: number,
    neckR: number,
    neckLen: number,
    segs: number,
  ): RawBufs {
    const hT = flangeThk * 0.5;
    const pts: Pt2[] =
      neckLen > 1e-5 && neckR < flangeR - 1e-4
        ? [
            [0, -hT],
            [flangeR, -hT],
            [flangeR, hT],
            [neckR, hT + neckLen],
            [0, hT + neckLen],
          ]
        : [
            [0, -hT],
            [flangeR, -hT],
            [flangeR, hT],
            [0, hT],
          ];
    return xformRaw(
      revolveClosedProfile(pts, segs),
      cx,
      cy,
      cz,
      basisFromY(dx, dy, dz),
    );
  }

  /**
   * Sweeps a circular cross-section along an open 3D `spine` using Bishop
   * parallel-transport frames and closes both ends with watertight flat caps
   * (`openHE === 0`, `dupHE === 0`, outward CCW winding).
   */
  function sweepTubeClosed(
    spine: readonly Vec3[],
    radius: number,
    radialSegs: number,
  ): RawBufs {
    const pts: Vec3[] = [];
    for (const p of spine) {
      const prev = pts[pts.length - 1];
      if (
        !prev ||
        Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) > 1e-6
      ) {
        pts.push([p[0], p[1], p[2]]);
      }
    }
    const m = pts.length;
    if (m < 2 || radius <= 1e-6) return {pos: [], nrm: [], uv: [], idx: []};

    const segs = clamp(Math.round(radialSegs), 6, MAX_SEGS);
    const tangents: Vec3[] = new Array(m);
    for (let i = 0; i < m; i++) {
      let tx: number, ty: number, tz: number;
      if (i === 0) {
        tx = pts[1][0] - pts[0][0];
        ty = pts[1][1] - pts[0][1];
        tz = pts[1][2] - pts[0][2];
      } else if (i === m - 1) {
        tx = pts[m - 1][0] - pts[m - 2][0];
        ty = pts[m - 1][1] - pts[m - 2][1];
        tz = pts[m - 1][2] - pts[m - 2][2];
      } else {
        let t0x = pts[i][0] - pts[i - 1][0];
        let t0y = pts[i][1] - pts[i - 1][1];
        let t0z = pts[i][2] - pts[i - 1][2];
        const l0 = Math.hypot(t0x, t0y, t0z) || 1;
        t0x /= l0;
        t0y /= l0;
        t0z /= l0;
        let t1x = pts[i + 1][0] - pts[i][0];
        let t1y = pts[i + 1][1] - pts[i][1];
        let t1z = pts[i + 1][2] - pts[i][2];
        const l1 = Math.hypot(t1x, t1y, t1z) || 1;
        t1x /= l1;
        t1y /= l1;
        t1z /= l1;
        tx = t0x + t1x;
        ty = t0y + t1y;
        tz = t0z + t1z;
        if (Math.hypot(tx, ty, tz) < 1e-5) {
          tx = t1x;
          ty = t1y;
          tz = t1z;
        }
      }
      const tl = Math.hypot(tx, ty, tz) || 1;
      tangents[i] = [tx / tl, ty / tl, tz / tl];
    }

    // Initial Bishop frame (N0, B0, T0) with N0 x B0 = T0
    const t0 = tangents[0];
    const ref: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let nx = ref[1] * t0[2] - ref[2] * t0[1];
    let ny = ref[2] * t0[0] - ref[0] * t0[2];
    let nz = ref[0] * t0[1] - ref[1] * t0[0];
    const nl0 = Math.hypot(nx, ny, nz) || 1;
    nx /= nl0;
    ny /= nl0;
    nz /= nl0;

    const normals: Vec3[] = new Array(m);
    const binormals: Vec3[] = new Array(m);
    normals[0] = [nx, ny, nz];
    binormals[0] = [
      t0[1] * nz - t0[2] * ny,
      t0[2] * nx - t0[0] * nz,
      t0[0] * ny - t0[1] * nx,
    ];

    for (let i = 1; i < m; i++) {
      const tp = tangents[i - 1];
      const tc = tangents[i];
      // Rotate N_{i-1} by minimal rotation mapping T_{i-1} -> T_i
      let ax = tp[1] * tc[2] - tp[2] * tc[1];
      let ay = tp[2] * tc[0] - tp[0] * tc[2];
      let az = tp[0] * tc[1] - tp[1] * tc[0];
      const sinA = Math.hypot(ax, ay, az);
      const cosA = clamp(tp[0] * tc[0] + tp[1] * tc[1] + tp[2] * tc[2], -1, 1);
      let cnx = normals[i - 1][0];
      let cny = normals[i - 1][1];
      let cnz = normals[i - 1][2];
      if (sinA > 1e-7) {
        ax /= sinA;
        ay /= sinA;
        az /= sinA;
        const ang = Math.atan2(sinA, cosA);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const dot = ax * cnx + ay * cny + az * cnz;
        const crx = ay * cnz - az * cny;
        const cry = az * cnx - ax * cnz;
        const crz = ax * cny - ay * cnx;
        cnx = cnx * ca + crx * sa + ax * dot * (1 - ca);
        cny = cny * ca + cry * sa + ay * dot * (1 - ca);
        cnz = cnz * ca + crz * sa + az * dot * (1 - ca);
      }
      // Gram-Schmidt orthogonalize against tc
      const d = cnx * tc[0] + cny * tc[1] + cnz * tc[2];
      cnx -= d * tc[0];
      cny -= d * tc[1];
      cnz -= d * tc[2];
      const cl = Math.hypot(cnx, cny, cnz) || 1;
      cnx /= cl;
      cny /= cl;
      cnz /= cl;
      normals[i] = [cnx, cny, cnz];
      binormals[i] = [
        tc[1] * cnz - tc[2] * cny,
        tc[2] * cnx - tc[0] * cnz,
        tc[0] * cny - tc[1] * cnx,
      ];
    }

    const cosTab = new Float64Array(segs);
    const sinTab = new Float64Array(segs);
    for (let j = 0; j < segs; j++) {
      const a = (j * TAU) / segs;
      cosTab[j] = Math.cos(a);
      sinTab[j] = Math.sin(a);
    }

    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let arcLen = 0;

    for (let i = 0; i < m; i++) {
      if (i > 0) {
        arcLen += Math.hypot(
          pts[i][0] - pts[i - 1][0],
          pts[i][1] - pts[i - 1][1],
          pts[i][2] - pts[i - 1][2],
        );
      }
      const c = pts[i];
      const N = normals[i];
      const B = binormals[i];
      for (let j = 0; j < segs; j++) {
        const ct = cosTab[j];
        const st = sinTab[j];
        const rx = ct * N[0] + st * B[0];
        const ry = ct * N[1] + st * B[1];
        const rz = ct * N[2] + st * B[2];
        pos.push(c[0] + radius * rx, c[1] + radius * ry, c[2] + radius * rz);
        nrm.push(rx, ry, rz);
        uv.push(j / segs, arcLen);
      }
    }

    for (let i = 0; i < m - 1; i++) {
      const r0 = i * segs;
      const r1 = (i + 1) * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        const a0 = r0 + j;
        const a1 = r0 + j1;
        const b0 = r1 + j;
        const b1 = r1 + j1;
        idx.push(a0, a1, b1, a0, b1, b0);
      }
    }

    // Start cap (`i = 0`, outward `-T_0`) using exact ring(0, j) coordinates for watertight pairing
    let vOff = m * segs;
    const ts = tangents[0];
    pos.push(pts[0][0], pts[0][1], pts[0][2]);
    nrm.push(-ts[0], -ts[1], -ts[2]);
    uv.push(0.5, 0.5);
    const cStart = vOff++;
    const sRing = vOff;
    for (let j = 0; j < segs; j++) {
      pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
      nrm.push(-ts[0], -ts[1], -ts[2]);
      uv.push(0.5 + 0.5 * cosTab[j], 0.5 + 0.5 * sinTab[j]);
    }
    vOff += segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(cStart, sRing + j1, sRing + j);
    }

    // End cap (`i = m - 1`, outward `+T_{m-1}`) using exact ring(m - 1, j) coordinates
    const te = tangents[m - 1];
    pos.push(pts[m - 1][0], pts[m - 1][1], pts[m - 1][2]);
    nrm.push(te[0], te[1], te[2]);
    uv.push(0.5, 0.5);
    const cEnd = vOff++;
    const eRing = vOff;
    const lastBase = (m - 1) * segs;
    for (let j = 0; j < segs; j++) {
      const k = (lastBase + j) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
      nrm.push(te[0], te[1], te[2]);
      uv.push(0.5 + 0.5 * cosTab[j], 0.5 + 0.5 * sinTab[j]);
    }
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(cEnd, eRing + j, eRing + j1);
    }

    return {pos, nrm, uv, idx};
  }

  // Round sharp corners of a 3D waypoint list with circular elbow arcs of `bendRadius`.
  function filletWaypoints(
    rawWps: readonly Vec3[],
    bendR: number,
    elbowSegs: number,
  ): Vec3[] {
    const wps: Vec3[] = [];
    for (const p of rawWps) {
      const x = num(p?.[0], 0);
      const y = num(p?.[1], 0);
      const z = num(p?.[2], 0);
      const prev = wps[wps.length - 1];
      if (!prev || Math.hypot(x - prev[0], y - prev[1], z - prev[2]) > 1e-4) {
        wps.push([x, y, z]);
      }
      if (wps.length >= MAX_WP) break;
    }
    if (wps.length < 2) {
      return [
        [0, 0, 0],
        [1, 0, 0],
      ];
    }
    if (wps.length === 2 || bendR <= 1e-5) return wps;

    const spine: Vec3[] = [wps[0]];
    for (let i = 1; i < wps.length - 1; i++) {
      const pPrev = wps[i - 1];
      const pCur = wps[i];
      const pNext = wps[i + 1];
      let u1x = pPrev[0] - pCur[0],
        u1y = pPrev[1] - pCur[1],
        u1z = pPrev[2] - pCur[2];
      let u2x = pNext[0] - pCur[0],
        u2y = pNext[1] - pCur[1],
        u2z = pNext[2] - pCur[2];
      const len1 = Math.hypot(u1x, u1y, u1z);
      const len2 = Math.hypot(u2x, u2y, u2z);
      if (len1 <= 1e-4 || len2 <= 1e-4) continue;
      u1x /= len1;
      u1y /= len1;
      u1z /= len1;
      u2x /= len2;
      u2y /= len2;
      u2z /= len2;
      const cosAng = clamp(u1x * u2x + u1y * u2y + u1z * u2z, -1, 1);
      const ang = Math.acos(cosAng);
      // Nearly collinear (ang ~ pi) or sharp hairpin (ang ~ 0)
      if (ang > Math.PI - 1e-2 || ang < 1e-2) {
        spine.push(pCur);
        continue;
      }
      const halfA = ang * 0.5;
      const tanHalf = Math.tan(halfA);
      const maxTrim = Math.min(len1, len2) * 0.45;
      const trim = Math.min(bendR / tanHalf, maxTrim);
      const rEff = trim * tanHalf;
      if (rEff <= 1e-5) {
        spine.push(pCur);
        continue;
      }
      // Bisector toward arc center
      let bx = u1x + u2x,
        by = u1y + u2y,
        bz = u1z + u2z;
      const bl = Math.hypot(bx, by, bz) || 1;
      bx /= bl;
      by /= bl;
      bz /= bl;
      const cDist = rEff / Math.sin(halfA);
      const cx = pCur[0] + bx * cDist;
      const cy = pCur[1] + by * cDist;
      const cz = pCur[2] + bz * cDist;

      const tStart: Vec3 = [
        pCur[0] + u1x * trim,
        pCur[1] + u1y * trim,
        pCur[2] + u1z * trim,
      ];
      const tEnd: Vec3 = [
        pCur[0] + u2x * trim,
        pCur[1] + u2y * trim,
        pCur[2] + u2z * trim,
      ];
      const v0x = (tStart[0] - cx) / rEff,
        v0y = (tStart[1] - cy) / rEff,
        v0z = (tStart[2] - cz) / rEff;
      const v1x = (tEnd[0] - cx) / rEff,
        v1y = (tEnd[1] - cy) / rEff,
        v1z = (tEnd[2] - cz) / rEff;
      const sweep = Math.acos(clamp(v0x * v1x + v0y * v1y + v0z * v1z, -1, 1));
      const sinSw = Math.sin(sweep);
      const steps = clamp(Math.round(elbowSegs), 3, 24);
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const w0 = sinSw > 1e-6 ? Math.sin((1 - f) * sweep) / sinSw : 1 - f;
        const w1 = sinSw > 1e-6 ? Math.sin(f * sweep) / sinSw : f;
        spine.push([
          cx + rEff * (w0 * v0x + w1 * v1x),
          cy + rEff * (w0 * v0y + w1 * v1y),
          cz + rEff * (w0 * v0z + w1 * v1z),
        ]);
      }
    }
    spine.push(wps[wps.length - 1]);
    return spine;
  }

  // --- 1. PipeRunGeometry ---
  class PipeRunGeometry extends BufferGeometry {
    constructor(options: PipeRunOptions = {}) {
      super();
      const spec = nominalPipeSpec(options.size ?? 'DN80');
      const od = clamp(
        num(
          options.outerDiameter ??
            (options.radius !== undefined ? num(options.radius, 0.04) * 2 : undefined),
          spec.outerDiameter,
        ),
        0.008,
        4.0,
      );
      const rPipe = od * 0.5;
      const scaleRatio = od / spec.outerDiameter;
      const bendR = clamp(num(options.bendRadius, od * 1.5), od * 0.6, 20);
      const segs = clampInt(options.radialSegments, 8, MAX_SEGS, 20);
      const elbowSegs = clampInt(options.elbowSegments, 3, 24, 8);
      const flanged = options.flangedEnds !== false;

      const defaultWps: Vec3[] = [
        [0, 0, 0],
        [1.2, 0, 0],
        [1.2, 0.9, 0],
      ];
      const rawWps =
        Array.isArray(options.waypoints) && options.waypoints.length >= 2
          ? (options.waypoints as readonly Vec3[])
          : defaultWps;
      const spine = filletWaypoints(rawWps, bendR, elbowSegs);

      const parts: RawBufs[] = [sweepTubeClosed(spine, rPipe, segs)];
      if (flanged && spine.length >= 2) {
        const fR = Math.max(
          rPipe * 1.35,
          clamp(num(options.flangeDiameter, spec.flangeDiameter * scaleRatio), od * 1.2, 6) * 0.5,
        );
        const fT = clamp(
          num(options.flangeThickness, spec.flangeThickness * scaleRatio),
          0.004,
          0.5,
        );
        const p0 = spine[0];
        const p1 = spine[1];
        const d0x = p1[0] - p0[0],
          d0y = p1[1] - p0[1],
          d0z = p1[2] - p0[2];
        const l0 = Math.hypot(d0x, d0y, d0z) || 1;
        // Inset slightly behind pipe end face (`1e-4` offset along axis) so flange & pipe never share coplanar caps
        parts.push(
          buildFlangeCollar(
            p0[0] + (d0x / l0) * (fT * 0.5 + 2e-4),
            p0[1] + (d0y / l0) * (fT * 0.5 + 2e-4),
            p0[2] + (d0z / l0) * (fT * 0.5 + 2e-4),
            d0x,
            d0y,
            d0z,
            fR,
            fT,
            rPipe * 1.15,
            fT * 0.6,
            segs,
          ),
        );
        const pm = spine[spine.length - 1];
        const pn = spine[spine.length - 2];
        const d1x = pn[0] - pm[0],
          d1y = pn[1] - pm[1],
          d1z = pn[2] - pm[2];
        const l1 = Math.hypot(d1x, d1y, d1z) || 1;
        parts.push(
          buildFlangeCollar(
            pm[0] + (d1x / l1) * (fT * 0.5 + 2e-4),
            pm[1] + (d1y / l1) * (fT * 0.5 + 2e-4),
            pm[2] + (d1z / l1) * (fT * 0.5 + 2e-4),
            d1x,
            d1y,
            d1z,
            fR,
            fT,
            rPipe * 1.15,
            fT * 0.6,
            segs,
          ),
        );
      }

      applyBuffers(this, mergeRaw(parts), 'PipeRunGeometry', {
        size: spec.name,
        outerDiameter: od,
        bendRadius: bendR,
        waypointCount: rawWps.length,
      });
    }
  }

  // --- 2. PipeFittingGeometry ---
  class PipeFittingGeometry extends BufferGeometry {
    constructor(options: PipeFittingOptions = {}) {
      super();
      const kind = options.kind ?? 'elbow-90';
      const spec = nominalPipeSpec(options.size ?? 'DN80');
      const od = clamp(num(options.outerDiameter, spec.outerDiameter), 0.01, 4.0);
      const rPipe = od * 0.5;
      const scaleRatio = od / spec.outerDiameter;
      const fR = Math.max(rPipe * 1.35, spec.flangeDiameter * scaleRatio * 0.5);
      const fT = Math.max(0.006, spec.flangeThickness * scaleRatio);
      const flanged = options.flanged !== false;
      const segs = clampInt(options.radialSegments, 8, MAX_SEGS, 24);
      const leg = clamp(num(options.legLength, od * 1.6), od * 0.9, 6);

      const parts: RawBufs[] = [];
      if (kind === 'elbow-90' || kind === 'elbow-45') {
        const bendR = clamp(num(options.bendRadius, od * 1.5), od * 0.7, 10);
        const sweep = kind === 'elbow-45' ? Math.PI * 0.25 : Math.PI * 0.5;
        const stub = fT * 1.8;
        const spine: Vec3[] = [[-bendR, -stub, 0]];
        const arcSteps = 12;
        for (let i = 0; i <= arcSteps; i++) {
          const a = (sweep * i) / arcSteps;
          spine.push([-bendR * Math.cos(a), bendR * Math.sin(a), 0]);
        }
        const tx = Math.sin(sweep);
        const ty = Math.cos(sweep);
        const last = spine[spine.length - 1];
        spine.push([last[0] + tx * stub, last[1] + ty * stub, 0]);
        parts.push(sweepTubeClosed(spine, rPipe, segs));
        if (flanged) {
          parts.push(
            buildFlangeCollar(
              -bendR,
              -stub + fT * 0.5 + 2e-4,
              0,
              0,
              1,
              0,
              fR,
              fT,
              rPipe * 1.14,
              fT * 0.5,
              segs,
            ),
            buildFlangeCollar(
              last[0] + tx * (stub - fT * 0.5 - 2e-4),
              last[1] + ty * (stub - fT * 0.5 - 2e-4),
              0,
              -tx,
              -ty,
              0,
              fR,
              fT,
              rPipe * 1.14,
              fT * 0.5,
              segs,
            ),
          );
        }
      } else if (kind === 'tee' || kind === 'cross') {
        const secSpec = options.secondarySize
          ? nominalPipeSpec(options.secondarySize)
          : spec;
        const rBranch = clamp(
          num(options.secondaryDiameter, secSpec.outerDiameter) * 0.5,
          rPipe * 0.35,
          rPipe,
        );
        // Main run along X (`[-leg, +leg]`)
        parts.push(buildCylBetween(-leg, 0, 0, leg, 0, 0, rPipe, segs));
        // Forged central body collar (`rPipe * 1.08`)
        parts.push(
          buildCylBetween(-rBranch * 1.25, 0, 0, rBranch * 1.25, 0, 0, rPipe * 1.08, segs),
        );
        // Branch(es) along +Y (or continuous -Y..+Y for cross)
        if (kind === 'cross') {
          parts.push(buildCylBetween(0, -leg, 0, 0, leg, 0, rBranch, segs));
        } else {
          parts.push(buildCylBetween(0, 0, 0, 0, leg, 0, rBranch, segs));
        }
        if (flanged) {
          const fRb = Math.max(rBranch * 1.35, fR * (rBranch / rPipe));
          parts.push(
            buildFlangeCollar(-leg + fT * 0.5 + 2e-4, 0, 0, 1, 0, 0, fR, fT, rPipe * 1.14, fT * 0.5, segs),
            buildFlangeCollar(leg - fT * 0.5 - 2e-4, 0, 0, -1, 0, 0, fR, fT, rPipe * 1.14, fT * 0.5, segs),
            buildFlangeCollar(0, leg - fT * 0.5 - 2e-4, 0, 0, -1, 0, fRb, fT, rBranch * 1.14, fT * 0.5, segs),
          );
          if (kind === 'cross') {
            parts.push(
              buildFlangeCollar(0, -leg + fT * 0.5 + 2e-4, 0, 0, 1, 0, fRb, fT, rBranch * 1.14, fT * 0.5, segs),
            );
          }
        }
      } else if (kind === 'cap') {
        // Flanged or butt-weld ellipsoidal blind end cap along +Y
        const stubH = Math.max(fT * 1.8, od * 0.45);
        const capH = rPipe * 0.52;
        const pts: Pt2[] = flanged
          ? [
              [0, -stubH],
              [fR, -stubH],
              [fR, -stubH + fT],
              [rPipe, -stubH + fT],
              [rPipe, 0],
            ]
          : [
              [0, -stubH * 0.5],
              [rPipe, -stubH * 0.5],
              [rPipe, 0],
            ];
        for (let i = 1; i <= 7; i++) {
          const a = (Math.PI * 0.5 * i) / 7;
          pts.push([rPipe * Math.cos(a), capH * Math.sin(a)]);
        }
        pts.push([0, capH]);
        parts.push(revolveClosedProfile(pts, segs));
      } else if (kind === 'eccentric-reducer') {
        // Flat-on-bottom (FOB) pump-suction eccentric reducer: -X side stays tangent!
        const secSpec = options.secondarySize
          ? nominalPipeSpec(options.secondarySize)
          : nominalPipeSpec('DN50');
        const r2 = clamp(
          num(options.secondaryDiameter, secSpec.outerDiameter * scaleRatio) * 0.5,
          rPipe * 0.3,
          rPipe * 1.8,
        );
        const rSmall = Math.abs(r2 - rPipe) < 1e-4 ? rPipe * 0.65 : r2;
        const hL = leg * 0.75;
        const fR2 = Math.max(rSmall * 1.35, fR * (rSmall / rPipe));
        const dx = rPipe - rSmall;
        // Axial stations [cx, y, r]
        const stations: Array<[number, number, number]> = flanged
          ? [
              [0, -hL, fR],
              [0, -hL + fT, fR],
              [0, -hL + fT, rPipe],
              [0, -hL * 0.35, rPipe],
              [dx, hL * 0.35, rSmall],
              [dx, hL - fT, rSmall],
              [dx, hL - fT, fR2],
              [dx, hL, fR2],
            ]
          : [
              [0, -hL, rPipe],
              [0, -hL * 0.35, rPipe],
              [dx, hL * 0.35, rSmall],
              [dx, hL, rSmall],
            ];

        const pos: number[] = [];
        const nrm: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        let vOff = 0;

        const ringPt = (st: [number, number, number], j: number): Vec3 => {
          const a = (j * TAU) / segs;
          return [st[0] + st[2] * Math.cos(a), st[1], -st[2] * Math.sin(a)];
        };

        // Bottom cap (-Y)
        const s0 = stations[0];
        pos.push(s0[0], s0[1], 0);
        nrm.push(0, -1, 0);
        uv.push(0.5, 0.5);
        const cBot = vOff++;
        for (let j = 0; j < segs; j++) {
          const p = ringPt(s0, j);
          pos.push(p[0], p[1], p[2]);
          nrm.push(0, -1, 0);
          uv.push(0.5 + 0.5 * Math.cos((j * TAU) / segs), 0.5 + 0.5 * Math.sin((j * TAU) / segs));
        }
        for (let j = 0; j < segs; j++) {
          idx.push(cBot, vOff + ((j + 1) % segs), vOff + j);
        }
        vOff += segs;

        // Lofted strips between stations
        for (let i = 0; i < stations.length - 1; i++) {
          const stA = stations[i];
          const stB = stations[i + 1];
          for (let j = 0; j < segs; j++) {
            const j1 = (j + 1) % segs;
            const p0 = ringPt(stA, j);
            const p1 = ringPt(stA, j1);
            const p2 = ringPt(stB, j);
            const p3 = ringPt(stB, j1);
            const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
            const d3x = p3[0] - p0[0], d3y = p3[1] - p0[1], d3z = p3[2] - p0[2];
            const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
            const nx =
              (e1y * d3z - e1z * d3y) + (d3y * e2z - d3z * e2y);
            const ny =
              (e1z * d3x - e1x * d3z) + (d3z * e2x - d3x * e2z);
            const nz =
              (e1x * d3y - e1y * d3x) + (d3x * e2y - d3y * e2x);
            const nl = Math.hypot(nx, ny, nz) || 1;
            const ux = nx / nl, uy = ny / nl, uz = nz / nl;
            const b = vOff;
            pos.push(...p0, ...p1, ...p2, ...p3);
            nrm.push(ux, uy, uz, ux, uy, uz, ux, uy, uz, ux, uy, uz);
            uv.push(j / segs, 0, (j + 1) / segs, 0, j / segs, 1, (j + 1) / segs, 1);
            idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
            vOff += 4;
          }
        }

        // Top cap (+Y)
        const sK = stations[stations.length - 1];
        pos.push(sK[0], sK[1], 0);
        nrm.push(0, 1, 0);
        uv.push(0.5, 0.5);
        const cTop = vOff++;
        for (let j = 0; j < segs; j++) {
          const p = ringPt(sK, j);
          pos.push(p[0], p[1], p[2]);
          nrm.push(0, 1, 0);
          uv.push(0.5 + 0.5 * Math.cos((j * TAU) / segs), 0.5 + 0.5 * Math.sin((j * TAU) / segs));
        }
        for (let j = 0; j < segs; j++) {
          idx.push(cTop, vOff + j, vOff + ((j + 1) % segs));
        }
        parts.push({pos, nrm, uv, idx});
      } else {
        // Concentric reducer along Y (`[-hL, +hL]`)
        const secSpec = options.secondarySize
          ? nominalPipeSpec(options.secondarySize)
          : nominalPipeSpec('DN50');
        const r2 = clamp(
          num(options.secondaryDiameter, secSpec.outerDiameter * scaleRatio) * 0.5,
          rPipe * 0.3,
          rPipe * 1.8,
        );
        const rSmall = Math.abs(r2 - rPipe) < 1e-4 ? rPipe * 0.65 : r2;
        const hL = leg * 0.75;
        const fR2 = Math.max(rSmall * 1.35, fR * (rSmall / rPipe));
        const pts: Pt2[] = flanged
          ? [
              [0, -hL],
              [fR, -hL],
              [fR, -hL + fT],
              [rPipe, -hL + fT],
              [rPipe, -hL * 0.35],
              [rSmall, hL * 0.35],
              [rSmall, hL - fT],
              [fR2, hL - fT],
              [fR2, hL],
              [0, hL],
            ]
          : [
              [0, -hL],
              [rPipe, -hL],
              [rPipe, -hL * 0.35],
              [rSmall, hL * 0.35],
              [rSmall, hL],
              [0, hL],
            ];
        parts.push(revolveClosedProfile(pts, segs));
      }

      applyBuffers(this, mergeRaw(parts), 'PipeFittingGeometry', {
        kind,
        size: spec.name,
        outerDiameter: od,
      });
    }
  }

  // --- 3. ValveGeometry ---
  class ValveGeometry extends BufferGeometry {
    constructor(options: ValveOptions = {}) {
      super();
      const kind = options.kind ?? 'gate-handwheel';
      const spec = nominalPipeSpec(options.size ?? 'DN80');
      const od = clamp(num(options.outerDiameter, spec.outerDiameter), 0.015, 3.0);
      const rPipe = od * 0.5;
      const scaleRatio = od / spec.outerDiameter;
      const fR = Math.max(rPipe * 1.38, spec.flangeDiameter * scaleRatio * 0.5);
      const fT = Math.max(0.008, spec.flangeThickness * scaleRatio);
      const openFrac = clamp(num(options.openFraction, 0.5), 0, 1);
      const segs = clampInt(options.radialSegments, 8, MAX_SEGS, 24);
      const defaultLen = kind === 'butterfly' ? od * 0.9 : od * 2.4;
      const bodyLen = clamp(num(options.bodyLength, defaultLen), fT * 2.4, 6);
      const hL = bodyLen * 0.5;

      const parts: RawBufs[] = [];
      if (kind === 'butterfly') {
        // Wafer/lug butterfly body along X + internal rotatable disc + top stem + quarter-turn lever
        const bodyProf: Pt2[] = [
          [0, -hL],
          [fR * 0.92, -hL],
          [fR * 0.92, hL],
          [0, hL],
        ];
        parts.push(xformRaw(revolveClosedProfile(bodyProf, segs), 0, 0, 0, basisFromY(1, 0, 0)));
        const stemH = fR * 1.45;
        const stemR = rPipe * 0.18;
        parts.push(buildCylBetween(0, fR * 0.8, 0, 0, stemH, 0, stemR, 14));
        const ang = openFrac * Math.PI * 0.5;
        const leverLen = fR * 1.7;
        parts.push(
          buildBoxStrut(
            0,
            stemH + stemR * 0.6,
            0,
            Math.cos(ang) * leverLen,
            stemH + stemR * 0.6,
            Math.sin(ang) * leverLen,
            stemR * 1.6,
            stemR * 0.9,
          ),
        );
      } else {
        // Flanged inline valve body along X
        const bodyR = kind === 'ball-lever' ? rPipe * 1.32 : rPipe * 1.18;
        const bodyProf: Pt2[] = [
          [0, -hL],
          [fR, -hL],
          [fR, -hL + fT],
          [rPipe, -hL + fT],
          [bodyR, -hL * 0.42],
          [bodyR, hL * 0.42],
          [rPipe, hL - fT],
          [fR, hL - fT],
          [fR, hL],
          [0, hL],
        ];
        parts.push(xformRaw(revolveClosedProfile(bodyProf, segs), 0, 0, 0, basisFromY(1, 0, 0)));

        if (kind === 'ball-lever') {
          const stemY0 = bodyR * 0.85;
          const stemY1 = bodyR + od * 0.65;
          const stemR = rPipe * 0.2;
          parts.push(buildCylBetween(0, stemY0, 0, 0, stemY1, 0, stemR, 14));
          const ang = openFrac * Math.PI * 0.5;
          const leverLen = od * 1.9;
          const gripY = stemY1 + od * 0.16;
          parts.push(
            buildBoxStrut(
              0,
              stemY1,
              0,
              Math.cos(ang) * od * 0.35,
              gripY,
              Math.sin(ang) * od * 0.35,
              stemR * 1.5,
              stemR * 0.9,
            ),
            buildBoxStrut(
              Math.cos(ang) * od * 0.32,
              gripY,
              Math.sin(ang) * od * 0.32,
              Math.cos(ang) * leverLen,
              gripY,
              Math.sin(ang) * leverLen,
              stemR * 1.7,
              stemR * 0.85,
            ),
          );
        } else if (kind === 'check') {
          // Bolted-bonnet swing check valve with top inspection cover + upstream hinge pin boss
          const covY = bodyR + od * 0.58;
          parts.push(
            revolveClosedProfile(
              [
                [0, bodyR * 0.55],
                [rPipe * 1.05, bodyR * 0.55],
                [rPipe * 1.05, covY - fT * 0.9],
                [rPipe * 1.38, covY - fT * 0.9],
                [rPipe * 1.38, covY],
                [rPipe * 0.35, covY + fT * 0.45],
                [0, covY + fT * 0.45],
              ],
              segs,
            ),
            // Transverse swing-clapper hinge pin boss on upstream side
            buildCylBetween(
              -hL * 0.36,
              bodyR * 0.85,
              -rPipe * 1.18,
              -hL * 0.36,
              bodyR * 0.85,
              rPipe * 1.18,
              rPipe * 0.26,
              14,
            ),
          );
        } else if (kind === 'pneumatic-control') {
          // Globe valve bonnet + twin actuator yoke + spring barrel + wide diaphragm dome!
          const bonTop = bodyR + od * 0.72;
          const yokeTop = bonTop + od * 1.35;
          const domeR = od * 1.45;
          const domeTop = yokeTop + od * 0.85;
          parts.push(
            revolveClosedProfile(
              [
                [0, bodyR * 0.55],
                [rPipe * 0.95, bodyR * 0.55],
                [rPipe * 1.15, bodyR + od * 0.22],
                [rPipe * 0.55, bonTop],
                [0, bonTop],
              ],
              segs,
            ),
            // Actuator yoke legs on ±Z + top mounting plate
            buildBox(0, (bonTop + yokeTop) * 0.5, rPipe * 0.55, rPipe * 0.35, yokeTop - bonTop - 4e-4, rPipe * 0.28),
            buildBox(0, (bonTop + yokeTop) * 0.5, -rPipe * 0.55, rPipe * 0.35, yokeTop - bonTop - 4e-4, rPipe * 0.28),
            // Spring-diaphragm pneumatic dome casing
            revolveClosedProfile(
              [
                [0, yokeTop],
                [rPipe * 0.72, yokeTop],
                [rPipe * 0.72, yokeTop + od * 0.28],
                [domeR * 0.92, yokeTop + od * 0.44],
                [domeR, yokeTop + od * 0.48],
                [domeR, yokeTop + od * 0.58],
                [domeR * 0.88, yokeTop + od * 0.64],
                [domeR * 0.45, domeTop],
                [0, domeTop],
              ],
              segs,
            ),
            // Rising valve stem + travel indicator disk modulated by openFraction
            buildCylBetween(0, bonTop + 2e-4, 0, 0, yokeTop - 2e-4, 0, rPipe * 0.14, 12),
            buildCylBetween(
              0,
              bonTop + od * (0.25 + openFrac * 0.75),
              0,
              0,
              bonTop + od * (0.25 + openFrac * 0.75) + 0.012,
              0,
              rPipe * 0.32,
              14,
            ),
          );
        } else {
          // Rising-stem OS&Y gate valve with bolted bonnet + spoked handwheel
          const bonY = bodyR + od * 1.15;
          const bonProf: Pt2[] = [
            [0, bodyR * 0.6],
            [rPipe * 0.85, bodyR * 0.6],
            [rPipe * 1.05, bodyR + od * 0.18],
            [rPipe * 1.05, bodyR + od * 0.32],
            [rPipe * 0.52, bodyR + od * 0.45],
            [rPipe * 0.38, bonY],
            [0, bonY],
          ];
          parts.push(revolveClosedProfile(bonProf, segs));
          const stemTop = bonY + od * (0.35 + openFrac * 0.45);
          const wheelY = bonY + od * 0.22;
          const stemR = rPipe * 0.16;
          parts.push(buildCylBetween(0, bonY - 0.002, 0, 0, stemTop, 0, stemR, 14));
          // Closed torus handwheel rim + central hub + 4 spokes
          const wheelR = od * 1.05;
          const rimR = Math.max(0.006, od * 0.09);
          const rimPts: Pt2[] = [];
          const tubeSegs = 10;
          for (let i = 0; i < tubeSegs; i++) {
            const a = (i * TAU) / tubeSegs;
            rimPts.push([wheelR + rimR * Math.cos(a), wheelY + rimR * Math.sin(a)]);
          }
          parts.push(revolveClosedProfile(rimPts, segs));
          parts.push(
            buildCylBetween(0, wheelY - rimR * 1.1, 0, 0, wheelY + rimR * 1.1, 0, stemR * 1.9, 14),
          );
          const spin = openFrac * TAU;
          for (let k = 0; k < 4; k++) {
            const a = spin + (k * Math.PI) / 2;
            const ca = Math.cos(a),
              sa = Math.sin(a);
            parts.push(
              buildCylBetween(
                ca * stemR * 1.5,
                wheelY,
                sa * stemR * 1.5,
                ca * (wheelR - rimR * 0.6),
                wheelY,
                sa * (wheelR - rimR * 0.6),
                rimR * 0.55,
                10,
              ),
            );
          }
        }
      }

      applyBuffers(this, mergeRaw(parts), 'ValveGeometry', {
        kind,
        size: spec.name,
        outerDiameter: od,
        openFraction: openFrac,
      });
    }
  }

  // --- 3b. CentrifugalPumpGeometry ---
  class CentrifugalPumpGeometry extends BufferGeometry {
    constructor(options: CentrifugalPumpOptions = {}) {
      super();
      const sucSpec = nominalPipeSpec(options.suctionSize ?? 'DN100');
      const disSpec = nominalPipeSpec(options.dischargeSize ?? 'DN80');
      const rSuc = sucSpec.outerDiameter * 0.5;
      const rDis = disSpec.outerDiameter * 0.5;
      const volR = clamp(
        num(options.casingRadius, Math.max(0.18, rSuc * 3.2)),
        Math.max(0.08, rSuc * 1.8),
        2.5,
      );
      const kw = clamp(num(options.motorPowerKw, 15), 0.5, 500);
      const motorScale = Math.pow(kw / 15, 0.22);
      const motorR = volR * 0.78 * motorScale;
      const motorLen = volR * 2.1 * motorScale;
      const segs = clampInt(options.radialSegments, 12, MAX_SEGS, 24);
      const origin = options.origin ?? 'floor';

      const skidH = Math.max(0.055, volR * 0.28);
      const shaftY = skidH + Math.max(volR, motorR) * 1.22;
      const volW = volR * 0.72;
      const coupLen = volR * 0.95;
      const totalSpanX = volW + coupLen + motorLen + volR * 0.9;
      const skidL = clamp(num(options.skidLength, totalSpanX), totalSpanX * 0.85, 12);
      const skidW = clamp(
        num(options.skidWidth, Math.max(volR, motorR) * 2.35),
        Math.max(volR, motorR) * 1.6,
        5,
      );

      const xPump = -skidL * 0.32;
      const xMotor = xPump + volW * 0.5 + coupLen + motorLen * 0.5;
      const parts: RawBufs[] = [];

      // 1. Structural steel C-channel skid baseplate at y in [0, skidH]
      parts.push(buildBox(0, skidH * 0.5, 0, skidL, skidH, skidW));

      // 2. End-suction volute snail casing + pedestal support foot
      const volProf: Pt2[] = [
        [0, -volW * 0.5],
        [volR * 0.88, -volW * 0.5],
        [volR, -volW * 0.22],
        [volR, volW * 0.22],
        [volR * 0.88, volW * 0.5],
        [0, volW * 0.5],
      ];
      parts.push(
        xformRaw(revolveClosedProfile(volProf, segs), xPump, shaftY, 0, basisFromY(1, 0, 0)),
        buildBox(
          xPump,
          (skidH + 2e-4 + shaftY - volR * 0.65) * 0.5,
          0,
          volW * 0.78,
          Math.max(0.04, shaftY - volR * 0.65 - skidH - 2e-4),
          volR * 1.15,
        ),
      );

      // 3. Axial suction nozzle (-X) + vertical tangential/top discharge nozzle (+Y)
      const sucLen = volR * 0.75;
      const xSucEnd = xPump - volW * 0.5 - sucLen;
      parts.push(
        buildCylBetween(xSucEnd, shaftY, 0, xPump - volW * 0.35, shaftY, 0, rSuc, segs),
        buildFlangeCollar(
          xSucEnd + sucSpec.flangeThickness * 0.5 + 2e-4,
          shaftY,
          0,
          1,
          0,
          0,
          Math.max(rSuc * 1.4, sucSpec.flangeDiameter * 0.5),
          sucSpec.flangeThickness,
          rSuc * 1.14,
          sucSpec.flangeThickness * 0.5,
          segs,
        ),
      );
      const yDisEnd = shaftY + volR + volR * 0.55;
      const zDis = volR * 0.36;
      parts.push(
        buildCylBetween(xPump, shaftY + volR * 0.45, zDis, xPump, yDisEnd, zDis, rDis, segs),
        buildFlangeCollar(
          xPump,
          yDisEnd - disSpec.flangeThickness * 0.5 - 2e-4,
          zDis,
          0,
          -1,
          0,
          Math.max(rDis * 1.4, disSpec.flangeDiameter * 0.5),
          disSpec.flangeThickness,
          rDis * 1.14,
          disSpec.flangeThickness * 0.5,
          segs,
        ),
      );

      // 4. Bearing frame + OSHA coupling guard between volute and motor
      const xCoupMid = xPump + volW * 0.5 + coupLen * 0.5;
      parts.push(
        buildCylBetween(
          xPump + volW * 0.45,
          shaftY,
          0,
          xMotor - motorLen * 0.48,
          shaftY,
          0,
          volR * 0.32,
          16,
        ),
        // Raised coupling safety shield
        buildCylBetween(
          xCoupMid - coupLen * 0.28,
          shaftY,
          0,
          xCoupMid + coupLen * 0.28,
          shaftY,
          0,
          volR * 0.46,
          16,
        ),
        buildBox(
          xCoupMid,
          (skidH + 2e-4 + shaftY - volR * 0.3) * 0.5,
          0,
          coupLen * 0.32,
          Math.max(0.04, shaftY - volR * 0.3 - skidH - 2e-4),
          volR * 0.55,
        ),
      );

      // 5. Finned TEFC electric drive motor + mounting feet + conduit terminal box
      const hM = motorLen * 0.5;
      const mPts: Pt2[] = [
        [0, -hM],
        [motorR * 0.86, -hM],
        [motorR * 0.95, -hM + motorLen * 0.14],
      ];
      const nFins = 7;
      const finSpan = motorLen * 0.58;
      const finStep = finSpan / nFins;
      for (let f = 0; f < nFins; f++) {
        const fy = -hM + motorLen * 0.16 + f * finStep;
        mPts.push(
          [motorR * 0.94, fy],
          [motorR * 1.06, fy + finStep * 0.25],
          [motorR * 1.06, fy + finStep * 0.6],
          [motorR * 0.94, fy + finStep * 0.85],
        );
      }
      mPts.push(
        [motorR * 0.96, hM - motorLen * 0.18],
        [motorR * 0.82, hM],
        [0, hM],
      );
      parts.push(
        xformRaw(revolveClosedProfile(mPts, segs), xMotor, shaftY, 0, basisFromY(1, 0, 0)),
      );
      // Motor feet & top terminal box
      const footH = Math.max(0.03, shaftY - motorR * 0.82 - skidH - 2e-4);
      for (const fx of [-motorLen * 0.28, motorLen * 0.26]) {
        parts.push(
          buildBox(
            xMotor + fx,
            skidH + 2e-4 + footH * 0.5,
            0,
            motorLen * 0.22,
            footH,
            motorR * 1.55,
          ),
        );
      }
      parts.push(
        buildBox(
          xMotor - motorLen * 0.1,
          shaftY + motorR * 1.06 + motorR * 0.24 + 2e-4,
          0,
          motorR * 0.72,
          motorR * 0.48,
          motorR * 0.72,
        ),
      );

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -yDisEnd * 0.5, 0);

      applyBuffers(this, merged, 'CentrifugalPumpGeometry', {
        suctionSize: sucSpec.name,
        dischargeSize: disSpec.name,
        casingRadius: volR,
        skidLength: skidL,
        skidWidth: skidW,
      });
    }
  }

  // --- 4. PalletRackGeometry ---
  class PalletRackGeometry extends BufferGeometry {
    constructor(options: PalletRackOptions = {}) {
      super();
      const bays = clampInt(options.bays, 1, 16, 2);
      const levels = clampInt(options.levels, 1, 10, 3);
      const bayW = clamp(num(options.bayWidth, 2.7), 0.6, 12);
      const depth = clamp(num(options.depth, 1.1), 0.4, 4);
      const height = clamp(num(options.height, 4.5), 1.0, 24);
      const upW = clamp(num(options.uprightWidth, 0.09), 0.04, 0.3);
      const beamH = clamp(num(options.beamHeight, 0.12), 0.05, 0.4);
      const maxDeckBars = Math.max(0, Math.min(12, Math.floor(640 / (bays * levels)) - 2));
      const deckBars = clampInt(options.deckBarsPerBay, 0, maxDeckBars, Math.min(4, maxDeckBars));
      const origin = options.origin ?? 'floor';

      const totalW = bays * bayW + (bays + 1) * upW;
      const hW = totalW * 0.5;
      const hD = depth * 0.5;
      const zF = hD - upW * 0.5;
      const zB = -hD + upW * 0.5;
      const bpT = 0.012;
      const parts: RawBufs[] = [];

      // Upright end/intermediate frames (front & rear columns + baseplates + Z-bracing)
      const braceRows = clamp(Math.round(height / 0.9), 2, 24);
      for (let f = 0; f <= bays; f++) {
        const x = -hW + upW * 0.5 + f * (bayW + upW);
        // Baseplates
        parts.push(
          buildBox(x, bpT * 0.5, zF, upW * 1.8, bpT, upW * 1.8),
          buildBox(x, bpT * 0.5, zB, upW * 1.8, bpT, upW * 1.8),
        );
        // Front & back upright posts
        const colH = height - bpT - 2e-4;
        parts.push(
          buildBox(x, bpT + 2e-4 + colH * 0.5, zF, upW, colH, upW),
          buildBox(x, bpT + 2e-4 + colH * 0.5, zB, upW, colH, upW),
        );
        // Horizontal & diagonal frame bracing between zB and zF
        const zInnerSpan = depth - upW * 2 - 4e-4;
        if (zInnerSpan > 0.08) {
          const brW = upW * 0.42;
          parts.push(
            buildBox(x, 0.22, 0, brW, brW, zInnerSpan),
            buildBox(x, height - 0.12, 0, brW, brW, zInnerSpan),
          );
          const ySpan = height - 0.36;
          const stepY = ySpan / braceRows;
          for (let r = 0; r < braceRows; r++) {
            const ya = 0.24 + r * stepY;
            const yb = ya + stepY - 0.02;
            const z0 = r % 2 === 0 ? zB + upW * 0.55 : zF - upW * 0.55;
            const z1 = r % 2 === 0 ? zF - upW * 0.55 : zB + upW * 0.55;
            parts.push(buildBoxStrut(x, ya, z0, x, yb, z1, brW * 0.85, brW * 0.85));
          }
        }
      }

      // Horizontal load-beam levels + deck crossbars
      const beamThick = upW * 0.62;
      for (let lv = 1; lv <= levels; lv++) {
        const yBeam = (height * lv) / (levels + 0.35);
        for (let b = 0; b < bays; b++) {
          const xCenter = -hW + upW + b * (bayW + upW) + bayW * 0.5;
          const spanX = bayW - 4e-4;
          parts.push(
            buildBox(xCenter, yBeam, zF, spanX, beamH, beamThick),
            buildBox(xCenter, yBeam, zB, spanX, beamH, beamThick),
          );
          const tieSpanZ = depth - upW * 2 - beamThick - 4e-4;
          if (deckBars > 0 && tieSpanZ > 0.05) {
            const barH = 0.028;
            const barW = 0.045;
            for (let d = 0; d < deckBars; d++) {
              const bx =
                xCenter - bayW * 0.5 + ((d + 0.5) * bayW) / deckBars;
              parts.push(
                buildBox(
                  bx,
                  yBeam + beamH * 0.5 + barH * 0.5 + 2e-4,
                  0,
                  barW,
                  barH,
                  tieSpanZ,
                ),
              );
            }
          }
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -height * 0.5, 0);

      applyBuffers(this, merged, 'PalletRackGeometry', {
        bays,
        levels,
        totalWidth: totalW,
        depth,
        height,
      });
    }
  }

  // --- 5. ConveyorGeometry ---
  class ConveyorGeometry extends BufferGeometry {
    constructor(options: ConveyorOptions = {}) {
      super();
      const kind = options.kind ?? 'roller';
      const len = clamp(num(options.length, 3.0), 0.5, 30);
      const width = clamp(num(options.width, 0.7), 0.2, 4);
      const incDeg = clamp(num(options.inclineDeg, 0), -32, 32);
      const incRad = (incDeg * Math.PI) / 180;
      const sinI = Math.sin(incRad);
      const cosI = Math.cos(incRad);
      const rRoll = clamp(num(options.rollerRadius, 0.03), 0.012, 0.15);
      const pitch = clamp(num(options.rollerPitch, rRoll * 3.0), rRoll * 2.2, 0.8);
      const frameH = clamp(num(options.frameHeight, Math.max(0.11, rRoll * 3.4)), rRoll * 2.2, 0.4);
      const minMidH =
        Math.abs(sinI) * len * 0.5 + rRoll + frameH + 0.12;
      const topH = Math.max(
        minMidH,
        clamp(num(options.height, 0.85), 0.2, 8),
      );
      const sideGuides = Boolean(options.sideGuides);
      const guideH = clamp(num(options.guideHeight, 0.09), 0.03, 0.35);
      const legPairs = clampInt(options.legCount, 2, 16, Math.max(2, Math.round(len / 1.8) + 1));
      const origin = options.origin ?? 'floor';

      const railT = 0.035;
      const innerW = Math.max(0.1, width - railT * 2);
      const hL = len * 0.5;
      const zRail = width * 0.5 - railT * 0.5;
      const yFrameLocal = -rRoll - frameH * 0.35;
      const bedParts: RawBufs[] = [];

      // Side channel rails in conveyor bed local coords (top surface at y = 0)
      bedParts.push(
        buildBox(0, yFrameLocal, zRail, len, frameH, railT),
        buildBox(0, yFrameLocal, -zRail, len, frameH, railT),
      );

      if (kind === 'belt') {
        const drumX = hL - rRoll * 1.4;
        const beltT = Math.max(0.008, rRoll * 0.26);
        const beltW = innerW - 0.012;
        const sliderH = rRoll * 1.4;
        bedParts.push(
          buildCylBetween(-drumX, -rRoll, -innerW * 0.49, -drumX, -rRoll, innerW * 0.49, rRoll * 0.92, 18),
          buildCylBetween(drumX, -rRoll, -innerW * 0.49, drumX, -rRoll, innerW * 0.49, rRoll * 0.92, 18),
          buildBox(0, -beltT * 0.5, 0, drumX * 2, beltT, beltW),
          buildBox(0, -rRoll * 2 + beltT * 0.5, 0, drumX * 2, beltT, beltW),
          buildBox(0, -rRoll, 0, drumX * 1.85, sliderH * 0.5, beltW * 0.94),
        );
      } else {
        const usableL = len - rRoll * 2.4;
        const count = clamp(Math.floor(usableL / pitch) + 1, 2, MAX_RUNGS);
        const step = count > 1 ? usableL / (count - 1) : 0;
        const zSpan = innerW * 0.5 - 2e-4;
        for (let i = 0; i < count; i++) {
          const rx = count > 1 ? -usableL * 0.5 + i * step : 0;
          bedParts.push(
            buildCylBetween(rx, -rRoll, -zSpan, rx, -rRoll, zSpan, rRoll, 14),
          );
        }
      }

      if (sideGuides) {
        const zGuide = innerW * 0.5 - 0.018;
        const brkCount = clamp(Math.max(2, Math.round(len / 1.1) + 1), 2, 24);
        for (const sgn of [-1, 1]) {
          bedParts.push(
            buildBox(0, guideH * 0.65, sgn * zGuide, len * 0.98, 0.028, 0.014),
          );
          for (let b = 0; b < brkCount; b++) {
            const bx = -len * 0.44 + (len * 0.88 * b) / (brkCount - 1);
            bedParts.push(
              buildBox(
                bx,
                (yFrameLocal + guideH * 0.5) * 0.5,
                sgn * (width * 0.5 + 0.01 + 2e-4),
                0.024,
                guideH * 0.6 - yFrameLocal,
                0.018,
              ),
            );
          }
        }
      }

      const bedMerged = mergeRaw(bedParts);
      // Rotate bed around Z by incRad (`(x, y) -> (x*cos - y*sin, x*sin + y*cos + topH)`)
      xformRaw(
        bedMerged,
        0,
        topH,
        0,
        [cosI, -sinI, 0, sinI, cosI, 0, 0, 0, 1],
      );
      const parts: RawBufs[] = [bedMerged];

      // Vertical support H-legs down to y = 0 with graduated heights matching incline!
      const legW = 0.05;
      const fpT = 0.012;
      const legSpanS = len - Math.min(0.4, len * 0.2);
      const localBottom = yFrameLocal - frameH * 0.5;
      for (let i = 0; i < legPairs; i++) {
        const s = legPairs > 1 ? -legSpanS * 0.5 + (i * legSpanS) / (legPairs - 1) : 0;
        const wx = s * cosI - localBottom * sinI;
        // Clear sloped underside cleanly across leg half-width!
        const wyUnder =
          topH + s * sinI + localBottom * cosI - Math.abs(sinI) * legW * 0.6 - 4e-4;
        if (wyUnder > fpT + 0.05) {
          const postH = wyUnder - fpT - 2e-4;
          parts.push(
            buildBox(wx, fpT * 0.5, zRail, legW * 2.1, fpT, legW * 2.1),
            buildBox(wx, fpT * 0.5, -zRail, legW * 2.1, fpT, legW * 2.1),
            buildBox(wx, fpT + 2e-4 + postH * 0.5, zRail, legW, postH, legW),
            buildBox(wx, fpT + 2e-4 + postH * 0.5, -zRail, legW, postH, legW),
            buildBox(
              wx,
              Math.max(fpT + 0.1, wyUnder * 0.35),
              0,
              legW * 0.8,
              legW * 0.8,
              zRail * 2 - legW - 4e-4,
            ),
          );
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -topH * 0.5, 0);

      applyBuffers(this, merged, 'ConveyorGeometry', {
        kind,
        length: len,
        width,
        height: topH,
        inclineDeg: incDeg,
        sideGuides,
      });
    }
  }

  // --- 5b. CatwalkPlatformGeometry ---
  class CatwalkPlatformGeometry extends BufferGeometry {
    constructor(options: CatwalkPlatformOptions = {}) {
      super();
      const len = clamp(num(options.length, 4.0), 0.8, 40);
      const width = clamp(num(options.width, 1.1), 0.5, 8);
      const height = clamp(num(options.height, 2.6), 0.4, 20);
      const guardrail = options.guardrail ?? 'both';
      const railH = clamp(num(options.railHeight, 1.07), 0.5, 2.0);
      const origin = options.origin ?? 'floor';

      const hL = len * 0.5;
      const hW = width * 0.5;
      const beamH = 0.16;
      const beamT = 0.055;
      const colW = 0.1;
      const bpT = 0.016;
      const parts: RawBufs[] = [];

      // 1. Structural columns & floor baseplates down to y = 0
      const colBays = clamp(Math.max(1, Math.round(len / 3.2)), 1, 16);
      const colTop = height - beamH - 2e-4;
      const colH = Math.max(0.08, colTop - bpT - 2e-4);
      const zCol = hW - colW * 0.55;
      for (let b = 0; b <= colBays; b++) {
        const cx = -hL + colW * 0.6 + (b * (len - colW * 1.2)) / colBays;
        for (const sgn of [-1, 1]) {
          parts.push(
            buildBox(cx, bpT * 0.5, sgn * zCol, colW * 2.0, bpT, colW * 2.0),
            buildBox(cx, bpT + 2e-4 + colH * 0.5, sgn * zCol, colW, colH, colW),
          );
        }
      }

      // 2. Perimeter C-channel stringer frame at y in [height - beamH, height]
      const yBeamMid = height - beamH * 0.5;
      parts.push(
        buildBox(0, yBeamMid, hW - beamT * 0.5, len, beamH, beamT),
        buildBox(0, yBeamMid, -hW + beamT * 0.5, len, beamH, beamT),
        buildBox(-hL + beamT * 0.5, yBeamMid, 0, beamT, beamH, width - beamT * 2 - 4e-4),
        buildBox(hL - beamT * 0.5, yBeamMid, 0, beamT, beamH, width - beamT * 2 - 4e-4),
      );

      // 3. Bar-grating walkway deck slats
      const nSlats = clampInt(
        options.gratingBars,
        6,
        120,
        clamp(Math.round(len / 0.14), 8, 80),
      );
      const grateH = 0.026;
      const grateSpanX = len - beamT * 2 - 0.01;
      const slatW = Math.min(0.06, (grateSpanX / nSlats) * 0.62);
      const grateSpanZ = width - beamT * 0.6;
      for (let i = 0; i < nSlats; i++) {
        const sx =
          -grateSpanX * 0.5 + ((i + 0.5) * grateSpanX) / nSlats;
        parts.push(
          buildBox(sx, height + grateH * 0.5 + 2e-4, 0, slatW, grateH, grateSpanZ),
        );
      }

      // 4. OSHA safety guardrails + 100mm toeboards along walkway sides
      if (guardrail !== 'none') {
        const sides = guardrail === 'front' ? [1] : [-1, 1];
        const postCount = clamp(Math.ceil(len / 1.4) + 1, 2, 32);
        const postR = 0.022;
        const railR = 0.019;
        const stepX = (len - 0.08) / (postCount - 1);
        const yDeck = height + grateH + 4e-4;
        for (const sgn of sides) {
          const rz = sgn * (hW - 0.028);
          for (let p = 0; p < postCount; p++) {
            const px = -hL + 0.04 + p * stepX;
            parts.push(
              buildCylBetween(px, yDeck, rz, px, yDeck + railH, rz, postR, 12),
            );
          }
          for (let p = 0; p < postCount - 1; p++) {
            const x0 = -hL + 0.04 + p * stepX + postR * 0.9;
            const x1 = -hL + 0.04 + (p + 1) * stepX - postR * 0.9;
            if (x1 <= x0 + 0.01) continue;
            parts.push(
              buildCylBetween(x0, yDeck + railH - railR, rz, x1, yDeck + railH - railR, rz, railR, 12),
              buildCylBetween(x0, yDeck + railH * 0.52, rz, x1, yDeck + railH * 0.52, rz, railR, 12),
              buildBox((x0 + x1) * 0.5, yDeck + 0.052, rz, x1 - x0, 0.1, 0.01),
            );
          }
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') {
        xformRaw(merged, 0, -(height + (guardrail === 'none' ? 0 : railH)) * 0.5, 0);
      }

      applyBuffers(this, merged, 'CatwalkPlatformGeometry', {
        length: len,
        width,
        height,
        guardrail,
      });
    }
  }

  // --- 6. IndustrialLadderGeometry ---
  class IndustrialLadderGeometry extends BufferGeometry {
    constructor(options: IndustrialLadderOptions = {}) {
      super();
      const h = clamp(num(options.height, 4.2), 0.6, 30);
      const w = clamp(num(options.width, 0.46), 0.3, 1.2);
      const rungSp = clamp(num(options.rungSpacing, 0.3), 0.2, 0.45);
      const railR = clamp(num(options.railRadius, 0.024), 0.012, 0.06);
      const rungR = clamp(num(options.rungRadius, 0.013), 0.008, railR * 0.85);
      const standoff = clamp(num(options.standoffDepth, 0.18), 0.08, 0.6);
      const includeCage = options.includeCage ?? h >= 3.0;
      const cageY0 = clamp(num(options.cageStartHeight, 2.2), 0.8, Math.max(0.9, h - 0.6));
      const cageR = clamp(num(options.cageRadius, 0.38), w * 0.55, 0.7);
      const origin = options.origin ?? 'floor';

      const hW = w * 0.5;
      const parts: RawBufs[] = [];

      // Side rails along Y at `x = ±hW, z = 0`
      parts.push(
        buildCylBetween(-hW, 0, 0, -hW, h, 0, railR, 14),
        buildCylBetween(hW, 0, 0, hW, h, 0, railR, 14),
      );

      // Rungs along X
      const rungCount = clamp(Math.floor((h - 0.15) / rungSp), 2, MAX_RUNGS);
      const xSpan = hW - railR * 0.9;
      for (let i = 1; i <= rungCount; i++) {
        const ry = i * rungSp;
        if (ry > h - 0.08) break;
        parts.push(buildCylBetween(-xSpan, ry, 0, xSpan, ry, 0, rungR, 12));
      }

      // Wall-mounting standoff brackets toward -Z
      const brkCount = clamp(Math.max(2, Math.round(h / 1.8) + 1), 2, 20);
      for (let b = 0; b < brkCount; b++) {
        const by =
          brkCount > 1 ? 0.25 + (b * (h - 0.5)) / (brkCount - 1) : h * 0.5;
        for (const sx of [-hW, hW]) {
          parts.push(
            buildBox(sx, by, -railR - standoff * 0.5 - 2e-4, 0.032, 0.045, standoff),
            buildBox(sx, by, -railR - standoff - 0.006 - 4e-4, 0.09, 0.09, 0.012),
          );
        }
      }

      // OSHA safety hoop cage on +Z climber side above `cageY0`
      if (includeCage && h > cageY0 + 0.4) {
        const hoopTop = h;
        const hoopCount = clamp(Math.max(2, Math.round((hoopTop - cageY0) / 0.85) + 1), 2, 28);
        const strapR = 0.011;
        const zCenter = cageR * 0.78;
        const hoopArcSegs = 14;
        const startAng = -0.32;
        const endAng = Math.PI + 0.32;

        for (let k = 0; k < hoopCount; k++) {
          const hy =
            hoopCount > 1
              ? cageY0 + (k * (hoopTop - cageY0)) / (hoopCount - 1)
              : cageY0;
          const spine: Vec3[] = [[-hW, hy, railR + 2e-4]];
          for (let s = 0; s <= hoopArcSegs; s++) {
            const a = startAng + ((endAng - startAng) * s) / hoopArcSegs;
            spine.push([
              -cageR * Math.cos(a),
              hy,
              zCenter + cageR * Math.sin(a),
            ]);
          }
          spine.push([hW, hy, railR + 2e-4]);
          parts.push(sweepTubeClosed(spine, strapR, 10));
        }

        // 5 vertical cage bars connecting bottom hoop to top hoop
        for (let v = 0; v < 5; v++) {
          const a = 0.1 + ((Math.PI - 0.2) * v) / 4;
          const vx = -cageR * Math.cos(a);
          const vz = zCenter + cageR * Math.sin(a) + strapR * 1.6;
          parts.push(buildCylBetween(vx, cageY0, vz, vx, hoopTop, vz, strapR * 0.85, 10));
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -h * 0.5, 0);

      applyBuffers(this, merged, 'IndustrialLadderGeometry', {
        height: h,
        width: w,
        includeCage: includeCage && h > cageY0 + 0.4,
      });
    }
  }

  // --- 7. SafetyBarrierGeometry ---
  class SafetyBarrierGeometry extends BufferGeometry {
    constructor(options: SafetyBarrierOptions = {}) {
      super();
      const kind = options.kind ?? 'guardrail-double';
      const origin = options.origin ?? 'floor';

      if (kind === 'bollard') {
        const h = clamp(num(options.height, 1.05), 0.3, 3.0);
        const r = clamp(num(options.postRadius, 0.076), 0.03, 0.35);
        const bp = clamp(num(options.baseplateSize, r * 3.4), r * 2.2, 1.0);
        const bpT = 0.016;
        const domeSegs = 8;
        const prof: Pt2[] = [
          [0, bpT + 2e-4],
          [r, bpT + 2e-4],
          [r, Math.max(bpT + 0.05, h - r)],
        ];
        for (let i = 1; i < domeSegs; i++) {
          const a = (Math.PI * 0.5 * i) / domeSegs;
          prof.push([r * Math.cos(a), Math.max(bpT + 0.05, h - r) + r * Math.sin(a)]);
        }
        prof.push([0, h]);
        const merged = mergeRaw([
          buildBox(0, bpT * 0.5, 0, bp, bpT, bp),
          revolveClosedProfile(prof, 24),
        ]);
        if (origin === 'center') xformRaw(merged, 0, -h * 0.5, 0);
        applyBuffers(this, merged, 'SafetyBarrierGeometry', {
          kind,
          height: h,
          postRadius: r,
        });
        return;
      }

      const len = clamp(num(options.length, 2.4), 0.4, 30);
      const defaultH = kind === 'guardrail-single' ? 0.55 : 1.07;
      const h = clamp(num(options.height, defaultH), 0.3, 2.5);
      const postR = clamp(
        num(options.postRadius, kind === 'handrail' ? 0.024 : 0.055),
        0.015,
        0.2,
      );
      const postSp = clamp(num(options.postSpacing, 1.5), 0.4, 6);
      const bp = clamp(num(options.baseplateSize, postR * 3.6), postR * 2.2, 0.6);
      const bpT = 0.014;

      const postCount = clamp(Math.ceil(len / postSp) + 1, 2, MAX_SPANS);
      const hL = len * 0.5;
      const step = len / (postCount - 1);
      const parts: RawBufs[] = [];

      for (let i = 0; i < postCount; i++) {
        const px = -hL + i * step;
        parts.push(
          buildBox(px, bpT * 0.5, 0, bp, bpT, bp),
          buildCylBetween(px, bpT + 2e-4, 0, px, h, 0, postR, 16),
        );
      }

      const railR = kind === 'handrail' ? postR * 0.92 : postR * 0.78;
      const railHeights =
        kind === 'guardrail-single'
          ? [h * 0.72]
          : kind === 'guardrail-double'
            ? [h * 0.42, h * 0.86]
            : [h * 0.52, h - railR];

      for (let s = 0; s < postCount - 1; s++) {
        const x0 = -hL + s * step + postR * 0.85;
        const x1 = -hL + (s + 1) * step - postR * 0.85;
        if (x1 <= x0 + 0.01) continue;
        for (const ry of railHeights) {
          parts.push(buildCylBetween(x0, ry, 0, x1, ry, 0, railR, 14));
        }
        if (kind === 'handrail') {
          // OSHA 4-inch (0.1 m) kickplate / toeboard
          parts.push(buildBox((x0 + x1) * 0.5, bpT + 0.055, 0, x1 - x0, 0.1, 0.012));
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -h * 0.5, 0);

      applyBuffers(this, merged, 'SafetyBarrierGeometry', {
        kind,
        length: len,
        height: h,
      });
    }
  }

  // --- 8. StorageTankGeometry ---
  class StorageTankGeometry extends BufferGeometry {
    constructor(options: StorageTankOptions = {}) {
      super();
      const kind = options.kind ?? 'vertical-dished';
      const r = clamp(
        num(
          options.radius ??
            (options.diameter !== undefined ? num(options.diameter, 2.0) * 0.5 : undefined),
          1.0,
        ),
        0.15,
        15,
      );
      const shellH = clamp(
        num(options.shellHeight ?? options.length, kind === 'horizontal-saddle' ? r * 3.8 : r * 2.6),
        r * 0.5,
        40,
      );
      const segs = clampInt(options.radialSegments, 12, MAX_SEGS, 32);
      const manway = options.manway !== false;
      const origin = options.origin ?? 'floor';
      const headH = r * 0.42;
      const headSteps = 8;

      const parts: RawBufs[] = [];
      let totalH = 0;

      if (kind === 'horizontal-saddle') {
        // Horizontal cylindrical pressure vessel along X with two dished heads + two cradle saddles
        const hS = shellH * 0.5;
        const prof: Pt2[] = [[0, -hS - headH]];
        for (let i = 1; i <= headSteps; i++) {
          const a = (Math.PI * 0.5 * i) / headSteps;
          prof.push([r * Math.sin(a), -hS - headH * Math.cos(a)]);
        }
        for (let i = 0; i <= headSteps; i++) {
          const a = (Math.PI * 0.5 * i) / headSteps;
          prof.push([r * Math.cos(a), hS + headH * Math.sin(a)]);
        }
        prof.push([0, hS + headH]);

        const saddleClear = clamp(num(options.legHeight, r * 0.32), 0.1, 4);
        const yCenter = saddleClear + r;
        parts.push(xformRaw(revolveClosedProfile(prof, segs), 0, yCenter, 0, basisFromY(1, 0, 0)));

        // Two steel saddle supports resting at y = 0
        const sadT = Math.max(0.08, shellH * 0.06);
        const sadW = r * 1.55;
        const sadH = saddleClear + r * 0.28;
        const sadX = hS * 0.62;
        const bpT = 0.025;
        for (const sx of [-sadX, sadX]) {
          parts.push(
            buildBox(sx, bpT * 0.5, 0, sadT * 1.8, bpT, sadW * 1.12),
            buildBox(sx, bpT + 2e-4 + (sadH - bpT) * 0.5, 0, sadT, sadH - bpT, sadW),
          );
        }
        if (manway) {
          const mR = Math.min(0.3, r * 0.28);
          const mTop = yCenter + r + mR * 0.85;
          parts.push(
            buildFlangeCollar(0, mTop, 0, 0, -1, 0, mR * 1.38, mR * 0.22, mR, mR * 0.9, 20),
          );
          totalH = mTop + mR * 0.12;
        } else {
          totalH = yCenter + r;
        }
      } else if (kind === 'flat-api650') {
        // Flat-bottom cylindrical API-650 tank-farm vessel with annular base chime & shallow cone roof
        const chimeT = Math.max(0.03, r * 0.03);
        const coneH = r * 0.22;
        const prof: Pt2[] = [
          [0, 0],
          [r * 1.035, 0],
          [r * 1.035, chimeT],
          [r, chimeT],
          [r, shellH],
          [r * 1.025, shellH],
          [r * 1.025, shellH + chimeT * 0.7],
          [0, shellH + coneH],
        ];
        parts.push(revolveClosedProfile(prof, segs));
        totalH = shellH + coneH;
        if (manway) {
          const mR = Math.min(0.32, r * 0.22);
          // Roof inspection manway + lower shell cleanout manway on +Z
          parts.push(
            buildFlangeCollar(
              r * 0.45,
              shellH + coneH * 0.55 + mR * 0.65,
              0,
              0,
              -1,
              0,
              mR * 1.38,
              mR * 0.22,
              mR,
              mR * 0.85,
              18,
            ),
            buildFlangeCollar(
              0,
              chimeT + mR * 1.6,
              r + mR * 0.7,
              0,
              0,
              -1,
              mR * 1.42,
              mR * 0.24,
              mR,
              mR * 0.9,
              18,
            ),
          );
          totalH = Math.max(totalH, shellH + coneH * 0.55 + mR * 0.85);
        }
      } else {
        // Vertical dished vessel or conical-bottom silo
        const legH = clamp(
          num(options.legHeight, kind === 'cone-hopper' ? r * 1.5 : r * 0.75),
          0.15,
          10,
        );
        const hopH =
          kind === 'cone-hopper'
            ? clamp(num(options.hopperHeight, r * 1.15), r * 0.4, r * 2.5)
            : headH;
        const yShell0 = legH + (kind === 'cone-hopper' ? hopH * 0.65 : headH * 0.6);
        const yShell1 = yShell0 + shellH;

        const prof: Pt2[] = [];
        if (kind === 'cone-hopper') {
          const spoutR = Math.max(0.06, r * 0.16);
          const spoutY = yShell0 - hopH;
          prof.push(
            [0, spoutY - 0.04],
            [spoutR * 1.45, spoutY - 0.04],
            [spoutR * 1.45, spoutY],
            [spoutR, spoutY],
            [r, yShell0],
          );
        } else {
          prof.push([0, yShell0 - headH]);
          for (let i = 1; i <= headSteps; i++) {
            const a = (Math.PI * 0.5 * i) / headSteps;
            prof.push([r * Math.sin(a), yShell0 - headH * Math.cos(a)]);
          }
        }
        for (let i = 0; i <= headSteps; i++) {
          const a = (Math.PI * 0.5 * i) / headSteps;
          prof.push([r * Math.cos(a), yShell1 + headH * Math.sin(a)]);
        }
        prof.push([0, yShell1 + headH]);
        parts.push(revolveClosedProfile(prof, segs));

        // Perimeter structural support legs + baseplates
        const legCount = clampInt(options.legCount, 3, 12, 4);
        const legR = Math.max(0.035, r * 0.075);
        const bp = legR * 3.4;
        const bpT = 0.02;
        const ringR = r - legR * 0.6;
        const legTop = yShell0 + Math.min(shellH * 0.25, r * 0.35);
        for (let k = 0; k < legCount; k++) {
          const a = (k * TAU) / legCount + Math.PI * 0.25;
          const lx = ringR * Math.cos(a);
          const lz = ringR * Math.sin(a);
          parts.push(
            buildBox(lx, bpT * 0.5, lz, bp, bpT, bp),
            buildCylBetween(lx, bpT + 2e-4, lz, lx, legTop, lz, legR, 14),
          );
        }

        if (manway) {
          const mR = Math.min(0.28, r * 0.26);
          const mTop = yShell1 + headH + mR * 0.7;
          parts.push(
            buildFlangeCollar(0, mTop, 0, 0, -1, 0, mR * 1.38, mR * 0.22, mR, mR * 0.85, 20),
          );
          totalH = mTop + mR * 0.12;
        } else {
          totalH = yShell1 + headH;
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -totalH * 0.5, 0);

      applyBuffers(this, merged, 'StorageTankGeometry', {
        kind,
        radius: r,
        shellHeight: shellH,
        totalHeight: totalH,
      });
    }
  }

  const Industrial = {
    MAX_IND_WAYPOINTS: MAX_WP,
    MAX_IND_SEGMENTS: MAX_SEGS,
    MAX_IND_SPANS: MAX_SPANS,
    MAX_IND_RUNGS: MAX_RUNGS,
    nominalPipeSpec,
    PipeRunGeometry,
    PipeFittingGeometry,
    ValveGeometry,
    CentrifugalPumpGeometry,
    PalletRackGeometry,
    ConveyorGeometry,
    CatwalkPlatformGeometry,
    IndustrialLadderGeometry,
    SafetyBarrierGeometry,
    StorageTankGeometry,
  };

  for (const Ctor of [
    PipeRunGeometry,
    PipeFittingGeometry,
    ValveGeometry,
    CentrifugalPumpGeometry,
    PalletRackGeometry,
    ConveyorGeometry,
    CatwalkPlatformGeometry,
    IndustrialLadderGeometry,
    SafetyBarrierGeometry,
    StorageTankGeometry,
  ]) {
    try {
      Object.freeze(Ctor.prototype);
      Object.freeze(Ctor);
    } catch {
      // Ignore if host environment disallows freezing.
    }
  }
  try {
    Object.freeze(Industrial);
  } catch {
    // Ignore if host environment disallows freezing.
  }

  if (reg?.authorNamespace?.Industrial?.PipeRunGeometry) {
    return {Industrial: reg.authorNamespace.Industrial};
  }
  const exportsMap = {
    Industrial,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) reg.authorNamespace = {};
    Object.assign(reg.authorNamespace, exportsMap);
  } else {
    try {
      threeNs.Industrial = Industrial;
    } catch {
      // Frozen THREE proxy resolves via reg.authorNamespace.
    }
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` domain kit plugin registering parametric
 * industrial / process / warehouse geometries (`THREE.Industrial.*`).
 */
export const industrialKitPlugin: ThreeLivePlugin = {
  name: 'kit-industrial',
  onRegister(): void {
    registerWorkerExtensionInstaller(installIndustrialKit);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installIndustrialKit(threeNs, reg);
    }
  },
};
