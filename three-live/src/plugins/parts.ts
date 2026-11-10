/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Mechanical CAD Parts Plugin (`partsPlugin` / `THREE.CAD`).
 *
 * Self-contained analytic `BufferGeometry` generators for standard machine
 * elements: involute spur gears (straight & helical), internal ring gears,
 * linear racks, multi-groove pulleys, ISO metric bolts/screws (`hex`, `socket`,
 * `countersunk`, `button`), hex/flange/nyloc nuts, chamfered washers, stepped
 * CNC shafts, deep-groove ball bearings, Bishop-frame helical springs,
 * bolt-circle mounting flanges, and structural extrusions (`t-slot`, `i-beam`,
 * `c-channel`, `l-angle`, `rect-tube`).
 *
 * NOTE: `installPartsExtension` is serialized via `Function.prototype.toString()`
 * into sandboxed Web Workers and embedded in `three-author-engine.js` for the
 * Rust/Android/iOS compiler. Keep `installPartsExtension` 100% self-contained
 * (no module-scoped runtime references inside its body, and no ES2022 class
 * field initializers).
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/** Maximum gear or rack tooth count per part. */
export const MAX_PART_TEETH = 200;
/** Maximum radial subdivision segments on revolved/extruded machine parts. */
export const MAX_PART_RADIAL_SEGMENTS = 128;
/** Maximum helical coils on a spring part. */
export const MAX_PART_COILS = 64;
/** Maximum bolt-circle / lightening hole count per part. */
export const MAX_PART_HOLES = 64;

/** Normalized ISO metric fastener dimensions (in meters unless scaled). */
export interface MetricFastenerSpec {
  readonly preset: string;
  readonly threadDiameter: number;
  readonly pitch: number;
  readonly acrossFlats: number;
  readonly hexHeadHeight: number;
  readonly socketHeadDiameter: number;
  readonly socketHeadHeight: number;
  readonly socketKeyAcrossFlats: number;
  readonly countersunkHeadDiameter: number;
  readonly countersunkHeadHeight: number;
  readonly buttonHeadDiameter: number;
  readonly buttonHeadHeight: number;
  readonly nutThickness: number;
  readonly washerInnerDiameter: number;
  readonly washerOuterDiameter: number;
  readonly washerThickness: number;
  readonly clearanceHoleDiameter: number;
  readonly length?: number;
  readonly bolt: BoltOptions;
  readonly nut: NutOptions;
  readonly washer: WasherOptions;
}

/** Kinematic meshing helper result returned by `THREE.CAD.gearMeshDistance`. */
export interface GearMeshInfo {
  readonly centerDistance: number;
  readonly ratio: number;
  readonly phaseOffsetRad: number;
  valueOf(): number;
}

/** Options for `THREE.CAD.SpurGearGeometry`. */
export interface SpurGearOptions {
  module?: number;
  teeth?: number;
  pressureAngleDeg?: number;
  thickness?: number;
  bore?: number;
  boreRadius?: number;
  keywayWidth?: number;
  keywayDepth?: number;
  hubRadius?: number;
  hubThickness?: number;
  helixAngleDeg?: number;
  lighteningHoles?: number;
  lighteningHoleRadius?: number;
  profileSamples?: number;
}

/** Options for `THREE.CAD.InternalRingGearGeometry`. */
export interface InternalRingGearOptions {
  module?: number;
  teeth?: number;
  outerRadius?: number;
  pressureAngleDeg?: number;
  thickness?: number;
  boltCount?: number;
  boltHoles?: number;
  boltHoleDiameter?: number;
  boltHoleRadius?: number;
  boltCircleRadius?: number;
  profileSamples?: number;
}

/** Options for `THREE.CAD.RackGeometry`. */
export interface RackOptions {
  module?: number;
  teeth?: number;
  pressureAngleDeg?: number;
  thickness?: number;
  width?: number;
  backHeight?: number;
}

/** Options for `THREE.CAD.PulleyGeometry`. */
export interface PulleyOptions {
  pitchRadius?: number;
  width?: number;
  grooves?: number;
  grooveDepth?: number;
  grooveAngleDeg?: number;
  flangeHeight?: number;
  flangeRadius?: number;
  bore?: number;
  boreRadius?: number;
  hubRadius?: number;
  hubWidth?: number;
  radialSegments?: number;
}

/** Options for `THREE.CAD.BoltGeometry` / `ScrewGeometry`. */
export interface BoltOptions {
  preset?: string;
  scale?: number;
  headType?: 'hex' | 'socket' | 'countersunk' | 'button';
  threadDiameter?: number;
  pitch?: number;
  length?: number;
  threadedLength?: number;
  acrossFlats?: number;
  headDiameter?: number;
  headHeight?: number;
  socketAcrossFlats?: number;
  cosmeticThreads?: boolean;
  origin?: 'bearing' | 'center';
  radialSegments?: number;
}

/** Options for `THREE.CAD.NutGeometry` / `HexNutGeometry`. */
export interface NutOptions {
  preset?: string;
  scale?: number;
  nutType?: 'hex' | 'flange' | 'nyloc';
  threadDiameter?: number;
  pitch?: number;
  acrossFlats?: number;
  thickness?: number;
  flanged?: boolean;
  flangeDiameter?: number;
  nyloc?: boolean;
  cosmeticThreads?: boolean;
  radialSegments?: number;
}

/** Options for `THREE.CAD.WasherGeometry`. */
export interface WasherOptions {
  preset?: string;
  scale?: number;
  innerDiameter?: number;
  outerDiameter?: number;
  thickness?: number;
  chamfer?: number;
  radialSegments?: number;
}

/** One cylindrical section of a stepped `ShaftGeometry`. */
export interface ShaftSegmentSpec {
  diameter?: number;
  radius?: number;
  length: number;
  chamfer?: number;
}

/** Options for `THREE.CAD.ShaftGeometry`. */
export interface ShaftOptions {
  segments?: readonly ShaftSegmentSpec[];
  steps?: readonly ShaftSegmentSpec[];
  diameter?: number;
  radius?: number;
  length?: number;
  chamfer?: number;
  bore?: number;
  boreRadius?: number;
  dCut?: number;
  radialSegments?: number;
}

/** Options for `THREE.CAD.BearingGeometry`. */
export interface BearingOptions {
  innerDiameter?: number;
  innerRadius?: number;
  outerDiameter?: number;
  outerRadius?: number;
  width?: number;
  balls?: number;
  shielded?: boolean;
  flanged?: boolean;
  flangeDiameter?: number;
  flangeWidth?: number;
  radialSegments?: number;
}

/** Options for `THREE.CAD.HelicalSpringGeometry`. */
export interface HelicalSpringOptions {
  meanRadius?: number;
  wireRadius?: number;
  coils?: number;
  length?: number;
  flatEnds?: boolean;
  tubularSegments?: number;
  radialSegments?: number;
}

/** Options for `THREE.CAD.FlangePlateGeometry`. */
export interface FlangePlateOptions {
  outerRadius?: number;
  thickness?: number;
  bore?: number;
  boreRadius?: number;
  boltCount?: number;
  boltHoles?: number;
  boltCircleRadius?: number;
  boltHoleDiameter?: number;
  boltHoleRadius?: number;
  neckRadius?: number;
  neckHeight?: number;
  hubRadius?: number;
  hubHeight?: number;
  radialSegments?: number;
}

/** Supported structural extrusion cross-sections. */
export type StructuralProfileKind =
  | 't-slot'
  | 'i-beam'
  | 'c-channel'
  | 'l-angle'
  | 'rect-tube';

/** Options for `THREE.CAD.ProfileExtrusionGeometry`. */
export interface ProfileExtrusionOptions {
  profile?: StructuralProfileKind;
  width?: number;
  height?: number;
  length?: number;
  wallThickness?: number;
  thickness?: number;
  slotWidth?: number;
}

/**
 * Self-contained installer attaching `THREE.CAD` and standard parametric
 * machine-part `BufferGeometry` classes onto a `THREE` namespace and registry.
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installPartsExtension(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.BufferGeometry || !threeNs.BufferAttribute) {
    return null;
  }
  if (reg?.authorNamespace?.CAD?.SpurGearGeometry) {
    return {CAD: reg.authorNamespace.CAD, ...reg.authorNamespace.CAD};
  }

  const BufferGeometry = threeNs.BufferGeometry;
  const BufferAttribute = threeNs.BufferAttribute;

  const TAU = Math.PI * 2;
  const MAX_TEETH = 200;
  const MAX_RAD_SEGS = 128;
  const MAX_COILS = 64;
  const MAX_HOLES = 64;

  const num = (v: unknown, fallback: number): number => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const clamp = (v: number, lo: number, hi: number): number => {
    const h = hi < lo ? lo : hi;
    return v < lo ? lo : v > h ? h : v;
  };
  const clampInt = (
    v: unknown,
    lo: number,
    hi: number,
    fallback: number,
  ): number => clamp(Math.round(num(v, fallback)), lo, hi);
  const pickDia = (d: unknown, r: unknown, def: number): number =>
    d != null ? num(d, def) : r != null ? num(r, def * 0.5) * 2 : def;

  type Pt2 = [number, number];
  interface RawMeshBuffers {
    pos: number[];
    nrm: number[];
    uv: number[];
    idx: number[];
  }

  function applyBuffers(
    // tslint:disable-next-line:no-any
    geom: any,
    b: RawMeshBuffers,
    typeName: string,
    params: Record<string, unknown>,
  ): void {
    const vCount = (b.pos.length / 3) | 0;
    geom.type = typeName;
    geom.parameters = params;
    geom.userData = geom.userData || {};
    geom.userData.part = {type: typeName, ...params};
    geom.userData.cad = geom.userData.part;
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

  function mergeRaw(parts: readonly RawMeshBuffers[]): RawMeshBuffers {
    if (parts.length === 0) return {pos: [], nrm: [], uv: [], idx: []};
    if (parts.length === 1) return parts[0];
    let totalPos = 0;
    let totalUv = 0;
    let totalIdx = 0;
    for (let k = 0; k < parts.length; k++) {
      totalPos += parts[k].pos.length;
      totalUv += parts[k].uv.length;
      totalIdx += parts[k].idx.length;
    }
    const pos = new Array<number>(totalPos);
    const nrm = new Array<number>(totalPos);
    const uv = new Array<number>(totalUv);
    const idx = new Array<number>(totalIdx);
    let pCursor = 0;
    let uCursor = 0;
    let iCursor = 0;
    let vOff = 0;
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      const pp = p.pos;
      const pn = p.nrm;
      const pu = p.uv;
      const pi = p.idx;
      for (let i = 0; i < pp.length; i++) {
        pos[pCursor] = pp[i];
        nrm[pCursor] = pn[i];
        pCursor++;
      }
      for (let i = 0; i < pu.length; i++) uv[uCursor++] = pu[i];
      for (let i = 0; i < pi.length; i++) idx[iCursor++] = pi[i] + vOff;
      vOff += (pp.length / 3) | 0;
    }
    return {pos, nrm, uv, idx};
  }

  function translateRawY(b: RawMeshBuffers, dy: number): RawMeshBuffers {
    if (Math.abs(dy) < 1e-12) return b;
    for (let i = 1; i < b.pos.length; i += 3) b.pos[i] += dy;
    return b;
  }

  // --- 1. Hard-Edge Revolved Closed Cross-Section around +Y ---
  // `pts` is a closed loop in (r >= 0, y) oriented CCW in the (r, y) half-plane.
  function revolveClosedProfile(
    pts: readonly Pt2[],
    radialSegs: number,
  ): RawMeshBuffers {
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
    const n = clean.length;
    if (n < 3) return {pos: [], nrm: [], uv: [], idx: []};

    // Ensure CCW signed area in (r, y) so (dy, -dr) points strictly outward.
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const a = clean[i];
      const b = clean[(i + 1) % n];
      area2 += a[0] * b[1] - b[0] * a[1];
    }
    if (area2 < 0) clean.reverse();

    const segs = clamp(Math.round(radialSegs), 3, MAX_RAD_SEGS);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    // Precompute 2D outward edge normals (nr, ny) = normalize(dy, -dr).
    const eNrm: Pt2[] = [];
    for (let i = 0; i < n; i++) {
      const a = clean[i];
      const b = clean[(i + 1) % n];
      const dr = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dr, dy) || 1;
      eNrm.push([dy / len, -dr / len]);
    }

    let vCursor = 0;
    let arcAcc = 0;
    for (let i = 0; i < n; i++) {
      const a = clean[i];
      const b = clean[(i + 1) % n];
      const rA = a[0];
      const yA = a[1];
      const rB = b[0];
      const yB = b[1];
      if (rA <= 1e-8 && rB <= 1e-8) continue;

      const prevN = eNrm[(i + n - 1) % n];
      const curN = eNrm[i];
      const nextN = eNrm[(i + 1) % n];

      const blendN = (n0: Pt2, n1: Pt2): Pt2 => {
        if (n0[0] * n1[0] + n0[1] * n1[1] > 0.906) {
          const sx = n0[0] + n1[0];
          const sy = n0[1] + n1[1];
          const sl = Math.hypot(sx, sy) || 1;
          return [sx / sl, sy / sl];
        }
        return curN;
      };
      const nA: Pt2 = rA <= 1e-8 ? [0, curN[1] >= 0 ? 1 : -1] : blendN(prevN, curN);
      const nB: Pt2 = rB <= 1e-8 ? [0, curN[1] >= 0 ? 1 : -1] : blendN(curN, nextN);

      const segLen = Math.hypot(rB - rA, yB - yA);
      const v0 = arcAcc;
      const v1 = arcAcc + segLen;
      arcAcc = v1;

      const base = vCursor;
      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const phi = u * TAU;
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        pos.push(rA * cp, yA, -rA * sp, rB * cp, yB, -rB * sp);
        nrm.push(
          nA[0] * cp,
          nA[1],
          -nA[0] * sp,
          nB[0] * cp,
          nB[1],
          -nB[0] * sp,
        );
        uv.push(u, v0, u, v1);
      }
      vCursor += (segs + 1) * 2;

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

  // Revolves an open chain `pts` in (r >= 0, y) around +Y without closing last->first.
  function revolveOpenChain(
    pts: readonly Pt2[],
    radialSegs: number,
  ): RawMeshBuffers {
    const clean: Pt2[] = [];
    for (const p of pts) {
      const r = Math.max(0, p[0]);
      const y = p[1];
      const prev = clean[clean.length - 1];
      if (!prev || Math.hypot(r - prev[0], y - prev[1]) > 1e-8) {
        clean.push([r, y]);
      }
    }
    const segCount = clean.length - 1;
    if (segCount < 1) return {pos: [], nrm: [], uv: [], idx: []};
    const segs = clamp(Math.round(radialSegs), 3, MAX_RAD_SEGS);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const eNrm: Pt2[] = [];
    for (let i = 0; i < segCount; i++) {
      const dr = clean[i + 1][0] - clean[i][0];
      const dy = clean[i + 1][1] - clean[i][1];
      const len = Math.hypot(dr, dy) || 1;
      eNrm.push([dy / len, -dr / len]);
    }
    let vCursor = 0;
    let arcAcc = 0;
    for (let i = 0; i < segCount; i++) {
      const a = clean[i];
      const b = clean[i + 1];
      const rA = a[0];
      const yA = a[1];
      const rB = b[0];
      const yB = b[1];
      if (rA <= 1e-8 && rB <= 1e-8) continue;
      const curN = eNrm[i];
      const nA: Pt2 = rA <= 1e-8 ? [0, curN[1] >= 0 ? 1 : -1] : curN;
      const nB: Pt2 = rB <= 1e-8 ? [0, curN[1] >= 0 ? 1 : -1] : curN;
      const segLen = Math.hypot(rB - rA, yB - yA);
      const v0 = arcAcc;
      const v1 = arcAcc + segLen;
      arcAcc = v1;
      const base = vCursor;
      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const phi = u * TAU;
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        pos.push(rA * cp, yA, -rA * sp, rB * cp, yB, -rB * sp);
        nrm.push(
          nA[0] * cp,
          nA[1],
          -nA[0] * sp,
          nB[0] * cp,
          nB[1],
          -nB[0] * sp,
        );
        uv.push(u, v0, u, v1);
      }
      vCursor += (segs + 1) * 2;
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

  // Builds a recessed hexagonal socket cavity (`topY` down to `topY - depth`) integrated
  // cleanly into a circular top rim of radius `rimR` with zero internal diaphragms!
  function buildRecessedHexSocketTop(
    rimR: number,
    sockAF: number,
    topY: number,
    depth: number,
    radialSegs: number,
  ): RawMeshBuffers {
    const outerRim = circlePts(rimR, radialSegs, 0, 0, true);
    const hexHole = hexPts(sockAF, false);
    // 1. Top annular face at y = topY (`rim \ hexHole`), plus inner 6-flat socket walls:
    //    Use extrude2DWithHoles on hexHole ONLY for walls + floor, and top cap for annulus!
    const {verts, tris} = triangulatePolygonWithHoles(outerRim, [hexHole]);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const span = Math.max(1e-6, rimR * 2);
    for (const p of verts) {
      pos.push(p[0], topY, -p[1]);
      nrm.push(0, 1, 0);
      uv.push((p[0] + rimR) / span, (p[1] + rimR) / span);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i];
      const b = tris[i + 1];
      const c = tris[i + 2];
      if (Math.abs(cross2(verts[a], verts[b], verts[c])) > 1e-14) {
        idx.push(a, b, c);
      }
    }
    let vOff = verts.length;

    // 2. Vertical 6-flat Allen socket walls (hexHole is CW, so outward normal points into cavity!)
    const botY = topY - depth;
    for (let i = 0; i < 6; i++) {
      const a = hexHole[i];
      const b = hexHole[(i + 1) % 6];
      const du = b[0] - a[0];
      const dv = b[1] - a[1];
      const el = Math.hypot(du, dv) || 1;
      const nx = dv / el;
      const nz = du / el;
      const base = vOff;
      pos.push(a[0], botY, -a[1], b[0], botY, -b[1], a[0], topY, -a[1], b[0], topY, -b[1]);
      nrm.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
      uv.push(0, 0, 1, 0, 0, 1, 1, 1);
      idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
      vOff += 4;
    }

    // 3. Flat hexagonal socket floor at y = botY (CCW -> +Y normal)
    const hexFloor = hexPts(sockAF, true);
    const fBase = vOff;
    for (const p of hexFloor) {
      pos.push(p[0], botY, -p[1]);
      nrm.push(0, 1, 0);
      uv.push(0.5 + p[0] / span, 0.5 + p[1] / span);
    }
    for (let i = 1; i < 5; i++) {
      idx.push(fBase, fBase + i, fBase + i + 1);
    }
    return {pos, nrm, uv, idx};
  }
  function signedArea2D(loop: readonly Pt2[]): number {
    let a = 0;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % n];
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
    const ccw = signedArea2D(out) > 0;
    if (ccw !== wantCCW) out.reverse();
    return out;
  }

  function cross2(a: Pt2, b: Pt2, c: Pt2): number {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function ptInTri2D(p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean {
    const c1 = cross2(a, b, p);
    const c2 = cross2(b, c, p);
    const c3 = cross2(c, a, p);
    return c1 >= -1e-10 && c2 >= -1e-10 && c3 >= -1e-10;
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
    // Check that V->M enters the interior of `outer` at V (in-cone test).
    const prev = outer[(candIdx + on - 1) % on];
    const next = outer[(candIdx + 1) % on];
    if (cross2(prev, V, next) >= -1e-10) {
      return cross2(prev, V, M) > -1e-10 && cross2(V, next, M) > -1e-10;
    }
    return !(cross2(V, prev, M) >= 1e-10 && cross2(next, V, M) >= 1e-10);
  }

  function bridgeHoleIntoOuter(outer: Pt2[], hole: readonly Pt2[]): Pt2[] {
    // Eberly rightmost-vertex horizontal-ray hole bridge with exact visibility fallback.
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
          if (cross2(prev, cur, next) >= 1e-10) continue;
          if (cur[0] < mx - 1e-9) continue;
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
      if (isBridgeVisible(outer, M, hole, mIdx, cand)) {
        visIdx = cand;
      }
    }

    if (visIdx < 0) {
      const order: number[] = new Array(on);
      const distSq: number[] = new Array(on);
      for (let i = 0; i < on; i++) {
        order[i] = i;
        const dx = outer[i][0] - mx;
        const dy = outer[i][1] - my;
        distSq[i] = dx * dx + dy * dy;
      }
      order.sort((a, b) => distSq[a] - distSq[b]);
      for (let k = 0; k < on; k++) {
        const cand = order[k];
        if (isBridgeVisible(outer, M, hole, mIdx, cand)) {
          visIdx = cand;
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
      for (const h of sorted) {
        poly = bridgeHoleIntoOuter(poly, h);
      }
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
            if (bestV >= 0) {
              tris.push(d0, drop, d2);
            }
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
    if (rem === 3) {
      tris.push(prev[cur], cur, next[cur]);
    }
    return {verts: poly, tris};
  }

  function extrude2DWithHoles(
    rawOuter: readonly Pt2[],
    rawHoles: readonly Pt2[][],
    thickness: number,
    twistRad = 0,
    slices = 1,
    includeBottomCap = true,
    includeTopCap = true,
  ): RawMeshBuffers {
    const outer = sanitizeLoop(rawOuter, true);
    if (outer.length < 3) return {pos: [], nrm: [], uv: [], idx: []};
    const holes = rawHoles
      .map((h) => sanitizeLoop(h, false))
      .filter((h) => h.length >= 3);

    const hT = Math.max(1e-6, thickness) * 0.5;
    const nSlices = clamp(Math.round(slices), 1, 24);
    const {verts, tris} = triangulatePolygonWithHoles(outer, holes);

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of outer) {
      if (p[0] < minU) minU = p[0];
      if (p[0] > maxU) maxU = p[0];
      if (p[1] < minV) minV = p[1];
      if (p[1] > maxV) maxV = p[1];
    }
    const spanU = Math.max(1e-6, maxU - minU);
    const spanV = Math.max(1e-6, maxV - minV);

    const rotPt = (u: number, v: number, ang: number): Pt2 => {
      if (ang === 0) return [u, v];
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      return [u * c - v * s, u * s + v * c];
    };

    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let vOff = 0;

    // Top cap (y = +hT, outward +Y): (u, v) -> (u, +hT, -v) preserves CCW -> +Y.
    if (includeTopCap) {
      const topAng = twistRad * 0.5;
      for (const p of verts) {
        const [ru, rv] = rotPt(p[0], p[1], topAng);
        pos.push(ru, hT, -rv);
        nrm.push(0, 1, 0);
        uv.push((p[0] - minU) / spanU, (p[1] - minV) / spanV);
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
    }

    // Bottom cap (y = -hT, outward -Y): reverse triangle winding.
    if (includeBottomCap) {
      const botAng = -twistRad * 0.5;
      for (const p of verts) {
        const [ru, rv] = rotPt(p[0], p[1], botAng);
        pos.push(ru, -hT, -rv);
        nrm.push(0, -1, 0);
        uv.push((p[0] - minU) / spanU, 1 - (p[1] - minV) / spanV);
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
    }

    // Side walls for outer (CCW) and every hole (CW).
    const allLoops = [outer, ...holes];
    for (const loop of allLoops) {
      const ln = loop.length;
      const eNrm: Pt2[] = [];
      for (let i = 0; i < ln; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % ln];
        const du = b[0] - a[0];
        const dv = b[1] - a[1];
        const el = Math.hypot(du, dv) || 1;
        // Outward normal in (u, v) is (dv, -du), which maps to (dv, 0, du) in (x, y, z)=(u, y, -v).
        eNrm.push([dv / el, du / el]);
      }

      const smoothEdgeNrm = (cur: Pt2, adj: Pt2): Pt2 => {
        if (cur[0] * adj[0] + cur[1] * adj[1] > 0.92) {
          const sx = cur[0] + adj[0];
          const sz = cur[1] + adj[1];
          const sl = Math.hypot(sx, sz) || 1;
          return [sx / sl, sz / sl];
        }
        return cur;
      };

      let perim = 0;
      for (let i = 0; i < ln; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % ln];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen <= 1e-9) continue;

        const prevN = eNrm[(i + ln - 1) % ln];
        const curN = eNrm[i];
        const nextN = eNrm[(i + 1) % ln];
        const n0Base = smoothEdgeNrm(curN, prevN);
        const n1Base = smoothEdgeNrm(curN, nextN);

        const u0 = perim;
        const u1 = perim + segLen;
        perim = u1;

        const base = vOff;
        for (let s = 0; s <= nSlices; s++) {
          const frac = s / nSlices;
          const y = -hT + frac * (2 * hT);
          const ang = (frac - 0.5) * twistRad;
          const [ax, av] = rotPt(a[0], a[1], ang);
          const [bx, bv] = rotPt(b[0], b[1], ang);
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          let rx0 = n0Base[0] * ca + n0Base[1] * sa;
          let rz0 = -n0Base[0] * sa + n0Base[1] * ca;
          let rx1 = n1Base[0] * ca + n1Base[1] * sa;
          let rz1 = -n1Base[0] * sa + n1Base[1] * ca;
          let ry0 = 0;
          let ry1 = 0;
          if (twistRad !== 0) {
            // Exact helical flank tilt normal from tangent along profile x twisted vertical generator
            const dAng = twistRad / (2 * hT);
            const tx0 = -av * dAng;
            const tz0 = -ax * dAng;
            const tx1 = -bv * dAng;
            const tz1 = -bx * dAng;
            // Edge vector E = (bx - ax, 0, -bv + av), vertical tangent T = (tx, 1, tz), outward N = E x T
            const ex = bx - ax;
            const ez = -bv + av;
            const cx0 = -ez;
            const cy0 = ez * tx0 - ex * tz0;
            const cz0 = ex;
            const cl0 = Math.hypot(cx0, cy0, cz0) || 1;
            const cx1 = -ez;
            const cy1 = ez * tx1 - ex * tz1;
            const cz1 = ex;
            const cl1 = Math.hypot(cx1, cy1, cz1) || 1;
            rx0 = cx0 / cl0;
            ry0 = cy0 / cl0;
            rz0 = cz0 / cl0;
            rx1 = cx1 / cl1;
            ry1 = cy1 / cl1;
            rz1 = cz1 / cl1;
          }

          pos.push(ax, y, -av, bx, y, -bv);
          nrm.push(rx0, ry0, rz0, rx1, ry1, rz1);
          uv.push(u0, frac, u1, frac);
        }
        vOff += (nSlices + 1) * 2;

        for (let s = 0; s < nSlices; s++) {
          const r0 = base + s * 2;
          const r1 = r0 + 1;
          const t0 = r0 + 2;
          const t1 = r0 + 3;
          idx.push(r0, r1, t1, r0, t1, t0);
        }
      }
    }

    return {pos, nrm, uv, idx};
  }

  function circlePts(
    radius: number,
    segs: number,
    cx = 0,
    cy = 0,
    ccw = true,
  ): Pt2[] {
    const out: Pt2[] = [];
    const n = clamp(Math.round(segs), 6, MAX_RAD_SEGS);
    for (let i = 0; i < n; i++) {
      const a = (ccw ? 1 : -1) * ((i * TAU) / n);
      out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
    return out;
  }

  function hexPts(acrossFlats: number, ccw = true): Pt2[] {
    // Circumradius across corners = acrossFlats / cos(30°) = acrossFlats / (sqrt(3)/2).
    const rCorner = acrossFlats / Math.sqrt(3);
    const out: Pt2[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (ccw ? 1 : -1) * ((i * TAU) / 6);
      out.push([rCorner * Math.cos(a), rCorner * Math.sin(a)]);
    }
    return out;
  }

  // --- 3. ISO Metric Fastener Lookup Table (ISO 4014 / 4762 / 4032 / 7089) ---
  // Columns: [d_mm, pitch_mm, hexAF_mm, hexH_mm, sockDia_mm, sockH_mm, sockKey_mm, nutT_mm, washID_mm, washOD_mm, washT_mm, clearHole_mm]
  const ISO_TABLE: ReadonlyArray<readonly number[]> = [
    [1.6, 0.35, 3.2, 1.1, 3.0, 1.6, 1.5, 1.3, 1.7, 4.0, 0.3, 1.8],
    [2.0, 0.4, 4.0, 1.4, 3.8, 2.0, 1.5, 1.6, 2.2, 5.0, 0.3, 2.4],
    [2.5, 0.45, 5.0, 1.7, 4.5, 2.5, 2.0, 2.0, 2.7, 6.0, 0.5, 2.9],
    [3.0, 0.5, 5.5, 2.0, 5.5, 3.0, 2.5, 2.4, 3.2, 7.0, 0.5, 3.4],
    [4.0, 0.7, 7.0, 2.8, 7.0, 4.0, 3.0, 3.2, 4.3, 9.0, 0.8, 4.5],
    [5.0, 0.8, 8.0, 3.5, 8.5, 5.0, 4.0, 4.7, 5.3, 10.0, 1.0, 5.5],
    [6.0, 1.0, 10.0, 4.0, 10.0, 6.0, 5.0, 5.2, 6.4, 12.0, 1.6, 6.6],
    [8.0, 1.25, 13.0, 5.3, 13.0, 8.0, 6.0, 6.8, 8.4, 16.0, 1.6, 9.0],
    [10.0, 1.5, 16.0, 6.4, 16.0, 10.0, 8.0, 8.4, 10.5, 20.0, 2.0, 11.0],
    [12.0, 1.75, 18.0, 7.5, 18.0, 12.0, 10.0, 10.8, 13.0, 24.0, 2.5, 13.5],
    [16.0, 2.0, 24.0, 10.0, 24.0, 16.0, 14.0, 14.8, 17.0, 30.0, 3.0, 17.5],
    [20.0, 2.5, 30.0, 12.5, 30.0, 20.0, 17.0, 18.0, 21.0, 37.0, 3.0, 22.0],
    [24.0, 3.0, 36.0, 15.0, 36.0, 24.0, 19.0, 21.5, 25.0, 44.0, 4.0, 26.0],
  ];

  function metricFastener(
    spec = 'M6',
    scaleOrOpts: number | {scale?: number} = 1,
  ): MetricFastenerSpec {
    const rawScale =
      typeof scaleOrOpts === 'object' && scaleOrOpts !== null
        ? scaleOrOpts.scale
        : scaleOrOpts;
    const scaleNum = clamp(num(rawScale, 1), 1e-4, 1e4);
    const s = scaleNum * 1e-3; // mm -> meters * scale
    const raw = String(spec ?? 'M6').trim();
    const m = /^m?\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?$/i.exec(raw);
    const dMm = clamp(m ? Number(m[1]) : 6, 1, 100);
    const lenMm = m && m[2] ? clamp(Number(m[2]), 1, 2000) : undefined;

    let row: readonly number[] | null = null;
    for (const r of ISO_TABLE) {
      if (Math.abs(r[0] - dMm) < 1e-3) {
        row = r;
        break;
      }
    }
    const [
      d,
      pitch,
      af,
      hexH,
      sockD,
      sockH,
      sockKey,
      nutT,
      wId,
      wOd,
      wT,
      cHole,
    ] = row ?? [
      dMm,
      dMm * 0.15,
      dMm * 1.6,
      dMm * 0.65,
      dMm * 1.5,
      dMm,
      dMm * 0.8,
      dMm * 0.85,
      dMm * 1.07,
      dMm * 2.0,
      dMm * 0.2,
      dMm * 1.1,
    ];
    const presetName = `M${dMm}${lenMm ? `x${lenMm}` : ''}`;
    const lenMeters = lenMm !== undefined ? lenMm * s : undefined;
    return {
      preset: presetName,
      threadDiameter: d * s,
      pitch: pitch * s,
      acrossFlats: af * s,
      hexHeadHeight: hexH * s,
      socketHeadDiameter: sockD * s,
      socketHeadHeight: sockH * s,
      socketKeyAcrossFlats: sockKey * s,
      countersunkHeadDiameter: d * 2.0 * s,
      countersunkHeadHeight: d * 0.55 * s,
      buttonHeadDiameter: d * 1.75 * s,
      buttonHeadHeight: d * 0.55 * s,
      nutThickness: nutT * s,
      washerInnerDiameter: wId * s,
      washerOuterDiameter: wOd * s,
      washerThickness: wT * s,
      clearanceHoleDiameter: cHole * s,
      ...(lenMeters !== undefined ? {length: lenMeters} : {}),
      bolt: {
        preset: presetName,
        scale: scaleNum,
        threadDiameter: d * s,
        pitch: pitch * s,
        acrossFlats: af * s,
        ...(lenMeters !== undefined ? {length: lenMeters} : {}),
      },
      nut: {
        preset: presetName,
        scale: scaleNum,
        threadDiameter: d * s,
        pitch: pitch * s,
        acrossFlats: af * s,
        thickness: nutT * s,
      },
      washer: {
        preset: presetName,
        scale: scaleNum,
        innerDiameter: wId * s,
        outerDiameter: wOd * s,
        thickness: wT * s,
      },
    };
  }

  // tslint:disable-next-line:no-any
  function gearMeshDistance(gearA: any, gearB: any): GearMeshInfo {
    const read = (g: any) => {
      const p = g?.parameters ?? g?.userData?.part ?? g ?? {};
      const m = Math.max(1e-6, num(p.module, 0.01));
      const z = clampInt(p.teeth, 4, MAX_TEETH, 20);
      const internal =
        Boolean(p.internal) ||
        g?.type === 'InternalRingGearGeometry' ||
        p.type === 'InternalRingGearGeometry';
      return {m, z, r: 0.5 * m * z, internal};
    };
    const a = read(gearA);
    const b = read(gearB);
    const internalPair = a.internal !== b.internal;
    const centerDistance = internalPair
      ? Math.abs(a.r - b.r)
      : a.r + b.r;
    const ratio = a.z / b.z;
    // Half-tooth phase shift when driven gear has even tooth count on external mesh.
    const phaseOffsetRad = internalPair
      ? b.z % 2 === 1
        ? Math.PI / b.z
        : 0
      : b.z % 2 === 0
        ? Math.PI / b.z
        : 0;
    const res = {centerDistance, ratio, phaseOffsetRad} as GearMeshInfo;
    Object.defineProperty(res, 'valueOf', {
      value: () => centerDistance,
      enumerable: false,
    });
    return res;
  }

  // --- 4. Involute Gear Contour Helper ---
  function buildInvoluteGearContour(
    mod: number,
    teeth: number,
    pressureAngleDeg: number,
    isInternal: boolean,
    samples: number,
  ): {
    loop: Pt2[];
    pitchRadius: number;
    outerRadius: number;
    rootRadius: number;
    baseRadius: number;
  } {
    const alpha = (clamp(pressureAngleDeg, 12, 32) * Math.PI) / 180;
    const rPitch = 0.5 * mod * teeth;
    const rBase = rPitch * Math.cos(alpha);
    const rAdd = isInternal ? rPitch + 1.25 * mod : rPitch + mod;
    const rDed = isInternal
      ? Math.max(mod * 0.5, rPitch - mod)
      : Math.max(mod * 0.4, rPitch - 1.25 * mod);
    const rTip = isInternal ? rDed : rAdd;
    const rRoot = isInternal ? rAdd : rDed;

    const inv = (a: number) => Math.tan(a) - a;
    const invAlpha = inv(alpha);
    // Half-angular tooth thickness at base circle (with slight 2% backlash allowance).
    const halfToothPitch = (Math.PI / (2 * teeth)) * (isInternal ? 1.02 : 0.98);
    const halfBaseAngle = halfToothPitch + invAlpha;

    const nSamp = clamp(samples, 3, 10);
    const flank: Array<[number, number]> = []; // [r, thetaOffsetFromToothCenter]
    const rStart = Math.max(Math.min(rRoot, rTip), rBase);
    const rLow = Math.min(rRoot, rTip);
    const rHigh = Math.max(rRoot, rTip);

    if (!isInternal) {
      if (rRoot < rBase) {
        flank.push([rRoot, -halfBaseAngle]);
      }
      for (let k = 0; k <= nSamp; k++) {
        const r = rStart + ((rHigh - rStart) * k) / nSamp;
        const phi = r > rBase ? Math.acos(clamp(rBase / r, -1, 1)) : 0;
        const th = inv(phi) - halfBaseAngle;
        flank.push([r, Math.min(0, th)]);
      }
    } else {
      // Internal ring: tooth projects inward from rRoot (larger) down to rTip (smaller).
      for (let k = 0; k <= nSamp; k++) {
        const r = rHigh - ((rHigh - Math.max(rLow, rBase)) * k) / nSamp;
        const phi = r > rBase ? Math.acos(clamp(rBase / r, -1, 1)) : 0;
        const th = halfBaseAngle - inv(phi);
        flank.push([r, Math.max(0, th)]);
      }
      if (rLow < rBase) {
        flank.push([rLow, halfBaseAngle]);
      }
    }

    // Clamp tip angle so flanks never cross on low-tooth-count pinions.
    const maxHalfStep = (TAU / teeth) * 0.47;
    const loop: Pt2[] = [];
    for (let i = 0; i < teeth; i++) {
      const centerAng = (i * TAU) / teeth;
      if (!isInternal) {
        for (let k = 0; k < flank.length; k++) {
          const r = flank[k][0];
          const a = centerAng + clamp(flank[k][1], -maxHalfStep, -1e-5);
          loop.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        for (let k = flank.length - 1; k >= 0; k--) {
          const r = flank[k][0];
          const a = centerAng + clamp(-flank[k][1], 1e-5, maxHalfStep);
          loop.push([r * Math.cos(a), r * Math.sin(a)]);
        }
      } else {
        for (let k = 0; k < flank.length; k++) {
          const r = flank[k][0];
          const a = centerAng - clamp(flank[k][1], 1e-5, maxHalfStep);
          loop.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        for (let k = flank.length - 1; k >= 0; k--) {
          const r = flank[k][0];
          const a = centerAng + clamp(flank[k][1], 1e-5, maxHalfStep);
          loop.push([r * Math.cos(a), r * Math.sin(a)]);
        }
      }
    }

    return {
      loop,
      pitchRadius: rPitch,
      outerRadius: isInternal ? rRoot : rTip,
      rootRadius: isInternal ? rTip : rRoot,
      baseRadius: rBase,
    };
  }

  function boreWithKeywayPts(
    boreRadius: number,
    segs: number,
    kwWidth: number,
    kwDepth: number,
  ): Pt2[] {
    if (kwWidth <= 1e-6 || kwDepth <= 1e-6 || kwWidth >= boreRadius * 1.8) {
      return circlePts(boreRadius, segs, 0, 0, false);
    }
    const hw = kwWidth * 0.5;
    const xBase = Math.sqrt(Math.max(0, boreRadius * boreRadius - hw * hw));
    const xTop = boreRadius + kwDepth;
    const startAng = Math.atan2(hw, xBase);
    const endAng = TAU - startAng;
    const n = clamp(Math.round(segs), 12, MAX_RAD_SEGS);
    const pts: Pt2[] = [
      [xBase, hw],
      [xTop, hw],
      [xTop, -hw],
      [xBase, -hw],
    ];
    // Continue CW around the circle from -startAng back to +startAng (decreasing angle).
    for (let i = 1; i < n; i++) {
      const a = endAng - ((endAng - startAng) * i) / n;
      pts.push([boreRadius * Math.cos(a), boreRadius * Math.sin(a)]);
    }
    return pts;
  }

  // --- Geometry Classes ---

  class SpurGearGeometry extends BufferGeometry {
    constructor(options: SpurGearOptions = {}) {
      super();
      const mod = clamp(num(options.module, 0.01), 1e-4, 10);
      const teeth = clampInt(options.teeth, 5, MAX_TEETH, 20);
      const pressureAngleDeg = clamp(num(options.pressureAngleDeg, 20), 12, 32);
      const thickness = clamp(num(options.thickness, mod * 3), 1e-4, 20);
      const helixAngleDeg = clamp(num(options.helixAngleDeg, 0), -45, 45);
      const samples = clampInt(options.profileSamples, 2, 10, 3);

      const gear = buildInvoluteGearContour(
        mod,
        teeth,
        pressureAngleDeg,
        false,
        samples,
      );
      const maxInner = gear.rootRadius * 0.88;
      const boreDia = clamp(
        pickDia(options.bore, options.boreRadius, gear.pitchRadius * 0.4),
        0,
        maxInner * 2,
      );
      const boreR = boreDia * 0.5;
      const kwW = clamp(num(options.keywayWidth, 0), 0, boreR * 1.4);
      const kwD = clamp(num(options.keywayDepth, kwW * 0.5), 0, (maxInner - boreR) * 0.8);

      const hubR = clamp(num(options.hubRadius, 0), 0, gear.rootRadius * 0.9);
      const hubT = clamp(num(options.hubThickness, thickness), thickness, thickness * 6);
      const hasRaisedHub = hubR > boreR + mod * 0.15 && hubT > thickness + 1e-6;

      const holes: Pt2[][] = [];
      if (boreR > 1e-6) {
        holes.push(boreWithKeywayPts(boreR, 24, kwW, kwD));
      }

      const webInner = Math.max(boreR + kwD, hasRaisedHub ? hubR : boreR) + mod * 0.5;
      const webOuter = gear.rootRadius - mod * 0.8;
      const lCount = clampInt(options.lighteningHoles, 0, MAX_HOLES, 0);
      if (lCount > 0 && webOuter > webInner + mod * 0.6) {
        const orbitR = 0.5 * (webInner + webOuter);
        const maxHoleR = Math.min(
          (webOuter - webInner) * 0.44,
          orbitR * Math.sin(Math.PI / Math.max(2, lCount)) * 0.78,
        );
        const lHoleR = clamp(
          num(options.lighteningHoleRadius, maxHoleR * 0.85),
          0,
          maxHoleR,
        );
        if (lHoleR > mod * 0.15) {
          for (let i = 0; i < lCount; i++) {
            const a = (i * TAU) / lCount;
            holes.push(
              circlePts(
                lHoleR,
                14,
                orbitR * Math.cos(a),
                orbitR * Math.sin(a),
                false,
              ),
            );
          }
        }
      }

      const twistRad =
        helixAngleDeg === 0
          ? 0
          : (thickness * Math.tan((helixAngleDeg * Math.PI) / 180)) /
            Math.max(1e-6, gear.pitchRadius);
      const slices = Math.abs(twistRad) > 1e-4 ? clamp(Math.ceil(Math.abs(twistRad) * 18), 2, 16) : 1;

      const meshes: RawMeshBuffers[] = [
        extrude2DWithHoles(gear.loop, holes, thickness, twistRad, slices),
      ];
      if (hasRaisedHub) {
        const bossEx = (hubT - thickness) * 0.5;
        const bossHoles =
          boreR > 1e-6 ? [boreWithKeywayPts(boreR, 32, kwW, kwD)] : [];
        const bossOuter = circlePts(hubR, 36, 0, 0, true);
        meshes.push(
          translateRawY(
            extrude2DWithHoles(bossOuter, bossHoles, bossEx, 0, 1, false, true),
            (thickness + bossEx) * 0.5,
          ),
          translateRawY(
            extrude2DWithHoles(bossOuter, bossHoles, bossEx, 0, 1, true, false),
            -(thickness + bossEx) * 0.5,
          ),
        );
      }

      applyBuffers(this, mergeRaw(meshes), 'SpurGearGeometry', {
        module: mod,
        teeth,
        pressureAngleDeg,
        thickness,
        bore: boreDia,
        helixAngleDeg,
        pitchRadius: gear.pitchRadius,
        outerRadius: gear.outerRadius,
        rootRadius: gear.rootRadius,
        baseRadius: gear.baseRadius,
        circularPitch: Math.PI * mod,
      });
    }
  }

  class InternalRingGearGeometry extends BufferGeometry {
    constructor(options: InternalRingGearOptions = {}) {
      super();
      const mod = clamp(num(options.module, 0.01), 1e-4, 10);
      const teeth = clampInt(options.teeth, 12, MAX_TEETH, 42);
      const pressureAngleDeg = clamp(num(options.pressureAngleDeg, 20), 12, 32);
      const thickness = clamp(num(options.thickness, mod * 3), 1e-4, 20);
      const samples = clampInt(options.profileSamples, 2, 10, 3);

      const gear = buildInvoluteGearContour(
        mod,
        teeth,
        pressureAngleDeg,
        true,
        samples,
      );
      const minOuter = gear.outerRadius + mod * 2.0;
      const outerR = Math.max(minOuter, num(options.outerRadius, gear.outerRadius + mod * 3.5));

      const outerCircle = circlePts(
        outerR,
        Math.max(36, Math.min(72, teeth * 2)),
        0,
        0,
        true,
      );
      // Inner toothed cavity is a CW hole inside outerCircle!
      const innerHole = sanitizeLoop(gear.loop, false);
      const holes: Pt2[][] = [innerHole];

      const bCount = clampInt(options.boltCount ?? options.boltHoles, 0, MAX_HOLES, 0);
      if (bCount > 0 && outerR - gear.outerRadius > mod * 1.6) {
        const bcr = clamp(
          num(options.boltCircleRadius, 0.5 * (gear.outerRadius + outerR)),
          gear.outerRadius + mod * 0.6,
          outerR - mod * 0.6,
        );
        const maxBoltR =
          Math.min(
            outerR - bcr,
            bcr - gear.outerRadius,
            bcr * Math.sin(Math.PI / Math.max(2, bCount)),
          ) * 0.7;
        const boltR = clamp(
          pickDia(options.boltHoleDiameter, options.boltHoleRadius, maxBoltR) * 0.5,
          0,
          maxBoltR,
        );
        if (boltR > 1e-5) {
          for (let i = 0; i < bCount; i++) {
            const a = (i * TAU) / bCount;
            holes.push(
              circlePts(boltR, 12, bcr * Math.cos(a), bcr * Math.sin(a), false),
            );
          }
        }
      }

      applyBuffers(
        this,
        extrude2DWithHoles(outerCircle, holes, thickness),
        'InternalRingGearGeometry',
        {
          module: mod,
          teeth,
          outerRadius: outerR,
          pressureAngleDeg,
          thickness,
          internal: true,
          pitchRadius: gear.pitchRadius,
          innerTipRadius: gear.rootRadius,
          rootRadius: gear.outerRadius,
        },
      );
    }
  }

  class RackGeometry extends BufferGeometry {
    constructor(options: RackOptions = {}) {
      super();
      const mod = clamp(num(options.module, 0.01), 1e-4, 10);
      const teeth = clampInt(options.teeth, 2, MAX_TEETH, 12);
      const pressureAngleDeg = clamp(num(options.pressureAngleDeg, 20), 12, 32);
      const thickness = clamp(num(options.thickness ?? options.width, mod * 3), 1e-4, 20);
      const backHeight = clamp(num(options.backHeight, mod * 2.5), mod * 0.5, 20);

      const cp = Math.PI * mod;
      const totalLen = teeth * cp;
      const alpha = (pressureAngleDeg * Math.PI) / 180;
      const tanA = Math.tan(alpha);
      const add = mod;
      const ded = 1.25 * mod;
      const totalH = backHeight + ded + add;
      const yBot = -totalH * 0.5;
      const yRoot = yBot + backHeight;
      const yPitch = yRoot + ded;
      const yTip = yPitch + add;

      // Build rack profile in (x, y) and extrude along Z (`z ∈ [-thickness/2, +thickness/2]`)
      // by building in (u=x, v=y) with extrude2DWithHoles then rotating +90° around X!
      const halfTooth = cp * 0.245;
      const dxDed = ded * tanA;
      const dxAdd = add * tanA;
      const x0 = -totalLen * 0.5;

      const contour: Pt2[] = [[x0, yBot], [x0 + totalLen, yBot], [x0 + totalLen, yRoot]];
      for (let i = teeth - 1; i >= 0; i--) {
        const cx = x0 + (i + 0.5) * cp;
        const rRight = Math.min(cx + cp * 0.48, cx + halfTooth + dxDed);
        const tRight = Math.max(cx + cp * 0.04, cx + halfTooth - dxAdd);
        const tLeft = Math.min(cx - cp * 0.04, cx - halfTooth + dxAdd);
        const rLeft = Math.max(cx - cp * 0.48, cx - halfTooth - dxDed);
        contour.push(
          [rRight, yRoot],
          [tRight, yTip],
          [tLeft, yTip],
          [rLeft, yRoot],
        );
      }
      contour.push([x0, yRoot]);

      const raw = extrude2DWithHoles(contour, [], thickness);
      // Map (x=u, y_ext, z=-v) -> (x=u, y=v=-z_old, z=y_ext) (90° rotation around +X: (x,y,z)->(x,-z,y), determinant +1!).
      for (let i = 0; i < raw.pos.length; i += 3) {
        const py = raw.pos[i + 1];
        const pz = raw.pos[i + 2];
        raw.pos[i + 1] = -pz;
        raw.pos[i + 2] = py;
        const ny = raw.nrm[i + 1];
        const nz = raw.nrm[i + 2];
        raw.nrm[i + 1] = -nz;
        raw.nrm[i + 2] = ny;
      }

      applyBuffers(this, raw, 'RackGeometry', {
        module: mod,
        teeth,
        pressureAngleDeg,
        thickness,
        backHeight,
        length: totalLen,
        height: totalH,
        pitchY: yPitch,
      });
    }
  }

  class PulleyGeometry extends BufferGeometry {
    constructor(options: PulleyOptions = {}) {
      super();
      const pitchR = clamp(num(options.pitchRadius, 0.06), 0.004, 10);
      const grooves = clampInt(options.grooves, 1, 16, 1);
      const width = clamp(num(options.width, 0.018 * grooves + 0.008), 0.003, 10);
      const flangeH = clamp(
        options.flangeHeight != null
          ? num(options.flangeHeight, pitchR * 0.08)
          : options.flangeRadius != null
            ? num(options.flangeRadius, pitchR * 1.08) - pitchR
            : pitchR * 0.08,
        0.001,
        pitchR * 0.5,
      );
      const outerR = pitchR + flangeH;
      const gDepth = clamp(
        num(options.grooveDepth, Math.min(pitchR * 0.22, (width / grooves) * 0.65)),
        0.001,
        pitchR * 0.6,
      );
      const gAngle = (clamp(num(options.grooveAngleDeg, 38), 18, 70) * Math.PI) / 180;
      const boreR = clamp(
        pickDia(options.bore, options.boreRadius, pitchR * 0.25) * 0.5,
        0,
        (outerR - gDepth) * 0.78,
      );
      const hubR = clamp(
        num(options.hubRadius, Math.max(boreR * 1.7, pitchR * 0.36)),
        boreR + 0.001,
        (outerR - gDepth) * 0.9,
      );
      const hubW = clamp(num(options.hubWidth, width * 1.25), width * 0.6, width * 3);
      const radialSegs = clampInt(options.radialSegments, 12, MAX_RAD_SEGS, 48);

      const hW = width * 0.5;
      const hHub = hubW * 0.5;
      const rimLand = Math.min(width * 0.12, 0.004);
      const gSpan = (width - 2 * rimLand) / grooves;
      const halfTop = Math.min(gSpan * 0.44, gDepth * Math.tan(gAngle * 0.5) + gSpan * 0.14);
      const halfBot = Math.max(halfTop * 0.22, halfTop - gDepth * Math.tan(gAngle * 0.5));

      const recessR = outerR - gDepth - Math.max(0.002, (outerR - gDepth - hubR) * 0.25);
      const hasWebRecess = recessR > hubR + 0.002 && width > 0.01;
      const webHalfT = width * 0.25;

      // Build CCW (r, y) profile: bottom -> outer grooved rim -> top -> inner bore.
      const pts: Pt2[] = [[boreR, -hHub], [hubR, -hHub]];
      if (hasWebRecess) {
        pts.push([hubR, -webHalfT], [recessR, -webHalfT], [recessR, -hW]);
      } else if (Math.abs(hHub - hW) > 1e-6) {
        pts.push([hubR, -hW]);
      }
      pts.push([outerR, -hW]);
      for (let g = 0; g < grooves; g++) {
        const cy = -hW + rimLand + (g + 0.5) * gSpan;
        pts.push(
          [outerR, cy - halfTop],
          [outerR - gDepth, cy - halfBot],
          [outerR - gDepth, cy + halfBot],
          [outerR, cy + halfTop],
        );
      }
      pts.push([outerR, hW]);
      if (hasWebRecess) {
        pts.push([recessR, hW], [recessR, webHalfT], [hubR, webHalfT]);
      } else if (Math.abs(hHub - hW) > 1e-6) {
        pts.push([hubR, hW]);
      }
      pts.push([hubR, hHub], [boreR, hHub]);

      applyBuffers(
        this,
        revolveClosedProfile(pts, radialSegs),
        'PulleyGeometry',
        {
          pitchRadius: pitchR,
          outerRadius: outerR,
          width,
          grooves,
          grooveDepth: gDepth,
          bore: boreR * 2,
          hubRadius: hubR,
          hubWidth: hubW,
        },
      );
    }
  }

  class BoltGeometry extends BufferGeometry {
    constructor(options: BoltOptions = {}) {
      super();
      const iso = metricFastener(options.preset ?? 'M6', options.scale ?? 1);
      const headType = options.headType ?? 'hex';
      const d = clamp(num(options.threadDiameter, iso.threadDiameter), 1e-4, 2);
      const pitch = clamp(num(options.pitch, iso.pitch), d * 0.04, d * 0.4);
      const length = clamp(
        num(options.length, iso.length ?? d * 3.5),
        d * 0.6,
        50,
      );
      const stdThreadLen = Math.min(length, 2 * d + 0.006 * (options.scale ?? 1));
      const threadLen = clamp(
        num(options.threadedLength, stdThreadLen),
        0,
        length,
      );
      const cosmetic = options.cosmeticThreads !== false;
      const origin = options.origin ?? 'bearing';
      const radialSegs = clampInt(options.radialSegments, 12, MAX_RAD_SEGS, 24);

      const rMajor = d * 0.5;
      const rMinor = rMajor - Math.min(rMajor * 0.35, 0.54 * pitch);
      const tipChamfer = Math.min(pitch * 0.8, length * 0.25);

      // Build shank profile in (r, y) for y in [-length, 0] (head sits above y = 0).
      const shankPts: Pt2[] = [[0, -length], [rMinor, -length]];
      const yThreadStart = -length + tipChamfer;
      const yThreadEnd = -length + threadLen;
      shankPts.push([rMajor, yThreadStart]);

      if (cosmetic && threadLen > pitch * 1.5) {
        const maxRings = 14;
        const stepP = Math.max(pitch, (yThreadEnd - yThreadStart) / maxRings);
        const nRings = Math.floor((yThreadEnd - yThreadStart) / stepP);
        const grooveD = rMajor - rMinor;
        for (let k = 0; k < nRings; k++) {
          const y0 = yThreadStart + k * stepP;
          shankPts.push(
            [rMajor, y0 + stepP * 0.12],
            [rMajor - grooveD, y0 + stepP * 0.5],
            [rMajor, y0 + stepP * 0.88],
          );
        }
      }
      if (yThreadEnd < -1e-6) {
        shankPts.push([rMajor, yThreadEnd], [rMajor, 0]);
      } else {
        shankPts.push([rMajor, 0]);
      }

      const meshes: RawMeshBuffers[] = [];
      let headH = iso.hexHeadHeight;
      let totalTopY = headH;

      if (headType === 'hex') {
        const af = clamp(num(options.acrossFlats, iso.acrossFlats), d * 1.2, d * 4);
        headH = clamp(num(options.headHeight, iso.hexHeadHeight), d * 0.2, d * 3);
        const washerLip = headH * 0.08;
        const hexBodyH = headH * 0.78;
        const topChamferH = headH - washerLip - hexBodyH;
        shankPts.push(
          [af * 0.48, 0],
          [af * 0.48, washerLip],
          [0, washerLip],
        );
        meshes.push(revolveClosedProfile(shankPts, radialSegs));
        // Extruded 6-sided hex prism + top chamfer frustum
        meshes.push(
          translateRawY(
            extrude2DWithHoles(hexPts(af, true), [], hexBodyH),
            washerLip + hexBodyH * 0.5,
          ),
        );
        if (topChamferH > 1e-6) {
          meshes.push(
            revolveClosedProfile(
              [
                [0, washerLip + hexBodyH],
                [af * 0.5, washerLip + hexBodyH],
                [af * 0.42, headH],
                [0, headH],
              ],
              radialSegs,
            ),
          );
        }
        totalTopY = headH;
      } else if (headType === 'socket' || headType === 'button') {
        const isBtn = headType === 'button';
        const hDia = clamp(
          num(
            options.headDiameter,
            isBtn ? iso.buttonHeadDiameter : iso.socketHeadDiameter,
          ),
          d * 1.15,
          d * 4,
        );
        headH = clamp(
          num(
            options.headHeight,
            isBtn ? iso.buttonHeadHeight : iso.socketHeadHeight,
          ),
          d * 0.25,
          d * 3,
        );
        const hR = hDia * 0.5;
        const topRimR = isBtn ? hR * 0.76 : hR * 0.94;
        const sockAF = clamp(
          num(options.socketAcrossFlats, iso.socketKeyAcrossFlats),
          d * 0.3,
          topRimR * 1.35,
        );
        const sockDepth = headH * 0.52;
        shankPts.push([hR, 0]);
        if (isBtn) {
          shankPts.push(
            [hR * 0.98, headH * 0.35],
            [hR * 0.9, headH * 0.72],
            [topRimR, headH],
          );
        } else {
          const ch = Math.min(headH * 0.08, hR - topRimR);
          shankPts.push([hR, headH - ch], [topRimR, headH]);
        }
        meshes.push(
          revolveOpenChain(shankPts, radialSegs),
          buildRecessedHexSocketTop(topRimR, sockAF, headH, sockDepth, radialSegs),
        );
        totalTopY = headH;
      } else {
        // Countersunk flat-head screw: true conical head tapering from shank (-headH) up to flush rim (y = 0)
        const hDia = clamp(
          num(options.headDiameter, iso.countersunkHeadDiameter),
          d * 1.25,
          d * 4,
        );
        headH = clamp(
          num(options.headHeight, iso.countersunkHeadHeight),
          d * 0.2,
          Math.min(d * 2, length * 0.6),
        );
        const hR = hDia * 0.5;
        const sockAF = clamp(
          num(options.socketAcrossFlats, iso.socketKeyAcrossFlats * 0.85),
          d * 0.25,
          hDia * 0.55,
        );
        const sockDepth = headH * 0.55;
        shankPts.pop();
        shankPts.push([rMajor, -headH], [hR, 0]);
        meshes.push(
          revolveOpenChain(shankPts, radialSegs),
          buildRecessedHexSocketTop(hR, sockAF, 0, sockDepth, radialSegs),
        );
        totalTopY = 0;
      }

      const merged = mergeRaw(meshes);
      if (origin === 'center') {
        translateRawY(merged, -(totalTopY - length) * 0.5);
      }

      applyBuffers(this, merged, 'BoltGeometry', {
        preset: iso.preset,
        headType,
        threadDiameter: d,
        pitch,
        length,
        threadedLength: threadLen,
        headHeight: headH,
        totalLength: totalTopY + length,
        origin,
      });
    }
  }

  class NutGeometry extends BufferGeometry {
    constructor(options: NutOptions = {}) {
      super();
      const iso = metricFastener(options.preset ?? 'M6', options.scale ?? 1);
      const d = clamp(num(options.threadDiameter, iso.threadDiameter), 1e-4, 2);
      const pitch = clamp(num(options.pitch, iso.pitch), d * 0.04, d * 0.4);
      const af = clamp(num(options.acrossFlats, iso.acrossFlats), d * 1.25, d * 4);
      const thickness = clamp(num(options.thickness, iso.nutThickness), d * 0.25, d * 3);
      const flanged = Boolean(options.flanged || options.nutType === 'flange');
      const nyloc = Boolean(options.nyloc || options.nutType === 'nyloc');
      const radialSegs = clampInt(options.radialSegments, 12, MAX_RAD_SEGS, 32);

      const boreR = d * 0.5 - (options.cosmeticThreads === false ? 0 : pitch * 0.25);
      const hexH = thickness * (flanged ? 0.78 : 1.0);
      const flangeH = flanged ? thickness * 0.22 : 0;
      const nylocH = nyloc ? thickness * 0.35 : 0;
      const totalH = hexH + flangeH + nylocH;
      const yBase = -totalH * 0.5;

      const meshes: RawMeshBuffers[] = [];
      const hole = circlePts(boreR, radialSegs, 0, 0, false);

      if (flanged) {
        const fR = Math.max(af * 0.65, num(options.flangeDiameter, af * 1.35) * 0.5);
        meshes.push(
          revolveClosedProfile(
            [
              [boreR, yBase],
              [fR, yBase],
              [fR, yBase + flangeH * 0.65],
              [af * 0.5, yBase + flangeH],
              [boreR, yBase + flangeH],
            ],
            radialSegs,
          ),
        );
      }

      meshes.push(
        translateRawY(
          extrude2DWithHoles(hexPts(af, true), [hole], hexH),
          yBase + flangeH + hexH * 0.5,
        ),
      );

      if (nyloc) {
        const yN0 = yBase + flangeH + hexH;
        const rCollar = af * 0.49;
        meshes.push(
          revolveClosedProfile(
            [
              [boreR, yN0],
              [rCollar, yN0],
              [rCollar, yN0 + nylocH * 0.55],
              [rCollar * 0.82, yN0 + nylocH],
              [boreR, yN0 + nylocH],
            ],
            radialSegs,
          ),
        );
      }

      applyBuffers(this, mergeRaw(meshes), 'NutGeometry', {
        preset: iso.preset,
        threadDiameter: d,
        pitch,
        acrossFlats: af,
        thickness: totalH,
        flanged,
        nyloc,
      });
    }
  }

  class WasherGeometry extends BufferGeometry {
    constructor(options: WasherOptions = {}) {
      super();
      const iso = metricFastener(options.preset ?? 'M6', options.scale ?? 1);
      const id = clamp(num(options.innerDiameter, iso.washerInnerDiameter), 1e-4, 10);
      const od = Math.max(id * 1.15, num(options.outerDiameter, iso.washerOuterDiameter));
      const t = clamp(num(options.thickness, iso.washerThickness), 1e-4, 2);
      const rIn = id * 0.5;
      const rOut = od * 0.5;
      const ch = clamp(
        num(options.chamfer, Math.min(t * 0.25, (rOut - rIn) * 0.2)),
        0,
        Math.min(t * 0.48, (rOut - rIn) * 0.45),
      );
      const radialSegs = clampInt(options.radialSegments, 12, MAX_RAD_SEGS, 36);
      const hT = t * 0.5;

      const pts: Pt2[] =
        ch > 1e-6
          ? [
              [rIn, -hT],
              [rOut, -hT],
              [rOut, hT - ch],
              [rOut - ch, hT],
              [rIn, hT],
            ]
          : [
              [rIn, -hT],
              [rOut, -hT],
              [rOut, hT],
              [rIn, hT],
            ];

      applyBuffers(this, revolveClosedProfile(pts, radialSegs), 'WasherGeometry', {
        preset: iso.preset,
        innerDiameter: id,
        outerDiameter: od,
        thickness: t,
        chamfer: ch,
      });
    }
  }

  class ShaftGeometry extends BufferGeometry {
    constructor(options: ShaftOptions = {}) {
      super();
      const segInput = options.segments ?? options.steps;
      const rawSegs =
        Array.isArray(segInput) && segInput.length > 0
          ? segInput.slice(0, 32)
          : [
              {
                diameter: pickDia(options.diameter, options.radius, 0.02),
                length: num(options.length, 0.12),
                chamfer: options.chamfer,
              },
            ];
      const segs = rawSegs.map((s) => ({
        r: clamp(pickDia(s?.diameter, s?.radius, 0.02), 1e-4, 10) * 0.5,
        len: clamp(num(s?.length, 0.04), 1e-4, 50),
        ch: Math.max(0, num(s?.chamfer, num(options.chamfer, 0))),
      }));
      const totalLen = segs.reduce((acc, s) => acc + s.len, 0);
      const minR = segs.reduce((m, s) => (s.r < m ? s.r : m), Infinity);
      const boreR = clamp(
        pickDia(options.bore, options.boreRadius, 0) * 0.5,
        0,
        minR * 0.85,
      );
      const dCut = clamp(num(options.dCut, 0), 0, (minR - boreR) * 0.6);
      const radialSegs = clampInt(options.radialSegments, 12, MAX_RAD_SEGS, 36);

      if (dCut > 1e-6 && segs.length === 1) {
        // D-shaft flat along full length via 2D clipped circle extrusion
        const r = segs[0].r;
        const xFlat = r - dCut;
        const halfY = Math.sqrt(Math.max(0, r * r - xFlat * xFlat));
        const startAng = Math.atan2(halfY, xFlat);
        const endAng = TAU - startAng;
        const outer: Pt2[] = [[xFlat, -halfY], [xFlat, halfY]];
        for (let i = 1; i < radialSegs; i++) {
          const a = startAng + ((endAng - startAng) * i) / radialSegs;
          outer.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        const holes = boreR > 1e-6 ? [circlePts(boreR, radialSegs, 0, 0, false)] : [];
        applyBuffers(
          this,
          extrude2DWithHoles(outer, holes, totalLen),
          'ShaftGeometry',
          {
            totalLength: totalLen,
            bore: boreR * 2,
            dCut,
            segmentCount: 1,
          },
        );
        return;
      }

      const y0 = -totalLen * 0.5;
      const pts: Pt2[] = [[boreR, y0]];
      let y = y0;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const chBot =
          i === 0
            ? Math.min(s.ch || s.r * 0.08, s.len * 0.3, (s.r - boreR) * 0.4)
            : 0;
        const chTop =
          i === segs.length - 1
            ? Math.min(s.ch || s.r * 0.08, s.len * 0.3, (s.r - boreR) * 0.4)
            : 0;
        if (chBot > 1e-6) {
          pts.push([s.r - chBot, y], [s.r, y + chBot]);
        } else {
          pts.push([s.r, y]);
        }
        if (chTop > 1e-6) {
          pts.push([s.r, y + s.len - chTop], [s.r - chTop, y + s.len]);
        } else {
          pts.push([s.r, y + s.len]);
        }
        y += s.len;
      }
      pts.push([boreR, y0 + totalLen]);

      applyBuffers(
        this,
        revolveClosedProfile(pts, radialSegs),
        'ShaftGeometry',
        {
          totalLength: totalLen,
          bore: boreR * 2,
          dCut: 0,
          segmentCount: segs.length,
        },
      );
    }
  }

  function buildUvSphere(
    cx: number,
    cy: number,
    cz: number,
    r: number,
    wSeg: number,
    hSeg: number,
  ): RawMeshBuffers {
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let iy = 0; iy <= hSeg; iy++) {
      const v = iy / hSeg;
      const theta = v * Math.PI;
      const st = Math.sin(theta);
      const ct = Math.cos(theta);
      for (let ix = 0; ix <= wSeg; ix++) {
        const u = ix / wSeg;
        const phi = u * TAU;
        const nx = st * Math.cos(phi);
        const ny = ct;
        const nz = -st * Math.sin(phi);
        pos.push(cx + r * nx, cy + r * ny, cz + r * nz);
        nrm.push(nx, ny, nz);
        uv.push(u, 1 - v);
      }
    }
    const stride = wSeg + 1;
    for (let iy = 0; iy < hSeg; iy++) {
      for (let ix = 0; ix < wSeg; ix++) {
        const a = iy * stride + ix;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        if (iy !== 0) idx.push(a, d, b);
        if (iy !== hSeg - 1) idx.push(a, c, d);
      }
    }
    return {pos, nrm, uv, idx};
  }

  class BearingGeometry extends BufferGeometry {
    constructor(options: BearingOptions = {}) {
      super();
      const id = clamp(
        pickDia(options.innerDiameter, options.innerRadius, 0.02),
        0.002,
        5,
      );
      const od = Math.max(
        id * 1.35,
        pickDia(options.outerDiameter, options.outerRadius, id * 2.1),
      );
      const w = clamp(num(options.width, (od - id) * 0.65), 0.002, 5);
      const shielded = Boolean(options.shielded);
      const flanged = Boolean(options.flanged);
      const radialSegs = clampInt(options.radialSegments, 16, MAX_RAD_SEGS, 28);

      const rIn = id * 0.5;
      const rOut = od * 0.5;
      const span = rOut - rIn;
      const raceT = span * 0.24;
      const rInnerOuter = rIn + raceT;
      const rOuterInner = rOut - raceT;
      const rPitch = 0.5 * (rIn + rOut);
      const hW = w * 0.5;
      const grooveH = w * 0.34;

      const meshes: RawMeshBuffers[] = [];

      if (shielded) {
        // Single clean sealed bearing profile with recessed metallic dust shields
        const recessY = hW * 0.82;
        meshes.push(
          revolveClosedProfile(
            [
              [rIn, -hW],
              [rInnerOuter, -hW],
              [rInnerOuter, -recessY],
              [rOuterInner, -recessY],
              [rOuterInner, -hW],
              [rOut, -hW],
              ...(flanged
                ? ([
                    [rOut, hW - w * 0.2],
                    [Math.max(rOut * 1.12, num(options.flangeDiameter, od * 1.12) * 0.5), hW - w * 0.2],
                    [Math.max(rOut * 1.12, num(options.flangeDiameter, od * 1.12) * 0.5), hW],
                  ] as Pt2[])
                : []),
              [rOut, hW],
              [rOuterInner, hW],
              [rOuterInner, recessY],
              [rInnerOuter, recessY],
              [rInnerOuter, hW],
              [rIn, hW],
            ],
            radialSegs,
          ),
        );
      } else {
        // Inner race with outer ball groove
        meshes.push(
          revolveClosedProfile(
            [
              [rIn, -hW],
              [rInnerOuter, -hW],
              [rInnerOuter, -grooveH],
              [rInnerOuter - raceT * 0.22, 0],
              [rInnerOuter, grooveH],
              [rInnerOuter, hW],
              [rIn, hW],
            ],
            radialSegs,
          ),
        );
        // Outer race (with optional mounting flange) and inner ball groove
        const fR = Math.max(
          rOut * 1.12,
          num(options.flangeDiameter, od * 1.12) * 0.5,
        );
        const fW = clamp(num(options.flangeWidth, w * 0.2), w * 0.08, w * 0.5);
        meshes.push(
          revolveClosedProfile(
            [
              [rOuterInner, -hW],
              [rOut, -hW],
              ...(flanged
                ? ([
                    [rOut, hW - fW],
                    [fR, hW - fW],
                    [fR, hW],
                  ] as Pt2[])
                : ([[rOut, hW]] as Pt2[])),
              [rOuterInner, hW],
              [rOuterInner, grooveH],
              [rOuterInner + raceT * 0.22, 0],
              [rOuterInner, -grooveH],
            ],
            radialSegs,
          ),
        );
        // Rolling balls
        const ballR = Math.min(span * 0.3, w * 0.36);
        const maxBalls = Math.max(
          3,
          Math.floor((TAU * rPitch) / Math.max(1e-5, ballR * 2.35)),
        );
        const nBalls = clampInt(options.balls, 3, Math.min(36, maxBalls), Math.min(10, maxBalls));
        for (let i = 0; i < nBalls; i++) {
          const a = (i * TAU) / nBalls;
          meshes.push(
            buildUvSphere(
              rPitch * Math.cos(a),
              0,
              -rPitch * Math.sin(a),
              ballR,
              10,
              6,
            ),
          );
        }
      }

      applyBuffers(this, mergeRaw(meshes), 'BearingGeometry', {
        innerDiameter: id,
        outerDiameter: od,
        width: w,
        pitchDiameter: rPitch * 2,
        shielded,
        flanged,
      });
    }
  }

  class HelicalSpringGeometry extends BufferGeometry {
    constructor(options: HelicalSpringOptions = {}) {
      super();
      const meanR = clamp(num(options.meanRadius, 0.025), 0.001, 10);
      const wireR = clamp(
        num(options.wireRadius, meanR * 0.16),
        1e-4,
        meanR * 0.85,
      );
      const coils = clamp(num(options.coils, 6), 0.5, MAX_COILS);
      const minLen = (coils + 1) * wireR * 2.05;
      const length = Math.max(minLen * 0.5, clamp(num(options.length, meanR * 4), wireR * 2.2, 50));
      const flatEnds = options.flatEnds !== false;
      const radSegs = clampInt(options.radialSegments, 6, 32, 10);
      const tubSegs = clampInt(
        options.tubularSegments,
        16,
        1024,
        Math.min(384, Math.max(24, Math.round(coils * 16))),
      );

      // Centerline points along +Y in [-length/2 + wireR, +length/2 - wireR]
      const ySpan = Math.max(wireR * 0.2, length - 2 * wireR);
      const path: Array<[number, number, number]> = [];
      const totalTurns = flatEnds ? coils + 1.0 : coils;
      for (let i = 0; i <= tubSegs; i++) {
        const u = i / tubSegs;
        const phi = u * totalTurns * TAU;
        // Smooth S-curve end transitions when flatEnds is true so end coils lie nearly flat!
        const s = flatEnds
          ? u < 0.08
            ? 0.02 * (u / 0.08)
            : u > 0.92
              ? 0.98 + 0.02 * ((u - 0.92) / 0.08)
              : 0.02 + 0.96 * ((u - 0.08) / 0.84)
          : u;
        const y = (s - 0.5) * ySpan;
        path.push([meanR * Math.cos(phi), y, -meanR * Math.sin(phi)]);
      }

      // Parallel-transport (Bishop) frames along path -> zero Frenet twist flips!
      const tangents: Array<[number, number, number]> = [];
      for (let i = 0; i <= tubSegs; i++) {
        const p0 = path[Math.max(0, i - 1)];
        const p1 = path[Math.min(tubSegs, i + 1)];
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const dz = p1[2] - p0[2];
        const tl = Math.hypot(dx, dy, dz) || 1;
        tangents.push([dx / tl, dy / tl, dz / tl]);
      }

      let nx = 1;
      let ny = 0;
      let nz = 0;
      {
        const t0 = tangents[0];
        // Orthogonalize initial normal against t0 (prefer radial +X or +Y)
        const ax = Math.abs(t0[0]) < 0.9 ? 1 : 0;
        const ay = Math.abs(t0[0]) < 0.9 ? 0 : 1;
        const dot = ax * t0[0] + ay * t0[1];
        nx = ax - dot * t0[0];
        ny = ay - dot * t0[1];
        nz = -dot * t0[2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }

      const pos: number[] = [];
      const nrm: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];

      for (let i = 0; i <= tubSegs; i++) {
        const t = tangents[i];
        if (i > 0) {
          const prevT = tangents[i - 1];
          // Cross prevT x t = rotation axis
          const vx = prevT[1] * t[2] - prevT[2] * t[1];
          const vy = prevT[2] * t[0] - prevT[0] * t[2];
          const vz = prevT[0] * t[1] - prevT[1] * t[0];
          const sinA = Math.hypot(vx, vy, vz);
          if (sinA > 1e-7) {
            const kx = vx / sinA;
            const ky = vy / sinA;
            const kz = vz / sinA;
            const cosA = clamp(
              prevT[0] * t[0] + prevT[1] * t[1] + prevT[2] * t[2],
              -1,
              1,
            );
            const kDotN = kx * nx + ky * ny + kz * nz;
            const cx = ky * nz - kz * ny;
            const cy = kz * nx - kx * nz;
            const cz = kx * ny - ky * nx;
            nx = nx * cosA + cx * sinA + kx * kDotN * (1 - cosA);
            ny = ny * cosA + cy * sinA + ky * kDotN * (1 - cosA);
            nz = nz * cosA + cz * sinA + kz * kDotN * (1 - cosA);
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
          }
        }
        // Binormal B = T x N
        const bx = t[1] * nz - t[2] * ny;
        const by = t[2] * nx - t[0] * nz;
        const bz = t[0] * ny - t[1] * nx;
        const c = path[i];
        const uCoord = i / tubSegs;

        for (let j = 0; j <= radSegs; j++) {
          const vCoord = j / radSegs;
          const ang = vCoord * TAU;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const rnx = ca * nx + sa * bx;
          const rny = ca * ny + sa * by;
          const rnz = ca * nz + sa * bz;
          pos.push(
            c[0] + wireR * rnx,
            c[1] + wireR * rny,
            c[2] + wireR * rnz,
          );
          nrm.push(rnx, rny, rnz);
          uv.push(uCoord * coils, vCoord);
        }
      }

      const stride = radSegs + 1;
      for (let i = 0; i < tubSegs; i++) {
        for (let j = 0; j < radSegs; j++) {
          const a = i * stride + j;
          const b = (i + 1) * stride + j;
          const c = (i + 1) * stride + j + 1;
          const d = i * stride + j + 1;
          idx.push(a, d, c, a, c, b);
        }
      }

      // Close start & end wire caps cleanly
      for (const isEnd of [false, true]) {
        const i = isEnd ? tubSegs : 0;
        const pCenter = path[i];
        const t = tangents[i];
        const sgn = isEnd ? 1 : -1;
        const centerIdx = (pos.length / 3) | 0;
        pos.push(pCenter[0], pCenter[1], pCenter[2]);
        nrm.push(t[0] * sgn, t[1] * sgn, t[2] * sgn);
        uv.push(0.5, 0.5);
        const ringBase = (pos.length / 3) | 0;
        for (let j = 0; j <= radSegs; j++) {
          const src = (i * stride + j) * 3;
          pos.push(pos[src], pos[src + 1], pos[src + 2]);
          nrm.push(t[0] * sgn, t[1] * sgn, t[2] * sgn);
          const ang = (j / radSegs) * TAU;
          uv.push(0.5 + 0.5 * Math.cos(ang), 0.5 + 0.5 * Math.sin(ang));
        }
        for (let j = 0; j < radSegs; j++) {
          if (isEnd) {
            idx.push(centerIdx, ringBase + j, ringBase + j + 1);
          } else {
            idx.push(centerIdx, ringBase + j + 1, ringBase + j);
          }
        }
      }

      applyBuffers(this, {pos, nrm, uv, idx}, 'HelicalSpringGeometry', {
        meanRadius: meanR,
        wireRadius: wireR,
        coils,
        length,
        flatEnds,
      });
    }
  }

  class FlangePlateGeometry extends BufferGeometry {
    constructor(options: FlangePlateOptions = {}) {
      super();
      const outerR = clamp(num(options.outerRadius, 0.08), 0.004, 20);
      const thickness = clamp(num(options.thickness, outerR * 0.2), 1e-4, 10);
      const boreR = clamp(
        pickDia(options.bore, options.boreRadius, outerR * 0.7) * 0.5,
        0,
        outerR * 0.85,
      );
      const radialSegs = clampInt(options.radialSegments, 16, MAX_RAD_SEGS, 36);

      const rawNeckR = num(options.neckRadius ?? options.hubRadius, 0);
      const neckR = clamp(rawNeckR, boreR + 0.001, outerR * 0.9);
      const neckH = clamp(num(options.neckHeight ?? options.hubHeight, 0), 0, 10);
      const hasNeck = rawNeckR > boreR && neckH > 1e-6;

      const holes: Pt2[][] = [];
      if (boreR > 1e-6) {
        holes.push(circlePts(boreR, radialSegs, 0, 0, false));
      }

      const bCount = clampInt(options.boltCount ?? options.boltHoles, 0, MAX_HOLES, 6);
      const innerClearR = hasNeck ? neckR : boreR;
      if (bCount > 0 && outerR - innerClearR > outerR * 0.12) {
        const bcr = clamp(
          num(options.boltCircleRadius, 0.5 * (innerClearR + outerR)),
          innerClearR + outerR * 0.05,
          outerR * 0.92,
        );
        const maxHoleR = Math.min(
          (outerR - bcr) * 0.72,
          (bcr - innerClearR) * 0.72,
          bcr * Math.sin(Math.PI / Math.max(2, bCount)) * 0.72,
        );
        const holeR = clamp(
          pickDia(options.boltHoleDiameter, options.boltHoleRadius, maxHoleR * 1.1) * 0.5,
          0,
          maxHoleR,
        );
        if (holeR > 1e-5) {
          for (let i = 0; i < bCount; i++) {
            const a = (i * TAU) / bCount;
            holes.push(
              circlePts(holeR, 12, bcr * Math.cos(a), bcr * Math.sin(a), false),
            );
          }
        }
      }

      const plate = extrude2DWithHoles(
        circlePts(outerR, radialSegs, 0, 0, true),
        holes,
        thickness,
      );
      const meshes: RawMeshBuffers[] = [plate];
      if (hasNeck) {
        const neckHoles =
          boreR > 1e-6 ? [circlePts(boreR, radialSegs, 0, 0, false)] : [];
        meshes.push(
          translateRawY(
            extrude2DWithHoles(
              circlePts(neckR, radialSegs, 0, 0, true),
              neckHoles,
              neckH,
              0,
              1,
              false,
              true,
            ),
            (thickness + neckH) * 0.5,
          ),
        );
      }

      applyBuffers(this, mergeRaw(meshes), 'FlangePlateGeometry', {
        outerRadius: outerR,
        thickness,
        bore: boreR * 2,
        boltCount: bCount,
        neckRadius: hasNeck ? neckR : 0,
        neckHeight: hasNeck ? neckH : 0,
      });
    }
  }

  class ProfileExtrusionGeometry extends BufferGeometry {
    constructor(options: ProfileExtrusionOptions = {}) {
      super();
      const profile: StructuralProfileKind = options.profile ?? 't-slot';
      const w = clamp(num(options.width, 0.04), 0.002, 10);
      const h = clamp(num(options.height, w), 0.002, 10);
      const len = clamp(num(options.length, 0.3), 0.002, 50);
      const minDim = Math.min(w, h);
      const t = clamp(
        num(options.wallThickness ?? options.thickness, minDim * 0.14),
        minDim * 0.03,
        minDim * 0.42,
      );
      const hw = w * 0.5;
      const hh = h * 0.5;

      let outer: Pt2[] = [];
      const holes: Pt2[][] = [];

      if (profile === 'i-beam') {
        const webHalf = t * 0.5;
        outer = [
          [-hw, -hh],
          [hw, -hh],
          [hw, -hh + t],
          [webHalf, -hh + t],
          [webHalf, hh - t],
          [hw, hh - t],
          [hw, hh],
          [-hw, hh],
          [-hw, hh - t],
          [-webHalf, hh - t],
          [-webHalf, -hh + t],
          [-hw, -hh + t],
        ];
      } else if (profile === 'c-channel') {
        outer = [
          [-hw, -hh],
          [hw, -hh],
          [hw, -hh + t],
          [-hw + t, -hh + t],
          [-hw + t, hh - t],
          [hw, hh - t],
          [hw, hh],
          [-hw, hh],
        ];
      } else if (profile === 'l-angle') {
        outer = [
          [-hw, -hh],
          [hw, -hh],
          [hw, -hh + t],
          [-hw + t, -hh + t],
          [-hw + t, hh],
          [-hw, hh],
        ];
      } else if (profile === 'rect-tube') {
        outer = [
          [-hw, -hh],
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
        ];
        holes.push([
          [-hw + t, -hh + t],
          [-hw + t, hh - t],
          [hw - t, hh - t],
          [hw - t, -hh + t],
        ]);
      } else {
        // 't-slot' (e.g. 2020 / 4040 aluminum profile with 4 undercut T-slots + center tap bore)
        const slotW = clamp(
          num(options.slotWidth, minDim * 0.28),
          minDim * 0.12,
          minDim * 0.42,
        );
        const hs = slotW * 0.5;
        const lipT = minDim * 0.08;
        const cavD = minDim * 0.24;
        const cavH = Math.min(minDim * 0.48, slotW * 1.45) * 0.5;
        // Build CCW perimeter across all 4 faces (+X, +Y, -X, -Y)
        outer = [
          // Bottom face (-Y) from left to right with T-slot
          [-hw, -hh],
          [-hs, -hh],
          [-hs, -hh + lipT],
          [-cavH, -hh + lipT],
          [-cavH, -hh + cavD],
          [cavH, -hh + cavD],
          [cavH, -hh + lipT],
          [hs, -hh + lipT],
          [hs, -hh],
          [hw, -hh],
          // Right face (+X) from bottom to top with T-slot
          [hw, -hs],
          [hw - lipT, -hs],
          [hw - lipT, -cavH],
          [hw - cavD, -cavH],
          [hw - cavD, cavH],
          [hw - lipT, cavH],
          [hw - lipT, hs],
          [hw, hs],
          [hw, hh],
          // Top face (+Y) from right to left with T-slot
          [hs, hh],
          [hs, hh - lipT],
          [cavH, hh - lipT],
          [cavH, hh - cavD],
          [-cavH, hh - cavD],
          [-cavH, hh - lipT],
          [-hs, hh - lipT],
          [-hs, hh],
          [-hw, hh],
          // Left face (-X) from top to bottom with T-slot
          [-hw, hs],
          [-hw + lipT, hs],
          [-hw + lipT, cavH],
          [-hw + cavD, cavH],
          [-hw + cavD, -cavH],
          [-hw + lipT, -cavH],
          [-hw + lipT, -hs],
          [-hw, -hs],
        ];
        const centerBoreR = minDim * 0.125;
        if (centerBoreR < minDim * 0.5 - cavD - minDim * 0.04) {
          holes.push(circlePts(centerBoreR, 20, 0, 0, false));
        }
      }

      applyBuffers(
        this,
        extrude2DWithHoles(outer, holes, len),
        'ProfileExtrusionGeometry',
        {
          profile,
          width: w,
          height: h,
          length: len,
          wallThickness: t,
        },
      );
    }
  }

  const CAD = {
    MAX_PART_TEETH: MAX_TEETH,
    MAX_PART_RADIAL_SEGMENTS: MAX_RAD_SEGS,
    MAX_PART_COILS: MAX_COILS,
    MAX_PART_HOLES: MAX_HOLES,
    metricFastener,
    gearMeshDistance,
    SpurGearGeometry,
    InternalRingGearGeometry,
    RackGeometry,
    PulleyGeometry,
    BoltGeometry,
    ScrewGeometry: BoltGeometry,
    NutGeometry,
    HexNutGeometry: NutGeometry,
    WasherGeometry,
    ShaftGeometry,
    BearingGeometry,
    HelicalSpringGeometry,
    FlangePlateGeometry,
    ProfileExtrusionGeometry,
  };

  for (const Ctor of [
    SpurGearGeometry,
    InternalRingGearGeometry,
    RackGeometry,
    PulleyGeometry,
    BoltGeometry,
    NutGeometry,
    WasherGeometry,
    ShaftGeometry,
    BearingGeometry,
    HelicalSpringGeometry,
    FlangePlateGeometry,
    ProfileExtrusionGeometry,
  ]) {
    try {
      Object.freeze(Ctor.prototype);
      Object.freeze(Ctor);
    } catch {
      // Ignore if host environment disallows freezing.
    }
  }
  try {
    Object.freeze(CAD);
  } catch {
    // Ignore if host environment disallows freezing.
  }

  const exportsMap = {
    CAD,
    ...CAD,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) {
      reg.authorNamespace = {};
    }
    Object.assign(reg.authorNamespace, exportsMap);
  } else {
    try {
      threeNs.CAD = CAD;
    } catch {
      // Frozen THREE proxy resolves via reg.authorNamespace.
    }
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` plugin registering parametric mechanical CAD
 * machine-part geometries (`THREE.CAD.*`) onto `THREE` and worker sandboxes.
 */
export const partsPlugin: ThreeLivePlugin = {
  name: 'parts',
  onRegister(): void {
    registerWorkerExtensionInstaller(installPartsExtension);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installPartsExtension(threeNs, reg);
    }
  },
};
