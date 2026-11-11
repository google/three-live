/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Science / Chemistry / Math Domain Kit
 * (`scienceKitPlugin` / `THREE.Science`).
 *
 * Self-contained watertight 2-manifold `BufferGeometry` generators for molecular
 * chemistry, crystallography, multivariable calculus, differential geometry,
 * physics vector fields, and structural biology:
 * - `elementSpec` (41 IUPAC elements: atomic number, covalent/vdW radii in Å, CPK hex color)
 * - `MoleculeGeometry` (ball-and-stick, space-filling, and licorice molecules incl. `caffeine` & `cyclohexane` chair)
 * - `CrystalLatticeGeometry` (`'sc' | 'bcc' | 'fcc' | 'hcp' | 'diamond' | 'nacl' | 'graphene' | 'perovskite'`)
 * - `AtomicOrbitalGeometry` (`'1s' | '2px' | '2py' | '2pz' | '3dz2' | '3dx2-y2' | '3dxz'` dual-phase lobes)
 * - `OpticalElementGeometry` (`'biconvex' | 'planoconvex' | 'biconcave' | 'planoconcave' | 'meniscus' | 'prism-equilateral' | 'prism-right-angle'`)
 * - `SurfacePlotGeometry` (watertight 3D surface plinth/shell `y = f(x, z)` with math presets)
 * - `ParametricSurfaceGeometry` (`'torus-knot' | 'dupin-cyclide' | 'spherical-harmonic' | 'twisted-torus'`)
 * - `VectorFieldGeometry` (3D arrow-glyph fields for `'dipole' | 'vortex' | 'saddle' | 'radial' | 'helical'` or custom `fn`)
 * - `Axes3DGeometry` (solid X/Y/Z arrow triad with tick collars & origin sphere)
 * - `DoubleHelixGeometry` (Watson-Crick B-DNA major/minor groove double helix + base-pair rungs)
 * - `RibbonGeometry` & `ribbonColorMap` (continuous Richardson protein/biopolymer cartoon ribbon morphing smoothly across `'coil' | 'helix' | 'sheet'` with arrow-tipped $\beta$-strands)
 *
 * NOTE: `installScienceKit` is serialized via `Function.prototype.toString()`
 * into sandboxed Web Workers and embedded in `three-author-engine.js`. Keep its
 * body 100% self-contained (no module-scoped runtime closures or ES2022 class fields).
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/** Maximum atoms in a single `MoleculeGeometry` or `CrystalLatticeGeometry`. */
export const MAX_SCI_ATOMS = 512;
/** Maximum grid divisions per axis on `SurfacePlotGeometry` / `ParametricSurfaceGeometry`. */
export const MAX_SCI_GRID = 128;
/** Maximum arrow glyphs in `VectorFieldGeometry`. */
export const MAX_SCI_GLYPHS = 1000;
/** Maximum base pairs in `DoubleHelixGeometry`. */
export const MAX_SCI_BASE_PAIRS = 256;
/** Maximum backbone guide points in `RibbonGeometry`. */
export const MAX_SCI_RIBBON_POINTS = 512;

/** IUPAC & CPK atomic metadata returned by `THREE.Science.elementSpec`. */
export interface ElementSpec {
  readonly symbol: string;
  readonly atomicNumber: number;
  readonly covalentRadius: number;
  readonly vdwRadius: number;
  readonly cpkColor: number;
  valueOf(): number;
}

/** Input atom descriptor for `MoleculeGeometry`. */
export interface MoleculeAtomSpec {
  element?: string | number;
  position: readonly [number, number, number];
  radius?: number;
}

/** Options for `THREE.Science.MoleculeGeometry`. */
export interface MoleculeOptions {
  preset?:
    | 'water'
    | 'methane'
    | 'ammonia'
    | 'co2'
    | 'ethene'
    | 'benzene'
    | 'ethanol'
    | 'cyclohexane'
    | 'caffeine';
  atoms?: readonly MoleculeAtomSpec[];
  bonds?: ReadonlyArray<readonly [number, number] | readonly [number, number, number]>;
  style?: 'ball-and-stick' | 'space-filling' | 'licorice';
  scale?: number;
  atomScale?: number;
  bondRadius?: number;
  sphereSegments?: number;
  vertexColors?: boolean;
}

/** Options for `THREE.Science.CrystalLatticeGeometry`. */
export interface CrystalLatticeOptions {
  lattice?:
    | 'sc'
    | 'bcc'
    | 'fcc'
    | 'hcp'
    | 'diamond'
    | 'nacl'
    | 'graphene'
    | 'perovskite';
  cells?: readonly [number, number, number] | number;
  latticeConstant?: number;
  atomRadius?: number;
  bondRadius?: number;
  includeBonds?: boolean;
  showUnitCell?: boolean;
  sphereSegments?: number;
  origin?: 'center' | 'corner';
}

/** Supported hydrogenic atomic orbital wavefunctions. */
export type AtomicOrbitalKind =
  | '1s'
  | '2px'
  | '2py'
  | '2pz'
  | '3dz2'
  | '3dx2-y2'
  | '3dxz';

/** Options for `THREE.Science.AtomicOrbitalGeometry`. */
export interface AtomicOrbitalOptions {
  orbital?: AtomicOrbitalKind;
  scale?: number;
  segments?: number;
  vertexColors?: boolean;
}

/** Supported optical lenses and prisms. */
export type OpticalElementKind =
  | 'biconvex'
  | 'planoconvex'
  | 'biconcave'
  | 'planoconcave'
  | 'meniscus'
  | 'prism-equilateral'
  | 'prism-right-angle';

/** Options for `THREE.Science.OpticalElementGeometry`. */
export interface OpticalElementOptions {
  kind?: OpticalElementKind;
  diameter?: number;
  thickness?: number;
  curvatureRadius1?: number;
  curvatureRadius2?: number;
  length?: number;
  radialSegments?: number;
}

/** Options for `THREE.Science.SurfacePlotGeometry`. */
export interface SurfacePlotOptions {
  preset?: 'sinc' | 'saddle' | 'gaussian' | 'ripple' | 'monkey-saddle';
  fn?: (x: number, z: number) => number;
  xRange?: readonly [number, number];
  zRange?: readonly [number, number];
  width?: number;
  depth?: number;
  heightScale?: number;
  segmentsX?: number;
  segmentsZ?: number;
  solid?: boolean;
  thickness?: number;
}

/** Options for `THREE.Science.ParametricSurfaceGeometry`. */
export interface ParametricSurfaceOptions {
  kind?:
    | 'torus-knot'
    | 'dupin-cyclide'
    | 'spherical-harmonic'
    | 'twisted-torus';
  radius?: number;
  tubeRadius?: number;
  p?: number;
  q?: number;
  l?: number;
  m?: number;
  amplitude?: number;
  twists?: number;
  uSegments?: number;
  vSegments?: number;
}

/** Options for `THREE.Science.VectorFieldGeometry`. */
export interface VectorFieldOptions {
  preset?: 'dipole' | 'vortex' | 'saddle' | 'radial' | 'helical';
  fn?: (x: number, y: number, z: number) => readonly [number, number, number];
  grid?: readonly [number, number, number] | number;
  span?: readonly [number, number, number] | number;
  arrowScale?: number;
  shaftRadius?: number;
}

/** Options for `THREE.Science.Axes3DGeometry`. */
export interface Axes3DOptions {
  length?: number;
  shaftRadius?: number;
  headRadius?: number;
  headLength?: number;
  symmetric?: boolean;
  ticks?: number;
}

/** Options for `THREE.Science.DoubleHelixGeometry`. */
export interface DoubleHelixOptions {
  turns?: number;
  basePairsPerTurn?: number;
  radius?: number;
  pitch?: number;
  backboneRadius?: number;
  rungRadius?: number;
  radialSegments?: number;
  origin?: 'center' | 'floor';
}

/** Secondary-structure regime along a `RibbonGeometry` polypeptide chain. */
export type RibbonSecondaryKind = 'coil' | 'helix' | 'sheet';

/** Inclusive `[from, to]` guide-point secondary-structure span for `RibbonGeometry`. */
export interface RibbonSpanSpec {
  from: number;
  to: number;
  kind: RibbonSecondaryKind;
}

/** Options for `THREE.Science.ribbonColorMap`. */
export interface RibbonColorMapOptions {
  scheme?: 'spectrum' | 'secondary' | 'plddt';
  kinds?: readonly RibbonSecondaryKind[];
  spans?: readonly RibbonSpanSpec[];
  pointCount?: number;
  width?: number;
}

/** Options for `THREE.Science.RibbonGeometry`. */
export interface RibbonOptions {
  points?: ReadonlyArray<
    readonly [number, number, number] | {x: number; y: number; z: number}
  >;
  kinds?: readonly RibbonSecondaryKind[];
  spans?: readonly RibbonSpanSpec[];
  normals?: ReadonlyArray<
    readonly [number, number, number] | {x: number; y: number; z: number}
  >;
  faceCenter?: readonly [number, number, number];
  closed?: boolean;
  coilRadius?: number;
  helixWidth?: number;
  helixThickness?: number;
  sheetWidth?: number;
  sheetThickness?: number;
  arrowHeadWidth?: number;
  arrowHeadFraction?: number;
  subdivisions?: number;
  profileSegments?: number;
  colorScheme?: 'spectrum' | 'secondary';
  scale?: number;
}

/**
 * Self-contained installer attaching `THREE.Science` onto a `THREE` namespace
 * and plugin registry.
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installScienceKit(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.BufferGeometry || !threeNs.BufferAttribute) {
    return null;
  }
  if (reg?.authorNamespace?.Science?.MoleculeGeometry) {
    return {Science: reg.authorNamespace.Science};
  }

  const BufferGeometry = threeNs.BufferGeometry;
  const BufferAttribute = threeNs.BufferAttribute;
  const Vector3 = threeNs.Vector3;
  const DataTexture = threeNs.DataTexture;

  const MAX_ATOMS = 512;
  const MAX_GRID = 128;
  const MAX_GLYPHS = 1000;
  const MAX_BP = 256;
  const MAX_RIBBON_PTS = 512;
  const TAU = Math.PI * 2;

  type Vec3 = [number, number, number];
  type Pt2 = [number, number];
  interface RawBufs {
    pos: number[];
    nrm: number[];
    uv: number[];
    idx: number[];
    col?: number[];
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

  // IUPAC covalent & van der Waals radii (Å) + Jmol/CPK hex color (41 elements):
  // [Z, symbol, covAngstrom, vdwAngstrom, cpkHex]
  const ELEMENTS: Array<[number, string, number, number, number]> = [
    [1, 'H', 0.31, 1.2, 0xffffff],
    [2, 'He', 0.28, 1.4, 0xd9ffff],
    [3, 'Li', 1.28, 1.82, 0xcc80ff],
    [4, 'Be', 0.96, 1.53, 0xc2ff00],
    [5, 'B', 0.84, 1.92, 0xffb5b5],
    [6, 'C', 0.76, 1.7, 0x334155],
    [7, 'N', 0.71, 1.55, 0x2563eb],
    [8, 'O', 0.66, 1.52, 0xdc2626],
    [9, 'F', 0.57, 1.47, 0x22c55e],
    [10, 'Ne', 0.58, 1.54, 0xb3e3f5],
    [11, 'Na', 1.66, 2.27, 0x8b5cf6],
    [12, 'Mg', 1.41, 1.73, 0x4ade80],
    [13, 'Al', 1.21, 1.84, 0xbfa6a6],
    [14, 'Si', 1.11, 2.1, 0x94a3b8],
    [15, 'P', 1.07, 1.8, 0xf97316],
    [16, 'S', 1.05, 1.8, 0xeab308],
    [17, 'Cl', 1.02, 1.75, 0x16a34a],
    [18, 'Ar', 1.06, 1.88, 0x80d1e3],
    [19, 'K', 2.03, 2.75, 0x8f40d4],
    [20, 'Ca', 1.76, 2.31, 0x10b981],
    [22, 'Ti', 1.6, 2.11, 0xbfc2c7],
    [24, 'Cr', 1.39, 2.06, 0x8a99c7],
    [25, 'Mn', 1.39, 2.05, 0x9c7ac7],
    [26, 'Fe', 1.32, 2.04, 0xb45309],
    [27, 'Co', 1.26, 2.0, 0xf090a0],
    [28, 'Ni', 1.24, 1.97, 0x50d050],
    [29, 'Cu', 1.32, 1.96, 0xd97706],
    [30, 'Zn', 1.22, 2.01, 0x7d80b0],
    [31, 'Ga', 1.22, 1.87, 0xc28f8f],
    [32, 'Ge', 1.2, 2.11, 0x668f8f],
    [33, 'As', 1.19, 1.85, 0xbd80e3],
    [34, 'Se', 1.2, 1.9, 0xffa100],
    [35, 'Br', 1.2, 1.85, 0x991b1b],
    [36, 'Kr', 1.16, 2.02, 0x5cb8d1],
    [46, 'Pd', 1.39, 2.1, 0x006985],
    [47, 'Ag', 1.45, 2.11, 0xe2e8f0],
    [53, 'I', 1.39, 1.98, 0x7e22ce],
    [78, 'Pt', 1.36, 2.13, 0xd0d0e0],
    [79, 'Au', 1.36, 2.14, 0xfbbf24],
    [82, 'Pb', 1.46, 2.02, 0x575961],
    [92, 'U', 1.96, 2.41, 0x008fff],
  ];

  function elementSpec(symbolOrZ: string | number = 'C'): ElementSpec {
    let row = ELEMENTS[5]; // Carbon default (Z = 6)
    if (typeof symbolOrZ === 'number' && Number.isFinite(symbolOrZ)) {
      const zTarget = Math.round(symbolOrZ);
      for (const r of ELEMENTS) {
        if (r[0] === zTarget) {
          row = r;
          break;
        }
      }
    } else {
      const sym = String(symbolOrZ ?? 'C').trim().toUpperCase();
      for (const r of ELEMENTS) {
        if (r[1].toUpperCase() === sym) {
          row = r;
          break;
        }
      }
    }
    const res: ElementSpec = {
      symbol: row[1],
      atomicNumber: row[0],
      covalentRadius: row[2],
      vdwRadius: row[3],
      cpkColor: row[4],
      valueOf: () => row[2],
    };
    Object.defineProperty(res, 'valueOf', {
      value: () => row[2],
      enumerable: false,
    });
    return res;
  }

  function hexToRgb(hex: number): Vec3 {
    return [
      ((hex >> 16) & 255) / 255,
      ((hex >> 8) & 255) / 255,
      (hex & 255) / 255,
    ];
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
    if (b.col && b.col.length === b.pos.length) {
      const colArr = nativeF32 ? nativeF32(b.col) : new Float32Array(b.col);
      geom.setAttribute('color', new BufferAttribute(colArr, 3));
    }
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

  function paintRaw(b: RawBufs, rgb: Vec3): RawBufs {
    const vCount = b.pos.length / 3;
    const col = new Array<number>(vCount * 3);
    for (let i = 0; i < vCount; i++) {
      col[i * 3] = rgb[0];
      col[i * 3 + 1] = rgb[1];
      col[i * 3 + 2] = rgb[2];
    }
    b.col = col;
    return b;
  }

  function mergeRaw(parts: readonly RawBufs[], withColor = false): RawBufs {
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
    const col = withColor ? new Array<number>(pLen) : undefined;
    let po = 0,
      uo = 0,
      io = 0,
      vBase = 0;
    for (const p of parts) {
      const pp = p.pos,
        pn = p.nrm,
        pu = p.uv,
        pi = p.idx,
        pc = p.col;
      for (let i = 0; i < pp.length; i++) {
        pos[po + i] = pp[i];
        nrm[po + i] = pn[i];
        if (col) col[po + i] = pc ? pc[i] : 0.75;
      }
      po += pp.length;
      for (let i = 0; i < pu.length; i++) uv[uo + i] = pu[i];
      uo += pu.length;
      for (let i = 0; i < pi.length; i++) idx[io + i] = pi[i] + vBase;
      io += pi.length;
      vBase += pp.length / 3;
    }
    return col ? {pos, nrm, uv, idx, col} : {pos, nrm, uv, idx};
  }

  function basisFromY(
    dx: number,
    dy: number,
    dz: number,
  ): [number, number, number, number, number, number, number, number, number] {
    const l = Math.hypot(dx, dy, dz) || 1;
    const yx = dx / l,
      yy = dy / l,
      yz = dz / l;
    const rx0 = Math.abs(yy) < 0.9 ? 0 : 1;
    const ry0 = Math.abs(yy) < 0.9 ? 1 : 0;
    let xx = ry0 * yz;
    let xy = -rx0 * yz;
    let xz = rx0 * yy - ry0 * yx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const zx = xy * yz - xz * yy;
    const zy = xz * yx - xx * yz;
    const zz = xx * yy - xy * yx;
    return [xx, yx, zx, xy, yy, zy, xz, yz, zz];
  }

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

  // Welded watertight UV sphere (`openHE === 0, dupHE === 0, flipNrm === 0`)
  function buildSphere(
    cx: number,
    cy: number,
    cz: number,
    r: number,
    lonSegs: number,
    latSegs = Math.max(6, Math.round(lonSegs * 0.65)),
  ): RawBufs {
    const lon = clamp(Math.round(lonSegs), 8, 64);
    const lat = clamp(Math.round(latSegs), 6, 48);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    // North pole (index 0)
    pos.push(cx, cy + r, cz);
    nrm.push(0, 1, 0);
    uv.push(0.5, 1);

    // Interior latitude rings `1 .. lat - 1`
    for (let i = 1; i < lat; i++) {
      const v = 1 - i / lat;
      const phi = (Math.PI * i) / lat;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      for (let j = 0; j < lon; j++) {
        const u = j / lon;
        const th = u * TAU;
        const nx = sp * Math.cos(th);
        const ny = cp;
        const nz = -sp * Math.sin(th);
        pos.push(cx + r * nx, cy + r * ny, cz + r * nz);
        nrm.push(nx, ny, nz);
        uv.push(u, v);
      }
    }

    // South pole (index 1 + (lat - 1) * lon)
    const southIdx = 1 + (lat - 1) * lon;
    pos.push(cx, cy - r, cz);
    nrm.push(0, -1, 0);
    uv.push(0.5, 0);

    // North polar fan
    for (let j = 0; j < lon; j++) {
      const j1 = (j + 1) % lon;
      idx.push(0, 1 + j, 1 + j1);
    }
    // Interior quad strips
    for (let i = 0; i < lat - 2; i++) {
      const r0 = 1 + i * lon;
      const r1 = r0 + lon;
      for (let j = 0; j < lon; j++) {
        const j1 = (j + 1) % lon;
        idx.push(r0 + j, r1 + j, r1 + j1, r0 + j, r1 + j1, r0 + j1);
      }
    }
    // South polar fan
    const lastRing = 1 + (lat - 2) * lon;
    for (let j = 0; j < lon; j++) {
      const j1 = (j + 1) % lon;
      idx.push(southIdx, lastRing + j1, lastRing + j);
    }
    return {pos, nrm, uv, idx};
  }

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
    const segs = clamp(Math.round(radialSegs), 6, 96);

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

  function buildArrowBetween(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    shaftR: number,
    headR: number,
    headLen: number,
    segs: number,
  ): RawBufs {
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 1e-6) return {pos: [], nrm: [], uv: [], idx: []};
    const hL = len * 0.5;
    const hHead = Math.min(headLen, len * 0.55);
    const neckY = hL - hHead;
    const raw = revolveClosedProfile(
      [
        [0, -hL],
        [shaftR, -hL],
        [shaftR, neckY],
        [headR, neckY],
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

  function sweepTube(
    spine: readonly Vec3[],
    radius: number,
    radialSegs: number,
    closedLoop = false,
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
    if (
      closedLoop &&
      pts.length > 2 &&
      Math.hypot(
        pts[0][0] - pts[pts.length - 1][0],
        pts[0][1] - pts[pts.length - 1][1],
        pts[0][2] - pts[pts.length - 1][2],
      ) < 1e-4
    ) {
      pts.pop();
    }
    const m = pts.length;
    if (m < (closedLoop ? 3 : 2) || radius <= 1e-6) {
      return {pos: [], nrm: [], uv: [], idx: []};
    }

    const segs = clamp(Math.round(radialSegs), 6, 64);
    const tangents: Vec3[] = new Array(m);
    for (let i = 0; i < m; i++) {
      let tx: number, ty: number, tz: number;
      if (!closedLoop && i === 0) {
        tx = pts[1][0] - pts[0][0];
        ty = pts[1][1] - pts[0][1];
        tz = pts[1][2] - pts[0][2];
      } else if (!closedLoop && i === m - 1) {
        tx = pts[m - 1][0] - pts[m - 2][0];
        ty = pts[m - 1][1] - pts[m - 2][1];
        tz = pts[m - 1][2] - pts[m - 2][2];
      } else {
        const ip = (i + m - 1) % m;
        const inx = (i + 1) % m;
        tx = pts[inx][0] - pts[ip][0];
        ty = pts[inx][1] - pts[ip][1];
        tz = pts[inx][2] - pts[ip][2];
      }
      const tl = Math.hypot(tx, ty, tz) || 1;
      tangents[i] = [tx / tl, ty / tl, tz / tl];
    }

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

    const transport = (nPrev: Vec3, tp: Vec3, tc: Vec3): Vec3 => {
      let ax = tp[1] * tc[2] - tp[2] * tc[1];
      let ay = tp[2] * tc[0] - tp[0] * tc[2];
      let az = tp[0] * tc[1] - tp[1] * tc[0];
      const sinA = Math.hypot(ax, ay, az);
      const cosA = clamp(tp[0] * tc[0] + tp[1] * tc[1] + tp[2] * tc[2], -1, 1);
      let cnx = nPrev[0],
        cny = nPrev[1],
        cnz = nPrev[2];
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
      const d = cnx * tc[0] + cny * tc[1] + cnz * tc[2];
      cnx -= d * tc[0];
      cny -= d * tc[1];
      cnz -= d * tc[2];
      const cl = Math.hypot(cnx, cny, cnz) || 1;
      return [cnx / cl, cny / cl, cnz / cl];
    };

    for (let i = 1; i < m; i++) {
      const cN = transport(normals[i - 1], tangents[i - 1], tangents[i]);
      const tc = tangents[i];
      normals[i] = cN;
      binormals[i] = [
        tc[1] * cN[2] - tc[2] * cN[1],
        tc[2] * cN[0] - tc[0] * cN[2],
        tc[0] * cN[1] - tc[1] * cN[0],
      ];
    }

    // For periodic closed loops, distribute any holonomy twist evenly around [0..m] so ring(m) === ring(0)!
    if (closedLoop) {
      const nEnd = transport(normals[m - 1], tangents[m - 1], tangents[0]);
      const cosH = clamp(
        nEnd[0] * normals[0][0] +
          nEnd[1] * normals[0][1] +
          nEnd[2] * normals[0][2],
        -1,
        1,
      );
      const sinH =
        nEnd[0] * binormals[0][0] +
        nEnd[1] * binormals[0][1] +
        nEnd[2] * binormals[0][2];
      const holonomy = Math.atan2(sinH, cosH);
      for (let i = 1; i < m; i++) {
        const corr = -(holonomy * i) / m;
        const cc = Math.cos(corr);
        const sc = Math.sin(corr);
        const N = normals[i];
        const B = binormals[i];
        const nn: Vec3 = [
          cc * N[0] + sc * B[0],
          cc * N[1] + sc * B[1],
          cc * N[2] + sc * B[2],
        ];
        const nb: Vec3 = [
          -sc * N[0] + cc * B[0],
          -sc * N[1] + cc * B[1],
          -sc * N[2] + cc * B[2],
        ];
        normals[i] = nn;
        binormals[i] = nb;
      }
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

    const ringLinks = closedLoop ? m : m - 1;
    for (let i = 0; i < ringLinks; i++) {
      const r0 = i * segs;
      const r1 = ((i + 1) % m) * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(r0 + j, r0 + j1, r1 + j1, r0 + j, r1 + j1, r1 + j);
      }
    }

    if (!closedLoop) {
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
        idx.push(cStart, sRing + ((j + 1) % segs), sRing + j);
      }

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
        idx.push(cEnd, eRing + j, eRing + ((j + 1) % segs));
      }
    }

    return {pos, nrm, uv, idx};
  }

  // Built-in 3D molecular coordinate presets in Angstroms
  function presetMolecule(
    name: string,
  ): {atoms: Array<[string, Vec3]>; bonds: Array<[number, number, number]>} {
    switch (name) {
      case 'water': {
        const d = 0.958;
        const ha = (104.45 * Math.PI) / 360;
        return {
          atoms: [
            ['O', [0, 0.065, 0]],
            ['H', [-d * Math.sin(ha), -d * Math.cos(ha) + 0.065, 0]],
            ['H', [d * Math.sin(ha), -d * Math.cos(ha) + 0.065, 0]],
          ],
          bonds: [
            [0, 1, 1],
            [0, 2, 1],
          ],
        };
      }
      case 'ammonia': {
        const r = 0.94;
        const yH = -0.26;
        return {
          atoms: [
            ['N', [0, 0.12, 0]],
            ['H', [r, yH, 0]],
            ['H', [-r * 0.5, yH, r * 0.866]],
            ['H', [-r * 0.5, yH, -r * 0.866]],
          ],
          bonds: [
            [0, 1, 1],
            [0, 2, 1],
            [0, 3, 1],
          ],
        };
      }
      case 'co2':
        return {
          atoms: [
            ['C', [0, 0, 0]],
            ['O', [-1.16, 0, 0]],
            ['O', [1.16, 0, 0]],
          ],
          bonds: [
            [0, 1, 2],
            [0, 2, 2],
          ],
        };
      case 'ethene': {
        const cc = 0.669;
        const ch = 1.086;
        const a = (121.3 * Math.PI) / 180;
        const hx = cc - ch * Math.cos(a);
        const hy = ch * Math.sin(a);
        return {
          atoms: [
            ['C', [-cc, 0, 0]],
            ['C', [cc, 0, 0]],
            ['H', [-hx, hy, 0]],
            ['H', [-hx, -hy, 0]],
            ['H', [hx, hy, 0]],
            ['H', [hx, -hy, 0]],
          ],
          bonds: [
            [0, 1, 2],
            [0, 2, 1],
            [0, 3, 1],
            [1, 4, 1],
            [1, 5, 1],
          ],
        };
      }
      case 'benzene': {
        const rC = 1.397;
        const rH = 2.481;
        const atoms: Array<[string, Vec3]> = [];
        const bonds: Array<[number, number, number]> = [];
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          atoms.push(['C', [rC * Math.cos(a), 0, rC * Math.sin(a)]]);
        }
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          atoms.push(['H', [rH * Math.cos(a), 0, rH * Math.sin(a)]]);
          bonds.push([i, (i + 1) % 6, i % 2 === 0 ? 2 : 1], [i, 6 + i, 1]);
        }
        return {atoms, bonds};
      }
      case 'ethanol':
        return {
          atoms: [
            ['C', [-1.18, -0.22, 0]],
            ['C', [0.18, 0.45, 0]],
            ['O', [1.21, -0.52, 0]],
            ['H', [2.06, -0.07, 0]],
            ['H', [-1.96, 0.54, 0]],
            ['H', [-1.3, -0.84, 0.89]],
            ['H', [-1.3, -0.84, -0.89]],
            ['H', [0.31, 1.08, 0.89]],
            ['H', [0.31, 1.08, -0.89]],
          ],
          bonds: [
            [0, 1, 1],
            [1, 2, 1],
            [2, 3, 1],
            [0, 4, 1],
            [0, 5, 1],
            [0, 6, 1],
            [1, 7, 1],
            [1, 8, 1],
          ],
        };
      case 'cyclohexane': {
        // 3D chair conformation C6H12 (6 puckered ring carbons + 6 axial H + 6 equatorial H)
        const rC = 1.454;
        const yPuck = 0.254;
        const atoms: Array<[string, Vec3]> = [];
        const bonds: Array<[number, number, number]> = [];
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          const sgn = i % 2 === 0 ? 1 : -1;
          atoms.push(['C', [rC * Math.cos(a), sgn * yPuck, rC * Math.sin(a)]]);
        }
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          const sgn = i % 2 === 0 ? 1 : -1;
          // Axial H + Equatorial H
          atoms.push(
            ['H', [rC * Math.cos(a), sgn * (yPuck + 1.09), rC * Math.sin(a)]],
            [
              'H',
              [
                (rC + 1.02) * Math.cos(a),
                -sgn * 0.11,
                (rC + 1.02) * Math.sin(a),
              ],
            ],
          );
          bonds.push(
            [i, (i + 1) % 6, 1],
            [i, 6 + i * 2, 1],
            [i, 6 + i * 2 + 1, 1],
          );
        }
        return {atoms, bonds};
      }
      case 'caffeine': {
        // 1,3,7-Trimethylxanthine (C8H10N4O2): fused purinedione + 2 carbonyls + 3 methyls + C8-H
        const atoms: Array<[string, Vec3]> = [
          ['N', [-1.36, 0, 0.72]], // 0: N1
          ['C', [-1.39, 0, -0.66]], // 1: C2
          ['N', [-0.21, 0, -1.36]], // 2: N3
          ['C', [0.96, 0, -0.68]], // 3: C4
          ['C', [0.99, 0, 0.71]], // 4: C5
          ['C', [-0.18, 0, 1.47]], // 5: C6
          ['N', [2.29, 0, 1.16]], // 6: N7
          ['C', [3.02, 0, 0.04]], // 7: C8
          ['N', [2.25, 0, -1.08]], // 8: N9
          ['O', [-2.44, 0, -1.28]], // 9: O2 (=O)
          ['O', [-0.21, 0, 2.69]], // 10: O6 (=O)
          ['C', [-2.61, 0, 1.48]], // 11: C(N1-Me)
          ['C', [-0.24, 0, -2.82]], // 12: C(N3-Me)
          ['C', [2.78, 0, 2.53]], // 13: C(N7-Me)
          ['H', [4.1, 0, 0.02]], // 14: H(C8)
        ];
        const bonds: Array<[number, number, number]> = [
          [0, 1, 1],
          [1, 2, 1],
          [2, 3, 1],
          [3, 4, 2],
          [4, 5, 1],
          [5, 0, 1],
          [4, 6, 1],
          [6, 7, 1],
          [7, 8, 2],
          [8, 3, 1],
          [1, 9, 2],
          [5, 10, 2],
          [0, 11, 1],
          [2, 12, 1],
          [6, 13, 1],
          [7, 14, 1],
        ];
        // Add 3 tetrahedral hydrogens per methyl group (atoms 11, 12, 13)
        const methylSpecs: ReadonlyArray<[number, number]> = [
          [11, 0],
          [12, 2],
          [13, 6],
        ];
        for (const [cIdx, nIdx] of methylSpecs) {
          const cP = atoms[cIdx][1];
          const nP = atoms[nIdx][1];
          const dx = cP[0] - nP[0];
          const dz = cP[2] - nP[2];
          const dl = Math.hypot(dx, dz) || 1;
          const ux = dx / dl;
          const uz = dz / dl;
          const px = -uz;
          const pz = ux;
          const hBase = atoms.length;
          atoms.push(
            ['H', [cP[0] + ux * 0.36, 1.02, cP[2] + uz * 0.36]],
            ['H', [cP[0] + ux * 0.36 + px * 0.88, -0.51, cP[2] + uz * 0.36 + pz * 0.88]],
            ['H', [cP[0] + ux * 0.36 - px * 0.88, -0.51, cP[2] + uz * 0.36 - pz * 0.88]],
          );
          bonds.push([cIdx, hBase, 1], [cIdx, hBase + 1, 1], [cIdx, hBase + 2, 1]);
        }
        return {atoms, bonds};
      }
      default: {
        // 'methane': regular tetrahedron (C-H = 1.09 Å)
        const k = 1.09 / Math.sqrt(3);
        return {
          atoms: [
            ['C', [0, 0, 0]],
            ['H', [k, k, k]],
            ['H', [k, -k, -k]],
            ['H', [-k, k, -k]],
            ['H', [-k, -k, k]],
          ],
          bonds: [
            [0, 1, 1],
            [0, 2, 1],
            [0, 3, 1],
            [0, 4, 1],
          ],
        };
      }
    }
  }

  // --- 1. MoleculeGeometry ---
  class MoleculeGeometry extends BufferGeometry {
    constructor(options: MoleculeOptions = {}) {
      super();
      const style = options.style ?? 'ball-and-stick';
      const scale = clamp(num(options.scale, 0.22), 0.02, 5.0);
      const atomScale = clamp(
        num(
          options.atomScale,
          style === 'space-filling' ? 1.0 : style === 'licorice' ? 0.24 : 0.42,
        ),
        0.08,
        2.5,
      );
      const bondR = clamp(
        num(options.bondRadius, style === 'licorice' ? 0.16 * scale : 0.095 * scale),
        0.004,
        1.0,
      );
      const segs = clampInt(options.sphereSegments, 8, 48, 18);
      const useVCol = options.vertexColors !== false;

      let atomList: Array<{el: ElementSpec; p: Vec3; r: number}> = [];
      let bondList: Array<[number, number, number]> = [];

      if (Array.isArray(options.atoms) && options.atoms.length > 0) {
        const capped = options.atoms.slice(0, MAX_ATOMS);
        atomList = capped.map((a) => {
          const el = elementSpec(a?.element ?? 'C');
          const baseR =
            style === 'space-filling' ? el.vdwRadius : Math.max(0.38, el.covalentRadius);
          const rad = clamp(
            num(a?.radius, baseR * atomScale * scale),
            0.008,
            3.0,
          );
          return {
            el,
            p: [
              num(a?.position?.[0], 0) * scale,
              num(a?.position?.[1], 0) * scale,
              num(a?.position?.[2], 0) * scale,
            ],
            r: style === 'licorice' ? Math.max(bondR * 1.04, rad * 0.4) : rad,
          };
        });
        if (Array.isArray(options.bonds)) {
          for (const b of options.bonds) {
            const i = clampInt(b?.[0], 0, atomList.length - 1, -1);
            const j = clampInt(b?.[1], 0, atomList.length - 1, -1);
            if (i >= 0 && j >= 0 && i !== j) {
              bondList.push([i, j, clampInt(b?.[2], 1, 3, 1)]);
            }
          }
        } else if (style !== 'space-filling') {
          // Auto-detect covalent bonds within 1.25 * (r_cov_i + r_cov_j)
          for (let i = 0; i < atomList.length; i++) {
            for (let j = i + 1; j < atomList.length; j++) {
              const ai = atomList[i];
              const aj = atomList[j];
              const dist = Math.hypot(
                ai.p[0] - aj.p[0],
                ai.p[1] - aj.p[1],
                ai.p[2] - aj.p[2],
              );
              const maxCov = (ai.el.covalentRadius + aj.el.covalentRadius) * 1.28 * scale;
              if (dist > 0.04 * scale && dist <= maxCov) {
                bondList.push([i, j, 1]);
              }
            }
          }
        }
      } else {
        const pre = presetMolecule(options.preset ?? 'benzene');
        atomList = pre.atoms.map(([sym, posAng]) => {
          const el = elementSpec(sym);
          const baseR =
            style === 'space-filling' ? el.vdwRadius : Math.max(0.4, el.covalentRadius);
          const rad = baseR * atomScale * scale;
          return {
            el,
            p: [posAng[0] * scale, posAng[1] * scale, posAng[2] * scale],
            r: style === 'licorice' ? Math.max(bondR * 1.05, rad * 0.45) : rad,
          };
        });
        bondList = style === 'space-filling' ? [] : pre.bonds;
      }

      const parts: RawBufs[] = [];
      for (const a of atomList) {
        const sph = buildSphere(a.p[0], a.p[1], a.p[2], a.r, segs);
        if (useVCol) paintRaw(sph, hexToRgb(a.el.cpkColor));
        parts.push(sph);
      }

      for (let bIdx = 0; bIdx < bondList.length; bIdx++) {
        const [ia, ib, order] = bondList[bIdx];
        const aa = atomList[ia];
        const ab = atomList[ib];
        const dx = ab.p[0] - aa.p[0];
        const dy = ab.p[1] - aa.p[1];
        const dz = ab.p[2] - aa.p[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist <= 1e-5) continue;
        const ux = dx / dist,
          uy = dy / dist,
          uz = dz / dist;
        // Perpendicular offset direction for double/triple bonds (preferring XY/XZ molecular plane)
        let px = -uz,
          py = 0,
          pz = ux;
        if (Math.hypot(px, py, pz) < 1e-3) {
          px = 1;
          py = 0;
          pz = 0;
        } else {
          const pl = Math.hypot(px, py, pz);
          px /= pl;
          py /= pl;
          pz /= pl;
        }
        const subR = order === 1 ? bondR : bondR * (order === 2 ? 0.62 : 0.48);
        const sep = order === 2 ? subR * 1.55 : subR * 2.2;
        const offsets =
          order === 1 ? [0] : order === 2 ? [-sep, sep] : [-sep, 0, sep];
        // Slight axial inset + per-bond micro-jitter so multiple bonds sharing an atom never create coplanar caps
        const trimA = Math.min(dist * 0.35, aa.r * 0.55) + (bIdx % 7) * 3e-5;
        const trimB = Math.min(dist * 0.35, ab.r * 0.55) + ((bIdx + 3) % 7) * 3e-5;
        if (dist - trimA - trimB <= 1e-4) continue;

        const colMid: Vec3 = [
          (hexToRgb(aa.el.cpkColor)[0] + hexToRgb(ab.el.cpkColor)[0]) * 0.5,
          (hexToRgb(aa.el.cpkColor)[1] + hexToRgb(ab.el.cpkColor)[1]) * 0.5,
          (hexToRgb(aa.el.cpkColor)[2] + hexToRgb(ab.el.cpkColor)[2]) * 0.5,
        ];
        for (const off of offsets) {
          const cyl = buildCylBetween(
            aa.p[0] + ux * trimA + px * off,
            aa.p[1] + uy * trimA + py * off,
            aa.p[2] + uz * trimA + pz * off,
            ab.p[0] - ux * trimB + px * off,
            ab.p[1] - uy * trimB + py * off,
            ab.p[2] - uz * trimB + pz * off,
            subR,
            12,
          );
          if (useVCol) paintRaw(cyl, colMid);
          parts.push(cyl);
        }
      }

      applyBuffers(this, mergeRaw(parts, useVCol), 'MoleculeGeometry', {
        style,
        atomCount: atomList.length,
        bondCount: bondList.length,
      });
    }
  }

  // --- 2. CrystalLatticeGeometry ---
  class CrystalLatticeGeometry extends BufferGeometry {
    constructor(options: CrystalLatticeOptions = {}) {
      super();
      const lattice = options.lattice ?? 'fcc';
      const rawCells = options.cells;
      const nx = clampInt(
        Array.isArray(rawCells) ? rawCells[0] : rawCells,
        1,
        6,
        lattice === 'graphene' ? 3 : 2,
      );
      const ny = clampInt(
        Array.isArray(rawCells) ? rawCells[1] : rawCells,
        1,
        6,
        lattice === 'graphene' && rawCells == null ? 1 : 2,
      );
      const nz = clampInt(
        Array.isArray(rawCells) ? rawCells[2] : rawCells,
        1,
        6,
        lattice === 'graphene' ? 3 : 2,
      );
      const a0 = clamp(num(options.latticeConstant, 0.45), 0.08, 4.0);
      const atomR = clamp(
        num(options.atomRadius, a0 * (lattice === 'graphene' ? 0.13 : 0.16)),
        a0 * 0.04,
        a0 * 0.38,
      );
      const bondR = clamp(num(options.bondRadius, atomR * 0.28), 0.003, atomR * 0.7);
      const includeBonds = options.includeBonds !== false;
      const showBox = options.showUnitCell === true;
      const segs = clampInt(options.sphereSegments, 8, 32, 14);
      const origin = options.origin ?? 'center';

      const siteMap = new Map<string, {p: Vec3; sp: number}>();
      const addSite = (px: number, py: number, pz: number, sp: number) => {
        const key = `${Math.round((px / a0) * 100)},${Math.round((py / a0) * 100)},${Math.round((pz / a0) * 100)}`;
        if (!siteMap.has(key) && siteMap.size < MAX_ATOMS) {
          siteMap.set(key, {p: [px, py, pz], sp});
        }
      };

      let nnFactor = 1.05;
      let spanBox: Vec3 = [nx * a0, ny * a0, nz * a0];

      if (lattice === 'hcp') {
        const s3 = Math.sqrt(3) * 0.5;
        const c0 = Math.sqrt(8 / 3) * a0;
        nnFactor = 1.05;
        for (let cx = 0; cx < nx; cx++) {
          for (let cy = 0; cy < ny; cy++) {
            for (let cz = 0; cz < nz; cz++) {
              for (let ix = 0; ix <= 1; ix++) {
                for (let iy = 0; iy <= 1; iy++) {
                  for (let iz = 0; iz <= 1; iz++) {
                    const u = cx + ix;
                    const w = cz + iz;
                    addSite((u + 0.5 * w) * a0, (cy + iy) * c0, w * s3 * a0, 0);
                  }
                }
              }
              const uB = cx + 1 / 3;
              const wB = cz + 1 / 3;
              addSite((uB + 0.5 * wB) * a0, (cy + 0.5) * c0, wB * s3 * a0, 1);
            }
          }
        }
        spanBox = [(nx + 0.5 * nz) * a0, ny * c0, nz * s3 * a0];
      } else if (lattice === 'graphene') {
        // 2D honeycomb sp2 sheet in XZ (with AB Bernal stacking along Y when ny > 1)
        const s3 = Math.sqrt(3) * 0.5;
        const layerGap = a0 * 1.36;
        nnFactor = 0.62; // 1 / sqrt(3) = 0.577
        for (let cy = 0; cy < ny; cy++) {
          const shift = cy % 2 === 1 ? 1 / 3 : 0;
          const py = cy * layerGap;
          for (let cx = 0; cx <= nx; cx++) {
            for (let cz = 0; cz <= nz; cz++) {
              const u0 = cx + shift;
              const w0 = cz + shift;
              addSite((u0 + 0.5 * w0) * a0, py, w0 * s3 * a0, 0);
              if (cx < nx && cz < nz) {
                const u1 = cx + 1 / 3 + shift;
                const w1 = cz + 1 / 3 + shift;
                addSite((u1 + 0.5 * w1) * a0, py, w1 * s3 * a0, 0);
              }
            }
          }
        }
        spanBox = [(nx + 0.5 * nz) * a0, Math.max(0, ny - 1) * layerGap, nz * s3 * a0];
      } else {
        // Cubic Bravais / compound lattices
        const cornerAndFaces = (includeFace: boolean): Array<[number, number, number, number]> => {
          const list: Array<[number, number, number, number]> = [];
          for (let ix = 0; ix <= 1; ix++) {
            for (let iy = 0; iy <= 1; iy++) {
              for (let iz = 0; iz <= 1; iz++) {
                list.push([ix, iy, iz, 0]);
              }
            }
          }
          if (includeFace) {
            list.push(
              [0.5, 0.5, 0, 0],
              [0.5, 0.5, 1, 0],
              [0.5, 0, 0.5, 0],
              [0.5, 1, 0.5, 0],
              [0, 0.5, 0.5, 0],
              [1, 0.5, 0.5, 0],
            );
          }
          return list;
        };

        let basis: Array<[number, number, number, number]>;
        if (lattice === 'sc') {
          basis = cornerAndFaces(false);
          nnFactor = 1.05;
        } else if (lattice === 'bcc') {
          basis = [...cornerAndFaces(false), [0.5, 0.5, 0.5, 0]];
          nnFactor = 0.88;
        } else if (lattice === 'diamond') {
          basis = [
            ...cornerAndFaces(true),
            [0.25, 0.25, 0.25, 0],
            [0.75, 0.75, 0.25, 0],
            [0.75, 0.25, 0.75, 0],
            [0.25, 0.75, 0.75, 0],
          ];
          nnFactor = 0.45;
        } else if (lattice === 'nacl') {
          basis = [];
          for (let ix = 0; ix <= 2; ix++) {
            for (let iy = 0; iy <= 2; iy++) {
              for (let iz = 0; iz <= 2; iz++) {
                basis.push([ix * 0.5, iy * 0.5, iz * 0.5, (ix + iy + iz) % 2]);
              }
            }
          }
          nnFactor = 0.53;
        } else if (lattice === 'perovskite') {
          // ABX3 cubic perovskite: corner A (sp=0), body-center B (sp=1), 6 face-center X oxygens (sp=2)
          basis = [
            ...cornerAndFaces(false),
            [0.5, 0.5, 0.5, 1],
            [0.5, 0.5, 0, 2],
            [0.5, 0.5, 1, 2],
            [0.5, 0, 0.5, 2],
            [0.5, 1, 0.5, 2],
            [0, 0.5, 0.5, 2],
            [1, 0.5, 0.5, 2],
          ];
          nnFactor = 0.53; // B-X octahedral bonds of length 0.5 * a0!
        } else {
          basis = cornerAndFaces(true);
          nnFactor = 0.73;
        }

        for (let cx = 0; cx < nx; cx++) {
          for (let cy = 0; cy < ny; cy++) {
            for (let cz = 0; cz < nz; cz++) {
              for (const [fx, fy, fz, sp] of basis) {
                addSite((cx + fx) * a0, (cy + fy) * a0, (cz + fz) * a0, sp);
              }
            }
          }
        }
      }

      const sites = Array.from(siteMap.values());
      const parts: RawBufs[] = [];
      for (const s of sites) {
        let rad = atomR;
        let col = hexToRgb(0xd97706);
        if (lattice === 'nacl') {
          rad = s.sp === 1 ? atomR * 1.22 : atomR * 0.85;
          col = hexToRgb(s.sp === 0 ? 0x8b5cf6 : 0x22c55e);
        } else if (lattice === 'perovskite') {
          rad = s.sp === 0 ? atomR * 1.22 : s.sp === 1 ? atomR * 0.92 : atomR * 0.78;
          col = hexToRgb(s.sp === 0 ? 0x8b5cf6 : s.sp === 1 ? 0x38bdf8 : 0xef4444);
        } else if (lattice === 'diamond') {
          col = hexToRgb(0x38bdf8);
        } else if (lattice === 'graphene') {
          col = hexToRgb(0x334155);
        } else if (lattice === 'hcp') {
          col = hexToRgb(s.sp === 0 ? 0x38bdf8 : 0x818cf8);
        }
        parts.push(paintRaw(buildSphere(s.p[0], s.p[1], s.p[2], rad, segs), col));
      }

      if (includeBonds) {
        const maxBond = a0 * nnFactor;
        const bondCol = hexToRgb(0x94a3b8);
        let bCount = 0;
        for (let i = 0; i < sites.length; i++) {
          for (let j = i + 1; j < sites.length; j++) {
            if (
              lattice === 'perovskite' &&
              !((sites[i].sp === 1 && sites[j].sp === 2) || (sites[i].sp === 2 && sites[j].sp === 1))
            ) {
              continue;
            }
            const a = sites[i].p;
            const b = sites[j].p;
            const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            if (dist > 1e-4 && dist <= maxBond) {
              const ux = (b[0] - a[0]) / dist;
              const uy = (b[1] - a[1]) / dist;
              const uz = (b[2] - a[2]) / dist;
              const trim = atomR * 0.55 + (bCount % 7) * 3e-5;
              if (dist - 2 * trim > 1e-4) {
                parts.push(
                  paintRaw(
                    buildCylBetween(
                      a[0] + ux * trim,
                      a[1] + uy * trim,
                      a[2] + uz * trim,
                      b[0] - ux * trim,
                      b[1] - uy * trim,
                      b[2] - uz * trim,
                      bondR,
                      10,
                    ),
                    bondCol,
                  ),
                );
                bCount++;
              }
            }
          }
        }
      }

      if (showBox && spanBox[1] > 1e-3) {
        const [sx, sy, sz] = spanBox;
        const corners: Vec3[] = [
          [0, 0, 0],
          [sx, 0, 0],
          [sx, sy, 0],
          [0, sy, 0],
          [0, 0, sz],
          [sx, 0, sz],
          [sx, sy, sz],
          [0, sy, sz],
        ];
        const edges: Array<[number, number]> = [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [4, 5],
          [5, 6],
          [6, 7],
          [7, 4],
          [0, 4],
          [1, 5],
          [2, 6],
          [3, 7],
        ];
        const frameCol = hexToRgb(0x64748b);
        for (let e = 0; e < edges.length; e++) {
          const [i0, i1] = edges[e];
          const c0 = corners[i0];
          const c1 = corners[i1];
          const dx = c1[0] - c0[0],
            dy = c1[1] - c0[1],
            dz = c1[2] - c0[2];
          const l = Math.hypot(dx, dy, dz) || 1;
          const trim = atomR * 0.65 + e * 2e-5;
          if (l - 2 * trim > 1e-4) {
            parts.push(
              paintRaw(
                buildCylBetween(
                  c0[0] + (dx / l) * trim,
                  c0[1] + (dy / l) * trim,
                  c0[2] + (dz / l) * trim,
                  c1[0] - (dx / l) * trim,
                  c1[1] - (dy / l) * trim,
                  c1[2] - (dz / l) * trim,
                  bondR * 0.65,
                  8,
                ),
                frameCol,
              ),
            );
          }
        }
      }

      const merged = mergeRaw(parts, true);
      if (origin === 'center') {
        xformRaw(
          merged,
          -spanBox[0] * 0.5,
          -spanBox[1] * 0.5,
          -spanBox[2] * 0.5,
        );
      }

      applyBuffers(this, merged, 'CrystalLatticeGeometry', {
        lattice,
        cells: [nx, ny, nz],
        atomCount: sites.length,
      });
    }
  }

  // --- 3. SurfacePlotGeometry ---
  class SurfacePlotGeometry extends BufferGeometry {
    constructor(options: SurfacePlotOptions = {}) {
      super();
      const preset = options.preset ?? 'sinc';
      const segX = clampInt(options.segmentsX, 4, MAX_GRID, 40);
      const segZ = clampInt(options.segmentsZ, 4, MAX_GRID, 40);
      const width = clamp(num(options.width, 2.4), 0.2, 40);
      const depth = clamp(num(options.depth, 2.4), 0.2, 40);
      const hScale = clamp(num(options.heightScale, 0.55), 0.02, 20);
      const solid = options.solid !== false;
      const thick = clamp(num(options.thickness, 0.16), 0.02, 5);

      const xr = Array.isArray(options.xRange) ? options.xRange : [-3, 3];
      const zr = Array.isArray(options.zRange) ? options.zRange : [-3, 3];
      const ux0 = num(xr[0], -3);
      let ux1 = num(xr[1], 3);
      if (Math.abs(ux1 - ux0) < 1e-6) ux1 = ux0 + 6;
      const uz0 = num(zr[0], -3);
      let uz1 = num(zr[1], 3);
      if (Math.abs(uz1 - uz0) < 1e-6) uz1 = uz0 + 6;

      const evalFn =
        typeof options.fn === 'function'
          ? options.fn
          : (u: number, v: number): number => {
              if (preset === 'saddle') return (u * u - v * v) * 0.18;
              if (preset === 'gaussian') return Math.exp(-(u * u + v * v) * 0.45);
              if (preset === 'ripple') {
                const r = Math.hypot(u, v);
                return Math.cos(r * 2.6) * Math.exp(-r * 0.35);
              }
              if (preset === 'monkey-saddle') {
                return (u * u * u - 3 * u * v * v) * 0.045;
              }
              const r = Math.hypot(u, v) * 2.2;
              return r < 1e-6 ? 1 : Math.sin(r) / r;
            };

      const nx = segX + 1;
      const nz = segZ + 1;
      const heights = new Float64Array(nx * nz);
      let minH = Infinity;
      for (let iz = 0; iz < nz; iz++) {
        const vz = uz0 + ((uz1 - uz0) * iz) / segZ;
        for (let ix = 0; ix < nx; ix++) {
          const ux = ux0 + ((ux1 - ux0) * ix) / segX;
          let val = 0;
          try {
            val = evalFn(ux, vz);
          } catch {
            val = 0;
          }
          const h = clamp(num(val, 0) * hScale, -20, 20);
          heights[iz * nx + ix] = h;
          if (h < minH) minH = h;
        }
      }
      if (!Number.isFinite(minH)) minH = 0;

      const dx = width / segX;
      const dz = depth / segZ;
      const x0 = -width * 0.5;
      const z0 = -depth * 0.5;
      const yBase = minH - thick;

      // Build watertight closed 2-manifold block using per-triangle outward normals on steep/creased grids
      // or smooth area-weighted normals when well-aligned with every adjacent triangle (`dot > 0.2`).
      const topPos = new Float64Array(nx * nz * 3);
      const botPos = new Float64Array(nx * nz * 3);
      for (let iz = 0; iz < nz; iz++) {
        const z = z0 + iz * dz;
        for (let ix = 0; ix < nx; ix++) {
          const k = iz * nx + ix;
          const x = x0 + ix * dx;
          const yt = heights[k];
          const yb = solid ? yBase : yt - thick;
          topPos[k * 3] = x;
          topPos[k * 3 + 1] = yt;
          topPos[k * 3 + 2] = z;
          botPos[k * 3] = x;
          botPos[k * 3 + 1] = yb;
          botPos[k * 3 + 2] = z;
        }
      }

      const smoothTopN = new Float64Array(nx * nz * 3);
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          const k = iz * nx + ix;
          const hL = heights[iz * nx + Math.max(0, ix - 1)];
          const hR = heights[iz * nx + Math.min(segX, ix + 1)];
          const hD = heights[Math.max(0, iz - 1) * nx + ix];
          const hU = heights[Math.min(segZ, iz + 1) * nx + ix];
          const sx = (ix > 0 && ix < segX ? 2 : 1) * dx;
          const sz = (iz > 0 && iz < segZ ? 2 : 1) * dz;
          const dhdx = (hR - hL) / sx;
          const dhdz = (hU - hD) / sz;
          const nl = Math.hypot(-dhdx, 1, -dhdz) || 1;
          smoothTopN[k * 3] = -dhdx / nl;
          smoothTopN[k * 3 + 1] = 1 / nl;
          smoothTopN[k * 3 + 2] = -dhdz / nl;
        }
      }

      const pos: number[] = [];
      const nrm: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      let vOff = 0;

      // Helper emitting a triangle with smooth vertex normals when `dot(fn, vn) > 0.25`, else exact face normal!
      // Because vertex coordinates match bit-for-bit across adjacent triangles, spatial half-edges remain 100% paired!
      const emitSurfaceTri = (
        srcP: Float64Array,
        srcN: Float64Array | null,
        nSign: number,
        ia: number,
        ib: number,
        ic: number,
        uA: number,
        vA: number,
        uB: number,
        vB: number,
        uC: number,
        vC: number,
      ) => {
        const ax = srcP[ia * 3],
          ay = srcP[ia * 3 + 1],
          az = srcP[ia * 3 + 2];
        const bx = srcP[ib * 3],
          by = srcP[ib * 3 + 1],
          bz = srcP[ib * 3 + 2];
        const cx = srcP[ic * 3],
          cy = srcP[ic * 3 + 1],
          cz = srcP[ic * 3 + 2];
        const ux = bx - ax,
          uy = by - ay,
          uz = bz - az;
        const vx = cx - ax,
          vy = cy - ay,
          vz = cz - az;
        let fnx = uy * vz - uz * vy;
        let fny = uz * vx - ux * vz;
        let fnz = ux * vy - uy * vx;
        const fl = Math.hypot(fnx, fny, fnz) || 1;
        fnx /= fl;
        fny /= fl;
        fnz /= fl;

        let useSmooth = srcN !== null;
        if (srcN) {
          const mnx =
            (nSign * (srcN[ia * 3] + srcN[ib * 3] + srcN[ic * 3])) / 3;
          const mny =
            (nSign * (srcN[ia * 3 + 1] + srcN[ib * 3 + 1] + srcN[ic * 3 + 1])) /
            3;
          const mnz =
            (nSign * (srcN[ia * 3 + 2] + srcN[ib * 3 + 2] + srcN[ic * 3 + 2])) /
            3;
          if (fnx * mnx + fny * mny + fnz * mnz < 0.25) {
            useSmooth = false;
          }
        }
        pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        if (useSmooth && srcN) {
          nrm.push(
            nSign * srcN[ia * 3],
            nSign * srcN[ia * 3 + 1],
            nSign * srcN[ia * 3 + 2],
            nSign * srcN[ib * 3],
            nSign * srcN[ib * 3 + 1],
            nSign * srcN[ib * 3 + 2],
            nSign * srcN[ic * 3],
            nSign * srcN[ic * 3 + 1],
            nSign * srcN[ic * 3 + 2],
          );
        } else {
          nrm.push(fnx, fny, fnz, fnx, fny, fnz, fnx, fny, fnz);
        }
        uv.push(uA, vA, uB, vB, uC, vC);
        idx.push(vOff, vOff + 1, vOff + 2);
        vOff += 3;
      };

      // Top & bottom grids: note for +X right and +Z forward, `a=(ix,iz), b=(ix,iz+1), c=(ix+1,iz+1), d=(ix+1,iz)`
      // gives `(b - a) = +Z`, `(d - a) = +X`, and `(+Z) x (+X) = +Y` (outward UP)!
      for (let iz = 0; iz < segZ; iz++) {
        const v0 = iz / segZ;
        const v1 = (iz + 1) / segZ;
        for (let ix = 0; ix < segX; ix++) {
          const u0 = ix / segX;
          const u1 = (ix + 1) / segX;
          const a = iz * nx + ix;
          const b = (iz + 1) * nx + ix;
          const c = (iz + 1) * nx + (ix + 1);
          const d = iz * nx + (ix + 1);
          // Top (+Y)
          emitSurfaceTri(topPos, smoothTopN, 1, a, b, c, u0, v0, u0, v1, u1, v1);
          emitSurfaceTri(topPos, smoothTopN, 1, a, c, d, u0, v0, u1, v1, u1, v0);
          // Bottom (-Y, reversed winding)
          emitSurfaceTri(
            botPos,
            solid ? null : smoothTopN,
            -1,
            a,
            c,
            b,
            u0,
            v0,
            u1,
            v1,
            u0,
            v1,
          );
          emitSurfaceTri(
            botPos,
            solid ? null : smoothTopN,
            -1,
            a,
            d,
            c,
            u0,
            v0,
            u1,
            v0,
            u1,
            v1,
          );
        }
      }

      // 4 perimeter side walls pairing boundary half-edges 1-to-1!
      // Along a CCW boundary step `k0 -> k1` (viewed from +Y: front `iz=segZ, ix:0->segX`;
      // right `ix=segX, iz:segZ->0`; back `iz=0, ix:segX->0`; left `ix=0, iz:0->segZ`):
      // Wait: check top face boundary edges!
      // - At `iz = segZ`: top tri `(a, b, c)` has `b = (segZ, ix), c = (segZ, ix+1)` -> top emits `b -> c` (`ix -> ix+1`)!
      // - At `ix = segX`: top tri `(a, c, d)` has `c = (iz+1, segX), d = (iz, segX)` -> top emits `c -> d` (`iz+1 -> iz`)!
      // - At `iz = 0`: top tri `(a, c, d)` has `d = (0, ix+1), a = (0, ix)` -> top emits `d -> a` (`ix+1 -> ix`)!
      // - At `ix = 0`: top tri `(a, b, c)` has `a = (iz, 0), b = (iz+1, 0)` -> top emits `a -> b` (`iz -> iz+1`)!
      // So along `k0 -> k1` where top emits `top(k0) -> top(k1)` and bottom emits `bot(k1) -> bot(k0)`:
      // Side quad MUST emit `top(k1) -> top(k0)` and `bot(k0) -> bot(k1)`:
      // Triangles `(bot(k0), bot(k1), top(k1))` and `(bot(k0), top(k1), top(k0))`!
      const emitSideQuad = (k0: number, k1: number) => {
        const b0x = botPos[k0 * 3],
          b0y = botPos[k0 * 3 + 1],
          b0z = botPos[k0 * 3 + 2];
        const b1x = botPos[k1 * 3],
          b1y = botPos[k1 * 3 + 1],
          b1z = botPos[k1 * 3 + 2];
        const t0x = topPos[k0 * 3],
          t0y = topPos[k0 * 3 + 1],
          t0z = topPos[k0 * 3 + 2];
        const t1x = topPos[k1 * 3],
          t1y = topPos[k1 * 3 + 1],
          t1z = topPos[k1 * 3 + 2];
        const emitTri3 = (
          p0x: number,
          p0y: number,
          p0z: number,
          p1x: number,
          p1y: number,
          p1z: number,
          p2x: number,
          p2y: number,
          p2z: number,
        ) => {
          const ux = p1x - p0x,
            uy = p1y - p0y,
            uz = p1z - p0z;
          const vx = p2x - p0x,
            vy = p2y - p0y,
            vz = p2z - p0z;
          let fnx = uy * vz - uz * vy;
          let fny = uz * vx - ux * vz;
          let fnz = ux * vy - uy * vx;
          const fl = Math.hypot(fnx, fny, fnz) || 1;
          fnx /= fl;
          fny /= fl;
          fnz /= fl;
          pos.push(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z);
          nrm.push(fnx, fny, fnz, fnx, fny, fnz, fnx, fny, fnz);
          uv.push(0, 0, 1, 0, 1, 1);
          idx.push(vOff, vOff + 1, vOff + 2);
          vOff += 3;
        };
        emitTri3(b0x, b0y, b0z, b1x, b1y, b1z, t1x, t1y, t1z);
        emitTri3(b0x, b0y, b0z, t1x, t1y, t1z, t0x, t0y, t0z);
      };

      for (let ix = 0; ix < segX; ix++) {
        emitSideQuad(segZ * nx + ix, segZ * nx + (ix + 1)); // +Z front
        emitSideQuad(ix + 1, ix); // -Z back
      }
      for (let iz = 0; iz < segZ; iz++) {
        emitSideQuad((iz + 1) * nx + segX, iz * nx + segX); // +X right
        emitSideQuad(iz * nx, (iz + 1) * nx); // -X left
      }

      applyBuffers(this, {pos, nrm, uv, idx}, 'SurfacePlotGeometry', {
        preset,
        width,
        depth,
        segmentsX: segX,
        segmentsZ: segZ,
      });
    }
  }

  // --- 4. ParametricSurfaceGeometry ---
  class ParametricSurfaceGeometry extends BufferGeometry {
    constructor(options: ParametricSurfaceOptions = {}) {
      super();
      const kind = options.kind ?? 'torus-knot';
      const R = clamp(num(options.radius, 0.7), 0.1, 15);
      const rTube = clamp(num(options.tubeRadius, R * 0.24), R * 0.05, R * 0.75);
      const uSegs = clampInt(options.uSegments, 16, MAX_GRID, kind === 'torus-knot' ? 96 : 48);
      const vSegs = clampInt(options.vSegments, 8, 64, 20);

      let raw: RawBufs;
      if (kind === 'torus-knot') {
        const p = clampInt(options.p, 1, 9, 2);
        const q = clampInt(options.q, 1, 9, 3);
        const spine: Vec3[] = [];
        for (let i = 0; i < uSegs; i++) {
          const t = (i * TAU) / uSegs;
          const rCur = R * (1 + 0.38 * Math.cos(q * t));
          spine.push([
            rCur * Math.cos(p * t),
            R * 0.38 * Math.sin(q * t),
            rCur * Math.sin(p * t),
          ]);
        }
        raw = sweepTube(spine, rTube * 0.65, vSegs, true);
      } else if (kind === 'spherical-harmonic') {
        const l = clampInt(options.l, 1, 6, 3);
        const m = clampInt(options.m, 0, l, 2);
        const amp = clamp(num(options.amplitude, 0.28), 0.02, 0.55);
        // Smooth radial modulation `r(phi, th) = R * (1 + amp * sin^m(phi) * P(cos(phi)) * cos(m * th))`
        // Note: vanishes at poles when m > 0, and is constant along th at poles when m === 0 -> welded poles!
        const radAt = (phi: number, th: number): number => {
          const sp = Math.sin(phi);
          const cp = Math.cos(phi);
          const leg =
            l - m === 0
              ? 1
              : l - m === 1
                ? cp
                : l - m === 2
                  ? 0.5 * (3 * cp * cp - 1)
                  : 0.5 * (5 * cp * cp * cp - 3 * cp);
          const harm = Math.pow(sp, m) * leg * Math.cos(m * th);
          return R * Math.max(0.25, 1 + amp * clamp(harm, -1, 1));
        };

        const lon = uSegs;
        const lat = vSegs;
        const gridP: Vec3[] = [];
        gridP.push([0, radAt(0, 0), 0]);
        for (let i = 1; i < lat; i++) {
          const phi = (Math.PI * i) / lat;
          const sp = Math.sin(phi);
          const cp = Math.cos(phi);
          for (let j = 0; j < lon; j++) {
            const th = (j * TAU) / lon;
            const rr = radAt(phi, th);
            gridP.push([rr * sp * Math.cos(th), rr * cp, -rr * sp * Math.sin(th)]);
          }
        }
        const southIdx = gridP.length;
        gridP.push([0, -radAt(Math.PI, 0), 0]);

        const triPairs: Array<[number, number, number]> = [];
        for (let j = 0; j < lon; j++) {
          triPairs.push([0, 1 + j, 1 + ((j + 1) % lon)]);
        }
        for (let i = 0; i < lat - 2; i++) {
          const r0 = 1 + i * lon;
          const r1 = r0 + lon;
          for (let j = 0; j < lon; j++) {
            const j1 = (j + 1) % lon;
            triPairs.push([r0 + j, r1 + j, r1 + j1], [r0 + j, r1 + j1, r0 + j1]);
          }
        }
        const lastR = 1 + (lat - 2) * lon;
        for (let j = 0; j < lon; j++) {
          triPairs.push([southIdx, lastR + ((j + 1) % lon), lastR + j]);
        }

        // Accumulate area-weighted smooth vertex normals and verify alignment
        const vN = new Float64Array(gridP.length * 3);
        for (const [ia, ib, ic] of triPairs) {
          const a = gridP[ia],
            b = gridP[ib],
            c = gridP[ic];
          const fnx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
          const fny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
          const fnz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          for (const vi of [ia, ib, ic]) {
            vN[vi * 3] += fnx;
            vN[vi * 3 + 1] += fny;
            vN[vi * 3 + 2] += fnz;
          }
        }
        for (let i = 0; i < gridP.length; i++) {
          const l0 = Math.hypot(vN[i * 3], vN[i * 3 + 1], vN[i * 3 + 2]) || 1;
          vN[i * 3] /= l0;
          vN[i * 3 + 1] /= l0;
          vN[i * 3 + 2] /= l0;
        }
        const pos: number[] = [];
        const nrm: number[] = [];
        const uv: number[] = [];
        for (let i = 0; i < gridP.length; i++) {
          pos.push(gridP[i][0], gridP[i][1], gridP[i][2]);
          nrm.push(vN[i * 3], vN[i * 3 + 1], vN[i * 3 + 2]);
          uv.push(0.5, 0.5);
        }
        const idx: number[] = [];
        for (const [ia, ib, ic] of triPairs) idx.push(ia, ib, ic);
        raw = {pos, nrm, uv, idx};
      } else {
        // Doubly-periodic closed 2-torus manifold ('dupin-cyclide' or 'twisted-torus')
        const twists = clampInt(options.twists, 1, 8, 3);
        const gridP: Vec3[] = [];
        for (let iu = 0; iu < uSegs; iu++) {
          const u = (iu * TAU) / uSegs;
          const cu = Math.cos(u);
          const su = Math.sin(u);
          for (let iv = 0; iv < vSegs; iv++) {
            const v = (iv * TAU) / vSegs;
            if (kind === 'dupin-cyclide') {
              // Ring Dupin cyclide with `a > c > 0` and `b = sqrt(a^2 - c^2)`, `d` inside `(c, a)`
              const a = R;
              const c = R * 0.28;
              const b = Math.sqrt(a * a - c * c);
              const d = R * 0.52;
              const denom = a - c * cu * Math.cos(v);
              const px = (d * (c - a * cu * Math.cos(v)) + b * b * cu) / denom;
              const py = (b * (a - d * cu) * Math.sin(v)) / denom;
              const pz = (b * su * (c * Math.cos(v) - d)) / denom;
              gridP.push([px, py, pz]);
            } else {
              // 'twisted-torus': 3-lobed hypocycloid/epicycloid section twisted `twists` times around u
              const lobe = 1 + 0.24 * Math.cos(3 * (v + (twists * u) / 3));
              const rr = rTube * lobe;
              const rad = R + rr * Math.cos(v);
              gridP.push([rad * cu, rr * Math.sin(v), -rad * su]);
            }
          }
        }

        // Determine winding orientation via signed volume on doubly-periodic grid and flip if negative!
        const tris: Array<[number, number, number]> = [];
        let vol6 = 0;
        for (let iu = 0; iu < uSegs; iu++) {
          const iu1 = (iu + 1) % uSegs;
          for (let iv = 0; iv < vSegs; iv++) {
            const iv1 = (iv + 1) % vSegs;
            const a = iu * vSegs + iv;
            const b = iu1 * vSegs + iv;
            const c = iu1 * vSegs + iv1;
            const d = iu * vSegs + iv1;
            tris.push([a, b, c], [a, c, d]);
          }
        }
        for (const [ia, ib, ic] of tris) {
          const pa = gridP[ia],
            pb = gridP[ib],
            pc = gridP[ic];
          vol6 +=
            pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) +
            pa[1] * (pb[2] * pc[0] - pb[0] * pc[2]) +
            pa[2] * (pb[0] * pc[1] - pb[1] * pc[0]);
        }
        if (vol6 < 0) {
          for (const t of tris) {
            const tmp = t[1];
            t[1] = t[2];
            t[2] = tmp;
          }
        }

        const vN = new Float64Array(gridP.length * 3);
        for (const [ia, ib, ic] of tris) {
          const pa = gridP[ia],
            pb = gridP[ib],
            pc = gridP[ic];
          const fnx = (pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]);
          const fny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
          const fnz = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
          for (const vi of [ia, ib, ic]) {
            vN[vi * 3] += fnx;
            vN[vi * 3 + 1] += fny;
            vN[vi * 3 + 2] += fnz;
          }
        }
        const pos: number[] = [];
        const nrm: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        for (let i = 0; i < gridP.length; i++) {
          const nl = Math.hypot(vN[i * 3], vN[i * 3 + 1], vN[i * 3 + 2]) || 1;
          pos.push(gridP[i][0], gridP[i][1], gridP[i][2]);
          nrm.push(vN[i * 3] / nl, vN[i * 3 + 1] / nl, vN[i * 3 + 2] / nl);
          uv.push(
            Math.floor(i / vSegs) / uSegs,
            (i % vSegs) / vSegs,
          );
        }
        for (const [ia, ib, ic] of tris) idx.push(ia, ib, ic);
        raw = {pos, nrm, uv, idx};
      }

      applyBuffers(this, raw, 'ParametricSurfaceGeometry', {
        kind,
        radius: R,
      });
    }
  }

  // --- 5. VectorFieldGeometry ---
  class VectorFieldGeometry extends BufferGeometry {
    constructor(options: VectorFieldOptions = {}) {
      super();
      const preset = options.preset ?? 'dipole';
      const rawG = options.grid;
      let gx = clampInt(Array.isArray(rawG) ? rawG[0] : rawG, 1, 12, 5);
      let gy = clampInt(Array.isArray(rawG) ? rawG[1] : rawG, 1, 12, 5);
      let gz = clampInt(Array.isArray(rawG) ? rawG[2] : rawG, 1, 12, 5);
      while (gx * gy * gz > MAX_GLYPHS) {
        if (gx >= gy && gx >= gz) gx--;
        else if (gy >= gz) gy--;
        else gz--;
      }

      const rawS = options.span;
      const sx = clamp(num(Array.isArray(rawS) ? rawS[0] : rawS, 2.0), 0.2, 30);
      const sy = clamp(num(Array.isArray(rawS) ? rawS[1] : rawS, 2.0), 0.2, 30);
      const sz = clamp(num(Array.isArray(rawS) ? rawS[2] : rawS, 2.0), 0.2, 30);
      const cellMin = Math.min(
        gx > 1 ? sx / (gx - 1) : sx,
        gy > 1 ? sy / (gy - 1) : sy,
        gz > 1 ? sz / (gz - 1) : sz,
      );
      const maxArrow = clamp(num(options.arrowScale, cellMin * 0.78), 0.04, 4.0);
      const shaftR = clamp(
        num(options.shaftRadius, maxArrow * 0.075),
        0.002,
        maxArrow * 0.25,
      );

      const evalField =
        typeof options.fn === 'function'
          ? options.fn
          : (x: number, y: number, z: number): Vec3 => {
              if (preset === 'vortex') return [-z, 0.25, x];
              if (preset === 'saddle') return [x, -0.5 * y, -z];
              if (preset === 'radial') return [x, y, z];
              if (preset === 'helical') return [-z, 0.6, x];
              // 'dipole': magnetic dipole along +Y: B ~ 3(m·r)r/r^5 - m/r^3
              const r2 = x * x + y * y + z * z + 0.12;
              const r5 = Math.pow(r2, 2.5);
              const r3 = Math.pow(r2, 1.5);
              return [(3 * y * x) / r5, (3 * y * y) / r5 - 1 / r3, (3 * y * z) / r5];
            };

      const samples: Array<{p: Vec3; v: Vec3; mag: number}> = [];
      let maxMag = 0;
      for (let ix = 0; ix < gx; ix++) {
        const x = gx > 1 ? -sx * 0.5 + (ix * sx) / (gx - 1) : 0;
        for (let iy = 0; iy < gy; iy++) {
          const y = gy > 1 ? -sy * 0.5 + (iy * sy) / (gy - 1) : 0;
          for (let iz = 0; iz < gz; iz++) {
            const z = gz > 1 ? -sz * 0.5 + (iz * sz) / (gz - 1) : 0;
            let fv: readonly [number, number, number] = [0, 1, 0];
            try {
              fv = evalField(x, y, z);
            } catch {
              fv = [0, 0, 0];
            }
            const vx = num(fv?.[0], 0);
            const vy = num(fv?.[1], 0);
            const vz = num(fv?.[2], 0);
            const mag = Math.hypot(vx, vy, vz);
            if (mag > 1e-6) {
              samples.push({p: [x, y, z], v: [vx / mag, vy / mag, vz / mag], mag});
              if (mag > maxMag) maxMag = mag;
            }
          }
        }
      }
      if (samples.length === 0) {
        samples.push({p: [0, 0, 0], v: [0, 1, 0], mag: 1});
        maxMag = 1;
      }

      const parts: RawBufs[] = [];
      for (const s of samples) {
        const normM = clamp(Math.pow(s.mag / (maxMag || 1), 0.35), 0.35, 1.0);
        const len = maxArrow * normM;
        const hLen = len * 0.5;
        parts.push(
          buildArrowBetween(
            s.p[0] - s.v[0] * hLen,
            s.p[1] - s.v[1] * hLen,
            s.p[2] - s.v[2] * hLen,
            s.p[0] + s.v[0] * hLen,
            s.p[1] + s.v[1] * hLen,
            s.p[2] + s.v[2] * hLen,
            shaftR,
            shaftR * 2.35,
            len * 0.36,
            10,
          ),
        );
      }

      applyBuffers(this, mergeRaw(parts), 'VectorFieldGeometry', {
        preset,
        glyphCount: samples.length,
      });
    }
  }

  // --- 6. Axes3DGeometry ---
  class Axes3DGeometry extends BufferGeometry {
    constructor(options: Axes3DOptions = {}) {
      super();
      const len = clamp(num(options.length, 1.2), 0.15, 20);
      const shaftR = clamp(num(options.shaftRadius, len * 0.022), 0.002, len * 0.12);
      const headR = clamp(num(options.headRadius, shaftR * 2.5), shaftR * 1.3, len * 0.25);
      const headLen = clamp(num(options.headLength, len * 0.14), headR * 0.8, len * 0.4);
      const sym = options.symmetric === true;
      const ticks = clampInt(options.ticks, 0, 20, 4);

      const parts: RawBufs[] = [];
      // Origin hub sphere (`shaftR * 1.85`)
      const hubR = shaftR * 1.85;
      parts.push(paintRaw(buildSphere(0, 0, 0, hubR, 16), hexToRgb(0xf8fafc)));

      const axes: Array<[Vec3, number]> = [
        [[1, 0, 0], 0xef4444], // +X red
        [[0, 1, 0], 0x22c55e], // +Y green
        [[0, 0, 1], 0x3b82f6], // +Z blue
      ];
      for (let a = 0; a < axes.length; a++) {
        const [d, hex] = axes[a];
        const rgb = hexToRgb(hex);
        const startPos = hubR * 0.55 + a * 3e-5;
        parts.push(
          paintRaw(
            buildArrowBetween(
              d[0] * startPos,
              d[1] * startPos,
              d[2] * startPos,
              d[0] * len,
              d[1] * len,
              d[2] * len,
              shaftR,
              headR,
              headLen,
              16,
            ),
            rgb,
          ),
        );
        if (sym) {
          const startNeg = hubR * 0.52 + a * 3e-5;
          parts.push(
            paintRaw(
              buildArrowBetween(
                -d[0] * startNeg,
                -d[1] * startNeg,
                -d[2] * startNeg,
                -d[0] * len,
                -d[1] * len,
                -d[2] * len,
                shaftR,
                headR,
                headLen,
                16,
              ),
              rgb,
            ),
          );
        }
        if (ticks > 0) {
          const usable = len - headLen * 1.25;
          for (let k = 1; k <= ticks; k++) {
            const dist = (usable * k) / ticks;
            const halfT = shaftR * 0.45;
            parts.push(
              paintRaw(
                buildCylBetween(
                  d[0] * (dist - halfT),
                  d[1] * (dist - halfT),
                  d[2] * (dist - halfT),
                  d[0] * (dist + halfT),
                  d[1] * (dist + halfT),
                  d[2] * (dist + halfT),
                  shaftR * 1.55,
                  14,
                ),
                rgb,
              ),
            );
          }
        }
      }

      applyBuffers(this, mergeRaw(parts, true), 'Axes3DGeometry', {
        length: len,
        symmetric: sym,
        ticks,
      });
    }
  }

  // --- 7. DoubleHelixGeometry ---
  class DoubleHelixGeometry extends BufferGeometry {
    constructor(options: DoubleHelixOptions = {}) {
      super();
      const turns = clamp(num(options.turns, 2.0), 0.25, 16);
      const bpPerTurn = clamp(num(options.basePairsPerTurn, 10.5), 4, 24);
      const radius = clamp(num(options.radius, 0.35), 0.05, 5);
      const pitch = clamp(num(options.pitch, radius * 3.4), radius * 1.2, 20);
      const bbR = clamp(num(options.backboneRadius, radius * 0.14), 0.005, radius * 0.42);
      const rungR = clamp(num(options.rungRadius, bbR * 0.58), 0.003, bbR * 0.92);
      const segs = clampInt(options.radialSegments, 8, 32, 12);
      const origin = options.origin ?? 'center';

      const totalH = turns * pitch;
      const y0 = origin === 'floor' ? bbR : -totalH * 0.5;
      const bpCount = clamp(Math.round(turns * bpPerTurn), 2, MAX_BP);
      // Real Watson-Crick B-DNA minor-groove offset (~140° = 2.44 rad instead of 180° symmetric)
      const groovePhase = (140 * Math.PI) / 180;

      const spineSteps = clamp(Math.round(turns * 28), 16, 360);
      const strandA: Vec3[] = [];
      const strandB: Vec3[] = [];
      for (let i = 0; i <= spineSteps; i++) {
        const f = i / spineSteps;
        const ang = f * turns * TAU;
        const y = y0 + f * totalH;
        strandA.push([radius * Math.cos(ang), y, -radius * Math.sin(ang)]);
        strandB.push([
          radius * Math.cos(ang + groovePhase),
          y,
          -radius * Math.sin(ang + groovePhase),
        ]);
      }

      const parts: RawBufs[] = [
        paintRaw(sweepTube(strandA, bbR, segs, false), hexToRgb(0x38bdf8)),
        paintRaw(sweepTube(strandB, bbR, segs, false), hexToRgb(0x818cf8)),
      ];

      const pairColors: Array<[Vec3, Vec3]> = [
        [hexToRgb(0xef4444), hexToRgb(0xfacc15)], // A-T
        [hexToRgb(0x22c55e), hexToRgb(0xf97316)], // G-C
      ];
      for (let b = 0; b < bpCount; b++) {
        const f = (b + 0.5) / bpCount;
        const ang = f * turns * TAU;
        const y = y0 + f * totalH;
        const ax = radius * Math.cos(ang);
        const az = -radius * Math.sin(ang);
        const bx = radius * Math.cos(ang + groovePhase);
        const bz = -radius * Math.sin(ang + groovePhase);
        const dx = bx - ax,
          dz = bz - az;
        const dLen = Math.hypot(dx, dz) || 1;
        const ux = dx / dLen,
          uz = dz / dLen;
        const trim = bbR * 0.55;
        const gap = rungR * 0.35;
        const mx = (ax + bx) * 0.5,
          mz = (az + bz) * 0.5;
        if (dLen * 0.5 - trim - gap > 1e-4) {
          const [c1, c2] = pairColors[b % 2];
          parts.push(
            paintRaw(
              buildCylBetween(
                ax + ux * trim,
                y,
                az + uz * trim,
                mx - ux * gap,
                y,
                mz - uz * gap,
                rungR,
                10,
              ),
              c1,
            ),
            paintRaw(
              buildCylBetween(
                mx + ux * gap,
                y,
                mz + uz * gap,
                bx - ux * trim,
                y,
                bz - uz * trim,
                rungR,
                10,
              ),
              c2,
            ),
          );
        }
      }

      applyBuffers(this, mergeRaw(parts, true), 'DoubleHelixGeometry', {
        turns,
        basePairs: bpCount,
        radius,
        totalHeight: totalH,
      });
    }
  }

  // --- 8. AtomicOrbitalGeometry ---
  class AtomicOrbitalGeometry extends BufferGeometry {
    constructor(options: AtomicOrbitalOptions = {}) {
      super();
      const orbital: AtomicOrbitalKind = options.orbital ?? '2pz';
      const scale = clamp(num(options.scale, 0.8), 0.08, 12);
      const segs = clampInt(options.segments, 12, 64, 28);
      const useVCol = options.vertexColors !== false;
      const posRgb = hexToRgb(0x38bdf8);
      const negRgb = hexToRgb(0xf43f5e);

      const buildLobe = (
        dx: number,
        dy: number,
        dz: number,
        startFrac: number,
        widthFrac: number,
        rgb: Vec3,
      ): RawBufs => {
        const y0 = scale * startFrac;
        const y1 = scale;
        const prof: Pt2[] = [[0, y0]];
        const steps = 16;
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const y = y0 + (y1 - y0) * t;
          const r =
            scale *
            widthFrac *
            Math.sin(Math.PI * t) *
            Math.pow(t, 0.38);
          prof.push([r, y]);
        }
        prof.push([0, y1]);
        const raw = xformRaw(
          revolveClosedProfile(prof, segs),
          0,
          0,
          0,
          basisFromY(dx, dy, dz),
        );
        return useVCol ? paintRaw(raw, rgb) : raw;
      };

      const parts: RawBufs[] = [];
      if (orbital === '1s') {
        const sph = buildSphere(0, 0, 0, scale * 0.75, segs);
        parts.push(useVCol ? paintRaw(sph, posRgb) : sph);
      } else if (orbital === '2px' || orbital === '2py' || orbital === '2pz') {
        const dir: Vec3 =
          orbital === '2px' ? [1, 0, 0] : orbital === '2py' ? [0, 1, 0] : [0, 0, 1];
        parts.push(
          buildLobe(dir[0], dir[1], dir[2], 0.045, 0.44, posRgb),
          buildLobe(-dir[0], -dir[1], -dir[2], 0.045, 0.44, negRgb),
        );
      } else if (orbital === '3dz2') {
        // Two axial ±Y lobes (+ phase) + equatorial nodal torus belt (- phase)
        parts.push(
          buildLobe(0, 1, 0, 0.16, 0.36, posRgb),
          buildLobe(0, -1, 0, 0.16, 0.36, posRgb),
        );
        const rMajor = scale * 0.42;
        const rMinor = scale * 0.12;
        const ringPts: Pt2[] = [];
        for (let i = 0; i < 14; i++) {
          const a = (i * TAU) / 14;
          ringPts.push([rMajor + rMinor * Math.cos(a), rMinor * Math.sin(a)]);
        }
        const belt = revolveClosedProfile(ringPts, segs);
        parts.push(useVCol ? paintRaw(belt, negRgb) : belt);
      } else {
        // 4-lobe d-orbital cloverleaf: '3dx2-y2' (along ±X / ±Z) or '3dxz' (45° diagonals in XZ)
        const rot = orbital === '3dxz' ? Math.PI * 0.25 : 0;
        for (let k = 0; k < 4; k++) {
          const a = rot + (k * Math.PI) / 2;
          parts.push(
            buildLobe(
              Math.cos(a),
              0,
              Math.sin(a),
              0.08,
              0.35,
              k % 2 === 0 ? posRgb : negRgb,
            ),
          );
        }
      }

      applyBuffers(this, mergeRaw(parts, useVCol), 'AtomicOrbitalGeometry', {
        orbital,
        scale,
      });
    }
  }

  // --- 9. OpticalElementGeometry ---
  class OpticalElementGeometry extends BufferGeometry {
    constructor(options: OpticalElementOptions = {}) {
      super();
      const kind: OpticalElementKind = options.kind ?? 'biconvex';
      const dia = clamp(num(options.diameter, 0.5), 0.02, 10);
      const rAp = dia * 0.5;
      const segs = clampInt(options.radialSegments, 12, 96, 36);

      if (kind === 'prism-equilateral' || kind === 'prism-right-angle') {
        const len = clamp(num(options.length ?? options.thickness, dia * 1.2), 0.02, 15);
        const hL = len * 0.5;
        const hTri = (dia * Math.sqrt(3)) * 0.5;
        const tri: [Pt2, Pt2, Pt2] =
          kind === 'prism-equilateral'
            ? [
                [-rAp, -hTri / 3],
                [rAp, -hTri / 3],
                [0, (2 * hTri) / 3],
              ]
            : [
                [-rAp, -rAp],
                [rAp, -rAp],
                [-rAp, rAp],
              ];
        const pos: number[] = [];
        const nrm: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        // +Z front cap & -Z back cap
        for (const p of tri) {
          pos.push(p[0], p[1], hL);
          nrm.push(0, 0, 1);
          uv.push(0.5 + p[0] / dia, 0.5 + p[1] / dia);
        }
        idx.push(0, 1, 2);
        for (const p of tri) {
          pos.push(p[0], p[1], -hL);
          nrm.push(0, 0, -1);
          uv.push(0.5 + p[0] / dia, 0.5 + p[1] / dia);
        }
        idx.push(3, 5, 4);
        let vOff = 6;
        for (let i = 0; i < 3; i++) {
          const a = tri[i];
          const b = tri[(i + 1) % 3];
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const el = Math.hypot(dx, dy) || 1;
          const nx = dy / el;
          const ny = -dx / el;
          pos.push(a[0], a[1], -hL, b[0], b[1], -hL, a[0], a[1], hL, b[0], b[1], hL);
          nrm.push(nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0);
          uv.push(0, 0, 1, 0, 0, 1, 1, 1);
          idx.push(vOff, vOff + 1, vOff + 3, vOff, vOff + 3, vOff + 2);
          vOff += 4;
        }
        applyBuffers(this, {pos, nrm, uv, idx}, 'OpticalElementGeometry', {
          kind,
          diameter: dia,
          length: len,
        });
        return;
      }

      // Spherical optical lens revolved around Z optical axis
      const R1 = Math.max(
        rAp * 1.15,
        Math.abs(num(options.curvatureRadius1, dia * 0.95)),
      );
      const R2 = Math.max(
        rAp * 1.15,
        Math.abs(
          num(
            options.curvatureRadius2,
            kind === 'meniscus' ? R1 * 1.85 : R1,
          ),
        ),
      );
      const sag = (r: number, R: number) =>
        R - Math.sqrt(Math.max(0, R * R - r * r));
      const s1Max = sag(rAp, R1);
      const s2Max = sag(rAp, R2);
      const minRim = Math.max(0.004, dia * 0.06);
      const rawThick = clamp(num(options.thickness, dia * 0.22), minRim, dia * 1.5);

      const nCurve = 12;
      const prof: Pt2[] = [];
      if (kind === 'biconvex' || kind === 'planoconvex') {
        const isBi = kind === 'biconvex';
        const tCenter = Math.max(rawThick, minRim + s1Max + (isBi ? s2Max : 0));
        for (let i = 0; i <= nCurve; i++) {
          const r = (rAp * i) / nCurve;
          prof.push([r, -tCenter * 0.5 + (isBi ? sag(r, R2) : 0)]);
        }
        for (let i = nCurve; i >= 0; i--) {
          const r = (rAp * i) / nCurve;
          prof.push([r, tCenter * 0.5 - sag(r, R1)]);
        }
      } else if (kind === 'biconcave' || kind === 'planoconcave') {
        const isBi = kind === 'biconcave';
        const tCenter = Math.max(minRim, rawThick * 0.45);
        for (let i = 0; i <= nCurve; i++) {
          const r = (rAp * i) / nCurve;
          prof.push([r, -tCenter * 0.5 - (isBi ? sag(r, R2) : 0)]);
        }
        for (let i = nCurve; i >= 0; i--) {
          const r = (rAp * i) / nCurve;
          prof.push([r, tCenter * 0.5 + sag(r, R1)]);
        }
      } else {
        // 'meniscus': concave rear (-Z) + steeper convex front (+Z)
        const tCenter = Math.max(rawThick, minRim + Math.max(0, s1Max - s2Max));
        for (let i = 0; i <= nCurve; i++) {
          const r = (rAp * i) / nCurve;
          prof.push([r, -tCenter * 0.5 - sag(r, R2)]);
        }
        for (let i = nCurve; i >= 0; i--) {
          const r = (rAp * i) / nCurve;
          prof.push([r, tCenter * 0.5 - sag(r, R1)]);
        }
      }

      const lens = xformRaw(
        revolveClosedProfile(prof, segs),
        0,
        0,
        0,
        basisFromY(0, 0, 1),
      );
      applyBuffers(this, lens, 'OpticalElementGeometry', {
        kind,
        diameter: dia,
        curvatureRadius1: R1,
        curvatureRadius2: R2,
      });
    }
  }

  function hslToRgb01(h: number, s: number, l: number): Vec3 {
    const hh = ((h % 1) + 1) % 1;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hh * 6) % 2) - 1));
    const m = l - c * 0.5;
    let r = 0,
      g = 0,
      b = 0;
    const sec = Math.floor(hh * 6);
    if (sec === 0) {
      r = c;
      g = x;
    } else if (sec === 1) {
      r = x;
      g = c;
    } else if (sec === 2) {
      g = c;
      b = x;
    } else if (sec === 3) {
      g = x;
      b = c;
    } else if (sec === 4) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return [r + m, g + m, b + m];
  }

  function resolvePointKinds(
    count: number,
    kinds?: readonly RibbonSecondaryKind[],
    spans?: readonly RibbonSpanSpec[],
  ): RibbonSecondaryKind[] {
    const out = new Array<RibbonSecondaryKind>(count);
    for (let i = 0; i < count; i++) {
      const k = kinds?.[i];
      out[i] = k === 'helix' || k === 'sheet' ? k : 'coil';
    }
    if (Array.isArray(spans)) {
      for (const sp of spans) {
        if (!sp || (sp.kind !== 'coil' && sp.kind !== 'helix' && sp.kind !== 'sheet')) {
          continue;
        }
        const a = clampInt(sp.from, 0, count - 1, 0);
        const b = clampInt(sp.to, 0, count - 1, 0);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        for (let i = lo; i <= hi; i++) out[i] = sp.kind;
      }
    }
    return out;
  }

  function evalColorScheme(
    u: number,
    scheme: 'spectrum' | 'secondary' | 'plddt',
    ptKinds?: readonly RibbonSecondaryKind[],
  ): Vec3 {
    const t = clamp(u, 0, 1);
    if (scheme === 'secondary' && ptKinds && ptKinds.length > 0) {
      const fIdx = t * (ptKinds.length - 1);
      const i0 = clamp(Math.floor(fIdx), 0, ptKinds.length - 1);
      const i1 = clamp(i0 + 1, 0, ptKinds.length - 1);
      const frac = fIdx - i0;
      const colOf = (k: RibbonSecondaryKind): Vec3 =>
        k === 'helix'
          ? [0.957, 0.247, 0.369]
          : k === 'sheet'
            ? [0.98, 0.8, 0.082]
            : [0.82, 0.86, 0.91];
      const c0 = colOf(ptKinds[i0]);
      const c1 = colOf(ptKinds[i1]);
      return [
        c0[0] + (c1[0] - c0[0]) * frac,
        c0[1] + (c1[1] - c0[1]) * frac,
        c0[2] + (c1[2] - c0[2]) * frac,
      ];
    }
    if (scheme === 'plddt') {
      const wave = 0.5 + 0.5 * Math.cos(t * Math.PI * 5);
      if (wave > 0.65) return [0.11, 0.31, 0.85];
      if (wave > 0.35) return [0.22, 0.74, 0.97];
      if (wave > 0.15) return [0.98, 0.8, 0.08];
      return [0.98, 0.45, 0.09];
    }
    // Richardson N->C rainbow spectrum (royal blue -> cyan -> emerald -> gold -> coral)
    return hslToRgb01(0.63 - t * 0.6, 0.86, 0.54);
  }

  // tslint:disable-next-line:no-any Returns host THREE.DataTexture or raw pixel descriptor.
  function ribbonColorMap(options: RibbonColorMapOptions = {}): any {
    const scheme = options.scheme ?? 'spectrum';
    const w = clampInt(options.width, 16, 512, 256);
    const h = 4;
    const pCount = clampInt(
      options.pointCount,
      2,
      MAX_RIBBON_PTS,
      options.kinds?.length ?? 64,
    );
    const ptKinds =
      scheme === 'secondary'
        ? resolvePointKinds(pCount, options.kinds, options.spans)
        : undefined;
    const data = new Uint8Array(w * h * 4);
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0;
      const [r, g, b] = evalColorScheme(u, scheme, ptKinds);
      const R = clamp(Math.round(r * 255), 0, 255);
      const G = clamp(Math.round(g * 255), 0, 255);
      const B = clamp(Math.round(b * 255), 0, 255);
      for (let y = 0; y < h; y++) {
        const off = (y * w + x) * 4;
        data[off] = R;
        data[off + 1] = G;
        data[off + 2] = B;
        data[off + 3] = 255;
      }
    }
    if (typeof DataTexture === 'function') {
      const tex = new DataTexture(
        data,
        w,
        h,
        1023,
        1009,
        undefined,
        1001,
        1001,
        1006,
        1006,
        1,
        'srgb',
      );
      tex.needsUpdate = true;
      return tex;
    }
    return {data, width: w, height: h};
  }

  // --- 10. RibbonGeometry (Continuous Richardson Polypeptide / Biopolymer Cartoon) ---
  class RibbonGeometry extends BufferGeometry {
    constructor(options: RibbonOptions = {}) {
      super();
      const s = clamp(num(options.scale, 1), 0.05, 50);
      const closedReq = options.closed === true;

      const pts: Vec3[] = [];
      const rawNormals: Array<Vec3 | null> = [];
      const keptKinds: Array<RibbonSecondaryKind | undefined> = [];
      if (Array.isArray(options.points)) {
        const lim = Math.min(options.points.length, MAX_RIBBON_PTS);
        for (let i = 0; i < lim; i++) {
          const p = options.points[i];
          if (!p) continue;
          const px = Array.isArray(p) ? num(p[0], NaN) : num((p as {x: number}).x, NaN);
          const py = Array.isArray(p) ? num(p[1], NaN) : num((p as {y: number}).y, NaN);
          const pz = Array.isArray(p) ? num(p[2], NaN) : num((p as {z: number}).z, NaN);
          if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
            continue;
          }
          const sp: Vec3 = [px * s, py * s, pz * s];
          const prev = pts[pts.length - 1];
          if (
            prev &&
            Math.hypot(sp[0] - prev[0], sp[1] - prev[1], sp[2] - prev[2]) <= 1e-5 * s
          ) {
            continue;
          }
          pts.push(sp);
          keptKinds.push(options.kinds?.[i]);
          const rn = options.normals?.[i];
          if (rn) {
            const nx = Array.isArray(rn)
              ? num(rn[0], NaN)
              : num((rn as {x: number}).x, NaN);
            const ny = Array.isArray(rn)
              ? num(rn[1], NaN)
              : num((rn as {y: number}).y, NaN);
            const nz = Array.isArray(rn)
              ? num(rn[2], NaN)
              : num((rn as {z: number}).z, NaN);
            const nl = Math.hypot(nx, ny, nz);
            rawNormals.push(
              Number.isFinite(nl) && nl > 1e-6 ? [nx / nl, ny / nl, nz / nl] : null,
            );
          } else {
            rawNormals.push(null);
          }
        }
      }

      if (
        closedReq &&
        pts.length >= 3 &&
        Math.hypot(
          pts[0][0] - pts[pts.length - 1][0],
          pts[0][1] - pts[pts.length - 1][1],
          pts[0][2] - pts[pts.length - 1][2],
        ) <=
          1e-5 * s
      ) {
        pts.pop();
        rawNormals.pop();
        keptKinds.pop();
      }

      let ptKinds: RibbonSecondaryKind[];
      let closed = closedReq && pts.length >= 3;
      if (pts.length < (closed ? 3 : 2)) {
        // Default showcase fold: 2-strand antiparallel beta-hairpin + right-handed alpha-helix
        pts.length = 0;
        rawNormals.length = 0;
        closed = false;
        const defKinds: RibbonSecondaryKind[] = [];
        for (let i = 0; i < 10; i++) {
          const t = i / 9;
          pts.push([-0.55 * s, (-0.7 + 1.4 * t) * s, 0.025 * Math.sin(t * TAU * 2) * s]);
          rawNormals.push([0, 0, 1]);
          defKinds.push(i >= 1 && i <= 8 ? 'sheet' : 'coil');
        }
        for (let i = 1; i <= 4; i++) {
          const a = Math.PI * (1 - i / 5);
          pts.push([(-0.275 + 0.275 * Math.cos(a)) * s, (0.7 + 0.24 * Math.sin(a)) * s, 0]);
          rawNormals.push([0, 0, 1]);
          defKinds.push('coil');
        }
        for (let i = 0; i < 10; i++) {
          const t = i / 9;
          pts.push([0, (0.7 - 1.4 * t) * s, -0.025 * Math.sin(t * TAU * 2) * s]);
          rawNormals.push([0, 0, 1]);
          defKinds.push(i >= 1 && i <= 8 ? 'sheet' : 'coil');
        }
        for (let i = 1; i <= 3; i++) {
          const t = i / 4;
          pts.push([0.62 * t * s, (-0.7 - 0.16 * Math.sin(t * Math.PI)) * s, 0]);
          rawNormals.push(null);
          defKinds.push('coil');
        }
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          const a = t * TAU * 2.6;
          pts.push([
            (0.68 + 0.2 * Math.cos(a)) * s,
            (-0.68 + 1.42 * t) * s,
            0.2 * Math.sin(a) * s,
          ]);
          rawNormals.push(null);
          defKinds.push(i >= 1 && i <= 11 ? 'helix' : 'coil');
        }
        ptKinds = defKinds;
      } else {
        ptKinds = resolvePointKinds(
          pts.length,
          options.kinds ? (keptKinds as RibbonSecondaryKind[]) : undefined,
          options.spans,
        );
      }

      const N = pts.length;
      const segCount = closed ? N : N - 1;
      const maxSub = Math.max(2, Math.floor(1600 / segCount));
      const subdiv = clampInt(
        options.subdivisions,
        2,
        Math.min(16, maxSub),
        Math.min(6, maxSub),
      );
      const P = clampInt(options.profileSegments, 8, 28, 16);
      const M = segCount * subdiv;

      const coilR = clamp(num(options.coilRadius, 0.036) * s, 0.003 * s, 0.6 * s);
      const helixHW = clamp(
        num(options.helixWidth, 0.17) * s * 0.5,
        coilR * 1.05,
        1.0 * s,
      );
      const helixHT = clamp(
        num(options.helixThickness, 0.038) * s * 0.5,
        0.002 * s,
        helixHW * 0.9,
      );
      const sheetHW = clamp(
        num(options.sheetWidth, 0.22) * s * 0.5,
        coilR * 1.1,
        1.2 * s,
      );
      const sheetHT = clamp(
        num(options.sheetThickness, 0.032) * s * 0.5,
        0.002 * s,
        sheetHW * 0.85,
      );
      const arrowMax = Math.min(1.8 * s, sheetHW * 2.5);
      const arrowHW =
        options.arrowHeadWidth !== undefined
          ? clamp(num(options.arrowHeadWidth, 0.37) * s * 0.5, sheetHW * 1.15, arrowMax)
          : clamp(sheetHW * 1.7, sheetHW * 1.15, arrowMax);
      const arrowFrac = clamp(num(options.arrowHeadFraction, 0.24), 0.12, 0.45);
      const colorScheme = options.colorScheme ?? 'spectrum';

      const fc = options.faceCenter;
      const hasFaceCenter =
        Array.isArray(fc) &&
        fc.length >= 3 &&
        Number.isFinite(Number(fc[0])) &&
        Number.isFinite(Number(fc[1])) &&
        Number.isFinite(Number(fc[2]));
      const faceCenterPt: Vec3 = hasFaceCenter
        ? [Number(fc![0]) * s, Number(fc![1]) * s, Number(fc![2]) * s]
        : [0, 0, 0];

      // Centripetal Catmull-Rom spline evaluation
      const getPt = (idx: number): Vec3 => {
        if (closed) return pts[((idx % N) + N) % N];
        if (idx < 0) {
          return [
            2 * pts[0][0] - pts[1][0],
            2 * pts[0][1] - pts[1][1],
            2 * pts[0][2] - pts[1][2],
          ];
        }
        if (idx >= N) {
          return [
            2 * pts[N - 1][0] - pts[N - 2][0],
            2 * pts[N - 1][1] - pts[N - 2][1],
            2 * pts[N - 1][2] - pts[N - 2][2],
          ];
        }
        return pts[idx];
      };

      const evalCentripetalCR = (
        p0: Vec3,
        p1: Vec3,
        p2: Vec3,
        p3: Vec3,
        u: number,
      ): Vec3 => {
        const d01 = Math.max(
          1e-4,
          Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])),
        );
        const d12 = Math.max(
          1e-4,
          Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])),
        );
        const d23 = Math.max(
          1e-4,
          Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1], p3[2] - p2[2])),
        );
        const t1 = d01;
        const t2 = t1 + d12;
        const t3 = t2 + d23;
        const t = t1 + u * d12;
        const out: Vec3 = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const a1 = ((t1 - t) / t1) * p0[c] + (t / t1) * p1[c];
          const a2 = ((t2 - t) / d12) * p1[c] + ((t - t1) / d12) * p2[c];
          const a3 = ((t3 - t) / d23) * p2[c] + ((t - t2) / d23) * p3[c];
          const b1 = ((t2 - t) / t2) * a1 + (t / t2) * a2;
          const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
          out[c] = ((t2 - t) / d12) * b1 + ((t - t1) / d12) * b2;
        }
        return out;
      };

      const centers = new Array<Vec3>(M + 1);
      for (let k = 0; k <= M; k++) {
        if (closed && k === M) {
          centers[k] = [centers[0][0], centers[0][1], centers[0][2]];
          continue;
        }
        const seg = Math.min(segCount - 1, Math.floor(k / subdiv));
        const u = (k - seg * subdiv) / subdiv;
        centers[k] = evalCentripetalCR(
          getPt(seg - 1),
          getPt(seg),
          getPt(seg + 1),
          getPt(seg + 2),
          u,
        );
      }

      // Tangents T_k and twist-free Bishop frame (T_k, U_k, V_k)
      const tangs = new Array<Vec3>(M + 1);
      for (let k = 0; k <= M; k++) {
        let dx: number, dy: number, dz: number;
        if (closed) {
          const prev = centers[(k - 1 + M) % M];
          const next = centers[(k + 1) % M];
          dx = next[0] - prev[0];
          dy = next[1] - prev[1];
          dz = next[2] - prev[2];
        } else if (k === 0) {
          dx = centers[1][0] - centers[0][0];
          dy = centers[1][1] - centers[0][1];
          dz = centers[1][2] - centers[0][2];
        } else if (k === M) {
          dx = centers[M][0] - centers[M - 1][0];
          dy = centers[M][1] - centers[M - 1][1];
          dz = centers[M][2] - centers[M - 1][2];
        } else {
          dx = centers[k + 1][0] - centers[k - 1][0];
          dy = centers[k + 1][1] - centers[k - 1][1];
          dz = centers[k + 1][2] - centers[k - 1][2];
        }
        const l = Math.hypot(dx, dy, dz) || 1;
        tangs[k] = [dx / l, dy / l, dz / l];
      }

      const bishopU = new Array<Vec3>(M + 1);
      const bishopV = new Array<Vec3>(M + 1);
      {
        const t0 = tangs[0];
        let ux = 0,
          uy = 0,
          uz = 0;
        // Prefer normal to initial bend plane when non-collinear
        for (let k = 1; k <= Math.min(M, subdiv * 3); k++) {
          const tk = tangs[k];
          const cx = t0[1] * tk[2] - t0[2] * tk[1];
          const cy = t0[2] * tk[0] - t0[0] * tk[2];
          const cz = t0[0] * tk[1] - t0[1] * tk[0];
          if (Math.hypot(cx, cy, cz) > 1e-3) {
            ux = cx;
            uy = cy;
            uz = cz;
            break;
          }
        }
        if (Math.hypot(ux, uy, uz) <= 1e-5) {
          const ref: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
          ux = t0[1] * ref[2] - t0[2] * ref[1];
          uy = t0[2] * ref[0] - t0[0] * ref[2];
          uz = t0[0] * ref[1] - t0[1] * ref[0];
        }
        const ul = Math.hypot(ux, uy, uz) || 1;
        bishopU[0] = [ux / ul, uy / ul, uz / ul];
        bishopV[0] = [
          t0[1] * bishopU[0][2] - t0[2] * bishopU[0][1],
          t0[2] * bishopU[0][0] - t0[0] * bishopU[0][2],
          t0[0] * bishopU[0][1] - t0[1] * bishopU[0][0],
        ];

        for (let k = 1; k <= M; k++) {
          const tp = tangs[k - 1];
          const tc = tangs[k];
          const up = bishopU[k - 1];
          // Parallel transport up along tp -> tc
          const ax = tp[1] * tc[2] - tp[2] * tc[1];
          const ay = tp[2] * tc[0] - tp[0] * tc[2];
          const az = tp[0] * tc[1] - tp[1] * tc[0];
          const sinA = Math.hypot(ax, ay, az);
          const cosA = clamp(tp[0] * tc[0] + tp[1] * tc[1] + tp[2] * tc[2], -1, 1);
          let nx = up[0],
            ny = up[1],
            nz = up[2];
          if (sinA > 1e-7) {
            const kx = ax / sinA,
              ky = ay / sinA,
              kz = az / sinA;
            const kDotU = kx * nx + ky * ny + kz * nz;
            const kCrossUx = ky * nz - kz * ny;
            const kCrossUy = kz * nx - kx * nz;
            const kCrossUz = kx * ny - ky * nx;
            nx = nx * cosA + kCrossUx * sinA + kx * kDotU * (1 - cosA);
            ny = ny * cosA + kCrossUy * sinA + ky * kDotU * (1 - cosA);
            nz = nz * cosA + kCrossUz * sinA + kz * kDotU * (1 - cosA);
          }
          // Re-orthogonalize against tc
          const d = nx * tc[0] + ny * tc[1] + nz * tc[2];
          nx -= d * tc[0];
          ny -= d * tc[1];
          nz -= d * tc[2];
          const nl = Math.hypot(nx, ny, nz) || 1;
          bishopU[k] = [nx / nl, ny / nl, nz / nl];
          bishopV[k] = [
            tc[1] * bishopU[k][2] - tc[2] * bishopU[k][1],
            tc[2] * bishopU[k][0] - tc[0] * bishopU[k][2],
            tc[0] * bishopU[k][1] - tc[1] * bishopU[k][0],
          ];
        }
      }

      // Guide face normals (for barrel sheets & cylindrical alpha-helices) -> smooth unwrapped roll phi_k
      const anchors: Array<[number, number]> = [];
      for (let i = 0; i < N; i++) {
        let gx = 0,
          gy = 0,
          gz = 0,
          hasG = false;
        const rn = rawNormals[i];
        if (rn) {
          gx = rn[0];
          gy = rn[1];
          gz = rn[2];
          hasG = true;
        } else if (ptKinds[i] === 'sheet' && hasFaceCenter) {
          gx = pts[i][0] - faceCenterPt[0];
          gy = pts[i][1] - faceCenterPt[1];
          gz = pts[i][2] - faceCenterPt[2];
          hasG = true;
        } else if (ptKinds[i] === 'helix') {
          const pPrev = getPt(i - 1);
          const pNext = getPt(i + 1);
          gx = pts[i][0] - 0.5 * (pPrev[0] + pNext[0]);
          gy = pts[i][1] - 0.5 * (pPrev[1] + pNext[1]);
          gz = pts[i][2] - 0.5 * (pPrev[2] + pNext[2]);
          hasG = true;
        }
        if (hasG) {
          const ki = Math.min(M, i * subdiv);
          const uComp =
            gx * bishopU[ki][0] + gy * bishopU[ki][1] + gz * bishopU[ki][2];
          const vComp =
            gx * bishopV[ki][0] + gy * bishopV[ki][1] + gz * bishopV[ki][2];
          if (Math.hypot(uComp, vComp) > 1e-4) {
            anchors.push([ki, Math.atan2(vComp, uComp)]);
          }
        }
      }

      const roll = new Float64Array(M + 1);
      if (anchors.length > 0) {
        // Unwrap anchor angles continuously
        for (let a = 1; a < anchors.length; a++) {
          const prev = anchors[a - 1][1];
          const diff = Math.atan2(
            Math.sin(anchors[a][1] - prev),
            Math.cos(anchors[a][1] - prev),
          );
          anchors[a][1] = prev + diff;
        }
        for (let k = 0; k <= anchors[0][0]; k++) roll[k] = anchors[0][1];
        for (let a = 0; a < anchors.length - 1; a++) {
          const [k0, r0] = anchors[a];
          const [k1, r1] = anchors[a + 1];
          const span = Math.max(1, k1 - k0);
          for (let k = k0; k <= k1; k++) {
            const u = (k - k0) / span;
            const sm = u * u * (3 - 2 * u);
            roll[k] = r0 + (r1 - r0) * sm;
          }
        }
        const lastA = anchors[anchors.length - 1];
        for (let k = lastA[0]; k <= M; k++) roll[k] = lastA[1];
      }

      if (closed) {
        // Close Bishop seam holonomy so frame(M) === frame(0)
        const uDot =
          bishopU[M][0] * bishopU[0][0] +
          bishopU[M][1] * bishopU[0][1] +
          bishopU[M][2] * bishopU[0][2];
        const vDot =
          bishopV[M][0] * bishopU[0][0] +
          bishopV[M][1] * bishopU[0][1] +
          bishopV[M][2] * bishopU[0][2];
        // bishop0 = cos(hol)*bishopU[M] + sin(hol)*bishopV[M] -> roll[M] needs hol + roll[0] mod TAU
        const hol = Math.atan2(vDot, uDot);
        const targetEnd =
          hol + roll[0] + TAU * Math.round((roll[M] - (hol + roll[0])) / TAU);
        const corr = targetEnd - roll[M];
        for (let k = 0; k <= M; k++) roll[k] += (corr * k) / M;
      }

      // Smooth roll slightly to eliminate kinks
      const tmpRoll = new Float64Array(M + 1);
      for (let pass = 0; pass < 3; pass++) {
        tmpRoll[0] = roll[0];
        tmpRoll[M] = roll[M];
        for (let k = 1; k < M; k++) {
          tmpRoll[k] = 0.25 * roll[k - 1] + 0.5 * roll[k] + 0.25 * roll[k + 1];
        }
        roll.set(tmpRoll);
      }

      // Secondary-structure contiguous runs -> width w_k, thickness t_k, squareness q_k
      const halfW = new Float64Array(M + 1).fill(coilR);
      const halfT = new Float64Array(M + 1).fill(coilR);
      const sqness = new Float64Array(M + 1).fill(0);
      const isCreaseRing = new Uint8Array(M + 1);

      let runStart = 0;
      while (runStart < N) {
        const rk = ptKinds[runStart];
        let runEnd = runStart;
        while (runEnd + 1 < N && ptKinds[runEnd + 1] === rk) runEnd++;
        if ((rk === 'sheet' || rk === 'helix') && runEnd > runStart) {
          const k0 = runStart * subdiv;
          const k1 = Math.min(M, runEnd * subdiv);
          const span = Math.max(1, k1 - k0);
          if (rk === 'helix') {
            for (let k = k0; k <= k1; k++) {
              const tau = (k - k0) / span;
              const rampIn = clamp(tau / 0.12, 0, 1);
              const rampOut = clamp((1 - tau) / 0.12, 0, 1);
              const blend = Math.min(rampIn, rampOut);
              const sm = blend * blend * (3 - 2 * blend);
              halfW[k] = coilR + (helixHW - coilR) * sm;
              halfT[k] = coilR + (helixHT - coilR) * sm;
              sqness[k] = 0.38 * sm;
            }
          } else {
            // 'sheet': ramp in -> flat strap -> crisp arrowhead barb shoulder -> linear triangular taper to coilR!
            const kNeck = clamp(
              Math.round(k0 + span * (1 - arrowFrac)),
              k0 + 1,
              Math.max(k0 + 1, k1 - 2),
            );
            const kShoulder = clamp(
              Math.max(kNeck + 1, Math.round(k0 + span * (1 - arrowFrac + 0.03))),
              kNeck + 1,
              Math.max(kNeck + 1, k1 - 1),
            );
            if (kNeck > 0 && kNeck < M) isCreaseRing[kNeck] = 1;
            if (kShoulder > 0 && kShoulder < M) isCreaseRing[kShoulder] = 1;
            for (let k = k0; k <= k1; k++) {
              const tau = (k - k0) / span;
              const rampIn = clamp(tau / 0.09, 0, 1);
              const smIn = rampIn * rampIn * (3 - 2 * rampIn);
              if (k <= kNeck) {
                halfW[k] = coilR + (sheetHW - coilR) * smIn;
                halfT[k] = coilR + (sheetHT - coilR) * smIn;
                sqness[k] = 0.82 * smIn;
              } else if (k <= kShoulder) {
                const uFlare = (k - kNeck) / Math.max(1, kShoulder - kNeck);
                halfW[k] = sheetHW + (arrowHW - sheetHW) * uFlare;
                halfT[k] = sheetHT;
                sqness[k] = 0.84;
              } else {
                const uTip = (k - kShoulder) / Math.max(1, k1 - kShoulder);
                halfW[k] = arrowHW + (coilR - arrowHW) * uTip;
                halfT[k] = sheetHT + (coilR - sheetHT) * (uTip * uTip);
                sqness[k] = 0.84 * (1 - uTip * uTip);
              }
            }
          }
        }
        runStart = runEnd + 1;
      }

      // Compute oriented local cross-section triad (B_k, N_k) and guard against inner-bend self-folding
      const frameB = new Array<Vec3>(M + 1);
      const frameN = new Array<Vec3>(M + 1);
      for (let k = 0; k <= M; k++) {
        if (closed && k === M) {
          frameB[M] = frameB[0];
          frameN[M] = frameN[0];
          continue;
        }
        const tc = tangs[k];
        const bu = bishopU[k];
        const bv = bishopV[k];
        const cr = Math.cos(roll[k]);
        const sr = Math.sin(roll[k]);
        const nx = cr * bu[0] + sr * bv[0];
        const ny = cr * bu[1] + sr * bv[1];
        const nz = cr * bu[2] + sr * bv[2];
        // B = T x N (right-handed triad N x B = T)
        frameN[k] = [nx, ny, nz];
        frameB[k] = [
          tc[1] * nz - tc[2] * ny,
          tc[2] * nx - tc[0] * nz,
          tc[0] * ny - tc[1] * nx,
        ];
      }

      const shrink = new Float64Array(M + 1).fill(1);
      const checkStepFold = (kRing: number, kStep: number) => {
        const cA = centers[kStep];
        const cB = centers[kStep + 1];
        const dx = cB[0] - cA[0];
        const dy = cB[1] - cA[1];
        const dz = cB[2] - cA[2];
        const ds = Math.hypot(dx, dy, dz);
        if (ds <= 1e-8) return;
        const tx = dx / ds;
        const ty = dy / ds;
        const tz = dz / ds;
        const dBx = frameB[kStep + 1][0] - frameB[kStep][0];
        const dBy = frameB[kStep + 1][1] - frameB[kStep][1];
        const dBz = frameB[kStep + 1][2] - frameB[kStep][2];
        const dNx = frameN[kStep + 1][0] - frameN[kStep][0];
        const dNy = frameN[kStep + 1][1] - frameN[kStep][1];
        const dNz = frameN[kStep + 1][2] - frameN[kStep][2];
        const kb = Math.abs(dBx * tx + dBy * ty + dBz * tz);
        const kn = Math.abs(dNx * tx + dNy * ty + dNz * tz);
        const foldMotion = halfW[kRing] * kb + halfT[kRing] * kn;
        const limit = 0.62 * ds;
        if (foldMotion > limit && foldMotion > 1e-9) {
          const f = Math.max(0.08, limit / foldMotion);
          if (f < shrink[kRing]) shrink[kRing] = f;
        }
      };
      for (let k = 0; k <= M; k++) {
        if (k < M) checkStepFold(k, k);
        else if (closed) checkStepFold(k, 0);
        if (k > 0) checkStepFold(k, k - 1);
        else if (closed) checkStepFold(k, M - 1);
      }
      if (closed) {
        const s0 = Math.min(shrink[0], shrink[M]);
        shrink[0] = s0;
        shrink[M] = s0;
      }
      for (let k = 0; k <= M; k++) {
        halfW[k] *= shrink[k];
        halfT[k] *= shrink[k];
      }
      if (closed) {
        halfW[M] = halfW[0];
        halfT[M] = halfT[0];
        sqness[M] = sqness[0];
      }

      // Build unique spatial ring positions `(M + 1) x P`
      const ringXYZ = new Float64Array((M + 1) * P * 3);
      const sgnPow = (x: number, e: number): number =>
        x === 0 ? 0 : (x < 0 ? -1 : 1) * Math.pow(Math.abs(x), e);

      for (let k = 0; k <= M; k++) {
        if (closed && k === M) {
          for (let j = 0; j < P * 3; j++) ringXYZ[M * P * 3 + j] = ringXYZ[j];
          continue;
        }
        const c = centers[k];
        const [bx, by, bz] = frameB[k];
        const [nx, ny, nz] = frameN[k];
        const wk = halfW[k];
        const tk = halfT[k];
        const ek = 1 - 0.65 * sqness[k];
        for (let j = 0; j < P; j++) {
          const ang = (j * TAU) / P;
          const uOff = wk * sgnPow(Math.cos(ang), ek);
          const vOff = tk * sgnPow(Math.sin(ang), ek);
          const base = (k * P + j) * 3;
          ringXYZ[base] = c[0] + uOff * bx + vOff * nx;
          ringXYZ[base + 1] = c[1] + uOff * by + vOff * ny;
          ringXYZ[base + 2] = c[2] + uOff * bz + vOff * nz;
        }
      }

      // Map each longitudinal strip `k = 0..M-1` to vertex rows (splitting normals at sharp arrowhead creases)
      const stripRow0 = new Int32Array(M);
      const stripRow1 = new Int32Array(M);
      const rowSpatialK: number[] = [0];
      let curRow = 0;
      for (let k = 0; k < M; k++) {
        stripRow0[k] = curRow;
        curRow++;
        rowSpatialK.push(k + 1);
        stripRow1[k] = curRow;
        if (k + 1 < M && isCreaseRing[k + 1]) {
          curRow++;
          rowSpatialK.push(k + 1);
        }
      }
      const sideRows = rowSpatialK.length;
      const normRowOf = (r: number): number =>
        closed && r === sideRows - 1 ? 0 : r;
      const uniqNormRows = closed ? sideRows - 1 : sideRows;
      const sideNrm = new Float64Array(uniqNormRows * P * 3);

      const addStripFaceNrm = (
        kA: number,
        nRowA: number,
        jA: number,
        kB: number,
        nRowB: number,
        jB: number,
        kC: number,
        nRowC: number,
        jC: number,
      ) => {
        const pA = (kA * P + jA) * 3;
        const pB = (kB * P + jB) * 3;
        const pC = (kC * P + jC) * 3;
        const abx = ringXYZ[pB] - ringXYZ[pA];
        const aby = ringXYZ[pB + 1] - ringXYZ[pA + 1];
        const abz = ringXYZ[pB + 2] - ringXYZ[pA + 2];
        const acx = ringXYZ[pC] - ringXYZ[pA];
        const acy = ringXYZ[pC + 1] - ringXYZ[pA + 1];
        const acz = ringXYZ[pC + 2] - ringXYZ[pA + 2];
        const fnx = aby * acz - abz * acy;
        const fny = abz * acx - abx * acz;
        const fnz = abx * acy - aby * acx;
        for (const dst of [
          (nRowA * P + jA) * 3,
          (nRowB * P + jB) * 3,
          (nRowC * P + jC) * 3,
        ]) {
          sideNrm[dst] += fnx;
          sideNrm[dst + 1] += fny;
          sideNrm[dst + 2] += fnz;
        }
      };

      for (let k = 0; k < M; k++) {
        const nr0 = normRowOf(stripRow0[k]);
        const nr1 = normRowOf(stripRow1[k]);
        for (let j = 0; j < P; j++) {
          const j1 = (j + 1) % P;
          addStripFaceNrm(k, nr0, j, k + 1, nr1, j, k + 1, nr1, j1);
          addStripFaceNrm(k, nr0, j, k + 1, nr1, j1, k, nr0, j1);
        }
      }
      for (let i = 0; i < sideNrm.length; i += 3) {
        const nl = Math.hypot(sideNrm[i], sideNrm[i + 1], sideNrm[i + 2]) || 1;
        sideNrm[i] /= nl;
        sideNrm[i + 1] /= nl;
        sideNrm[i + 2] /= nl;
      }

      const sideVCount = sideRows * (P + 1);
      const capVCount = closed ? 0 : 2 * (P + 1);
      const totalV = sideVCount + capVCount;
      const pos = new Array<number>(totalV * 3);
      const nrm = new Array<number>(totalV * 3);
      const uv = new Array<number>(totalV * 2);
      const col = new Array<number>(totalV * 3);
      const idx: number[] = [];

      for (let r = 0; r < sideRows; r++) {
        const k = rowSpatialK[r];
        const uChain = k / M;
        const [cr, cg, cb] = evalColorScheme(uChain, colorScheme, ptKinds);
        const nr = normRowOf(r);
        for (let j = 0; j <= P; j++) {
          const jMod = j === P ? 0 : j;
          const src = (k * P + jMod) * 3;
          const nSrc = (nr * P + jMod) * 3;
          const vIdx = r * (P + 1) + j;
          const pOff = vIdx * 3;
          pos[pOff] = ringXYZ[src];
          pos[pOff + 1] = ringXYZ[src + 1];
          pos[pOff + 2] = ringXYZ[src + 2];
          nrm[pOff] = sideNrm[nSrc];
          nrm[pOff + 1] = sideNrm[nSrc + 1];
          nrm[pOff + 2] = sideNrm[nSrc + 2];
          uv[vIdx * 2] = uChain;
          uv[vIdx * 2 + 1] = j / P;
          col[pOff] = cr;
          col[pOff + 1] = cg;
          col[pOff + 2] = cb;
        }
      }

      for (let k = 0; k < M; k++) {
        const row0 = stripRow0[k] * (P + 1);
        const row1 = stripRow1[k] * (P + 1);
        for (let j = 0; j < P; j++) {
          const a0 = row0 + j;
          const b0 = row1 + j;
          const b1 = row1 + j + 1;
          const a1 = row0 + j + 1;
          idx.push(a0, b0, b1, a0, b1, a1);
        }
      }

      if (!closed) {
        let vCap = sideVCount;
        // Start cap at k = 0 (normal = -T_0, winding: center, v0, v1)
        const c0 = centers[0];
        const t0 = tangs[0];
        const [c0r, c0g, c0b] = evalColorScheme(0, colorScheme, ptKinds);
        const startCenter = vCap++;
        pos[startCenter * 3] = c0[0];
        pos[startCenter * 3 + 1] = c0[1];
        pos[startCenter * 3 + 2] = c0[2];
        nrm[startCenter * 3] = -t0[0];
        nrm[startCenter * 3 + 1] = -t0[1];
        nrm[startCenter * 3 + 2] = -t0[2];
        uv[startCenter * 2] = 0;
        uv[startCenter * 2 + 1] = 0.5;
        col[startCenter * 3] = c0r;
        col[startCenter * 3 + 1] = c0g;
        col[startCenter * 3 + 2] = c0b;

        const startRingBase = vCap;
        for (let j = 0; j < P; j++) {
          const src = j * 3;
          const vi = vCap++;
          pos[vi * 3] = ringXYZ[src];
          pos[vi * 3 + 1] = ringXYZ[src + 1];
          pos[vi * 3 + 2] = ringXYZ[src + 2];
          nrm[vi * 3] = -t0[0];
          nrm[vi * 3 + 1] = -t0[1];
          nrm[vi * 3 + 2] = -t0[2];
          uv[vi * 2] = 0;
          uv[vi * 2 + 1] = j / P;
          col[vi * 3] = c0r;
          col[vi * 3 + 1] = c0g;
          col[vi * 3 + 2] = c0b;
        }
        for (let j = 0; j < P; j++) {
          idx.push(startCenter, startRingBase + j, startRingBase + ((j + 1) % P));
        }

        // End cap at k = M (normal = +T_M, winding: center, b1, b0)
        const cM = centers[M];
        const tM = tangs[M];
        const [cMr, cMg, cMb] = evalColorScheme(1, colorScheme, ptKinds);
        const endCenter = vCap++;
        pos[endCenter * 3] = cM[0];
        pos[endCenter * 3 + 1] = cM[1];
        pos[endCenter * 3 + 2] = cM[2];
        nrm[endCenter * 3] = tM[0];
        nrm[endCenter * 3 + 1] = tM[1];
        nrm[endCenter * 3 + 2] = tM[2];
        uv[endCenter * 2] = 1;
        uv[endCenter * 2 + 1] = 0.5;
        col[endCenter * 3] = cMr;
        col[endCenter * 3 + 1] = cMg;
        col[endCenter * 3 + 2] = cMb;

        const endRingBase = vCap;
        for (let j = 0; j < P; j++) {
          const src = (M * P + j) * 3;
          const vi = vCap++;
          pos[vi * 3] = ringXYZ[src];
          pos[vi * 3 + 1] = ringXYZ[src + 1];
          pos[vi * 3 + 2] = ringXYZ[src + 2];
          nrm[vi * 3] = tM[0];
          nrm[vi * 3 + 1] = tM[1];
          nrm[vi * 3 + 2] = tM[2];
          uv[vi * 2] = 1;
          uv[vi * 2 + 1] = j / P;
          col[vi * 3] = cMr;
          col[vi * 3 + 1] = cMg;
          col[vi * 3 + 2] = cMb;
        }
        for (let j = 0; j < P; j++) {
          idx.push(endCenter, endRingBase + ((j + 1) % P), endRingBase + j);
        }
      }

      applyBuffers(this, {pos, nrm, uv, idx, col}, 'RibbonGeometry', {
        pointCount: N,
        sampleRings: M,
        closed,
        colorScheme,
      });
    }
  }

  const Science = {
    MAX_SCI_ATOMS: MAX_ATOMS,
    MAX_SCI_GRID: MAX_GRID,
    MAX_SCI_GLYPHS: MAX_GLYPHS,
    MAX_SCI_BASE_PAIRS: MAX_BP,
    MAX_SCI_RIBBON_POINTS: MAX_RIBBON_PTS,
    elementSpec,
    ribbonColorMap,
    MoleculeGeometry,
    CrystalLatticeGeometry,
    AtomicOrbitalGeometry,
    OpticalElementGeometry,
    SurfacePlotGeometry,
    ParametricSurfaceGeometry,
    VectorFieldGeometry,
    Axes3DGeometry,
    DoubleHelixGeometry,
    RibbonGeometry,
  };

  for (const Ctor of [
    MoleculeGeometry,
    CrystalLatticeGeometry,
    AtomicOrbitalGeometry,
    OpticalElementGeometry,
    SurfacePlotGeometry,
    ParametricSurfaceGeometry,
    VectorFieldGeometry,
    Axes3DGeometry,
    DoubleHelixGeometry,
    RibbonGeometry,
  ]) {
    try {
      Object.freeze(Ctor.prototype);
      Object.freeze(Ctor);
    } catch {
      // Ignore if host environment disallows freezing.
    }
  }
  try {
    Object.freeze(Science);
  } catch {
    // Ignore if host environment disallows freezing.
  }

  if (reg?.authorNamespace?.Science?.MoleculeGeometry) {
    return {Science: reg.authorNamespace.Science};
  }
  const exportsMap = {
    Science,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) reg.authorNamespace = {};
    Object.assign(reg.authorNamespace, exportsMap);
  } else {
    try {
      threeNs.Science = Science;
    } catch {
      // Frozen THREE proxy resolves via reg.authorNamespace.
    }
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` domain kit plugin registering parametric
 * science / chemistry / math geometries (`THREE.Science.*`).
 */
export const scienceKitPlugin: ThreeLivePlugin = {
  name: 'kit-science',
  onRegister(): void {
    registerWorkerExtensionInstaller(installScienceKit);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installScienceKit(threeNs, reg);
    }
  },
};
