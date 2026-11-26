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
 * Solid poché caps for `section-cap="solid"`: slices closed
 * meshes with the active section plane, chains the cut segments into loops,
 * and triangulates them (with holes) into flat cap polygons that face the
 * removed half-space. Open or non-manifold meshes are skipped, and all work is
 * bounded by triangle / vertex budgets.
 */

/** A world-space section plane: points with `dot(p, normal) > constant` are cut away. */
export interface SectionCapPlane {
  normal: readonly [number, number, number] | readonly number[];
  constant: number;
}

/** One mesh to cap: local positions, optional indices, and its world matrix. */
export interface SectionCapSource {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number> | null;
  /** Column-major 4x4 world matrix (identity when omitted). */
  matrix?: ArrayLike<number> | null;
}

/** Flat cap triangles in world space (normals all equal the plane normal). */
export interface SectionCapGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Meshes that produced at least one closed cap loop. */
  cappedMeshes: number;
  /** Meshes skipped because their cut was open (not watertight) or over budget. */
  skippedMeshes: number;
}

/** Source-triangle budget per `buildSectionCaps` call (bounded work). */
export const MAX_SECTION_CAP_SOURCE_TRIANGLES = 300_000;
/** Loop-vertex budget per capped mesh; larger cuts are skipped. */
export const MAX_SECTION_CAP_LOOP_VERTICES = 20_000;
/** Bridging / ear-clipping step budget per `buildSectionCaps` call. */
export const MAX_SECTION_CAP_WORK = 50_000_000;

type Pt2 = [number, number];

/** Twice the signed area of a 2D loop (positive = counter-clockwise). */
export function loopArea2(loop: readonly Pt2[]): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

function pointInLoop(p: Pt2, loop: readonly Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function cross2(a: Pt2, b: Pt2, c: Pt2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: Pt2, b: Pt2, c: Pt2, d: Pt2): boolean {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Splices each clockwise hole into the counter-clockwise outer loop through a
 * mutually visible bridge (rightmost hole vertex first), returning one simple
 * polygon for ear clipping.
 */
function bridgeHoles(outer: Pt2[], holes: Pt2[][]): Pt2[] {
  let poly = outer.slice();
  const sorted = holes
    .filter((h) => h.length >= 3)
    .map((h) => {
      let best = 0;
      for (let i = 1; i < h.length; i++) if (h[i][0] > h[best][0]) best = i;
      return {h, best};
    })
    .sort((a, b) => b.h[b.best][0] - a.h[a.best][0]);
  for (const {h, best} of sorted) {
    const m = h[best];
    // Candidate outer vertices ordered by distance; take the first whose
    // bridge crosses no polygon or hole edge.
    const order = poly
      .map((p, i) => ({i, d: (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2}))
      .sort((a, b) => a.d - b.d);
    let pick = -1;
    for (const {i} of order) {
      const p = poly[i];
      let blocked = false;
      for (let k = 0; k < poly.length && !blocked; k++) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        if (k === i || (k + 1) % poly.length === i) continue;
        if (segmentsCross(m, p, a, b)) blocked = true;
      }
      // Every hole (bridged or not) must stay uncrossed.
      for (const {h: other, best: ob} of sorted) {
        for (let k = 0; k < other.length && !blocked; k++) {
          const a = other[k];
          const b = other[(k + 1) % other.length];
          if (other === h && (k === ob || (k + 1) % other.length === ob)) {
            continue;
          }
          if (segmentsCross(m, p, a, b)) blocked = true;
        }
      }
      if (!blocked) {
        pick = i;
        break;
      }
    }
    if (pick < 0) pick = order[0]?.i ?? 0;
    const ring: Pt2[] = [];
    for (let k = 0; k <= h.length; k++) ring.push(h[(best + k) % h.length]);
    poly = [
      ...poly.slice(0, pick + 1),
      ...ring,
      poly[pick],
      ...poly.slice(pick + 1),
    ];
  }
  return poly;
}

/** Shared step budget for one `buildSectionCaps` call (bounded main-thread work). */
interface WorkBudget {
  left: number;
}

/**
 * Ear-clips a counter-clockwise outer loop with clockwise holes into triangle
 * index triples over the returned vertex list. Returns no triangles when the
 * optional `work` budget runs out.
 */
export function triangulateWithHoles(
  outer: Pt2[],
  holes: Pt2[][] = [],
  work: WorkBudget = {left: Infinity},
): {verts: Pt2[]; tris: number[]} {
  const n0 = outer.length + holes.reduce((t, h) => t + h.length + 2, 0);
  // Bridging scans every edge per candidate; charge it up front.
  work.left -= n0 * n0 * (holes.length + 1);
  if (work.left < 0) return {verts: [], tris: []};
  const verts = bridgeHoles(outer, holes);
  const n = verts.length;
  const tris: number[] = [];
  if (n < 3) return {verts, tris};
  const next = new Int32Array(n);
  const prev = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    next[i] = (i + 1) % n;
    prev[i] = (i + n - 1) % n;
  }
  let remaining = n;
  let cur = 0;
  let fails = 0;
  let guard = 0;
  const maxGuard = n * n + 16;
  while (remaining > 3 && guard++ < maxGuard) {
    const a = prev[cur];
    const b = cur;
    const c = next[cur];
    const pa = verts[a];
    const pb = verts[b];
    const pc = verts[c];
    let ear = cross2(pa, pb, pc) > 0;
    if (ear) {
      work.left -= remaining;
      if (work.left < 0) return {verts: [], tris: []};
      for (let k = next[c]; k !== a; k = next[k]) {
        const p = verts[k];
        // Bridge duplicates share coordinates with the ear corners.
        if (
          (p[0] === pa[0] && p[1] === pa[1]) ||
          (p[0] === pb[0] && p[1] === pb[1]) ||
          (p[0] === pc[0] && p[1] === pc[1])
        ) {
          continue;
        }
        if (
          cross2(pa, pb, p) >= 0 &&
          cross2(pb, pc, p) >= 0 &&
          cross2(pc, pa, p) >= 0
        ) {
          ear = false;
          break;
        }
      }
    }
    if (ear) {
      tris.push(a, b, c);
      next[a] = c;
      prev[c] = a;
      remaining--;
      cur = c;
      fails = 0;
    } else {
      cur = next[cur];
      // No ear in a full pass (degenerate input): drop the current corner.
      if (++fails > remaining) {
        next[prev[cur]] = next[cur];
        prev[next[cur]] = prev[cur];
        remaining--;
        cur = next[cur];
        fails = 0;
      }
    }
  }
  if (remaining === 3) {
    const a = prev[cur];
    const c = next[cur];
    if (cross2(verts[a], verts[cur], verts[c]) > 0) tris.push(a, cur, c);
  }
  return {verts, tris};
}

/**
 * Chains directed segments (`[fromKey, toKey]`) into closed loops. Returns
 * `null` when any endpoint does not have exactly one outgoing and one incoming
 * segment (an open or non-manifold cut).
 */
export function chainSegments(
  segs: ReadonlyArray<readonly [string, string]>,
): string[][] | null {
  const out = new Map<string, string>();
  const indeg = new Map<string, number>();
  for (const [a, b] of segs) {
    if (a === b) continue;
    if (out.has(a)) return null;
    out.set(a, b);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
  }
  for (const k of out.keys()) if (indeg.get(k) !== 1) return null;
  if (indeg.size !== out.size) return null;
  const loops: string[][] = [];
  const seen = new Set<string>();
  for (const start of out.keys()) {
    if (seen.has(start)) continue;
    const loop: string[] = [];
    let k = start;
    while (!seen.has(k)) {
      seen.add(k);
      loop.push(k);
      k = out.get(k)!;
    }
    if (k !== start) return null;
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Orthonormal `(u, v)` basis of the plane with `u x v = normal`. */
function planeBasis(n: readonly number[]): [number[], number[]] {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [
    a[1] * n[2] - a[2] * n[1],
    a[2] * n[0] - a[0] * n[2],
    a[0] * n[1] - a[1] * n[0],
  ];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u = u.map((x) => x / ul);
  const v = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  return [u, v];
}

/**
 * Builds solid section caps for `sources` cut by `plane`. Each source is
 * sliced independently; a source whose cut is not a set of closed loops is
 * skipped. Cap triangles are counter-clockwise seen from the removed side
 * (`+normal`), so they face a camera looking into the cut.
 */
export function buildSectionCaps(
  sources: readonly SectionCapSource[],
  plane: SectionCapPlane,
  maxSourceTriangles = MAX_SECTION_CAP_SOURCE_TRIANGLES,
): SectionCapGeometry {
  const nl = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]);
  const n = nl > 1e-12 ? [0, 1, 2].map((k) => plane.normal[k] / nl) : [0, 1, 0];
  const c = nl > 1e-12 ? plane.constant / nl : 0;
  const [bu, bv] = planeBasis(n);
  const outPos: number[] = [];
  const outIdx: number[] = [];
  let capped = 0;
  let skipped = 0;
  let budget = Math.max(0, maxSourceTriangles);
  const work: WorkBudget = {left: MAX_SECTION_CAP_WORK};

  for (const src of sources) {
    const p = src.positions;
    const vCount = Math.floor((p?.length ?? 0) / 3);
    const idx = src.indices;
    const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(vCount / 3);
    if (vCount === 0 || triCount === 0) continue;
    if (triCount > budget) {
      skipped++;
      continue;
    }
    budget -= triCount;
    const m = src.matrix && src.matrix.length >= 16 ? src.matrix : null;
    // World positions, signed distances, and quantized keys (shared edges
    // between primitives / duplicated vertices resolve to the same key).
    const w = new Float64Array(vCount * 3);
    const d = new Float64Array(vCount);
    const keys: string[] = new Array(vCount);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vCount; i++) {
      const x = +p[i * 3];
      const y = +p[i * 3 + 1];
      const z = +p[i * 3 + 2];
      const wx = m ? m[0] * x + m[4] * y + m[8] * z + m[12] : x;
      const wy = m ? m[1] * x + m[5] * y + m[9] * z + m[13] : y;
      const wz = m ? m[2] * x + m[6] * y + m[10] * z + m[14] : z;
      w[i * 3] = wx;
      w[i * 3 + 1] = wy;
      w[i * 3 + 2] = wz;
      for (let k = 0; k < 3; k++) {
        const v = w[i * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    // Weld quantum relative to this mesh's own size (not its distance from
    // the origin), so small parts in large georeferenced scenes still weld.
    const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
    const q = 1e6 / span;
    for (let i = 0; i < vCount; i++) {
      const wx = w[i * 3];
      const wy = w[i * 3 + 1];
      const wz = w[i * 3 + 2];
      d[i] = n[0] * wx + n[1] * wy + n[2] * wz - c;
      keys[i] = `${Math.round((wx - lo[0]) * q)},${Math.round(
        (wy - lo[1]) * q,
      )},${Math.round((wz - lo[2]) * q)}`;
    }
    // Vertices on the plane count as cut away (symbolic perturbation), so
    // every crossing triangle yields exactly one segment.
    const side = (i: number) => d[i] >= 0;
    const pts = new Map<string, [number, number, number]>();
    const edgePoint = (i: number, j: number): string => {
      const [a, b] = keys[i] < keys[j] ? [i, j] : [j, i];
      const key = `${keys[a]}|${keys[b]}`;
      if (!pts.has(key)) {
        const t = d[a] / (d[a] - d[b]);
        pts.set(key, [
          w[a * 3] + (w[b * 3] - w[a * 3]) * t,
          w[a * 3 + 1] + (w[b * 3 + 1] - w[a * 3 + 1]) * t,
          w[a * 3 + 2] + (w[b * 3 + 2] - w[a * 3 + 2]) * t,
        ]);
      }
      return key;
    };
    const segs: Array<[string, string]> = [];
    for (let t = 0; t < triCount; t++) {
      const tri = idx
        ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
        : [t * 3, t * 3 + 1, t * 3 + 2];
      if (tri.some((v) => !(v >= 0 && v < vCount))) continue;
      const s = tri.map(side);
      if (s[0] === s[1] && s[1] === s[2]) continue;
      if (
        keys[tri[0]] === keys[tri[1]] ||
        keys[tri[1]] === keys[tri[2]] ||
        keys[tri[2]] === keys[tri[0]]
      ) {
        continue;
      }
      // Walking the triangle CCW, the kept->cut crossing comes first; the cap
      // boundary runs from the cut->kept crossing to it, which makes loops CCW
      // about +normal for outward-wound closed meshes.
      let enter = '';
      let exit = '';
      for (let e = 0; e < 3; e++) {
        const i = tri[e];
        const j = tri[(e + 1) % 3];
        if (side(i) === side(j)) continue;
        if (!side(i)) exit = edgePoint(i, j);
        else enter = edgePoint(i, j);
      }
      if (enter && exit && enter !== exit) segs.push([enter, exit]);
    }
    if (segs.length === 0) continue;
    const loops = chainSegments(segs);
    if (!loops) {
      skipped++;
      continue;
    }
    let loops2: Pt2[][] = [];
    let total = 0;
    const tol = span * 1e-9;
    for (const lk of loops) {
      // Planar points; drop consecutive duplicates (plane through vertices).
      const l2: Pt2[] = [];
      for (const k of lk) {
        const P = pts.get(k)!;
        const q2: Pt2 = [
          P[0] * bu[0] + P[1] * bu[1] + P[2] * bu[2],
          P[0] * bv[0] + P[1] * bv[1] + P[2] * bv[2],
        ];
        const last = l2[l2.length - 1];
        if (
          !last ||
          Math.abs(last[0] - q2[0]) + Math.abs(last[1] - q2[1]) > tol
        ) {
          l2.push(q2);
        }
      }
      while (
        l2.length > 1 &&
        Math.abs(l2[0][0] - l2[l2.length - 1][0]) +
          Math.abs(l2[0][1] - l2[l2.length - 1][1]) <=
          tol
      ) {
        l2.pop();
      }
      if (l2.length < 3) continue;
      total += l2.length;
      loops2.push(l2);
    }
    if (total > MAX_SECTION_CAP_LOOP_VERTICES) {
      skipped++;
      continue;
    }
    // CCW loops bound material; CW loops are holes inside the smallest
    // enclosing CCW loop. Mirrored (det < 0) or inside-out meshes yield the
    // opposite winding, detected by a negative net area, so flip them.
    let areas = loops2.map(loopArea2);
    if (areas.reduce((t, a) => t + a, 0) < 0) {
      loops2 = loops2.map((l) => l.slice().reverse());
      areas = areas.map((a) => -a);
    }
    const outers = areas
      .map((a, i) => i)
      .filter((i) => areas[i] > 0)
      .sort((a, b) => areas[a] - areas[b]);
    const holesOf = new Map<number, number[]>();
    for (let i = 0; i < loops2.length; i++) {
      if (areas[i] >= 0) continue;
      const host = outers.find((o) => pointInLoop(loops2[i][0], loops2[o]));
      if (host === undefined) continue;
      holesOf.set(host, [...(holesOf.get(host) ?? []), i]);
    }
    let any = false;
    for (const o of outers) {
      const holeIds = holesOf.get(o) ?? [];
      const {verts, tris} = triangulateWithHoles(
        loops2[o],
        holeIds.map((h) => loops2[h]),
        work,
      );
      if (!tris.length) continue;
      any = true;
      const base = outPos.length / 3;
      // Back to 3D on the plane (x * u + y * v + c * n), nudged a hair toward
      // the removed side so coplanar kept faces cannot z-fight the cap.
      const cOff = c + span * 1e-5;
      for (const [x, y] of verts) {
        outPos.push(
          x * bu[0] + y * bv[0] + cOff * n[0],
          x * bu[1] + y * bv[1] + cOff * n[1],
          x * bu[2] + y * bv[2] + cOff * n[2],
        );
      }
      for (const t of tris) outIdx.push(base + t);
    }
    if (any) capped++;
  }
  const normals = new Float32Array(outPos.length);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
  return {
    positions: new Float32Array(outPos),
    normals,
    indices: new Uint32Array(outIdx),
    cappedMeshes: capped,
    skippedMeshes: skipped,
  };
}
