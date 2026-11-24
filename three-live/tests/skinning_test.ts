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

import {strict as assert} from 'node:assert';
import {
  mat4Create,
  mat4DecomposeTRS,
  mat4FromRotationTranslationScale,
  mat4Invert,
  mat4Multiply,
} from '../src/math';
import {keyframeAnimationPlugin} from '../src/plugins/keyframes';
import {skinningPlugin} from '../src/plugins/skinning';
import {registerPlugin, ThreeView, type GLBData} from '../src/three-view';

registerPlugin(keyframeAnimationPlugin);
registerPlugin(skinningPlugin);

function assertNear(actual: number, expected: number, eps: number, msg: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg}: expected ${expected} ± ${eps}, got ${actual}`,
  );
}

function transformPoint(
  m: ArrayLike<number>,
  p: [number, number, number],
): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

function evalSkinnedWorldPoint(
  uModel: Float32Array,
  uJointMatrices: Float32Array,
  pos: [number, number, number],
  joints: [number, number, number, number],
  weights: [number, number, number, number],
): [number, number, number] {
  const skinMat = new Float32Array(16);
  for (let k = 0; k < 4; k++) {
    const w = weights[k]!;
    if (w === 0) continue;
    const base = joints[k]! * 16;
    for (let i = 0; i < 16; i++) {
      skinMat[i] += w * uJointMatrices[base + i]!;
    }
  }
  const combined = mat4Create();
  mat4Multiply(combined, uModel, skinMat);
  return transformPoint(combined, pos);
}

function createRecordingCanvas(): {
  canvas: any;
  state: {
    lastModel: Float32Array | null;
    lastJoints: Float32Array | null;
    jointUploads: Array<Uint8Array | Uint16Array>;
    lastBoundBuffer: any;
    bufferDataMap: Map<any, ArrayBufferView>;
  };
} {
  const state = {
    lastModel: null as Float32Array | null,
    lastJoints: null as Float32Array | null,
    jointUploads: [] as Array<Uint8Array | Uint16Array>,
    lastBoundBuffer: null as any,
    bufferDataMap: new Map<any, ArrayBufferView>(),
  };
  let nextId = 1;
  const gl = new Proxy(
    {
      canvas: {width: 400, height: 400},
      ARRAY_BUFFER: 34962,
      ELEMENT_ARRAY_BUFFER: 34963,
      STATIC_DRAW: 35044,
      UNSIGNED_BYTE: 5121,
      UNSIGNED_SHORT: 5123,
      FLOAT: 5126,
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getAttribLocation: () => 0,
      createBuffer: () => ({id: nextId++}),
      bindBuffer: (_target: number, buf: any) => {
        state.lastBoundBuffer = buf;
      },
      bufferData: (_target: number, data: ArrayBufferView) => {
        if (state.lastBoundBuffer && ArrayBuffer.isView(data)) {
          state.bufferDataMap.set(state.lastBoundBuffer, data);
        }
      },
      vertexAttribIPointer: (loc: number) => {
        if (loc === 4 && state.lastBoundBuffer) {
          const uploaded = state.bufferDataMap.get(state.lastBoundBuffer);
          if (uploaded instanceof Uint8Array || uploaded instanceof Uint16Array) {
            state.jointUploads.push(uploaded);
          }
        }
      },
      getUniformLocation: (_prog: any, name: string) => name,
      uniformMatrix4fv: (loc: any, _transpose: boolean, val: Float32Array) => {
        if (loc === 'uModel') {
          state.lastModel = new Float32Array(val);
        } else if (loc === 'uJointMatrix[0]') {
          state.lastJoints = new Float32Array(val);
        }
      },
    },
    {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        return () => ({});
      },
    },
  );
  const canvas: any = {
    width: 400,
    height: 400,
    clientWidth: 400,
    clientHeight: 400,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 400}),
    getContext: () => gl,
  };
  return {canvas, state};
}

function packBuffers(chunks: ArrayBufferView[]): {
  bin: ArrayBuffer;
  views: Array<{buffer: number; byteOffset: number; byteLength: number}>;
} {
  let offset = 0;
  const views: Array<{buffer: number; byteOffset: number; byteLength: number}> =
    [];
  for (const ch of chunks) {
    offset = (offset + 3) & ~3;
    views.push({buffer: 0, byteOffset: offset, byteLength: ch.byteLength});
    offset += ch.byteLength;
  }
  const bin = new ArrayBuffer(offset);
  const out = new Uint8Array(bin);
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i]!;
    out.set(
      new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength),
      views[i]!.byteOffset,
    );
  }
  return {bin, views};
}

// =========================================================================
// 1. Blender / Mixamo / Meshy scale=0.01 Armature + ×100 IBMs + bounds
// =========================================================================
{
  const positions = new Float32Array([
    0.0, 0.0, 0.0, // feet (joint 0)
    -0.645, 0.9, -0.195, // left torso (50/50)
    0.645, 0.9, 0.195, // right torso (50/50)
    0.0, 1.8, 0.0, // head (joint 1)
  ]);
  const joints = new Uint8Array([
    0, 0, 0, 0,
    0, 1, 0, 0,
    0, 1, 0, 0,
    1, 0, 0, 0,
  ]);
  const weights = new Float32Array([
    1, 0, 0, 0,
    0.5, 0.5, 0, 0,
    0.5, 0.5, 0, 0,
    1, 0, 0, 0,
  ]);

  // Armature has scale=0.01; Hips at local (0, 90, 0) => world (0, 0.9, 0),
  // Head at local (0, 90, 0) under Hips => world (0, 1.8, 0).
  const hipsWorld = mat4FromRotationTranslationScale(
    mat4Create(),
    [0, 0, 0, 1],
    [0, 0.9, 0],
    [0.01, 0.01, 0.01],
  );
  const headWorld = mat4FromRotationTranslationScale(
    mat4Create(),
    [0, 0, 0, 1],
    [0, 1.8, 0],
    [0.01, 0.01, 0.01],
  );
  const ibm0 = mat4Invert(mat4Create(), hipsWorld)!;
  const ibm1 = mat4Invert(mat4Create(), headWorld)!;
  const ibms = new Float32Array(32);
  ibms.set(ibm0, 0);
  ibms.set(ibm1, 16);

  const times = new Float32Array([0, 1]);
  // Move Head up by +10 cm in Armature space => +0.1 m in world space.
  const headTrans = new Float32Array([0, 90, 0, 0, 100, 0]);

  const {bin, views} = packBuffers([
    positions,
    joints,
    weights,
    ibms,
    times,
    headTrans,
  ]);
  const glbData: GLBData = {
    bin,
    gltf: {
      asset: {version: '2.0'},
      scene: 0,
      scenes: [{nodes: [0]}],
      nodes: [
        {name: 'Armature', scale: [0.01, 0.01, 0.01], children: [1, 2]},
        {name: 'Character', mesh: 0, skin: 0},
        {name: 'Hips', translation: [0, 90, 0], children: [3]},
        {name: 'Head', translation: [0, 90, 0]},
      ],
      meshes: [
        {
          primitives: [
            {attributes: {POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2}},
          ],
        },
      ],
      skins: [{joints: [2, 3], inverseBindMatrices: 3}],
      animations: [
        {
          name: 'Stretch',
          samplers: [{input: 4, output: 5, interpolation: 'LINEAR'}],
          channels: [{sampler: 0, target: {node: 3, path: 'translation'}}],
        },
      ],
      buffers: [{byteLength: bin.byteLength}],
      bufferViews: views,
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 4,
          type: 'VEC3',
          min: [-0.645, 0, -0.195],
          max: [0.645, 1.8, 0.195],
        },
        {bufferView: 1, componentType: 5121, count: 4, type: 'VEC4'},
        {bufferView: 2, componentType: 5126, count: 4, type: 'VEC4'},
        {bufferView: 3, componentType: 5126, count: 2, type: 'MAT4'},
        {bufferView: 4, componentType: 5126, count: 2, type: 'SCALAR'},
        {bufferView: 5, componentType: 5126, count: 2, type: 'VEC3'},
      ],
    },
  };

  const {canvas, state} = createRecordingCanvas();
  const viewer = new ThreeView(canvas, canvas, {
    autoRotate: false,
    autoStart: false,
  });
  viewer.loadGLBData(glbData);

  // Bounds must reflect the 1.29 x 1.80 x 0.39 m bind pose, NOT 1.8 cm!
  assertNear(viewer.bounds.min[0], -0.645, 1e-4, 'Armature bounds min.x');
  assertNear(viewer.bounds.max[0], 0.645, 1e-4, 'Armature bounds max.x');
  assertNear(viewer.bounds.min[1], 0.0, 1e-4, 'Armature bounds min.y');
  assertNear(viewer.bounds.max[1], 1.8, 1e-4, 'Armature bounds max.y');
  assertNear(viewer.bounds.min[2], -0.195, 1e-4, 'Armature bounds min.z');
  assertNear(viewer.bounds.max[2], 0.195, 1e-4, 'Armature bounds max.z');

  // Bind-pose draw: uModel * skinMatrix * v == v in meters.
  viewer.render();
  assert.ok(state.lastModel && state.lastJoints, 'draw uploaded uModel and uJointMatrix');
  const headBind = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [0, 1.8, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
  );
  assertNear(headBind[0], 0.0, 1e-4, 'Head bind X');
  assertNear(headBind[1], 1.8, 1e-4, 'Head bind Y');
  assertNear(headBind[2], 0.0, 1e-4, 'Head bind Z');

  const torsoBind = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [-0.645, 0.9, -0.195],
    [0, 1, 0, 0],
    [0.5, 0.5, 0, 0],
  );
  assertNear(torsoBind[0], -0.645, 1e-4, 'Torso bind X');
  assertNear(torsoBind[1], 0.9, 1e-4, 'Torso bind Y');
  assertNear(torsoBind[2], -0.195, 1e-4, 'Torso bind Z');

  // Animated pose at t=1.0: Head moves +0.1 m to Y=1.9, torso (50% Head) moves +0.05 m to Y=0.95.
  viewer.playAnimation('Stretch');
  viewer.evaluateAnimation(1.0);
  viewer.render();
  const headAnim = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [0, 1.8, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
  );
  assertNear(headAnim[1], 1.9, 1e-4, 'Head animated Y');
  const torsoAnim = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [-0.645, 0.9, -0.195],
    [0, 1, 0, 0],
    [0.5, 0.5, 0, 0],
  );
  assertNear(torsoAnim[1], 0.95, 1e-4, 'Torso blended animated Y');

  // Turntable (modelRootMatrix) must still rotate the skinned character.
  (viewer as any).turntableRotation = Math.PI / 2;
  (viewer as any).updateTurntableMatrix();
  viewer.render();
  const torsoTurn = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [1, 0, 0],
    [0, 0, 0, 0],
    [1, 0, 0, 0],
  );
  assertNear(torsoTurn[0], 0.0, 1e-4, 'Turntable rotates skinned X -> 0');
  assertNear(Math.abs(torsoTurn[2]), 1.0, 1e-4, 'Turntable rotates skinned X -> ±Z');
}

// =========================================================================
// 2. Mesh node transform ignored per glTF 2.0 §3.7.3.2
// =========================================================================
{
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]);
  const joints = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const jointWorld = mat4FromRotationTranslationScale(
    mat4Create(),
    [0, 0, Math.SQRT1_2, Math.SQRT1_2], // +90 deg Z
    [0, 1, 0],
    [1, 1, 1],
  );
  const ibm = mat4Invert(mat4Create(), jointWorld)!;
  const {bin, views} = packBuffers([positions, joints, weights, ibm]);
  const glbData: GLBData = {
    bin,
    gltf: {
      asset: {version: '2.0'},
      scene: 0,
      scenes: [{nodes: [0, 1]}],
      nodes: [
        // Wild transform on the skinned mesh node — glTF says it MUST be ignored.
        {
          name: 'SkinnedMesh',
          mesh: 0,
          skin: 0,
          translation: [10, -5, 3],
          rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
          scale: [2, 3, 4],
        },
        {
          name: 'Joint0',
          translation: [0, 1, 0],
          rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        },
      ],
      meshes: [
        {
          primitives: [
            {attributes: {POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2}},
          ],
        },
      ],
      skins: [{joints: [1], inverseBindMatrices: 3}],
      buffers: [{byteLength: bin.byteLength}],
      bufferViews: views,
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 2, 0],
        },
        {bufferView: 1, componentType: 5121, count: 3, type: 'VEC4'},
        {bufferView: 2, componentType: 5126, count: 3, type: 'VEC4'},
        {bufferView: 3, componentType: 5126, count: 1, type: 'MAT4'},
      ],
    },
  };
  const {canvas, state} = createRecordingCanvas();
  const viewer = new ThreeView(canvas, canvas, {
    autoRotate: false,
    autoStart: false,
  });
  viewer.loadGLBData(glbData);
  assertNear(viewer.bounds.max[0], 1.0, 1e-4, 'Bounds ignores mesh node scale/translation X');
  assertNear(viewer.bounds.max[1], 2.0, 1e-4, 'Bounds ignores mesh node scale/translation Y');
  assertNear(viewer.bounds.min[0], 0.0, 1e-4, 'Bounds ignores mesh node min X');

  viewer.render();
  const pt = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [1, 2, 0],
    [0, 0, 0, 0],
    [1, 0, 0, 0],
  );
  assertNear(pt[0], 1.0, 1e-4, 'Mesh node transform cancelled X');
  assertNear(pt[1], 2.0, 1e-4, 'Mesh node transform cancelled Y');
  assertNear(pt[2], 0.0, 1e-4, 'Mesh node transform cancelled Z');
}

// =========================================================================
// 3. Khronos-style `node.matrix` (Z_UP root) preserved during animation
// =========================================================================
{
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 2]);
  const joints = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const ibmIdentity = mat4Create();
  const times = new Float32Array([0, 1]);
  // Joint translates +1 along its local +Z (which Z_UP maps to +Y in world).
  const jointTrans = new Float32Array([0, 0, 0, 0, 0, 1]);
  const {bin, views} = packBuffers([
    positions,
    joints,
    weights,
    ibmIdentity,
    times,
    jointTrans,
  ]);
  // Column-major -90 deg X rotation: maps Z-up (0, 0, 1) -> Y-up (0, 1, 0).
  const zUpMatrix = [
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ];
  // Sheared static matrix node (not targeted by animation) to verify exact preservation.
  const shearMatrix = [
    1, 0, 0, 0,
    0.5, 1, 0, 0,
    0, 0, 1, 0,
    2, 3, 4, 1,
  ];
  const glbData: GLBData = {
    bin,
    gltf: {
      asset: {version: '2.0'},
      scene: 0,
      scenes: [{nodes: [0, 3]}],
      nodes: [
        {name: 'Z_UP', matrix: zUpMatrix, children: [1, 2]},
        {name: 'MeshNode', mesh: 0, skin: 0},
        {name: 'Joint0'},
        {name: 'ShearedStatic', matrix: shearMatrix},
      ],
      meshes: [
        {
          primitives: [
            {attributes: {POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2}},
          ],
        },
      ],
      skins: [{joints: [2], inverseBindMatrices: 3}],
      animations: [
        {
          name: 'Lift',
          samplers: [{input: 4, output: 5, interpolation: 'LINEAR'}],
          channels: [{sampler: 0, target: {node: 2, path: 'translation'}}],
        },
      ],
      buffers: [{byteLength: bin.byteLength}],
      bufferViews: views,
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 0, 2],
        },
        {bufferView: 1, componentType: 5121, count: 3, type: 'VEC4'},
        {bufferView: 2, componentType: 5126, count: 3, type: 'VEC4'},
        {bufferView: 3, componentType: 5126, count: 1, type: 'MAT4'},
        {bufferView: 4, componentType: 5126, count: 2, type: 'SCALAR'},
        {bufferView: 5, componentType: 5126, count: 2, type: 'VEC3'},
      ],
    },
  };

  const {canvas, state} = createRecordingCanvas();
  const viewer = new ThreeView(canvas, canvas, {
    autoRotate: false,
    autoStart: false,
  });
  viewer.loadGLBData(glbData);

  // Verify initialNodeTransforms decomposed Z_UP matrix rather than identity.
  const zUpInit = viewer.initialNodeTransforms[0]!;
  const recomposed = mat4FromRotationTranslationScale(
    mat4Create(),
    zUpInit.r,
    zUpInit.t,
    zUpInit.s,
  );
  for (let i = 0; i < 16; i++) {
    assertNear(recomposed[i]!, zUpMatrix[i]!, 1e-5, `Z_UP decomposed mat[${i}]`);
  }

  // Evaluate animation at t=1.0 and verify Z_UP & ShearedStatic stayed intact!
  viewer.playAnimation('Lift');
  viewer.evaluateAnimation(1.0);
  for (let i = 0; i < 16; i++) {
    assertNear(
      viewer.worldMatrices[0]![i]!,
      zUpMatrix[i]!,
      1e-5,
      `Z_UP worldMatrices[0][${i}] preserved during animation`,
    );
    assertNear(
      viewer.worldMatrices[3]![i]!,
      shearMatrix[i]!,
      1e-5,
      `ShearedStatic matrix[${i}] preserved verbatim during animation`,
    );
  }

  viewer.render();
  // Local vertex (0, 0, 2) + joint translation (0, 0, 1) => (0, 0, 3) in Z_UP => (0, 3, 0) in Y-up!
  const lifted = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [0, 0, 2],
    [0, 0, 0, 0],
    [1, 0, 0, 0],
  );
  assertNear(lifted[0], 0.0, 1e-4, 'Z_UP animated skinned X');
  assertNear(lifted[1], 3.0, 1e-4, 'Z_UP animated skinned Y');
  assertNear(lifted[2], 0.0, 1e-4, 'Z_UP animated skinned Z');
}

// =========================================================================
// 4. Omitted inverseBindMatrices (identity) + strided/unaligned UNSIGNED_SHORT JOINTS_0
// =========================================================================
{
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  // Interleaved buffer with 1-byte leading offset (unaligned for Uint16Array)
  // and byteStride = 12 (8 bytes of 4x uint16 joints + 4 bytes padding).
  const interleaved = new Uint8Array(1 + 3 * 12);
  const dv = new DataView(interleaved.buffer);
  for (let v = 0; v < 3; v++) {
    const base = 1 + v * 12;
    dv.setUint16(base, 0, true);
    dv.setUint16(base + 2, 0, true);
    dv.setUint16(base + 4, 0, true);
    dv.setUint16(base + 6, 0, true);
  }
  const {bin, views} = packBuffers([positions, interleaved, weights]);
  const glbData: GLBData = {
    bin,
    gltf: {
      asset: {version: '2.0'},
      scene: 0,
      scenes: [{nodes: [0, 1]}],
      nodes: [
        {name: 'Mesh', mesh: 0, skin: 0, translation: [5, 0, 0]},
        {name: 'Joint0', translation: [0, 2, 0]},
      ],
      meshes: [
        {
          primitives: [
            {attributes: {POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2}},
          ],
        },
      ],
      // inverseBindMatrices deliberately omitted (glTF 2.0 default = identity).
      skins: [{joints: [1]}],
      buffers: [{byteLength: bin.byteLength}],
      bufferViews: [
        views[0]!,
        {...views[1]!, byteStride: 12},
        views[2]!,
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        {
          bufferView: 1,
          byteOffset: 1,
          componentType: 5123,
          count: 3,
          type: 'VEC4',
        },
        {bufferView: 2, componentType: 5126, count: 3, type: 'VEC4'},
      ],
    },
  };
  const {canvas, state} = createRecordingCanvas();
  const viewer = new ThreeView(canvas, canvas, {
    autoRotate: false,
    autoStart: false,
  });
  viewer.loadGLBData(glbData);
  assert.equal(state.jointUploads.length, 1, 'strided/unaligned UNSIGNED_SHORT JOINTS_0 uploaded');
  assert.ok(state.jointUploads[0] instanceof Uint16Array, 'UNSIGNED_SHORT joints uploaded as Uint16Array');
  // Bounds should reflect Joint0's +2 Y translation (and ignore Mesh's +5 X).
  assertNear(viewer.bounds.min[0], 0.0, 1e-4, 'Omitted IBM bounds min X');
  assertNear(viewer.bounds.min[1], 2.0, 1e-4, 'Omitted IBM bounds min Y');
  assertNear(viewer.bounds.max[1], 3.0, 1e-4, 'Omitted IBM bounds max Y');

  viewer.render();
  const pt = evalSkinnedWorldPoint(
    state.lastModel!,
    state.lastJoints!,
    [0, 0, 0],
    [0, 0, 0, 0],
    [1, 0, 0, 0],
  );
  assertNear(pt[0], 0.0, 1e-4, 'Omitted IBM ignores mesh X translation');
  assertNear(pt[1], 2.0, 1e-4, 'Omitted IBM applies joint Y translation');
}

// =========================================================================
// 5. Shader contract (clamped joints, normal skinning, TSL compatibility)
// =========================================================================
{
  const baseVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uMVP,uModel;
uniform mat3 uNormalMatrix;
out vec3 vNormal,vWorldPos;
out vec2 vUV;
void main(){
vec3 aPosition=aPos;
vec3 rawN=uNormalMatrix*aNormal;
vNormal=length(rawN)>1e-5?normalize(rawN):vec3(0.0);
vec4 world=uModel*vec4(aPosition,1.0);
vWorldPos=world.xyz;
vUV=aUV;
gl_Position=uMVP*vec4(aPosition,1.0);
}`;
  const resolved = skinningPlugin.onResolveShader!(
    {attributes: {JOINTS_0: 0, WEIGHTS_0: 1}},
    {},
    baseVS,
    'void main(){}',
  );
  assert.ok(resolved, 'skinningPlugin resolves skinned vertex shader');
  assert.ok(
    resolved!.vs.includes('clamp(int(aJoints.x), 0, 63)'),
    'skinning shader clamps joint indices to MAX_JOINTS - 1',
  );
  assert.ok(
    resolved!.vs.includes('mat3 skinWorld3 = mat3(uModel * skinMatrix);'),
    'skinning shader transforms normals with skinned world matrix',
  );
  assert.ok(
    resolved!.vs.includes('vec4 world=uModel*(skinMatrix*vec4(aPosition,1.0));'),
    'skinning shader preserves TSL-compatible world assignment line',
  );
}

// =========================================================================
// 6. mat4DecomposeTRS round-trip across all quaternion branches + reflection
// =========================================================================
{
  const cases: Array<{
    name: string;
    t: [number, number, number];
    r: [number, number, number, number];
    s: [number, number, number];
  }> = [
    {name: 'identity', t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1]},
    {name: 'rotX-180', t: [1, 2, 3], r: [1, 0, 0, 0], s: [2, 3, 4]},
    {name: 'rotY-180', t: [-4, 5, -6], r: [0, 1, 0, 0], s: [0.5, 1.5, 2.5]},
    {name: 'rotZ-180', t: [7, -8, 9], r: [0, 0, 1, 0], s: [1, 2, 0.25]},
    {
      name: 'general-nonuniform',
      t: [3.2, -1.4, 0.8],
      r: [0.3, -0.5, 0.4, Math.sqrt(1 - 0.09 - 0.25 - 0.16)],
      s: [0.01, 0.02, 0.03],
    },
    {
      name: 'reflection-negative-det',
      t: [0.5, -0.5, 1.2],
      r: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      s: [-1, 2, 3],
    },
  ];
  for (const tc of cases) {
    const orig = mat4FromRotationTranslationScale(
      mat4Create(),
      tc.r,
      tc.t,
      tc.s,
    );
    const dec = mat4DecomposeTRS(orig);
    const rebuilt = mat4FromRotationTranslationScale(
      mat4Create(),
      dec.r,
      dec.t,
      dec.s,
    );
    for (let i = 0; i < 16; i++) {
      assertNear(
        rebuilt[i]!,
        orig[i]!,
        1e-5,
        `mat4DecomposeTRS round-trip (${tc.name})[${i}]`,
      );
    }
  }
}

console.log(
  'PASS skinning IBMs, mesh-node transform cancellation, skinned bounds, node.matrix animation, and mat4DecomposeTRS',
);
