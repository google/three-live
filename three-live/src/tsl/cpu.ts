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
 * @fileoverview Deterministic IEEE-754 CPU Reference Evaluator for
 * `GOOGLE_material_tsl` graphs (kept separate from `three-live-tsl.min.js` so
 * browser GPU bundles stay `< 12 KB gz`).
 */

import {
  packUniformVec4,
  TSL_TIME_PERIOD_SEC,
  tslSafeMod,
  tslTypeArity,
  type ValidatedTslGraph,
} from './ir';

/** Per-vertex / per-fragment surface state passed to `evaluateTslGraphCpu`. */
export interface TslEvalContext {
  readonly positionLocal?: readonly [number, number, number];
  readonly positionWorld?: readonly [number, number, number];
  readonly normalLocal?: readonly [number, number, number];
  readonly normalWorld?: readonly [number, number, number];
  readonly viewDirection?: readonly [number, number, number];
  readonly uv?: readonly [number, number];
  readonly vertexColor?: readonly [number, number, number, number];
  readonly instanceIndex?: number;
  readonly time?: number;
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;
  readonly dpdx?: readonly [number, number, number];
  readonly dpdy?: readonly [number, number, number];
  readonly dhdx?: number;
  readonly dhdy?: number;
}

/** Evaluated PBR socket outputs from `evaluateTslGraphCpu`. */
export interface TslEvalOutputs {
  readonly color?: [number, number, number];
  readonly opacity?: number;
  readonly emissive?: [number, number, number];
  readonly roughness?: number;
  readonly metalness?: number;
  readonly normalScale?: number;
  readonly bump?: [number, number, number];
  readonly position?: [number, number, number];
}

/** Safe zero-guarded division (`abs(b) < 1e-6` clamped away from zero). */
export function tslSafeDiv(a: number, b: number): number {
  const denom = Math.abs(b) < 1e-6 ? (b < 0 ? -1e-6 : 1e-6) : b;
  return a / denom;
}

/** Defined across all real `(a, b)` including `(0, 0)`, `(0, -1)`, and `(-2, 0.5)`. */
export function tslSafePow(a: number, b: number): number {
  const exp = Math.min(Math.max(b, -64), 64);
  if (Math.abs(exp) < 1e-8) return 1;
  if (a <= 0) return 0;
  return Math.pow(Math.max(a, 1e-8), exp);
}

/** Order-safe clamp (`minVal > maxVal` swapped cleanly). */
export function tslSafeClamp(x: number, lo: number, hi: number): number {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return Math.min(Math.max(x, a), b);
}

/** Zero-width-safe Hermite smoothstep (`edge0 == edge1` never produces NaN). */
export function tslSafeSmoothstep(e0: number, e1: number, x: number): number {
  const t = tslSafeClamp(tslSafeDiv(x - e0, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mod289Scalar(x: number): number {
  return x - Math.floor(x * (1 / 289)) * 289;
}

function permuteScalar(x: number): number {
  return mod289Scalar((x * 34 + 10) * x);
}

function taylorInvSqrtScalar(r: number): number {
  return 1.79284291400159 - 0.85373472095314 * r;
}

/** Pure-ALU Ashima 2D Simplex Noise mapped to `[0, 1]`. */
export function tslSimplexNoise2D(vx: number, vy: number): number {
  const c0 = 0.211324865405187;
  const c1 = 0.366025403784439;
  const c2 = -0.577350269189626;
  const c3 = 0.024390243902439;

  const s = (vx + vy) * c1;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  const t = (ix + iy) * c0;
  const x0x = vx - ix + t;
  const x0y = vy - iy + t;

  const i1x = x0x > x0y ? 1 : 0;
  const i1y = x0x > x0y ? 0 : 1;
  const x1x = x0x + c0 - i1x;
  const x1y = x0y + c0 - i1y;
  const x2x = x0x + c2;
  const x2y = x0y + c2;

  ix = mod289Scalar(ix);
  iy = mod289Scalar(iy);
  const p0 = permuteScalar(permuteScalar(iy) + ix);
  const p1 = permuteScalar(permuteScalar(iy + i1y) + ix + i1x);
  const p2 = permuteScalar(permuteScalar(iy + 1) + ix + 1);

  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0);
  let m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y), 0);
  let m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y), 0);
  m0 = m0 * m0 * m0 * m0;
  m1 = m1 * m1 * m1 * m1;
  m2 = m2 * m2 * m2 * m2;

  const gx0 = 2 * (p0 * c3 - Math.floor(p0 * c3)) - 1;
  const gx1 = 2 * (p1 * c3 - Math.floor(p1 * c3)) - 1;
  const gx2 = 2 * (p2 * c3 - Math.floor(p2 * c3)) - 1;
  const hy0 = Math.abs(gx0) - 0.5;
  const hy1 = Math.abs(gx1) - 0.5;
  const hy2 = Math.abs(gx2) - 0.5;
  const ox0 = gx0 - Math.floor(gx0 + 0.5);
  const ox1 = gx1 - Math.floor(gx1 + 0.5);
  const ox2 = gx2 - Math.floor(gx2 + 0.5);

  m0 *= 1.79284291400159 - 0.85373472095314 * (ox0 * ox0 + hy0 * hy0);
  m1 *= 1.79284291400159 - 0.85373472095314 * (ox1 * ox1 + hy1 * hy1);
  m2 *= 1.79284291400159 - 0.85373472095314 * (ox2 * ox2 + hy2 * hy2);

  const g0 = ox0 * x0x + hy0 * x0y;
  const g1 = ox1 * x1x + hy1 * x1y;
  const g2 = ox2 * x2x + hy2 * x2y;
  const n = 130 * (m0 * g0 + m1 * g1 + m2 * g2);
  return tslSafeClamp(0.5 + 0.5 * n, 0, 1);
}

/** Pure-ALU Ashima 3D Simplex Noise mapped to `[0, 1]`. */
export function tslSimplexNoise3D(vx: number, vy: number, vz: number): number {
  const c0 = 1 / 6;
  const c1 = 1 / 3;
  const s = (vx + vy + vz) * c1;
  let i0 = Math.floor(vx + s);
  let i1 = Math.floor(vy + s);
  let i2 = Math.floor(vz + s);
  const t = (i0 + i1 + i2) * c0;
  const x0 = vx - i0 + t;
  const y0 = vy - i1 + t;
  const z0 = vz - i2 + t;

  const gx = x0 >= y0 ? 1 : 0;
  const gy = y0 >= z0 ? 1 : 0;
  const gz = z0 >= x0 ? 1 : 0;
  const l0 = 1 - gz;
  const l1 = 1 - gx;
  const l2 = 1 - gy;

  const i1x = Math.min(gx, l0);
  const i1y = Math.min(gy, l1);
  const i1z = Math.min(gz, l2);
  const i2x = Math.max(gx, l0);
  const i2y = Math.max(gy, l1);
  const i2z = Math.max(gz, l2);

  const x1 = x0 - i1x + c0;
  const y1 = y0 - i1y + c0;
  const z1 = z0 - i1z + c0;
  const x2 = x0 - i2x + c1;
  const y2 = y0 - i2y + c1;
  const z2 = z0 - i2z + c1;
  const x3 = x0 - 0.5;
  const y3 = y0 - 0.5;
  const z3 = z0 - 0.5;

  i0 = mod289Scalar(i0);
  i1 = mod289Scalar(i1);
  i2 = mod289Scalar(i2);

  const p0 = permuteScalar(permuteScalar(permuteScalar(i2) + i1) + i0);
  const p1 = permuteScalar(
    permuteScalar(permuteScalar(i2 + i1z) + i1 + i1y) + i0 + i1x,
  );
  const p2 = permuteScalar(
    permuteScalar(permuteScalar(i2 + i2z) + i1 + i2y) + i0 + i2x,
  );
  const p3 = permuteScalar(
    permuteScalar(permuteScalar(i2 + 1) + i1 + 1) + i0 + 1,
  );

  const ns = 1 / 7;
  const ps = [p0, p1, p2, p3];
  const xs = [x0, x1, x2, x3];
  const ys = [y0, y1, y2, y3];
  const zs = [z0, z1, z2, z3];
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const pk = ps[k];
    const j = pk - 49 * Math.floor(pk * ns * ns);
    const x_ = Math.floor(j * ns);
    const y_ = Math.floor(j - 7 * x_);
    let gxK = x_ * (2 / 7) + 1 / 7 - 1;
    let gyK = y_ * (2 / 7) + 1 / 7 - 1;
    const gzK = 1 - Math.abs(gxK) - Math.abs(gyK);
    const sz = gzK < 0 ? 1 : 0;
    gxK -= sz * (gxK >= 0 ? 1 : -1);
    gyK -= sz * (gyK >= 0 ? 1 : -1);
    const inv = taylorInvSqrtScalar(gxK * gxK + gyK * gyK + gzK * gzK);
    gxK *= inv;
    gyK *= inv;
    const gzN = gzK * inv;
    let m = Math.max(0.6 - (xs[k] * xs[k] + ys[k] * ys[k] + zs[k] * zs[k]), 0);
    m = m * m;
    m = m * m;
    sum += m * (gxK * xs[k] + gyK * ys[k] + gzN * zs[k]);
  }
  return tslSafeClamp(0.5 + 0.5 * (42 * sum), 0, 1);
}

/** Pure-ALU polynomial cellular F1 Voronoi distance in `[0, 1]`. */
export function tslVoronoi2D(ux: number, uy: number, jitter: number): number {
  const nx = Math.floor(ux);
  const ny = Math.floor(uy);
  const fx = ux - nx;
  const fy = uy - ny;
  const jit = tslSafeClamp(jitter, 0, 1);
  let minDist = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const qx = mod289Scalar(nx + dx);
      const qy = mod289Scalar(ny + dy);
      const pA = permuteScalar(permuteScalar(qx) + qy) * (1 / 41);
      const pB = permuteScalar(permuteScalar(qy + 7) + qx + 13) * (1 / 41);
      const hx = pA - Math.floor(pA);
      const hy = pB - Math.floor(pB);
      const rx = dx + 0.5 + (hx - 0.5) * jit - fx;
      const ry = dy + 0.5 + (hy - 0.5) * jit - fy;
      const d = Math.hypot(rx, ry);
      if (d < minDist) minDist = d;
    }
  }
  return tslSafeClamp(minDist, 0, 1);
}

/** Evaluates a validated `GOOGLE_material_tsl` DAG on the CPU. */
export function evaluateTslGraphCpu(
  graph: ValidatedTslGraph,
  ctx: TslEvalContext = {},
): TslEvalOutputs {
  const posL = ctx.positionLocal ?? [0, 0, 0];
  const posW = ctx.positionWorld ?? posL;
  const normL = ctx.normalLocal ?? [0, 1, 0];
  const normW = ctx.normalWorld ?? normL;
  const viewD = ctx.viewDirection ?? [0, 0, 1];
  const uv = ctx.uv ?? [0, 0];
  const vCol = ctx.vertexColor ?? [1, 1, 1, 1];
  const instIdx = Number.isFinite(ctx.instanceIndex)
    ? (ctx.instanceIndex as number)
    : 0;
  const wrappedTime = tslSafeMod(
    Number.isFinite(ctx.time) ? (ctx.time as number) : 0,
    TSL_TIME_PERIOD_SEC,
  );

  const uTable: Array<[number, number, number, number]> =
    graph.uniformSlots.map((s) => {
      const override = ctx.uniforms?.[s.name];
      if (override !== undefined) {
        const packed = packUniformVec4(s.type, override);
        if (packed) return packed;
      }
      return [
        s.defaultVec4[0],
        s.defaultVec4[1],
        s.defaultVec4[2],
        s.defaultVec4[3],
      ];
    });

  const vals: number[][] = new Array(graph.nodes.length);
  const getComp = (v: number[], i: number): number =>
    v.length === 1 ? v[0] : v[i];
  const normVec = (v: readonly number[]): number[] => {
    let sq = 0;
    for (let i = 0; i < v.length; i++) sq += v[i] * v[i];
    const len = Math.sqrt(sq);
    return len > 1e-6 ? v.map((c) => c / len) : v.map(() => 0);
  };

  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const arity = tslTypeArity(n.type);
    switch (n.op) {
      case 'const':
        vals[i] = [...(n.value ?? [0])];
        break;
      case 'builtin':
        switch (n.builtin!) {
          case 'positionLocal':
            vals[i] = [posL[0], posL[1], posL[2]];
            break;
          case 'positionWorld':
            vals[i] = [posW[0], posW[1], posW[2]];
            break;
          case 'normalLocal':
            vals[i] = [normL[0], normL[1], normL[2]];
            break;
          case 'normalWorld':
            vals[i] = [normW[0], normW[1], normW[2]];
            break;
          case 'viewDirection':
            vals[i] = [viewD[0], viewD[1], viewD[2]];
            break;
          case 'uv':
            vals[i] = [uv[0], uv[1]];
            break;
          case 'vertexColor':
            vals[i] = [vCol[0], vCol[1], vCol[2], vCol[3]];
            break;
          case 'instanceIndex':
            vals[i] = [instIdx];
            break;
          case 'time':
            vals[i] = [wrappedTime];
            break;
          default:
            vals[i] = [0];
            break;
        }
        break;
      case 'uniform': {
        const u = uTable[n.uniformSlot ?? 0] ?? [0, 0, 0, 0];
        vals[i] = u.slice(0, arity);
        break;
      }
      case 'swizzle': {
        const src = vals[n.args[0]];
        const m = n.mask!;
        const out: number[] = [];
        for (let c = 0; c < m.length; c++) {
          out.push(src['xyzw'.indexOf(m[c])] ?? 0);
        }
        vals[i] = out;
        break;
      }
      case 'construct': {
        if (n.args.length === 1 && vals[n.args[0]].length === 1) {
          vals[i] = new Array(arity).fill(vals[n.args[0]][0]);
        } else {
          const out: number[] = [];
          for (const a of n.args) {
            for (const comp of vals[a]) out.push(comp);
          }
          vals[i] = out.slice(0, arity);
        }
        break;
      }
      case 'neg':
        vals[i] = vals[n.args[0]].map((x) => -x);
        break;
      case 'abs':
        vals[i] = vals[n.args[0]].map((x) => Math.abs(x));
        break;
      case 'sign':
        vals[i] = vals[n.args[0]].map((x) => (x > 0 ? 1 : x < 0 ? -1 : 0));
        break;
      case 'floor':
        vals[i] = vals[n.args[0]].map((x) => Math.floor(x));
        break;
      case 'ceil':
        vals[i] = vals[n.args[0]].map((x) => Math.ceil(x));
        break;
      case 'fract':
        vals[i] = vals[n.args[0]].map((x) => x - Math.floor(x));
        break;
      case 'sqrt':
        vals[i] = vals[n.args[0]].map((x) => Math.sqrt(Math.max(x, 0)));
        break;
      case 'exp':
        vals[i] = vals[n.args[0]].map((x) =>
          Math.exp(tslSafeClamp(x, -80, 80)),
        );
        break;
      case 'log':
        vals[i] = vals[n.args[0]].map((x) => Math.log(Math.max(x, 1e-8)));
        break;
      case 'sin':
        vals[i] = vals[n.args[0]].map((x) => Math.sin(x));
        break;
      case 'cos':
        vals[i] = vals[n.args[0]].map((x) => Math.cos(x));
        break;
      case 'normalize':
        vals[i] = normVec(vals[n.args[0]]);
        break;
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
      case 'mod':
      case 'pow':
      case 'atan2':
      case 'min':
      case 'max':
      case 'step': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        const out: number[] = new Array(arity);
        for (let c = 0; c < arity; c++) {
          const av = getComp(a, c);
          const bv = getComp(b, c);
          switch (n.op) {
            case 'add':
              out[c] = av + bv;
              break;
            case 'sub':
              out[c] = av - bv;
              break;
            case 'mul':
              out[c] = av * bv;
              break;
            case 'div':
              out[c] = tslSafeDiv(av, bv);
              break;
            case 'mod':
              out[c] = tslSafeMod(av, bv);
              break;
            case 'pow':
              out[c] = tslSafePow(av, bv);
              break;
            case 'atan2':
              out[c] =
                Math.abs(av) < 1e-8 && Math.abs(bv) < 1e-8
                  ? 0
                  : Math.atan2(av, bv);
              break;
            case 'min':
              out[c] = Math.min(av, bv);
              break;
            case 'max':
              out[c] = Math.max(av, bv);
              break;
            case 'step':
              out[c] = bv < av ? 0 : 1;
              break;
            default:
              out[c] = 0;
              break;
          }
        }
        vals[i] = out;
        break;
      }
      case 'clamp': {
        const x = vals[n.args[0]];
        const lo = vals[n.args[1]];
        const hi = vals[n.args[2]];
        vals[i] = Array.from({length: arity}, (_, c) =>
          tslSafeClamp(getComp(x, c), getComp(lo, c), getComp(hi, c)),
        );
        break;
      }
      case 'mix': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        const t = vals[n.args[2]];
        vals[i] = Array.from(
          {length: arity},
          (_, c) => a[c] + (b[c] - a[c]) * getComp(t, c),
        );
        break;
      }
      case 'smoothstep': {
        const e0 = vals[n.args[0]];
        const e1 = vals[n.args[1]];
        const x = vals[n.args[2]];
        vals[i] = Array.from({length: arity}, (_, c) =>
          tslSafeSmoothstep(getComp(e0, c), getComp(e1, c), getComp(x, c)),
        );
        break;
      }
      case 'dot': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        let d = 0;
        for (let c = 0; c < a.length; c++) d += a[c] * b[c];
        vals[i] = [d];
        break;
      }
      case 'length': {
        const a = vals[n.args[0]];
        let sq = 0;
        for (let c = 0; c < a.length; c++) sq += a[c] * a[c];
        vals[i] = [Math.sqrt(sq)];
        break;
      }
      case 'distance': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        let sq = 0;
        for (let c = 0; c < a.length; c++) {
          const d = a[c] - b[c];
          sq += d * d;
        }
        vals[i] = [Math.sqrt(sq)];
        break;
      }
      case 'cross': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        vals[i] = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        break;
      }
      case 'reflect': {
        const inc = vals[n.args[0]];
        const nrm = vals[n.args[1]];
        let d = 0;
        for (let c = 0; c < inc.length; c++) d += nrm[c] * inc[c];
        vals[i] = inc.map((ic, c) => ic - 2 * d * nrm[c]);
        break;
      }
      case 'fresnel': {
        const nw = normVec(normW);
        const vd = normVec(viewD);
        const ndv = tslSafeClamp(
          nw[0] * vd[0] + nw[1] * vd[1] + nw[2] * vd[2],
          0,
          1,
        );
        vals[i] = [tslSafePow(1 - ndv, Math.max(vals[n.args[0]][0], 1e-3))];
        break;
      }
      case 'simplexNoise2D': {
        const p = vals[n.args[0]];
        vals[i] = [tslSimplexNoise2D(p[0], p[1])];
        break;
      }
      case 'simplexNoise3D': {
        const p = vals[n.args[0]];
        vals[i] = [tslSimplexNoise3D(p[0], p[1], p[2])];
        break;
      }
      case 'voronoi2D': {
        const p = vals[n.args[0]];
        vals[i] = [tslVoronoi2D(p[0], p[1], vals[n.args[1]][0])];
        break;
      }
      case 'checker': {
        const p = vals[n.args[0]];
        vals[i] = [
          tslSafeMod(Math.floor(p[0]) + Math.floor(p[1]), 2) >= 1 ? 1 : 0,
        ];
        break;
      }
      case 'triplanar': {
        const p = vals[n.args[0]];
        const sharp = tslSafeClamp(vals[n.args[1]][0], 0.5, 16);
        const nw = normVec(normW);
        const wx = tslSafePow(Math.max(Math.abs(nw[0]), 1e-4), sharp);
        const wy = tslSafePow(Math.max(Math.abs(nw[1]), 1e-4), sharp);
        const wz = tslSafePow(Math.max(Math.abs(nw[2]), 1e-4), sharp);
        const wSum = Math.max(wx + wy + wz, 1e-6);
        vals[i] = [
          (wx * tslSimplexNoise2D(p[1], p[2]) +
            wy * tslSimplexNoise2D(p[0], p[2]) +
            wz * tslSimplexNoise2D(p[0], p[1])) /
            wSum,
        ];
        break;
      }
      case 'hueShift': {
        const rgb = vals[n.args[0]];
        const ang = vals[n.args[1]][0];
        const k = 0.5773502691896258;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const dotKRgb = k * (rgb[0] + rgb[1] + rgb[2]);
        vals[i] = [
          rgb[0] * cosA +
            k * (rgb[2] - rgb[1]) * sinA +
            k * dotKRgb * (1 - cosA),
          rgb[1] * cosA +
            k * (rgb[0] - rgb[2]) * sinA +
            k * dotKRgb * (1 - cosA),
          rgb[2] * cosA +
            k * (rgb[1] - rgb[0]) * sinA +
            k * dotKRgb * (1 - cosA),
        ];
        break;
      }
      case 'bumpFromHeight': {
        const strength = vals[n.args[1]][0];
        const nw = normVec(normW);
        const dx = ctx.dpdx;
        const dy = ctx.dpdy;
        const dhx = ctx.dhdx ?? 0;
        const dhy = ctx.dhdy ?? 0;
        if (dx && dy && (dhx !== 0 || dhy !== 0)) {
          const r1 = [
            dy[1] * nw[2] - dy[2] * nw[1],
            dy[2] * nw[0] - dy[0] * nw[2],
            dy[0] * nw[1] - dy[1] * nw[0],
          ];
          const r2 = [
            nw[1] * dx[2] - nw[2] * dx[1],
            nw[2] * dx[0] - nw[0] * dx[2],
            nw[0] * dx[1] - nw[1] * dx[0],
          ];
          const det = dx[0] * r1[0] + dx[1] * r1[1] + dx[2] * r1[2];
          if (Math.abs(det) > 1e-8) {
            const sg = det < 0 ? -1 : 1;
            const ad = Math.abs(det);
            vals[i] = normVec([
              ad * nw[0] - strength * sg * (dhx * r1[0] + dhy * r2[0]),
              ad * nw[1] - strength * sg * (dhx * r1[1] + dhy * r2[1]),
              ad * nw[2] - strength * sg * (dhx * r1[2] + dhy * r2[2]),
            ]);
            break;
          }
        }
        vals[i] = [nw[0], nw[1], nw[2]];
        break;
      }
      default:
        vals[i] = new Array(arity).fill(0);
        break;
    }
  }

  const out: {
    color?: [number, number, number];
    opacity?: number;
    emissive?: [number, number, number];
    roughness?: number;
    metalness?: number;
    normalScale?: number;
    bump?: [number, number, number];
    position?: [number, number, number];
  } = {};

  if (graph.outputs.color !== undefined) {
    const v = vals[graph.outputs.color];
    out.color = [Math.max(0, v[0]), Math.max(0, v[1]), Math.max(0, v[2])];
  }
  if (graph.outputs.opacity !== undefined) {
    out.opacity = tslSafeClamp(vals[graph.outputs.opacity][0], 0, 1);
  }
  if (graph.outputs.emissive !== undefined) {
    const v = vals[graph.outputs.emissive];
    out.emissive = [Math.max(0, v[0]), Math.max(0, v[1]), Math.max(0, v[2])];
  }
  if (graph.outputs.roughness !== undefined) {
    out.roughness = tslSafeClamp(vals[graph.outputs.roughness][0], 0.04, 1);
  }
  if (graph.outputs.metalness !== undefined) {
    out.metalness = tslSafeClamp(vals[graph.outputs.metalness][0], 0, 1);
  }
  if (graph.outputs.normalScale !== undefined) {
    out.normalScale = Math.max(0, vals[graph.outputs.normalScale][0]);
  }
  if (graph.outputs.bump !== undefined) {
    const v = normVec(vals[graph.outputs.bump]);
    out.bump = [v[0], v[1], v[2]];
  }
  if (graph.outputs.position !== undefined) {
    const v = vals[graph.outputs.position];
    out.position = [v[0], v[1], v[2]];
  }
  return out;
}
