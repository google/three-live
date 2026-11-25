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
 * @fileoverview GPU Skeletal Character Skinning Plugin for three-live.
 * Binds JOINTS_0 and WEIGHTS_0 vertex attributes, evaluates inverse bind matrices,
 * and performs hardware vertex skinning in WebGL2 shaders.
 */

import {readAccessorAsFloat32, type GltfAccessorLike} from '../accessor';
import {mat4Create, mat4Invert, mat4Multiply} from '../math';
import type {ThreeLivePlugin} from '../plugin';

const MAX_JOINTS = 64;

/** Decoded inverse bind matrices cached per glTF `skin` object (copied out of `bin`). */
const skinIbmCache = new WeakMap<object, Float32Array | null>();

function getSkinInverseBindMatrices(
  gltf: any,
  bin: ArrayBuffer | null | undefined,
  skin: any,
): Float32Array | null {
  if (!skin) return null;
  if (skinIbmCache.has(skin)) return skinIbmCache.get(skin) ?? null;
  if (!bin) return null;
  let decoded: Float32Array | null = null;
  const ibmAcc =
    skin.inverseBindMatrices !== undefined
      ? gltf?.accessors?.[skin.inverseBindMatrices]
      : null;
  if (ibmAcc) {
    try {
      const raw = readAccessorAsFloat32(gltf, bin, ibmAcc, 16);
      // Copy out of `bin` so the cache never retains the full GLB ArrayBuffer.
      if (raw) decoded = new Float32Array(raw);
    } catch {
      decoded = null;
    }
  }
  skinIbmCache.set(skin, decoded);
  return decoded;
}

function readJointsAttribute(
  gltf: {bufferViews?: Array<{byteOffset?: number; byteStride?: number}>},
  bin: ArrayBuffer,
  acc: GltfAccessorLike | null | undefined,
): {data: Uint8Array | Uint16Array; isByte: boolean} | null {
  if (!acc || acc.bufferView === undefined) return null;
  const bv = gltf?.bufferViews?.[acc.bufferView];
  const count = Number(acc.count ?? 0);
  if (!bv || !Number.isInteger(count) || count <= 0) return null;
  const isByte = acc.componentType === 5121;
  const compSize = isByte ? 1 : 2;
  const elemSize = compSize * 4;
  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elemSize;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (
    !Number.isInteger(base) ||
    base < 0 ||
    stride < elemSize ||
    base + (count - 1) * stride + elemSize > bin.byteLength
  ) {
    return null;
  }
  if (stride === elemSize && base % compSize === 0) {
    return {
      data: isByte
        ? new Uint8Array(bin, base, count * 4)
        : new Uint16Array(bin, base, count * 4),
      isByte,
    };
  }
  const dv = new DataView(bin);
  const out = isByte ? new Uint8Array(count * 4) : new Uint16Array(count * 4);
  for (let i = 0; i < count; i++) {
    const row = base + i * stride;
    for (let c = 0; c < 4; c++) {
      const o = row + c * compSize;
      out[i * 4 + c] = isByte ? dv.getUint8(o) : dv.getUint16(o, true);
    }
  }
  return {data: out, isByte};
}

function fillSkinWorldMatrices(
  out: Float32Array,
  jointNodes: number[],
  nodeWorldMatrices: Float32Array[],
  ibms: Float32Array | null,
  count: number,
  preMult?: Float32Array,
): void {
  const identity = mat4Create();
  const tmp = preMult ? mat4Create() : null;
  for (let j = 0; j < count; j++) {
    const jointWorld = nodeWorldMatrices[jointNodes[j]] || identity;
    const dst = out.subarray(j * 16, (j + 1) * 16);
    const hasIbm = ibms !== null && (j + 1) * 16 <= ibms.length;
    if (preMult) {
      if (hasIbm) {
        mat4Multiply(tmp!, jointWorld, ibms.subarray(j * 16, (j + 1) * 16));
        mat4Multiply(dst, preMult, tmp!);
      } else {
        mat4Multiply(dst, preMult, jointWorld);
      }
    } else if (hasIbm) {
      mat4Multiply(dst, jointWorld, ibms.subarray(j * 16, (j + 1) * 16));
    } else {
      dst.set(jointWorld);
    }
  }
}

export const skinningPlugin: ThreeLivePlugin = {
  name: 'skinning',

  onResolveShader(
    primitiveDef: any,
    _materialDef: any,
    defaultVS: string,
    defaultFS: string,
  ): {vs: string; fs: string} | null {
    if (
      primitiveDef?.attributes?.JOINTS_0 === undefined ||
      primitiveDef?.attributes?.WEIGHTS_0 === undefined
    ) {
      return null;
    }

    let skinnedVS = defaultVS.replace(
      'layout(location=2) in vec2 aUV;',
      `layout(location=2) in vec2 aUV;
layout(location=4) in uvec4 aJoints;
layout(location=5) in vec4 aWeights;
uniform mat4 uJointMatrix[${MAX_JOINTS}];`,
    );

    const posVar = skinnedVS.includes('morphedPos')
      ? 'morphedPos'
      : 'aPosition';

    const maxJointIdx = MAX_JOINTS - 1;
    skinnedVS = skinnedVS
      .replace(
        `vec4 world=uModel*vec4(${posVar},1.0);`,
        `mat4 skinMatrix =
  aWeights.x * uJointMatrix[clamp(int(aJoints.x), 0, ${maxJointIdx})] +
  aWeights.y * uJointMatrix[clamp(int(aJoints.y), 0, ${maxJointIdx})] +
  aWeights.z * uJointMatrix[clamp(int(aJoints.z), 0, ${maxJointIdx})] +
  aWeights.w * uJointMatrix[clamp(int(aJoints.w), 0, ${maxJointIdx})];
if (aWeights.x + aWeights.y + aWeights.z + aWeights.w <= 1e-5) skinMatrix = mat4(1.0);
mat3 skinWorld3 = mat3(uModel * skinMatrix);
float skinDet = determinant(skinWorld3);
vec3 rawSkinN = (abs(skinDet) > 1e-12 ? transpose(inverse(skinWorld3)) : skinWorld3) * aNormal;
vNormal = length(rawSkinN) > 1e-5 ? normalize(rawSkinN) : vec3(0.0);
vec4 world=uModel*(skinMatrix*vec4(${posVar},1.0));`,
      )
      .replace(
        `gl_Position=uMVP*vec4(${posVar},1.0);`,
        `gl_Position=uMVP*(skinMatrix*vec4(${posVar},1.0));`,
      );

    return {vs: skinnedVS, fs: defaultFS};
  },

  onBuildPrimitiveVAO(
    gl: WebGL2RenderingContext,
    _vao: WebGLVertexArrayObject,
    primitiveDef: any,
    gltf: any,
    bin: ArrayBuffer,
  ): any {
    const attrs = primitiveDef?.attributes;
    if (
      !attrs ||
      attrs.JOINTS_0 === undefined ||
      attrs.WEIGHTS_0 === undefined
    ) {
      return null;
    }

    const jointsAcc = gltf.accessors?.[attrs.JOINTS_0];
    const weightsAcc = gltf.accessors?.[attrs.WEIGHTS_0];
    if (!jointsAcc || !weightsAcc) return null;

    const joints = readJointsAttribute(gltf, bin, jointsAcc);
    if (!joints) return null;

    let wData: Float32Array | null = null;
    try {
      wData = readAccessorAsFloat32(gltf, bin, weightsAcc, 4);
    } catch {
      return null;
    }
    if (!wData) return null;

    // Decode and cache inverse bind matrices while `bin` is available.
    if (Array.isArray(gltf?.skins)) {
      for (const skin of gltf.skins) {
        getSkinInverseBindMatrices(gltf, bin, skin);
      }
    }

    const jBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, jBuf);
    const jType = joints.isByte ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
    gl.bufferData(gl.ARRAY_BUFFER, joints.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 4, jType, 0, 0);

    const wBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wBuf);
    gl.bufferData(gl.ARRAY_BUFFER, wData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0);

    return {
      hasSkin: true,
      buffers: [jBuf, wBuf],
    };
  },

  onComputePrimitiveBounds(
    primitiveDef: any,
    nodeIndex: number,
    positions: Float32Array,
    nodeWorldMatrices: Float32Array[],
    gltf: any,
    bin: ArrayBuffer,
  ): {min: [number, number, number]; max: [number, number, number]} | null {
    const attrs = primitiveDef?.attributes;
    if (
      !attrs ||
      attrs.JOINTS_0 === undefined ||
      attrs.WEIGHTS_0 === undefined
    ) {
      return null;
    }
    const skinIndex = gltf?.nodes?.[nodeIndex]?.skin;
    const skin = skinIndex !== undefined ? gltf?.skins?.[skinIndex] : null;
    const jointNodes: number[] = skin?.joints || [];
    if (!skin || jointNodes.length === 0) return null;

    const joints = readJointsAttribute(
      gltf,
      bin,
      gltf.accessors?.[attrs.JOINTS_0],
    );
    if (!joints) return null;
    let wData: Float32Array | null = null;
    try {
      wData = readAccessorAsFloat32(
        gltf,
        bin,
        gltf.accessors?.[attrs.WEIGHTS_0],
        4,
      );
    } catch {
      return null;
    }
    if (!wData) return null;

    const ibms = getSkinInverseBindMatrices(gltf, bin, skin);
    const skinMats = new Float32Array(jointNodes.length * 16);
    fillSkinWorldMatrices(
      skinMats,
      jointNodes,
      nodeWorldMatrices,
      ibms,
      jointNodes.length,
    );

    const vertCount = Math.min(
      Math.floor(positions.length / 3),
      Math.floor(joints.data.length / 4),
      Math.floor(wData.length / 4),
    );
    if (vertCount === 0) return null;

    const jData = joints.data;
    const meshWorld = nodeWorldMatrices[nodeIndex];
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let v = 0; v < vertCount; v++) {
      const p3 = v * 3;
      const px = positions[p3]!;
      const py = positions[p3 + 1]!;
      const pz = positions[p3 + 2]!;
      const j4 = v * 4;
      let wx = 0;
      let wy = 0;
      let wz = 0;
      let wSum = 0;
      for (let k = 0; k < 4; k++) {
        const w = wData[j4 + k]!;
        if (w === 0) continue;
        const jIdx = jData[j4 + k]!;
        if (jIdx >= jointNodes.length) continue;
        const m = jIdx * 16;
        wx +=
          w *
          (skinMats[m]! * px +
            skinMats[m + 4]! * py +
            skinMats[m + 8]! * pz +
            skinMats[m + 12]!);
        wy +=
          w *
          (skinMats[m + 1]! * px +
            skinMats[m + 5]! * py +
            skinMats[m + 9]! * pz +
            skinMats[m + 13]!);
        wz +=
          w *
          (skinMats[m + 2]! * px +
            skinMats[m + 6]! * py +
            skinMats[m + 10]! * pz +
            skinMats[m + 14]!);
        wSum += w;
      }
      if (wSum <= 1e-5) {
        if (meshWorld) {
          wx =
            meshWorld[0]! * px +
            meshWorld[4]! * py +
            meshWorld[8]! * pz +
            meshWorld[12]!;
          wy =
            meshWorld[1]! * px +
            meshWorld[5]! * py +
            meshWorld[9]! * pz +
            meshWorld[13]!;
          wz =
            meshWorld[2]! * px +
            meshWorld[6]! * py +
            meshWorld[10]! * pz +
            meshWorld[14]!;
        } else {
          wx = px;
          wy = py;
          wz = pz;
        }
      }
      if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) {
        continue;
      }
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;
    }

    if (!Number.isFinite(minX)) return null;
    return {min: [minX, minY, minZ], max: [maxX, maxY, maxZ]};
  },

  onBeforeDrawPrimitive(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    primitiveGpu: any,
    meshGpu: any,
    nodeWorldMatrices: Float32Array[],
    gltf: any,
  ): void {
    if (!primitiveGpu.pluginData?.skinning?.hasSkin) return;

    const skinIndex = gltf?.nodes?.[meshGpu.nodeIndex]?.skin;
    if (skinIndex === undefined || !gltf.skins || !gltf.skins[skinIndex]) {
      return;
    }

    const skin = gltf.skins[skinIndex];
    const jointNodes: number[] = skin.joints || [];
    const ibms: Float32Array | null =
      primitiveGpu.pluginData?.skinning?.inverseBindMatrices ??
      skinIbmCache.get(skin) ??
      null;

    // glTF 2.0 §3.7.3.2: ignore the skinned mesh node's own transform by
    // pre-multiplying with `inverse(world(meshNode))`, cancelling `uModel`'s
    // mesh-node factor while preserving `modelRootMatrix` (turntable / AR).
    const meshWorld: Float32Array | undefined =
      meshGpu.transform || nodeWorldMatrices[meshGpu.nodeIndex];
    const invMeshWorld = mat4Create();
    if (meshWorld && !mat4Invert(invMeshWorld, meshWorld)) {
      invMeshWorld.fill(0);
      invMeshWorld[0] = 1;
      invMeshWorld[5] = 1;
      invMeshWorld[10] = 1;
      invMeshWorld[15] = 1;
    }

    const jointMatrices = new Float32Array(MAX_JOINTS * 16);
    for (let j = 0; j < MAX_JOINTS; j++) {
      const o = j * 16;
      jointMatrices[o] = 1;
      jointMatrices[o + 5] = 1;
      jointMatrices[o + 10] = 1;
      jointMatrices[o + 15] = 1;
    }

    fillSkinWorldMatrices(
      jointMatrices,
      jointNodes,
      nodeWorldMatrices,
      ibms,
      Math.min(jointNodes.length, MAX_JOINTS),
      invMeshWorld,
    );

    const loc = gl.getUniformLocation(program, 'uJointMatrix[0]');
    if (loc) {
      gl.uniformMatrix4fv(loc, false, jointMatrices);
    }
  },
};
