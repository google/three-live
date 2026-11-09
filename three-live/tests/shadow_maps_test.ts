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
  shadowMapsPlugin,
} from '../src/plugins/shadow-maps';
import THREE from '../src/three-author';
import {glbToUSDZ, sceneToGLB} from '../src/three-convert';
import {
  extractKhrLights,
  parseGLB,
  registerPlugin,
  ThreeView,
} from '../src/three-view';

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

  console.log(
    `\n📊 Shadow Maps Tests Summary: ${passed} passed, ${failed} failed.`,
  );
  if (failed > 0) {
    process.exit(1);
  }
}

runShadowMapsTests();
