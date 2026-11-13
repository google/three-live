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

// Procedural CAD, 2D Contours & ear-clipping hole triangulation, ExtrudeGeometry,
// 3D BSP CSG Booleans, and built-in stroke-font TextGeometry plugin (`cadPlugin`).
// CSG output is a polygon soup (it may contain T-junctions); it is not
// guaranteed to be a closed manifold.

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/**
 * Options for `THREE.ExtrudeGeometry`.
 *
 * Defaults differ from three.js: `bevelEnabled` is false, `bevelThickness`
 * 0.06, `bevelSize` 0.8 x `bevelThickness`, `bevelSegments` 2, and cap UVs are
 * normalized to the shape's bounding box. Non-finite values use the defaults.
 */
export interface ExtrudeGeometryOptions {
  depth?: number;
  amount?: number;
  steps?: number;
  curveSegments?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelOffset?: number;
  bevelSegments?: number;
  /** Optional 3D curve (or array of 3D points) along which to sweep the shape. */
  // tslint:disable-next-line:no-any Accepts any Curve3 or 3D point list.
  extrudePath?: any;
  /** Total twist angle in radians when `extrudePath` is provided (default 0). */
  twist?: number;
  /** Cross-section scale factor or [startScale, endScale] taper along `extrudePath`. */
  scale?:
    | number
    | [number, number]
    | [number, number, number]
    | ((u: number) => number | [number, number]);
  /** Close the swept path into a continuous loop when `extrudePath` is set. */
  closed?: boolean;
  /** Emit planar start/end caps when `extrudePath` is open (default true). */
  caps?: boolean;
  /** Optional reference up vector for the Bishop frame when `extrudePath` is set. */
  up?: {x: number; y: number; z: number} | [number, number, number];
}

/**
 * Options for `THREE.SweepGeometry`.
 *
 * Sweeps a 2D `Shape` (including interior holes) or circular cross-section
 * along a 3D `Curve3` (or array of 3D points) using rotation-minimizing Bishop
 * parallel-transport frames.
 */
export interface SweepGeometryOptions {
  // tslint:disable-next-line:no-any Optional Shape or Shape[] when using single-object constructor.
  shape?: any;
  // tslint:disable-next-line:no-any Optional Curve3 or 3D point array when using single-object constructor.
  path?: any;
  // tslint:disable-next-line:no-any Alias for `path`.
  curve?: any;
  /** Circular fallback radius when `shape` is omitted (default 0.1). */
  radius?: number;
  tubeRadius?: number;
  /** Radial segments for circular fallback profile (default 12, clamped to [3, 64]). */
  radialSegments?: number;
  /** Subdivisions along the 3D path (default 64, clamped to [2, 512]). */
  steps?: number;
  tubularSegments?: number;
  /** Subdivisions per 2D curve segment on the `Shape` contour (default 12). */
  curveSegments?: number;
  /**
   * Close the swept loop (default: `Boolean(path?.closed)`). Closed sweeps
   * round `twist` to whole turns and weld the end cross-section to the start.
   */
  closed?: boolean;
  /** Triangulate start/end planar caps when `closed` is false (default true). */
  caps?: boolean;
  /** Total progressive twist angle in radians from u=0 to u=1 (default 0). */
  twist?: number;
  /**
   * Cross-section scale along the path: uniform number, `[start, end]` linear
   * taper, `[start, mid, end]` quadratic taper, or `(u: number) => number | [sx, sy]`.
   */
  scale?:
    | number
    | [number, number]
    | [number, number, number]
    | ((u: number) => number | [number, number]);
  /** Alias for `scale` taper (`number` = end scale from 1.0, or `[start, end]`). */
  taper?: number | [number, number];
  /** Optional initial reference up vector `[x, y, z]` or `Vector3` for the Bishop frame. */
  up?: {x: number; y: number; z: number} | [number, number, number];
}

/**
 * Options for `THREE.HelixCurve3` and `THREE.HelixGeometry`.
 */
export interface HelixGeometryOptions {
  /** Base coil radius in meters (default 0.5). */
  radius?: number;
  /** Optional top coil radius for conical/tapered helices (defaults to `radius`). */
  topRadius?: number;
  /** Axial rise per full revolution in meters (default 0.25). */
  pitch?: number;
  /** Number of revolutions (default 4, clamped to [0.05, 64]). */
  turns?: number;
  /** Optional total axial height override (`turns * pitch` when omitted). */
  height?: number;
  /** Circular wire/tube radius when `shape` is not provided (default 0.05). */
  tubeRadius?: number;
  wireRadius?: number;
  tube?: number;
  // tslint:disable-next-line:no-any Optional custom 2D Shape cross-section.
  shape?: any;
  /** Coil handedness: `'right'` (default, CCW rising) or `'left'`. */
  handedness?: 'right' | 'left';
  /** Path subdivisions per revolution (default 24; total steps clamped to [4, 512]). */
  segmentsPerTurn?: number;
  /** Explicit total path subdivisions override (clamped to [4, 512]). */
  steps?: number;
  tubularSegments?: number;
  /** Radial segments when using circular `tubeRadius` (default 12, clamped to [3, 64]). */
  radialSegments?: number;
  /** Subdivisions per 2D curve segment when `shape` is provided (default 12). */
  curveSegments?: number;
  /** Total additional twist in radians along the helix (default 0). */
  twist?: number;
  /** Cross-section scale or `[startScale, endScale]` wire taper along the helix. */
  scale?:
    | number
    | [number, number]
    | [number, number, number]
    | ((u: number) => number | [number, number]);
  /** Triangulate flat start/end caps (default true). */
  caps?: boolean;
  /** Vertical origin placement: `'center'` (default) or `'bottom'`. */
  origin?: 'center' | 'bottom';
}

/**
 * Per-station profile descriptor for `THREE.LoftGeometry`.
 *
 * Only the outer contour of each station `Shape` is lofted; `shape.holes` are
 * ignored (use `wallThickness` for hollow vessels or `CSG.subtract` for bores).
 */
export interface LoftStationSpec {
  // tslint:disable-next-line:no-any 2D Shape, Path, or Vec2Like[] contour.
  shape: any;
  /**
   * Position along the loft axis (stations are sorted by it). With a `path`,
   * offsets are mapped proportionally onto the spine from start to end.
   */
  offset?: number;
  y?: number;
  z?: number;
  x?: number;
  /** Per-station scale factor (`number` or `[sx, sy]`). */
  scale?: number | [number, number];
  /** Per-station twist angle in radians around the loft axis (default 0). */
  twist?: number;
  /** Per-station 2D in-plane offset `[tx, ty]`. */
  translate?: [number, number];
}

/**
 * Options for `THREE.LoftGeometry`.
 */
export interface LoftGeometryOptions {
  // tslint:disable-next-line:no-any Array of Shape, Path, or LoftStationSpec stations.
  profiles?: any[];
  /** Explicit axial station positions (defaults to even spacing across `height`). */
  offsets?: number[];
  /** Total span along the loft axis when station offsets are omitted (default 1). */
  height?: number;
  length?: number;
  /** Straight loft axis when `path` is not set (default `'y'`). */
  axis?: 'x' | 'y' | 'z';
  // tslint:disable-next-line:no-any Optional 3D spine Curve3 or 3D point array.
  path?: any;
  /**
   * Axial subdivisions across the loft (default: max(16, stations) for linear,
   * max(24, 12 per span) for smooth/path lofts; total clamped to 512).
   */
  steps?: number;
  /** Uniform arc-length vertex count per resampled profile ring (default 48, clamped to [8, 256]). */
  profileSegments?: number;
  /** Subdivisions per 2D curve segment before arc-length resampling (default 12). */
  curveSegments?: number;
  /**
   * Station blending mode: `'linear'` (default) or `'smooth'` / `'catmull-rom'`
   * (overshoot-clamped Catmull-Rom; needs >= 3 stations, else linear).
   */
  interpolation?: 'linear' | 'smooth' | 'catmull-rom';
  /** Triangulate start/end planar caps (default true). */
  caps?: boolean;
  /** Leave the top station open (or shell the vessel when `wallThickness > 0`). */
  openTop?: boolean;
  /**
   * Wall thickness in meters; only applies together with `openTop: true` to
   * create a watertight hollow vessel (cavity, rim, and inner floor). The inner
   * wall is the outer ring contracted about its bounding-box center, so the
   * thickness is exact for centered circles/rectangles and approximate for
   * other profiles; it never contracts below 25% of the outer size.
   */
  wallThickness?: number;
  /** Close the loft loop back to the first station (requires `path`; default false). */
  closed?: boolean;
  /** Origin along the loft axis when explicit offsets are omitted: `'bottom'` (default) or `'center'`. */
  origin?: 'bottom' | 'center';
  /** Optional reference up vector when lofting along a 3D `path`. */
  up?: {x: number; y: number; z: number} | [number, number, number];
}

/**
 * Options for `THREE.TextGeometry`.
 *
 * Uses a built-in stroke font (digits, A-Z, and common punctuation; lowercase
 * is drawn as scaled uppercase and unknown glyphs as `?`), not a Hershey or
 * typeface font. Unlike three.js the result is centered by default (set
 * `center: false` for a baseline-left origin), depth is centered on z = 0, and
 * `bevelEnabled` only thickens the strokes. Non-finite values use the defaults.
 */
export interface TextGeometryOptions {
  size?: number;
  height?: number;
  depth?: number;
  curveSegments?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  center?: boolean;
}

/** Maximum combined input triangle count permitted for a CSG boolean operation. */
export const MAX_CSG_TRIANGLES = 8192;

/** Maximum BSP tree recursion depth permitted during CSG evaluation. */
export const MAX_BSP_DEPTH = 2048;

/** Maximum string length rendered by `TextGeometry` (prevents geometry amplification). */
export const MAX_TEXT_GEOMETRY_CHARS = 128;

/** Maximum total outer + hole contour points per `Shape` (bounds ear-clipping cost). */
export const MAX_SHAPE_POINTS = 4096;

/**
 * Self-contained installer that attaches `Path`, `Shape`, `ShapeGeometry`,
 * `ExtrudeGeometry`, `TextGeometry`, `CSG`, and `materializeDeclarativeGeometry`
 * onto a `THREE` namespace and shared registry.
 *
 * NOTE: This function is serialized with `Function.prototype.toString()` into
 * sandboxed Web Workers, so it must remain 100% self-contained (do not reference
 * module-scoped imports or variables inside its body, and initialize all class
 * properties inside `constructor` rather than with class field initializers).
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installCadExtension(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.BufferGeometry) return null;

  const Vector2 = threeNs.Vector2;
  const Vector3 = threeNs.Vector3;
  const Quaternion = threeNs.Quaternion;
  const Matrix4 = threeNs.Matrix4;
  const Matrix3 = threeNs.Matrix3;
  const Color = threeNs.Color;
  const BufferAttribute = threeNs.BufferAttribute;
  const BufferGeometry = threeNs.BufferGeometry;
  const Material = threeNs.Material;
  const MeshStandardMaterial = threeNs.MeshStandardMaterial;
  const Mesh = threeNs.Mesh;
  // tslint:disable-next-line:no-any Dynamic Curve3 base class from threeNs.
  const Curve3Base: any =
    threeNs.Curve3 ||
    threeNs.Curve ||
    class {
      // tslint:disable-next-line:no-any Dynamic Vector3.
      getPoint(_t: number, out: any = new Vector3()): any {
        return out;
      }
      // tslint:disable-next-line:no-any Dynamic Vector3.
      getPoints(divisions = 5): any[] {
        const d = Math.max(
          1,
          Math.min(512, Math.floor(Number(divisions) || 5)),
        );
        // tslint:disable-next-line:no-any Dynamic Vector3.
        const pts: any[] = [];
        for (let i = 0; i <= d; i++) pts.push(this.getPoint(i / d));
        return pts;
      }
    };
  const CatmullRomCurve3 = threeNs.CatmullRomCurve3;

  const maxCsgTriangles = 8192;
  const maxBspDepth = 2048;
  const maxTextGeometryChars = 128;
  const maxShapePoints = 4096;
  const maxGeneratedVertices = 100000;

  // Numeric option coercion: missing, NaN, or non-finite values fall back to
  // the default instead of propagating NaN into positions or loop bounds.
  const num = (v: unknown, d: number): number => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };

  interface PathSegment {
    type: 'move' | 'line' | 'quad' | 'cubic' | 'arc' | 'curve';
    pts: number[];
    // tslint:disable-next-line:no-any Optional Curve2D instance added via Path.add().
    curve?: any;
  }

  // tslint:disable-next-line:no-any Dynamic Vector2 instance from threeNs.
  type Vec2Like = any;

  class Path {
    declare currentPoint: Vec2Like;
    declare private readonly segments: PathSegment[];

    constructor(points?: Vec2Like[]) {
      this.currentPoint = new Vector2(0, 0);
      this.segments = [];
      if (Array.isArray(points) && points.length > 0) {
        this.fromPoints(points);
      }
    }

    fromPoints(points: Vec2Like[]): this {
      if (!points.length) return this;
      this.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        this.lineTo(points[i].x, points[i].y);
      }
      return this;
    }

    moveTo(x: number, y: number): this {
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      this.currentPoint.set(fx, fy);
      this.segments.push({type: 'move', pts: [fx, fy]});
      return this;
    }

    lineTo(x: number, y: number): this {
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      if (this.segments.length === 0) {
        this.segments.push({
          type: 'move',
          pts: [this.currentPoint.x, this.currentPoint.y],
        });
      }
      this.currentPoint.set(fx, fy);
      this.segments.push({type: 'line', pts: [fx, fy]});
      return this;
    }

    quadraticCurveTo(cpX: number, cpY: number, x: number, y: number): this {
      const x0 = this.currentPoint.x;
      const y0 = this.currentPoint.y;
      const fcpX = Number(cpX) || 0;
      const fcpY = Number(cpY) || 0;
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      if (this.segments.length === 0) {
        this.segments.push({type: 'move', pts: [x0, y0]});
      }
      this.currentPoint.set(fx, fy);
      this.segments.push({type: 'quad', pts: [x0, y0, fcpX, fcpY, fx, fy]});
      return this;
    }

    bezierCurveTo(
      cp1X: number,
      cp1Y: number,
      cp2X: number,
      cp2Y: number,
      x: number,
      y: number,
    ): this {
      const x0 = this.currentPoint.x;
      const y0 = this.currentPoint.y;
      const f1x = Number(cp1X) || 0;
      const f1y = Number(cp1Y) || 0;
      const f2x = Number(cp2X) || 0;
      const f2y = Number(cp2Y) || 0;
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      if (this.segments.length === 0) {
        this.segments.push({type: 'move', pts: [x0, y0]});
      }
      this.currentPoint.set(fx, fy);
      this.segments.push({
        type: 'cubic',
        pts: [x0, y0, f1x, f1y, f2x, f2y, fx, fy],
      });
      return this;
    }

    absarc(
      aX: number,
      aY: number,
      aRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
    ): this {
      return this.absellipse(
        aX,
        aY,
        aRadius,
        aRadius,
        aStartAngle,
        aEndAngle,
        aClockwise,
        0,
      );
    }

    arc(
      aX: number,
      aY: number,
      aRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
    ): this {
      return this.absarc(
        this.currentPoint.x + (Number(aX) || 0),
        this.currentPoint.y + (Number(aY) || 0),
        aRadius,
        aStartAngle,
        aEndAngle,
        aClockwise,
      );
    }

    absellipse(
      aX: number,
      aY: number,
      xRadius: number,
      yRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
      aRotation = 0,
    ): this {
      const cx = Number(aX) || 0;
      const cy = Number(aY) || 0;
      const rx = Math.max(0, Number(xRadius) || 0);
      const ry = Math.max(0, Number(yRadius) || 0);
      const start = Number(aStartAngle) || 0;
      const end = Number(aEndAngle) || 0;
      const cw = aClockwise ? 1 : 0;
      const rot = Number(aRotation) || 0;
      this.segments.push({
        type: 'arc',
        pts: [cx, cy, rx, ry, start, end, cw, rot],
      });
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const ex = rx * Math.cos(end);
      const ey = ry * Math.sin(end);
      this.currentPoint.set(
        cx + ex * cosR - ey * sinR,
        cy + ex * sinR + ey * cosR,
      );
      return this;
    }

    ellipse(
      aX: number,
      aY: number,
      xRadius: number,
      yRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
      aRotation = 0,
    ): this {
      return this.absellipse(
        this.currentPoint.x + (Number(aX) || 0),
        this.currentPoint.y + (Number(aY) || 0),
        xRadius,
        yRadius,
        aStartAngle,
        aEndAngle,
        aClockwise,
        aRotation,
      );
    }

    // tslint:disable-next-line:no-any Curve2D instance (LineCurve, EllipseCurve, SplineCurve, etc.).
    add(curve: any): this {
      if (curve && typeof curve.getPoints === 'function') {
        this.segments.push({type: 'curve', pts: [], curve});
        const end = curve.getPoint?.(1);
        if (end) this.currentPoint.set(Number(end.x) || 0, Number(end.y) || 0);
      }
      return this;
    }

    splineThru(pts: Vec2Like[]): this {
      if (!Array.isArray(pts) || pts.length === 0) return this;
      const Spline = threeNs.SplineCurve || reg?.authorNamespace?.SplineCurve;
      if (Spline) {
        return this.add(new Spline([this.currentPoint.clone(), ...pts]));
      }
      for (const p of pts) {
        if (p) this.lineTo(Number(p.x) || 0, Number(p.y) || 0);
      }
      return this;
    }

    closePath(): this {
      if (this.segments.length > 0) {
        const first = this.segments[0];
        let sx = 0;
        let sy = 0;
        if (first.type === 'curve' && first.curve?.getPoint) {
          const st = first.curve.getPoint(0);
          sx = Number(st?.x) || 0;
          sy = Number(st?.y) || 0;
        } else if (first.type === 'arc') {
          const cx = first.pts[0];
          const cy = first.pts[1];
          const rx = first.pts[2];
          const ry = first.pts[3];
          const start = first.pts[4];
          const rot = first.pts[7];
          const cosR = Math.cos(rot);
          const sinR = Math.sin(rot);
          const tx = rx * Math.cos(start);
          const ty = ry * Math.sin(start);
          sx = cx + tx * cosR - ty * sinR;
          sy = cy + tx * sinR + ty * cosR;
        } else {
          sx = first.pts[0];
          sy = first.pts[1];
        }
        if (
          Math.hypot(this.currentPoint.x - sx, this.currentPoint.y - sy) > 1e-6
        ) {
          this.lineTo(sx, sy);
        }
      }
      return this;
    }

    getPoints(divisions = 12): Vec2Like[] {
      const divs = Math.max(
        1,
        Math.min(128, Math.floor(Number(divisions) || 12)),
      );
      const pts: Vec2Like[] = [];
      const pushPt = (x: number, y: number): void => {
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          if (Math.hypot(last.x - x, last.y - y) < 1e-6) return;
        }
        pts.push(new Vector2(x, y));
      };

      for (const seg of this.segments) {
        const p = seg.pts;
        if (seg.type === 'move' || seg.type === 'line') {
          pushPt(p[0], p[1]);
        } else if (seg.type === 'quad') {
          const x0 = p[0];
          const y0 = p[1];
          const cpx = p[2];
          const cpy = p[3];
          const x1 = p[4];
          const y1 = p[5];
          pushPt(x0, y0);
          for (let i = 1; i <= divs; i++) {
            const t = i / divs;
            const mt = 1 - t;
            pushPt(
              mt * mt * x0 + 2 * mt * t * cpx + t * t * x1,
              mt * mt * y0 + 2 * mt * t * cpy + t * t * y1,
            );
          }
        } else if (seg.type === 'cubic') {
          const x0 = p[0];
          const y0 = p[1];
          const cp1x = p[2];
          const cp1y = p[3];
          const cp2x = p[4];
          const cp2y = p[5];
          const x1 = p[6];
          const y1 = p[7];
          pushPt(x0, y0);
          for (let i = 1; i <= divs; i++) {
            const t = i / divs;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const t2 = t * t;
            pushPt(
              mt2 * mt * x0 +
                3 * mt2 * t * cp1x +
                3 * mt * t2 * cp2x +
                t2 * t * x1,
              mt2 * mt * y0 +
                3 * mt2 * t * cp1y +
                3 * mt * t2 * cp2y +
                t2 * t * y1,
            );
          }
        } else if (seg.type === 'arc') {
          const cx = p[0];
          const cy = p[1];
          const rx = p[2];
          const ry = p[3];
          const aStart = p[4];
          const aEnd = p[5];
          const cw = p[6] !== 0;
          const rot = p[7];
          const twoPi = Math.PI * 2;
          let deltaAngle = aEnd - aStart;
          const samePoints = Math.abs(deltaAngle) < 1e-9;
          while (deltaAngle < 0) deltaAngle += twoPi;
          while (deltaAngle > twoPi) deltaAngle -= twoPi;
          if (deltaAngle < 1e-9) {
            deltaAngle = samePoints ? 0 : twoPi;
          }
          if (cw && !samePoints) {
            deltaAngle = deltaAngle === twoPi ? -twoPi : deltaAngle - twoPi;
          }
          const cosR = Math.cos(rot);
          const sinR = Math.sin(rot);
          const arcDivs = Math.max(2, divs);
          for (let i = 0; i <= arcDivs; i++) {
            const t = i / arcDivs;
            const angle = aStart + t * deltaAngle;
            const tx = rx * Math.cos(angle);
            const ty = ry * Math.sin(angle);
            pushPt(cx + tx * cosR - ty * sinR, cy + tx * sinR + ty * cosR);
          }
        } else if (seg.type === 'curve' && seg.curve?.getPoints) {
          for (const cp of seg.curve.getPoints(divs)) {
            if (cp) pushPt(Number(cp.x) || 0, Number(cp.y) || 0);
          }
        }
      }
      if (pts.length > 2) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
          pts.pop();
        }
      }
      return pts;
    }

    getSpacedPoints(divisions = 12): Vec2Like[] {
      return this.getPoints(divisions);
    }

    clone(): this {
      const c: any = new (this.constructor as any)();
      c.currentPoint.copy(this.currentPoint);
      c.segments = this.segments.map((s) => ({
        type: s.type,
        pts: [...s.pts],
        ...(s.curve ? {curve: s.curve.clone ? s.curve.clone() : s.curve} : {}),
      }));
      if (Array.isArray((this as any).holes)) {
        c.holes = (this as any).holes.map((h: Path) => h.clone());
      }
      return c;
    }
  }

  class Shape extends Path {
    declare holes: Path[];

    constructor(points?: Vec2Like[]) {
      super(points);
      this.holes = [];
    }

    extractPoints(divisions = 12): {shape: Vec2Like[]; holes: Vec2Like[][]} {
      return {
        shape: this.getPoints(divisions),
        holes: this.holes.map((h) => h.getPoints(divisions)),
      };
    }
  }

  function signedArea2D(pts: Vec2Like[]): number {
    let area = 0;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return area * 0.5;
  }

  function pointInTriangle2D(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ): boolean {
    const v0x = cx - ax;
    const v0y = cy - ay;
    const v1x = bx - ax;
    const v1y = by - ay;
    const v2x = px - ax;
    const v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-12) return false;
    const invDenom = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
  }

  function mergeHolesIntoContour(
    outerInput: Vec2Like[],
    holesInput: Vec2Like[][],
  ): {merged: Vec2Like[]; mergedIndices: number[]; allVertices: Vec2Like[]} {
    const outer = outerInput.slice();
    if (signedArea2D(outer) < 0) outer.reverse();
    const allVertices: Vec2Like[] = outer.map((p) => new Vector2(p.x, p.y));
    let contour = outer.map((_, i) => i);

    const validHoles: Array<{
      pts: Vec2Like[];
      indices: number[];
      maxX: number;
      maxIdx: number;
    }> = [];
    for (const hRaw of holesInput) {
      if (!hRaw || hRaw.length < 3) continue;
      const h = hRaw.slice();
      if (signedArea2D(h) > 0) h.reverse();
      const indices: number[] = [];
      let maxX = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < h.length; i++) {
        const p = h[i];
        const globalIdx = allVertices.length;
        allVertices.push(new Vector2(p.x, p.y));
        indices.push(globalIdx);
        if (p.x > maxX) {
          maxX = p.x;
          maxIdx = i;
        }
      }
      validHoles.push({pts: h, indices, maxX, maxIdx});
    }

    validHoles.sort((a, b) => b.maxX - a.maxX);

    const cr = (o: Vec2Like, a: Vec2Like, b: Vec2Like): number =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    // True if segment a-b properly crosses any edge of the closed ring
    // (shared endpoints and touching do not count).
    const ringBlocks = (
      a: Vec2Like,
      b: Vec2Like,
      ring: Vec2Like[],
    ): boolean => {
      for (let k = 0; k < ring.length; k++) {
        const c = ring[k];
        const d = ring[(k + 1) % ring.length];
        if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) {
          return true;
        }
      }
      return false;
    };

    for (const hole of validHoles) {
      const h = hole.pts[hole.maxIdx];
      const hx = h.x;
      const n = contour.length;
      const ring = contour.map((idx) => allVertices[idx]);
      // Candidates: right of the hole first (no unit-dependent penalty), then
      // by distance. Take the first one that lies inside the contour's corner
      // sector at that vertex and whose bridge crosses no contour/hole edge.
      const dist = (i: number): number =>
        Math.hypot(ring[i].x - hx, ring[i].y - h.y);
      const order = ring
        .map((_, i) => i)
        .sort(
          (i, j) =>
            Number(ring[i].x < hx) - Number(ring[j].x < hx) ||
            dist(i) - dist(j),
        );
      let bestContourPos = order[0];
      for (const i of order) {
        const p = ring[i];
        const prev = ring[(i + n - 1) % n];
        const next = ring[(i + 1) % n];
        const leftOfNext = cr(p, next, h) >= 0;
        const leftOfPrev = cr(prev, p, h) >= 0;
        const inSector =
          cr(prev, p, next) >= 0
            ? leftOfNext && leftOfPrev
            : leftOfNext || leftOfPrev;
        if (
          inSector &&
          !ringBlocks(h, p, ring) &&
          !validHoles.some((o) => ringBlocks(h, p, o.pts))
        ) {
          bestContourPos = i;
          break;
        }
      }

      const nextContour: number[] = [];
      for (let i = 0; i <= bestContourPos; i++) {
        nextContour.push(contour[i]);
      }
      for (let i = 0; i <= hole.indices.length; i++) {
        const hIdx = hole.indices[(hole.maxIdx + i) % hole.indices.length];
        nextContour.push(hIdx);
      }
      for (let i = bestContourPos; i < contour.length; i++) {
        nextContour.push(contour[i]);
      }
      contour = nextContour;
    }

    return {
      merged: contour.map((idx) => allVertices[idx]),
      mergedIndices: contour,
      allVertices,
    };
  }

  function triangulatePolygonIndices(
    contourIndices: number[],
    vertices: Vec2Like[],
  ): Array<[number, number, number]> {
    const triangles: Array<[number, number, number]> = [];
    const poly = contourIndices.slice();
    if (poly.length < 3) return triangles;

    let guard = poly.length * poly.length * 3 + 128;
    let i = 0;
    while (poly.length > 2 && guard-- > 0) {
      const n = poly.length;
      const prevIdx = poly[(i + n - 1) % n];
      const currIdx = poly[i % n];
      const nextIdx = poly[(i + 1) % n];

      const a = vertices[prevIdx];
      const b = vertices[currIdx];
      const c = vertices[nextIdx];

      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 1e-12) {
        let ear = true;
        const minX = Math.min(a.x, b.x, c.x) - 1e-7;
        const maxX = Math.max(a.x, b.x, c.x) + 1e-7;
        const minY = Math.min(a.y, b.y, c.y) - 1e-7;
        const maxY = Math.max(a.y, b.y, c.y) + 1e-7;
        for (let j = 0; j < n; j++) {
          const testIdx = poly[j];
          if (
            testIdx === prevIdx ||
            testIdx === currIdx ||
            testIdx === nextIdx
          ) {
            continue;
          }
          const p = vertices[testIdx];
          if (
            p.x >= minX &&
            p.x <= maxX &&
            p.y >= minY &&
            p.y <= maxY &&
            pointInTriangle2D(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y) &&
            (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y) >= 1e-12 &&
            (p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y) >= 1e-12 &&
            (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) >= 1e-12
          ) {
            ear = false;
            break;
          }
        }
        if (ear) {
          triangles.push([prevIdx, currIdx, nextIdx]);
          poly.splice(i % n, 1);
          // Re-test the previous vertex (it may have become an ear) instead of
          // rescanning from 0, which made clipping O(n^3).
          i = Math.max(0, (i % n) - 1);
          continue;
        }
      }
      i++;
      if (i >= n * 2) {
        // No ear found in a full pass: force-clip the vertex just tested
        // (prev/curr/next were computed for i - 1).
        triangles.push([prevIdx, currIdx, nextIdx]);
        poly.splice((i - 1) % n, 1);
        i = 0;
      }
    }
    return triangles;
  }

  // Extracts outer/hole contours and enforces MAX_SHAPE_POINTS (ear clipping
  // is O(n^2), so unbounded author-supplied contours could hang the worker).
  function extractShapePoints(
    shape: Path,
    curveSegments: number,
  ): {shape: Vec2Like[]; holes: Vec2Like[][]} {
    const extracted =
      shape instanceof Shape
        ? shape.extractPoints(curveSegments)
        : {shape: shape.getPoints(curveSegments), holes: []};
    let total = extracted.shape.length;
    for (const h of extracted.holes) total += h.length;
    if (total > maxShapePoints) {
      throw new RangeError(
        `SecurityError: shape point count (${total}) exceeds MAX_SHAPE_POINTS (${maxShapePoints})`,
      );
    }
    return extracted;
  }

  function bounds2D(verts: Vec2Like[]): [number, number, number, number] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of verts) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    return [
      minX,
      minY,
      Math.max(1e-6, maxX - minX),
      Math.max(1e-6, maxY - minY),
    ];
  }

  class ShapeGeometry extends BufferGeometry {
    constructor(shapes: Shape | Shape[] = new Shape(), curveSegments = 12) {
      super();
      const shapeList = Array.isArray(shapes) ? shapes : [shapes];
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (const shape of shapeList) {
        if (!(shape instanceof Path)) continue;
        const extracted = extractShapePoints(shape, curveSegments);
        if (extracted.shape.length < 3) continue;
        const {mergedIndices, allVertices} = mergeHolesIntoContour(
          extracted.shape,
          extracted.holes,
        );
        const tris = triangulatePolygonIndices(mergedIndices, allVertices);
        const baseVertex = positions.length / 3;
        const [minX, minY, spanX, spanY] = bounds2D(allVertices);
        for (const v of allVertices) {
          positions.push(v.x, v.y, 0);
          normals.push(0, 0, 1);
          uvs.push((v.x - minX) / spanX, (v.y - minY) / spanY);
        }
        for (const [a, b, c] of tris) {
          indices.push(baseVertex + a, baseVertex + b, baseVertex + c);
        }
      }

      setGeoBuffers(this, positions, normals, uvs, indices);
    }
  }

  function setGeoBuffers(
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
    geo: any,
    pos: number[] | Float32Array,
    norm: number[] | Float32Array,
    uv: number[] | Float32Array,
    idx: number[] | Uint32Array,
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
  ): any {
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(norm, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }

  function computeContourOffsetNormals(ring: Vec2Like[]): Vec2Like[] {
    const n = ring.length;
    const out: Vec2Like[] = [];
    for (let i = 0; i < n; i++) {
      const prev = ring[(i + n - 1) % n];
      const curr = ring[i];
      const next = ring[(i + 1) % n];
      let e1x = curr.x - prev.x;
      let e1y = curr.y - prev.y;
      const l1 = Math.hypot(e1x, e1y) || 1;
      e1x /= l1;
      e1y /= l1;
      let e2x = next.x - curr.x;
      let e2y = next.y - curr.y;
      const l2 = Math.hypot(e2x, e2y) || 1;
      e2x /= l2;
      e2y /= l2;
      const n1x = e1y;
      const n1y = -e1x;
      const n2x = e2y;
      const n2y = -e2x;
      let bx = n1x + n2x;
      let by = n1y + n2y;
      const bl = Math.hypot(bx, by);
      if (bl > 1e-6) {
        bx /= bl;
        by /= bl;
        const denom = Math.max(0.35, bx * n1x + by * n1y);
        out.push(new Vector2(bx / denom, by / denom));
      } else {
        out.push(new Vector2(n1x, n1y));
      }
    }
    return out;
  }

  // Evaluates progressive cross-section [sx, sy] scale at normalized u in [0, 1].
  function evalSweepScale(
    scaleSpec: unknown,
    taperSpec: unknown,
    u: number,
  ): [number, number] {
    const raw = scaleSpec !== undefined ? scaleSpec : taperSpec;
    if (raw == null) return [1, 1];
    if (typeof raw === 'function') {
      try {
        const res = raw(u);
        if (Array.isArray(res) && res.length >= 2) {
          return [Math.max(0, num(res[0], 1)), Math.max(0, num(res[1], 1))];
        }
        const s = Math.max(0, num(res, 1));
        return [s, s];
      } catch {
        return [1, 1];
      }
    }
    if (Array.isArray(raw)) {
      if (raw.length >= 3) {
        const s0 = Math.max(0, num(raw[0], 1));
        const s1 = Math.max(0, num(raw[1], 1));
        const s2 = Math.max(0, num(raw[2], 1));
        const mt = 1 - u;
        const s = mt * mt * s0 + 2 * mt * u * s1 + u * u * s2;
        return [s, s];
      }
      if (raw.length >= 2) {
        const s0 = Math.max(0, num(raw[0], 1));
        const s1 = Math.max(0, num(raw[1], 1));
        const s = s0 + (s1 - s0) * u;
        return [s, s];
      }
      if (raw.length === 1) {
        const s = Math.max(0, num(raw[0], 1));
        return [s, s];
      }
      return [1, 1];
    }
    if (scaleSpec === undefined && typeof taperSpec === 'number') {
      const sEnd = Math.max(0, num(taperSpec, 1));
      const s = 1 + (sEnd - 1) * u;
      return [s, s];
    }
    const s = Math.max(0, num(raw, 1));
    return [s, s];
  }

  function makeCircleShape(radius: number, segments: number): Shape {
    const r = Math.max(1e-4, num(radius, 0.1));
    const segs = Math.max(3, Math.min(64, Math.floor(num(segments, 12))));
    const sh = new Shape();
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      if (i === 0) sh.moveTo(x, y);
      else sh.lineTo(x, y);
    }
    sh.closePath();
    return sh;
  }

  // Rotation-minimizing Bishop (parallel transport) frames along a 3D curve or
  // point list, with automatic holonomy untwisting when `closed` is true.
  function computeBishopFrames(
    // tslint:disable-next-line:no-any Curve3 or array of 3D points.
    rawPath: any,
    stepsInput: number,
    closedInput?: boolean,
    upInput?: unknown,
  ): {
    // tslint:disable-next-line:no-any Dynamic Vector3.
    pts: any[];
    // tslint:disable-next-line:no-any Dynamic Vector3.
    tangents: any[];
    // tslint:disable-next-line:no-any Dynamic Vector3.
    normals: any[];
    // tslint:disable-next-line:no-any Dynamic Vector3.
    binormals: any[];
    closed: boolean;
  } {
    const steps = Math.max(2, Math.min(512, Math.floor(num(stepsInput, 64))));
    // tslint:disable-next-line:no-any Dynamic Curve3 instance.
    let curveObj: any = rawPath;
    if (Array.isArray(rawPath)) {
      // tslint:disable-next-line:no-any Dynamic Vector3.
      const vecPts: any[] = [];
      for (const item of rawPath) {
        if (Array.isArray(item) && item.length >= 2) {
          vecPts.push(
            new Vector3(num(item[0], 0), num(item[1], 0), num(item[2], 0)),
          );
        } else if (item && typeof item === 'object') {
          vecPts.push(
            new Vector3(num(item.x, 0), num(item.y, 0), num(item.z, 0)),
          );
        }
      }
      if (vecPts.length >= 2 && typeof CatmullRomCurve3 === 'function') {
        curveObj = new CatmullRomCurve3(vecPts, Boolean(closedInput));
      }
    }

    const isClosed = Boolean(
      closedInput !== undefined ? closedInput : curveObj?.closed,
    );
    const sampleFn = curveObj?.getPointAt ?? curveObj?.getPoint;
    // tslint:disable-next-line:no-any Dynamic Vector3.
    const pts: any[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const p = new Vector3(0, 0, u);
      if (typeof sampleFn === 'function') {
        const res = sampleFn.call(curveObj, u, p);
        const src = res && res !== p ? res : p;
        p.set(num(src.x, 0), num(src.y, 0), num(src.z, 0));
      }
      pts.push(p);
    }

    let totalSpan = 0;
    for (let i = 1; i < pts.length; i++) {
      totalSpan += pts[i].distanceTo(pts[i - 1]);
    }
    if (totalSpan < 1e-6) {
      const p0 = pts[0].clone();
      for (let i = 0; i <= steps; i++) {
        pts[i].set(p0.x, p0.y, p0.z + i / steps);
      }
    } else if (isClosed) {
      if (pts[pts.length - 1].distanceTo(pts[0]) > 1e-4) {
        pts.push(pts[0].clone());
      } else {
        pts[pts.length - 1].copy(pts[0]);
      }
    }

    const nSegs = pts.length - 1;
    // tslint:disable-next-line:no-any Dynamic Vector3.
    const tangents: any[] = [];
    for (let i = 0; i <= nSegs; i++) {
      const closedEnd = isClosed && (i === 0 || i === nSegs);
      const t = new Vector3().subVectors(
        pts[closedEnd ? 1 : Math.min(nSegs, i + 1)],
        pts[closedEnd ? nSegs - 1 : Math.max(0, i - 1)],
      );
      for (let d = 1; t.length() < 1e-8 && d <= nSegs; d++) {
        t.subVectors(pts[Math.min(nSegs, i + d)], pts[Math.max(0, i - d)]);
      }
      tangents.push(
        t.length() < 1e-8
          ? i > 0
            ? tangents[i - 1].clone()
            : new Vector3(0, 0, 1)
          : t.normalize(),
      );
    }
    if (isClosed) tangents[nSegs].copy(tangents[0]);

    // Initial Bishop frame (N0, B0) at i = 0 such that N0 x B0 = T0 and B0
    // aligns with the projected reference `up` vector (+Y by default).
    const t0 = tangents[0];
    const up = new Vector3(0, 1, 0);
    if (Array.isArray(upInput) && upInput.length >= 3) {
      up.set(num(upInput[0], 0), num(upInput[1], 1), num(upInput[2], 0));
    } else if (upInput && typeof upInput === 'object') {
      const uo = upInput as {x?: unknown; y?: unknown; z?: unknown};
      up.set(num(uo.x, 0), num(uo.y, 1), num(uo.z, 0));
    }
    if (up.length() < 1e-6) up.set(0, 1, 0);
    else up.normalize();
    if (Math.abs(up.dot(t0)) > 0.95) {
      if (Math.abs(t0.y) < 0.9) up.set(0, 1, 0);
      else if (Math.abs(t0.z) < 0.9) up.set(0, 0, 1);
      else up.set(1, 0, 0);
    }
    const b0 = up.clone().addScaledVector(t0, -up.dot(t0)).normalize();
    const n0 = new Vector3().crossVectors(b0, t0).normalize();
    // tslint:disable-next-line:no-any Dynamic Vector3.
    const normals: any[] = [n0];
    // tslint:disable-next-line:no-any Dynamic Vector3.
    const binormals: any[] = [b0];
    const axis = new Vector3();
    const cross = new Vector3();

    for (let i = 1; i <= nSegs; i++) {
      const prevT = tangents[i - 1];
      const currT = tangents[i];
      const prevB = binormals[i - 1];
      axis.crossVectors(prevT, currT);
      const s = axis.length();
      const c = Math.max(-1, Math.min(1, prevT.dot(currT)));
      const b = prevB.clone();
      if (s > 1e-7) {
        axis.multiplyScalar(1 / s);
        cross.crossVectors(axis, prevB);
        b.multiplyScalar(c)
          .addScaledVector(cross, s)
          .addScaledVector(axis, axis.dot(prevB) * (1 - c));
      } else if (c < 0) {
        b.multiplyScalar(-1);
      }
      b.addScaledVector(currT, -b.dot(currT)).normalize();
      normals.push(new Vector3().crossVectors(b, currT).normalize());
      binormals.push(b);
    }

    if (isClosed && nSegs > 0) {
      const holonomy = Math.atan2(
        binormals[nSegs].dot(normals[0]),
        binormals[nSegs].dot(binormals[0]),
      );
      if (Math.abs(holonomy) > 1e-6) {
        for (let i = 1; i <= nSegs; i++) {
          const phi = -holonomy * (i / nSegs);
          const cp = Math.cos(phi);
          const sp = Math.sin(phi);
          const ni = normals[i].clone();
          const bi = binormals[i].clone();
          normals[i].copy(ni).multiplyScalar(cp).addScaledVector(bi, -sp);
          binormals[i].copy(ni).multiplyScalar(sp).addScaledVector(bi, cp);
        }
      }
      normals[nSegs].copy(normals[0]);
      binormals[nSegs].copy(binormals[0]);
    }

    return {pts, tangents, normals, binormals, closed: isClosed};
  }

  interface SpineFrame3D {
    // tslint:disable-next-line:no-any Dynamic Vector3.
    p: any;
    // tslint:disable-next-line:no-any Dynamic Vector3.
    t: any;
    // tslint:disable-next-line:no-any Dynamic Vector3.
    rx: any;
    // tslint:disable-next-line:no-any Dynamic Vector3.
    ry: any;
    u: number;
    sx?: number;
    sy?: number;
  }

  function evalFrame3D(
    fr: SpineFrame3D,
    vx: number,
    vy: number,
  ): [number, number, number] {
    const x = vx * (fr.sx ?? 1);
    const y = vy * (fr.sy ?? 1);
    return [
      fr.p.x + x * fr.rx.x + y * fr.ry.x,
      fr.p.y + x * fr.rx.y + y * fr.ry.y,
      fr.p.z + x * fr.rx.z + y * fr.ry.z,
    ];
  }

  // A ring collapses to a single point (rather than a flat line) only when both
  // its scaled extents vanish; flattened rings keep full quads.
  function ringIsPoint(ring: Vec2Like[], fr: SpineFrame3D): boolean {
    let ex = 0;
    let ey = 0;
    for (const p of ring) {
      ex = Math.max(ex, Math.abs(p.x - ring[0].x));
      ey = Math.max(ey, Math.abs(p.y - ring[0].y));
    }
    return Math.max(ex * (fr.sx ?? 1), ey * (fr.sy ?? 1)) <= 1e-9;
  }

  // Emits side walls between consecutive rings. Each quad owns its 4 vertices
  // (so UVs and creases stay exact), but vertex normals are averaged across
  // neighboring quads: always along the spine, and around the ring unless the
  // profile has a crease sharper than ~50 degrees (e.g. square/hex corners).
  function emitFramedWallStrip(
    rList: Vec2Like[][],
    fList: SpineFrame3D[],
    inward: boolean,
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    wrap = false,
  ): void {
    const flip = inward ? -1 : 1;
    const nStrips = fList.length - 1;
    if (nStrips < 1) return;
    const ringAt = (g: number) => rList[Math.min(g, rList.length - 1)];
    const rLen = ringAt(0).length;
    const pts: Array<Array<[number, number, number]>> = [];
    const point: boolean[] = [];
    for (let g = 0; g <= nStrips; g++) {
      const r = ringAt(g);
      pts.push(r.map((v) => evalFrame3D(fList[g], v.x, v.y)));
      point.push(ringIsPoint(r, fList[g]));
    }
    // Pass 1: one unit face normal per quad (zero for degenerate quads).
    const faceN: number[][][] = [];
    for (let g = 0; g < nStrips; g++) {
      const row: number[][] = [];
      for (let i = 0; i < rLen; i++) {
        const j = (i + 1) % rLen;
        const p00 = pts[g][i];
        const p10 = pts[g][j];
        const p11 = pts[g + 1][j];
        const p01 = pts[g + 1][i];
        const d1 = [p11[0] - p00[0], p11[1] - p00[1], p11[2] - p00[2]];
        const d2 = [p01[0] - p10[0], p01[1] - p10[1], p01[2] - p10[2]];
        let n = [
          (d1[1] * d2[2] - d1[2] * d2[1]) * flip,
          (d1[2] * d2[0] - d1[0] * d2[2]) * flip,
          (d1[0] * d2[1] - d1[1] * d2[0]) * flip,
        ];
        let l = Math.hypot(n[0], n[1], n[2]);
        if (l <= 1e-12) {
          // Degenerate quad: fall back to the in-plane outward edge normal.
          const v0 = ringAt(g)[i];
          const v1 = ringAt(g)[j];
          const ex = (v1.y - v0.y) * flip;
          const ey = -(v1.x - v0.x) * flip;
          const f = fList[g];
          n = [
            ex * f.rx.x + ey * f.ry.x,
            ex * f.rx.y + ey * f.ry.y,
            ex * f.rx.z + ey * f.ry.z,
          ];
          l = Math.hypot(n[0], n[1], n[2]);
        }
        row.push(l > 1e-12 ? n.map((c) => c / l) : [0, 0, 0]);
      }
      faceN.push(row);
    }
    const dot = (a: number[], b: number[]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // Smoothed normal for corner (ring row `r`, column `col`) of quad (g, q).
    const cornerN = (g: number, q: number, r: number, col: number) => {
      const own = faceN[g][q];
      const acc = [0, 0, 0];
      const strips = [r - 1, r].map((s) =>
        wrap ? (s + nStrips) % nStrips : s,
      );
      const other = col === q ? (q - 1 + rLen) % rLen : (q + 1) % rLen;
      for (const s of strips) {
        if (s < 0 || s >= nStrips) continue;
        for (const c of [q, other]) {
          const n = faceN[s][c];
          // Blend only quads within ~50 deg around the ring (so octagons and
          // finer stay round while hexagons/squares keep sharp creases) and
          // within ~60 deg along the spine.
          const lim = c === q ? (s === g ? -2 : 0.5) : 0.64;
          if (dot(n, own) > lim) {
            acc[0] += n[0];
            acc[1] += n[1];
            acc[2] += n[2];
          }
        }
      }
      const l = Math.hypot(acc[0], acc[1], acc[2]);
      return l > 1e-12 ? acc.map((c) => c / l) : own;
    };
    for (let g = 0; g < nStrips; g++) {
      const c0 = point[g];
      const c1 = point[g + 1];
      if (c0 && c1) continue;
      const v0 = fList[g].u;
      const v1 = fList[g + 1].u;
      for (let i = 0; i < rLen; i++) {
        const j = (i + 1) % rLen;
        const u0 = i / rLen;
        const u1 = (i + 1) / rLen;
        const qb = positions.length / 3;
        // [ring row, column, u, v] for the corners actually emitted.
        const corners: Array<[number, number, number, number]> = c1
          ? [[g, i, u0, v0], [g, j, u1, v0], [g + 1, j, (u0 + u1) / 2, v1]]
          : c0
            ? [[g, i, (u0 + u1) / 2, v0], [g + 1, j, u1, v1], [g + 1, i, u0, v1]]
            : [[g, i, u0, v0], [g, j, u1, v0], [g + 1, j, u1, v1], [g + 1, i, u0, v1]];
        for (const [r, col, uu, vv] of corners) {
          const p = pts[r][col];
          positions.push(p[0], p[1], p[2]);
          const n = cornerN(g, i, r, col);
          normals.push(n[0], n[1], n[2]);
          uvs.push(uu, vv);
        }
        if (corners.length === 3) {
          indices.push(qb, qb + (inward ? 2 : 1), qb + (inward ? 1 : 2));
        } else if (inward) {
          indices.push(qb, qb + 2, qb + 1, qb, qb + 3, qb + 2);
        } else {
          indices.push(qb, qb + 1, qb + 2, qb, qb + 2, qb + 3);
        }
      }
    }
  }

  function emitFramedCap(
    allVertices: Vec2Like[],
    capTris: Array<[number, number, number]>,
    fr: SpineFrame3D,
    sgn: 1 | -1,
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
  ): void {
    if (
      capTris.length === 0 ||
      (fr.sx ?? 1) * (fr.sy ?? 1) <= 1e-8 ||
      Math.abs(signedArea2D(allVertices)) <= 1e-10
    ) {
      return;
    }
    const [minX, minY, spanX, spanY] = bounds2D(allVertices);
    const base = positions.length / 3;
    for (const v of allVertices) {
      const pt = evalFrame3D(fr, v.x, v.y);
      positions.push(pt[0], pt[1], pt[2]);
      normals.push(fr.t.x * sgn, fr.t.y * sgn, fr.t.z * sgn);
      uvs.push((v.x - minX) / spanX, (v.y - minY) / spanY);
    }
    for (const [a, b, c] of capTris) {
      indices.push(
        base + a,
        base + (sgn < 0 ? c : b),
        base + (sgn < 0 ? b : c),
      );
    }
  }

  function buildSweepBufferGeometry(
    // tslint:disable-next-line:no-any Dynamic BufferGeometry.
    targetGeo: any,
    shapesInput: unknown,
    // tslint:disable-next-line:no-any Curve3 or array of 3D points.
    pathInput: any,
    options: SweepGeometryOptions = {},
  ): void {
    const rawShapes =
      shapesInput !== undefined && shapesInput !== null
        ? shapesInput
        : options.shape;
    const radFallback = num(options.radius ?? options.tubeRadius, 0.1);
    const rSegsFallback = Math.max(
      3,
      Math.min(64, Math.floor(num(options.radialSegments, 12))),
    );
    const shapeList: Path[] = Array.isArray(rawShapes)
      ? rawShapes.filter((s): s is Path => s instanceof Path)
      : rawShapes instanceof Path
        ? [rawShapes]
        : [makeCircleShape(radFallback, rSegsFallback)];
    if (shapeList.length === 0) {
      shapeList.push(makeCircleShape(radFallback, rSegsFallback));
    }

    const curveSegments = Math.max(
      1,
      Math.min(64, Math.floor(num(options.curveSegments, 12))),
    );
    const steps = Math.max(
      2,
      Math.min(
        512,
        Math.floor(num(options.steps ?? options.tubularSegments, 64)),
      ),
    );
    const wantCaps = options.caps !== false;

    const frames = computeBishopFrames(
      pathInput ?? options.path ?? options.curve,
      steps,
      options.closed,
      options.up,
    );
    const nSegs = frames.pts.length - 1;
    const isClosed = frames.closed;
    // A closed tube can only join seamlessly after whole turns of twist.
    const twistTotal = isClosed
      ? Math.round(num(options.twist, 0) / (Math.PI * 2)) * Math.PI * 2
      : num(options.twist, 0);

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const stationData: SpineFrame3D[] = [];
    for (let l = 0; l <= nSegs; l++) {
      const u = l / nSegs;
      const phi = twistTotal * u;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const [sx, sy] = evalSweepScale(options.scale, options.taper, u);
      const n = frames.normals[l];
      const b = frames.binormals[l];
      stationData.push({
        p: frames.pts[l].clone(),
        t: frames.tangents[l],
        rx: n.clone().multiplyScalar(cp).addScaledVector(b, -sp),
        ry: n.clone().multiplyScalar(sp).addScaledVector(b, cp),
        sx,
        sy,
        u,
      });
    }
    if (isClosed && nSegs > 0) {
      // Weld the seam: the end station must coincide with the start station
      // (scale tapers on closed loops snap back to the start scale).
      const s0 = stationData[0];
      const sEnd = stationData[nSegs];
      sEnd.p.copy(s0.p);
      sEnd.rx.copy(s0.rx);
      sEnd.ry.copy(s0.ry);
      sEnd.sx = s0.sx;
      sEnd.sy = s0.sy;
    }

    let vertexBudget = 0;
    for (const shape of shapeList.slice(0, 64)) {
      const extracted = extractShapePoints(shape, curveSegments);
      if (extracted.shape.length < 3) continue;
      let ringTotal = extracted.shape.length;
      for (const h of extracted.holes) ringTotal += h.length;
      vertexBudget += ringTotal * (nSegs * 4 + 2);
      if (vertexBudget > maxGeneratedVertices) {
        throw new RangeError(
          `SecurityError: SweepGeometry would emit ~${vertexBudget} vertices (max ${maxGeneratedVertices}); reduce steps, curveSegments, or shape detail`,
        );
      }

      const outer = extracted.shape.slice();
      if (signedArea2D(outer) < 0) outer.reverse();
      const holes: Vec2Like[][] = [];
      for (const h of extracted.holes) {
        if (h.length < 3) continue;
        const hc = h.slice();
        if (signedArea2D(hc) > 0) hc.reverse();
        holes.push(hc);
      }

      const {mergedIndices, allVertices} = mergeHolesIntoContour(outer, holes);
      const capTris = triangulatePolygonIndices(mergedIndices, allVertices);

      if (!isClosed && wantCaps && capTris.length > 0) {
        emitFramedCap(
          allVertices,
          capTris,
          stationData[0],
          -1,
          positions,
          normals,
          uvs,
          indices,
        );
        emitFramedCap(
          allVertices,
          capTris,
          stationData[nSegs],
          1,
          positions,
          normals,
          uvs,
          indices,
        );
      }

      for (const ring of [outer, ...holes]) {
        emitFramedWallStrip(
          [ring],
          stationData,
          false,
          positions,
          normals,
          uvs,
          indices,
          isClosed,
        );
      }
    }

    setGeoBuffers(targetGeo, positions, normals, uvs, indices);
  }

  class SweepGeometry extends BufferGeometry {
    constructor(
      // tslint:disable-next-line:no-any Shape, Shape[], Curve3, or SweepGeometryOptions.
      shapeOrOptions?: any,
      // tslint:disable-next-line:no-any Curve3, 3D point list, or SweepGeometryOptions.
      pathOrOptions?: any,
      options: SweepGeometryOptions = {},
    ) {
      super();
      const isShapeFirst =
        shapeOrOptions instanceof Path ||
        (Array.isArray(shapeOrOptions) && shapeOrOptions[0] instanceof Path);
      if (isShapeFirst) {
        buildSweepBufferGeometry(
          this,
          shapeOrOptions,
          pathOrOptions,
          options && typeof options === 'object' ? options : {},
        );
      } else if (
        shapeOrOptions &&
        typeof shapeOrOptions === 'object' &&
        !Array.isArray(shapeOrOptions) &&
        typeof shapeOrOptions.getPoint !== 'function' &&
        typeof shapeOrOptions.getPointAt !== 'function'
      ) {
        // Single options-bag call: new THREE.SweepGeometry({ shape, path, ... })
        const opts = shapeOrOptions as SweepGeometryOptions;
        buildSweepBufferGeometry(
          this,
          opts.shape,
          opts.path ?? opts.curve ?? pathOrOptions,
          opts,
        );
      } else {
        // Path-first call: new THREE.SweepGeometry(curve, { shape?, radius?, ... })
        const opts =
          pathOrOptions && typeof pathOrOptions === 'object'
            ? (pathOrOptions as SweepGeometryOptions)
            : options;
        buildSweepBufferGeometry(this, opts?.shape, shapeOrOptions, opts);
      }
    }
  }

  class HelixCurve3 extends Curve3Base {
    declare radius: number;
    declare topRadius: number;
    declare pitch: number;
    declare turns: number;
    declare height: number;
    declare handedness: 'right' | 'left';
    declare origin: 'center' | 'bottom';
    declare closed: boolean;

    constructor(
      radiusOrOptions: number | HelixGeometryOptions = 0.5,
      pitchInput = 0.25,
      turnsInput = 4,
      topRadiusInput?: number,
      handednessInput: 'right' | 'left' = 'right',
    ) {
      super();
      this.closed = false;
      const o: HelixGeometryOptions =
        radiusOrOptions && typeof radiusOrOptions === 'object'
          ? radiusOrOptions
          : {
              radius: radiusOrOptions,
              pitch: pitchInput,
              turns: turnsInput,
              topRadius: topRadiusInput,
              handedness: handednessInput,
            };
      this.radius = Math.max(0, num(o.radius, 0.5));
      this.topRadius = Math.max(0, num(o.topRadius, this.radius));
      this.turns = Math.max(0.05, Math.min(64, num(o.turns, 4)));
      this.pitch = num(
        o.pitch,
        o.height !== undefined ? num(o.height, 1) / this.turns : 0.25,
      );
      this.height = num(o.height, this.turns * this.pitch);
      this.handedness = o.handedness === 'left' ? 'left' : 'right';
      this.origin = o.origin === 'bottom' ? 'bottom' : 'center';
    }

    // tslint:disable-next-line:no-any Dynamic Vector3.
    getPoint(t: number, out: any = new Vector3()): any {
      const u = Math.max(0, Math.min(1, num(t, 0)));
      const r = this.radius + (this.topRadius - this.radius) * u;
      const sign = this.handedness === 'left' ? -1 : 1;
      const theta = sign * this.turns * Math.PI * 2 * u;
      const y0 = this.origin === 'bottom' ? 0 : -this.height * 0.5;
      // Right-handed (y-up): counter-clockwise when viewed from +Y as it rises.
      return out.set(
        r * Math.cos(theta),
        y0 + this.height * u,
        -r * Math.sin(theta),
      );
    }
  }

  class HelixGeometry extends BufferGeometry {
    constructor(
      optionsOrRadius: HelixGeometryOptions | number = {},
      pitchInput?: number,
      turnsInput?: number,
      tubeRadiusInput?: number,
      extraOptions: HelixGeometryOptions = {},
    ) {
      super();
      const opts: HelixGeometryOptions =
        optionsOrRadius && typeof optionsOrRadius === 'object'
          ? optionsOrRadius
          : {
              ...extraOptions,
              radius: num(optionsOrRadius, 0.5),
              ...(pitchInput !== undefined ? {pitch: pitchInput} : {}),
              ...(turnsInput !== undefined ? {turns: turnsInput} : {}),
              ...(tubeRadiusInput !== undefined
                ? {tubeRadius: tubeRadiusInput}
                : {}),
            };
      const helixCurve = new HelixCurve3(opts);
      const segsPerTurn = Math.max(
        4,
        Math.min(128, Math.floor(num(opts.segmentsPerTurn, 24))),
      );
      const steps = Math.max(
        4,
        Math.min(
          512,
          Math.floor(
            num(
              opts.steps ?? opts.tubularSegments,
              Math.round(helixCurve.turns * segsPerTurn),
            ),
          ),
        ),
      );
      const wireRad = Math.max(
        1e-4,
        num(opts.tubeRadius ?? opts.wireRadius ?? opts.tube, 0.05),
      );
      const rSegs = Math.max(
        3,
        Math.min(64, Math.floor(num(opts.radialSegments, 12))),
      );
      const profile =
        opts.shape instanceof Path ||
        (Array.isArray(opts.shape) && opts.shape[0] instanceof Path)
          ? opts.shape
          : makeCircleShape(wireRad, rSegs);
      buildSweepBufferGeometry(this, profile, helixCurve, {
        steps,
        curveSegments: opts.curveSegments,
        twist: opts.twist,
        scale: opts.scale,
        caps: opts.caps !== false,
        closed: false,
      });
    }
  }

  // Uniform arc-length resampling of a closed 2D polygon into `count` vertices.
  function resampleRingByArcLength(
    ring: Vec2Like[],
    count: number,
  ): Vec2Like[] {
    const clean: Vec2Like[] = [];
    for (const p of ring) {
      if (
        clean.length === 0 ||
        Math.hypot(
          p.x - clean[clean.length - 1].x,
          p.y - clean[clean.length - 1].y,
        ) > 1e-7
      ) {
        clean.push(new Vector2(num(p.x, 0), num(p.y, 0)));
      }
    }
    if (
      clean.length > 1 &&
      Math.hypot(
        clean[0].x - clean[clean.length - 1].x,
        clean[0].y - clean[clean.length - 1].y,
      ) <= 1e-7
    ) {
      clean.pop();
    }
    if (clean.length === 0) {
      return Array.from({length: count}, () => new Vector2(0, 0));
    }
    if (clean.length === 1) {
      return Array.from({length: count}, () => clean[0].clone());
    }
    if (signedArea2D(clean) < 0) clean.reverse();
    const n = clean.length;
    const cumLen: number[] = [0];
    let totalLen = 0;
    for (let i = 0; i < n; i++) {
      const a = clean[i];
      const b = clean[(i + 1) % n];
      totalLen += Math.hypot(b.x - a.x, b.y - a.y);
      cumLen.push(totalLen);
    }
    if (totalLen <= 1e-8) {
      return Array.from({length: count}, () => clean[0].clone());
    }
    const out: Vec2Like[] = [];
    let segIdx = 0;
    for (let j = 0; j < count; j++) {
      const target = (j / count) * totalLen;
      while (segIdx < n - 1 && cumLen[segIdx + 1] < target) {
        segIdx++;
      }
      const s0 = cumLen[segIdx];
      const s1 = cumLen[segIdx + 1];
      const t = s1 > s0 ? (target - s0) / (s1 - s0) : 0;
      const a = clean[segIdx];
      const b = clean[(segIdx + 1) % n];
      out.push(new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
    return out;
  }

  // Finds cyclic shift k minimizing squared normalized distance to `prevRing`.
  function alignRingSeam(
    prevRing: Vec2Like[],
    currRing: Vec2Like[],
  ): Vec2Like[] {
    const m = prevRing.length;
    if (m <= 1 || currRing.length !== m) return currRing.slice();
    const normRing = (r: Vec2Like[]): Vec2Like[] => {
      let cx = 0;
      let cy = 0;
      for (const p of r) {
        cx += p.x;
        cy += p.y;
      }
      cx /= m;
      cy /= m;
      let sq = 0;
      for (const p of r) {
        sq += (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
      }
      const inv = 1 / Math.max(1e-6, Math.sqrt(sq / m));
      return r.map((p) => new Vector2((p.x - cx) * inv, (p.y - cy) * inv));
    };
    const pNorm = normRing(prevRing);
    const qNorm = normRing(currRing);
    let bestK = 0;
    let bestCost = Infinity;
    for (let k = 0; k < m; k++) {
      let cost = 0;
      for (let j = 0; j < m; j++) {
        const a = pNorm[j];
        const b = qNorm[(j + k) % m];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        cost += dx * dx + dy * dy;
      }
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestK = k;
      }
    }
    if (bestK === 0) return currRing.slice();
    const shifted: Vec2Like[] = [];
    for (let j = 0; j < m; j++) {
      shifted.push(currRing[(j + bestK) % m]);
    }
    return shifted;
  }

  function catmullRom1D(
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    t: number,
  ): number {
    const t2 = t * t;
    const t3 = t2 * t;
    const v =
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    const lo = Math.min(p0, p1, p2, p3);
    const hi = Math.max(p0, p1, p2, p3);
    const pad = (hi - lo) * 0.15;
    return Math.max(lo - pad, Math.min(hi + pad, v));
  }

  function buildLoftBufferGeometry(
    // tslint:disable-next-line:no-any Dynamic BufferGeometry.
    targetGeo: any,
    profilesInput: unknown,
    options: LoftGeometryOptions = {},
  ): void {
    const rawList = (
      Array.isArray(profilesInput)
        ? profilesInput
        : Array.isArray(options.profiles)
          ? options.profiles
          : []
    ).slice(0, 256);
    const curveSegments = Math.max(
      1,
      Math.min(64, Math.floor(num(options.curveSegments, 12))),
    );
    const M = Math.max(
      8,
      Math.min(256, Math.floor(num(options.profileSegments, 48))),
    );
    const axis =
      options.axis === 'x' || options.axis === 'z' ? options.axis : 'y';

    interface ParsedStation {
      baseRing: Vec2Like[];
      offset?: number;
      sx: number;
      sy: number;
      twist: number;
      tx: number;
      ty: number;
    }

    const extractContour = (rawShape: unknown): Vec2Like[] | null => {
      if (rawShape instanceof Path) {
        const ext = extractShapePoints(rawShape, curveSegments);
        return ext.shape.length >= 3 ? ext.shape : null;
      }
      if (Array.isArray(rawShape) && rawShape.length >= 3) {
        const pts: Vec2Like[] = [];
        for (const item of rawShape) {
          if (Array.isArray(item) && item.length >= 2) {
            pts.push(new Vector2(num(item[0], 0), num(item[1], 0)));
          } else if (item && typeof item === 'object') {
            const o = item as {x?: unknown; y?: unknown};
            pts.push(new Vector2(num(o.x, 0), num(o.y, 0)));
          }
        }
        return pts.length >= 3 ? pts : null;
      }
      return null;
    };

    const parsed: ParsedStation[] = [];
    for (let idx = 0; idx < rawList.length; idx++) {
      const item = rawList[idx];
      if (!item) continue;
      const directPts = extractContour(item);
      if (directPts) {
        parsed.push({
          baseRing: resampleRingByArcLength(directPts, M),
          offset: Array.isArray(options.offsets)
            ? options.offsets[idx]
            : undefined,
          sx: 1,
          sy: 1,
          twist: 0,
          tx: 0,
          ty: 0,
        });
        continue;
      }
      if (typeof item === 'object') {
        const spec = item as LoftStationSpec;
        const pts = extractContour(spec.shape);
        if (!pts) continue;
        const sc = spec.scale;
        const sx = Array.isArray(sc)
          ? Math.max(0, num(sc[0], 1))
          : Math.max(0, num(sc, 1));
        const sy = Array.isArray(sc)
          ? Math.max(0, num(sc[1], sx))
          : Math.max(0, num(sc, 1));
        const rawOff =
          spec.offset ??
          (axis === 'y'
            ? (spec.y ?? spec.z ?? spec.x)
            : axis === 'z'
              ? (spec.z ?? spec.y ?? spec.x)
              : (spec.x ?? spec.y ?? spec.z)) ??
          (Array.isArray(options.offsets) ? options.offsets[idx] : undefined);
        parsed.push({
          baseRing: resampleRingByArcLength(pts, M),
          offset:
            typeof rawOff === 'number' && Number.isFinite(rawOff)
              ? rawOff
              : undefined,
          sx,
          sy,
          twist: num(spec.twist, 0),
          tx: Array.isArray(spec.translate) ? num(spec.translate[0], 0) : 0,
          ty: Array.isArray(spec.translate) ? num(spec.translate[1], 0) : 0,
        });
      }
    }

    const totalSpan = Math.abs(num(options.height ?? options.length, 1));
    if (parsed.length === 0) {
      const fallbackRing = resampleRingByArcLength(
        extractShapePoints(makeCircleShape(0.25, 24), curveSegments).shape,
        M,
      );
      parsed.push(
        {baseRing: fallbackRing, sx: 1, sy: 1, twist: 0, tx: 0, ty: 0},
        {baseRing: fallbackRing.slice(), sx: 1, sy: 1, twist: 0, tx: 0, ty: 0},
      );
    } else if (parsed.length === 1) {
      const s0 = parsed[0];
      parsed.push({
        baseRing: s0.baseRing.slice(),
        offset: s0.offset !== undefined ? s0.offset + totalSpan : undefined,
        sx: s0.sx,
        sy: s0.sy,
        twist: s0.twist,
        tx: s0.tx,
        ty: s0.ty,
      });
    }

    const K = parsed.length;
    const hasExplicitOffsets = parsed.some((s) => s.offset !== undefined);
    const safeSpan = Math.abs(totalSpan) > 1e-6 ? totalSpan : 1;
    const originShift =
      !hasExplicitOffsets && options.origin === 'center' ? -safeSpan * 0.5 : 0;
    const stationOffsets: number[] = [];
    for (let m = 0; m < K; m++) {
      const fallbackOff = originShift + (m / Math.max(1, K - 1)) * safeSpan;
      stationOffsets.push(
        parsed[m].offset !== undefined ? parsed[m].offset! : fallbackOff,
      );
    }
    if (hasExplicitOffsets) {
      const order = parsed
        .map((st, i) => ({st, off: stationOffsets[i]}))
        .sort((a, b) => a.off - b.off);
      for (let m = 0; m < K; m++) {
        parsed[m] = order[m].st;
        stationOffsets[m] = order[m].off;
      }
    }
    if (Math.abs(stationOffsets[K - 1] - stationOffsets[0]) < 1e-6) {
      for (let m = 0; m < K; m++) {
        stationOffsets[m] =
          stationOffsets[0] + (m / Math.max(1, K - 1)) * Math.abs(safeSpan);
      }
    }

    // Align base ring seams before applying per-station twist/scale/translate.
    const stationRings: Vec2Like[][] = [];
    let prevAlignedBase = parsed[0].baseRing;
    for (let m = 0; m < K; m++) {
      const st = parsed[m];
      const alignedBase =
        m === 0 ? st.baseRing : alignRingSeam(prevAlignedBase, st.baseRing);
      prevAlignedBase = alignedBase;
      const cp = Math.cos(st.twist);
      const sp = Math.sin(st.twist);
      stationRings.push(
        alignedBase.map((p) => {
          const sx = p.x * st.sx;
          const sy = p.y * st.sy;
          return new Vector2(
            sx * cp - sy * sp + st.tx,
            sx * sp + sy * cp + st.ty,
          );
        }),
      );
    }

    const openTop = Boolean(options.openTop);
    const isClosed =
      Boolean(options.closed && options.path != null) && !openTop;
    if (isClosed) {
      stationRings.push(
        alignRingSeam(stationRings[K - 1], stationRings[0]).map((p) =>
          p.clone(),
        ),
      );
      const stepSpan =
        (stationOffsets[K - 1] - stationOffsets[0]) / Math.max(1, K - 1);
      stationOffsets.push(stationOffsets[K - 1] + (stepSpan || 1));
    }

    const numSpans = stationRings.length - 1;
    const interp = String(options.interpolation ?? 'linear').toLowerCase();
    const isSmooth =
      (interp === 'smooth' ||
        interp === 'catmull-rom' ||
        interp === 'catmullrom' ||
        interp === 'spline') &&
      stationRings.length >= 3;
    const totalSteps = Math.max(
      numSpans,
      Math.min(
        512,
        Math.floor(
          num(
            options.steps,
            isSmooth || options.path
              ? Math.max(24, numSpans * 12)
              : Math.max(numSpans, 16),
          ),
        ),
      ),
    );
    // Keep the total ring count G <= 512 (bounded geometry, exact frame lookups).
    const segsPerSpan = Math.max(
      1,
      Math.min(
        Math.round(totalSteps / numSpans),
        Math.floor(512 / numSpans),
      ),
    );

    // Sample interpolated 2D cross-section rings and axial heights.
    const rings2D: Vec2Like[][] = [];
    const ringOffsets: number[] = [];
    const ringUs: number[] = [];
    const nStations = stationRings.length;
    const getRing = (idx: number): Vec2Like[] => {
      // In-range indices always use their own (seam-aligned) ring; closed
      // loops wrap only for the Catmull-Rom neighbors outside that range.
      if (idx >= 0 && idx < nStations) return stationRings[idx];
      if (isClosed) {
        // Re-align the wrapped neighbor to the ring it sits next to.
        return idx < 0
          ? alignRingSeam(stationRings[0], stationRings[nStations - 2])
          : alignRingSeam(stationRings[nStations - 1], stationRings[1]);
      }
      if (idx < 0) {
        return stationRings[0].map(
          (p, j) =>
            new Vector2(
              2 * p.x - stationRings[1][j].x,
              2 * p.y - stationRings[1][j].y,
            ),
        );
      }
      if (idx >= nStations) {
        const last = stationRings[nStations - 1];
        const prev = stationRings[nStations - 2];
        return last.map(
          (p, j) => new Vector2(2 * p.x - prev[j].x, 2 * p.y - prev[j].y),
        );
      }
      return stationRings[idx];
    };

    const G = numSpans * segsPerSpan;
    const loftVerts =
      G * M * 4 * (options.openTop && num(options.wallThickness, 0) > 0 ? 2 : 1) +
      M * 4;
    if (loftVerts > maxGeneratedVertices) {
      throw new RangeError(
        `SecurityError: LoftGeometry would emit ~${loftVerts} vertices (max ${maxGeneratedVertices}); reduce steps or profileSegments`,
      );
    }
    for (let m = 0; m < numSpans; m++) {
      const r0 = getRing(m - 1);
      const r1 = getRing(m);
      const r2 = getRing(m + 1);
      const r3 = getRing(m + 2);
      const h1 = stationOffsets[m];
      const h2 = stationOffsets[m + 1];
      const sLimit = m === numSpans - 1 ? segsPerSpan : segsPerSpan - 1;
      for (let s = 0; s <= sLimit; s++) {
        const t = s / segsPerSpan;
        const g = m * segsPerSpan + s;
        ringOffsets.push(h1 + (h2 - h1) * t);
        ringUs.push(g / Math.max(1, G));
        const ring: Vec2Like[] = [];
        for (let j = 0; j < M; j++) {
          if (isSmooth) {
            ring.push(
              new Vector2(
                catmullRom1D(r0[j].x, r1[j].x, r2[j].x, r3[j].x, t),
                catmullRom1D(r0[j].y, r1[j].y, r2[j].y, r3[j].y, t),
              ),
            );
          } else {
            ring.push(
              new Vector2(
                r1[j].x + (r2[j].x - r1[j].x) * t,
                r1[j].y + (r2[j].y - r1[j].y) * t,
              ),
            );
          }
        }
        rings2D.push(ring);
      }
    }

    // Build 3D spine frames at each sampled ring index g in [0..G].
    const frames3D: SpineFrame3D[] = [];
    if (options.path != null) {
      // Station offsets map to normalized arc-length fractions along the spine.
      const off0 = ringOffsets[0];
      const offSpan = ringOffsets[G] - off0;
      const bf = computeBishopFrames(
        options.path,
        Math.max(G, 128),
        isClosed,
        options.up,
      );
      const bfSegs = bf.pts.length - 1;
      for (let g = 0; g <= G; g++) {
        const u =
          Math.abs(offSpan) > 1e-9 ? (ringOffsets[g] - off0) / offSpan : g / G;
        const f = Math.max(0, Math.min(1, u)) * bfSegs;
        const j = Math.min(bfSegs, Math.floor(f));
        const j1 = Math.min(bfSegs, j + 1);
        const k = f - j < 0.5 ? j : j1;
        frames3D.push({
          p: bf.pts[j].clone().lerp(bf.pts[j1], f - j),
          t: bf.tangents[k],
          rx: bf.normals[k],
          ry: bf.binormals[k],
          u: ringUs[g],
        });
      }
    } else {
      for (let g = 0; g <= G; g++) {
        const h = ringOffsets[g];
        if (axis === 'x') {
          frames3D.push({
            p: new Vector3(h, 0, 0),
            t: new Vector3(1, 0, 0),
            rx: new Vector3(0, 1, 0),
            ry: new Vector3(0, 0, 1),
            u: ringUs[g],
          });
        } else if (axis === 'z') {
          frames3D.push({
            p: new Vector3(0, 0, h),
            t: new Vector3(0, 0, 1),
            rx: new Vector3(1, 0, 0),
            ry: new Vector3(0, 1, 0),
            u: ringUs[g],
          });
        } else {
          // Default axis 'y': rx = +X, ry = -Z so rx x ry = +Y = +t.
          frames3D.push({
            p: new Vector3(0, h, 0),
            t: new Vector3(0, 1, 0),
            rx: new Vector3(1, 0, 0),
            ry: new Vector3(0, 0, -1),
            u: ringUs[g],
          });
        }
      }
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const capIdx = Array.from({length: M}, (_, i) => i);
    const emitLoftCap = (ring: Vec2Like[], fr: SpineFrame3D, sgn: 1 | -1) => {
      if (Math.abs(signedArea2D(ring)) <= 1e-10) return;
      emitFramedCap(
        ring,
        triangulatePolygonIndices(capIdx, ring),
        fr,
        sgn,
        positions,
        normals,
        uvs,
        indices,
      );
    };

    const wantCaps = options.caps !== false;
    const wallThickness = Math.max(0, num(options.wallThickness, 0));

    // 1. Outer side wall
    emitFramedWallStrip(
      rings2D,
      frames3D,
      false,
      positions,
      normals,
      uvs,
      indices,
      isClosed,
    );

    if (!isClosed) {
      if (openTop && wallThickness > 0) {
        // Hollow vessel mode: bottom cap + top rim annulus + inner cavity wall + inner floor cap.
        emitLoftCap(rings2D[0], frames3D[0], -1);

        const makeInnerRing = (outerRing: Vec2Like[]): Vec2Like[] => {
          const [minX, minY, spanX, spanY] = bounds2D(outerRing);
          const cx = minX + spanX * 0.5;
          const cy = minY + spanY * 0.5;
          const sx = Math.max(0.25, 1 - (wallThickness * 2) / spanX);
          const sy = Math.max(0.25, 1 - (wallThickness * 2) / spanY);
          return outerRing.map(
            (p) => new Vector2(cx + (p.x - cx) * sx, cy + (p.y - cy) * sy),
          );
        };

        // Determine inner floor cut at uFloor in [0.05, 0.45].
        const spanLen = Math.max(
          1e-4,
          Math.abs(ringOffsets[G] - ringOffsets[0]),
        );
        const uFloor = Math.max(0.05, Math.min(0.45, wallThickness / spanLen));
        const gFloat = uFloor * G;
        const gIdx = Math.min(G - 1, Math.floor(gFloat));
        const gFrac = gFloat - gIdx;
        const floorOuter = rings2D[gIdx].map(
          (p, j) =>
            new Vector2(
              p.x + (rings2D[gIdx + 1][j].x - p.x) * gFrac,
              p.y + (rings2D[gIdx + 1][j].y - p.y) * gFrac,
            ),
        );
        const fA = frames3D[gIdx];
        const fB = frames3D[gIdx + 1];
        const floorFrame: SpineFrame3D = {
          p: fA.p.clone().lerp(fB.p, gFrac),
          t: fA.t.clone().lerp(fB.t, gFrac).normalize(),
          rx: fA.rx.clone().lerp(fB.rx, gFrac).normalize(),
          ry: fA.ry.clone().lerp(fB.ry, gFrac).normalize(),
          u: fA.u + (fB.u - fA.u) * gFrac,
        };

        const innerRings: Vec2Like[][] = [makeInnerRing(floorOuter)];
        const innerFrames: SpineFrame3D[] = [floorFrame];
        for (let g = gIdx + 1; g <= G; g++) {
          innerRings.push(makeInnerRing(rings2D[g]));
          innerFrames.push(frames3D[g]);
        }

        // Top rim annulus at g = G connecting outer ring rings2D[G] to innerRings[last].
        const topOut = rings2D[G];
        const topIn = innerRings[innerRings.length - 1];
        const topFr = frames3D[G];
        for (let i = 0; i < M; i++) {
          const j = (i + 1) % M;
          const qb = positions.length / 3;
          const u0 = i / M;
          const u1 = (i + 1) / M;
          for (const [v, uu, vv] of [
            [topOut[i], u0, 1],
            [topOut[j], u1, 1],
            [topIn[j], u1, 0],
            [topIn[i], u0, 0],
          ] as const) {
            const pt = evalFrame3D(topFr, v.x, v.y);
            positions.push(pt[0], pt[1], pt[2]);
            normals.push(topFr.t.x, topFr.t.y, topFr.t.z);
            uvs.push(uu, vv);
          }
          indices.push(qb, qb + 1, qb + 2, qb, qb + 2, qb + 3);
        }

        // Inner cavity wall and upward-facing inner floor cap.
        emitFramedWallStrip(
          innerRings,
          innerFrames,
          true,
          positions,
          normals,
          uvs,
          indices,
        );
        emitLoftCap(innerRings[0], innerFrames[0], 1);
      } else if (wantCaps) {
        emitLoftCap(rings2D[0], frames3D[0], -1);
        if (!openTop) {
          emitLoftCap(rings2D[G], frames3D[G], 1);
        }
      }
    }

    setGeoBuffers(targetGeo, positions, normals, uvs, indices);
  }

  class LoftGeometry extends BufferGeometry {
    constructor(
      // tslint:disable-next-line:no-any Array of profiles/stations or LoftGeometryOptions.
      profilesOrOptions?: any,
      options: LoftGeometryOptions = {},
    ) {
      super();
      if (Array.isArray(profilesOrOptions)) {
        buildLoftBufferGeometry(
          this,
          profilesOrOptions,
          options && typeof options === 'object' ? options : {},
        );
      } else if (profilesOrOptions && typeof profilesOrOptions === 'object') {
        const opts = profilesOrOptions as LoftGeometryOptions;
        buildLoftBufferGeometry(this, opts.profiles, opts);
      } else {
        buildLoftBufferGeometry(this, [], options);
      }
    }
  }

  class ExtrudeGeometry extends BufferGeometry {
    constructor(
      shapes: Shape | Shape[] = new Shape(),
      options: ExtrudeGeometryOptions = {},
    ) {
      super();
      const shapeList = Array.isArray(shapes) ? shapes : [shapes];
      if (options && options.extrudePath != null) {
        buildSweepBufferGeometry(this, shapeList, options.extrudePath, {
          steps: options.steps ?? 64,
          curveSegments: options.curveSegments,
          twist: options.twist,
          scale: options.scale,
          closed: options.closed,
          caps: options.caps,
          up: options.up,
        });
        return;
      }
      const curveSegments = Math.max(
        1,
        Math.min(64, Math.floor(num(options.curveSegments, 12))),
      );
      const depth = num(options.depth ?? options.amount, 1);
      const steps = Math.max(
        1,
        Math.min(32, Math.floor(num(options.steps, 1))),
      );
      const bevelEnabled = Boolean(options.bevelEnabled ?? false);
      const bevelThickness = bevelEnabled
        ? Math.max(0, num(options.bevelThickness, 0.06))
        : 0;
      const bevelSize = bevelEnabled
        ? Math.max(0, num(options.bevelSize, bevelThickness * 0.8))
        : 0;
      const bevelOffset = bevelEnabled ? num(options.bevelOffset, 0) : 0;
      const bevelSegments = bevelEnabled
        ? Math.max(1, Math.min(8, Math.floor(num(options.bevelSegments, 2))))
        : 0;

      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (const shape of shapeList) {
        if (!(shape instanceof Path)) continue;
        const extracted = extractShapePoints(shape, curveSegments);
        if (extracted.shape.length < 3) continue;

        const outer = extracted.shape.slice();
        if (signedArea2D(outer) < 0) outer.reverse();
        const holes: Vec2Like[][] = [];
        for (const h of extracted.holes) {
          if (h.length < 3) continue;
          const hc = h.slice();
          if (signedArea2D(hc) > 0) hc.reverse();
          holes.push(hc);
        }

        const {mergedIndices, allVertices} = mergeHolesIntoContour(
          outer,
          holes,
        );
        const capTris = triangulatePolygonIndices(mergedIndices, allVertices);

        const allRings: Vec2Like[] = [outer, ...holes];
        const vertexNormals2D: Vec2Like[] = [];
        for (const ring of allRings) {
          const ringNorms = computeContourOffsetNormals(ring);
          for (const rn of ringNorms) {
            vertexNormals2D.push(rn);
          }
        }

        const [minX, minY, spanX, spanY] = bounds2D(allVertices);

        // 1. Back cap (-Z) and 2. Front cap (+Z)
        for (const [zCap, nz] of [
          [-bevelThickness, -1],
          [depth + bevelThickness, 1],
        ]) {
          const base = positions.length / 3;
          for (let i = 0; i < allVertices.length; i++) {
            const v = allVertices[i];
            const n2 = vertexNormals2D[i] ?? new Vector2(0, 0);
            const vx = v.x + n2.x * bevelOffset;
            const vy = v.y + n2.y * bevelOffset;
            positions.push(vx, vy, zCap);
            normals.push(0, 0, nz);
            uvs.push((vx - minX) / spanX, (vy - minY) / spanY);
          }
          for (const [a, b, c] of capTris) {
            indices.push(
              base + a,
              base + (nz < 0 ? c : b),
              base + (nz < 0 ? b : c),
            );
          }
        }

        // 3. Z-layer profile (back bevel -> body steps -> front bevel)
        const layers: Array<{z: number; expand: number}> = [];
        if (bevelEnabled && bevelSegments > 0) {
          for (let s = 0; s < bevelSegments; s++) {
            const t = s / bevelSegments;
            const angle = (t * Math.PI) / 2;
            layers.push({
              z: -bevelThickness * Math.cos(angle),
              expand: bevelOffset + bevelSize * Math.sin(angle),
            });
          }
        }
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          layers.push({
            z: t * depth,
            expand: bevelOffset + bevelSize,
          });
        }
        if (bevelEnabled && bevelSegments > 0) {
          for (let s = 1; s <= bevelSegments; s++) {
            const t = s / bevelSegments;
            const angle = (t * Math.PI) / 2;
            layers.push({
              z: depth + bevelThickness * Math.sin(angle),
              expand: bevelOffset + bevelSize * Math.cos(angle),
            });
          }
        }

        // 4. Side walls for outer contour and each hole contour
        let globalRingOffset = 0;
        for (const ring of allRings) {
          const rLen = ring.length;
          for (let l = 0; l < layers.length - 1; l++) {
            const l0 = layers[l];
            const l1 = layers[l + 1];
            for (let i = 0; i < rLen; i++) {
              const j = (i + 1) % rLen;
              const v0 = ring[i];
              const v1 = ring[j];
              const n0 = vertexNormals2D[globalRingOffset + i];
              const n1 = vertexNormals2D[globalRingOffset + j];

              const p00x = v0.x + n0.x * l0.expand;
              const p00y = v0.y + n0.y * l0.expand;
              const p10x = v1.x + n1.x * l0.expand;
              const p10y = v1.y + n1.y * l0.expand;
              const p11x = v1.x + n1.x * l1.expand;
              const p11y = v1.y + n1.y * l1.expand;
              const p01x = v0.x + n0.x * l1.expand;
              const p01y = v0.y + n0.y * l1.expand;

              const ux = p10x - p00x;
              const uy = p10y - p00y;
              const vx = p01x - p00x;
              const vy = p01y - p00y;
              const vz = l1.z - l0.z;
              let nx = uy * vz;
              let ny = -ux * vz;
              let nz = ux * vy - uy * vx;
              const nLen = Math.hypot(nx, ny, nz) || 1;
              nx /= nLen;
              ny /= nLen;
              nz /= nLen;

              const quadBase = positions.length / 3;
              positions.push(
                p00x,
                p00y,
                l0.z,
                p10x,
                p10y,
                l0.z,
                p11x,
                p11y,
                l1.z,
                p01x,
                p01y,
                l1.z,
              );
              normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
              const u0 = i / rLen;
              const u1 = (i + 1) / rLen;
              const v0uv = l / (layers.length - 1);
              const v1uv = (l + 1) / (layers.length - 1);
              uvs.push(u0, v0uv, u1, v0uv, u1, v1uv, u0, v1uv);
              indices.push(
                quadBase,
                quadBase + 1,
                quadBase + 2,
                quadBase,
                quadBase + 2,
                quadBase + 3,
              );
            }
          }
          globalRingOffset += rLen;
        }
      }

      setGeoBuffers(this, positions, normals, uvs, indices);
    }
  }

  interface CSGVertex {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    u: number;
    v: number;
  }

  interface CSGPolygon {
    vertices: CSGVertex[];
    nx: number;
    ny: number;
    nz: number;
    w: number;
  }

  function csgCloneVertex(v: CSGVertex): CSGVertex {
    return {
      x: v.x,
      y: v.y,
      z: v.z,
      nx: v.nx,
      ny: v.ny,
      nz: v.nz,
      u: v.u,
      v: v.v,
    };
  }

  function csgFlipVertex(v: CSGVertex): CSGVertex {
    return {
      x: v.x,
      y: v.y,
      z: v.z,
      nx: -v.nx,
      ny: -v.ny,
      nz: -v.nz,
      u: v.u,
      v: v.v,
    };
  }

  function csgLerpVertex(a: CSGVertex, b: CSGVertex, t: number): CSGVertex {
    const nx = a.nx + (b.nx - a.nx) * t;
    const ny = a.ny + (b.ny - a.ny) * t;
    const nz = a.nz + (b.nz - a.nz) * t;
    const len = Math.hypot(nx, ny, nz) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      nx: nx / len,
      ny: ny / len,
      nz: nz / len,
      u: a.u + (b.u - a.u) * t,
      v: a.v + (b.v - a.v) * t,
    };
  }

  function csgMakePolygon(vertices: CSGVertex[]): CSGPolygon | null {
    if (vertices.length < 3) return null;
    const a = vertices[0];
    const b = vertices[1];
    const c = vertices[2];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return null;
    nx /= len;
    ny /= len;
    nz /= len;
    const w = nx * a.x + ny * a.y + nz * a.z;
    return {vertices, nx, ny, nz, w};
  }

  function csgFlipPolygon(p: CSGPolygon): void {
    p.vertices.reverse();
    for (let i = 0; i < p.vertices.length; i++) {
      p.vertices[i] = csgFlipVertex(p.vertices[i]);
    }
    p.nx = -p.nx;
    p.ny = -p.ny;
    p.nz = -p.nz;
    p.w = -p.w;
  }

  const csgEps = 1e-5;
  const csgCoplanar = 0;
  const csgFront = 1;
  const csgBack = 2;
  const csgSpanning = 3;

  function csgSplitPolygon(
    planeNx: number,
    planeNy: number,
    planeNz: number,
    planeW: number,
    polygon: CSGPolygon,
    coplanarFront: CSGPolygon[],
    coplanarBack: CSGPolygon[],
    front: CSGPolygon[],
    back: CSGPolygon[],
  ): void {
    let polygonType = 0;
    const types: number[] = [];
    for (let i = 0; i < polygon.vertices.length; i++) {
      const v = polygon.vertices[i];
      const t = planeNx * v.x + planeNy * v.y + planeNz * v.z - planeW;
      const type = t < -csgEps ? csgBack : t > csgEps ? csgFront : csgCoplanar;
      polygonType |= type;
      types.push(type);
    }

    switch (polygonType) {
      case csgCoplanar: {
        const dot =
          planeNx * polygon.nx + planeNy * polygon.ny + planeNz * polygon.nz;
        if (dot > 0) coplanarFront.push(polygon);
        else coplanarBack.push(polygon);
        break;
      }
      case csgFront:
        front.push(polygon);
        break;
      case csgBack:
        back.push(polygon);
        break;
      case csgSpanning: {
        const f: CSGVertex[] = [];
        const b: CSGVertex[] = [];
        const n = polygon.vertices.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ti = types[i];
          const tj = types[j];
          const vi = polygon.vertices[i];
          const vj = polygon.vertices[j];
          if (ti !== csgBack) f.push(vi);
          if (ti !== csgFront) {
            b.push(ti !== csgBack ? csgCloneVertex(vi) : vi);
          }
          if ((ti | tj) === csgSpanning) {
            const dx = vj.x - vi.x;
            const dy = vj.y - vi.y;
            const dz = vj.z - vi.z;
            const denom = planeNx * dx + planeNy * dy + planeNz * dz;
            const t =
              Math.abs(denom) > 1e-12
                ? (planeW -
                    (planeNx * vi.x + planeNy * vi.y + planeNz * vi.z)) /
                  denom
                : 0.5;
            const vMid = csgLerpVertex(vi, vj, Math.max(0, Math.min(1, t)));
            f.push(vMid);
            b.push(csgCloneVertex(vMid));
          }
        }
        // Fragments of a convex polygon stay on the parent plane; recomputing
        // it from 3 possibly near-collinear vertices could drop the fragment.
        const {nx, ny, nz, w} = polygon;
        if (f.length >= 3) front.push({vertices: f, nx, ny, nz, w});
        if (b.length >= 3) back.push({vertices: b, nx, ny, nz, w});
        break;
      }
      default:
        break;
    }
  }

  class CSGNode {
    declare nx: number;
    declare ny: number;
    declare nz: number;
    declare w: number;
    declare hasPlane: boolean;
    declare polygons: CSGPolygon[];
    declare front: CSGNode | null;
    declare back: CSGNode | null;

    constructor(polygons?: CSGPolygon[], depth = 0) {
      this.nx = 0;
      this.ny = 0;
      this.nz = 0;
      this.w = 0;
      this.hasPlane = false;
      this.polygons = [];
      this.front = null;
      this.back = null;
      if (polygons && polygons.length > 0) {
        this.build(polygons, depth);
      }
    }

    invert(): void {
      for (let i = 0; i < this.polygons.length; i++) {
        csgFlipPolygon(this.polygons[i]);
      }
      this.nx = -this.nx;
      this.ny = -this.ny;
      this.nz = -this.nz;
      this.w = -this.w;
      if (this.front) this.front.invert();
      if (this.back) this.back.invert();
      const temp = this.front;
      this.front = this.back;
      this.back = temp;
    }

    clipPolygons(polygons: CSGPolygon[], depth = 0): CSGPolygon[] {
      if (!this.hasPlane || polygons.length === 0) {
        return polygons.slice();
      }
      // Never return unclipped polygons at the depth cap: that silently keeps
      // fragments which should have been removed.
      if (depth >= maxBspDepth) {
        throw new RangeError(
          `SecurityError: CSG BSP depth exceeds MAX_BSP_DEPTH (${maxBspDepth})`,
        );
      }
      let front: CSGPolygon[] = [];
      let back: CSGPolygon[] = [];
      for (let i = 0; i < polygons.length; i++) {
        csgSplitPolygon(
          this.nx,
          this.ny,
          this.nz,
          this.w,
          polygons[i],
          front,
          back,
          front,
          back,
        );
      }
      if (this.front && front.length > 0) {
        front = this.front.clipPolygons(front, depth + 1);
      }
      if (this.back) {
        back = back.length > 0 ? this.back.clipPolygons(back, depth + 1) : [];
      } else {
        back = [];
      }
      return front.concat(back);
    }

    clipTo(bsp: CSGNode, depth = 0): void {
      if (this.polygons.length > 0) {
        this.polygons = bsp.clipPolygons(this.polygons, 0);
      }
      if (depth < maxBspDepth) {
        if (this.front) this.front.clipTo(bsp, depth + 1);
        if (this.back) this.back.clipTo(bsp, depth + 1);
      }
    }

    allPolygons(out: CSGPolygon[] = []): CSGPolygon[] {
      for (let i = 0; i < this.polygons.length; i++) {
        out.push(this.polygons[i]);
      }
      if (this.front) this.front.allPolygons(out);
      if (this.back) this.back.allPolygons(out);
      return out;
    }

    build(polygons: CSGPolygon[], depth = 0): void {
      if (!polygons.length) return;
      if (!this.hasPlane) {
        const splitPoly = polygons[polygons.length >> 1];
        this.nx = splitPoly.nx;
        this.ny = splitPoly.ny;
        this.nz = splitPoly.nz;
        this.w = splitPoly.w;
        this.hasPlane = true;
      }
      // Convex meshes build a chain as deep as their plane count. Dumping the
      // remainder into one node here would give wrong booleans, so fail loudly.
      if (depth >= maxBspDepth) {
        throw new RangeError(
          `SecurityError: CSG BSP depth exceeds MAX_BSP_DEPTH (${maxBspDepth})`,
        );
      }
      const front: CSGPolygon[] = [];
      const back: CSGPolygon[] = [];
      for (let i = 0; i < polygons.length; i++) {
        csgSplitPolygon(
          this.nx,
          this.ny,
          this.nz,
          this.w,
          polygons[i],
          this.polygons,
          this.polygons,
          front,
          back,
        );
      }
      if (front.length > 0) {
        if (!this.front) this.front = new CSGNode();
        this.front.build(front, depth + 1);
      }
      if (back.length > 0) {
        if (!this.back) this.back = new CSGNode();
        this.back.build(back, depth + 1);
      }
    }
  }

  // tslint:disable-next-line:no-any Dynamic BufferGeometry and Matrix4 from threeNs.
  function geometryToCSGPolygons(geo: any, matrix: any): CSGPolygon[] {
    if (!matrix && geo._csgPolygons) return geo._csgPolygons;
    const pos = geo.attributes.position;
    if (!pos || pos.count === 0) return [];
    const norm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx
      ? Math.floor(idx.length / 3)
      : Math.floor(pos.count / 3);
    if (triCount > maxCsgTriangles) {
      throw new RangeError(
        `SecurityError: CSG input triangle count (${triCount}) exceeds MAX_CSG_TRIANGLES (${maxCsgTriangles})`,
      );
    }

    const m = matrix ? matrix.elements : null;
    const flipWinding = m
      ? m[0] * (m[5] * m[10] - m[9] * m[6]) -
          m[4] * (m[1] * m[10] - m[9] * m[2]) +
          m[8] * (m[1] * m[6] - m[5] * m[2]) <
        0
      : false;
    // Normals transform by the normal matrix (inverse transpose of the upper
    // 3x3, column-major), not by the plain matrix.
    const nm: ArrayLike<number> | null = m
      ? new Matrix3().getNormalMatrix(matrix).elements
      : null;
    const readVert = (vi: number): CSGVertex => {
      let x = pos.getX(vi);
      let y = pos.getY(vi);
      let z = pos.getZ(vi);
      // Without a normal attribute, NaN marks "use the face normal" on output.
      let nx = norm ? norm.getX(vi) : NaN;
      let ny = norm ? norm.getY(vi) : NaN;
      let nz = norm ? norm.getZ(vi) : NaN;
      if (m && nm) {
        const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
        const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
        x = tx;
        y = ty;
        z = tz;
        const tnx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
        const tny = nm[1] * nx + nm[4] * ny + nm[7] * nz;
        const tnz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        const nLen = Math.hypot(tnx, tny, tnz) || 1;
        nx = tnx / nLen;
        ny = tny / nLen;
        nz = tnz / nLen;
      }
      const u = uv ? uv.getX(vi) : 0;
      const v = uv ? uv.getY(vi) : 0;
      return {x, y, z, nx, ny, nz, u, v};
    };

    const polys: CSGPolygon[] = [];
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const poly = csgMakePolygon(
        flipWinding
          ? [readVert(i0), readVert(i2), readVert(i1)]
          : [readVert(i0), readVert(i1), readVert(i2)],
      );
      if (poly) polys.push(poly);
    }
    return polys;
  }

  // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
  function csgPolygonsToGeometry(polys: CSGPolygon[]): any {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (const poly of polys) {
      const verts = poly.vertices;
      if (verts.length < 3) continue;
      const base = positions.length / 3;
      for (const v of verts) {
        positions.push(v.x, v.y, v.z);
        // Keep interpolated vertex normals (smooth surfaces stay smooth); fall
        // back to the polygon's plane normal when missing or degenerate.
        const hasN =
          Number.isFinite(v.nx) &&
          v.nx * v.nx + v.ny * v.ny + v.nz * v.nz > 0.5;
        if (hasN) normals.push(v.nx, v.ny, v.nz);
        else normals.push(poly.nx, poly.ny, poly.nz);
        uvs.push(v.u, v.v);
      }
      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(base, base + i, base + i + 1);
      }
    }

    const out = setGeoBuffers(
      new BufferGeometry(),
      positions,
      normals,
      uvs,
      indices,
    );
    // tslint:disable-next-line:no-any Cache polygons for chained CSG calls.
    (out as any)._csgPolygons = polys;
    return out;
  }

  function evaluateCSGBoolean(
    polysA: CSGPolygon[],
    polysB: CSGPolygon[],
    op: 'subtract' | 'union' | 'intersect',
  ): CSGPolygon[] {
    if (polysA.length + polysB.length > maxCsgTriangles) {
      throw new RangeError(
        `SecurityError: Combined CSG triangle count (${polysA.length + polysB.length}) exceeds MAX_CSG_TRIANGLES (${maxCsgTriangles})`,
      );
    }
    if (polysA.length === 0) {
      return op === 'union' ? polysB : [];
    }
    if (polysB.length === 0) {
      return op === 'intersect' ? [] : polysA;
    }

    let bMinX = Infinity,
      bMinY = Infinity,
      bMinZ = Infinity;
    let bMaxX = -Infinity,
      bMaxY = -Infinity,
      bMaxZ = -Infinity;
    for (let i = 0; i < polysB.length; i++) {
      const vs = polysB[i].vertices;
      for (let j = 0; j < vs.length; j++) {
        const v = vs[j];
        if (v.x < bMinX) bMinX = v.x;
        if (v.y < bMinY) bMinY = v.y;
        if (v.z < bMinZ) bMinZ = v.z;
        if (v.x > bMaxX) bMaxX = v.x;
        if (v.y > bMaxY) bMaxY = v.y;
        if (v.z > bMaxZ) bMaxZ = v.z;
      }
    }
    bMinX -= 1e-4;
    bMinY -= 1e-4;
    bMinZ -= 1e-4;
    bMaxX += 1e-4;
    bMaxY += 1e-4;
    bMaxZ += 1e-4;
    const aOverlap: CSGPolygon[] = [];
    const aDisjoint: CSGPolygon[] = [];
    for (let i = 0; i < polysA.length; i++) {
      const p = polysA[i];
      const vs = p.vertices;
      let pMinX = Infinity,
        pMinY = Infinity,
        pMinZ = Infinity;
      let pMaxX = -Infinity,
        pMaxY = -Infinity,
        pMaxZ = -Infinity;
      for (let j = 0; j < vs.length; j++) {
        const v = vs[j];
        if (v.x < pMinX) pMinX = v.x;
        if (v.y < pMinY) pMinY = v.y;
        if (v.z < pMinZ) pMinZ = v.z;
        if (v.x > pMaxX) pMaxX = v.x;
        if (v.y > pMaxY) pMaxY = v.y;
        if (v.z > pMaxZ) pMaxZ = v.z;
      }
      if (
        pMaxX < bMinX ||
        pMinX > bMaxX ||
        pMaxY < bMinY ||
        pMinY > bMaxY ||
        pMaxZ < bMinZ ||
        pMinZ > bMaxZ
      ) {
        aDisjoint.push(p);
      } else {
        aOverlap.push(p);
      }
    }
    if (aOverlap.length === 0) {
      return op === 'union'
        ? polysA.concat(polysB)
        : op === 'subtract'
          ? polysA
          : [];
    }

    const a = new CSGNode(aOverlap);
    const b = new CSGNode(polysB);

    if (op === 'union') {
      a.clipTo(b);
      b.clipTo(a);
      b.invert();
      b.clipTo(a);
      b.invert();
      a.build(b.allPolygons());
      return aDisjoint.concat(a.allPolygons());
    } else if (op === 'subtract') {
      a.invert();
      a.clipTo(b);
      b.clipTo(a);
      b.invert();
      b.clipTo(a);
      b.invert();
      a.build(b.allPolygons());
      a.invert();
      return aDisjoint.concat(a.allPolygons());
    } else {
      a.invert();
      b.clipTo(a);
      b.invert();
      a.clipTo(b);
      b.clipTo(a);
      a.build(b.allPolygons());
      a.invert();
      return a.allPolygons();
    }
  }

  function csgToGeometry(
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
    geomA: any,
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
    geomB: any,
    op: 'subtract' | 'union' | 'intersect',
    // tslint:disable-next-line:no-any Dynamic Matrix4 from threeNs.
    matrixA: any = null,
    // tslint:disable-next-line:no-any Dynamic Matrix4 from threeNs.
    matrixB: any = null,
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
  ): any {
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_csg_boolean__;
      if (
        typeof nativeFn === 'function' &&
        geomA?.attributes?.position?.array &&
        geomB?.attributes?.position?.array
      ) {
        const opCode = op === 'subtract' ? 0 : op === 'union' ? 1 : 2;
        const native = nativeFn(
          geomA.attributes.position.array,
          geomA.attributes.normal ? geomA.attributes.normal.array : null,
          geomA.attributes.uv ? geomA.attributes.uv.array : null,
          geomA.index ? geomA.index.array : null,
          matrixA ? matrixA.elements : null,
          geomB.attributes.position.array,
          geomB.attributes.normal ? geomB.attributes.normal.array : null,
          geomB.attributes.uv ? geomB.attributes.uv.array : null,
          geomB.index ? geomB.index.array : null,
          matrixB ? matrixB.elements : null,
          opCode,
        );
        if (native) {
          return setGeoBuffers(
            new BufferGeometry(),
            native.positions,
            native.normals,
            native.uvs,
            native.indices,
          );
        }
      }
    }
    const polysA = geometryToCSGPolygons(geomA, matrixA);
    const polysB = geometryToCSGPolygons(geomB, matrixB);
    return csgPolygonsToGeometry(evaluateCSGBoolean(polysA, polysB, op));
  }

  function runCSGMeshOp(
    // tslint:disable-next-line:no-any Dynamic Mesh or BufferGeometry from threeNs.
    targetA: any,
    // tslint:disable-next-line:no-any Dynamic Mesh or BufferGeometry from threeNs.
    targetB: any,
    op: 'subtract' | 'union' | 'intersect',
    // tslint:disable-next-line:no-any Dynamic Mesh from threeNs.
  ): any {
    const isMeshA = targetA instanceof Mesh || Boolean(targetA?.isMesh);
    const isMeshB = targetB instanceof Mesh || Boolean(targetB?.isMesh);
    const geomA = isMeshA ? targetA.geometry : targetA;
    const geomB = isMeshB ? targetB.geometry : targetB;
    // tslint:disable-next-line:no-any Dynamic Matrix4 from threeNs.
    let relMatrixB: any = null;
    if (isMeshB) {
      targetB.updateMatrix();
      if (isMeshA) {
        targetA.updateMatrix();
        const invScale = new Matrix4().makeScale(
          1 / (targetA.scale.x || 1),
          1 / (targetA.scale.y || 1),
          1 / (targetA.scale.z || 1),
        );
        const qLen =
          Math.hypot(
            targetA.quaternion.x,
            targetA.quaternion.y,
            targetA.quaternion.z,
            targetA.quaternion.w,
          ) || 1;
        const invRot = new Matrix4().compose(
          new Vector3(0, 0, 0),
          new Quaternion(
            -targetA.quaternion.x / qLen,
            -targetA.quaternion.y / qLen,
            -targetA.quaternion.z / qLen,
            targetA.quaternion.w / qLen,
          ),
          new Vector3(1, 1, 1),
        );
        const invTrans = new Matrix4().makeTranslation(
          -targetA.position.x,
          -targetA.position.y,
          -targetA.position.z,
        );
        relMatrixB = invScale
          .multiply(invRot)
          .multiply(invTrans)
          .multiply(targetB.matrix);
      } else {
        relMatrixB = targetB.matrix;
      }
    }
    const resultGeo = csgToGeometry(geomA, geomB, op, null, relMatrixB);
    const mat = isMeshA ? targetA.material : new MeshStandardMaterial();
    const out = new Mesh(resultGeo, mat);
    if (isMeshA) {
      out.position.copy(targetA.position);
      out.quaternion.copy(targetA.quaternion);
      out.scale.copy(targetA.scale);
      out.name = targetA.name;
    }
    return out;
  }

  const CSG = {
    toGeometry: csgToGeometry,
    // tslint:disable-next-line:no-any Dynamic Mesh / BufferGeometry.
    subtract(meshA: any, meshB: any): any {
      return runCSGMeshOp(meshA, meshB, 'subtract');
    },
    // tslint:disable-next-line:no-any Dynamic Mesh / BufferGeometry.
    union(meshA: any, meshB: any): any {
      return runCSGMeshOp(meshA, meshB, 'union');
    },
    // tslint:disable-next-line:no-any Dynamic Mesh / BufferGeometry.
    intersect(meshA: any, meshB: any): any {
      return runCSGMeshOp(meshA, meshB, 'intersect');
    },
  };

  const vectorGlyphStrokes: Record<string, number[][][]> = {
    '0': [
      [
        [0.15, 0],
        [0.85, 0],
        [0.85, 1],
        [0.15, 1],
        [0.15, 0],
      ],
    ],
    '1': [
      [
        [0.3, 0.8],
        [0.5, 1],
        [0.5, 0],
      ],
      [
        [0.2, 0],
        [0.8, 0],
      ],
    ],
    '2': [
      [
        [0.15, 0.8],
        [0.3, 1],
        [0.7, 1],
        [0.85, 0.8],
        [0.85, 0.55],
        [0.15, 0],
        [0.85, 0],
      ],
    ],
    '3': [
      [
        [0.15, 0.85],
        [0.3, 1],
        [0.75, 1],
        [0.85, 0.75],
        [0.5, 0.5],
        [0.85, 0.25],
        [0.75, 0],
        [0.3, 0],
        [0.15, 0.15],
      ],
    ],
    '4': [
      [
        [0.7, 0],
        [0.7, 1],
        [0.15, 0.35],
        [0.9, 0.35],
      ],
    ],
    '5': [
      [
        [0.85, 1],
        [0.2, 1],
        [0.15, 0.55],
        [0.75, 0.55],
        [0.85, 0.3],
        [0.75, 0],
        [0.2, 0],
      ],
    ],
    '6': [
      [
        [0.8, 0.9],
        [0.5, 1],
        [0.15, 0.7],
        [0.15, 0.15],
        [0.5, 0],
        [0.85, 0.2],
        [0.85, 0.45],
        [0.5, 0.55],
        [0.15, 0.45],
      ],
    ],
    '7': [
      [
        [0.15, 1],
        [0.85, 1],
        [0.35, 0],
      ],
    ],
    '8': [
      [
        [0.2, 0.5],
        [0.15, 0.75],
        [0.3, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.8, 0.5],
        [0.2, 0.5],
        [0.15, 0.2],
        [0.3, 0],
        [0.7, 0],
        [0.85, 0.2],
        [0.8, 0.5],
      ],
    ],
    '9': [
      [
        [0.85, 0.55],
        [0.5, 0.45],
        [0.15, 0.55],
        [0.15, 0.85],
        [0.5, 1],
        [0.85, 0.85],
        [0.85, 0.2],
        [0.5, 0],
        [0.2, 0.1],
      ],
    ],
    'A': [
      [
        [0.1, 0],
        [0.5, 1],
        [0.9, 0],
      ],
      [
        [0.25, 0.35],
        [0.75, 0.35],
      ],
    ],
    'B': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.7, 0.5],
        [0.15, 0.5],
      ],
      [
        [0.7, 0.5],
        [0.85, 0.25],
        [0.7, 0],
        [0.15, 0],
      ],
    ],
    'C': [
      [
        [0.85, 0.8],
        [0.65, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
        [0.65, 0],
        [0.85, 0.2],
      ],
    ],
    'D': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.65, 1],
        [0.85, 0.75],
        [0.85, 0.25],
        [0.65, 0],
        [0.15, 0],
      ],
    ],
    'E': [
      [
        [0.85, 1],
        [0.15, 1],
        [0.15, 0],
        [0.85, 0],
      ],
      [
        [0.15, 0.5],
        [0.7, 0.5],
      ],
    ],
    'F': [
      [
        [0.85, 1],
        [0.15, 1],
        [0.15, 0],
      ],
      [
        [0.15, 0.5],
        [0.7, 0.5],
      ],
    ],
    'G': [
      [
        [0.85, 0.8],
        [0.65, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
        [0.85, 0],
        [0.85, 0.45],
        [0.55, 0.45],
      ],
    ],
    'H': [
      [
        [0.15, 0],
        [0.15, 1],
      ],
      [
        [0.85, 0],
        [0.85, 1],
      ],
      [
        [0.15, 0.5],
        [0.85, 0.5],
      ],
    ],
    'I': [
      [
        [0.25, 1],
        [0.75, 1],
      ],
      [
        [0.5, 1],
        [0.5, 0],
      ],
      [
        [0.25, 0],
        [0.75, 0],
      ],
    ],
    'J': [
      [
        [0.8, 1],
        [0.8, 0.25],
        [0.6, 0],
        [0.3, 0],
        [0.15, 0.25],
      ],
    ],
    'K': [
      [
        [0.15, 0],
        [0.15, 1],
      ],
      [
        [0.85, 1],
        [0.15, 0.45],
        [0.85, 0],
      ],
    ],
    'L': [
      [
        [0.15, 1],
        [0.15, 0],
        [0.85, 0],
      ],
    ],
    'M': [
      [
        [0.1, 0],
        [0.1, 1],
        [0.5, 0.35],
        [0.9, 1],
        [0.9, 0],
      ],
    ],
    'N': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.85, 0],
        [0.85, 1],
      ],
    ],
    'O': [
      [
        [0.3, 0],
        [0.7, 0],
        [0.85, 0.25],
        [0.85, 0.75],
        [0.7, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
      ],
    ],
    'P': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.7, 0.5],
        [0.15, 0.5],
      ],
    ],
    'Q': [
      [
        [0.3, 0],
        [0.7, 0],
        [0.85, 0.25],
        [0.85, 0.75],
        [0.7, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
      ],
      [
        [0.55, 0.3],
        [0.9, -0.05],
      ],
    ],
    'R': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.7, 0.5],
        [0.15, 0.5],
      ],
      [
        [0.55, 0.5],
        [0.85, 0],
      ],
    ],
    'S': [
      [
        [0.85, 0.85],
        [0.65, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.85, 0.25],
        [0.7, 0],
        [0.3, 0],
        [0.15, 0.15],
      ],
    ],
    'T': [
      [
        [0.1, 1],
        [0.9, 1],
      ],
      [
        [0.5, 1],
        [0.5, 0],
      ],
    ],
    'U': [
      [
        [0.15, 1],
        [0.15, 0.25],
        [0.35, 0],
        [0.65, 0],
        [0.85, 0.25],
        [0.85, 1],
      ],
    ],
    'V': [
      [
        [0.1, 1],
        [0.5, 0],
        [0.9, 1],
      ],
    ],
    'W': [
      [
        [0.05, 1],
        [0.25, 0],
        [0.5, 0.65],
        [0.75, 0],
        [0.95, 1],
      ],
    ],
    'X': [
      [
        [0.15, 1],
        [0.85, 0],
      ],
      [
        [0.85, 1],
        [0.15, 0],
      ],
    ],
    'Y': [
      [
        [0.15, 1],
        [0.5, 0.5],
        [0.85, 1],
      ],
      [
        [0.5, 0.5],
        [0.5, 0],
      ],
    ],
    'Z': [
      [
        [0.15, 1],
        [0.85, 1],
        [0.15, 0],
        [0.85, 0],
      ],
    ],
    '.': [
      [
        [0.45, 0],
        [0.55, 0],
        [0.55, 0.12],
        [0.45, 0.12],
        [0.45, 0],
      ],
    ],
    ',': [
      [
        [0.5, 0.15],
        [0.4, -0.1],
      ],
    ],
    ':': [
      [
        [0.45, 0.1],
        [0.55, 0.1],
      ],
      [
        [0.45, 0.7],
        [0.55, 0.7],
      ],
    ],
    '-': [
      [
        [0.2, 0.5],
        [0.8, 0.5],
      ],
    ],
    '+': [
      [
        [0.2, 0.5],
        [0.8, 0.5],
      ],
      [
        [0.5, 0.2],
        [0.5, 0.8],
      ],
    ],
    '=': [
      [
        [0.2, 0.35],
        [0.8, 0.35],
      ],
      [
        [0.2, 0.65],
        [0.8, 0.65],
      ],
    ],
    '/': [
      [
        [0.2, 0],
        [0.8, 1],
      ],
    ],
    '!': [
      [
        [0.5, 1],
        [0.5, 0.28],
      ],
      [
        [0.5, 0.1],
        [0.5, 0],
      ],
    ],
    '?': [
      [
        [0.2, 0.8],
        [0.35, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.5, 0.45],
        [0.5, 0.28],
      ],
      [
        [0.5, 0.1],
        [0.5, 0],
      ],
    ],
    '(': [
      [
        [0.65, 1],
        [0.35, 0.65],
        [0.35, 0.35],
        [0.65, 0],
      ],
    ],
    ')': [
      [
        [0.35, 1],
        [0.65, 0.65],
        [0.65, 0.35],
        [0.35, 0],
      ],
    ],
    '%': [
      [
        [0.2, 0],
        [0.8, 1],
      ],
      [
        [0.2, 0.8],
        [0.35, 0.8],
        [0.35, 0.95],
        [0.2, 0.95],
        [0.2, 0.8],
      ],
      [
        [0.65, 0.05],
        [0.8, 0.05],
        [0.8, 0.2],
        [0.65, 0.2],
        [0.65, 0.05],
      ],
    ],
    '#': [
      [
        [0.32, 0],
        [0.32, 1],
      ],
      [
        [0.68, 0],
        [0.68, 1],
      ],
      [
        [0.12, 0.35],
        [0.88, 0.35],
      ],
      [
        [0.12, 0.65],
        [0.88, 0.65],
      ],
    ],
    '$': [
      [
        [0.8, 0.8],
        [0.6, 0.92],
        [0.3, 0.92],
        [0.18, 0.72],
        [0.82, 0.28],
        [0.7, 0.08],
        [0.4, 0.08],
        [0.2, 0.2],
      ],
      [
        [0.5, 1],
        [0.5, 0],
      ],
    ],
    '_': [
      [
        [0.1, 0],
        [0.9, 0],
      ],
    ],
    '[': [
      [
        [0.65, 1],
        [0.3, 1],
        [0.3, 0],
        [0.65, 0],
      ],
    ],
    ']': [
      [
        [0.35, 1],
        [0.7, 1],
        [0.7, 0],
        [0.35, 0],
      ],
    ],
    '<': [
      [
        [0.75, 0.85],
        [0.25, 0.5],
        [0.75, 0.15],
      ],
    ],
    '>': [
      [
        [0.25, 0.85],
        [0.75, 0.5],
        [0.25, 0.15],
      ],
    ],
    '*': [
      [
        [0.5, 0.2],
        [0.5, 0.8],
      ],
      [
        [0.2, 0.35],
        [0.8, 0.65],
      ],
      [
        [0.2, 0.65],
        [0.8, 0.35],
      ],
    ],
    '\\': [
      [
        [0.2, 1],
        [0.8, 0],
      ],
    ],
  };

  class TextGeometry extends BufferGeometry {
    constructor(text = '', options: TextGeometryOptions = {}) {
      super();
      const cleanText = String(text ?? '').slice(0, maxTextGeometryChars);
      const size = Math.max(0.005, Math.min(100, num(options.size, 0.2)));
      const bevelEnabled = Boolean(options.bevelEnabled ?? false);
      const bevelThickness = bevelEnabled
        ? Math.max(0, Math.min(2, num(options.bevelThickness, size * 0.04)))
        : 0;
      const bevelSize = bevelEnabled
        ? Math.max(0, Math.min(2, num(options.bevelSize, size * 0.03)))
        : 0;
      const depth =
        Math.max(
          0.001,
          Math.min(20, num(options.depth ?? options.height, size * 0.2)),
        ) +
        bevelThickness * 2;
      const strokeRadius = size * 0.085 + bevelSize;
      const charWidth = size * 0.68;
      const charAdvance = size * 0.82;

      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      const addBoxSegment = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        r: number,
        z0: number,
        z1: number,
      ): void => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        let ux = 1;
        let uy = 0;
        if (len > 1e-6) {
          ux = dx / len;
          uy = dy / len;
        }
        const px = -uy * r;
        const py = ux * r;
        const ex = ux * r * 0.6;
        const ey = uy * r * 0.6;

        const ax = x0 - ex + px;
        const ay = y0 - ey + py;
        const bx = x0 - ex - px;
        const by = y0 - ey - py;
        const cx = x1 + ex - px;
        const cy = y1 + ey - py;
        const dxp = x1 + ex + px;
        const dyp = y1 + ey + py;

        const pushQuad = (
          p0: [number, number, number],
          p1: [number, number, number],
          p2: [number, number, number],
          p3: [number, number, number],
          nx: number,
          ny: number,
          nz: number,
        ): void => {
          const base = positions.length / 3;
          positions.push(
            p0[0],
            p0[1],
            p0[2],
            p1[0],
            p1[1],
            p1[2],
            p2[0],
            p2[1],
            p2[2],
            p3[0],
            p3[1],
            p3[2],
          );
          normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
          uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };

        pushQuad(
          [ax, ay, z1],
          [bx, by, z1],
          [cx, cy, z1],
          [dxp, dyp, z1],
          0,
          0,
          1,
        );
        pushQuad(
          [bx, by, z0],
          [ax, ay, z0],
          [dxp, dyp, z0],
          [cx, cy, z0],
          0,
          0,
          -1,
        );
        pushQuad(
          [ax, ay, z0],
          [bx, by, z0],
          [bx, by, z1],
          [ax, ay, z1],
          -ux,
          -uy,
          0,
        );
        pushQuad(
          [cx, cy, z0],
          [dxp, dyp, z0],
          [dxp, dyp, z1],
          [cx, cy, z1],
          ux,
          uy,
          0,
        );
        pushQuad(
          [bx, by, z0],
          [cx, cy, z0],
          [cx, cy, z1],
          [bx, by, z1],
          uy,
          -ux,
          0,
        );
        pushQuad(
          [dxp, dyp, z0],
          [ax, ay, z0],
          [ax, ay, z1],
          [dxp, dyp, z1],
          -uy,
          ux,
          0,
        );
      };

      let cursorX = 0;
      let cursorY = 0;
      for (let i = 0; i < cleanText.length; i++) {
        const ch = cleanText[i];
        if (ch === '\n') {
          cursorX = 0;
          cursorY -= size * 1.35;
          continue;
        }
        if (ch === ' ' || ch === '\t') {
          // A tab advances like four spaces.
          cursorX += charAdvance * (ch === ' ' ? 0.75 : 3);
          continue;
        }
        if (ch === '\r') continue;
        const upper = ch.toUpperCase();
        const isLower = ch !== upper && ch >= 'a' && ch <= 'z';
        const strokes = vectorGlyphStrokes[upper] ?? vectorGlyphStrokes['?'];
        const scaleY = isLower ? size * 0.76 : size;
        const scaleX = isLower ? charWidth * 0.88 : charWidth;

        for (const poly of strokes) {
          for (let s = 0; s < poly.length - 1; s++) {
            const p0 = poly[s];
            const p1 = poly[s + 1];
            addBoxSegment(
              cursorX + p0[0] * scaleX,
              cursorY + p0[1] * scaleY,
              cursorX + p1[0] * scaleX,
              cursorY + p1[1] * scaleY,
              strokeRadius,
              -depth * 0.5,
              depth * 0.5,
            );
          }
        }
        cursorX += isLower ? charAdvance * 0.88 : charAdvance;
      }

      setGeoBuffers(this, positions, normals, uvs, indices);

      if (options.center !== false) {
        this.center();
      } else {
        this.computeBoundingBox();
      }
    }
  }

  // tslint:disable-next-line:no-any Dynamic Object3D / Mesh node.
  function materializeDeclarativeGeometry(node: any): void {
    if (!node) return;
    const meshLike = node;
    const rawText =
      node.userData?.xr?.text ??
      node.userData?.xr?.label ??
      node.userData?.xr?.title ??
      node.userData?.xr?.caption ??
      node.userData?.xr?.spatialLabel;
    if (rawText !== undefined && rawText !== null && rawText !== false) {
      const existingPos = meshLike.geometry?.attributes?.position;
      // `_textApplied` stops a rebuild on every updateMatrixWorld when the
      // built text has no vertices (e.g. only whitespace in the first 128 chars).
      if (
        (!existingPos || existingPos.count === 0) &&
        node.userData['_textApplied'] !== true
      ) {
        let textStr = '';
        let size = 0.08;
        let depth = 0.015;
        let colorVal: string | number | undefined;
        if (typeof rawText === 'string' || typeof rawText === 'number') {
          textStr = String(rawText);
        } else if (typeof rawText === 'object') {
          const rec = rawText as Record<string, unknown>;
          textStr = String(rec['text'] ?? rec['value'] ?? '');
          if (rec['size'] !== undefined) size = Number(rec['size']) || 0.08;
          if (rec['depth'] !== undefined || rec['height'] !== undefined) {
            depth = Number(rec['depth'] ?? rec['height']) || size * 0.2;
          }
          if (
            typeof rec['color'] === 'string' ||
            typeof rec['color'] === 'number'
          ) {
            colorVal = rec['color'];
          }
        }
        if (textStr.trim().length > 0) {
          meshLike.geometry = new TextGeometry(textStr, {size, depth});
          node.userData['_textApplied'] = true;
          if (!(meshLike.material instanceof Material)) {
            meshLike.material = new MeshStandardMaterial({
              color: colorVal ?? 0xf8fafc,
            });
          } else if (
            colorVal !== undefined &&
            node.userData['_autoTextColorApplied'] !== true
          ) {
            meshLike.material.color = new Color(colorVal);
            node.userData['_autoTextColorApplied'] = true;
          }
        }
      }
    }

    const rawCsg = node.userData?.csg;
    if (
      rawCsg &&
      typeof rawCsg === 'object' &&
      node.userData['_csgApplied'] !== true &&
      meshLike.geometry instanceof BufferGeometry &&
      meshLike.geometry.attributes.position?.count > 0
    ) {
      node.userData['_csgApplied'] = true;
      const ops = Array.isArray(rawCsg) ? rawCsg : [rawCsg];
      const original = meshLike.geometry;
      for (const item of ops) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const opRaw = String(rec['op'] ?? rec['operation'] ?? 'subtract');
        const op: 'subtract' | 'union' | 'intersect' =
          opRaw === 'union' || opRaw === 'intersect' ? opRaw : 'subtract';
        const target = rec['target'] ?? rec['mesh'] ?? rec['geometry'];
        if (target instanceof Mesh || target instanceof BufferGeometry) {
          // One over-limit op must not abort the whole scene export: warn and
          // keep the current geometry.
          try {
            const res =
              op === 'union'
                ? CSG.union(meshLike, target)
                : op === 'intersect'
                  ? CSG.intersect(meshLike, target)
                  : CSG.subtract(meshLike, target);
            // Dispose intermediate results we created; the author's original
            // geometry may be shared by other meshes.
            if (meshLike.geometry !== original) meshLike.geometry.dispose?.();
            meshLike.geometry = res.geometry;
          } catch (e) {
            if (typeof console !== 'undefined') {
              console.warn('[three-live] userData.csg skipped:', e);
            }
          }
        }
      }
    }
  }

  const exportsMap = {
    Path,
    Shape,
    ShapeGeometry,
    ExtrudeGeometry,
    SweepGeometry,
    HelixCurve3,
    HelixGeometry,
    LoftGeometry,
    TextGeometry,
    CSG,
    MAX_CSG_TRIANGLES: maxCsgTriangles,
    MAX_BSP_DEPTH: maxBspDepth,
    MAX_TEXT_GEOMETRY_CHARS: maxTextGeometryChars,
    MAX_SHAPE_POINTS: maxShapePoints,
    materializeDeclarativeGeometry,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) {
      reg.authorNamespace = {};
    }
    Object.assign(reg.authorNamespace, exportsMap);
    reg._cadMaterialize = materializeDeclarativeGeometry;
    reg.materializeDeclarativeGeometry = (node: unknown) => {
      reg._cadMaterialize?.(node);
      reg._lodMaterialize?.(node);
      reg._procMaterialize?.(node);
    };
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` plugin registering 2D `Path`/`Shape`,
 * ear-clipping triangulation (`ShapeGeometry`), `ExtrudeGeometry`, 3D BSP `CSG`
 * booleans, and stroke-font `TextGeometry` onto `THREE` and worker sandboxes.
 */
export const cadPlugin: ThreeLivePlugin = {
  name: 'cad',
  onRegister(): void {
    registerWorkerExtensionInstaller(installCadExtension);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installCadExtension(threeNs, reg);
    }
  },
};
