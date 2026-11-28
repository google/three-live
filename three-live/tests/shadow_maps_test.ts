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

import {mat4Create} from '../src/math';
import {getSharedRegistry} from '../src/plugin';
import {
  applyShadowCasterNormalBias,
  computeWorldSceneBounds,
  doesMeshCastShadow,
  doesMeshReceiveShadow,
  fitDirectionalShadowMatrix,
  fitSpotShadowMatrix,
  getShadowMapStats,
  MAX_SHADOW_LIGHTS,
  normalizeShadowMapsMode,
  resolveActiveShadowLights,
  resolveShadowSectionPlane,
  SHADOW_MAP_TEXTURE_UNIT,
  SHADOW_RECEIVER_NORMAL_BIAS_SCALE,
  shadowMapsPlugin,
  VS_SHADOW_DEPTH,
  type WorldSceneBounds,
} from '../src/plugins/shadow-maps';
import THREE from '../src/three-author';
import {glbToUSDZ, sceneToGLB} from '../src/three-convert';
import {
  extractKhrLights,
  parseGLB,
  registerPlugin,
  ThreeView,
} from '../src/three-view';
import {SCENE_SHADOW_DEPTH_WGSL} from '../src/webgpu/shaders';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

function makeIdentityMat4(tx = 0, ty = 0, tz = 0): Float32Array {
  const m = mat4Create();
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

function makeMockShadowGl(overrides: Record<string, unknown> = {}) {
  const rec = {
    createShader: 0,
    deleteShader: 0,
    detachShader: 0,
    createProgram: 0,
    deleteProgram: 0,
    createTexture: 0,
    deleteTexture: 0,
    createFramebuffer: 0,
    deleteFramebuffer: 0,
    texStorage3D: [] as Array<{
      target: number;
      levels: number;
      internalformat: number;
      width: number;
      height: number;
      depth: number;
    }>,
    framebufferTextureLayer: [] as number[],
    clearDepthCalls: 0,
    drawElementsCalls: 0,
    drawElementsInstancedCalls: 0,
    drawArraysCalls: 0,
    viewports: [] as Array<[number, number, number, number]>,
    boundFbos: [] as unknown[],
    activeTextureUnits: [] as number[],
    uniform1i: [] as Array<[string, number]>,
    uniform1iv: [] as Array<[string, number[]]>,
  };
  const prevFboSentinel = {id: 'prev-fbo'};
  const gl = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    LINK_STATUS: 35714,
    TEXTURE_2D_ARRAY: 35866,
    DEPTH_COMPONENT24: 33190,
    DEPTH_COMPONENT: 6402,
    UNSIGNED_INT: 5125,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    TEXTURE_COMPARE_MODE: 34892,
    COMPARE_REF_TO_TEXTURE: 34894,
    TEXTURE_COMPARE_FUNC: 34893,
    LEQUAL: 515,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    FRAMEBUFFER: 36160,
    FRAMEBUFFER_BINDING: 36006,
    VIEWPORT: 2978,
    DEPTH_ATTACHMENT: 36096,
    DEPTH_BUFFER_BIT: 256,
    DEPTH_TEST: 2929,
    POLYGON_OFFSET_FILL: 32823,
    NONE: 0,
    TRIANGLES: 4,
    UNSIGNED_SHORT: 5123,
    TEXTURE9: 33993,
    createShader: () => (rec.createShader++, {}),
    deleteShader: () => void rec.deleteShader++,
    detachShader: () => void rec.detachShader++,
    shaderSource: () => {},
    compileShader: () => {},
    createProgram: () => (rec.createProgram++, {}),
    deleteProgram: () => void rec.deleteProgram++,
    isProgram: () => true,
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getUniformLocation: (_p: unknown, name: string) => ({name}),
    createTexture: () => (
      rec.createTexture++,
      {id: `tex-${rec.createTexture}`}
    ),
    deleteTexture: () => void rec.deleteTexture++,
    bindTexture: () => {},
    texStorage3D: (
      target: number,
      levels: number,
      internalformat: number,
      width: number,
      height: number,
      depth: number,
    ) => {
      rec.texStorage3D.push({
        target,
        levels,
        internalformat,
        width,
        height,
        depth,
      });
    },
    texParameteri: () => {},
    createFramebuffer: () => (
      rec.createFramebuffer++,
      {id: `fbo-${rec.createFramebuffer}`}
    ),
    deleteFramebuffer: () => void rec.deleteFramebuffer++,
    bindFramebuffer: (_target: number, fbo: unknown) => {
      rec.boundFbos.push(fbo);
    },
    drawBuffers: () => {},
    readBuffer: () => {},
    framebufferTextureLayer: (
      _target: number,
      _attachment: number,
      _tex: unknown,
      _level: number,
      layer: number,
    ) => {
      rec.framebufferTextureLayer.push(layer);
    },
    viewport: (x: number, y: number, w: number, h: number) => {
      rec.viewports.push([x, y, w, h]);
    },
    colorMask: () => {},
    depthMask: () => {},
    enable: () => {},
    disable: () => {},
    polygonOffset: () => {},
    useProgram: () => {},
    clear: (mask: number) => {
      if (mask === 256) rec.clearDepthCalls++;
    },
    bindVertexArray: () => {},
    vertexAttrib3f: () => {},
    activeTexture: (unit: number) => {
      rec.activeTextureUnits.push(unit);
    },
    uniform1i: (loc: {name?: string} | null, v: number) => {
      if (loc?.name) rec.uniform1i.push([loc.name, v]);
    },
    uniform1iv: (loc: {name?: string} | null, v: ArrayLike<number>) => {
      if (loc?.name) rec.uniform1iv.push([loc.name, Array.from(v)]);
    },
    uniform4f: () => {},
    uniform4fv: () => {},
    uniformMatrix4fv: () => {},
    drawElements: () => void rec.drawElementsCalls++,
    drawElementsInstanced: () => void rec.drawElementsInstancedCalls++,
    drawArrays: () => void rec.drawArraysCalls++,
    drawArraysInstanced: () => void rec.drawElementsInstancedCalls++,
    getParameter: (pname: number) => {
      if (pname === 36006) return prevFboSentinel;
      if (pname === 2978) return [10, 20, 640, 480];
      return null;
    },
    ...overrides,
  } as unknown as WebGL2RenderingContext;
  return {gl, rec, prevFboSentinel};
}

// ---------------------------------------------------------------------------
// CPU shadow-map rasterizer mirroring `VS_SHADOW_DEPTH` + `shdEval` (WebGL2)
// and `vsShadowDepth` + the WGSL receiver (WebGPU), used for pixel-level
// regression tests of normal-offset bias behavior.
// ---------------------------------------------------------------------------

interface CpuTri {
  p: number[][]; // 3 world positions
  n: number[][]; // 3 world normals
}

/** Extracts world-space triangles from a `THREE.BufferGeometry`. */
function geometryTris(geo: any): CpuTri[] {
  const pos = geo.attributes.position.array as ArrayLike<number>;
  const nor = geo.attributes.normal.array as ArrayLike<number>;
  const idx: ArrayLike<number> | null = geo.index ? geo.index.array : null;
  const count = idx ? idx.length : pos.length / 3;
  const tris: CpuTri[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    const p: number[][] = [];
    const n: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const v = idx ? idx[t + k] : t + k;
      p.push([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
      n.push([nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]]);
    }
    tris.push({p, n});
  }
  return tris;
}

function boundsOfTris(tris: CpuTri[]): WorldSceneBounds {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const v of t.p) {
      for (let a = 0; a < 3; a++) {
        mn[a] = Math.min(mn[a], v[a]);
        mx[a] = Math.max(mx[a], v[a]);
      }
    }
  }
  const c: [number, number, number] = [
    (mn[0] + mx[0]) / 2,
    (mn[1] + mx[1]) / 2,
    (mn[2] + mx[2]) / 2,
  ];
  const h = [(mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2];
  return {
    center: c,
    radius: Math.hypot(h[0], h[1], h[2]),
    min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
    max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
  };
}

function xformPoint(m: Float32Array, p: ArrayLike<number>): number[] {
  const x = p[0],
    y = p[1],
    z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

type CasterBiasFn = (
  out: number[],
  wp: number[],
  wn: number[],
  rayDir: number[],
  normalBiasWorld: number,
) => void;

const productionCasterBias: CasterBiasFn = (out, wp, wn, ray, nb) => {
  applyShadowCasterNormalBias(out, wp, wn, ray, nb);
};

/** Pre-fix behavior: casters inflated outward along `+N`. */
const legacyInflatingCasterBias: CasterBiasFn = (out, wp, wn, ray, nb) => {
  applyShadowCasterNormalBias(out, wp, wn, ray, nb);
  for (let a = 0; a < 3; a++) out[a] = 2 * wp[a] - out[a];
};

interface CpuShadowMap {
  size: number;
  depth: Float32Array;
  vp: Float32Array;
  dirToLight: number[];
  depthBias: number;
  normalBiasWorld: number;
  uvRadius: number;
}

/** Rasterizes caster depth (min-depth, texel-center coverage, polygon offset). */
function rasterizeShadowMap(
  tris: CpuTri[],
  dirToLight: number[],
  size: number,
  casterBias: CasterBiasFn,
): CpuShadowMap {
  const bounds = boundsOfTris(tris);
  const vp = mat4Create();
  fitDirectionalShadowMatrix(vp, dirToLight, bounds);
  const dl = Math.hypot(dirToLight[0], dirToLight[1], dirToLight[2]);
  const L = dirToLight.map((v) => v / dl);
  const rayDir = L.map((v) => -v);
  // Mirrors resolveShadowPlan defaults (bias -0.0005, normalBias 0.015, radius 1.5).
  const texelWorld = (bounds.radius * 2.2) / size;
  const normalBiasWorld = (0.015 / 0.015) * 1.75 * texelWorld;
  const depth = new Float32Array(size * size).fill(1);
  const tmp = [0, 0, 0];
  for (const t of tris) {
    const s: number[][] = [];
    for (let k = 0; k < 3; k++) {
      casterBias(tmp, t.p[k], t.n[k], rayDir, normalBiasWorld);
      const c = xformPoint(vp, tmp);
      s.push([
        (c[0] * 0.5 + 0.5) * size,
        (c[1] * 0.5 + 0.5) * size,
        c[2] * 0.5 + 0.5,
      ]);
    }
    const area =
      (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) -
      (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-12) continue;
    // gl.polygonOffset(1.5, 4.0) on a DEPTH_COMPONENT24 target.
    const dzdx =
      ((s[1][2] - s[0][2]) * (s[2][1] - s[0][1]) -
        (s[2][2] - s[0][2]) * (s[1][1] - s[0][1])) /
      area;
    const dzdy =
      ((s[2][2] - s[0][2]) * (s[1][0] - s[0][0]) -
        (s[1][2] - s[0][2]) * (s[2][0] - s[0][0])) /
      area;
    const polyOffset =
      1.5 * Math.max(Math.abs(dzdx), Math.abs(dzdy)) + 4 * 2 ** -24;
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
    const x1 = Math.min(
      size - 1,
      Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])),
    );
    const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
    const y1 = Math.min(
      size - 1,
      Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])),
    );
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 =
          ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) /
          area;
        const w1 =
          ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) /
          area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2] + polyOffset;
        const i = y * size + x;
        if (z < depth[i]) depth[i] = z;
      }
    }
  }
  return {
    size,
    depth,
    vp,
    dirToLight: L,
    depthBias: -0.0005,
    normalBiasWorld,
    uvRadius: (1.5 * 1.35) / size,
  };
}

/** Bilinear `LEQUAL` hardware-compare tap (`sampler2DArrayShadow`, LINEAR). */
function compareTap(sm: CpuShadowMap, u: number, v: number, rz: number) {
  const S = sm.size;
  const tx = u * S - 0.5;
  const ty = v * S - 0.5;
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const fx = tx - ix;
  const fy = ty - iy;
  const at = (x: number, y: number) => {
    const cx = Math.min(S - 1, Math.max(0, x));
    const cy = Math.min(S - 1, Math.max(0, y));
    return rz <= sm.depth[cy * S + cx] ? 1 : 0;
  };
  return (
    (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) +
    (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy
  );
}

const VOGEL_DISK = [
  [0.1768, 0.0],
  [-0.2265, 0.2078],
  [0.0355, -0.415],
  [0.3204, 0.3888],
  [-0.5562, -0.1455],
  [0.4916, -0.3806],
  [-0.1419, 0.6596],
  [-0.5177, -0.515],
];

/** CPU port of `shdEval` (receiver normal-offset + depth bias + 8-tap PCF). */
function evalShadow(
  sm: CpuShadowMap,
  wp: number[],
  N: number[],
  rotAngle = 0,
): number {
  const L = sm.dirToLight;
  const nl = N[0] * L[0] + N[1] * L[1] + N[2] * L[2];
  if (nl <= 0) return 0;
  const off = sm.normalBiasWorld * SHADOW_RECEIVER_NORMAL_BIAS_SCALE * (1 - nl);
  const c = xformPoint(sm.vp, [
    wp[0] + N[0] * off,
    wp[1] + N[1] * off,
    wp[2] + N[2] * off,
  ]);
  const u = c[0] * 0.5 + 0.5;
  const v = c[1] * 0.5 + 0.5;
  const z = c[2] * 0.5 + 0.5;
  if (u <= 0.002 || u >= 0.998 || v <= 0.002 || v >= 0.998 || z > 1 || z < 0) {
    return 1;
  }
  const rz = Math.min(1, Math.max(0, z + sm.depthBias));
  const ca = Math.cos(rotAngle);
  const sa = Math.sin(rotAngle);
  let sum = 0;
  for (const [dx, dy] of VOGEL_DISK) {
    const rx = ca * dx - sa * dy;
    const ry = sa * dx + ca * dy;
    sum += compareTap(sm, u + rx * sm.uvRadius, v + ry * sm.uvRadius, rz);
  }
  return sum / 8;
}

function minShadowOverFrontFace(
  sm: CpuShadowMap,
  yMin: number,
  yMax: number,
  yStep: number,
): {min: number; worstY: number} {
  let min = 1;
  let worstY = NaN;
  for (let y = yMin; y <= yMax + 1e-9; y += yStep) {
    for (let x = -2.5; x <= 2.5 + 1e-9; x += 0.125) {
      for (const rot of [0, 1.7, 4.1]) {
        const f = evalShadow(sm, [x, y, 0], [0, 0, 1], rot);
        if (f < min) {
          min = f;
          worstY = y;
        }
      }
    }
  }
  return {min, worstY};
}

async function runFlushWallShadowRegressionTests() {
  console.log('\n🧱 Flush multi-story wall shadow regression (CPU raster)');

  // Shader parity: both depth passes shrink casters inward (-N).
  assert(
    /wp\.xyz-=wn\*\(uBiasRay\.w\*/.test(VS_SHADOW_DEPTH) &&
      !/wp\.xyz\+=wn\*/.test(VS_SHADOW_DEPTH),
    'WebGL2 VS_SHADOW_DEPTH shrinks casters inward along -N (never inflates +N)',
  );
  assert(
    /wp\.xyz - un \* \(shd\.biasRay\.w/.test(SCENE_SHADOW_DEPTH_WGSL) &&
      !/wp\.xyz \+ un \*/.test(SCENE_SHADOW_DEPTH_WGSL),
    'WebGPU vsShadowDepth shrinks casters inward along -N (parity with WebGL2)',
  );
  const ref = applyShadowCasterNormalBias(
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    0.1,
  );
  assert(
    Math.abs(ref[2] + 0.015) < 1e-9,
    'applyShadowCasterNormalBias offsets by -N * bias * max(1-|N·ray|, 0.15)',
  );

  // Scene: 22m x 18m lawn + two vertically stacked, horizontally flush walls
  // (y = 0..3 and y = 3..6) sharing the z = 0 outer face, plus a sloped slab
  // and a sphere for acne checks.
  const ground = new THREE.BoxGeometry(22, 0.1, 18).translate(0, -0.05, 0);
  const lower = new THREE.BoxGeometry(6, 3, 0.3).translate(0, 1.5, -0.15);
  const upper = new THREE.BoxGeometry(6, 3, 0.3).translate(0, 4.5, -0.15);
  const roof = new THREE.BoxGeometry(3, 0.2, 3)
    .rotateX(-0.6)
    .translate(-7, 1.5, 5);
  const sphere = new THREE.SphereGeometry(1, 48, 24).translate(7, 1.2, 5);
  const tris = [
    ...geometryTris(ground),
    ...geometryTris(lower),
    ...geometryTris(upper),
    ...geometryTris(roof),
    ...geometryTris(sphere),
  ];
  const sunDir = [0.35, 1.0, 0.9]; // toward the light: front, above, right

  const fixed = rasterizeShadowMap(tris, sunDir, 1024, productionCasterBias);
  const legacy = rasterizeShadowMap(
    tris,
    sunDir,
    1024,
    legacyInflatingCasterBias,
  );
  assert(
    fixed.normalBiasWorld > 0.04 && fixed.normalBiasWorld < 0.07,
    `house+lawn normalBiasWorld is ~5–6 cm (got ${(fixed.normalBiasWorld * 100).toFixed(2)} cm)`,
  );

  // Eval-first: the legacy +N inflation must visibly darken the flush walls.
  const legacyBand = minShadowOverFrontFace(legacy, 2.5, 2.999, 0.0025);
  assert(
    legacyBand.min < 0.95,
    `legacy +N caster inflation darkens sunlit flush wall below the joint (min ${legacyBand.min.toFixed(3)} at y=${legacyBand.worstY.toFixed(3)})`,
  );

  const LIT = 1 - 1e-6; // PCF/bilinear weights sum to 1 within float error.
  const band = minShadowOverFrontFace(fixed, 2.5, 2.999, 0.0025);
  assert(
    band.min >= LIT,
    `no shadow darkening just below flush y=3 joint on sunlit lower wall (min ${band.min.toFixed(4)} at y=${band.worstY})`,
  );
  const lowerFace = minShadowOverFrontFace(fixed, 0.25, 2.5, 0.05);
  const upperFace = minShadowOverFrontFace(fixed, 3.001, 5.75, 0.05);
  assert(
    lowerFace.min >= LIT && upperFace.min >= LIT,
    `shadow factor == 1.0 across both stacked flush wall front faces (lower ${lowerFace.min.toFixed(4)}, upper ${upperFace.min.toFixed(4)})`,
  );

  // Robustness: other sun azimuths/elevations and a 2048 map.
  let sweepMin = 1;
  for (const [dir, size] of [
    [[-0.5, 0.8, 1.0], 1024],
    [[0.0, 1.4, 0.6], 1024],
    [[0.8, 0.6, 1.0], 1024],
    [[0.35, 1.0, 0.9], 2048],
  ] as Array<[number[], number]>) {
    const sm = rasterizeShadowMap(tris, dir, size, productionCasterBias);
    sweepMin = Math.min(
      sweepMin,
      minShadowOverFrontFace(sm, 2.5, 2.999, 0.005).min,
      minShadowOverFrontFace(sm, 3.001, 3.5, 0.01).min,
    );
  }
  assert(
    sweepMin >= LIT,
    `flush joint stays fully lit across sun directions and 1024/2048 maps (min ${sweepMin.toFixed(4)})`,
  );

  // Sanity: the walls still cast a real shadow onto the lawn behind them.
  const behind = evalShadow(fixed, [-0.5, 0, -3], [0, 1, 0]);
  const openLawn = evalShadow(fixed, [0, 0, 6], [0, 1, 0]);
  assert(
    behind === 0 && openLawn >= LIT,
    `walls still shadow the lawn behind them (behind=${behind}, open=${openLawn})`,
  );

  // Zero self-shadow acne on sloped and curved lit surfaces.
  const L = fixed.dirToLight;
  let acneMin = 1;
  let acneSamples = 0;
  const acneTris = [
    ...geometryTris(roof),
    ...geometryTris(sphere),
    ...geometryTris(ground),
  ];
  for (const t of acneTris) {
    for (const [a, b] of [
      [1 / 3, 1 / 3],
      [0.6, 0.2],
      [0.2, 0.6],
      [0.2, 0.2],
    ]) {
      const c = 1 - a - b;
      const p = [0, 1, 2].map(
        (k) => t.p[0][k] * a + t.p[1][k] * b + t.p[2][k] * c,
      );
      let n = [0, 1, 2].map(
        (k) => t.n[0][k] * a + t.n[1][k] * b + t.n[2][k] * c,
      );
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      n = n.map((v) => v / nl);
      if (n[0] * L[0] + n[1] * L[1] + n[2] * L[2] < 0.1) continue;
      // Skip lawn legitimately shadowed by the walls/slab/sphere.
      if (p[1] < 0.01 && (Math.abs(p[0]) < 4.5 || p[2] < 7)) continue;
      acneSamples++;
      for (const rot of [0, 2.3]) {
        acneMin = Math.min(acneMin, evalShadow(fixed, p, n, rot));
      }
    }
  }
  assert(
    acneSamples > 500 && acneMin >= LIT,
    `zero self-shadow acne on sloped slab + sphere lit surfaces (${acneSamples} samples, min ${acneMin.toFixed(3)})`,
  );
}

/**
 * `<three-live section-plane>` (no `<xr-live>`): toggling the attribute
 * clips the upper half of a mesh in the shadow depth pass.
 */
async function runSectionPlaneShadowTests() {
  console.log('\n✂️  section-plane shadow pass (no xr-live)');
  const attrs = new Map<string, string>();
  const container = {
    getAttribute: (n: string) => attrs.get(n) ?? null,
  };
  const secPlanes: number[][] = [];
  const {gl, rec} = makeMockShadowGl({
    uniform4f: (
      loc: {name?: string} | null,
      x: number,
      y: number,
      z: number,
      w: number,
    ) => {
      if (loc?.name === 'uSecPlane') secPlanes.push([x, y, z, w]);
    },
  });
  const box = new THREE.BoxGeometry(2, 2, 2);
  const viewer = {
    gl,
    canvas: {width: 800, height: 600},
    shadowMaps: 'pcf',
    container,
    modelRootMatrix: makeIdentityMat4(),
    meshes: [
      {
        name: 'SectionBox',
        visible: true,
        castShadow: true,
        receiveShadow: true,
        transform: makeIdentityMat4(),
        primitives: [
          {
            vao: {} as WebGLVertexArrayObject,
            indexCount: box.index!.array.length,
            indexType: 5123,
            indices: box.index!.array,
            positions: box.attributes.position.array,
            baseColor: [1, 1, 1, 1],
          },
        ],
      },
    ],
    lights: [
      {type: 'directional', direction: [0.3, 1, 0.5], shadow: {cast: true}},
    ],
    uRender: {},
    recompileRenderProgram: () => {},
  };
  const last = <T>(a: T[]): T | undefined => a[a.length - 1];
  const secOn = () =>
    rec.uniform1i.filter(([n]) => n === 'uSecOn').map(([, v]) => v);

  // CPU fragment survival mirroring FS_SHADOW_DEPTH's discard test.
  const survivingFraction = (plane: number[] | null) => {
    const pos = box.attributes.position.array;
    const idx = box.index!.array;
    let kept = 0;
    let total = 0;
    for (let t = 0; t < idx.length; t += 3) {
      for (let a = 0.05; a < 1; a += 0.1) {
        for (let b = 0.05; a + b < 1; b += 0.1) {
          const c = 1 - a - b;
          const p = [0, 1, 2].map(
            (k) =>
              pos[idx[t] * 3 + k] * a +
              pos[idx[t + 1] * 3 + k] * b +
              pos[idx[t + 2] * 3 + k] * c,
          );
          total++;
          const d = plane
            ? p[0] * plane[0] + p[1] * plane[1] + p[2] * plane[2]
            : -1;
          if (!plane || d <= plane[3]) kept++;
          if (plane && d > plane[3] && p[1] < -1e-6) return -1; // lower half clipped!
        }
      }
    }
    return kept / total;
  };

  shadowMapsPlugin.onBeforeDrawScene!(viewer as unknown as ThreeView, gl);
  const passes0 = getShadowMapStats(viewer).renderedPasses;
  assert(
    last(secOn()) === 0 && survivingFraction(null) === 1,
    'section-plane absent: shadow depth pass uploads uSecOn=0 (full caster)',
  );

  attrs.set('section-plane', 'y:0.0');
  shadowMapsPlugin.onBeforeDrawScene!(viewer as unknown as ThreeView, gl);
  const plane = last(secPlanes) ?? null;
  const frac = survivingFraction(plane);
  assert(
    getShadowMapStats(viewer).renderedPasses > passes0 &&
      last(secOn()) === 1 &&
      plane !== null &&
      plane[1] === 1 &&
      plane[3] === 0 &&
      frac > 0.4 &&
      frac < 0.6,
    `section-plane="y:0.0" re-renders shadows with uSecOn=1, plane (0,1,0,0), clipping the upper half of the caster (kept ${(frac * 100).toFixed(1)}%)`,
  );

  attrs.set('section-plane', 'none');
  const passes1 = getShadowMapStats(viewer).renderedPasses;
  shadowMapsPlugin.onBeforeDrawScene!(viewer as unknown as ThreeView, gl);
  assert(
    getShadowMapStats(viewer).renderedPasses > passes1 && last(secOn()) === 0,
    'section-plane="none" invalidates the shadow digest and restores the full caster (uSecOn=0)',
  );
  shadowMapsPlugin.onDestroy!(gl, viewer);
}

async function runShadowMapsTests() {
  console.log('🌑 Running Multi-Light Shadow Maps (Phase A) Unit Tests...\n');

  // 1. THREE authoring surface (`LightShadow`, shadow map constants, `Object3D` flags)
  assert(
    THREE.BasicShadowMap === 0 &&
      THREE.PCFShadowMap === 1 &&
      THREE.PCFSoftShadowMap === 2 &&
      THREE.VSMShadowMap === 3,
    'THREE exports standard ShadowMap type constants (Basic/PCF/PCFSoft/VSM)',
  );

  const scene = new THREE.Scene();
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(4, 8, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0008;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = 2.5;
  scene.add(keyLight);

  assert(
    keyLight.shadow.mapSize.width === 2048 &&
      keyLight.shadow.mapSize.height === 2048,
    'LightShadow.mapSize exposes Vector2 width/height aliases',
  );
  const clonedShadow = keyLight.shadow.clone();
  assert(
    clonedShadow.mapSize.width === 2048 &&
      Math.abs(clonedShadow.bias - -0.0008) < 1e-6 &&
      Math.abs(clonedShadow.normalBias - 0.02) < 1e-6 &&
      Math.abs(clonedShadow.radius - 2.5) < 1e-6,
    'LightShadow.clone() preserves mapSize, bias, normalBias, and radius',
  );

  const rimSpot = new THREE.SpotLight(0x88ccff, 1.8, 15, Math.PI / 4, 0.3);
  rimSpot.position.set(-3, 5, -4);
  rimSpot.castShadow = true;
  rimSpot.shadow.mapSize.width = 1024;
  rimSpot.shadow.mapSize.height = 1024;
  scene.add(rimSpot);

  const fillPoint = new THREE.PointLight(0xffaa44, 0.9, 10);
  fillPoint.position.set(0, 3, 2);
  // Intentionally non-shadow-casting to test mixed punctual light preservation!
  fillPoint.castShadow = false;
  scene.add(fillPoint);

  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshStandardMaterial({color: 0x6366f1}),
  );
  pillar.name = 'Pillar';
  pillar.position.set(0, 1, 0);
  pillar.castShadow = true;
  pillar.receiveShadow = true;
  scene.add(pillar);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.2, 10),
    new THREE.MeshStandardMaterial({color: 0x94a3b8}),
  );
  floor.name = 'Floor';
  floor.position.set(0, -0.1, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  const helper = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshBasicMaterial({color: 0xffff00}),
  );
  helper.name = 'GizmoHelper';
  helper.castShadow = false; // Explicit opt-out
  scene.add(helper);

  const clonedPillar = pillar.clone();
  assert(
    clonedPillar.castShadow === true && clonedPillar.receiveShadow === true,
    'Object3D.clone() preserves explicit castShadow and receiveShadow flags',
  );

  // 2. GLB serialization & KHR_lights_punctual / node.extras.shadow round-trip
  const glbBytes = sceneToGLB(scene);
  const parsed = parseGLB(glbBytes);
  const parsedLights = extractKhrLights(parsed.gltf);

  assert(
    parsedLights.length === 3,
    `extractKhrLights preserves all 3 punctual lights (2 shadow casters + 1 non-shadow fill), got ${parsedLights.length}`,
  );
  const parsedDir = parsedLights.find((l) => l.type === 'directional');
  const parsedSpot = parsedLights.find((l) => l.type === 'spot');
  const parsedPt = parsedLights.find((l) => l.type === 'point');
  assert(
    Boolean(
      parsedDir?.shadow?.cast &&
        parsedDir.shadow.mapSize === 2048 &&
        Math.abs((parsedDir.shadow.bias ?? 0) - -0.0008) < 1e-6 &&
        Math.abs((parsedDir.shadow.normalBias ?? 0) - 0.02) < 1e-6 &&
        Math.abs((parsedDir.shadow.radius ?? 0) - 2.5) < 1e-6,
    ),
    'extractKhrLights extracts directional light KHR_lights_punctual extras.shadow config',
  );
  assert(
    Boolean(parsedSpot?.shadow?.cast && parsedSpot.shadow.mapSize === 1024),
    'extractKhrLights extracts spot light KHR_lights_punctual extras.shadow config',
  );
  assert(
    parsedPt !== undefined && !parsedPt.shadow?.cast,
    'Non-shadow PointLight is preserved in KHR_lights_punctual without shadow.cast',
  );

  const gltfNodes: Array<{
    name?: string;
    extras?: {shadow?: {cast?: boolean; receive?: boolean}};
  }> = parsed.gltf.nodes || [];
  const pillarNode = gltfNodes.find((n) => n.name === 'Pillar');
  const floorNode = gltfNodes.find((n) => n.name === 'Floor');
  const helperNode = gltfNodes.find((n) => n.name === 'GizmoHelper');
  assert(
    pillarNode?.extras?.shadow?.cast === true &&
      pillarNode?.extras?.shadow?.receive === true &&
      floorNode?.extras?.shadow?.receive === true &&
      helperNode?.extras?.shadow?.cast === false,
    'parseGLB round-trips node.extras.shadow.{cast, receive} including explicit false opt-out',
  );

  // Verify zero shadow overhead in GLB JSON when no shadows are authored
  const plainScene = new THREE.Scene();
  plainScene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    ),
  );
  plainScene.add(new THREE.DirectionalLight(0xffffff, 1));
  const plainGlb = sceneToGLB(plainScene);
  const plainJsonLen = new DataView(
    plainGlb.buffer,
    plainGlb.byteOffset + 12,
    4,
  ).getUint32(0, true);
  const plainJsonStr = new TextDecoder().decode(
    plainGlb.subarray(20, 20 + plainJsonLen),
  );
  assert(
    !plainJsonStr.includes('"KHR_lights_punctual"') &&
      !plainJsonStr.includes('"shadow"'),
    'Plain scenes without shadow flags emit 0 bytes of shadow or KHR_lights_punctual JSON',
  );

  // 3. USDZ / USDA generation with UsdLuxShadowAPI and primvars:doNotCastShadows
  const usdzBytes = glbToUSDZ(glbBytes);
  const usdaText = new TextDecoder().decode(usdzBytes);
  assert(
    usdaText.includes('def Scope "Lights"') &&
      usdaText.includes('def DistantLight "Light_0"') &&
      usdaText.includes('def DiskLight "Light_1"') &&
      usdaText.includes('prepend apiSchemas = ["ShadowAPI"]') &&
      usdaText.includes('bool inputs:shadow:enable = 1') &&
      usdaText.includes('bool primvars:doNotCastShadows = 1'),
    'glbToUSDZ emits UsdLuxShadowAPI lights and primvars:doNotCastShadows = 1 for explicit non-casters',
  );

  // 4. Mode normalization & mesh caster/receiver eligibility
  assert(
    normalizeShadowMapsMode('auto') === 'auto' &&
      normalizeShadowMapsMode('PCF') === 'pcf' &&
      normalizeShadowMapsMode(' off ') === 'off' &&
      normalizeShadowMapsMode('invalid') === 'auto' &&
      normalizeShadowMapsMode(null) === 'auto',
    'normalizeShadowMapsMode normalizes auto, pcf, and off cleanly',
  );

  const makeViewerMesh = (
    name: string,
    opts: Record<string, unknown> = {},
  ) => ({
    name,
    visible: true,
    transform: makeIdentityMat4(),
    primitives: [
      {
        vao: {} as WebGLVertexArrayObject,
        indexCount: 36,
        indexType: 5123,
        indices: new Uint16Array(36),
        positions: new Float32Array([
          -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
        ]),
        baseColor: [1, 1, 1, 1],
      },
    ],
    ...opts,
  });

  assert(
    doesMeshCastShadow(makeViewerMesh('Part'), true) === true &&
      doesMeshCastShadow(makeViewerMesh('Part'), false) === false &&
      doesMeshCastShadow(makeViewerMesh('Part', {castShadow: true}), false) ===
        true &&
      doesMeshCastShadow(makeViewerMesh('Part', {castShadow: false}), true) ===
        false &&
      doesMeshCastShadow(makeViewerMesh('__contact_shadow__'), true) ===
        false &&
      doesMeshCastShadow(
        makeViewerMesh('Splat', {extras: {xr: {splatUrl: 'room.spz'}}}),
        true,
      ) === false &&
      doesMeshReceiveShadow(
        makeViewerMesh('Floor', {receiveShadow: false}),
        true,
      ) === false,
    'doesMeshCastShadow / doesMeshReceiveShadow respect explicit flags, promoteAll, plugin meshes, and splats',
  );

  // 5. Tight frustum fitting & dynamic world bounds (including flat plane & zenith light)
  const flatBounds = computeWorldSceneBounds({
    modelRootMatrix: makeIdentityMat4(),
    meshes: [
      makeViewerMesh('FlatPlane', {
        primitives: [
          {
            indexCount: 6,
            indexType: 5123,
            positions: new Float32Array([-2, 0, -2, 2, 0, -2, 2, 0, 2]),
          },
        ],
      }),
    ],
  });
  assert(
    flatBounds.radius >= 0.05 && flatBounds.max[1] - flatBounds.min[1] >= 0.05,
    `computeWorldSceneBounds enforces non-degenerate thickness on flat planes (radius=${flatBounds.radius.toFixed(3)})`,
  );

  const dirVp = mat4Create();
  fitDirectionalShadowMatrix(dirVp, [0, 1, 0], flatBounds);
  assert(
    dirVp.every((v) => Number.isFinite(v)),
    'fitDirectionalShadowMatrix handles straight-down zenith light [0, 1, 0] without NaN',
  );

  const spotVp = mat4Create();
  fitSpotShadowMatrix(
    spotVp,
    [0, 5, 0],
    [0, -1, 0],
    Math.PI / 4,
    20,
    flatBounds,
  );
  assert(
    spotVp.every((v) => Number.isFinite(v)),
    'fitSpotShadowMatrix handles vertical spotlight without NaN',
  );

  // 6. Section plane parsing
  const secPlane = resolveShadowSectionPlane({
    container: {
      getAttribute: (n: string) => (n === 'section-plane' ? '-x:0.5' : null),
    },
    modelRootMatrix: makeIdentityMat4(),
  });
  assert(
    secPlane !== null &&
      secPlane.enabled &&
      secPlane.normal[0] === -1 &&
      Math.abs(secPlane.constant - -0.5) < 1e-6,
    'resolveShadowSectionPlane parses axis:constant and applies sign correctly',
  );

  // 7. resolveActiveShadowLights: VRAM budget clamping, pcf auto-promotion, and off mode
  const four2kLightsViewer = {
    shadowMaps: 'auto',
    modelRootMatrix: makeIdentityMat4(),
    meshes: [makeViewerMesh('Caster', {castShadow: true})],
    lights: [
      {
        type: 'directional',
        direction: [1, 2, 1],
        shadow: {cast: true, mapSize: 2048},
      },
      {
        type: 'directional',
        direction: [-1, 2, 1],
        shadow: {cast: true, mapSize: 2048},
      },
      {
        type: 'spot',
        position: [0, 4, 2],
        direction: [0, -1, -0.5],
        shadow: {cast: true, mapSize: 2048},
      },
      {type: 'point', position: [2, 3, 0], shadow: {cast: true, mapSize: 2048}},
    ],
  };
  const fourPlan = resolveActiveShadowLights(four2kLightsViewer);
  assert(
    fourPlan.slices.length === MAX_SHADOW_LIGHTS &&
      fourPlan.mapSize === 1024 &&
      fourPlan.dirSlots[0] === 0 &&
      fourPlan.dirSlots[1] === 1 &&
      fourPlan.ptSlots[0] === 2 &&
      fourPlan.ptSlots[1] === 3,
    `4x 2048 shadow lights clamp mapSize to 1024 to stay within 32 MB array VRAM budget (got mapSize=${fourPlan.mapSize}, slices=${fourPlan.slices.length})`,
  );

  const pcfPlainViewer = {
    shadowMaps: 'pcf',
    modelRootMatrix: makeIdentityMat4(),
    meshes: [makeViewerMesh('UnflaggedCadPart')],
    lights: [],
  };
  const pcfPlan = resolveActiveShadowLights(pcfPlainViewer);
  assert(
    pcfPlan.slices.length === 1 &&
      pcfPlan.promoteAllCasters &&
      pcfPlan.promoteAllReceivers &&
      pcfPlan.dirSlots[0] === 0,
    'shadow-maps="pcf" auto-promotes unflagged GLB meshes and synthesizes default key directional shadow slice',
  );

  const offPlan = resolveActiveShadowLights({
    ...four2kLightsViewer,
    shadowMaps: 'off',
  });
  assert(
    offPlan.slices.length === 0 && offPlan.mapSize === 0,
    'shadow-maps="off" disables all shadow slices',
  );

  // 8. WebGL2 shadowMapsPlugin lifecycle, FBO/TEXTURE_2D_ARRAY, static orbit cache, and cleanup
  registerPlugin(shadowMapsPlugin);
  const reg = getSharedRegistry();
  assert(
    reg.shadowMapShader !== undefined &&
      reg.shadowMapShader.uniformNames.includes('uShadowMap'),
    'shadowMapsPlugin registers shadowMapShader chunk on SharedThreeLiveRegistry',
  );

  const {gl, rec, prevFboSentinel} = makeMockShadowGl();
  const meshA = makeViewerMesh('PartA', {
    castShadow: true,
    receiveShadow: true,
    transform: makeIdentityMat4(0, 1, 0),
  });
  const meshB = makeViewerMesh('FloorB', {
    castShadow: false,
    receiveShadow: true,
    transform: makeIdentityMat4(0, 0, 0),
  });
  let recompiled = 0;
  const mockViewer = {
    gl,
    canvas: {width: 800, height: 600},
    shadowMaps: 'auto',
    modelRootMatrix: makeIdentityMat4(),
    meshes: [meshA, meshB],
    lights: [
      {
        type: 'directional',
        direction: [0.5, 1.0, 0.8],
        shadow: {
          cast: true,
          mapSize: 1024,
          bias: -0.0005,
          normalBias: 0.015,
          radius: 1.5,
        },
      },
      {
        type: 'spot',
        position: [2, 4, 2],
        direction: [-0.4, -1.0, -0.4],
        outerConeAngle: Math.PI / 4,
        shadow: {cast: true, mapSize: 1024},
      },
    ],
    uRender: {},
    recompileRenderProgram: () => {
      recompiled++;
    },
  };

  // Frame 1: Initial shadow render
  shadowMapsPlugin.onBeforeDrawScene!(mockViewer as unknown as ThreeView, gl);
  const stats1 = getShadowMapStats(mockViewer);
  assert(
    recompiled === 1 &&
      stats1.renderedPasses === 2 &&
      stats1.cacheHits === 0 &&
      stats1.activeLights === 2 &&
      stats1.mapSize === 1024 &&
      rec.framebufferTextureLayer.length === 2 &&
      rec.framebufferTextureLayer[0] === 0 &&
      rec.framebufferTextureLayer[1] === 1 &&
      rec.drawElementsCalls === 2 && // Only meshA casts shadows (1 draw per slice * 2 slices)
      rec.boundFbos[rec.boundFbos.length - 1] === prevFboSentinel &&
      rec.viewports[rec.viewports.length - 1][2] === 640 &&
      rec.viewports[rec.viewports.length - 1][3] === 480,
    'Frame 1 allocates 1024x1024x2 TEXTURE_2D_ARRAY, renders 2 depth slices for caster meshA only, and restores FBO + viewport',
  );

  // Frame 2: Camera orbit only (no caster or light change) -> 0 depth passes!
  shadowMapsPlugin.onBeforeDrawScene!(mockViewer as unknown as ThreeView, gl);
  const stats2 = getShadowMapStats(mockViewer);
  assert(
    stats2.renderedPasses === 2 &&
      stats2.cacheHits === 1 &&
      rec.drawElementsCalls === 2,
    'Frame 2 (static camera orbit) hits FNV-1a shadow digest cache with 0 extra depth draw calls',
  );

  // Frame 3: Move caster meshA -> invalidates digest and re-renders 2 slices
  meshA.transform[13] = 2.5;
  shadowMapsPlugin.onBeforeDrawScene!(mockViewer as unknown as ThreeView, gl);
  const stats3 = getShadowMapStats(mockViewer);
  assert(
    stats3.renderedPasses === 4 &&
      stats3.cacheHits === 1 &&
      rec.drawElementsCalls === 4,
    'Frame 3 (moved caster meshA) invalidates shadow digest and re-renders both shadow slices',
  );

  // Test shadowShaderChunk.bind() per-mesh uniform binding
  const mockUniforms: Record<string, WebGLUniformLocation | null> = {
    uShadowMap: {name: 'uShadowMap'} as unknown as WebGLUniformLocation,
    uShadowVP: {name: 'uShadowVP'} as unknown as WebGLUniformLocation,
    uShadowParams: {name: 'uShadowParams'} as unknown as WebGLUniformLocation,
    uDirShdSlot: {name: 'uDirShdSlot'} as unknown as WebGLUniformLocation,
    uPtShdSlot: {name: 'uPtShdSlot'} as unknown as WebGLUniformLocation,
    uReceiveShadow: {name: 'uReceiveShadow'} as unknown as WebGLUniformLocation,
  };
  reg.shadowMapShader!.bind(gl, mockUniforms, mockViewer, meshB);
  const noRecvMesh = makeViewerMesh('NoRecv', {receiveShadow: false});
  reg.shadowMapShader!.bind(gl, mockUniforms, mockViewer, noRecvMesh);
  assert(
    rec.activeTextureUnits.includes(33984 + SHADOW_MAP_TEXTURE_UNIT) &&
      rec.uniform1i.some(
        ([k, v]) => k === 'uShadowMap' && v === SHADOW_MAP_TEXTURE_UNIT,
      ) &&
      rec.uniform1i.some(([k, v]) => k === 'uReceiveShadow' && v === 1) &&
      rec.uniform1i.some(([k, v]) => k === 'uReceiveShadow' && v === 0),
    'shadowShaderChunk.bind binds TEXTURE9 and toggles uReceiveShadow per mesh',
  );

  // Test WebGPU acceleration handoff (skips redundant WebGL2 depth passes)
  const prevAccel = reg.gpuSceneAccelerator;
  reg.gpuSceneAccelerator = {
    willRenderScene: () => true,
    renderScene: () => true,
  };
  try {
    meshA.transform[13] = 3.5;
    shadowMapsPlugin.onBeforeDrawScene!(mockViewer as unknown as ThreeView, gl);
    const statsGpu = getShadowMapStats(mockViewer);
    assert(
      statsGpu.renderedPasses === 4,
      'shadowMapsPlugin skips WebGL2 depth passes when WebGPU gpuSceneAccelerator owns the scene',
    );
  } finally {
    reg.gpuSceneAccelerator = prevAccel;
  }

  // Test context loss/restore and onDestroy cleanup
  shadowMapsPlugin.onContextRestored!(gl, mockViewer);
  assert(
    getShadowMapStats(mockViewer).activeLights === 0,
    'onContextRestored resets activeLights and forces texture array reallocation on next frame',
  );
  shadowMapsPlugin.onBeforeDrawScene!(mockViewer as unknown as ThreeView, gl);
  const delTexBefore = rec.deleteTexture;
  const delFboBefore = rec.deleteFramebuffer;
  shadowMapsPlugin.onDestroy!(gl, mockViewer);
  shadowMapsPlugin.onDestroy!(gl);
  assert(
    rec.deleteTexture > delTexBefore && rec.deleteFramebuffer > delFboBefore,
    'onDestroy deletes viewer shadow TEXTURE_2D_ARRAY, FBO, and shared dummy resources',
  );

  await runFlushWallShadowRegressionTests();
  await runSectionPlaneShadowTests();

  // 9. Dollhouse cutaway shadow opt-out (`userData.xr.cutaway = {normal, castShadow: false}`)
  {
    const cutAttrs = new Map<string, string>();
    const cutRoof = makeViewerMesh('CutRoof', {
      castShadow: true,
      extras: {xr: {cutaway: {normal: [0, 1, 0], castShadow: false}}},
      primitives: [
        {
          vao: {id: 'cut-roof'} as unknown as WebGLVertexArrayObject,
          indexCount: 6,
          indexType: 5123,
          indices: new Uint16Array(6),
          positions: new Float32Array([-2, 3, -2, 2, 3, -2, 2, 3, 2]),
          baseColor: [1, 1, 1, 1],
        },
      ],
    });
    const cutWallDefault = makeViewerMesh('CutWallDefault', {
      castShadow: true,
      extras: {xr: {cutaway: {normal: [0, 0, 1]}}},
      primitives: [
        {
          vao: {id: 'cut-wall'} as unknown as WebGLVertexArrayObject,
          indexCount: 6,
          indexType: 5123,
          indices: new Uint16Array(6),
          positions: new Float32Array([-2, 0, 2, 2, 0, 2, 2, 3, 2]),
          baseColor: [1, 1, 1, 1],
        },
      ],
    });
    const cutViewer = {
      shadowMaps: 'auto',
      cutawayEnabled: true,
      container: {getAttribute: (n: string) => cutAttrs.get(n) ?? null},
      canvas: {width: 640, height: 480},
      modelRootMatrix: makeIdentityMat4(),
      meshes: [cutRoof, cutWallDefault],
      lights: [
        {type: 'directional', direction: [0.5, 1, 0.5], shadow: {cast: true}},
      ],
    };
    // Eye above roof (y = 8) and in front of wall (z = 8): roof shadow suppressed, default wall STILL casts!
    const planAbove = resolveActiveShadowLights(cutViewer, [0, 8, 8]);
    const planAbove2 = resolveActiveShadowLights(cutViewer, [1, 9, 8]);
    // Eye below roof (y = 1): roof is NOT cut away, so both cast -> digest MUST change!
    const planBelow = resolveActiveShadowLights(cutViewer, [0, 1, 8]);
    // Eye above roof with cutaway="off" (cutawayEnabled=false): roof casts again -> matches planBelow!
    cutViewer.cutawayEnabled = false;
    const planOff = resolveActiveShadowLights(cutViewer, [0, 8, 8]);
    cutViewer.cutawayEnabled = true;

    // Verify draw call counts during WebGL2 depth pass: 1 draw when roof suppressed, 2 when below.
    const {gl: cgl, rec: crec} = makeMockShadowGl();
    const beforeDraw = shadowMapsPlugin.onBeforeDrawScene as (
      v: unknown,
      g: WebGL2RenderingContext,
      vp?: Float32Array,
      eye?: readonly [number, number, number],
    ) => void;
    beforeDraw(cutViewer, cgl, undefined, [0, 8, 8]);
    const drawsSuppressed = crec.drawElementsCalls;
    // Orbiting while staying above roof hits the cache (0 extra draws)!
    beforeDraw(cutViewer, cgl, undefined, [2, 9, 7]);
    const drawsCached = crec.drawElementsCalls;
    // Moving eye below roof invalidates cache and renders BOTH meshes (+2 draws).
    beforeDraw(cutViewer, cgl, undefined, [0, 1, 8]);
    const drawsRestored = crec.drawElementsCalls;
    shadowMapsPlugin.onDestroy!(cgl, cutViewer);

    assert(
      planAbove.slices.length === 1 &&
        planAbove.digest === planAbove2.digest &&
        planAbove.digest !== planBelow.digest &&
        planOff.digest === planBelow.digest &&
        drawsSuppressed === 1 &&
        drawsCached === 1 &&
        drawsRestored === 3,
      `cutaway.castShadow=false suppresses shadows while cut away, caches static cutaway sets, and restores on orbit or cutaway=off (draws: ${drawsSuppressed}->${drawsCached}->${drawsRestored})`,
    );
  }

  console.log(
    `\n📊 Shadow Maps Tests Summary: ${passed} passed, ${failed} failed.`,
  );
  if (failed > 0) {
    process.exit(1);
  }
}

runShadowMapsTests();
