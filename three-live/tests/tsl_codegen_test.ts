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
 * @fileoverview End-to-End WebGL2 GLSL ES 300 & WebGPU WGSL `GPURenderBundle`
 * Codegen Tests for `three-live-tsl` (`B2`).
 */

import * as assert from 'assert';
import * as vm from 'vm';
import {getSharedRegistry, registerPlugin} from '../src/plugin';
import {aiPlugin, editScene, type ThreeLiveAIProvider} from '../src/plugins/ai';
import {environmentMapPlugin} from '../src/plugins/envmap';
import {materialsPlugin} from '../src/plugins/materials';
import {morphPlugin} from '../src/plugins/morph';
import {shadowMapsPlugin} from '../src/plugins/shadow-maps';
import {skinningPlugin} from '../src/plugins/skinning';
import THREE from '../src/three-author';
import {glbToUSDZ, sceneToGLB, sceneToUSDZ} from '../src/three-convert';
import {parseGLB, ThreeView} from '../src/three-view';
import {
  compileTslToGlsl,
  compileTslToWgsl,
  fmtShaderFloat,
  installTslExtension,
  serializeTslToUsda,
  setMaterialUniform,
  tslPlugin,
  validateTslGraph,
} from '../src/tsl';
import {
  resetSceneWebGPUDevice,
  resolveSceneRenderBackend,
  setSceneWebGPUDeviceForTests,
  WebGPUSceneAccelerator,
  webgpuScenePlugin,
  type GPUSceneBufferLike,
  type GPUSceneDeviceLike,
  type GPUSceneRenderBundleEncoderLike,
  type GPUSceneTextureLike,
} from '../src/webgpu';
import {SCENE_PBR_WGSL, SCENE_SHADOW_DEPTH_WGSL} from '../src/webgpu/shaders';

console.log('=== Running Loop-Free TSL WebGL2 & WebGPU Codegen Tests (B2) ===');

registerPlugin(environmentMapPlugin);
registerPlugin(materialsPlugin);
registerPlugin(morphPlugin);
registerPlugin(skinningPlugin);
registerPlugin(shadowMapsPlugin);
registerPlugin(tslPlugin);
registerPlugin(webgpuScenePlugin);

// tslint:disable-next-line:no-any
const T = THREE as any;
const {TSL, MeshStandardNodeMaterial} = T;

function assertBalancedBraces(code: string, label: string): void {
  let curly = 0;
  let paren = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '{') curly++;
    else if (ch === '}') curly--;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    assert.ok(curly >= 0, `${label}: unmatched '}' at char ${i}`);
    assert.ok(paren >= 0, `${label}: unmatched ')' at char ${i}`);
  }
  assert.strictEqual(curly, 0, `${label}: balanced '{}'`);
  assert.strictEqual(paren, 0, `${label}: balanced '()'`);
}

// 1. Shader Float Formatting & Zero-User-String Hygiene + Full Op Coverage
{
  assert.strictEqual(fmtShaderFloat(0), '0.0');
  assert.strictEqual(fmtShaderFloat(-0), '0.0');
  assert.strictEqual(fmtShaderFloat(NaN), '0.0');
  assert.strictEqual(fmtShaderFloat(Infinity), '0.0');
  assert.strictEqual(fmtShaderFloat(2), '2.0');
  assert.strictEqual(fmtShaderFloat(1e-8), '1.0e-8');

  // Build a kitchen-sink TSL material exercising all 43 ops & sockets
  const uSecretScalar = TSL.uniform(2.5, 'uSecretInjectionProbeName');
  const uSecretVec = TSL.uniform([0.2, 0.5, 0.8], 'uSecretTintVec');

  const n2 = TSL.simplexNoise2D(
    TSL.uv().mul(4).add(TSL.time.mul(uSecretScalar)),
  );
  const n3 = TSL.simplexNoise3D(TSL.positionWorld.mul(2.0));
  const v2 = TSL.voronoi2D(TSL.uv.mul(6.0), 0.9);
  const chk = TSL.checker(TSL.uv.mul(8.0));
  const trip = TSL.triplanar(3.0, 4.0);
  const rim = TSL.fresnel(2.5);
  const mathMix = n2
    .sub(n3)
    .div(v2.add(0.01))
    .mod(1.0)
    .neg()
    .abs()
    .sign()
    .add(chk.floor().add(chk.ceil()).add(n2.fract()))
    .sqrt()
    .exp()
    .log()
    .sin()
    .cos()
    .atan2(0.5)
    .min(1.0)
    .max(0.0)
    .step(0.5)
    .smoothstep(0.9, n3)
    .clamp(0.0, 1.0);
  const vecOps = TSL.positionLocal
    .cross(TSL.normalLocal)
    .reflect(TSL.normalWorld)
    .normalize()
    .mul(
      TSL.positionLocal
        .distance(TSL.positionWorld)
        .add(TSL.normalWorld.length()),
    )
    .add(TSL.normalWorld.dot(TSL.viewDirection));

  const mat = new MeshStandardNodeMaterial({
    name: 'KitchenSinkMat',
    transparent: true,
    opacity: 0.0, // verify early discard is deferred when opacityNode is set!
  });
  mat.colorNode = TSL.hueShift(
    uSecretVec.mix(TSL.vertexColor.rgb, mathMix),
    TSL.instanceIndex.mul(0.25),
  ).add(vecOps.mul(0.01));
  mat.opacityNode = rim.add(0.2).saturate();
  mat.emissiveNode = TSL.color(0x38bdf8).mul(rim.pow(3.0));
  mat.roughnessNode = trip.remap(0, 1, 0.15, 0.65);
  mat.metalnessNode = v2.oneMinus();
  mat.normalScaleNode = TSL.float(0.75);
  mat.bumpNode = TSL.bumpFromHeight(n3, 1.2);
  mat.positionNode = TSL.positionLocal.add(
    TSL.vec3(0, TSL.sin(TSL.positionLocal.x.mul(4).add(TSL.time)).mul(0.08), 0),
  );

  const rawGraph = mat._serializeTslGraph();
  assert.ok(rawGraph, 'KitchenSink graph serializes');
  const vRes = validateTslGraph(rawGraph);
  assert.strictEqual(vRes.ok, true);
  if (vRes.ok) {
    // Also test scalar-to-vector swizzle (`float` -> `vec3` mask `'xxx'`)
    const scalarSwizRes = validateTslGraph({
      version: 1,
      nodes: [
        {op: 'const', type: 'float', value: [0.42]},
        {op: 'swizzle', type: 'vec3', args: [0], mask: 'xxx'},
      ],
      outputs: {color: 1},
    });
    assert.strictEqual(scalarSwizRes.ok, true);
    if (scalarSwizRes.ok) {
      const swizWgsl = compileTslToWgsl(
        scalarSwizRes.graph,
        SCENE_PBR_WGSL,
        SCENE_SHADOW_DEPTH_WGSL,
      );
      assert.ok(
        swizWgsl.pbrWgsl.includes('vec3<f32>(_t0)') &&
          !swizWgsl.pbrWgsl.includes('_t0.xxx'),
        'Scalar swizzle emits vec3<f32>(_t0), never invalid f32.xxx',
      );
    }

    const baseVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uMVP,uModel;
uniform mat3 uNormalMatrix;
uniform vec4 uUvTransform;
out vec4 vInstTint;
out vec3 vNormal,vWorldPos;
out vec2 vUV;
void main(){
vec3 aPosition=aPos;
vInstTint=vec4(1.0);
vec3 rawN=uNormalMatrix*aNormal;
vNormal=length(rawN)>1e-5?normalize(rawN):vec3(0.0);
vec4 world=uModel*vec4(aPosition,1.0);
vWorldPos=world.xyz;
vUV=aUV;
gl_Position=uMVP*vec4(aPosition,1.0);
}`;
    const baseFS = `#version 300 es
precision highp float;
in vec3 vNormal,vWorldPos;
in vec2 vUV;
in vec4 vInstTint;
uniform vec4 uBaseColor;
uniform vec3 uCameraPos,uEmissiveFactor;
uniform float uMetallic,uRoughness;
out vec4 fragColor;
void main(){
vec4 base=uBaseColor;
if(base.a<0.004)discard;
vec3 em=uEmissiveFactor;
vec3 N=normalize(vNormal);
vec3 V=normalize(uCameraPos-vWorldPos);
float metallic=uMetallic;
float roughness=uRoughness;
roughness=clamp(roughness,0.04,1.0);
metallic=clamp(metallic,0.0,1.0);
vec3 color=base.rgb+em;
float outAlpha=base.a;
fragColor=vec4(color,outAlpha);
}`;

    // Compose with morph + skinning + envmap + materials before TSL!
    const morphed = morphPlugin.onResolveShader!(
      {targets: [{POSITION: 0}]},
      {},
      baseVS,
      baseFS,
    )!;
    const skinned = skinningPlugin.onResolveShader!(
      {attributes: {JOINTS_0: 0, WEIGHTS_0: 1}},
      {},
      morphed.vs,
      morphed.fs,
    )!;
    const compiledGlsl = compileTslToGlsl(vRes.graph, skinned.vs, skinned.fs);

    // Security invariant: ZERO user uniform identifiers in GLSL!
    assert.ok(!compiledGlsl.vs.includes('uSecretInjectionProbeName'));
    assert.ok(!compiledGlsl.fs.includes('uSecretInjectionProbeName'));
    assert.ok(!compiledGlsl.fs.includes('uSecretTintVec'));
    assert.ok(compiledGlsl.fs.includes('uniform vec4 uTslParams[16];'));
    assert.ok(compiledGlsl.vs.includes('skinMatrix*vec4(_tslNewP,1.0)'));
    assertBalancedBraces(compiledGlsl.vs, 'GLSL VS');
    assertBalancedBraces(compiledGlsl.fs, 'GLSL FS');

    const compiledWgsl = compileTslToWgsl(
      vRes.graph,
      SCENE_PBR_WGSL,
      SCENE_SHADOW_DEPTH_WGSL,
    );
    assert.ok(!compiledWgsl.pbrWgsl.includes('uSecretInjectionProbeName'));
    assert.ok(!compiledWgsl.pbrWgsl.includes('uSecretTintVec'));
    assert.ok(compiledWgsl.shadowDepthWgsl !== null);
    assertBalancedBraces(compiledWgsl.pbrWgsl, 'WGSL PBR');
    assertBalancedBraces(compiledWgsl.shadowDepthWgsl!, 'WGSL ShadowDepth');

    // W3C WGSL uniformity invariant: `dpdx(` in `fsMain` MUST precede first `discard;`!
    const fsMainStart = compiledWgsl.pbrWgsl.indexOf('fn fsMain(');
    const fsBody = compiledWgsl.pbrWgsl.slice(fsMainStart);
    const lastDpdx = fsBody.lastIndexOf('dpdx(');
    const firstDiscard = fsBody.indexOf('discard;');
    assert.ok(
      lastDpdx > 0 && firstDiscard > lastDpdx,
      'W3C WGSL uniformity: all dpdx/-dpdy derivatives execute before first discard',
    );
  }
  console.log(
    '   [PASS] GLSL ES 300 & WGSL codegen hygiene, balanced AST & W3C uniformity',
  );
}

// 2. Headless WebGL2 `ThreeView` End-to-End Execution + Multi-Viewer Isolation
{
  function createMockGL() {
    const compiledShaders: string[] = [];
    const uniformVec4Uploads: Float32Array[] = [];
    const uniform1fUploads: Array<{loc: string; val: number}> = [];
    let nextId = 1;
    // tslint:disable-next-line:no-any
    const rawGl: any = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962,
      ELEMENT_ARRAY_BUFFER: 34963,
      STATIC_DRAW: 35044,
      FLOAT: 5126,
      UNSIGNED_SHORT: 5123,
      UNSIGNED_INT: 5125,
      TEXTURE_2D: 3553,
      TEXTURE0: 33984,
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      DEPTH_TEST: 2929,
      BLEND: 3042,
      SRC_ALPHA: 770,
      ONE_MINUS_SRC_ALPHA: 771,
      COLOR_BUFFER_BIT: 16384,
      DEPTH_BUFFER_BIT: 256,
      FRAMEBUFFER: 36160,
      RENDERBUFFER: 36161,
      COLOR_ATTACHMENT0: 36064,
      DEPTH_ATTACHMENT: 36096,
      DEPTH_COMPONENT16: 33189,
      NEAREST: 9728,
      LINEAR: 9729,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      TRIANGLES: 4,
      canvas: {
        width: 256,
        height: 256,
        clientWidth: 256,
        clientHeight: 256,
        style: {},
        setAttribute: () => {},
        getAttribute: () => null,
        hasAttribute: () => false,
        addEventListener: () => {},
        removeEventListener: () => {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 256,
          height: 256,
        }),
        getContext: (kind: string) => (kind === 'webgl2' ? gl : null),
      },
      createShader: () => ({id: nextId++}),
      shaderSource: (_sh: unknown, src: string) => {
        compiledShaders.push(src);
      },
      compileShader: () => {},
      getShaderParameter: () => true,
      getShaderInfoLog: () => '',
      deleteShader: () => {},
      createProgram: () => ({progId: nextId++}),
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => true,
      getProgramInfoLog: () => '',
      deleteProgram: () => {},
      useProgram: () => {},
      getUniformLocation: (_p: unknown, name: string) => ({name}),
      createVertexArray: () => ({vaoId: nextId++}),
      bindVertexArray: () => {},
      deleteVertexArray: () => {},
      createBuffer: () => ({bufId: nextId++}),
      bindBuffer: () => {},
      bufferData: () => {},
      deleteBuffer: () => {},
      enableVertexAttribArray: () => {},
      vertexAttribPointer: () => {},
      createFramebuffer: () => ({fboId: nextId++}),
      bindFramebuffer: () => {},
      deleteFramebuffer: () => {},
      framebufferTexture2D: () => {},
      createRenderbuffer: () => ({rboId: nextId++}),
      bindRenderbuffer: () => {},
      renderbufferStorage: () => {},
      framebufferRenderbuffer: () => {},
      deleteRenderbuffer: () => {},
      createTexture: () => ({texId: nextId++}),
      bindTexture: () => {},
      texImage2D: () => {},
      texParameteri: () => {},
      activeTexture: () => {},
      deleteTexture: () => {},
      viewport: () => {},
      enable: () => {},
      disable: () => {},
      depthMask: () => {},
      blendFunc: () => {},
      clearColor: () => {},
      clear: () => {},
      uniform1i: () => {},
      uniform1f: (loc: {name?: string} | null, v: number) => {
        if (loc?.name) uniform1fUploads.push({loc: loc.name, val: v});
      },
      uniform2f: () => {},
      uniform3f: () => {},
      uniform3fv: () => {},
      uniform4f: () => {},
      uniform4fv: (
        loc: {name?: string} | null,
        arr: Float32Array,
        srcOff = 0,
        srcLen?: number,
      ) => {
        if (loc?.name?.startsWith('uTslParams')) {
          uniformVec4Uploads.push(
            arr.slice(srcOff, srcOff + (srcLen ?? arr.length)),
          );
        }
      },
      uniformMatrix3fv: () => {},
      uniformMatrix4fv: () => {},
      drawElements: () => {},
      drawArrays: () => {},
      getParameter: () => null,
    };
    const noop = () => {};
    // tslint:disable-next-line:no-any
    const gl: any = new Proxy(rawGl, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return noop;
      },
    });
    rawGl.canvas.getContext = (kind: string) => (kind === 'webgl2' ? gl : null);
    return {gl, compiledShaders, uniformVec4Uploads, uniform1fUploads};
  }

  const scene = new THREE.Scene();
  const uSpeed = TSL.uniform(3.0, 'uPulseSpeed');
  const uTint = TSL.uniform(new THREE.Color(0x00ff88), 'uTint');
  const holo = new MeshStandardNodeMaterial({
    name: 'HoloShield',
    transparent: true,
    roughness: 0.2,
  });
  holo.emissiveNode = uTint.mul(
    TSL.fresnel(2.0).add(TSL.sin(TSL.time.mul(uSpeed)).mul(0.25)),
  );
  holo.opacityNode = TSL.fresnel(2.0).clamp(0.1, 0.9);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), holo));

  const sharedGlbData = parseGLB(sceneToGLB(scene));

  const mockA = createMockGL();
  const mockB = createMockGL();
  const makeContainer = () =>
    ({
      clientWidth: 256,
      clientHeight: 256,
      addEventListener: () => {},
      removeEventListener: () => {},
      hasAttribute: () => false,
      getAttribute: () => null,
    }) as unknown as HTMLElement;

  const viewerA = new ThreeView(makeContainer(), mockA.gl.canvas, {
    autoStart: false,
  });
  const viewerB = new ThreeView(makeContainer(), mockB.gl.canvas, {
    autoStart: false,
  });
  viewerA.loadGLBData(sharedGlbData);
  viewerB.loadGLBData(sharedGlbData);

  assert.ok(
    mockA.compiledShaders.some((s) =>
      s.includes('uniform vec4 uTslParams[16];'),
    ),
    'ThreeView compiles TSL custom shader via onResolveShader',
  );
  assert.ok(
    mockA.uniformVec4Uploads.length > 0,
    'Initial draw binds uTslParams',
  );

  // Update uPulseSpeed ONLY on viewerA -> viewerB must stay untouched!
  mockA.uniformVec4Uploads.length = 0;
  mockB.uniformVec4Uploads.length = 0;
  // tslint:disable-next-line:no-any
  const okUpdate = (viewerA as any).setMaterialUniform(
    'HoloShield',
    'uPulseSpeed',
    12.5,
  );
  assert.strictEqual(okUpdate, true, 'viewer.setMaterialUniform returns true');
  assert.ok(
    mockA.uniformVec4Uploads.length > 0,
    'setMaterialUniform triggers render when idle',
  );
  const latestA = mockA.uniformVec4Uploads[mockA.uniformVec4Uploads.length - 1];
  viewerB.render();
  const latestB = mockB.uniformVec4Uploads[mockB.uniformVec4Uploads.length - 1];
  assert.strictEqual(latestA[0], 12.5, 'viewerA uPulseSpeed updated to 12.5');
  assert.strictEqual(latestB[0], 3.0, 'viewerB uPulseSpeed isolated at 3.0');

  // Wildcard material target `'*'` + THREE.Color value
  assert.strictEqual(
    setMaterialUniform(viewerA, '*', 'uTint', new THREE.Color(1, 0.25, 0.5)),
    true,
  );
  const afterTint =
    mockA.uniformVec4Uploads[mockA.uniformVec4Uploads.length - 1];
  assert.strictEqual(afterTint[4], 1.0);
  assert.strictEqual(afterTint[5], 0.25);
  assert.strictEqual(afterTint[6], 0.5);

  // Advance `onUpdate` time and verify `uTslTime` advances + wraps cleanly
  mockA.uniform1fUploads.length = 0;
  tslPlugin.onUpdate!(viewerA, 0.2);
  viewerA.render();
  const timeUp = mockA.uniform1fUploads.find((u) => u.loc === 'uTslTime');
  assert.ok(
    timeUp && Math.abs(timeUp.val - 0.2) < 1e-4,
    'uTslTime advances to 0.2s',
  );

  // Context restore & dispose
  viewerA.restoreContext();
  viewerA.dispose();
  viewerB.dispose();
  console.log(
    '   [PASS] WebGL2 ThreeView TSL shader execution, live setMaterialUniform & multi-viewer isolation',
  );
}

// 3. WebGPU `GPURenderBundle` Scene Accelerator End-to-End Execution
{
  const createdShaders: string[] = [];
  const tslBufferWrites: Float32Array[] = [];
  let createdTslPipelines = 0;

  function createMockWebGPUDevice(): GPUSceneDeviceLike {
    const makeBuf = (size: number): GPUSceneBufferLike => {
      const ab = new ArrayBuffer(Math.max(16, size));
      return {
        getMappedRange: () => ab,
        mapAsync: async () => {},
        unmap: () => {},
        destroy: () => {},
      };
    };
    const makeTex = (): GPUSceneTextureLike => ({
      createView: () => ({}),
      destroy: () => {},
    });
    return {
      queue: {
        writeBuffer: (_buf, _off, data) => {
          if (data instanceof Float32Array && data.length === 68) {
            tslBufferWrites.push(new Float32Array(data));
          }
        },
        writeTexture: () => {},
        submit: () => {},
      },
      createBuffer: (desc) => makeBuf(desc.size),
      createTexture: () => makeTex(),
      createSampler: () => ({}),
      createShaderModule: (desc) => {
        createdShaders.push(desc.code);
        return {code: desc.code};
      },
      createBindGroupLayout: (desc) => ({desc}),
      createPipelineLayout: (desc: unknown) => {
        const bgls = (desc as {bindGroupLayouts?: unknown[]}).bindGroupLayouts;
        return {bglCount: bgls?.length ?? 0};
      },
      createRenderPipeline: (desc: unknown) => {
        const layout = (desc as {layout?: {bglCount?: number}}).layout;
        if (layout?.bglCount === 3 || layout?.bglCount === 2) {
          createdTslPipelines++;
        }
        return {desc};
      },
      createRenderBundleEncoder: (): GPUSceneRenderBundleEncoderLike => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        setVertexBuffer: () => {},
        setIndexBuffer: () => {},
        draw: () => {},
        drawIndexed: () => {},
        finish: () => ({}),
      }),
      createBindGroup: (desc) => ({desc}),
      createCommandEncoder: () => ({
        beginRenderPass: () => ({
          setPipeline: () => {},
          setBindGroup: () => {},
          executeBundles: () => {},
          draw: () => {},
          end: () => {},
        }),
        finish: () => ({}),
      }),
    };
  }

  // Install minimal DOM mock for WebGPU overlay canvas
  // tslint:disable-next-line:no-any
  const prevDoc = (globalThis as any).document;
  // tslint:disable-next-line:no-any
  (globalThis as any).document = {
    createElement: () => ({
      className: '',
      style: {cssText: ''},
      width: 256,
      height: 256,
      getContext: (kind: string) =>
        kind === 'webgpu'
          ? {
              configure: () => {},
              getCurrentTexture: () => ({createView: () => ({})}),
            }
          : null,
      remove: () => {},
    }),
  };

  try {
    const gpuDev = createMockWebGPUDevice();
    setSceneWebGPUDeviceForTests(gpuDev);

    const scene = new THREE.Scene();
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(3, 6, 4);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const waveMat = new MeshStandardNodeMaterial({
      name: 'WaveFlag',
      color: 0x38bdf8,
    });
    const uAmp = TSL.uniform(0.12, 'uWaveAmp');
    waveMat.positionNode = TSL.positionLocal.add(
      TSL.vec3(
        0,
        TSL.sin(TSL.positionLocal.x.mul(5).add(TSL.time)).mul(uAmp),
        0,
      ),
    );
    waveMat.colorNode = TSL.mix(
      TSL.color(0x0284c7),
      TSL.color(0x38bdf8),
      TSL.uv.x,
    );
    const flagMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 1, 8, 4),
      waveMat,
    );
    flagMesh.castShadow = true;
    flagMesh.receiveShadow = true;
    scene.add(flagMesh);

    const glbData = parseGLB(sceneToGLB(scene));
    const parentNode = {
      insertBefore: () => {},
      querySelector: () => null,
    };
    const glCanvas = {
      width: 256,
      height: 256,
      clientWidth: 256,
      clientHeight: 256,
      parentElement: parentNode,
      nextSibling: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({left: 0, top: 0, width: 256, height: 256}),
    };
    // Build minimal viewer state via `tslPlugin.onLoadModel`
    const fakeViewer = {
      gl: {canvas: glCanvas} as unknown as WebGL2RenderingContext,
      canvas: glCanvas as unknown as HTMLCanvasElement,
      container: {
        getAttribute: (n: string) => (n === 'renderer' ? 'auto' : null),
        hasAttribute: () => false,
      },
      gltf: glbData.gltf,
      renderProg: {baseProg: true},
      bounds: {
        center: [0, 0, 0] as [number, number, number],
        radius: 2,
        min: [-1, -1, -1] as [number, number, number],
        max: [1, 1, 1] as [number, number, number],
      },
      lights: [
        {
          type: 'directional' as const,
          color: [1, 1, 1],
          intensity: 2,
          position: [3, 6, 4],
          direction: [0.4, 0.8, 0.5],
          shadow: {cast: true, mapSize: 1024},
        },
      ],
      meshes: [
        {
          name: 'Flag',
          castShadow: true,
          receiveShadow: true,
          transform: new Float32Array([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
          ]),
          primitives: [
            {
              positions: new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]),
              normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
              uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]),
              indices: new Uint16Array([0, 1, 2]),
              indexCount: 3,
              materialIndex: 0,
              customProgram: {tslProg: true},
              pluginData: {tsl: {hash: 'tsl', materialIndex: 0}},
            },
          ],
        },
      ],
    };
    tslPlugin.onLoadModel!(fakeViewer, glbData.gltf);

    // Crucial: `renderer="auto"` stays on WebGPU rather than falling back to WebGL2!
    assert.strictEqual(
      resolveSceneRenderBackend(fakeViewer, true),
      'webgpu',
      'TSL customProgram stays on WebGPU GPURenderBundle backend in auto mode',
    );

    const accel = new WebGPUSceneAccelerator();
    const idMat = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    const drew1 = accel.renderScene(
      fakeViewer,
      idMat,
      idMat,
      idMat,
      [0, 1, 4],
      0,
      [0, 0, 256, 256],
      'none',
      true,
      false,
    );
    assert.strictEqual(drew1, true, 'WebGPU renders TSL scene on frame 1');
    assert.strictEqual(
      accel.bundleRecordCount,
      1,
      'Recorded 1 GPURenderBundle',
    );
    assert.strictEqual(
      accel.shadowPassCount,
      1,
      'Rendered initial displaced shadow slice',
    );
    assert.ok(
      createdTslPipelines >= 2,
      'Compiled TSL PBR + TSL shadow-depth pipelines',
    );
    assert.ok(
      createdShaders.some((c) =>
        c.includes('@group(2) @binding(0) var<uniform> tslU'),
      ),
      'Compiled WGSL binds @group(2) TSL uniform block',
    );

    // Orbit frame without time/uniform change -> 0 bundle re-records AND shadow cache hit!
    accel.renderScene(
      fakeViewer,
      idMat,
      idMat,
      idMat,
      [2, 1, 3],
      0,
      [0, 0, 256, 256],
      'none',
      true,
      false,
    );
    assert.strictEqual(
      accel.bundleRecordCount,
      1,
      '0 bundle re-records on orbit',
    );
    assert.strictEqual(
      accel.shadowCacheHits,
      1,
      'Shadow map cache hits when TSL static',
    );

    // Update TSL uniform -> writes 272B uniform buffer, 0 bundle re-records, refreshes displaced shadow!
    const prevWrites = tslBufferWrites.length;
    setMaterialUniform(fakeViewer, 'WaveFlag', 'uWaveAmp', 0.35);
    accel.renderScene(
      fakeViewer,
      idMat,
      idMat,
      idMat,
      [2, 1, 3],
      0,
      [0, 0, 256, 256],
      'none',
      true,
      false,
    );
    assert.strictEqual(
      accel.bundleRecordCount,
      1,
      'setMaterialUniform updates GPU uniform buffer with 0 GPURenderBundle re-records',
    );
    assert.ok(
      tslBufferWrites.length > prevWrites,
      'Uploaded updated 272B TSL uniform block',
    );
    assert.strictEqual(
      tslBufferWrites[tslBufferWrites.length - 1][0],
      Math.fround(0.35),
    );
    assert.strictEqual(
      accel.shadowPassCount,
      2,
      'Vertex-displaced TSL update invalidates shadow slice cleanly',
    );

    accel.disposeViewer(fakeViewer);
  } finally {
    resetSceneWebGPUDevice();
    // tslint:disable-next-line:no-any
    (globalThis as any).document = prevDoc;
  }
  console.log(
    '   [PASS] WebGPU GPURenderBundle TSL pipeline, 272B uniform upload & displaced shadow pass',
  );
}

// 4. B2 Audit Edge Cases: standalone normalScaleNode, auto-BLEND opacityNode & KHR_materials_variants
{
  // 4a. `opacityNode` without explicit `transparent: true` auto-promotes `alphaMode: 'BLEND'`
  const autoBlendScene = new THREE.Scene();
  const autoGlass = new MeshStandardNodeMaterial({name: 'AutoBlendShield'});
  autoGlass.opacityNode = TSL.fresnel(2.5);
  autoBlendScene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), autoGlass));
  const autoBlendGltf = parseGLB(sceneToGLB(autoBlendScene)).gltf;
  assert.strictEqual(
    autoBlendGltf.materials[0].alphaMode,
    'BLEND',
    'opacityNode without explicit transparent: true auto-promotes alphaMode: BLEND',
  );

  // 4b. Standalone `normalScaleNode` (without `bumpNode`) modulates normalMap in GLSL & WGSL
  const nsRes = validateTslGraph({
    version: 1,
    uniforms: {uNScale: {type: 'float', value: 1.5}},
    nodes: [{op: 'uniform', name: 'uNScale', type: 'float'}],
    outputs: {normalScale: 0},
  });
  assert.strictEqual(nsRes.ok, true);
  if (nsRes.ok) {
    const nsFsBase = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vNormal,vWorldPos;
in vec4 vInstTint;
uniform sampler2D uNormalTexture;
uniform int uHasNormalTexture;
uniform float uNormalScale,uMetallic,uRoughness;
uniform vec3 uCameraPos;
out vec4 fragColor;
vec3 perturbNormal(vec3 N,vec3 V,vec2 uv,sampler2D tex,float s){return N*s;}
void main(){
vec3 N=normalize(vNormal);
vec3 V=normalize(uCameraPos-vWorldPos);
if(uHasNormalTexture==1){
N=perturbNormal(N,V,vUV,uNormalTexture,uNormalScale);
}
float metallic=uMetallic;
float roughness=uRoughness;
roughness=clamp(roughness,0.04,1.0);
metallic=clamp(metallic,0.0,1.0);
fragColor=vec4(N,1.0);
}`;
    const nsGlsl = compileTslToGlsl(
      nsRes.graph,
      'out vec2 vUV;\nvoid main(){vec3 aPosition=vec3(0.0);vec3 aNormal=vec3(0.0,1.0,0.0);gl_Position=vec4(0.0);}',
      nsFsBase,
    );
    assert.ok(
      nsGlsl.fs.includes(
        'perturbNormal(_tslBaseN,V,vUV,uNormalTexture,max(_t0,0.0))',
      ),
      'Standalone normalScaleNode dynamically scales uNormalTexture in GLSL',
    );
    const nsWgsl = compileTslToWgsl(
      nsRes.graph,
      SCENE_PBR_WGSL,
      SCENE_SHADOW_DEPTH_WGSL,
    );
    assert.ok(
      nsWgsl.pbrWgsl.includes('q = vec3<f32>(q.xy * max(_t0, 0.0), q.z);'),
      'Standalone normalScaleNode dynamically scales normTex in WGSL',
    );
  }

  // 4c. `KHR_materials_variants` (`selectVariant`) switching Standard PBR <-> TSL on WebGPU
  const varScene = new THREE.Scene();
  const stdMat = new THREE.MeshStandardMaterial({
    name: 'MatteBase',
    color: 0x64748b,
  });
  const tslVarMat = new MeshStandardNodeMaterial({
    name: 'PlasmaVariant',
    color: 0x0ea5e9,
  });
  tslVarMat.emissiveNode = TSL.color(0x38bdf8).mul(TSL.fresnel(2.0));
  const varMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stdMat);
  varMesh.userData = {variants: {Matte: stdMat, Plasma: tslVarMat}};
  varScene.add(varMesh);

  const varGlb = parseGLB(sceneToGLB(varScene));
  const variantViewer = {
    gl: {canvas: {}} as unknown as WebGL2RenderingContext,
    container: {
      getAttribute: (n: string) => (n === 'renderer' ? 'auto' : null),
      hasAttribute: () => false,
    },
    gltf: varGlb.gltf,
    renderProg: {stdProg: true},
    meshes: [
      {
        name: 'Box',
        transform: new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        ]),
        primitives: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            materialIndex: 0, // starts on Standard PBR (`pluginData.tsl` NOT set!)
            customProgram: null as unknown,
          },
        ],
      },
    ],
  };
  tslPlugin.onLoadModel!(variantViewer, varGlb.gltf);
  assert.strictEqual(resolveSceneRenderBackend(variantViewer, true), 'webgpu');

  // Simulate `selectVariant('Plasma')`: `materialIndex` switches to 1 with custom TSL program
  variantViewer.meshes[0].primitives[0].materialIndex = 1;
  variantViewer.meshes[0].primitives[0].customProgram = {tslProg: true};
  assert.strictEqual(
    resolveSceneRenderBackend(variantViewer, true),
    'webgpu',
    'selectVariant switching from Standard PBR to TSL material stays on WebGPU',
  );
  console.log(
    '   [PASS] Standalone normalScaleNode, auto-BLEND opacityNode & KHR_materials_variants parity',
  );
}

// 5. USDZ `MaterialX` / `UsdShade` NodeGraph Export (`sceneToUSDZ` + `glbToUSDZ` + 64-byte alignment)
{
  const usdScene = new THREE.Scene();
  const uSecretUsd = TSL.uniform(4.0, 'uSecretUsdUniformProbe');
  const uTintUsd = TSL.uniform(
    new THREE.Color(0x38bdf8),
    'uSecretUsdColorProbe',
  );
  const usdMat = new MeshStandardNodeMaterial({name: 'HoloUsdMat'});
  const n3 = TSL.simplexNoise3D(TSL.positionWorld.mul(3.0));
  const rim = TSL.fresnel(2.0);
  const pulse = TSL.sin(TSL.time.mul(uSecretUsd)).mul(0.5).add(0.5);
  usdMat.colorNode = TSL.mix(TSL.color(0x0284c7), uTintUsd, n3);
  usdMat.emissiveNode = uTintUsd.mul(rim.add(pulse.mul(0.3)));
  usdMat.opacityNode = rim.clamp(0.15, 0.92);
  usdMat.roughnessNode = TSL.remap(n3, 0, 1, 0.1, 0.6);
  usdMat.metalnessNode = TSL.checker(TSL.uv.mul(4.0)).mul(0.8);
  usdMat.bumpNode = TSL.bumpFromHeight(
    TSL.voronoi2D(TSL.uv.mul(6.0), 0.7),
    0.25,
  );

  const usdMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), usdMat);
  usdScene.add(usdMesh);

  const directUsdz = sceneToUSDZ(usdScene);
  const glbRoundtripUsdz = glbToUSDZ(sceneToGLB(usdScene));

  for (const [label, usdz] of [
    ['sceneToUSDZ', directUsdz],
    ['glbToUSDZ', glbRoundtripUsdz],
  ] as const) {
    assert.strictEqual(usdz[0], 0x50, `${label}: valid PK zip header`);
    assert.strictEqual(usdz[1], 0x4b);
    const fnLen = usdz[26] | (usdz[27] << 8);
    const extraLen = usdz[28] | (usdz[29] << 8);
    const payloadOffset = 30 + fnLen + extraLen;
    assert.strictEqual(
      payloadOffset % 64,
      0,
      `${label}: Apple Quick Look 64-byte payload alignment`,
    );
    const usda = new TextDecoder().decode(usdz);
    assert.ok(
      usda.includes('def NodeGraph "TSLGraph"'),
      `${label}: TSLGraph present`,
    );
    assert.ok(
      usda.includes('ND_time_float'),
      `${label}: ND_time_float emitted`,
    );
    assert.ok(
      usda.includes('ND_noise3d_float'),
      `${label}: ND_noise3d_float emitted`,
    );
    assert.ok(
      usda.includes('ND_cellnoise2d_float'),
      `${label}: ND_cellnoise2d_float emitted`,
    );
    assert.ok(
      usda.includes('ND_heighttonormal_vector3'),
      `${label}: bump heighttonormal emitted`,
    );
    assert.ok(
      usda.includes(
        'color3f inputs:diffuseColor.connect = </Root/Materials/HoloUsdMat/TSLGraph.outputs:diffuseColor>',
      ),
    );
    assert.ok(
      usda.includes(
        'color3f inputs:emissiveColor.connect = </Root/Materials/HoloUsdMat/TSLGraph.outputs:emissiveColor>',
      ),
    );
    assert.ok(
      usda.includes(
        'float inputs:opacity.connect = </Root/Materials/HoloUsdMat/TSLGraph.outputs:opacity>',
      ),
    );
    assert.ok(
      usda.includes('endTimeCode = 60'),
      `${label}: animated stage timing emitted`,
    );
    assert.ok(
      !usda.includes('uSecretUsdUniformProbe') &&
        !usda.includes('uSecretUsdColorProbe'),
      `${label}: zero user uniform identifiers in USDA`,
    );
    assertBalancedBraces(
      serializeTslToUsda(usdMat._serializeTslGraph(), 'HoloUsdMat')!
        .nodeGraphUsda,
      `${label} NodeGraph`,
    );
  }
  console.log(
    '   [PASS] USDZ MaterialX / UsdShade NodeGraph export, 64-byte alignment & identifier hygiene',
  );
}

// 6. Isolated V8 Worker-Realm Serialization & `three-live-ai` `editScene()` TSL Integration
(async () => {
  // 6a. Verify `installTslExtension.toString()` is 100% self-contained in an empty V8 realm
  const installerSource = installTslExtension.toString();
  assert.ok(
    !installerSource.includes('__publicField'),
    'installTslExtension must not emit external __publicField helper calls',
  );
  const emptyRealm = vm.createContext(Object.create(null));
  const realmCheckScript = `
    (function() {
      const installer = (${installTslExtension.toString()});
      class FakeColor {
        constructor(v) {
          this.isColor = true;
          this.r = typeof v === 'number' ? ((v >> 16) & 255) / 255 : 0.2;
          this.g = typeof v === 'number' ? ((v >> 8) & 255) / 255 : 0.7;
          this.b = typeof v === 'number' ? (v & 255) / 255 : 0.9;
        }
        copy(other) { this.r = other.r; this.g = other.g; this.b = other.b; return this; }
      }
      class FakeVec2 {
        constructor() { this.x = 1; this.y = 1; }
        copy(other) { this.x = other.x; this.y = other.y; return this; }
      }
      class FakeMeshPhysicalMaterial {
        constructor(opts = {}) {
          this.name = opts.name || '';
          this.color = new FakeColor(opts.color ?? 0xffffff);
          this.emissive = new FakeColor(0x000000);
          this.normalScale = new FakeVec2();
          this.sheenColor = new FakeColor(0x000000);
          this.attenuationColor = new FakeColor(0xffffff);
          this.transparent = Boolean(opts.transparent);
          this.alphaTest = Number(opts.alphaTest || 0);
        }
      }
      const warnings = [];
      const reg = { authorNamespace: {} };
      const fakeThree = {
        Color: FakeColor,
        MeshPhysicalMaterial: FakeMeshPhysicalMaterial,
        warnUnsupported: (d, f) => warnings.push(d + ' -> ' + f),
      };
      const ext = installer(fakeThree, reg);
      const T = ext.TSL;
      const mat = new ext.MeshStandardNodeMaterial({ name: 'WorkerShield' });
      const uSpd = T.uniform(3.5, 'uSpd');
      mat.colorNode = T.mix(T.color(0x0284c7), T.color(0x38bdf8), T.voronoi2D(T.uv.mul(5.0), 0.8));
      mat.emissiveNode = T.color(0x38bdf8).mul(T.fresnel(2.0).add(T.sin(T.time.mul(uSpd)).mul(0.25)));
      mat.opacityNode = T.fresnel(2.0).clamp(0.1, 0.9);
      mat.positionNode = T.positionLocal.add(T.normalLocal.mul(0.02));
      const cloned = mat.clone();
      return {
        transparent: mat.transparent,
        clonedTransparent: cloned.transparent,
        warningsCount: warnings.length,
        ir: mat._serializeTslGraph(),
      };
    })()
  `;
  const realmOut = vm.runInContext(realmCheckScript, emptyRealm) as {
    transparent: boolean;
    clonedTransparent: boolean;
    warningsCount: number;
    ir: unknown;
  };
  assert.strictEqual(
    realmOut.transparent,
    true,
    'Worker realm opacityNode auto-sets transparent=true',
  );
  assert.strictEqual(realmOut.clonedTransparent, true);
  assert.strictEqual(realmOut.warningsCount, 0);
  const realmValidated = validateTslGraph(realmOut.ir, 'WorkerShield');
  assert.ok(
    realmValidated.ok,
    'Worker-realm serialized TSL graph passes validator cleanly',
  );
  if (realmValidated.ok) {
    assert.strictEqual(realmValidated.graph.usesTime, true);
    assert.strictEqual(realmValidated.graph.usesVertexPosition, true);
    assert.strictEqual(realmValidated.graph.uniformSlots.length, 1);
  }

  // 6b. Verify `three-live-ai` `editScene()` system prompt & live TSL repair + hot-swap
  const prevRunner = getSharedRegistry().scriptRunner;
  try {
    getSharedRegistry().scriptRunner = {
      // tslint:disable-next-line:no-any
      async execute(script: string, _sandbox: string, cb: any) {
        try {
          const s = new THREE.Scene();
          // eslint-disable-next-line no-new-func
          new Function('THREE', 'scene', 'camera', script)(THREE, s, {});
          const glb = s.toGLB();
          cb.onModelReady(
            glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
          );
        } catch (err) {
          cb.onError?.(err);
        }
        return {terminate() {}};
      },
    };

    const baseScript = [
      'const orb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), new THREE.MeshStandardMaterial({ color: 0x38bdf8 }));',
      'orb.name = "HoloOrb";',
      'scene.add(orb);',
    ].join('\n');

    const executedScripts: string[] = [];
    // tslint:disable-next-line:no-any
    const fakeEl: any = {
      allowClientScripts: true,
      sandbox: 'worker',
      selectedMesh: 'HoloOrb',
      querySelector: () => ({textContent: baseScript}),
      getAttribute: () => null,
      fireEvent: () => {},
      async executeScript(code: string) {
        executedScripts.push(code);
      },
    };
    aiPlugin.onElementConnected?.(fakeEl);

    const seenMessages: unknown[] = [];
    const tslEditedReply = [
      '```js',
      'const TSL = THREE.TSL;',
      'const uPulse = TSL.uniform(4.0, "uPulse");',
      'const mat = new THREE.MeshStandardNodeMaterial({ name: "OrbHoloMat", roughness: 0.15 });',
      'mat.colorNode = TSL.color(0x38bdf8);',
      'mat.emissiveNode = TSL.color(0x38bdf8).mul(TSL.fresnel(2.2).add(TSL.sin(TSL.time.mul(uPulse)).mul(0.3)));',
      'mat.opacityNode = TSL.fresnel(2.2).clamp(0.15, 0.9);',
      'const orb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), mat);',
      'orb.name = "HoloOrb";',
      'scene.add(orb);',
      '```',
    ].join('\n');

    let turn = 0;
    const provider: ThreeLiveAIProvider = {
      async complete(req) {
        seenMessages.push(req.messages);
        turn++;
        if (turn === 1) {
          // Deliberately broken syntax on turn 1 to exercise the repair turn!
          return '```js\nconst orb = new THREE.Mesh(\n```';
        }
        return tslEditedReply;
      },
    };

    const editRes = await editScene(
      fakeEl,
      'give HoloOrb an animated holographic Fresnel TSL material',
      {provider, maxRepairs: 1},
    );
    assert.strictEqual(
      editRes.applied,
      true,
      `editScene applied: ${editRes.error}`,
    );
    assert.strictEqual(editRes.repairs, 1, 'repaired after 1 failed turn');
    assert.strictEqual(executedScripts.length, 1);
    const firstTurnMsgs = seenMessages[0] as Array<{
      role: string;
      content: string;
    }>;
    assert.ok(
      firstTurnMsgs[0].content.includes('MeshStandardNodeMaterial') &&
        firstTurnMsgs[0].content.includes('THREE.TSL'),
      'SYSTEM_PROMPT teaches LLM about MeshStandardNodeMaterial & loop-free THREE.TSL',
    );
    // Verify grazing-angle slope clamp in _tslBump across GLSL & WGSL
    const bumpScene = new THREE.Scene();
    const bumpMat = new THREE.MeshStandardNodeMaterial({
      name: 'GrazingFloorMat',
      side: THREE.FrontSide,
    });
    bumpMat.bumpNode = TSL.bumpFromHeight(
      TSL.simplexNoise2D(TSL.uv.mul(250.0)),
      0.08,
    );
    bumpScene.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), bumpMat));
    const bumpGlb = parseGLB(bumpScene.toGLB());
    assert.strictEqual(
      bumpGlb.gltf.materials[0].doubleSided,
      false,
      'MeshStandardNodeMaterial honors side: THREE.FrontSide -> doubleSided: false',
    );
    const bumpRes = validateTslGraph(
      bumpGlb.gltf.materials[0].extras.tsl,
      'GrazingFloorMat',
    );
    assert.strictEqual(bumpRes.ok, true);
    if (bumpRes.ok) {
      const glslBump = compileTslToGlsl(
        bumpRes.graph,
        'out vec2 vUV;\nvoid main(){\ngl_Position=vec4(0.0);\n}',
        'in vec2 vUV;\nvoid main(){\nmetallic=clamp(metallic,0.0,1.0);\n}',
      );
      const wgslBump = compileTslToWgsl(bumpRes.graph, SCENE_PBR_WGSL, null);
      assert.ok(
        glslBump.fs.includes('0.85*ad/max(gl,1e-8)'),
        'GLSL _tslBump clamps grazing-angle tangent gradient slope',
      );
      assert.ok(
        wgslBump.pbrWgsl.includes('0.85*ad/max(length(g),1e-8)'),
        'WGSL _tslBump clamps grazing-angle tangent gradient slope',
      );
    }
    console.log(
      '   [PASS] Isolated V8 Worker-realm serialization & three-live-ai editScene() TSL authoring',
    );
    console.log('=== All Loop-Free TSL B2/B3/B4 Codegen Tests Passed! ===');
  } finally {
    getSharedRegistry().scriptRunner = prevRunner;
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
