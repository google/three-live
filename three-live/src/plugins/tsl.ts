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
 * @fileoverview Loop-Free TSL Runtime Plugin (`tslPlugin`) for `<three-live>`
 * and `<xr-live>`.
 *
 * Installs `THREE.TSL` & `MeshStandardNodeMaterial` on both the main thread and
 * sandboxed Web Workers, compiles validated `GOOGLE_material_tsl` graphs to
 * WebGL2 GLSL ES 300 (with structural-hash shader caching and zero-allocation
 * uniform binding) and WebGPU WGSL `GPURenderBundle`s, drives `TSL.time`
 * animation ticks automatically, and exposes `setMaterialUniform` for 60 Hz
 * host parameter updates without recompiling shaders.
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
  type TslMaterialRuntimeState,
} from '../plugin';
import {installTslExtension} from '../tsl/author';
import {compileTslToGlsl} from '../tsl/glsl';
import {
  packUniformVec4,
  TSL_EXTENSION_NAME,
  TSL_TIME_PERIOD_SEC,
  tslSafeMod,
  validateTslGraph,
  type ValidatedTslGraph,
} from '../tsl/ir';
import {serializeTslToUsda} from '../tsl/usdz';
import {compileTslToWgsl} from '../tsl/wgsl';

interface TslMaterialInstance extends TslMaterialRuntimeState {
  readonly name: string;
  readonly graph: ValidatedTslGraph;
  version: number;
}

interface ViewerTslState {
  materialsByIndex: Map<number, TslMaterialInstance>;
  materialsByName: Map<string, TslMaterialInstance[]>;
  hasAnimatedTsl: boolean;
  elapsedSec: number;
}

interface ProgramUniformLocs {
  readonly paramsLoc: WebGLUniformLocation | null;
  readonly timeLoc: WebGLUniformLocation | null;
}

const viewerStateMap = new WeakMap<object, ViewerTslState>();
const glStateMap = new WeakMap<object, ViewerTslState>();
const programLocCache = new WeakMap<WebGLProgram, ProgramUniformLocs>();
const glslSourceCache = new Map<string, {vs: string; fs: string}>();
const MAX_GLSL_SOURCE_CACHE = 128;

function getProgramLocs(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
): ProgramUniformLocs {
  let cached = programLocCache.get(prog);
  if (!cached) {
    cached = {
      paramsLoc:
        gl.getUniformLocation(prog, 'uTslParams[0]') ??
        gl.getUniformLocation(prog, 'uTslParams'),
      timeLoc: gl.getUniformLocation(prog, 'uTslTime'),
    };
    programLocCache.set(prog, cached);
  }
  return cached;
}

function createMaterialInstance(
  matName: string,
  graph: ValidatedTslGraph,
): TslMaterialInstance {
  const buf68 = new Float32Array(68);
  for (const slot of graph.uniformSlots) {
    const base = slot.slot * 4;
    buf68[base] = slot.defaultVec4[0];
    buf68[base + 1] = slot.defaultVec4[1];
    buf68[base + 2] = slot.defaultVec4[2];
    buf68[base + 3] = slot.defaultVec4[3];
  }
  return {
    name: matName,
    hash: graph.hash,
    graph,
    buf68,
    usesTime: graph.usesTime,
    usesVertexPosition: graph.usesVertexPosition,
    version: 1,
  };
}

function buildViewerStateFromGltf(
  viewer: object,
  // tslint:disable-next-line:no-any glTF JSON object.
  gltf: any,
): ViewerTslState {
  const materialsByIndex = new Map<number, TslMaterialInstance>();
  const materialsByName = new Map<string, TslMaterialInstance[]>();
  let hasAnimatedTsl = false;

  const rawMats = Array.isArray(gltf?.materials) ? gltf.materials : [];
  for (let i = 0; i < rawMats.length; i++) {
    const mat = rawMats[i];
    const rawExt = mat?.extensions?.[TSL_EXTENSION_NAME];
    if (!rawExt) continue;
    const matName =
      typeof mat.name === 'string' && mat.name.length > 0
        ? mat.name
        : `Material_${i}`;
    const res = validateTslGraph(rawExt, matName);
    if (!res.ok) {
      console.warn(
        `[three-live] [${res.issue.code}] ${res.issue.message} Falling back to base PBR material.`,
      );
      continue;
    }
    const inst = createMaterialInstance(matName, res.graph);
    materialsByIndex.set(i, inst);
    const list = materialsByName.get(matName) ?? [];
    list.push(inst);
    materialsByName.set(matName, list);
    if (res.graph.usesTime) hasAnimatedTsl = true;
  }

  const state: ViewerTslState = {
    materialsByIndex,
    materialsByName,
    hasAnimatedTsl,
    elapsedSec: 0,
  };
  viewerStateMap.set(viewer, state);
  const maybeGl = (viewer as {gl?: unknown}).gl;
  if (maybeGl && typeof maybeGl === 'object') {
    glStateMap.set(maybeGl, state);
  }
  return state;
}

function ensureViewerState(
  viewer: object,
  // tslint:disable-next-line:no-any
  gltfFallback?: any,
): ViewerTslState | null {
  let st = viewerStateMap.get(viewer);
  if (!st) {
    // tslint:disable-next-line:no-any
    const g = gltfFallback ?? (viewer as any).gltf;
    if (!g) return null;
    st = buildViewerStateFromGltf(viewer, g);
  }
  return st;
}

function unpackHostUniformValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (
    typeof raw === 'number' ||
    Array.isArray(raw) ||
    raw instanceof Float32Array
  ) {
    return raw;
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if ('r' in o && 'g' in o && 'b' in o) {
      return [Number(o['r']), Number(o['g']), Number(o['b'])];
    }
    if ('x' in o && 'y' in o && 'z' in o && 'w' in o) {
      return [Number(o['x']), Number(o['y']), Number(o['z']), Number(o['w'])];
    }
    if ('x' in o && 'y' in o && 'z' in o) {
      return [Number(o['x']), Number(o['y']), Number(o['z'])];
    }
    if ('x' in o && 'y' in o) {
      return [Number(o['x']), Number(o['y'])];
    }
  }
  return null;
}

/**
 * Updates a named `TSL.uniform(initialValue, name)` on `viewerOrElement` at
 * 60–120 Hz without recompiling WebGL2 or WebGPU shaders.
 *
 * Pass `materialName = '*'` (or `''`) to update all materials declaring
 * `uniformName`, or pass a specific `material.name`. Returns `true` when at
 * least one uniform slot was updated.
 */
export function setMaterialUniform(
  viewerOrElement: unknown,
  materialName: string,
  uniformName: string,
  value: unknown,
): boolean {
  if (!viewerOrElement || typeof viewerOrElement !== 'object') return false;
  const obj = viewerOrElement as Record<string, unknown>;
  const viewer = (
    obj['viewer'] && typeof obj['viewer'] === 'object'
      ? obj['viewer']
      : viewerOrElement
  ) as Record<string, unknown>;

  const st = ensureViewerState(viewer);
  if (!st || st.materialsByIndex.size === 0) return false;

  const targets: TslMaterialInstance[] =
    materialName === '*' || materialName === ''
      ? Array.from(st.materialsByIndex.values())
      : (st.materialsByName.get(materialName) ?? []);
  if (targets.length === 0) return false;

  const unpacked = unpackHostUniformValue(value);
  if (unpacked === null) return false;

  let updated = false;
  for (const inst of targets) {
    const slot = inst.graph.uniformSlotByName.get(uniformName);
    if (!slot) continue;
    const vec4 = packUniformVec4(slot.type, unpacked);
    if (!vec4) continue;
    const base = slot.slot * 4;
    inst.buf68[base] = vec4[0];
    inst.buf68[base + 1] = vec4[1];
    inst.buf68[base + 2] = vec4[2];
    inst.buf68[base + 3] = vec4[3];
    inst.version++;
    updated = true;
  }

  if (
    updated &&
    viewer['animFrameId'] === null &&
    typeof viewer['render'] === 'function'
  ) {
    (viewer['render'] as () => void)();
  }
  return updated;
}

function attachHostMethods(target: unknown): void {
  if (!target || typeof target !== 'object') return;
  const rec = target as Record<string, unknown>;
  if (typeof rec['setMaterialUniform'] !== 'function') {
    rec['setMaterialUniform'] = (
      materialName: string,
      uniformName: string,
      value: unknown,
    ) => setMaterialUniform(target, materialName, uniformName, value);
  }
}

function registerTslHooks(): void {
  const reg = getSharedRegistry();
  registerWorkerExtensionInstaller(installTslExtension);
  if (reg.threeNamespace) {
    installTslExtension(reg.threeNamespace, reg);
  } else {
    if (!reg.authorNamespace) reg.authorNamespace = {};
    // Install onto a minimal shim if `three-author` loads later; `three-author`
    // also executes `workerExtensionInstallers` on load!
  }
  reg.tslWgslCompiler = (graph, basePbrWgsl, baseShadowDepthWgsl) => {
    if (!graph || typeof graph !== 'object') return null;
    return compileTslToWgsl(
      graph as ValidatedTslGraph,
      basePbrWgsl,
      baseShadowDepthWgsl,
    );
  };
  reg.tslMaterialResolver = (viewer, matIndex) => {
    if (matIndex === undefined || matIndex < 0) return null;
    const st = ensureViewerState(viewer);
    return st?.materialsByIndex.get(matIndex) ?? null;
  };
  reg.tslUsdzSerializer = serializeTslToUsda;
}

/** Loop-Free TSL plugin for `<three-live>` and `<xr-live>`. */
export const tslPlugin: ThreeLivePlugin = {
  name: 'tsl',

  onRegister(): void {
    registerTslHooks();
  },

  // tslint:disable-next-line:no-any
  onElementConnected(element: any): void {
    attachHostMethods(element);
    if (element?.viewer) {
      attachHostMethods(element.viewer);
      if (element.viewer.gltf) {
        buildViewerStateFromGltf(element.viewer, element.viewer.gltf);
        element.viewer.recompileRenderProgram?.();
      }
    }
  },

  // tslint:disable-next-line:no-any
  onBuildPrimitiveVAO(_gl, _vao, primitiveDef: any, gltf: any): any {
    const matIdx = primitiveDef?.material;
    if (typeof matIdx !== 'number') return null;
    const rawExt = gltf?.materials?.[matIdx]?.extensions?.[TSL_EXTENSION_NAME];
    if (!rawExt) return null;
    const res = validateTslGraph(
      rawExt,
      gltf?.materials?.[matIdx]?.name || `Material_${matIdx}`,
    );
    if (!res.ok) return null;
    return {hash: res.graph.hash, materialIndex: matIdx};
  },

  // tslint:disable-next-line:no-any
  onResolveShader(_primitiveDef: any, materialDef: any, defaultVS, defaultFS) {
    const rawExt = materialDef?.extensions?.[TSL_EXTENSION_NAME];
    if (!rawExt) return null;
    const res = validateTslGraph(rawExt, materialDef?.name || 'Material');
    if (!res.ok) {
      console.warn(
        `[three-live] [${res.issue.code}] ${res.issue.message} Falling back to base PBR shader.`,
      );
      return null;
    }

    const cacheKey = `${res.graph.hash}|${defaultVS.length}|${defaultFS.length}|${defaultFS.slice(-64)}`;
    let cached = glslSourceCache.get(cacheKey);
    if (!cached) {
      if (glslSourceCache.size >= MAX_GLSL_SOURCE_CACHE) {
        const oldest = glslSourceCache.keys().next().value;
        if (oldest !== undefined) glslSourceCache.delete(oldest);
      }
      cached = compileTslToGlsl(res.graph, defaultVS, defaultFS);
      glslSourceCache.set(cacheKey, cached);
    }
    return cached;
  },

  // tslint:disable-next-line:no-any
  onLoadModel(viewer: any, gltf: any): void {
    attachHostMethods(viewer);
    if (viewer?.container) {
      attachHostMethods(viewer.container);
    }
    const st = buildViewerStateFromGltf(viewer, gltf);
    if (
      st.hasAnimatedTsl &&
      viewer &&
      viewer.animFrameId === null &&
      typeof viewer.start === 'function' &&
      viewer.opts?.autoStart !== false &&
      typeof requestAnimationFrame !== 'undefined'
    ) {
      viewer.start();
    }
  },

  // tslint:disable-next-line:no-any
  onUpdate(viewer: any, dt: number): void {
    const st = viewerStateMap.get(viewer);
    if (!st || !st.hasAnimatedTsl) return;
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    st.elapsedSec = tslSafeMod(st.elapsedSec + safeDt, TSL_TIME_PERIOD_SEC);
    for (const inst of st.materialsByIndex.values()) {
      if (inst.usesTime) {
        inst.buf68[64] = st.elapsedSec;
        inst.version++;
      }
    }
  },

  onBeforeDrawPrimitive(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    // tslint:disable-next-line:no-any
    primitiveGpu: any,
    _meshGpu: unknown,
    _nodeWorldMatrices: Float32Array[],
    // tslint:disable-next-line:no-any
    gltf: any,
  ): void {
    const matIdx = primitiveGpu?.materialIndex;
    if (
      typeof matIdx !== 'number' ||
      !gltf?.materials?.[matIdx]?.extensions?.[TSL_EXTENSION_NAME]
    ) {
      return;
    }
    const locs = getProgramLocs(gl, program);
    if (!locs.paramsLoc && !locs.timeLoc) return;

    let st = glStateMap.get(gl);
    if (!st) {
      st = buildViewerStateFromGltf(gl, gltf);
      glStateMap.set(gl, st);
    }
    const inst = st.materialsByIndex.get(matIdx);
    if (!inst) return;
    if (locs.paramsLoc) {
      gl.uniform4fv(locs.paramsLoc, inst.buf68, 0, 64);
    }
    if (locs.timeLoc) {
      gl.uniform1f(locs.timeLoc, inst.buf68[64]);
    }
  },

  // tslint:disable-next-line:no-any
  onClearScene(viewer: any): void {
    viewerStateMap.delete(viewer);
    if (viewer?.gl && typeof viewer.gl === 'object') {
      glStateMap.delete(viewer.gl);
    }
  },

  // tslint:disable-next-line:no-any
  onContextRestored(gl: WebGL2RenderingContext, viewer: any): void {
    if (viewer?.gltf) {
      const st = buildViewerStateFromGltf(viewer, viewer.gltf);
      if (gl && typeof gl === 'object') {
        glStateMap.set(gl, st);
      }
    }
  },

  // tslint:disable-next-line:no-any
  onDestroy(gl: WebGL2RenderingContext, viewer: any): void {
    viewerStateMap.delete(viewer);
    if (gl && typeof gl === 'object') {
      glStateMap.delete(gl);
    }
  },
};
