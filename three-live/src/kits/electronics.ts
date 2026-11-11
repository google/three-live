/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Electronics / ECAD / Hardware Domain Kit
 * (`electronicsKitPlugin` / `THREE.Electronics`).
 *
 * Self-contained watertight 2-manifold `BufferGeometry` generators for PCB
 * assemblies, hardware enclosures, thermal management, industrial control
 * cabinets, IC packages, headers, and board-level I/O connectors:
 * - `jedecPackageSpec` (JEDEC / IPC package dimensions for DIP, SOIC, QFP, QFN, BGA, TO-220, SOT-23, D2PAK)
 * - `PcbBoardGeometry` (rounded FR4 boards with mounting holes & edge cutouts)
 * - `EnclosureGeometry` (`'base' | 'lid' | 'closed'` shells with bosses, standoffs, vents, flanges & I/O panel cutouts)
 * - `HeatsinkGeometry` (monolithic extruded aluminum finned heatsinks)
 * - `DinRailGeometry` (IEC 60715 `'ts35x7.5' | 'ts35x15' | 'ts15'` slotted top-hat rails)
 * - `IcPackageGeometry` (`'dip' | 'soic' | 'qfp' | 'qfn' | 'bga' | 'to220' | 'sot23' | 'd2pak'` IC & power packages)
 * - `PinHeaderGeometry` (`'male' | 'female' | 'shrouded'` 2.54mm / 1.27mm headers, straight or right-angle)
 * - `ConnectorGeometry` (`'usb-c' | 'usb-a' | 'rj45' | 'barrel-jack' | 'sma' | 'terminal-block' | 'hdmi' | 'microsd' | 'jst-xh'`)
 * - `StandoffSpacerGeometry` (`'hex' | 'round'` threaded PCB standoffs with bore & optional male stud)
 * - `DiscreteComponentGeometry` (`'smd-chip' | 'electrolytic-cap' | 'tactile-switch' | 'led-domed' | 'crystal-hc49'`)
 *
 * NOTE: `installElectronicsKit` is serialized via `Function.prototype.toString()`
 * into sandboxed Web Workers and embedded in `three-author-engine.js`. Keep its
 * body 100% self-contained (no module-scoped runtime closures or ES2022 class fields).
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/** Maximum pins/balls per IC package or header assembly. */
export const MAX_ECAD_PINS = 256;
/** Maximum heatsink fins per extrusion. */
export const MAX_ECAD_FINS = 96;
/** Maximum holes/slots per PCB, enclosure, or DIN rail. */
export const MAX_ECAD_HOLES = 64;
/** Maximum radial segments on cylindrical connectors/standoffs. */
export const MAX_ECAD_SEGMENTS = 96;

/** Standard JEDEC / IPC IC package dimensions in meters. */
export interface JedecPackageSpec {
  readonly name: string;
  readonly kind:
    | 'dip'
    | 'soic'
    | 'qfp'
    | 'qfn'
    | 'bga'
    | 'to220'
    | 'sot23'
    | 'd2pak';
  readonly pinCount: number;
  readonly pitch: number;
  readonly bodyWidth: number;
  readonly bodyLength: number;
  readonly bodyHeight: number;
  readonly leadSpan: number;
  valueOf(): number;
}

/** Mounting hole descriptor `(x, z, diameter?)` on a `PcbBoardGeometry`. */
export interface PcbHoleSpec {
  x: number;
  z: number;
  diameter?: number;
}

/** Options for `THREE.Electronics.PcbBoardGeometry`. */
export interface PcbBoardOptions {
  width?: number;
  length?: number;
  depth?: number;
  thickness?: number;
  cornerRadius?: number;
  cornerHoles?: boolean;
  holeInset?: number;
  holeDiameter?: number;
  holes?: readonly PcbHoleSpec[];
  scale?: number;
}

/** Rectangular I/O cutout descriptor on an `EnclosureGeometry` side panel. */
export interface EnclosureCutoutSpec {
  face: 'front' | 'back' | 'left' | 'right';
  x?: number;
  y?: number;
  width: number;
  height: number;
}

/** Options for `THREE.Electronics.EnclosureGeometry`. */
export interface EnclosureOptions {
  part?: 'base' | 'lid' | 'closed';
  width?: number;
  length?: number;
  depth?: number;
  height?: number;
  wallThickness?: number;
  cornerRadius?: number;
  cornerBosses?: boolean;
  pcbStandoffs?: boolean;
  ventSlots?: number;
  flanges?: boolean;
  panelCutouts?: readonly EnclosureCutoutSpec[];
  scale?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Electronics.HeatsinkGeometry`. */
export interface HeatsinkOptions {
  width?: number;
  length?: number;
  depth?: number;
  height?: number;
  baseThickness?: number;
  finCount?: number;
  finThickness?: number;
  taperRatio?: number;
  scale?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Electronics.DinRailGeometry`. */
export interface DinRailOptions {
  profile?: 'ts35x7.5' | 'ts35x15' | 'ts15';
  length?: number;
  thickness?: number;
  slotted?: boolean;
  scale?: number;
}

/** Options for `THREE.Electronics.IcPackageGeometry`. */
export interface IcPackageOptions {
  preset?: string;
  kind?:
    | 'dip'
    | 'soic'
    | 'qfp'
    | 'qfn'
    | 'bga'
    | 'to220'
    | 'sot23'
    | 'd2pak';
  pinCount?: number;
  pitch?: number;
  bodyWidth?: number;
  bodyLength?: number;
  bodyHeight?: number;
  scale?: number;
  origin?: 'board' | 'center';
}

/** Options for `THREE.Electronics.PinHeaderGeometry`. */
export interface PinHeaderOptions {
  gender?: 'male' | 'female' | 'shrouded';
  rows?: number;
  cols?: number;
  pitch?: number;
  rightAngle?: boolean;
  scale?: number;
}

/** Options for `THREE.Electronics.ConnectorGeometry`. */
export interface ConnectorOptions {
  kind?:
    | 'usb-c'
    | 'usb-a'
    | 'rj45'
    | 'barrel-jack'
    | 'sma'
    | 'terminal-block'
    | 'hdmi'
    | 'microsd'
    | 'jst-xh';
  poles?: number;
  pitch?: number;
  scale?: number;
  origin?: 'board' | 'center';
}

/** Options for `THREE.Electronics.StandoffSpacerGeometry`. */
export interface StandoffSpacerOptions {
  shape?: 'hex' | 'round';
  thread?: 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5';
  length?: number;
  acrossFlats?: number;
  boreDiameter?: number;
  maleStudLength?: number;
  scale?: number;
  origin?: 'floor' | 'center';
}

/** Options for `THREE.Electronics.DiscreteComponentGeometry`. */
export interface DiscreteComponentOptions {
  kind?:
    | 'smd-chip'
    | 'electrolytic-cap'
    | 'tactile-switch'
    | 'led-domed'
    | 'crystal-hc49';
  package?: '0402' | '0603' | '0805' | '1206' | '2512';
  diameter?: number;
  height?: number;
  scale?: number;
  origin?: 'board' | 'center';
}

/**
 * Self-contained installer attaching `THREE.Electronics` onto a `THREE`
 * namespace and plugin registry.
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installElectronicsKit(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.BufferGeometry || !threeNs.BufferAttribute) {
    return null;
  }
  if (reg?.authorNamespace?.Electronics?.PcbBoardGeometry) {
    return {Electronics: reg.authorNamespace.Electronics};
  }

  const BufferGeometry = threeNs.BufferGeometry;
  const BufferAttribute = threeNs.BufferAttribute;
  const Vector3 = threeNs.Vector3;

  const MAX_PINS = 256;
  const MAX_FINS = 96;
  const MAX_HOLES = 64;
  const MAX_SEGS = 96;
  const TAU = Math.PI * 2;

  type Pt2 = [number, number];
  type Vec3 = [number, number, number];
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

  // JEDEC table: [kind, pins, pitchMm, bodyWMm, bodyLMm, bodyHMm, leadSpanMm]
  const JEDEC_TABLE: Record<
    string,
    [
      'dip' | 'soic' | 'qfp' | 'qfn' | 'bga' | 'to220' | 'sot23' | 'd2pak',
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  > = {
    'DIP-8': ['dip', 8, 2.54, 6.35, 9.8, 3.3, 7.62],
    'DIP-16': ['dip', 16, 2.54, 6.35, 19.3, 3.3, 7.62],
    'DIP-28': ['dip', 28, 2.54, 7.5, 35.2, 3.5, 7.62],
    'SOIC-8': ['soic', 8, 1.27, 3.9, 4.9, 1.5, 6.0],
    'SOIC-16': ['soic', 16, 1.27, 3.9, 9.9, 1.5, 6.0],
    'SOT-23': ['sot23', 3, 0.95, 1.3, 2.9, 1.0, 2.4],
    'SOT-23-6': ['soic', 6, 0.95, 1.6, 2.9, 1.1, 2.8],
    'TQFP-32': ['qfp', 32, 0.8, 7.0, 7.0, 1.0, 9.0],
    'TQFP-44': ['qfp', 44, 0.8, 10.0, 10.0, 1.0, 12.0],
    'LQFP-64': ['qfp', 64, 0.5, 10.0, 10.0, 1.4, 12.0],
    'QFN-24': ['qfn', 24, 0.5, 4.0, 4.0, 0.85, 4.0],
    'QFN-32': ['qfn', 32, 0.5, 5.0, 5.0, 0.85, 5.0],
    'BGA-64': ['bga', 64, 0.8, 8.0, 8.0, 1.2, 8.0],
    'TO-220': ['to220', 3, 2.54, 10.0, 4.5, 9.0, 10.0],
    'D2PAK': ['d2pak', 3, 2.54, 10.0, 9.0, 4.4, 15.0],
    'TO-263': ['d2pak', 3, 2.54, 10.0, 9.0, 4.4, 15.0],
  };

  function jedecPackageSpec(preset = 'SOIC-8', scale = 1): JedecPackageSpec {
    const s = clamp(num(scale, 1), 0.05, 200);
    const key = String(preset ?? 'SOIC-8')
      .trim()
      .toUpperCase();
    const row = JEDEC_TABLE[key] ?? JEDEC_TABLE['SOIC-8'];
    const resolvedName = JEDEC_TABLE[key] ? key : 'SOIC-8';
    const k = 1e-3 * s;
    const res: JedecPackageSpec = {
      name: resolvedName,
      kind: row[0],
      pinCount: row[1],
      pitch: row[2] * k,
      bodyWidth: row[3] * k,
      bodyLength: row[4] * k,
      bodyHeight: row[5] * k,
      leadSpan: row[6] * k,
      valueOf: () => row[3] * k,
    };
    Object.defineProperty(res, 'valueOf', {
      value: () => row[3] * k,
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

  function xformRaw(
    b: RawBufs,
    tx: number,
    ty: number,
    tz: number,
    rotY = 0,
  ): RawBufs {
    const p = b.pos;
    const n = b.nrm;
    if (rotY === 0) {
      for (let i = 0; i < p.length; i += 3) {
        p[i] += tx;
        p[i + 1] += ty;
        p[i + 2] += tz;
      }
      return b;
    }
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const z = p[i + 2];
      p[i] = x * c + z * s + tx;
      p[i + 1] += ty;
      p[i + 2] = -x * s + z * c + tz;
      const nx = n[i];
      const nz = n[i + 2];
      n[i] = nx * c + nz * s;
      n[i + 2] = -nx * s + nz * c;
    }
    return b;
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

  function buildSphere(
    cx: number,
    cy: number,
    cz: number,
    r: number,
    lonSegs = 12,
    latSegs = 8,
  ): RawBufs {
    const pos: number[] = [cx, cy + r, cz];
    const nrm: number[] = [0, 1, 0];
    const uv: number[] = [0.5, 1];
    const idx: number[] = [];
    for (let i = 1; i < latSegs; i++) {
      const phi = (Math.PI * i) / latSegs;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      for (let j = 0; j < lonSegs; j++) {
        const th = (TAU * j) / lonSegs;
        const nx = sp * Math.cos(th);
        const ny = cp;
        const nz = -sp * Math.sin(th);
        pos.push(cx + r * nx, cy + r * ny, cz + r * nz);
        nrm.push(nx, ny, nz);
        uv.push(j / lonSegs, 1 - i / latSegs);
      }
    }
    const southIdx = 1 + (latSegs - 1) * lonSegs;
    pos.push(cx, cy - r, cz);
    nrm.push(0, -1, 0);
    uv.push(0.5, 0);
    for (let j = 0; j < lonSegs; j++) {
      idx.push(0, 1 + j, 1 + ((j + 1) % lonSegs));
    }
    for (let i = 0; i < latSegs - 2; i++) {
      const r0 = 1 + i * lonSegs;
      const r1 = r0 + lonSegs;
      for (let j = 0; j < lonSegs; j++) {
        const j1 = (j + 1) % lonSegs;
        idx.push(r0 + j, r1 + j, r1 + j1, r0 + j, r1 + j1, r0 + j1);
      }
    }
    const lastR = 1 + (latSegs - 2) * lonSegs;
    for (let j = 0; j < lonSegs; j++) {
      idx.push(southIdx, lastR + ((j + 1) % lonSegs), lastR + j);
    }
    return {pos, nrm, uv, idx};
  }

  function revolveClosedProfile(
    pts: readonly Pt2[],
    radialSegs: number,
    axis: 'y' | 'z' = 'y',
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
        if (axis === 'z') {
          // Map +Y -> +Z, +X -> +X, -Z -> +Y (det = +1)
          pos.push(rA * ct, rA * st, yA, rB * ct, rB * st, yB);
          nrm.push(nr * ct, nr * st, ny, nr * ct, nr * st, ny);
        } else {
          pos.push(rA * ct, yA, -rA * st, rB * ct, yB, -rB * st);
          nrm.push(nr * ct, ny, -nr * st, nr * ct, ny, -nr * st);
        }
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

  // --- 2D Polygon + Holes Ear-Clipping Extruder ---
  function signedArea2D(pts: readonly Pt2[]): number {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a * 0.5;
  }

  function cross2(a: Pt2, b: Pt2, c: Pt2): number {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function ptInTri2D(p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean {
    return (
      cross2(a, b, p) >= -1e-11 &&
      cross2(b, c, p) >= -1e-11 &&
      cross2(c, a, p) >= -1e-11
    );
  }

  function sanitizeLoop(pts: readonly Pt2[], wantCCW: boolean): Pt2[] {
    const out: Pt2[] = [];
    for (const p of pts) {
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
    const area = signedArea2D(out);
    if ((wantCCW && area < 0) || (!wantCCW && area > 0)) out.reverse();
    return out;
  }

  function samePt2(u: Pt2, v: Pt2): boolean {
    return Math.abs(u[0] - v[0]) < 1e-9 && Math.abs(u[1] - v[1]) < 1e-9;
  }

  function onSeg2(p: Pt2, q: Pt2, r: Pt2): boolean {
    return (
      Math.abs(cross2(p, q, r)) <= 1e-11 &&
      r[0] >= Math.min(p[0], q[0]) - 1e-9 &&
      r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
      r[1] >= Math.min(p[1], q[1]) - 1e-9 &&
      r[1] <= Math.max(p[1], q[1]) + 1e-9
    );
  }

  function segsProperlyCross(a: Pt2, b: Pt2, c: Pt2, d: Pt2): boolean {
    if (samePt2(a, c) || samePt2(a, d) || samePt2(b, c) || samePt2(b, d)) {
      return false;
    }
    const d1 = cross2(a, b, c);
    const d2 = cross2(a, b, d);
    const d3 = cross2(c, d, a);
    const d4 = cross2(c, d, b);
    if (
      ((d1 > 1e-11 && d2 < -1e-11) || (d1 < -1e-11 && d2 > 1e-11)) &&
      ((d3 > 1e-11 && d4 < -1e-11) || (d3 < -1e-11 && d4 > 1e-11))
    ) {
      return true;
    }
    return onSeg2(a, b, c) || onSeg2(a, b, d) || onSeg2(c, d, a) || onSeg2(c, d, b);
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
    if (cross2(prev, V, next) >= -1e-11) {
      return cross2(prev, V, M) > -1e-11 && cross2(V, next, M) > -1e-11;
    }
    return !(cross2(V, prev, M) >= 1e-11 && cross2(next, V, M) >= 1e-11);
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
      if ((a[1] > my) === (b[1] > my)) continue;
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
          if (cross2(prev, cur, next) >= 1e-11 || cur[0] < mx - 1e-9) continue;
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
      const isRef = c <= 1e-12;
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
    let cur = 0;
    let failsInPass = 0;
    let eps = 1e-13;
    let guard = n * n * 4 + 64;

    while (rem > 3 && guard-- > 0) {
      const i0 = prev[cur];
      const i1 = cur;
      const i2 = next[cur];
      const ax = px[i0],
        ay = py[i0];
      const bx = px[i1],
        by = py[i1];
      const cx = px[i2],
        cy = py[i2];
      const earCross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

      let isEar = earCross > eps;
      if (isEar && reflexCount > 0) {
        for (let r = 0; r < reflexCount; r++) {
          const vi = reflexIds[r];
          if (vi === i0 || vi === i1 || vi === i2) continue;
          const vx = px[vi],
            vy = py[vi];
          if (
            (Math.abs(vx - ax) < 1e-9 && Math.abs(vy - ay) < 1e-9) ||
            (Math.abs(vx - bx) < 1e-9 && Math.abs(vy - by) < 1e-9) ||
            (Math.abs(vx - cx) < 1e-9 && Math.abs(vy - cy) < 1e-9)
          ) {
            continue;
          }
          if (
            (bx - ax) * (vy - ay) - (by - ay) * (vx - ax) >= -1e-12 &&
            (cx - bx) * (vy - by) - (cy - by) * (vx - bx) >= -1e-12 &&
            (ax - cx) * (vy - cy) - (ay - cy) * (vx - cx) >= -1e-12
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
          if (eps > -1e-8) {
            eps = eps > 0 ? 0 : -1e-8;
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

    const mapPt = (u: number, v: number, w: number): Vec3 =>
      axis === 'z' ? [u, v, w] : axis === 'y' ? [u, w, -v] : [w, v, -u];
    const mapNrm = (nu: number, nv: number, nw: number): Vec3 =>
      axis === 'z' ? [nu, nv, nw] : axis === 'y' ? [nu, nw, -nv] : [nw, nv, -nu];

    let vOff = 0;
    const fN = mapNrm(0, 0, 1);
    for (const p of verts) {
      pos.push(...mapPt(p[0], p[1], z1));
      nrm.push(fN[0], fN[1], fN[2]);
      uv.push(p[0], p[1]);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i],
        b = tris[i + 1],
        c = tris[i + 2];
      if (Math.abs(cross2(verts[a], verts[b], verts[c])) > 1e-16) {
        idx.push(vOff + a, vOff + b, vOff + c);
      }
    }
    vOff += verts.length;

    const bN = mapNrm(0, 0, -1);
    for (const p of verts) {
      pos.push(...mapPt(p[0], p[1], z0));
      nrm.push(bN[0], bN[1], bN[2]);
      uv.push(p[0], p[1]);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i],
        b = tris[i + 1],
        c = tris[i + 2];
      if (Math.abs(cross2(verts[a], verts[b], verts[c])) > 1e-16) {
        idx.push(vOff + a, vOff + c, vOff + b);
      }
    }
    vOff += verts.length;

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
        const en = mapNrm(dv / el, -du / el, 0);
        const u0 = perim;
        const u1 = perim + el;
        perim = u1;
        const base = vOff;
        pos.push(
          ...mapPt(a[0], a[1], z0),
          ...mapPt(b[0], b[1], z0),
          ...mapPt(a[0], a[1], z1),
          ...mapPt(b[0], b[1], z1),
        );
        for (let k = 0; k < 4; k++) nrm.push(en[0], en[1], en[2]);
        uv.push(u0, 0, u1, 0, u0, depth, u1, depth);
        idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
        vOff += 4;
      }
    }
    return {pos, nrm, uv, idx};
  }

  function makeRoundedRectCCW(
    w: number,
    h: number,
    r: number,
    cornerSegs = 5,
  ): Pt2[] {
    const hw = w * 0.5;
    const hh = h * 0.5;
    const rc = clamp(r, 0, Math.min(hw, hh) * 0.92);
    if (rc <= 1e-6) {
      return [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ];
    }
    const pts: Pt2[] = [];
    const corners: Array<[number, number, number]> = [
      [hw - rc, -hh + rc, -Math.PI * 0.5],
      [hw - rc, hh - rc, 0],
      [-hw + rc, hh - rc, Math.PI * 0.5],
      [-hw + rc, -hh + rc, Math.PI],
    ];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= cornerSegs; i++) {
        const a = a0 + (Math.PI * 0.5 * i) / cornerSegs;
        pts.push([cx + rc * Math.cos(a), cy + rc * Math.sin(a)]);
      }
    }
    return pts;
  }

  function makeCircleCW(cx: number, cy: number, r: number, segs = 16): Pt2[] {
    const pts: Pt2[] = [];
    for (let i = 0; i < segs; i++) {
      const a = -(i * TAU) / segs;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  // --- 1. PcbBoardGeometry ---
  class PcbBoardGeometry extends BufferGeometry {
    constructor(options: PcbBoardOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const w = clamp(num(options.width, 0.08 * s), 0.005 * s, 2.0 * s);
      const len = clamp(
        num(options.length ?? options.depth, 0.055 * s),
        0.005 * s,
        2.0 * s,
      );
      const t = clamp(num(options.thickness, 0.0016 * s), 0.0004 * s, 0.05 * s);
      const cr = clamp(
        num(options.cornerRadius, 0.003 * s),
        0,
        Math.min(w, len) * 0.45,
      );
      const holeD = clamp(
        num(options.holeDiameter, 0.0032 * s),
        0.0008 * s,
        Math.min(w, len) * 0.25,
      );
      const inset = clamp(
        num(options.holeInset, Math.max(cr + holeD * 0.4, 0.004 * s)),
        holeD * 0.8,
        Math.min(w, len) * 0.42,
      );

      // Note: extrudeProfile with axis='y' maps `(u = x, w = y, -v = z)` so `v = -z`.
      const outer = makeRoundedRectCCW(w, len, cr, 5);
      const holes: Pt2[][] = [];
      const placed: Array<[number, number, number]> = [];
      const margin = holeD * 0.7;

      const tryAddHole = (hx: number, hz: number, hd: number) => {
        if (holes.length >= MAX_HOLES) return;
        const hr = clamp(hd * 0.5, 0.0003 * s, Math.min(w, len) * 0.2);
        if (
          Math.abs(hx) + hr + margin * 0.4 >= w * 0.5 ||
          Math.abs(hz) + hr + margin * 0.4 >= len * 0.5
        ) {
          return;
        }
        const u = hx;
        const v = -hz;
        for (const [pu, pv, pr] of placed) {
          if (Math.hypot(u - pu, v - pv) < hr + pr + margin * 0.4) return;
        }
        placed.push([u, v, hr]);
        holes.push(makeCircleCW(u, v, hr, 14));
      };

      if (options.cornerHoles !== false) {
        const cx = w * 0.5 - inset;
        const cz = len * 0.5 - inset;
        if (cx > holeD * 0.6 && cz > holeD * 0.6) {
          for (const sx of [-cx, cx]) {
            for (const sz of [-cz, cz]) {
              tryAddHole(sx, sz, holeD);
            }
          }
        }
      }
      if (Array.isArray(options.holes)) {
        for (const h of options.holes) {
          if (!h) continue;
          tryAddHole(num(h.x, 0), num(h.z, 0), num(h.diameter, holeD));
        }
      }

      const raw = extrudeProfile(outer, holes, -t * 0.5, t * 0.5, 'y');
      applyBuffers(this, raw, 'PcbBoardGeometry', {
        width: w,
        length: len,
        thickness: t,
        holeCount: holes.length,
      });
    }
  }

  // --- 2. EnclosureGeometry ---
  class EnclosureGeometry extends BufferGeometry {
    constructor(options: EnclosureOptions = {}) {
      super();
      const part = options.part ?? 'base';
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const w = clamp(num(options.width, 0.11 * s), 0.015 * s, 2.0 * s);
      const len = clamp(
        num(options.length ?? options.depth, 0.075 * s),
        0.015 * s,
        2.0 * s,
      );
      const h = clamp(num(options.height, 0.038 * s), 0.008 * s, 1.0 * s);
      const wt = clamp(
        num(options.wallThickness, 0.0025 * s),
        0.0008 * s,
        Math.min(w, len, h) * 0.2,
      );
      const rawCutouts = Array.isArray(options.panelCutouts)
        ? options.panelCutouts.slice(0, MAX_HOLES)
        : [];
      const hasCutouts = rawCutouts.length > 0 && part !== 'lid';
      const cr = clamp(
        num(options.cornerRadius, 0.006 * s),
        wt * 1.15,
        Math.min(w, len) * (hasCutouts ? 0.28 : 0.42),
      );
      const ventSlots = clampInt(options.ventSlots, 0, 12, 0);
      const origin = options.origin ?? 'floor';
      const gap = 5e-5 * s;

      const outerLoop = makeRoundedRectCCW(w, len, cr, 5);
      const innerLoopCW = makeRoundedRectCCW(
        w - 2 * wt,
        len - 2 * wt,
        Math.max(0, cr - wt),
        5,
      ).reverse();

      const parts: RawBufs[] = [];
      let totalH = h;

      if (part === 'lid') {
        totalH = Math.max(wt * 2.2, h * 0.24);
        // Top plate + recessed alignment lip ring underneath
        const plateH = wt;
        const lipH = totalH - plateH - gap;
        parts.push(extrudeProfile(outerLoop, [], lipH + gap, totalH, 'y'));
        if (lipH > wt * 0.3) {
          const lipOuter = makeRoundedRectCCW(
            w - 2 * wt - gap * 4,
            len - 2 * wt - gap * 4,
            Math.max(0, cr - wt),
            5,
          );
          const lipInnerCW = makeRoundedRectCCW(
            w - 3.6 * wt,
            len - 3.6 * wt,
            Math.max(0, cr - 1.8 * wt),
            5,
          ).reverse();
          parts.push(extrudeProfile(lipOuter, [lipInnerCW], 0, lipH, 'y'));
        }
      } else {
        const baseH = part === 'closed' ? h - wt - gap : h;
        const yWall0 = wt + gap;
        // Bottom floor slab
        parts.push(extrudeProfile(outerLoop, [], 0, wt, 'y'));

        if (options.flanges === true) {
          const flH = wt * 1.25;
          const earProj = Math.max(0.012 * s, wt * 4.5);
          const earLen = Math.min(
            len * 0.82,
            Math.max(0.024 * s, len - 2 * cr),
          );
          const rEar = Math.min(earProj * 0.35, earLen * 0.22);
          const hh = earLen * 0.5;
          const holeR = Math.min(earProj * 0.22, earLen * 0.14, 0.0022 * s);
          const holeV = earLen * 0.27;
          for (const signX of [-1, 1] as const) {
            const xIn = signX * (w * 0.5 + gap);
            const xArc = signX * (w * 0.5 + gap + earProj - rEar);
            const earLoop: Pt2[] = [[xIn, -hh]];
            for (let k = 0; k <= 4; k++) {
              const a = -Math.PI * 0.5 + (Math.PI * 0.5 * k) / 4;
              earLoop.push([
                xArc + signX * rEar * Math.cos(a),
                -hh + rEar + rEar * Math.sin(a),
              ]);
            }
            for (let k = 0; k <= 4; k++) {
              const a = (Math.PI * 0.5 * k) / 4;
              earLoop.push([
                xArc + signX * rEar * Math.cos(a),
                hh - rEar + rEar * Math.sin(a),
              ]);
            }
            earLoop.push([xIn, hh]);
            const hX = signX * (w * 0.5 + gap + earProj * 0.52);
            parts.push(
              extrudeProfile(
                earLoop,
                [
                  makeCircleCW(hX, -holeV, holeR, 14),
                  makeCircleCW(hX, holeV, holeR, 14),
                ],
                0,
                flH,
                'y',
              ),
            );
          }
        }

        if (hasCutouts) {
          const rIn = Math.max(wt * 0.15, cr - wt);
          const corners: Array<[number, number, number]> = [
            [w * 0.5 - cr, -len * 0.5 + cr, -Math.PI * 0.5],
            [w * 0.5 - cr, len * 0.5 - cr, 0],
            [-w * 0.5 + cr, len * 0.5 - cr, Math.PI * 0.5],
            [-w * 0.5 + cr, -len * 0.5 + cr, Math.PI],
          ];
          for (const [cx, cy, a0] of corners) {
            const sec: Pt2[] = [];
            for (let i = 0; i <= 5; i++) {
              const a = a0 + (Math.PI * 0.5 * i) / 5;
              sec.push([cx + cr * Math.cos(a), cy + cr * Math.sin(a)]);
            }
            for (let i = 5; i >= 0; i--) {
              const a = a0 + (Math.PI * 0.5 * i) / 5;
              sec.push([cx + rIn * Math.cos(a), cy + rIn * Math.sin(a)]);
            }
            parts.push(extrudeProfile(sec, [], yWall0, baseH, 'y'));
          }

          const buildCutoutWall = (
            faceName: 'front' | 'back' | 'left' | 'right',
            span: number,
            zStart: number,
            zEnd: number,
            ax: 'x' | 'z',
          ) => {
            if (span <= wt * 0.8 || baseH <= yWall0 + wt * 0.8) return;
            const hSpan = span * 0.5;
            const wallOuter: Pt2[] = [
              [-hSpan, yWall0],
              [hSpan, yWall0],
              [hSpan, baseH],
              [-hSpan, baseH],
            ];
            const margin = Math.max(wt * 0.35, gap * 4);
            const holesCW: Pt2[][] = [];
            const boxes: Array<[number, number, number, number]> = [];
            for (const c of rawCutouts) {
              if (!c || c.face !== faceName) continue;
              const maxCW = span - 2 * margin;
              const maxCH = baseH - yWall0 - 2 * margin;
              if (maxCW <= gap * 4 || maxCH <= gap * 4) continue;
              const cw = clamp(num(c.width, 0.01 * s), 0.001 * s, maxCW);
              const ch = clamp(num(c.height, 0.006 * s), 0.001 * s, maxCH);
              const rawU = ax === 'x' ? -num(c.x, 0) : num(c.x, 0);
              const cu = clamp(
                rawU,
                -hSpan + margin + cw * 0.5,
                hSpan - margin - cw * 0.5,
              );
              const cy = clamp(
                num(c.y, yWall0 + (baseH - yWall0) * 0.45),
                yWall0 + margin + ch * 0.5,
                baseH - margin - ch * 0.5,
              );
              const u0 = cu - cw * 0.5,
                u1 = cu + cw * 0.5;
              const v0 = cy - ch * 0.5,
                v1 = cy + ch * 0.5;
              let overlaps = false;
              for (const [bu0, bv0, bu1, bv1] of boxes) {
                if (
                  u0 < bu1 + margin * 0.5 &&
                  u1 > bu0 - margin * 0.5 &&
                  v0 < bv1 + margin * 0.5 &&
                  v1 > bv0 - margin * 0.5
                ) {
                  overlaps = true;
                  break;
                }
              }
              if (overlaps) continue;
              boxes.push([u0, v0, u1, v1]);
              holesCW.push([
                [u0, v0],
                [u0, v1],
                [u1, v1],
                [u1, v0],
              ]);
            }
            parts.push(extrudeProfile(wallOuter, holesCW, zStart, zEnd, ax));
          };

          const spanX = w - 2 * cr - 2 * gap;
          const spanZ = len - 2 * cr - 2 * gap;
          buildCutoutWall('front', spanX, len * 0.5 - wt, len * 0.5, 'z');
          buildCutoutWall('back', spanX, -len * 0.5, -len * 0.5 + wt, 'z');
          buildCutoutWall('right', spanZ, w * 0.5 - wt, w * 0.5, 'x');
          buildCutoutWall('left', spanZ, -w * 0.5, -w * 0.5 + wt, 'x');
        } else if (ventSlots > 0 && baseH > wt * 4) {
          // Split wall into lower solid collar + upper vented bands + top rim
          const vY0 = yWall0;
          const vLow = vY0 + (baseH - vY0) * 0.25;
          const vHigh = vY0 + (baseH - vY0) * 0.78;
          parts.push(
            extrudeProfile(outerLoop, [innerLoopCW], vY0, vLow, 'y'),
            extrudeProfile(outerLoop, [innerLoopCW], vHigh, baseH, 'y'),
          );
          // Front/back solid walls + slotted left/right pillars
          const bandH = vHigh - vLow - 2 * gap;
          if (bandH > wt * 0.4) {
            const bandMid = (vLow + vHigh) * 0.5;
            const spanZ = len - 2 * cr;
            parts.push(
              buildBox(0, bandMid, (len - wt) * 0.5, w - 2 * cr, bandH, wt),
              buildBox(0, bandMid, -(len - wt) * 0.5, w - 2 * cr, bandH, wt),
            );
            const postCount = ventSlots + 1;
            const slotPitch = spanZ / postCount;
            const pillarZ = slotPitch * 0.52;
            for (let i = 0; i < postCount; i++) {
              const pz = -spanZ * 0.5 + (i + 0.5) * slotPitch;
              parts.push(
                buildBox((w - wt) * 0.5, bandMid, pz, wt, bandH, pillarZ),
                buildBox(-(w - wt) * 0.5, bandMid, pz, wt, bandH, pillarZ),
              );
            }
          }
        } else {
          // Continuous perimeter shell wall
          parts.push(
            extrudeProfile(outerLoop, [innerLoopCW], yWall0, baseH, 'y'),
          );
        }

        // Internal corner lid screw bosses + PCB mounting standoffs
        if (options.cornerBosses !== false) {
          const bossR = wt * 1.35;
          const boreR = wt * 0.52;
          const bx = w * 0.5 - wt - bossR * 1.05;
          const bz = len * 0.5 - wt - bossR * 1.05;
          const bossTop = baseH - wt * 0.4;
          if (bx > bossR && bz > bossR && bossTop > wt + gap * 4) {
            for (const sx of [-bx, bx]) {
              for (const sz of [-bz, bz]) {
                const bOuter = makeCircleCW(sx, -sz, bossR, 12).reverse();
                const bHole = makeCircleCW(sx, -sz, boreR, 10);
                parts.push(
                  extrudeProfile(bOuter, [bHole], wt + gap * 2, bossTop, 'y'),
                );
              }
            }
          }
        }
        if (options.pcbStandoffs !== false) {
          const stR = wt * 1.15;
          const stBore = wt * 0.48;
          const stH = Math.min(baseH * 0.32, wt * 2.6);
          const sx0 = w * 0.3 - stR;
          const sz0 = len * 0.28 - stR;
          if (sx0 > stR && sz0 > stR && wt + gap * 3 + stH < baseH) {
            for (const sx of [-sx0, sx0]) {
              for (const sz of [-sz0, sz0]) {
                const sOuter = makeCircleCW(sx, -sz, stR, 12).reverse();
                const sHole = makeCircleCW(sx, -sz, stBore, 10);
                parts.push(
                  extrudeProfile(
                    sOuter,
                    [sHole],
                    wt + gap * 2,
                    wt + gap * 2 + stH,
                    'y',
                  ),
                );
              }
            }
          }
        }

        if (part === 'closed') {
          parts.push(extrudeProfile(outerLoop, [], baseH + gap, h, 'y'));
        }
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -totalH * 0.5, 0);

      applyBuffers(this, merged, 'EnclosureGeometry', {
        part,
        width: w,
        length: len,
        height: totalH,
      });
    }
  }

  // --- 3. HeatsinkGeometry ---
  class HeatsinkGeometry extends BufferGeometry {
    constructor(options: HeatsinkOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const w = clamp(num(options.width, 0.05 * s), 0.008 * s, 1.0 * s);
      const len = clamp(
        num(options.length ?? options.depth, 0.05 * s),
        0.008 * s,
        1.0 * s,
      );
      const h = clamp(num(options.height, 0.025 * s), 0.004 * s, 0.5 * s);
      const baseT = clamp(num(options.baseThickness, h * 0.18), 0.001 * s, h * 0.6);
      const finCount = clampInt(options.finCount, 2, MAX_FINS, 11);
      const maxFinT = (w / finCount) * 0.65;
      const finT = clamp(
        num(options.finThickness, Math.min(0.0018 * s, maxFinT)),
        0.0004 * s,
        maxFinT,
      );
      const taper = clamp(num(options.taperRatio, 0.68), 0.35, 1.0);
      const origin = options.origin ?? 'floor';

      const hW = w * 0.5;
      const tipT = finT * taper;
      const pitch = (w - finT) / (finCount - 1);

      // Single monolithic 2D cross-section in XY extruded along Z!
      const profile: Pt2[] = [
        [-hW, 0],
        [hW, 0],
        [hW, baseT],
      ];
      for (let i = finCount - 1; i >= 0; i--) {
        const cx = -hW + finT * 0.5 + i * pitch;
        const rBase = cx + finT * 0.5;
        const lBase = cx - finT * 0.5;
        const rTip = cx + tipT * 0.5;
        const lTip = cx - tipT * 0.5;
        if (i < finCount - 1) profile.push([rBase, baseT]);
        profile.push([rTip, h], [lTip, h]);
        if (i > 0) profile.push([lBase, baseT]);
      }
      profile.push([-hW, baseT]);

      const raw = extrudeProfile(profile, [], -len * 0.5, len * 0.5, 'z');
      if (origin === 'center') xformRaw(raw, 0, -h * 0.5, 0);

      applyBuffers(this, raw, 'HeatsinkGeometry', {
        width: w,
        length: len,
        height: h,
        finCount,
      });
    }
  }

  // --- 4. DinRailGeometry ---
  class DinRailGeometry extends BufferGeometry {
    constructor(options: DinRailOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const profKind = options.profile ?? 'ts35x7.5';
      const len = clamp(num(options.length, 0.16 * s), 0.02 * s, 2.5 * s);
      const slotted = options.slotted !== false;

      const totalW = (profKind === 'ts15' ? 0.015 : 0.035) * s;
      const totalH =
        (profKind === 'ts35x15' ? 0.015 : profKind === 'ts15' ? 0.0055 : 0.0075) *
        s;
      const t = clamp(
        num(options.thickness, (profKind === 'ts35x15' ? 0.0015 : 0.001) * s),
        0.0005 * s,
        totalH * 0.25,
      );
      const lipW = (profKind === 'ts15' ? 0.003 : 0.005) * s;
      const hW = totalW * 0.5;
      const innerHW = hW - lipW;

      if (!slotted) {
        // Monolithic top-hat cross-section in XY extruded along Z
        const profile: Pt2[] = [
          [-innerHW, 0],
          [innerHW, 0],
          [innerHW, totalH - t],
          [hW, totalH - t],
          [hW, totalH],
          [innerHW - t, totalH],
          [innerHW - t, t],
          [-innerHW + t, t],
          [-innerHW + t, totalH],
          [-hW, totalH],
          [-hW, totalH - t],
          [-innerHW, totalH - t],
        ];
        const raw = extrudeProfile(profile, [], -len * 0.5, len * 0.5, 'z');
        applyBuffers(this, raw, 'DinRailGeometry', {
          profile: profKind,
          length: len,
          slotted: false,
        });
        return;
      }

      // Slotted DIN rail: perforated bottom web (extruded along Y with oval holes) + two L-lip side rails
      const webW = (innerHW - t) * 2;
      const webOuter: Pt2[] = [
        [-webW * 0.5, -len * 0.5],
        [webW * 0.5, -len * 0.5],
        [webW * 0.5, len * 0.5],
        [-webW * 0.5, len * 0.5],
      ];
      const slotPitch = (profKind === 'ts15' ? 0.012 : 0.025) * s;
      const slotLen = (profKind === 'ts15' ? 0.008 : 0.018) * s;
      const slotW = Math.min(webW * 0.55, (profKind === 'ts15' ? 0.0042 : 0.0062) * s);
      const slotCount = clamp(Math.floor((len - 0.008 * s) / slotPitch), 0, MAX_HOLES);
      const slotHoles: Pt2[][] = [];
      for (let i = 0; i < slotCount; i++) {
        const cz = (i - (slotCount - 1) * 0.5) * slotPitch;
        const slotCCW = makeRoundedRectCCW(slotW, slotLen, slotW * 0.48, 4);
        for (const p of slotCCW) p[1] += cz;
        slotHoles.push(slotCCW.reverse());
      }

      const gap = 3e-5 * s;
      const rightSide: Pt2[] = [
        [innerHW - t + gap, 0],
        [innerHW, 0],
        [innerHW, totalH - t],
        [hW, totalH - t],
        [hW, totalH],
        [innerHW - t + gap, totalH],
      ];
      const leftSide: Pt2[] = [
        [-innerHW, 0],
        [-innerHW + t - gap, 0],
        [-innerHW + t - gap, totalH],
        [-hW, totalH],
        [-hW, totalH - t],
        [-innerHW, totalH - t],
      ];

      const merged = mergeRaw([
        extrudeProfile(webOuter, slotHoles, 0, t, 'y'),
        extrudeProfile(rightSide, [], -len * 0.5, len * 0.5, 'z'),
        extrudeProfile(leftSide, [], -len * 0.5, len * 0.5, 'z'),
      ]);
      applyBuffers(this, merged, 'DinRailGeometry', {
        profile: profKind,
        length: len,
        slotted: true,
      });
    }
  }

  // --- 5. IcPackageGeometry ---
  class IcPackageGeometry extends BufferGeometry {
    constructor(options: IcPackageOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const spec = jedecPackageSpec(options.preset ?? 'SOIC-8', s);
      const kind = options.kind ?? (options.preset ? spec.kind : 'soic');
      const bw = clamp(num(options.bodyWidth, spec.bodyWidth), 0.001 * s, 0.2 * s);
      const bl = clamp(num(options.bodyLength, spec.bodyLength), 0.001 * s, 0.2 * s);
      const bh = clamp(num(options.bodyHeight, spec.bodyHeight), 0.0005 * s, 0.1 * s);
      const pitch = clamp(num(options.pitch, spec.pitch), 0.00035 * s, 0.02 * s);
      const origin = options.origin ?? 'board';

      const parts: RawBufs[] = [];
      let totalH = bh;

      if (kind === 'to220') {
        // Vertical TO-220 power package: 3 vertical leads + plastic body + metal heatsink tab with M3 hole
        const leadLen = 0.0065 * s;
        const leadW = 0.0008 * s;
        const leadT = 0.0005 * s;
        const bodyY0 = leadLen;
        const tabT = 0.0013 * s;
        const tabH = bh * 0.65;
        for (let i = -1; i <= 1; i++) {
          parts.push(
            buildBox(i * 0.00254 * s, leadLen * 0.5, 0, leadW, leadLen + 0.0002 * s, leadT),
          );
        }
        parts.push(
          buildBox(0, bodyY0 + 0.0003 * s + bh * 0.5, 0, bw, bh, bl),
        );
        // Metal heatsink tab at back (`z = -bl*0.5 - tabT*0.5 - gap`) with mounting hole
        const tabZ = -bl * 0.5 - tabT * 0.5 - 5e-5 * s;
        const tabY0 = bodyY0 + bh * 0.35;
        const tabY1 = bodyY0 + bh + tabH;
        const tabOuter: Pt2[] = [
          [-bw * 0.5, tabY0],
          [bw * 0.5, tabY0],
          [bw * 0.5, tabY1 - bw * 0.12],
          [bw * 0.38, tabY1],
          [-bw * 0.38, tabY1],
          [-bw * 0.5, tabY1 - bw * 0.12],
        ];
        const holeY = tabY1 - tabH * 0.42;
        const holeR = Math.min(bw * 0.18, 0.0018 * s);
        parts.push(
          extrudeProfile(
            tabOuter,
            [makeCircleCW(0, holeY, holeR, 16)],
            tabZ - tabT * 0.5,
            tabZ + tabT * 0.5,
            'z',
          ),
        );
        totalH = tabY1;
      } else if (kind === 'bga') {
        const rawPins = clampInt(options.pinCount, 4, MAX_PINS, 64);
        const side = clamp(Math.round(Math.sqrt(rawPins)), 2, 16);
        const ballR = Math.min(pitch * 0.32, 0.00035 * s);
        const stand = ballR * 1.55;
        const subT = bh * 0.28;
        // Solder balls (`y ∈ [0, 2*ballR]`), substrate (`[stand + gap, ...]`), molded die cap
        for (let ix = 0; ix < side; ix++) {
          const bx = (ix - (side - 1) * 0.5) * pitch;
          for (let iz = 0; iz < side; iz++) {
            const bz = (iz - (side - 1) * 0.5) * pitch;
            parts.push(buildSphere(bx, ballR, bz, ballR, 10, 6));
          }
        }
        const ySub0 = stand + ballR * 0.6;
        parts.push(
          buildBox(0, ySub0 + subT * 0.5, 0, bw, subT, bl),
          buildBox(
            0,
            ySub0 + subT + 4e-5 * s + (bh - subT) * 0.5,
            0,
            bw * 0.88,
            bh - subT,
            bl * 0.88,
          ),
        );
        totalH = ySub0 + bh;
      } else if (kind === 'qfn') {
        const pins = clampInt(options.pinCount, 8, MAX_PINS, 24);
        const perSide = Math.max(2, Math.floor(pins / 4));
        const padT = 0.00018 * s;
        const padW = pitch * 0.52;
        const padL = Math.min(bw, bl) * 0.12;
        // Central exposed thermal pad + perimeter wettable flank pads + molded body above
        parts.push(
          buildBox(0, padT * 0.5, 0, bw * 0.52, padT, bl * 0.52),
          buildBox(0, padT + 4e-5 * s + bh * 0.5, 0, bw, bh, bl),
        );
        for (let sideIdx = 0; sideIdx < 4; sideIdx++) {
          for (let i = 0; i < perSide; i++) {
            const off = (i - (perSide - 1) * 0.5) * pitch;
            const pad = buildBox(
              (bw - padL + 8e-5 * s) * 0.5,
              padT * 0.5,
              off,
              padL,
              padT,
              padW,
            );
            if (sideIdx > 0) xformRaw(pad, 0, 0, 0, (sideIdx * Math.PI) / 2);
            parts.push(pad);
          }
        }
        // Pin-1 corner marker boss on top
        parts.push(
          buildBox(
            -bw * 0.34,
            padT + bh + 8e-5 * s,
            -bl * 0.34,
            bw * 0.1,
            0.0001 * s,
            bl * 0.1,
          ),
        );
        totalH = padT + bh;
      } else if (kind === 'dip') {
        const pins = clampInt(options.pinCount, 4, MAX_PINS, spec.kind === 'dip' ? spec.pinCount : 8);
        const perSide = Math.max(2, Math.floor(pins / 2));
        const rowSpan = Math.max(bw + 0.0012 * s, spec.leadSpan);
        const stand = 0.0006 * s;
        const pinTail = 0.003 * s;
        const bodyLen = Math.max(bl, (perSide - 0.2) * pitch);
        parts.push(buildBox(0, stand + bh * 0.5, 0, bw, bh, bodyLen));
        // Pin-1 top marker boss
        parts.push(
          buildBox(
            -bw * 0.28,
            stand + bh + 8e-5 * s,
            -(perSide - 1) * 0.5 * pitch,
            bw * 0.14,
            0.00012 * s,
            bw * 0.14,
          ),
        );
        const shoulderY = stand + bh * 0.48;
        const leadT = 0.0003 * s;
        const leadW = Math.min(pitch * 0.48, 0.0006 * s);
        const xIn = bw * 0.5 + 4e-5 * s;
        const xOut = rowSpan * 0.5;
        const dipLeadProf: Pt2[] = [
          [xIn, shoulderY - leadT * 0.5],
          [xOut - leadT * 0.5, shoulderY - leadT * 0.5],
          [xOut - leadT * 0.5, -pinTail],
          [xOut + leadT * 0.5, -pinTail],
          [xOut + leadT * 0.5, shoulderY + leadT * 0.5],
          [xIn, shoulderY + leadT * 0.5],
        ];
        for (let i = 0; i < perSide; i++) {
          const pz = (i - (perSide - 1) * 0.5) * pitch;
          const rightL = extrudeProfile(
            dipLeadProf,
            [],
            pz - leadW * 0.5,
            pz + leadW * 0.5,
            'z',
          );
          const leftL = extrudeProfile(
            dipLeadProf,
            [],
            -pz - leadW * 0.5,
            -pz + leadW * 0.5,
            'z',
          );
          xformRaw(leftL, 0, 0, 0, Math.PI);
          parts.push(rightL, leftL);
        }
        totalH = stand + bh;
      } else if (kind === 'sot23') {
        // Asymmetric 3-lead SOT-23 SMD transistor/regulator: 2 leads on -X, 1 center lead on +X
        const stand = 0.00012 * s;
        parts.push(buildBox(0, stand + bh * 0.5, 0, bw, bh, bl));
        const wingSpan = Math.max(0.00055 * s, (spec.leadSpan - bw) * 0.5);
        const leadT = Math.min(0.00016 * s, bh * 0.18);
        const leadW = Math.min(pitch * 0.44, 0.00042 * s);
        const shY = stand + bh * 0.48;
        const x0 = bw * 0.5 + 4e-5 * s;
        const x1 = x0 + wingSpan * 0.35;
        const x2 = x0 + wingSpan * 0.62;
        const x3 = x0 + wingSpan;
        const sotWing: Pt2[] = [
          [x0, shY - leadT * 0.5],
          [x1 - leadT * 0.4, shY - leadT * 0.5],
          [x2, 0],
          [x3, 0],
          [x3, leadT],
          [x2 + leadT * 0.4, leadT],
          [x1, shY + leadT * 0.5],
          [x0, shY + leadT * 0.5],
        ];
        // Center drain/collector pin on +X (pin 3)
        parts.push(
          extrudeProfile(sotWing, [], -leadW * 0.5, leadW * 0.5, 'z'),
        );
        // Twin outer base/emitter pins on -X (pins 1 & 2)
        const zOff = Math.min(pitch, bl * 0.36);
        for (const sz of [-zOff, zOff]) {
          const lLead = extrudeProfile(
            sotWing,
            [],
            -sz - leadW * 0.5,
            -sz + leadW * 0.5,
            'z',
          );
          xformRaw(lLead, 0, 0, 0, Math.PI);
          parts.push(lLead);
        }
        totalH = stand + bh;
      } else if (kind === 'd2pak') {
        // TO-263 / D2PAK surface-mount power MOSFET/regulator: copper thermal tab + epoxy body + 2 gull-wings + center tab stub
        const bodyX = bl;
        const bodyZ = bw;
        const tabT = Math.min(0.0012 * s, bh * 0.28);
        const stick = Math.max(0.0016 * s, bodyX * 0.16);
        const hzMain = bodyZ * 0.46;
        const hzTip = bodyZ * 0.34;
        const tabOuter: Pt2[] = [
          [-bodyX * 0.5 - stick, -hzTip],
          [-bodyX * 0.5, -hzMain],
          [bodyX * 0.38, -hzMain],
          [bodyX * 0.38, hzMain],
          [-bodyX * 0.5, hzMain],
          [-bodyX * 0.5 - stick, hzTip],
        ];
        parts.push(extrudeProfile(tabOuter, [], 0, tabT, 'y'));

        const bodyY0 = tabT + 5e-5 * s;
        const moldedH = Math.max(0.001 * s, bh - tabT);
        parts.push(buildBox(0, bodyY0 + moldedH * 0.5, 0, bodyX, moldedH, bodyZ));

        const wingSpan = Math.max(0.0045 * s, (spec.leadSpan - bodyX) * 0.55);
        const leadT = Math.min(0.00045 * s, moldedH * 0.2);
        const leadW = Math.min(pitch * 0.36, 0.0009 * s);
        const shY = bodyY0 + moldedH * 0.42;
        const x0 = bodyX * 0.5 + 5e-5 * s;
        const x1 = x0 + wingSpan * 0.35;
        const x2 = x0 + wingSpan * 0.65;
        const x3 = x0 + wingSpan;
        const d2Wing: Pt2[] = [
          [x0, shY - leadT * 0.5],
          [x1 - leadT * 0.4, shY - leadT * 0.5],
          [x2, 0],
          [x3, 0],
          [x3, leadT],
          [x2 + leadT * 0.4, leadT],
          [x1, shY + leadT * 0.5],
          [x0, shY + leadT * 0.5],
        ];
        const zPin = Math.min(pitch, bodyZ * 0.36);
        for (const pz of [-zPin, zPin]) {
          parts.push(
            extrudeProfile(d2Wing, [], pz - leadW * 0.5, pz + leadW * 0.5, 'z'),
          );
        }
        // Center clipped drain stub pin
        parts.push(
          buildBox(x0 + wingSpan * 0.14, shY, 0, wingSpan * 0.28, leadT, leadW),
        );
        totalH = bodyY0 + moldedH;
      } else {
        // 'soic' (2-sided gull-wing) or 'qfp' (4-sided gull-wing)
        const isQuad = kind === 'qfp';
        const defaultPins = isQuad ? 32 : 8;
        const pins = clampInt(
          options.pinCount,
          isQuad ? 12 : 4,
          MAX_PINS,
          spec.kind === kind ? spec.pinCount : defaultPins,
        );
        const sides = isQuad ? 4 : 2;
        const perSide = Math.max(2, Math.floor(pins / sides));
        const stand = 0.00018 * s;
        const bodyW = isQuad ? Math.max(bw, (perSide + 1.4) * pitch) : bw;
        const bodyL = Math.max(bl, (perSide + (isQuad ? 1.4 : 0.4)) * pitch);

        parts.push(buildBox(0, stand + bh * 0.5, 0, bodyW, bh, bodyL));
        parts.push(
          buildBox(
            -bodyW * 0.34,
            stand + bh + 7e-5 * s,
            -bodyL * 0.34,
            Math.min(bodyW, bodyL) * 0.1,
            0.0001 * s,
            Math.min(bodyW, bodyL) * 0.1,
          ),
        );

        const wingSpan = Math.max(0.0009 * s, (spec.leadSpan - spec.bodyWidth) * 0.5);
        const leadT = Math.min(0.0002 * s, bh * 0.18);
        const leadW = Math.min(pitch * 0.46, 0.00045 * s);
        const shY = stand + bh * 0.5;
        const makeGullWing = (halfBody: number): Pt2[] => {
          const x0 = halfBody + 3e-5 * s;
          const x1 = x0 + wingSpan * 0.35;
          const x2 = x0 + wingSpan * 0.62;
          const x3 = x0 + wingSpan;
          return [
            [x0, shY - leadT * 0.5],
            [x1 - leadT * 0.4, shY - leadT * 0.5],
            [x2, 0],
            [x3, 0],
            [x3, leadT],
            [x2 + leadT * 0.4, leadT],
            [x1, shY + leadT * 0.5],
            [x0, shY + leadT * 0.5],
          ];
        };

        const profX = makeGullWing(bodyW * 0.5);
        for (let i = 0; i < perSide; i++) {
          const pz = (i - (perSide - 1) * 0.5) * pitch;
          const rLead = extrudeProfile(profX, [], pz - leadW * 0.5, pz + leadW * 0.5, 'z');
          const lLead = extrudeProfile(profX, [], -pz - leadW * 0.5, -pz + leadW * 0.5, 'z');
          xformRaw(lLead, 0, 0, 0, Math.PI);
          parts.push(rLead, lLead);
        }
        if (isQuad) {
          const profZ = makeGullWing(bodyL * 0.5);
          for (let i = 0; i < perSide; i++) {
            const px = (i - (perSide - 1) * 0.5) * pitch;
            const fLead = extrudeProfile(profZ, [], px - leadW * 0.5, px + leadW * 0.5, 'z');
            const bLead = extrudeProfile(profZ, [], -px - leadW * 0.5, -px + leadW * 0.5, 'z');
            xformRaw(fLead, 0, 0, 0, -Math.PI * 0.5);
            xformRaw(bLead, 0, 0, 0, Math.PI * 0.5);
            parts.push(fLead, bLead);
          }
        }
        totalH = stand + bh;
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -totalH * 0.5, 0);

      applyBuffers(this, merged, 'IcPackageGeometry', {
        kind,
        bodyWidth: bw,
        bodyLength: bl,
        bodyHeight: totalH,
      });
    }
  }

  // --- 6. PinHeaderGeometry ---
  class PinHeaderGeometry extends BufferGeometry {
    constructor(options: PinHeaderOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const gender = options.gender ?? 'male';
      const rows = clampInt(options.rows, 1, 2, gender === 'shrouded' ? 2 : 1);
      const cols = clampInt(options.cols, 1, 40, gender === 'shrouded' ? 5 : 8);
      const pitch = clamp(num(options.pitch, 0.00254 * s), 0.0008 * s, 0.02 * s);
      const rightAngle = options.rightAngle === true;

      const pinW = pitch * 0.25;
      const tailLen = pitch * 1.2;
      const parts: RawBufs[] = [];

      if (gender === 'female') {
        // Tall female receptacle strip with recessed entry pockets + bottom solder tails
        const bodyH = pitch * 3.35;
        const bodyW = rows * pitch + 0.0004 * s;
        const bodyL = cols * pitch + 0.0004 * s;
        const outer = makeRoundedRectCCW(bodyL, bodyW, 0.0002 * s, 2);
        const holes: Pt2[][] = [];
        const pocket = pitch * 0.44;
        for (let r = 0; r < rows; r++) {
          const rz = (r - (rows - 1) * 0.5) * pitch;
          for (let c = 0; c < cols; c++) {
            const cx = (c - (cols - 1) * 0.5) * pitch;
            holes.push([
              [cx - pocket * 0.5, -rz - pocket * 0.5],
              [cx - pocket * 0.5, -rz + pocket * 0.5],
              [cx + pocket * 0.5, -rz + pocket * 0.5],
              [cx + pocket * 0.5, -rz - pocket * 0.5],
            ]);
          }
        }
        parts.push(
          extrudeProfile(outer, [], 0, bodyH * 0.28, 'y'),
          extrudeProfile(outer, holes, bodyH * 0.28 + 3e-5 * s, bodyH, 'y'),
        );
        for (let r = 0; r < rows; r++) {
          const rz = (r - (rows - 1) * 0.5) * pitch;
          for (let c = 0; c < cols; c++) {
            const cx = (c - (cols - 1) * 0.5) * pitch;
            parts.push(
              buildBox(cx, -tailLen * 0.5 - 3e-5 * s, rz, pinW, tailLen, pinW * 0.65),
            );
          }
        }
      } else {
        // 'male' or 'shrouded' IDC header
        const insH = pitch * 1.0;
        const postH = pitch * 2.35;
        if (gender === 'shrouded') {
          const shW = rows * pitch + pitch * 1.5;
          const shL = cols * pitch + pitch * 3.0;
          const shH = pitch * 3.5;
          const wall = pitch * 0.45;
          // Base floor + notched perimeter shroud wall
          const outer = makeRoundedRectCCW(shL, shW, 0.0004 * s, 3);
          const innerCW = makeRoundedRectCCW(shL - 2 * wall, shW - 2 * wall, 0.0002 * s, 2).reverse();
          parts.push(
            extrudeProfile(outer, [], 0, insH, 'y'),
            extrudeProfile(outer, [innerCW], insH + 3e-5 * s, shH, 'y'),
          );
        } else {
          parts.push(
            buildBox(0, insH * 0.5, 0, cols * pitch, insH, rows * pitch),
          );
        }

        for (let r = 0; r < rows; r++) {
          const rz = (r - (rows - 1) * 0.5) * pitch;
          for (let c = 0; c < cols; c++) {
            const cx = (c - (cols - 1) * 0.5) * pitch;
            if (rightAngle && gender === 'male') {
              // 90-degree bent pin: vertical tail up to bendY, horizontal leg toward +Z
              const bendY = insH + pitch * 0.4 + r * pitch * 0.65;
              const legZ = rows * pitch * 0.5 + postH;
              const lProf: Pt2[] = [
                [rz - pinW * 0.5, -tailLen],
                [rz + pinW * 0.5, -tailLen],
                [rz + pinW * 0.5, bendY - pinW * 0.5],
                [legZ, bendY - pinW * 0.5],
                [legZ, bendY + pinW * 0.5],
                [rz - pinW * 0.5, bendY + pinW * 0.5],
              ];
              // Extrude in YZ plane along X (`axis = 'x'` maps `u = -z, v = y, w = x` -> negate u!)
              const mapped = lProf.map(([zCoord, yCoord]): Pt2 => [-zCoord, yCoord]);
              parts.push(
                extrudeProfile(mapped, [], cx - pinW * 0.5, cx + pinW * 0.5, 'x'),
              );
            } else {
              parts.push(
                buildBox(
                  cx,
                  insH + 3e-5 * s + postH * 0.5,
                  rz,
                  pinW,
                  postH,
                  pinW,
                ),
                buildBox(
                  cx,
                  -tailLen * 0.5 - 3e-5 * s,
                  rz,
                  pinW,
                  tailLen,
                  pinW,
                ),
              );
            }
          }
        }
      }

      applyBuffers(this, mergeRaw(parts), 'PinHeaderGeometry', {
        gender,
        rows,
        cols,
        pitch,
        rightAngle,
      });
    }
  }

  // --- 7. ConnectorGeometry ---
  class ConnectorGeometry extends BufferGeometry {
    constructor(options: ConnectorOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const kind = options.kind ?? 'usb-c';
      const origin = options.origin ?? 'board';
      const gap = 4e-5 * s;
      const parts: RawBufs[] = [];
      let totalH = 0.005 * s;

      if (kind === 'usb-c' || kind === 'usb-a') {
        const isC = kind === 'usb-c';
        const shW = (isC ? 0.00894 : 0.0132) * s;
        const shH = (isC ? 0.00326 : 0.0057) * s;
        const shD = (isC ? 0.0073 : 0.014) * s;
        const wall = (isC ? 0.00035 : 0.00045) * s;
        const cr = isC ? shH * 0.48 : 0.0005 * s;
        const backT = 0.0012 * s;

        const outer = makeRoundedRectCCW(shW, shH, cr, isC ? 6 : 2);
        const innerCW = makeRoundedRectCCW(
          shW - 2 * wall,
          shH - 2 * wall,
          Math.max(0, cr - wall),
          isC ? 6 : 2,
        ).reverse();
        for (const p of outer) p[1] += shH * 0.5;
        for (const p of innerCW) p[1] += shH * 0.5;

        // Solid rear insulator cap + hollow front receptacle shell + internal contact tongue
        parts.push(
          extrudeProfile(outer, [], -shD * 0.5, -shD * 0.5 + backT, 'z'),
          extrudeProfile(
            outer,
            [innerCW],
            -shD * 0.5 + backT + gap,
            shD * 0.5,
            'z',
          ),
          buildBox(
            0,
            isC ? shH * 0.5 : shH * 0.64,
            gap * 2,
            shW - wall * 4.2,
            isC ? 0.00065 * s : 0.0014 * s,
            shD - backT * 2,
          ),
        );
        // Side PCB shield tabs
        const tabH = 0.0012 * s;
        for (const sx of [-shW * 0.5 - 0.00025 * s, shW * 0.5 + 0.00025 * s]) {
          parts.push(buildBox(sx, -tabH * 0.5, 0, 0.0004 * s, tabH, 0.0018 * s));
        }
        totalH = shH;
      } else if (kind === 'rj45') {
        // 8P8C Modular Ethernet Jack (`16 x 13.5 x 21.5 mm`)
        const jW = 0.016 * s;
        const jH = 0.0135 * s;
        const jD = 0.0215 * s;
        const outer: Pt2[] = [
          [-jW * 0.5, 0],
          [jW * 0.5, 0],
          [jW * 0.5, jH],
          [-jW * 0.5, jH],
        ];
        // Stepped 8P8C plug + latch cutout on +Z front
        const cavW = 0.0118 * s;
        const cavH = 0.0068 * s;
        const latW = 0.0062 * s;
        const latH = 0.0022 * s;
        const y0 = 0.0022 * s;
        const plugCW: Pt2[] = [
          [-cavW * 0.5, y0 + latH],
          [-cavW * 0.5, y0 + latH + cavH],
          [cavW * 0.5, y0 + latH + cavH],
          [cavW * 0.5, y0 + latH],
          [latW * 0.5, y0 + latH],
          [latW * 0.5, y0],
          [-latW * 0.5, y0],
          [-latW * 0.5, y0 + latH],
        ];
        parts.push(
          extrudeProfile(outer, [], -jD * 0.5, -jD * 0.1, 'z'),
          extrudeProfile(outer, [plugCW], -jD * 0.1 + gap, jD * 0.5, 'z'),
        );
        // Bottom PCB guide posts + 8 staggered signal pins
        for (let i = 0; i < 8; i++) {
          const px = (i - 3.5) * 0.00127 * s;
          const pz = -jD * 0.25 + (i % 2) * 0.00254 * s;
          parts.push(
            buildBox(px, -0.0016 * s, pz, 0.00045 * s, 0.003 * s, 0.00045 * s),
          );
        }
        totalH = jH;
      } else if (kind === 'barrel-jack') {
        // 2.1x5.5mm DC Barrel Power Jack (`9 x 11 x 14.5 mm`)
        const bW = 0.009 * s;
        const bH = 0.011 * s;
        const bD = 0.0145 * s;
        const outer: Pt2[] = [
          [-bW * 0.5, 0],
          [bW * 0.5, 0],
          [bW * 0.5, bH],
          [-bW * 0.5, bH],
        ];
        const boreY = bH * 0.52;
        const boreR = 0.0031 * s;
        parts.push(
          extrudeProfile(outer, [], -bD * 0.5, -bD * 0.12, 'z'),
          extrudeProfile(
            outer,
            [makeCircleCW(0, boreY, boreR, 18)],
            -bD * 0.12 + gap,
            bD * 0.5,
            'z',
          ),
          // Center contact pin along +Z
          xformRaw(
            revolveClosedProfile(
              [
                [0, -bD * 0.1],
                [0.001 * s, -bD * 0.1],
                [0.001 * s, bD * 0.42],
                [0, bD * 0.42],
              ],
              16,
              'z',
            ),
            0,
            boreY,
            0,
          ),
        );
        totalH = bH;
      } else if (kind === 'sma') {
        // Edge-launch / vertical brass SMA coaxial connector along +Z
        const blk = 0.00635 * s;
        const blkD = 0.004 * s;
        const brlLen = 0.0075 * s;
        const brlR = 0.0031 * s;
        const boreR = 0.0021 * s;
        parts.push(buildBox(0, blk * 0.5, -blkD * 0.5, blk, blk, blkD));
        // Cylindrical threaded barrel with hollow PTFE/air pocket + gold center socket
        const brlProf: Pt2[] = [
          [0, gap],
          [brlR, gap],
          [brlR, brlLen],
          [boreR, brlLen],
          [boreR, brlLen * 0.3],
          [0, brlLen * 0.3],
        ];
        const pinProf: Pt2[] = [
          [0, brlLen * 0.32],
          [0.00065 * s, brlLen * 0.32],
          [0.00065 * s, brlLen * 0.92],
          [0, brlLen * 0.92],
        ];
        parts.push(
          xformRaw(revolveClosedProfile(brlProf, 24, 'z'), 0, blk * 0.5, 0),
          xformRaw(revolveClosedProfile(pinProf, 14, 'z'), 0, blk * 0.5, 0),
        );
        // 4 corner PCB straddle legs
        for (const sx of [-blk * 0.38, blk * 0.38]) {
          parts.push(
            buildBox(sx, 0.0006 * s, -blkD - 0.0018 * s - gap, 0.001 * s, 0.0012 * s, 0.0036 * s),
          );
        }
        totalH = blk;
      } else if (kind === 'hdmi') {
        // Standard HDMI Type-A 19-pin beveled D-shell receptacle (`15.0 x 5.5 x 11.5 mm`)
        const hW = 0.0075 * s;
        const shH = 0.0055 * s;
        const shD = 0.0115 * s;
        const wall = 0.00045 * s;
        const backT = 0.0014 * s;
        const makeHdmiLoop = (inset: number): Pt2[] => {
          const wTop = hW - inset;
          const wBot = hW * 0.72 - inset * 0.7;
          const y0 = inset;
          const y1 = shH * 0.38 + inset * 0.35;
          const y2 = shH - inset;
          return [
            [-wBot, y0],
            [wBot, y0],
            [wTop, y1],
            [wTop, y2],
            [-wTop, y2],
            [-wTop, y1],
          ];
        };
        const outer = makeHdmiLoop(0);
        const innerCW = makeHdmiLoop(wall).reverse();
        parts.push(
          extrudeProfile(outer, [], -shD * 0.5, -shD * 0.5 + backT, 'z'),
          extrudeProfile(
            outer,
            [innerCW],
            -shD * 0.5 + backT + gap,
            shD * 0.5,
            'z',
          ),
          buildBox(
            0,
            shH * 0.56,
            gap * 2,
            (hW - wall * 2.4) * 1.5,
            0.0008 * s,
            shD - backT * 2.2,
          ),
        );
        for (const sx of [-hW - 0.00025 * s, hW + 0.00025 * s]) {
          for (const sz of [-shD * 0.26, shD * 0.26]) {
            parts.push(
              buildBox(sx, -0.0006 * s, sz, 0.0004 * s, 0.0012 * s, 0.0016 * s),
            );
          }
        }
        totalH = shH;
      } else if (kind === 'microsd') {
        // Low-profile push-push SMD microSD card socket (`14.0 x 1.85 x 14.5 mm`)
        const sdW = 0.014 * s;
        const sdH = 0.00185 * s;
        const sdD = 0.0145 * s;
        const wall = 0.0003 * s;
        const floorT = 0.00035 * s;
        const backD = 0.0018 * s;
        const hW = sdW * 0.5;
        const lip = 0.0012 * s;
        parts.push(
          buildBox(0, sdH * 0.5, -sdD * 0.5 + backD * 0.5, sdW, sdH, backD),
        );
        const cageProf: Pt2[] = [
          [-hW, 0],
          [-hW + lip, 0],
          [-hW + lip, floorT],
          [-hW + wall, floorT],
          [-hW + wall, sdH - wall],
          [hW - wall, sdH - wall],
          [hW - wall, floorT],
          [hW - lip, floorT],
          [hW - lip, 0],
          [hW, 0],
          [hW, sdH],
          [-hW, sdH],
        ];
        parts.push(
          extrudeProfile(
            cageProf,
            [],
            -sdD * 0.5 + backD + gap,
            sdD * 0.5,
            'z',
          ),
        );
        for (let i = 0; i < 8; i++) {
          const px = (i - 3.5) * 0.0011 * s;
          parts.push(
            buildBox(
              px,
              0.00012 * s,
              -sdD * 0.5 - 0.00045 * s - gap,
              0.00055 * s,
              0.00024 * s,
              0.0009 * s,
            ),
          );
        }
        totalH = sdH;
      } else if (kind === 'jst-xh') {
        // Shrouded 2.50mm-pitch wire-to-board box wafer header with twin front friction-lock slots
        const poles = clampInt(options.poles, 2, 16, 4);
        const pitch = clamp(num(options.pitch, 0.0025 * s), 0.00125 * s, 0.01 * s);
        const shW = (poles - 1) * pitch + pitch * 1.96;
        const shD = pitch * 2.3;
        const shH = pitch * 2.8;
        const wall = pitch * 0.32;
        const baseT = pitch * 0.6;
        const hX = shW * 0.5;
        const hZ = shD * 0.5;

        parts.push(buildBox(0, baseT * 0.5, 0, shW, baseT, shD));

        // U-shaped rear + side shroud wall (`v = -z`, so `+hZ` is rear `-Z`)
        const uWall: Pt2[] = [
          [-hX, -hZ],
          [-hX + wall, -hZ],
          [-hX + wall, hZ - wall],
          [hX - wall, hZ - wall],
          [hX - wall, -hZ],
          [hX, -hZ],
          [hX, hZ],
          [-hX, hZ],
        ];
        parts.push(extrudeProfile(uWall, [], baseT + gap, shH, 'y'));

        // Front +Z notched friction-lock sill + center polarizing bridge
        const upperSpan = shH - baseT;
        const sillH = upperSpan * 0.34;
        const tabH = upperSpan * 0.48;
        const tabW = Math.min(
          shW - 3.2 * wall,
          Math.max(pitch * 0.8, (poles - 1) * pitch * 0.72),
        );
        parts.push(
          buildBox(
            0,
            baseT + gap + sillH * 0.5,
            hZ - wall * 0.5,
            shW - 2 * wall - 2 * gap,
            sillH,
            wall,
          ),
          buildBox(
            0,
            baseT + sillH + 2 * gap + tabH * 0.5,
            hZ - wall * 0.5,
            tabW,
            tabH,
            wall,
          ),
        );

        const pinW = pitch * 0.256;
        const postH = shH * 0.78 - baseT;
        for (let i = 0; i < poles; i++) {
          const cx = (i - (poles - 1) * 0.5) * pitch;
          const cz = -shD * 0.08;
          parts.push(
            buildBox(
              cx,
              baseT + gap + postH * 0.5,
              cz,
              pinW,
              postH,
              pinW,
            ),
            buildBox(cx, -pitch * 0.65 - gap, cz, pinW, pitch * 1.3, pinW),
          );
        }
        totalH = shH;
      } else {
        // 'terminal-block': green PCB screw terminal block (`poles` at `5.08 mm` pitch)
        const poles = clampInt(options.poles, 2, 24, 4);
        const pitch = clamp(num(options.pitch, 0.00508 * s), 0.0025 * s, 0.02 * s);
        const tbW = poles * pitch;
        const tbH = pitch * 2.05;
        const tbD = pitch * 1.75;
        const outer: Pt2[] = [
          [-tbW * 0.5, 0],
          [tbW * 0.5, 0],
          [tbW * 0.5, tbH],
          [-tbW * 0.5, tbH],
        ];
        const wireHoles: Pt2[][] = [];
        for (let i = 0; i < poles; i++) {
          const cx = (i - (poles - 1) * 0.5) * pitch;
          wireHoles.push(makeCircleCW(cx, tbH * 0.38, pitch * 0.28, 14));
        }
        parts.push(
          extrudeProfile(outer, [], -tbD * 0.5, 0, 'z'),
          extrudeProfile(outer, wireHoles, gap, tbD * 0.5, 'z'),
        );
        for (let i = 0; i < poles; i++) {
          const cx = (i - (poles - 1) * 0.5) * pitch;
          // Recessed/raised screw head on top + bottom solder pin
          parts.push(
            xformRaw(
              revolveClosedProfile(
                [
                  [0, tbH + gap],
                  [pitch * 0.3, tbH + gap],
                  [pitch * 0.3, tbH + pitch * 0.14],
                  [0, tbH + pitch * 0.14],
                ],
                14,
                'y',
              ),
              cx,
              0,
              0,
            ),
            buildBox(cx, -pitch * 0.38 - gap, 0, pitch * 0.18, pitch * 0.75, pitch * 0.12),
          );
        }
        totalH = tbH + pitch * 0.14;
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -totalH * 0.5, 0);

      applyBuffers(this, merged, 'ConnectorGeometry', {
        kind,
        height: totalH,
      });
    }
  }

  // --- 8. StandoffSpacerGeometry ---
  class StandoffSpacerGeometry extends BufferGeometry {
    constructor(options: StandoffSpacerOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const shape = options.shape ?? 'hex';
      const threadMap: Record<string, [number, number]> = {
        M2: [0.002, 0.004],
        'M2.5': [0.0025, 0.005],
        M3: [0.003, 0.0055],
        M4: [0.004, 0.007],
        M5: [0.005, 0.008],
      };
      const tRow = threadMap[options.thread ?? 'M3'] ?? threadMap['M3'];
      const len = clamp(num(options.length, 0.01 * s), 0.002 * s, 0.2 * s);
      const af = clamp(num(options.acrossFlats, tRow[1] * s), 0.0025 * s, 0.06 * s);
      const boreD = clamp(
        num(options.boreDiameter, tRow[0] * s),
        0.0008 * s,
        af * 0.78,
      );
      const studLen = clamp(num(options.maleStudLength, 0), 0, 0.05 * s);
      const origin = options.origin ?? 'floor';

      const outer: Pt2[] = [];
      if (shape === 'round') {
        const rOut = af * 0.5;
        for (let i = 0; i < 24; i++) {
          const a = (i * TAU) / 24;
          outer.push([rOut * Math.cos(a), rOut * Math.sin(a)]);
        }
      } else {
        const rCorner = af / Math.sqrt(3);
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          outer.push([rCorner * Math.cos(a), rCorner * Math.sin(a)]);
        }
      }
      const boreHole = makeCircleCW(0, 0, boreD * 0.5, 18);

      const parts: RawBufs[] = [];
      if (studLen > 1e-5 * s) {
        // Female bottom bore (`65%` of body) + solid upper web + top male threaded stud
        const splitY = len * 0.65;
        parts.push(
          extrudeProfile(outer, [boreHole], 0, splitY, 'y'),
          extrudeProfile(outer, [], splitY + 3e-5 * s, len, 'y'),
          revolveClosedProfile(
            [
              [0, len + 3e-5 * s],
              [boreD * 0.5, len + 3e-5 * s],
              [boreD * 0.5, len + studLen - boreD * 0.08],
              [boreD * 0.4, len + studLen],
              [0, len + studLen],
            ],
            20,
            'y',
          ),
        );
      } else {
        parts.push(extrudeProfile(outer, [boreHole], 0, len, 'y'));
      }

      const totalH = len + studLen;
      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -totalH * 0.5, 0);

      applyBuffers(this, merged, 'StandoffSpacerGeometry', {
        shape,
        length: len,
        acrossFlats: af,
        boreDiameter: boreD,
        maleStudLength: studLen,
      });
    }
  }

  // --- 9. DiscreteComponentGeometry ---
  class DiscreteComponentGeometry extends BufferGeometry {
    constructor(options: DiscreteComponentOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 200);
      const kind = options.kind ?? 'smd-chip';
      const origin = options.origin ?? 'board';
      const gap = 4e-5 * s;
      const parts: RawBufs[] = [];
      let totalH = 0.001 * s;

      if (kind === 'electrolytic-cap') {
        const diam = clamp(num(options.diameter, 0.0063 * s), 0.003 * s, 0.05 * s);
        const canH = clamp(num(options.height, 0.011 * s), 0.004 * s, 0.1 * s);
        const r = diam * 0.5;
        const stand = 0.0003 * s;
        const leadLen = 0.0032 * s;
        const pitch = Math.min(diam * 0.42, 0.0025 * s);
        const y0 = stand;
        const y1 = y0 + canH;
        const canProf: Pt2[] = [
          [0, y0],
          [r * 0.92, y0],
          [r, y0 + canH * 0.05],
          [r, y0 + canH * 0.14],
          [r * 0.88, y0 + canH * 0.19],
          [r, y0 + canH * 0.24],
          [r, y1 - canH * 0.04],
          [r * 0.92, y1],
          [r * 0.72, y1],
          [r * 0.72, y1 - canH * 0.025],
          [0, y1 - canH * 0.025],
        ];
        parts.push(revolveClosedProfile(canProf, 24, 'y'));
        const leadR = Math.min(0.0003 * s, pitch * 0.22);
        const yTopLead = y0 - gap;
        for (const [lx, extra] of [
          [-pitch * 0.5, 0],
          [pitch * 0.5, 0.0008 * s],
        ] as const) {
          const yBot = -(leadLen + extra);
          parts.push(
            xformRaw(
              revolveClosedProfile(
                [
                  [0, yBot],
                  [leadR, yBot],
                  [leadR, yTopLead],
                  [0, yTopLead],
                ],
                12,
                'y',
              ),
              lx,
              0,
              0,
            ),
          );
        }
        totalH = y1;
      } else if (kind === 'tactile-switch') {
        const swW = clamp(num(options.diameter, 0.006 * s), 0.003 * s, 0.02 * s);
        const bodyH = swW * 0.58;
        const actH = clamp(
          num(options.height, swW * 0.84),
          bodyH + 0.0008 * s,
          0.03 * s,
        );
        const lowH = bodyH * 0.78;
        const capH = bodyH - lowH - gap;
        parts.push(
          buildBox(0, lowH * 0.5, 0, swW, lowH, swW),
          buildBox(
            0,
            lowH + gap + capH * 0.5,
            0,
            swW * 0.95,
            capH,
            swW * 0.95,
          ),
        );
        const plungerR = swW * 0.28;
        parts.push(
          revolveClosedProfile(
            [
              [0, bodyH + gap],
              [plungerR, bodyH + gap],
              [plungerR, actH - plungerR * 0.12],
              [plungerR * 0.88, actH],
              [0, actH],
            ],
            18,
            'y',
          ),
        );
        const leadH = 0.0018 * s;
        for (const sx of [-swW * 0.38, swW * 0.38]) {
          for (const sz of [-swW * 0.52, swW * 0.52]) {
            parts.push(
              buildBox(
                sx,
                -gap - leadH * 0.5,
                sz,
                0.0005 * s,
                leadH,
                0.0003 * s,
              ),
            );
          }
        }
        totalH = actH;
      } else if (kind === 'led-domed') {
        const diam = clamp(num(options.diameter, 0.005 * s), 0.0018 * s, 0.02 * s);
        const lensH = clamp(
          num(options.height, diam * 1.72),
          diam * 1.1,
          diam * 3.5,
        );
        const rLens = diam * 0.5;
        const rFlange = diam * 0.58;
        const flangeH = diam * 0.2;
        const stand = 0.0005 * s;
        const domeCenterY = stand + lensH - rLens;
        const domeProf: Pt2[] = [
          [0, stand],
          [rFlange, stand],
          [rFlange, stand + flangeH],
          [rLens, stand + flangeH],
        ];
        if (domeCenterY > stand + flangeH + 1e-6) {
          domeProf.push([rLens, domeCenterY]);
        }
        for (let k = 1; k <= 8; k++) {
          if (k === 8) {
            domeProf.push([0, stand + lensH]);
          } else {
            const a = (k * Math.PI * 0.5) / 8;
            domeProf.push([
              rLens * Math.cos(a),
              domeCenterY + rLens * Math.sin(a),
            ]);
          }
        }
        parts.push(revolveClosedProfile(domeProf, 24, 'y'));
        const leadX = Math.min(0.00127 * s, rLens * 0.65);
        const pinW = Math.min(0.0005 * s, rLens * 0.28);
        const yTop = stand - gap;
        for (const [lx, lBot] of [
          [-leadX, 0.004 * s],
          [leadX, 0.0052 * s],
        ] as const) {
          parts.push(
            buildBox(lx, (yTop - lBot) * 0.5, 0, pinW, yTop + lBot, pinW),
          );
        }
        totalH = stand + lensH;
      } else if (kind === 'crystal-hc49') {
        const canTop = clamp(
          num(options.height, 0.0036 * s),
          0.002 * s,
          0.015 * s,
        );
        const flangeH = Math.min(0.0007 * s, canTop * 0.28);
        parts.push(
          extrudeProfile(
            makeRoundedRectCCW(0.011 * s, 0.00465 * s, 0.0022 * s, 6),
            [],
            0,
            flangeH,
            'y',
          ),
          extrudeProfile(
            makeRoundedRectCCW(0.0102 * s, 0.0038 * s, 0.0018 * s, 6),
            [],
            flangeH + gap,
            canTop,
            'y',
          ),
        );
        const leadR = 0.00022 * s;
        for (const lx of [-0.00244 * s, 0.00244 * s]) {
          parts.push(
            xformRaw(
              revolveClosedProfile(
                [
                  [0, -0.0032 * s],
                  [leadR, -0.0032 * s],
                  [leadR, -gap],
                  [0, -gap],
                ],
                12,
                'y',
              ),
              lx,
              0,
              0,
            ),
          );
        }
        totalH = canTop;
      } else {
        // 'smd-chip': EIA 0402 / 0603 / 0805 / 1206 / 2512 surface-mount resistor / MLCC capacitor
        const smdTable: Record<string, [number, number, number]> = {
          '0402': [1.0, 0.5, 0.35],
          '0603': [1.6, 0.8, 0.45],
          '0805': [2.0, 1.25, 0.5],
          '1206': [3.2, 1.6, 0.55],
          '2512': [6.3, 3.2, 0.6],
        };
        const row = smdTable[options.package ?? '0805'] ?? smdTable['0805'];
        const L = row[0] * 1e-3 * s;
        const W = row[1] * 1e-3 * s;
        const H = clamp(
          num(options.height, row[2] * 1e-3 * s),
          0.0002 * s,
          0.02 * s,
        );
        const capL = L * 0.22;
        const bodyL = Math.max(L * 0.2, L - 2 * capL - 2 * gap);
        parts.push(
          buildBox(-(L * 0.5 - capL * 0.5), H * 0.5, 0, capL, H, W),
          buildBox(L * 0.5 - capL * 0.5, H * 0.5, 0, capL, H, W),
          buildBox(0, H * 0.46, 0, bodyL, H * 0.92, W * 0.94),
        );
        totalH = H;
      }

      const merged = mergeRaw(parts);
      if (origin === 'center') xformRaw(merged, 0, -totalH * 0.5, 0);

      applyBuffers(this, merged, 'DiscreteComponentGeometry', {
        kind,
        height: totalH,
      });
    }
  }

  const Electronics = {
    MAX_ECAD_PINS: MAX_PINS,
    MAX_ECAD_FINS: MAX_FINS,
    MAX_ECAD_HOLES: MAX_HOLES,
    MAX_ECAD_SEGMENTS: MAX_SEGS,
    jedecPackageSpec,
    PcbBoardGeometry,
    EnclosureGeometry,
    HeatsinkGeometry,
    DinRailGeometry,
    IcPackageGeometry,
    PinHeaderGeometry,
    ConnectorGeometry,
    StandoffSpacerGeometry,
    DiscreteComponentGeometry,
  };

  for (const Ctor of [
    PcbBoardGeometry,
    EnclosureGeometry,
    HeatsinkGeometry,
    DinRailGeometry,
    IcPackageGeometry,
    PinHeaderGeometry,
    ConnectorGeometry,
    StandoffSpacerGeometry,
    DiscreteComponentGeometry,
  ]) {
    try {
      Object.freeze(Ctor.prototype);
      Object.freeze(Ctor);
    } catch {
      // Ignore if host environment disallows freezing.
    }
  }
  try {
    Object.freeze(Electronics);
  } catch {
    // Ignore if host environment disallows freezing.
  }

  const exportsMap = {
    Electronics,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) reg.authorNamespace = {};
    Object.assign(reg.authorNamespace, exportsMap);
  } else {
    try {
      threeNs.Electronics = Electronics;
    } catch {
      // Frozen THREE proxy resolves via reg.authorNamespace.
    }
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` domain kit plugin registering parametric
 * electronics / ECAD / hardware geometries (`THREE.Electronics.*`).
 */
export const electronicsKitPlugin: ThreeLivePlugin = {
  name: 'kit-electronics',
  onRegister(): void {
    registerWorkerExtensionInstaller(installElectronicsKit);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installElectronicsKit(threeNs, reg);
    }
  },
};
