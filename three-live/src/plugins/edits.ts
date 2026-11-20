/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Optional sub-node scene editing, geometric/material constraint
 * grading, preview/accept/reject staging, and bounded undo (`three-live/edits`,
 * `three-live-edits.min.js`). Zero impact on core viewer/author bundle sizes.
 */

import {readAccessorAsFloat32} from '../accessor';
import {resolveNodeWorldMatrices} from '../math';
import {checkPluginCapability, type ThreeLivePlugin} from '../plugin';
import type {GLBData} from '../three-view';

export type SceneEditPayload =
  | GLBData
  | ArrayBuffer
  | ArrayBufferView
  | string;

export interface SceneEditHost {
  readonly sceneRevision?: number;
  getLoadedModel(): unknown;
  loadModel(model: GLBData): Promise<void>;
  executeScript?(code: string, options?: unknown): unknown;
  loadScriptFromSrc?(url: string, options?: unknown): unknown;
  checkCapability?(
    capability: string,
    feature: string,
    options?: {readonly url?: string; readonly dedup?: boolean},
  ): boolean;
}

export interface SceneEditConstraints {
  preserveHeight?: boolean | {tolerance?: number};
  preserveBounds?: boolean | {tolerance?: number};
  preserveFootprint?: boolean | {tolerance?: number};
  maxBounds?: [number, number, number];
  matchMaterialOf?: string;
}

export interface SceneEditOptions {
  target: string | string[];
  replacement: SceneEditPayload | Promise<SceneEditPayload>;
  replacementTarget?: string | string[];
  preserveTransform?: boolean;
  preserveTargetName?: boolean;
  copyMaterialFrom?: string;
  constraints?: SceneEditConstraints;
  warnings?: string[];
}

export interface SceneEditReceipt {
  editId: number;
  revision: number;
  status: 'preview' | 'accepted' | 'rejected' | 'undone';
  applied: boolean;
  targets: string[];
  constraints: Array<{name: string; passed: boolean}>;
  errors: string[];
  warnings: string[];
  undoDepth: number;
}

export interface SceneEditableElement extends SceneEditHost {
  sceneEditor?: SceneEditor;
  previewNodeEdit?: (options: SceneEditOptions) => Promise<SceneEditReceipt>;
  acceptNodeEdit?: () => SceneEditReceipt;
  rejectNodeEdit?: () => Promise<SceneEditReceipt>;
  undoNodeEdit?: () => Promise<SceneEditReceipt>;
  __tlEditsInstalled?: boolean;
}

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

const khrMat = (s: string) =>
  s.split(' ').map((k) => `KHR_materials_${k}`);

const ALLOWED_REPLACEMENT_EXTENSIONS = new Set([
  ...khrMat('unlit clearcoat transmission ior volume specular sheen'),
  'KHR_mesh_quantization',
  'KHR_node_visibility',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
]);

const SAFE_TARGET_NODE_EXTENSIONS = new Set([
  'KHR_node_visibility',
  'ANDROID_xr_scenecore',
  'MOZ_hubs_components',
]);

const SUPPORTED_BASE_EXTENSIONS = new Set([
  ...ALLOWED_REPLACEMENT_EXTENSIONS,
  ...SAFE_TARGET_NODE_EXTENSIONS,
  ...khrMat('emissive_strength iridescence anisotropy dispersion variants'),
  'KHR_texture_transform',
  'KHR_lights_punctual',
  'KHR_audio_emitter',
  'KHR_interactivity',
  'KHR_animation_pointer',
  'EXT_mesh_gpu_instancing',
  'MSFT_lod',
]);

const FORBIDDEN_PTR_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const INDEX_LEAF_SEGMENTS = new Set(
  'mesh skin camera children material indices bufferView source sampler'.split(
    ' ',
  ),
);

const fail = (m: string): never => {
  const err = new Error(m);
  throw err;
};

const meshoptExt = (bv: any): any =>
  bv?.extensions?.KHR_meshopt_compression ??
  bv?.extensions?.EXT_meshopt_compression;

function checkExtObj(holder: any): void {
  const ext = holder?.extensions;
  if (!ext || typeof ext !== 'object') return;
  if (Array.isArray(ext)) fail('Invalid extensions container');
  for (const k of Object.keys(ext)) {
    if (!SUPPORTED_BASE_EXTENSIONS.has(k)) {
      fail(`Unsupported extension "${k}"`);
    }
  }
}

function assertSupportedBaseExtensions(g: any): void {
  for (const k of [
    ...(g.extensionsUsed || []),
    ...(g.extensionsRequired || []),
  ]) {
    if (!SUPPORTED_BASE_EXTENSIONS.has(k)) {
      fail(`Unsupported extension "${k}"`);
    }
  }
  checkExtObj(g);
  for (const list of [
    g.scenes,
    g.nodes,
    g.meshes,
    g.materials,
    g.textures,
    g.samplers,
    g.images,
    g.accessors,
    g.bufferViews,
    g.buffers,
    g.skins,
    g.cameras,
    g.animations,
  ]) {
    for (const item of list || []) checkExtObj(item);
  }
  for (const m of g.meshes || []) {
    for (const p of m?.primitives || []) checkExtObj(p);
  }
  for (const m of g.materials || []) {
    visitMatTextures(m, (t) => checkExtObj(t));
  }
  for (const a of g.animations || []) {
    for (const s of a?.samplers || []) checkExtObj(s);
    for (const c of a?.channels || []) {
      checkExtObj(c);
      checkExtObj(c?.target);
    }
  }
}

function visitMatTextures(v: any, fn: (t: {index: number}) => void): void {
  if (!v || typeof v !== 'object') return;
  for (const k of Object.keys(v)) {
    const c = v[k];
    if (c && typeof c === 'object') {
      if (k.endsWith('Texture') && typeof c.index === 'number') fn(c);
      visitMatTextures(c, fn);
    }
  }
}

function unpackGLBData(input: unknown): GLBData {
  if (
    input &&
    typeof input === 'object' &&
    !(input instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(input) &&
    typeof (input as GLBData).gltf === 'object' &&
    (input as GLBData).gltf !== null &&
    (input as GLBData).bin instanceof ArrayBuffer
  ) {
    return input as GLBData;
  }
  if (!(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input)) {
    throw new TypeError('Invalid GLBData or GLB buffer');
  }
  const buffer = ArrayBuffer.isView(input)
    ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
    : input;
  const dv = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    dv.getUint32(0, true) !== 0x46546c67 ||
    dv.getUint32(4, true) !== 2
  ) {
    fail('Invalid GLB header');
  }
  const totalLen = dv.getUint32(8, true);
  const jsonLen = dv.getUint32(12, true);
  if (
    totalLen > buffer.byteLength ||
    dv.getUint32(16, true) !== 0x4e4f534a ||
    20 + jsonLen > totalLen
  ) {
    fail('Invalid GLB JSON chunk');
  }
  const gltf = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)),
  );
  let bin = new ArrayBuffer(0);
  const bh = 20 + jsonLen;
  if (bh + 8 <= totalLen && dv.getUint32(bh + 4, true) === 0x004e4942) {
    const bl = dv.getUint32(bh, true);
    if (bh + 8 + bl > totalLen) fail('Truncated GLB BIN');
    bin = buffer.slice(bh + 8, bh + 8 + bl);
  }
  return {gltf, bin, lights: []};
}

function snapshot(input: unknown): GLBData {
  const data = unpackGLBData(input);
  const json = JSON.stringify(data.gltf);
  if (
    data.bin.byteLength > MAX_BYTES ||
    new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
  ) {
    fail('Edit document exceeds storage limit');
  }
  return {
    ...data,
    gltf: JSON.parse(json),
    bin: data.bin.slice(0),
    animations: undefined,
  };
}

function resolveTargets(gltf: any, names: string | string[]): number[] {
  const requested = Array.isArray(names) ? names : [names];
  if (
    !requested.length ||
    requested.some((name) => typeof name !== 'string' || !name.trim())
  ) {
    fail('An edit needs named targets');
  }
  return [
    ...new Set(
      requested.map((name) => {
        const found = (gltf.nodes || [])
          .map((node: any, i: number) => (node.name === name ? i : -1))
          .filter((i: number) => i >= 0);
        if (found.length !== 1) {
          fail(`Target "${name}" is absent or ambiguous`);
        }
        return found[0];
      }),
    ),
  ] as number[];
}

function collectDescendants(gltf: any, roots: number[]): Set<number> {
  const result = new Set<number>();
  const pending = [...roots];
  while (pending.length) {
    const i = pending.pop()!;
    if (result.has(i)) continue;
    if (!gltf.nodes?.[i]) fail('Invalid node reference');
    result.add(i);
    pending.push(...(gltf.nodes[i].children || []));
  }
  return result;
}

export interface SubtreeBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

function readPrimitiveIndices(
  g: any,
  bin: ArrayBuffer,
  idxIndex: number,
  vertexCount: number,
): Uint32Array {
  const acc = g.accessors?.[idxIndex];
  const bv = g.bufferViews?.[acc?.bufferView];
  if (
    !acc ||
    !bv ||
    acc.sparse ||
    meshoptExt(bv) ||
    acc.normalized ||
    (acc.type && acc.type !== 'SCALAR')
  ) {
    fail('Invalid or compressed index accessor');
  }
  const count = Number(acc.count ?? 0);
  const ct = acc.componentType;
  const size = ct === 5121 ? 1 : ct === 5123 ? 2 : ct === 5125 ? 4 : 0;
  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : size;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (
    !size ||
    !Number.isInteger(count) ||
    count <= 0 ||
    !Number.isInteger(base) ||
    base < 0 ||
    stride < size ||
    base + (count - 1) * stride + size > bin.byteLength
  ) {
    fail('Invalid index accessor range');
  }
  const dv = new DataView(bin);
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const o = base + i * stride;
    const v =
      ct === 5121
        ? dv.getUint8(o)
        : ct === 5123
          ? dv.getUint16(o, true)
          : dv.getUint32(o, true);
    if (v >= vertexCount) fail('Vertex index out of bounds');
    out[i] = v;
  }
  return out;
}

export function computeSubtreeBounds(
  data: GLBData,
  roots: number[],
): SubtreeBounds {
  const g = data.gltf;
  const matrices = resolveNodeWorldMatrices(g);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of collectDescendants(g, roots)) {
    const node = g.nodes[i];
    if (node.extensions?.EXT_mesh_gpu_instancing || node.skin !== undefined) {
      fail(
        'Bounds constraints on skinned or instanced targets need an explicit adapter',
      );
    }
    for (const primitive of g.meshes?.[node.mesh]?.primitives || []) {
      const accessor = g.accessors?.[primitive.attributes?.POSITION];
      if (accessor?.sparse || meshoptExt(g.bufferViews?.[accessor?.bufferView])) {
        fail('Compressed or sparse bounds need decoded bufferViews');
      }
      const positions = readAccessorAsFloat32(g, data.bin, accessor, 3);
      if (!positions) fail('Target has no readable positions');
      const vertCount = positions.length / 3;
      const indices =
        primitive.indices !== undefined
          ? readPrimitiveIndices(g, data.bin, primitive.indices, vertCount)
          : null;
      const seen = indices ? new Uint8Array(vertCount) : null;
      const drawCount = indices ? indices.length : vertCount;
      const m = matrices[i];
      for (let k = 0; k < drawCount; k++) {
        const vi = indices ? indices[k] : k;
        if (seen) {
          if (seen[vi]) continue;
          seen[vi] = 1;
        }
        const p = vi * 3;
        for (let axis = 0; axis < 3; axis++) {
          const v =
            m[axis] * positions[p] +
            m[4 + axis] * positions[p + 1] +
            m[8 + axis] * positions[p + 2] +
            m[12 + axis];
          if (!Number.isFinite(v) || !Number.isFinite(Math.fround(v))) {
            fail('Target transform is not representable');
          }
          min[axis] = Math.min(min[axis], v);
          max[axis] = Math.max(max[axis], v);
        }
      }
    }
  }
  if (!Number.isFinite(min[0])) fail('Target has no geometry');
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

export function computeSubtreeBoundsSize(
  data: GLBData,
  roots: number[],
): [number, number, number] {
  return computeSubtreeBounds(data, roots).size;
}

function compactList(
  g: any,
  key: string,
  live: Set<number>,
): Map<number, number> {
  const remap = new Map<number, number>();
  const src = g[key];
  if (!Array.isArray(src)) return remap;
  const out: any[] = [];
  for (let i = 0; i < src.length; i++) {
    if (live.has(i)) {
      remap.set(i, out.length);
      out.push(src[i]);
    }
  }
  if (out.length) g[key] = out;
  else delete g[key];
  return remap;
}

/** Reclaim detached glTF nodes/meshes/materials/textures/accessors/bufferViews, remap extensions, and repack BIN. */
function compactGltfDocument(
  doc: GLBData,
  replacedTargets: ReadonlySet<number> = new Set(),
): Map<number, number> {
  const g = doc.gltf;
  const liveNodes = collectDescendants(
    g,
    (g.scenes || []).flatMap((s: any) => s?.nodes || []),
  );
  const nodeQueue = [...liveNodes];
  while (nodeQueue.length) {
    const ni = nodeQueue.pop()!;
    const nd = g.nodes?.[ni];
    const skin = g.skins?.[nd?.skin];
    const extraRoots = [
      ...(skin ? [...(skin.joints || []), skin.skeleton] : []),
      ...(Array.isArray(nd?.extensions?.MSFT_lod?.ids)
        ? nd.extensions.MSFT_lod.ids
        : []),
    ];
    for (const j of extraRoots) {
      if (typeof j === 'number') {
        for (const d of collectDescendants(g, [j])) {
          if (!liveNodes.has(d)) {
            liveNodes.add(d);
            nodeQueue.push(d);
          }
        }
      }
    }
  }

  const nodeMap = compactList(g, 'nodes', liveNodes);
  for (const s of g.scenes || []) {
    if (s?.nodes) {
      s.nodes = s.nodes
        .filter((i: number) => nodeMap.has(i))
        .map((i: number) => nodeMap.get(i)!);
    }
  }
  const nodes: any[] = g.nodes || [];
  for (const n of nodes) {
    if (n.children) {
      n.children = n.children.map((i: number) => nodeMap.get(i)!);
      if (!n.children.length) delete n.children;
    }
    const msft = n.extensions?.MSFT_lod;
    if (Array.isArray(msft?.ids)) {
      msft.ids = msft.ids.map((i: number) => {
        const next = nodeMap.get(i);
        if (next === undefined) fail('Detached MSFT_lod node');
        return next;
      });
    }
  }
  for (const holder of [g.asset?.extras, doc as any]) {
    if (Array.isArray(holder?.lights)) {
      holder.lights = holder.lights.filter((l: any) => {
        if (typeof l?.nodeIndex !== 'number') return true;
        const next = nodeMap.get(l.nodeIndex);
        if (next === undefined) return false;
        l.nodeIndex = next;
        return true;
      });
    }
  }

  const animMap = new Map<number, number>();
  if (Array.isArray(g.animations)) {
    const keptAnims: any[] = [];
    g.animations.forEach((anim: any, oldIdx: number) => {
      const chs = (anim.channels || []).filter(
        (c: any) => c.target?.node === undefined || nodeMap.has(c.target.node),
      );
      if (!chs.length) return;
      const liveS = new Set<number>();
      for (const c of chs) {
        if (c.target?.node !== undefined) {
          c.target.node = nodeMap.get(c.target.node);
        }
        if (typeof c.sampler === 'number') liveS.add(c.sampler);
      }
      const sm = compactList(anim, 'samplers', liveS);
      for (const c of chs) {
        if (typeof c.sampler === 'number') c.sampler = sm.get(c.sampler);
      }
      anim.channels = chs;
      animMap.set(oldIdx, keptAnims.length);
      keptAnims.push(anim);
    });
    if (keptAnims.length) g.animations = keptAnims;
    else delete g.animations;
  }

  const mark = (set: Set<number>, v: unknown) => {
    if (typeof v === 'number') set.add(v);
  };
  const liveSkins = new Set<number>();
  const liveCams = new Set<number>();
  const liveMeshes = new Set<number>();
  for (const n of nodes) {
    mark(liveSkins, n.skin);
    mark(liveCams, n.camera);
    mark(liveMeshes, n.mesh);
  }
  const skinMap = compactList(g, 'skins', liveSkins);
  const camMap = compactList(g, 'cameras', liveCams);
  const meshMap = compactList(g, 'meshes', liveMeshes);
  for (const n of nodes) {
    if (n.skin !== undefined) n.skin = skinMap.get(n.skin);
    if (n.camera !== undefined) n.camera = camMap.get(n.camera);
    if (n.mesh !== undefined) n.mesh = meshMap.get(n.mesh);
  }
  for (const sk of g.skins || []) {
    if (sk.joints) sk.joints = sk.joints.map((j: number) => nodeMap.get(j)!);
    if (sk.skeleton !== undefined) sk.skeleton = nodeMap.get(sk.skeleton);
  }

  const liveMats = new Set<number>();
  const liveAccs = new Set<number>();
  let matMap: Map<number, number> | undefined;
  let accMap: Map<number, number> | undefined;
  const ref = (obj: any, k: string, set: Set<number>, map?: Map<number, number>) => {
    if (typeof obj?.[k] === 'number') {
      if (map) obj[k] = map.get(obj[k]);
      else set.add(obj[k]);
    }
  };
  const visitMeshAndAnimRefs = () => {
    for (const sk of g.skins || []) ref(sk, 'inverseBindMatrices', liveAccs, accMap);
    for (const a of g.animations || []) {
      for (const s of a.samplers || []) {
        ref(s, 'input', liveAccs, accMap);
        ref(s, 'output', liveAccs, accMap);
      }
    }
    for (const n of nodes) {
      const ia = n.extensions?.EXT_mesh_gpu_instancing?.attributes;
      if (ia) for (const k of Object.keys(ia)) ref(ia, k, liveAccs, accMap);
    }
    for (const m of g.meshes || []) {
      for (const p of m.primitives || []) {
        ref(p, 'material', liveMats, matMap);
        ref(p, 'indices', liveAccs, accMap);
        for (const a of [p.attributes, ...(p.targets || [])]) {
          if (a) for (const k of Object.keys(a)) ref(a, k, liveAccs, accMap);
        }
        for (const vm of p.extensions?.KHR_materials_variants?.mappings || []) {
          ref(vm, 'material', liveMats, matMap);
        }
      }
    }
  };
  visitMeshAndAnimRefs();
  matMap = compactList(g, 'materials', liveMats);
  accMap = compactList(g, 'accessors', liveAccs);
  visitMeshAndAnimRefs();

  const liveTexs = new Set<number>();
  for (const m of g.materials || []) {
    visitMatTextures(m, (t) => liveTexs.add(t.index));
  }
  const texMap = compactList(g, 'textures', liveTexs);
  for (const m of g.materials || []) {
    visitMatTextures(m, (t) => {
      t.index = texMap.get(t.index)!;
    });
  }

  const liveSamps = new Set<number>();
  const liveImgs = new Set<number>();
  for (const t of g.textures || []) {
    mark(liveSamps, t.sampler);
    mark(liveImgs, t.source);
  }
  const sampMap = compactList(g, 'samplers', liveSamps);
  const imgMap = compactList(g, 'images', liveImgs);
  for (const t of g.textures || []) {
    if (t.sampler !== undefined) t.sampler = sampMap.get(t.sampler);
    if (t.source !== undefined) t.source = imgMap.get(t.source);
  }

  const liveBvs = new Set<number>();
  let bvMap: Map<number, number> | undefined;
  const visitBvRefs = () => {
    for (const a of g.accessors || []) {
      ref(a, 'bufferView', liveBvs, bvMap);
      ref(a.sparse?.indices, 'bufferView', liveBvs, bvMap);
      ref(a.sparse?.values, 'bufferView', liveBvs, bvMap);
    }
    for (const im of g.images || []) ref(im, 'bufferView', liveBvs, bvMap);
    for (const au of g.extensions?.KHR_audio_emitter?.audio || []) {
      ref(au, 'bufferView', liveBvs, bvMap);
    }
  };
  visitBvRefs();
  bvMap = compactList(g, 'bufferViews', liveBvs);
  visitBvRefs();

  const ptrMaps: Record<string, Map<number, number>> = {
    nodes: nodeMap,
    meshes: meshMap,
    materials: matMap,
    textures: texMap,
    images: imgMap,
    samplers: sampMap,
    skins: skinMap,
    cameras: camMap,
    animations: animMap,
    accessors: accMap,
    bufferViews: bvMap,
  };
  const remapSlot = (
    bag: any,
    key: string,
    fn: (v: unknown) => unknown,
  ): boolean => {
    if (!bag || typeof bag !== 'object' || !(key in bag)) return false;
    const raw = bag[key];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if ('node' in raw && raw.node !== undefined) {
        fail('Dynamic interactivity reference cannot be remapped');
      }
      if (!('value' in raw)) fail('Invalid interactivity binding');
      if (Array.isArray(raw.value) && raw.value.length === 1) {
        raw.value[0] = fn(raw.value[0]);
      } else {
        raw.value = fn(raw.value);
      }
      return true;
    }
    bag[key] = fn(raw);
    return true;
  };
  const remapPointer = (ptr: unknown, tplNode?: any): string => {
    if (typeof ptr !== 'string' || !ptr.startsWith('/')) {
      fail('Invalid glTF pointer');
    }
    const segs = ptr.slice(1).split('/');
    if (segs.length < 2) fail('Invalid glTF pointer');
    for (let si = 0; si < segs.length; si++) {
      const unesc = segs[si].replace(/~1/g, '/').replace(/~0/g, '~');
      if (
        !unesc ||
        FORBIDDEN_PTR_SEGMENTS.has(unesc) ||
        FORBIDDEN_PTR_SEGMENTS.has(segs[si]) ||
        (si >= 2 && INDEX_LEAF_SEGMENTS.has(unesc))
      ) {
        fail('Unsupported glTF pointer segment');
      }
    }
    if (segs[0] === 'extensions') {
      if (
        segs[1] === 'KHR_lights_punctual' &&
        segs[2] === 'lights' &&
        /^\d+$/.test(segs[3]) &&
        Number(segs[3]) < (g.extensions?.KHR_lights_punctual?.lights?.length || 0)
      ) {
        return ptr;
      }
      fail('Unsupported extension pointer');
    }
    const map = ptrMaps[segs[0]];
    if (!map) fail(`Unsupported pointer root "${segs[0]}"`);
    const checkReplacedNodeProp = (oldIdx: number) => {
      if (
        segs[0] === 'nodes' &&
        replacedTargets.has(oldIdx) &&
        !(
          segs[2] === 'translation' ||
          segs[2] === 'rotation' ||
          segs[2] === 'scale' ||
          segs[2] === 'visible' ||
          (segs[2] === 'extensions' && segs[3] === 'KHR_node_visibility')
        )
      ) {
        fail('Pointer targets replaced node payload');
      }
    };
    const mapCollectionIdx = (v: unknown): number => {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        fail('Invalid pointer index');
      }
      const next = map.get(v);
      if (next === undefined) {
        fail('Edit detaches resource referenced by pointer');
      }
      checkReplacedNodeProp(v);
      return next;
    };
    if (/^\d+$/.test(segs[1])) {
      segs[1] = String(mapCollectionIdx(Number(segs[1])));
      return '/' + segs.join('/');
    }
    const tpl = tplNode && /^\{([a-zA-Z0-9_]+)\}$/.exec(segs[1]);
    if (tpl) {
      const param = tpl[1];
      const inVals = remapSlot(tplNode.values, param, mapCollectionIdx);
      const inCfg = remapSlot(tplNode.configuration, param, mapCollectionIdx);
      if (!inVals && !inCfg) {
        fail('Unbound interactivity pointer template');
      }
      return ptr;
    }
    fail('Unremappable glTF pointer');
  };

  for (const anim of g.animations || []) {
    for (const ch of anim.channels || []) {
      const kp = ch.target?.extensions?.KHR_animation_pointer;
      if (kp && typeof kp === 'object') {
        kp.pointer = remapPointer(kp.pointer);
      } else if (ch.target?.path === 'pointer') {
        fail('Invalid KHR_animation_pointer channel');
      }
    }
  }

  if (g.extensions?.KHR_interactivity !== undefined) {
    const ext = g.extensions.KHR_interactivity;
    const graphs = Array.isArray(ext?.graphs)
      ? ext.graphs
      : Array.isArray(ext?.nodes)
        ? [ext]
        : null;
    if (!graphs) fail('Invalid KHR_interactivity extension');
    for (const gr of graphs) {
      const decls = Array.isArray(gr?.declarations) ? gr.declarations : [];
      if (!Array.isArray(gr?.nodes)) {
        fail('Invalid KHR_interactivity graph');
      }
      for (const gn of gr.nodes) {
        if (!gn || typeof gn !== 'object') {
          fail('Invalid KHR_interactivity node');
        }
        for (const k of Object.keys(gn.values || {})) {
          const s = gn.values[k];
          if (
            s &&
            typeof s === 'object' &&
            typeof s.node === 'number' &&
            (s.socket === 'nodeIndex' ||
              s.socket === 'meshIndex' ||
              s.socket === 'hitNodeIndex')
          ) {
            fail(
              'Dynamic interactivity nodeIndex output cannot be remapped',
            );
          }
        }
        const op =
          gn.op ||
          (typeof gn.declaration === 'number' ? decls[gn.declaration]?.op : '');
        if (
          op === 'pointer/get' ||
          op === 'pointer/set' ||
          op === 'pointer/interpolate'
        ) {
          const cOk = remapSlot(gn.configuration, 'pointer', (p) =>
            remapPointer(p, gn),
          );
          const vOk = remapSlot(gn.values, 'pointer', (p) =>
            remapPointer(p, gn),
          );
          if (!cOk && !vOk) fail('Missing interactivity pointer');
        } else if (
          /^(pointer|event|scene)\/on(Select|HoverIn|HoverOut)$/.test(op)
        ) {
          const mapHitNode = (v: unknown) => {
            if (v === undefined || v === null) return v;
            if (typeof v !== 'number' || !Number.isInteger(v)) {
              fail('Invalid interactivity nodeIndex');
            }
            if (v < 0) return v;
            const next = nodeMap.get(v);
            if (next === undefined) {
              fail(
                'Edit detaches node referenced by KHR_interactivity',
              );
            }
            return next;
          };
          for (const k of ['nodeIndex', 'node']) {
            remapSlot(gn.configuration, k, mapHitNode);
            remapSlot(gn.values, k, mapHitNode);
          }
        } else if (/^animation\/(start|stop|stopAt|resetAt)$/.test(op)) {
          const mapAnim = (v: unknown) => {
            if (v === undefined || v === null) return v;
            if (typeof v === 'string') {
              if (!(g.animations || []).some((a: any) => a?.name === v)) {
                fail(
                  'Edit detaches animation referenced by KHR_interactivity',
                );
              }
              return v;
            }
            if (typeof v !== 'number' || !Number.isInteger(v)) {
              fail('Invalid interactivity animation');
            }
            const next = animMap.get(v);
            if (next === undefined) {
              fail(
                'Edit detaches animation referenced by KHR_interactivity',
              );
            }
            return next;
          };
          remapSlot(gn.configuration, 'animation', mapAnim);
          remapSlot(gn.values, 'animation', mapAnim);
        } else if (
          !/^(flow\/|math\/|type\/|variable\/|(customE|e)vent\/(onStart|onTick|send|receive)$|debug\/log$)/.test(
            op,
          )
        ) {
          fail(`Unsupported KHR_interactivity op "${String(op)}"`);
        }
      }
    }
  }

  const srcBytes = new Uint8Array(doc.bin);
  const bvs: any[] = g.bufferViews || [];
  const slices: Array<{bytes: Uint8Array; off: number}> = [];
  let len = 0;
  let fbLen = 0;
  let fbExt: string | null = null;
  let usedExt = false;
  let usedKhr = false;
  for (const bv of bvs) {
    const mExt = meshoptExt(bv);
    if (mExt && typeof mExt === 'object') {
      if (Number(mExt.buffer ?? 0) !== 0) {
        fail('Unsupported meshopt buffer');
      }
      const off = Number(mExt.byteOffset ?? 0);
      const bl = Number(mExt.byteLength ?? 0);
      if (
        !Number.isInteger(off) ||
        off < 0 ||
        !Number.isInteger(bl) ||
        bl < 0 ||
        off + bl > srcBytes.length
      ) {
        fail('Invalid meshopt byte range');
      }
      if (bv.extensions?.KHR_meshopt_compression) usedKhr = true;
      else usedExt = true;
      len = (len + 3) & ~3;
      mExt.buffer = 0;
      mExt.byteOffset = len;
      slices.push({bytes: srcBytes.subarray(off, off + bl), off: len});
      len += bl;
      if (bv.buffer) {
        fbExt = bv.extensions?.KHR_meshopt_compression
          ? 'KHR_meshopt_compression'
          : 'EXT_meshopt_compression';
        fbLen = (fbLen + 3) & ~3;
        bv.buffer = 1;
        bv.byteOffset = fbLen;
        fbLen += bv.byteLength || 0;
      } else {
        bv.buffer = 0;
        bv.byteOffset = 0;
      }
    } else {
      if (bv.buffer) fail('Unsupported buffer reference');
      const off = bv.byteOffset || 0;
      const bl = bv.byteLength || 0;
      if (off < 0 || bl < 0 || off + bl > srcBytes.length) {
        fail('Invalid bufferView byte range');
      }
      len = (len + 3) & ~3;
      bv.buffer = 0;
      bv.byteOffset = len;
      slices.push({bytes: srcBytes.subarray(off, off + bl), off: len});
      len += bl;
    }
  }
  const total = (len + 3) & ~3;
  const packed = new Uint8Array(total);
  for (const s of slices) packed.set(s.bytes, s.off);
  doc.bin = packed.buffer;
  if (total || fbLen) {
    g.buffers = [{byteLength: total}];
    if (fbLen && fbExt) {
      g.buffers.push({
        byteLength: (fbLen + 3) & ~3,
        extensions: {[fbExt]: {fallback: true}},
      });
    }
  } else {
    delete g.buffers;
  }
  for (const field of ['extensionsUsed', 'extensionsRequired'] as const) {
    if (Array.isArray(g[field])) {
      g[field] = g[field].filter(
        (e: string) =>
          (e !== 'EXT_meshopt_compression' || usedExt) &&
          (e !== 'KHR_meshopt_compression' || usedKhr),
      );
      if (!g[field].length) delete g[field];
    }
  }
  return nodeMap;
}

function firstMaterial(g: any, roots: number[]): any {
  for (const i of collectDescendants(g, roots)) {
    const primitive = g.meshes?.[g.nodes[i].mesh]?.primitives?.[0];
    if (primitive) return g.materials?.[primitive.material] || {};
  }
  fail('Material target has no primitives');
}

function sameMaterialProps(a: any, b: any): boolean {
  const pick = (m: any) => {
    const p = m.pbrMetallicRoughness;
    return [
      p
        ? [
            p.baseColorFactor ?? [1, 1, 1, 1],
            p.metallicFactor ?? 1,
            p.roughnessFactor ?? 1,
          ]
        : null,
      m.emissiveFactor ?? [0, 0, 0],
      m.alphaMode ?? 'OPAQUE',
      Boolean(m.doubleSided),
    ];
  };
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b));
}

/** Merge replacement subtree at the glTF document level and grade constraints. */
export function prepareSceneEdit(
  input: GLBData,
  replacement: GLBData,
  options: SceneEditOptions,
): {model: GLBData; constraints: SceneEditReceipt['constraints']} {
  const base = snapshot(input);
  const candidate = snapshot(replacement);
  const g = base.gltf;
  const r = candidate.gltf;
  assertSupportedBaseExtensions(g);
  const selected = resolveTargets(g, options.target);
  const selectedSet = new Set(selected);
  const affected = collectDescendants(g, selected);

  if (
    [...affected].some(
      (i) =>
        g.nodes[i].skin !== undefined ||
        Object.keys(g.nodes[i].extensions || {}).some(
          (k) => !SAFE_TARGET_NODE_EXTENSIONS.has(k),
        ),
    ) ||
    (g.nodes || []).some(
      (n: any, ni: number) =>
        !affected.has(ni) &&
        Array.isArray(n?.extensions?.MSFT_lod?.ids) &&
        n.extensions.MSFT_lod.ids.some((id: number) => affected.has(id)),
    ) ||
    (g.animations || []).some((a: any) =>
      (a.channels || []).some(
        (ch: any) =>
          (affected.has(ch.target?.node) && !selectedSet.has(ch.target.node)) ||
          (selectedSet.has(ch.target?.node) && ch.target?.path === 'weights'),
      ),
    )
  ) {
    fail('Skinned, instanced, LOD, or animated targets unsupported');
  }

  for (const i of selected) {
    if (
      selected.some((j) => j !== i && collectDescendants(g, [j]).has(i))
    ) {
      fail('Overlapping edit targets');
    }
  }

  const hasDisallowedNodeExt = (r.nodes || []).some((n: any) => {
    if (n.skin !== undefined) return true;
    if (!n.extensions) return false;
    return Object.keys(n.extensions).some((k) => k !== 'KHR_node_visibility');
  });
  if (
    [...(r.extensionsUsed || []), ...(r.extensionsRequired || [])].some(
      (name: string) => !ALLOWED_REPLACEMENT_EXTENSIONS.has(name),
    ) ||
    r.extensions ||
    r.skins?.length ||
    r.animations?.length ||
    r.cameras?.length ||
    hasDisallowedNodeExt
  ) {
    fail('Unsupported replacement features');
  }

  const badBufs = (bufs: any[] | undefined) =>
    (bufs || []).some(
      (b, i) => b?.uri || (i > 0 && !meshoptExt(b)?.fallback),
    );
  if (badBufs(g.buffers) || badBufs(r.buffers)) {
    fail('Edits require a single embedded binary buffer');
  }

  const copiedMaterial = options.copyMaterialFrom
    ? structuredClone(
        firstMaterial(g, resolveTargets(g, options.copyMaterialFrom)),
      )
    : null;
  const roots: number[] = options.replacementTarget
    ? resolveTargets(r, options.replacementTarget)
    : r.scenes?.[r.scene ?? 0]?.nodes || [];
  if (!roots.length) fail('Replacement has no scene roots');

  const fields = [
    'bufferViews',
    'accessors',
    'images',
    'samplers',
    'textures',
    'materials',
    'meshes',
    'nodes',
  ] as const;
  const offset: Record<string, number> = {};
  for (const field of fields) {
    g[field] ||= [];
    r[field] ||= [];
    offset[field] = g[field].length;
  }

  const byteOffset = Math.ceil(base.bin.byteLength / 4) * 4;
  if (byteOffset + candidate.bin.byteLength > MAX_BYTES) {
    fail('Merged edit exceeds storage limit');
  }
  for (const bv of r.bufferViews) {
    const mExt = meshoptExt(bv);
    if (mExt && typeof mExt === 'object') {
      if (Number(mExt.buffer ?? 0) !== 0) {
        fail('Unsupported meshopt buffer');
      }
      mExt.buffer = 0;
      mExt.byteOffset = (mExt.byteOffset || 0) + byteOffset;
    } else {
      if (bv.buffer) fail('Unsupported buffer reference');
      bv.buffer = 0;
      bv.byteOffset = (bv.byteOffset || 0) + byteOffset;
    }
  }
  for (const acc of r.accessors) {
    if (acc.bufferView !== undefined) acc.bufferView += offset.bufferViews;
    if (acc.sparse) {
      for (const part of ['indices', 'values']) {
        acc.sparse[part].bufferView += offset.bufferViews;
      }
    }
  }
  for (const image of r.images) {
    if (image.bufferView !== undefined) image.bufferView += offset.bufferViews;
  }
  for (const texture of r.textures) {
    if (texture.source !== undefined) texture.source += offset.images;
    if (texture.sampler !== undefined) texture.sampler += offset.samplers;
    if (texture.extensions) {
      fail(
        'Replacement texture extensions require an explicit adapter',
      );
    }
  }

  for (const material of r.materials) {
    visitMatTextures(material, (t) => {
      t.index += offset.textures;
    });
  }

  for (const mesh of r.meshes) {
    for (const p of mesh.primitives || []) {
      if (p.extensions) {
        fail(
          'Replacement primitive extensions require an explicit adapter',
        );
      }
      for (const attrs of [p.attributes, ...(p.targets || [])]) {
        if (!attrs) continue;
        for (const key of Object.keys(attrs)) attrs[key] += offset.accessors;
      }
      if (p.indices !== undefined) p.indices += offset.accessors;
      if (p.material !== undefined) p.material += offset.materials;
    }
  }
  for (const node of r.nodes) {
    if (node.mesh !== undefined) node.mesh += offset.meshes;
    if (node.children) {
      node.children = node.children.map((i: number) => i + offset.nodes);
    }
  }
  for (const field of fields) g[field].push(...r[field]);
  if (r.extensionsUsed?.length) {
    g.extensionsUsed = [
      ...new Set([...(g.extensionsUsed || []), ...r.extensionsUsed]),
    ];
  }
  if (r.extensionsRequired?.length) {
    g.extensionsRequired = [
      ...new Set([...(g.extensionsRequired || []), ...r.extensionsRequired]),
    ];
  }

  const bytes = new Uint8Array(byteOffset + candidate.bin.byteLength);
  bytes.set(new Uint8Array(base.bin));
  bytes.set(new Uint8Array(candidate.bin), byteOffset);
  base.bin = bytes.buffer;
  g.buffers = [{byteLength: bytes.length}];

  const insertedRootLists: number[][] = [];
  for (const i of selected) {
    const node = g.nodes[i];
    delete node.mesh;
    let nodeOffset = offset.nodes;
    if (i !== selected[0]) {
      nodeOffset = g.nodes.length;
      const clones = structuredClone(r.nodes);
      for (const clone of clones) {
        if (clone.children) {
          clone.children = clone.children.map(
            (j: number) => j - offset.nodes + nodeOffset,
          );
        }
      }
      g.nodes.push(...clones);
    }
    node.children = roots.map((j: number) => j + nodeOffset);
    insertedRootLists.push(node.children);
    if (options.preserveTargetName !== false) {
      for (const root of node.children) {
        if (g.nodes[root].name === node.name) delete g.nodes[root].name;
      }
    }
    if (options.preserveTransform === false) {
      delete node.matrix;
      delete node.translation;
      delete node.rotation;
      delete node.scale;
    }
    if (options.preserveTargetName === false && roots.length === 1) {
      const nextName = r.nodes[roots[0]].name;
      if (nextName === undefined) delete node.name;
      else node.name = nextName;
      delete g.nodes[node.children[0]].name;
    }
  }

  if (copiedMaterial) {
    const matIndex = g.materials.push(copiedMaterial) - 1;
    for (const rootList of insertedRootLists) {
      for (const i of collectDescendants(g, rootList)) {
        for (const p of g.meshes?.[g.nodes[i].mesh]?.primitives || []) {
          p.material = matIndex;
        }
      }
    }
  }

  const nodeRemap = compactGltfDocument(base, selectedSet);
  const afterTargets = selected.map((i) => nodeRemap.get(i)!);

  const after = computeSubtreeBounds(base, afterTargets);
  const checks: SceneEditReceipt['constraints'] = [];
  const c = options.constraints;
  if (c) {
    const before = computeSubtreeBounds(
      input,
      resolveTargets(input.gltf, options.target),
    );
    const readTol = (
      val: boolean | {tolerance?: number},
      fallback: number,
    ): number => {
      const t = typeof val === 'object' ? (val.tolerance ?? fallback) : fallback;
      if (!Number.isFinite(t) || t < 0) {
        fail('Invalid constraint tolerance');
      }
      return t;
    };
    const matchAxisPlacement = (ax: number, tol: number): boolean => {
      const scale = Math.max(before.size[ax], 1e-6);
      return (
        Math.abs(after.min[ax] - before.min[ax]) <= tol * scale &&
        Math.abs(after.max[ax] - before.max[ax]) <= tol * scale
      );
    };
    if (c.preserveHeight) {
      const tol = readTol(c.preserveHeight, 0.05);
      checks.push({
        name: 'preserveHeight',
        passed:
          Math.abs(after.size[1] - before.size[1]) <=
          tol * Math.max(before.size[1], 1e-6),
      });
    }
    if (c.preserveBounds) {
      const tol = readTol(c.preserveBounds, 0.1);
      checks.push({
        name: 'preserveBounds',
        passed: [0, 1, 2].every((ax) => matchAxisPlacement(ax, tol)),
      });
    }
    if (c.preserveFootprint) {
      const tol = readTol(c.preserveFootprint, 0.1);
      checks.push({
        name: 'preserveFootprint',
        passed:
          [0, 2].every((ax) => matchAxisPlacement(ax, tol)) &&
          Math.abs(after.min[1] - before.min[1]) <=
            tol * Math.max(before.size[1], 1e-6),
      });
    }
    if (c.maxBounds) {
      if (
        c.maxBounds.length !== 3 ||
        c.maxBounds.some((v) => !Number.isFinite(v) || v < 0)
      ) {
        fail('Invalid maxBounds constraint');
      }
      checks.push({
        name: 'maxBounds',
        passed: [0, 1, 2].every((ax) => after.size[ax] <= c.maxBounds![ax]),
      });
    }
    if (c.matchMaterialOf) {
      const refMat = firstMaterial(
        input.gltf,
        resolveTargets(input.gltf, c.matchMaterialOf),
      );
      let allMatch = true;
      for (const i of collectDescendants(g, afterTargets)) {
        for (const p of g.meshes?.[g.nodes[i].mesh]?.primitives || []) {
          if (!sameMaterialProps(g.materials?.[p.material] || {}, refMat)) {
            allMatch = false;
          }
        }
      }
      checks.push({name: 'matchMaterialOf', passed: allMatch});
    }
  }
  return {model: base, constraints: checks};
}

async function fetchBoundedBytes(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetch(url, {signal});
  if (!res.ok) fail(`HTTP ${res.status}`);
  const cl = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(cl) && cl > MAX_BYTES) {
    await res.body?.cancel?.().catch(() => {});
    fail('Edit document exceeds storage limit');
  }
  const reader = res.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          total += value.byteLength;
          if (total > MAX_BYTES) fail('Edit document exceeds storage limit');
          chunks.push(value);
        }
      }
    } catch (err) {
      await reader.cancel().catch(() => {});
      throw err;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) fail('Edit document exceeds storage limit');
  return buf;
}

export class SceneEditor {
  previewEdit!: (options: SceneEditOptions) => Promise<SceneEditReceipt>;
  acceptEdit!: () => SceneEditReceipt;
  rejectEdit!: () => Promise<SceneEditReceipt>;
  undoEdit!: () => Promise<SceneEditReceipt>;
  dispose!: (options?: {restorePreview?: boolean}) => Promise<void>;

  constructor(host: SceneEditHost, maxUndoSteps = 8) {
    if (
      !Number.isInteger(maxUndoSteps) ||
      maxUndoSteps < 0 ||
      maxUndoSteps > 16
    ) {
      fail('Undo limit must be 0–16');
    }
    let gen = 0;
    let loads = 0;
    let inflightAbort: AbortController | null = null;
    let active: {
      before: GLBData;
      after: GLBData;
      receipt: SceneEditReceipt;
    } | null = null;
    let undo: GLBData[] = [];
    const abortInflight = () => {
      inflightAbort?.abort();
      inflightAbort = null;
    };
    const rawLoadModel = host.loadModel;
    const h = host as Record<string, unknown>;
    const saved: Array<[string, unknown, boolean]> = [];
    for (const m of ['loadModel', 'executeScript', 'loadScriptFromSrc']) {
      const fn = h[m];
      if (typeof fn !== 'function') continue;
      saved.push([m, fn, Object.prototype.hasOwnProperty.call(h, m)]);
      h[m] = (...args: unknown[]) => {
        loads++;
        abortInflight();
        return (fn as (...a: unknown[]) => unknown).apply(host, args);
      };
    }
    let unhook: (() => void) | null = () => {
      for (const [m, fn, own] of saved) {
        if (own) h[m] = fn;
        else delete h[m];
      }
    };
    const curRev = () => (host.sceneRevision ?? 0) + loads;
    let installed = host.getLoadedModel();
    let rev = curRev();

    const apply = (model: GLBData) => rawLoadModel.call(host, model);

    const sync = () => {
      const cur = host.getLoadedModel();
      const r = curRev();
      if (installed !== cur || rev !== r) {
        gen++;
        abortInflight();
        active = null;
        undo = [];
        installed = cur;
        rev = r;
      }
    };

    const receipt = (
      status: SceneEditReceipt['status'],
      errors: string[] = [],
    ): SceneEditReceipt => ({
      editId: gen,
      revision: curRev(),
      status,
      applied: false,
      targets: [],
      constraints: [],
      warnings: [],
      errors,
      undoDepth: undo.length,
    });

    const restore = async (
      prev: GLBData,
      status: 'rejected' | 'undone',
      commit: () => void,
    ): Promise<SceneEditReceipt> => {
      gen++;
      abortInflight();
      const startRev = curRev();
      try {
        await apply(prev);
        if (startRev !== curRev() || host.getLoadedModel() !== prev) {
          fail('Edit was superseded');
        }
        commit();
        installed = prev;
        rev = curRev();
        return {...receipt(status), applied: status === 'undone'};
      } catch (err) {
        if (host.getLoadedModel() === installed) rev = curRev();
        return receipt('rejected', [String(err)]);
      }
    };

    this.previewEdit = async (options) => {
      sync();
      if (active) {
        const rej = await this.rejectEdit();
        if (rej.errors.length) return rej;
      }
      abortInflight();
      const token = ++gen;
      const startRev = curRev();
      const source = host.getLoadedModel();
      let fetchAc: AbortController | null = null;
      try {
        const input = await options.replacement;
        let rep: GLBData;
        if (typeof input === 'string') {
          if (
            !checkPluginCapability(host, 'remote_content', 'previewEdit', {
              url: input,
            })
          ) {
            fail(
              "Capability 'remote_content' or 'network' denied for replacement URL.",
            );
          }
          if (
            token !== gen ||
            startRev !== curRev() ||
            source !== host.getLoadedModel()
          ) {
            fail('Edit was superseded');
          }
          fetchAc = new AbortController();
          inflightAbort = fetchAc;
          rep = snapshot(await fetchBoundedBytes(input, fetchAc.signal));
        } else {
          rep = snapshot(input);
        }
        const before = snapshot(source);
        if (
          token !== gen ||
          startRev !== curRev() ||
          source !== host.getLoadedModel()
        ) {
          fail('Edit was superseded');
        }
        const prepared = prepareSceneEdit(before, rep, options);
        const rc: SceneEditReceipt = {
          ...receipt('preview'),
          targets: Array.isArray(options.target)
            ? [...options.target]
            : [options.target],
          constraints: prepared.constraints,
          warnings: [...(options.warnings || [])],
        };
        if (prepared.constraints.some((c) => !c.passed)) {
          return {...rc, status: 'rejected', errors: ['Edit constraints failed']};
        }
        await apply(prepared.model);
        if (
          token !== gen ||
          startRev !== curRev() ||
          host.getLoadedModel() !== prepared.model
        ) {
          fail('Edit was superseded');
        }
        installed = prepared.model;
        rev = curRev();
        rc.revision = rev;
        rc.applied = true;
        active = {before, after: prepared.model, receipt: rc};
        return structuredClone(rc);
      } catch (err) {
        if (token === gen && source === host.getLoadedModel()) rev = curRev();
        return receipt('rejected', [String(err)]);
      } finally {
        if (fetchAc && inflightAbort === fetchAc) inflightAbort = null;
      }
    };

    this.acceptEdit = () => {
      sync();
      if (!active) return receipt('rejected', ['No active preview']);
      const {before, receipt: rc} = active;
      active = null;
      undo.push(before);
      while (
        undo.length > maxUndoSteps ||
        undo.reduce((n, d) => n + d.bin.byteLength, 0) > MAX_BYTES * 2
      ) {
        undo.shift();
      }
      return {
        ...structuredClone(rc),
        status: 'accepted',
        applied: true,
        undoDepth: undo.length,
      };
    };

    this.rejectEdit = async () => {
      sync();
      if (!active) {
        gen++;
        abortInflight();
        return receipt('rejected', ['No active preview']);
      }
      return restore(active.before, 'rejected', () => {
        active = null;
      });
    };

    this.undoEdit = async () => {
      sync();
      if (active) {
        const rej = await this.rejectEdit();
        if (rej.errors.length) return rej;
      }
      const prev = undo[undo.length - 1];
      if (!prev) return receipt('rejected', ['No accepted edit to undo']);
      return restore(prev, 'undone', () => {
        undo.pop();
      });
    };

    this.dispose = async (options) => {
      abortInflight();
      try {
        if (options?.restorePreview !== false && active) {
          const rej = await this.rejectEdit();
          if (rej.errors.length) fail(rej.errors.join('; '));
        }
      } finally {
        gen++;
        active = null;
        undo = [];
        unhook?.();
        unhook = null;
      }
    };
  }
}

const elementEditors = new WeakMap<object, SceneEditor>();

function ensureElementEditor(el: SceneEditableElement): SceneEditor {
  let editor = elementEditors.get(el);
  if (!editor) {
    editor = new SceneEditor(el);
    elementEditors.set(el, editor);
  }
  return editor;
}

/**
 * Optional `<three-live>` / `<xr-live>` plugin attaching `el.sceneEditor` and
 * `el.{preview,accept,reject,undo}NodeEdit` without altering core bundles.
 */
export const sceneEditsPlugin: ThreeLivePlugin = {
  name: 'scene-edits',
  onRegister(): void {
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll?.('three-live, xr-live')
      .forEach((node) => sceneEditsPlugin.onElementConnected?.(node));
  },
  onElementConnected(host: unknown): void {
    const el = host as SceneEditableElement | null;
    if (
      !el ||
      typeof el !== 'object' ||
      el.__tlEditsInstalled ||
      typeof el.getLoadedModel !== 'function' ||
      typeof el.loadModel !== 'function'
    ) {
      return;
    }
    el.__tlEditsInstalled = true;
    Object.defineProperty(el, 'sceneEditor', {
      configurable: true,
      get: () => ensureElementEditor(el),
    });
    el.previewNodeEdit = (options: SceneEditOptions) =>
      ensureElementEditor(el).previewEdit(options);
    el.acceptNodeEdit = () => ensureElementEditor(el).acceptEdit();
    el.rejectNodeEdit = () => ensureElementEditor(el).rejectEdit();
    el.undoNodeEdit = () => ensureElementEditor(el).undoEdit();
  },
  onElementDisconnected(host: unknown): void {
    if (!host || typeof host !== 'object') return;
    const editor = elementEditors.get(host);
    if (editor) {
      elementEditors.delete(host);
      editor.dispose({restorePreview: false}).catch(() => {});
    }
  },
};
