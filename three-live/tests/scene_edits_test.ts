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

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeSubtreeBounds,
  computeSubtreeBoundsSize,
  prepareSceneEdit,
  SceneEditor,
  sceneEditsPlugin,
  type SceneEditableElement,
} from '../src/edits';
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
} from '../src/three-author';
import {InteractivityVM} from '../src/plugins/interactivity';
import {
  decodeMeshoptGLB,
  encodeMeshoptBuffer,
} from '../src/plugins/meshopt';
import {toGLBData} from '../src/three-view';

function buildTowerScene(
  name = 'Tower',
  size: [number, number, number] = [1, 2, 1],
  color = 0xef4444,
  asCylinder = false,
  position: [number, number, number] = [0, 0, 0],
) {
  const s = new Scene();
  const geo = asCylinder
    ? new CylinderGeometry(size[0] / 2, size[0] / 2, size[1], 32)
    : new BoxGeometry(size[0], size[1], size[2]);
  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({color, roughness: 0.4, metalness: 0.1}),
  );
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  s.add(mesh);
  return toGLBData(s.toGLB());
}

async function runTests() {
  const original = buildTowerScene(
    'Tower',
    [1, 2, 1],
    0xef4444,
    false,
    [1, 2, 3],
  );
  const cylinderReplacement = buildTowerScene(
    'Turret',
    [1, 2, 1],
    0x3b82f6,
    true,
    [0, 0, 0],
  );

  let current = original;
  let loads = 0;
  const deniedEvents: Array<{capability: string; feature: string}> = [];

  const host: SceneEditableElement & {
    dispatchEvent(ev: {type?: string; detail?: any}): boolean;
  } = {
    getLoadedModel: () => current,
    async loadModel(model: any) {
      loads++;
      current = model;
    },
    dispatchEvent(ev: {type?: string; detail?: any}) {
      if (ev?.type === 'three-capability-denied' && ev.detail) {
        deniedEvents.push({
          capability: ev.detail.capability,
          feature: ev.detail.feature,
        });
      }
      return true;
    },
  };

  // 1. Plugin installation attaches el.sceneEditor and *NodeEdit helpers cleanly
  sceneEditsPlugin.onElementConnected?.(host);
  assert.ok(host.sceneEditor instanceof SceneEditor);
  assert.equal(typeof host.previewNodeEdit, 'function');

  // 2. Object replacement preserving bounds AND copying/matching original material
  const preview = await host.previewNodeEdit!({
    target: 'Tower',
    replacement: cylinderReplacement,
    copyMaterialFrom: 'Tower',
    constraints: {
      preserveBounds: {tolerance: 0.02},
      matchMaterialOf: 'Tower',
    },
  });
  assert.equal(preview.status, 'preview');
  assert.equal(preview.applied, true);
  assert.ok(preview.constraints.every((c) => c.passed));
  const afterBounds = computeSubtreeBoundsSize(current, [0]);
  assert.ok(Math.abs(afterBounds[0] - 1) < 0.02);
  assert.ok(Math.abs(afterBounds[1] - 2) < 0.02);
  assert.ok(Math.abs(afterBounds[2] - 1) < 0.02);

  const accepted = host.acceptNodeEdit!();
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.undoDepth, 1);

  const undone = await host.undoNodeEdit!();
  assert.equal(undone.status, 'undone');
  assert.deepEqual(current.gltf, original.gltf);

  // 3. Rejected constraint-violating edit leaves the active scene completely untouched
  const snapshotBeforeReject = current;
  const loadsBeforeReject = loads;
  const oversize = buildTowerScene('TallTower', [1, 8, 1], 0xef4444, false);
  const rejected = await host.previewNodeEdit!({
    target: 'Tower',
    replacement: oversize,
    constraints: {preserveHeight: true, preserveBounds: true},
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.applied, false);
  assert.equal(loads, loadsBeforeReject, 'Failed constraints never touch GPU loadModel');
  assert.equal(current, snapshotBeforeReject);

  // 4. Capability enforcement: remote URL replacement fails closed without remote_content
  const deniedReceipt = await host.previewNodeEdit!({
    target: 'Tower',
    replacement: 'https://cdn.example.com/turret.glb',
  });
  assert.equal(deniedReceipt.status, 'rejected');
  assert.equal(deniedReceipt.applied, false);
  assert.ok(
    deniedEvents.some(
      (e) => e.capability === 'remote_content' && e.feature === 'previewEdit',
    ),
  );
  assert.match(deniedReceipt.errors.join(' '), /Capability 'remote_content'/);
  assert.equal(current, snapshotBeforeReject);

  // 5. External host.loadModel call during pending async replacement supersedes the edit
  let resolveSlow!: (v: any) => void;
  const slowPromise = host.previewNodeEdit!({
    target: 'Tower',
    replacement: new Promise((r) => {
      resolveSlow = r;
    }),
  });
  const externalScene = buildTowerScene(
    'Tower',
    [1, 2, 1],
    0x22c55e,
    false,
    [1, 2, 3],
  );
  await host.loadModel(externalScene);
  resolveSlow(cylinderReplacement);
  const superseded = await slowPromise;
  assert.equal(superseded.status, 'rejected');
  assert.match(superseded.errors.join(' '), /superseded/);
  assert.equal(current, externalScene, 'Superseded edit never clobbers external load');

  // 6. preserveBounds rejects an equal-size replacement translated 50 units away
  const translated50Local = buildTowerScene(
    'ShiftedLocal',
    [1, 2, 1],
    0x22c55e,
    false,
    [50, 0, 0],
  );
  const rejectedTranslatedLocal = await host.previewNodeEdit!({
    target: 'Tower',
    replacement: translated50Local,
    constraints: {preserveBounds: true},
  });
  assert.equal(rejectedTranslatedLocal.status, 'rejected');
  assert.equal(rejectedTranslatedLocal.applied, false);
  assert.deepEqual(rejectedTranslatedLocal.constraints, [
    {name: 'preserveBounds', passed: false},
  ]);

  const translated50World = buildTowerScene(
    'Tower',
    [1, 2, 1],
    0x22c55e,
    false,
    [51, 2, 3],
  );
  const rejectedTranslatedWorld = await host.previewNodeEdit!({
    target: 'Tower',
    replacement: translated50World,
    preserveTransform: false,
    constraints: {preserveBounds: true},
  });
  assert.equal(rejectedTranslatedWorld.status, 'rejected');
  assert.equal(rejectedTranslatedWorld.applied, false);
  assert.equal(current, externalScene);

  // 7. Repeated replacements reclaim detached meshes, materials, accessors, and binary bytes
  const boxInitial = buildTowerScene(
    'Box',
    [1, 1, 1],
    0xef4444,
    false,
    [0, 0, 0],
  );
  const initialBinBytes = boxInitial.bin.byteLength;
  assert.equal(initialBinBytes, 840);
  await host.loadModel(boxInitial);

  for (let iter = 0; iter < 8; iter++) {
    const nextBox = buildTowerScene(
      'Box',
      [1, 1, 1],
      0x100000 + iter * 0x112200,
      false,
      [0, 0, 0],
    );
    const r = await host.previewNodeEdit!({
      target: 'Box',
      replacement: nextBox,
      constraints: {preserveBounds: {tolerance: 0.01}},
    });
    assert.equal(r.status, 'preview');
    assert.equal(r.applied, true);
    const acc = host.acceptNodeEdit!();
    assert.equal(acc.status, 'accepted');
  }
  assert.equal(
    current.gltf.meshes.length,
    1,
    'Repeated replacements reclaim prior detached meshes (1 active mesh after 8 edits)',
  );
  assert.equal(
    current.gltf.materials.length,
    1,
    'Repeated replacements reclaim prior detached materials',
  );
  assert.equal(
    current.bin.byteLength,
    initialBinBytes,
    'Repeated replacements repack BIN without unbounded binary growth (840 B -> 840 B)',
  );
  const boundsAfter8 = computeSubtreeBounds(current, [0]);
  assert.deepEqual(boundsAfter8.min, [-0.5, -0.5, -0.5]);
  assert.deepEqual(boundsAfter8.max, [0.5, 0.5, 0.5]);

  // 8. Multi-target subtree isolation & duplicate-target rejection
  const multi = buildTowerScene(
    'Tower',
    [1, 2, 1],
    0xef4444,
    false,
    [1, 2, 3],
  );
  const firstNode = multi.gltf.nodes.find((n: any) => n.name === 'Tower');
  const sibling = structuredClone(firstNode);
  sibling.name = 'Other';
  const siblingIdx = multi.gltf.nodes.push(sibling) - 1;
  multi.gltf.scenes[0].nodes.push(siblingIdx);
  const mergedBoth = prepareSceneEdit(multi, cylinderReplacement, {
    target: ['Tower', 'Other'],
    replacement: cylinderReplacement,
  });
  const nodeA = mergedBoth.model.gltf.nodes.find((n: any) => n.name === 'Tower');
  const nodeB = mergedBoth.model.gltf.nodes.find((n: any) => n.name === 'Other');
  assert.notEqual(nodeA.children[0], nodeB.children[0]);

  // 9. Untouched EXT_meshopt_compression sibling survives BIN compaction and decodes cleanly
  for (const useFallbackBuffer of [false, true]) {
    const plainCylinder = buildTowerScene(
      'EditMe',
      [1, 2, 1],
      0xef4444,
      true,
      [-2, 0, 0],
    );
    const rawPos = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ]);
    const rawIdx = new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    ]);
    const encPos = encodeMeshoptBuffer(
      new Uint8Array(rawPos.buffer),
      8,
      12,
      'ATTRIBUTES',
    );
    const encIdx = encodeMeshoptBuffer(
      new Uint8Array(rawIdx.buffer),
      12,
      2,
      'TRIANGLES',
    );
    const plainLen = (plainCylinder.bin.byteLength + 3) & ~3;
    const posCompOff = plainLen;
    const idxCompOff = (posCompOff + encPos.byteLength + 3) & ~3;
    const combinedLen = (idxCompOff + encIdx.byteLength + 3) & ~3;
    const combinedBin = new Uint8Array(combinedLen);
    combinedBin.set(new Uint8Array(plainCylinder.bin), 0);
    combinedBin.set(encPos, posCompOff);
    combinedBin.set(encIdx, idxCompOff);

    const mixedDoc = {
      gltf: structuredClone(plainCylinder.gltf),
      bin: combinedBin.buffer,
      lights: [],
    };
    const mg = mixedDoc.gltf;
    mg.extensionsUsed = ['EXT_meshopt_compression'];
    mg.buffers = [{byteLength: combinedLen}];
    if (useFallbackBuffer) {
      mg.buffers.push({
        byteLength: rawPos.byteLength + rawIdx.byteLength,
        extensions: {EXT_meshopt_compression: {fallback: true}},
      });
    }
    const posBvIdx =
      mg.bufferViews.push({
        buffer: useFallbackBuffer ? 1 : 0,
        byteOffset: 0,
        byteLength: rawPos.byteLength,
        byteStride: 12,
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: posCompOff,
            byteLength: encPos.byteLength,
            byteStride: 12,
            count: 8,
            mode: 'ATTRIBUTES',
          },
        },
      }) - 1;
    const idxBvIdx =
      mg.bufferViews.push({
        buffer: useFallbackBuffer ? 1 : 0,
        byteOffset: useFallbackBuffer ? rawPos.byteLength : 0,
        byteLength: rawIdx.byteLength,
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: idxCompOff,
            byteLength: encIdx.byteLength,
            byteStride: 2,
            count: 12,
            mode: 'TRIANGLES',
          },
        },
      }) - 1;
    const posAccIdx =
      mg.accessors.push({
        bufferView: posBvIdx,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
      }) - 1;
    const idxAccIdx =
      mg.accessors.push({
        bufferView: idxBvIdx,
        componentType: 5123,
        count: 12,
        type: 'SCALAR',
      }) - 1;
    const compMeshIdx =
      mg.meshes.push({
        name: 'CompressedBoxMesh',
        primitives: [{attributes: {POSITION: posAccIdx}, indices: idxAccIdx}],
      }) - 1;
    const compNodeIdx =
      mg.nodes.push({
        name: 'CompressedBox',
        mesh: compMeshIdx,
        translation: [2, 0, 0],
      }) - 1;
    mg.scenes[0].nodes.push(compNodeIdx);

    // Verify untouched meshopt box decodes before the edit
    const preCheck = {
      gltf: structuredClone(mixedDoc.gltf),
      bin: mixedDoc.bin.slice(0),
      lights: [],
    };
    decodeMeshoptGLB(preCheck);

    // Replace the large plain cylinder beside it with a smaller 840-byte box (shrinking BIN!)
    const smallBox = buildTowerScene(
      'SmallBox',
      [1, 1, 1],
      0x3b82f6,
      false,
      [0, 0, 0],
    );
    const editedMixed = prepareSceneEdit(mixedDoc, smallBox, {
      target: 'EditMe',
      replacement: smallBox,
    }).model;

    assert.ok(
      editedMixed.bin.byteLength < mixedDoc.bin.byteLength,
      'Replacing cylinder with box shrinks repacked BIN while remapping meshopt offsets',
    );
    const postCheck = {
      gltf: structuredClone(editedMixed.gltf),
      bin: editedMixed.bin.slice(0),
      lights: [],
    };
    decodeMeshoptGLB(postCheck);
    const compNodeAfter = postCheck.gltf.nodes.find(
      (n: any) => n.name === 'CompressedBox',
    );
    const compPrimAfter =
      postCheck.gltf.meshes[compNodeAfter.mesh].primitives[0];
    const decPosBv =
      postCheck.gltf.bufferViews[
        postCheck.gltf.accessors[compPrimAfter.attributes.POSITION].bufferView
      ];
    const decIdxBv =
      postCheck.gltf.bufferViews[
        postCheck.gltf.accessors[compPrimAfter.indices].bufferView
      ];
    const decodedPos = new Float32Array(
      postCheck.bin,
      decPosBv.byteOffset,
      rawPos.length,
    );
    const decodedIdx = new Uint16Array(
      postCheck.bin,
      decIdxBv.byteOffset,
      rawIdx.length,
    );
    assert.deepEqual(Array.from(decodedPos), Array.from(rawPos));
    assert.deepEqual(Array.from(decodedIdx), Array.from(rawIdx));
  }

  // 11. KHR_interactivity pointer/nodeIndex/material remapping & fail-closed extension guards
  {
    const interScene = new Scene();
    const targetGroup = new Group();
    targetGroup.name = 'TargetGroup';
    const oldPart = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({color: 0xef4444}),
    );
    oldPart.name = 'OldPart';
    targetGroup.add(oldPart);
    interScene.add(targetGroup);

    const untouchedSibling = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({color: 0x3b82f6}),
    );
    untouchedSibling.name = 'UntouchedSibling';
    untouchedSibling.position.set(3, 0, 0);
    untouchedSibling.userData.interactivity = {
      onSelect: [
        {
          action: 'interpolate',
          property: 'translation',
          to: [3, 5, 0],
          duration: 0,
        },
        {
          action: 'cycleMaterialColor',
          colors: [[0, 1, 0, 1]],
          duration: 0,
        },
      ],
    };
    interScene.add(untouchedSibling);

    const interBase = toGLBData(interScene.toGLB());
    // Before edit: TargetGroup=0, OldPart=1, UntouchedSibling=2
    assert.equal(interBase.gltf.nodes[2].name, 'UntouchedSibling');

    const replacementPart = buildTowerScene('ReplacementBox', [1, 1, 1], 0xf59e0b);
    const editedInter = prepareSceneEdit(interBase, replacementPart, {
      target: 'TargetGroup',
      replacement: replacementPart,
    }).model;

    // After compaction: TargetGroup=0, UntouchedSibling=1, ReplacementBox=2!
    const sibIdx = editedInter.gltf.nodes.findIndex(
      (n: any) => n.name === 'UntouchedSibling',
    );
    const repIdx = editedInter.gltf.nodes.findIndex(
      (n: any) => n.name === 'ReplacementBox',
    );
    assert.equal(sibIdx, 1);
    assert.equal(repIdx, 2);

    const graph = editedInter.gltf.extensions.KHR_interactivity.graphs[0];
    const ptrStrings = graph.nodes
      .map((n: any) => n.configuration?.pointer)
      .filter(Boolean);
    assert.ok(
      ptrStrings.includes(`/nodes/${sibIdx}/translation`),
      `Expected KHR_interactivity pointer remapped to /nodes/${sibIdx}/translation, got ${JSON.stringify(ptrStrings)}`,
    );
    assert.ok(
      !ptrStrings.includes(`/nodes/${repIdx}/translation`),
      'KHR_interactivity pointer must not point to replacement node at old index 2',
    );
    const sibMatIdx =
      editedInter.gltf.meshes[editedInter.gltf.nodes[sibIdx].mesh].primitives[0]
        .material;
    assert.ok(
      ptrStrings.includes(
        `/materials/${sibMatIdx}/pbrMetallicRoughness/baseColorFactor`,
      ),
      'KHR_interactivity material pointer must remap to surviving sibling material',
    );

    // Execute InteractivityVM on the edited document and verify clicking UntouchedSibling
    // moves UntouchedSibling (node 1), NOT ReplacementBox (node 2)
    const vm = new InteractivityVM({}, editedInter.gltf, graph);
    vm.fireOnSelect({nodeIndex: sibIdx});
    assert.deepEqual(editedInter.gltf.nodes[sibIdx].translation, [3, 5, 0]);
    assert.notDeepEqual(editedInter.gltf.nodes[repIdx].translation, [3, 5, 0]);
    assert.deepEqual(
      editedInter.gltf.materials[sibMatIdx].pbrMetallicRoughness.baseColorFactor,
      [0, 1, 0, 1],
    );
    vm.dispose();

    // Templated static pointer (/nodes/{target}/scale with {value: [2]}) remaps to [1]
    const tplBase = {
      gltf: structuredClone(interBase.gltf),
      bin: interBase.bin.slice(0),
      lights: [],
    };
    tplBase.gltf.extensions.KHR_interactivity = {
      graphs: [
        {
          declarations: [{op: 'event/onStart'}, {op: 'pointer/set'}],
          nodes: [
            {declaration: 0, flows: {out: {node: 1}}},
            {
              declaration: 1,
              configuration: {pointer: {value: '/nodes/{target}/scale'}},
              values: {
                target: {value: [2]},
                value: {value: [2, 2, 2]},
              },
            },
          ],
        },
      ],
      graph: 0,
    };
    const editedTpl = prepareSceneEdit(tplBase, replacementPart, {
      target: 'TargetGroup',
      replacement: replacementPart,
    }).model;
    assert.deepEqual(
      editedTpl.gltf.extensions.KHR_interactivity.graphs[0].nodes[1].values
        .target.value,
      [1],
    );

    // Fail-closed: pointer targeting detached child OldPart (node 1) rejects edit
    let curModel: any = interBase;
    const guardEditor = new SceneEditor({
      getLoadedModel: () => curModel,
      loadModel: async (m) => {
        curModel = m;
      },
    });
    const detachedPtrDoc = {
      gltf: structuredClone(interBase.gltf),
      bin: interBase.bin.slice(0),
      lights: [],
    };
    detachedPtrDoc.gltf.extensions.KHR_interactivity.graphs[0].nodes.push({
      op: 'pointer/set',
      configuration: {pointer: '/nodes/1/translation'},
      values: {value: {value: [0, 1, 0]}},
    });
    curModel = detachedPtrDoc;
    const rejDetached = await guardEditor.previewEdit({
      target: 'TargetGroup',
      replacement: replacementPart,
    });
    assert.equal(rejDetached.status, 'rejected');
    assert.equal(rejDetached.applied, false);
    assert.equal(curModel, detachedPtrDoc);

    // Fail-closed: dynamic pointer template rejects edit
    const dynPtrDoc = {
      gltf: structuredClone(interBase.gltf),
      bin: interBase.bin.slice(0),
      lights: [],
    };
    dynPtrDoc.gltf.extensions.KHR_interactivity = {
      graphs: [
        {
          declarations: [
            {op: 'event/onStart'},
            {op: 'flow/for'},
            {op: 'pointer/set'},
          ],
          nodes: [
            {declaration: 0, flows: {out: {node: 1}}},
            {
              declaration: 1,
              values: {startIndex: {value: 0}, endIndex: {value: 2}},
              flows: {body: {node: 2}},
            },
            {
              declaration: 2,
              configuration: {pointer: '/nodes/{idx}/scale'},
              values: {
                idx: {node: 1, socket: 'index'},
                value: {value: [1, 1, 1]},
              },
            },
          ],
        },
      ],
      graph: 0,
    };
    curModel = dynPtrDoc;
    const rejDyn = await guardEditor.previewEdit({
      target: 'TargetGroup',
      replacement: replacementPart,
    });
    assert.equal(rejDyn.status, 'rejected');
    assert.equal(rejDyn.applied, false);

    // Fail-closed: unsupported base document extension rejects edit
    const unknownExtDoc = {
      gltf: structuredClone(interBase.gltf),
      bin: interBase.bin.slice(0),
      lights: [],
    };
    unknownExtDoc.gltf.extensionsUsed = ['VENDOR_custom_rig'];
    unknownExtDoc.gltf.extensions = {VENDOR_custom_rig: {node: 2}};
    curModel = unknownExtDoc;
    const rejUnknown = await guardEditor.previewEdit({
      target: 'TargetGroup',
      replacement: replacementPart,
    });
    assert.equal(rejUnknown.status, 'rejected');
    assert.equal(rejUnknown.applied, false);
  }

  // 12. Indexed-vertex bounds: unreferenced POSITION outliers are ignored; index-only extent growth fails preserveBounds
  {
    const makeSharedPosIndexedBox = (
      name: string,
      useLargeRange: boolean,
      useUint32 = false,
    ) => {
      // 8 unit-cube vertices [-0.5..0.5] (extent 1) followed by 8 10x-cube vertices [-5..5] (extent 10)
      const unitVerts = [
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
      ];
      const tenVerts = unitVerts.map((v) => v * 10);
      const geo = new BufferGeometry();
      geo.setAttribute(
        'position',
        new Float32BufferAttribute([...unitVerts, ...tenVerts], 3),
      );
      const baseOff = useLargeRange ? 8 : 0;
      const triIndices = [
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
      ].map((i) => i + baseOff);
      geo.setIndex(
        useUint32
          ? new Uint32BufferAttribute(triIndices, 1)
          : new Uint16BufferAttribute(triIndices, 1),
      );
      const s = new Scene();
      const m = new Mesh(geo, new MeshStandardMaterial({color: 0x10b981}));
      m.name = name;
      s.add(m);
      return toGLBData(s.toGLB());
    };

    const unitIndexed = makeSharedPosIndexedBox('Target', false, false);
    const tenIndexed = makeSharedPosIndexedBox('Target', true, true);

    assert.deepEqual(computeSubtreeBoundsSize(unitIndexed, [0]), [1, 1, 1]);
    assert.deepEqual(computeSubtreeBoundsSize(tenIndexed, [0]), [10, 10, 10]);

    let activeIndexed = unitIndexed;
    const idxEditor = new SceneEditor({
      getLoadedModel: () => activeIndexed,
      loadModel: async (m) => {
        activeIndexed = m;
      },
    });
    const idxReceipt = await idxEditor.previewEdit({
      target: 'Target',
      replacement: tenIndexed,
      constraints: {preserveBounds: {tolerance: 0}},
    });
    assert.equal(idxReceipt.status, 'rejected');
    assert.equal(idxReceipt.applied, false);
    assert.equal(idxReceipt.constraints[0]?.name, 'preserveBounds');
    assert.equal(idxReceipt.constraints[0]?.passed, false);
    assert.equal(activeIndexed, unitIndexed);

    // UNSIGNED_BYTE (5121) indices also compute exact referenced bounds
    const u8Doc = {
      gltf: structuredClone(unitIndexed.gltf),
      bin: unitIndexed.bin.slice(0),
      lights: [],
    };
    const u8Bytes = new Uint8Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    const oldBin = new Uint8Array(u8Doc.bin);
    const merged = new Uint8Array(oldBin.length + 12);
    merged.set(oldBin);
    merged.set(u8Bytes, oldBin.length);
    u8Doc.bin = merged.buffer;
    u8Doc.gltf.buffers[0].byteLength = merged.length;
    const idxAcc =
      u8Doc.gltf.accessors[u8Doc.gltf.meshes[0].primitives[0].indices];
    const idxBv = u8Doc.gltf.bufferViews[idxAcc.bufferView];
    idxBv.byteOffset = oldBin.length;
    idxBv.byteLength = 12;
    idxAcc.componentType = 5121;
    idxAcc.count = 12;
    assert.deepEqual(computeSubtreeBounds(u8Doc, [0]).size, [1, 1, 1]);
  }

  // 13. Chained edits with preserveTargetName: false clear duplicate child name
  {
    let curChain = buildTowerScene('Tower', [1, 2, 1], 0xef4444);
    const obelisk = buildTowerScene('Obelisk', [1, 2, 1], 0x3b82f6);
    const spire = buildTowerScene('Spire', [1, 2, 1], 0x10b981);
    const chainEditor = new SceneEditor({
      getLoadedModel: () => curChain,
      loadModel: async (m) => {
        curChain = m;
      },
    });
    const r1 = await chainEditor.previewEdit({
      target: 'Tower',
      replacement: obelisk,
      preserveTargetName: false,
    });
    assert.equal(r1.status, 'preview');
    assert.equal(
      curChain.gltf.nodes.filter((n: any) => n.name === 'Obelisk').length,
      1,
      'preserveTargetName: false must not leave a duplicate child name',
    );
    assert.equal(chainEditor.acceptEdit().status, 'accepted');

    const r2 = await chainEditor.previewEdit({
      target: 'Obelisk',
      replacement: spire,
      preserveTargetName: false,
    });
    assert.equal(r2.status, 'preview');
    assert.equal(
      curChain.gltf.nodes.filter((n: any) => n.name === 'Spire').length,
      1,
    );
  }

  // 14. Prototype unhooking & concurrent external loadModel mid-apply supersession
  {
    const initialModel = buildTowerScene('Tower', [1, 2, 1], 0xef4444);
    const candidateModel = buildTowerScene('Tower', [1, 2, 1], 0x3b82f6);
    const externalModel = buildTowerScene('External', [2, 2, 2], 0x10b981);

    class ProtoElement {
      current = initialModel;
      onMidApply: (() => Promise<void>) | null = null;
      getLoadedModel() {
        return this.current;
      }
      async loadModel(m: any) {
        this.current = m;
        if (this.onMidApply) {
          const cb = this.onMidApply;
          this.onMidApply = null;
          await cb();
        }
      }
      executeScript(_code: string) {}
    }

    const protoEl = new ProtoElement();
    assert.equal(Object.prototype.hasOwnProperty.call(protoEl, 'loadModel'), false);
    const protoEditor = new SceneEditor(protoEl);
    assert.equal(Object.prototype.hasOwnProperty.call(protoEl, 'loadModel'), true);

    // Trigger an external host.loadModel() mid-await while apply() is running!
    protoEl.onMidApply = async () => {
      await protoEl.loadModel(externalModel);
    };
    const midRace = await protoEditor.previewEdit({
      target: 'Tower',
      replacement: candidateModel,
    });
    assert.equal(midRace.status, 'rejected');
    assert.equal(midRace.applied, false);
    assert.equal(protoEl.current, externalModel);

    await protoEditor.dispose();
    assert.equal(
      Object.prototype.hasOwnProperty.call(protoEl, 'loadModel'),
      false,
      'dispose() deletes wrapper so inherited prototype method is exposed again',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(protoEl, 'executeScript'),
      false,
    );
  }

  // 15. Remote fetch AbortController + streaming MAX_BYTES cap, and disconnect without GPU reload
  {
    const prevFetch = globalThis.fetch;
    try {
      // 15a. AbortController aborts in-flight fetch on supersession
      let capturedSignal: AbortSignal | undefined;
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }) as typeof fetch;

      let remoteCur = buildTowerScene('Tower', [1, 2, 1], 0xef4444);
      const remoteHost = {
        capabilities: 'all',
        getLoadedModel: () => remoteCur,
        loadModel: async (m: any) => {
          remoteCur = m;
        },
        checkCapability: () => true,
      };
      const abortEditor = new SceneEditor(remoteHost);
      const pendingFetch = abortEditor.previewEdit({
        target: 'Tower',
        replacement: 'https://example.com/model.glb',
      });
      await Promise.resolve();
      assert.ok(capturedSignal instanceof AbortSignal);
      assert.equal(capturedSignal!.aborted, false);
      await remoteHost.loadModel(buildTowerScene('Other', [1, 1, 1], 0x22c55e));
      assert.equal(
        capturedSignal!.aborted,
        true,
        'External loadModel immediately aborts in-flight remote fetch',
      );
      const abortedRc = await pendingFetch;
      assert.equal(abortedRc.status, 'rejected');

      // 15b. Streaming response > MAX_BYTES cancels stream early without buffering unbounded bytes
      let streamCancelled = false;
      let pulls = 0;
      globalThis.fetch = (async () => {
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            // Two 40 MiB chunks exceed MAX_BYTES (64 MiB) on the second chunk
            controller.enqueue(new Uint8Array(40 * 1024 * 1024));
          },
          cancel() {
            streamCancelled = true;
          },
        });
        return new Response(body, {status: 200});
      }) as typeof fetch;

      const overStreamRc = await abortEditor.previewEdit({
        target: 'Other',
        replacement: 'https://example.com/huge-stream.glb',
      });
      assert.equal(overStreamRc.status, 'rejected');
      assert.ok(
        overStreamRc.errors[0]?.includes('storage limit'),
        `Expected storage limit error, got ${JSON.stringify(overStreamRc.errors)}`,
      );
      assert.ok(
        pulls <= 3,
        `Stream must stop reading as soon as MAX_BYTES is exceeded (got ${pulls} pulls on infinite stream)`,
      );
      assert.equal(streamCancelled, true, 'Reader cancel() must be invoked on oversized stream');

      // 15c. Content-Length > MAX_BYTES cancels body and rejects before reading stream
      let bodyRead = false;
      let bodyCancelled = false;
      globalThis.fetch = (async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({'content-length': String(65 * 1024 * 1024)}),
          body: {
            cancel: async () => {
              bodyCancelled = true;
            },
            getReader: () => {
              bodyRead = true;
              throw new Error('should not read body');
            },
          },
          arrayBuffer: async () => {
            bodyRead = true;
            return new ArrayBuffer(0);
          },
        }) as unknown as Response) as typeof fetch;
      const clRc = await abortEditor.previewEdit({
        target: 'Other',
        replacement: 'https://example.com/huge-cl.glb',
      });
      assert.equal(clRc.status, 'rejected');
      assert.equal(bodyRead, false);
      assert.equal(bodyCancelled, true);
    } finally {
      globalThis.fetch = prevFetch;
    }

    // 15d. onElementDisconnected does NOT trigger loadModel GPU upload on teardown
    let disconnectLoads = 0;
    let discCur = buildTowerScene('Tower', [1, 2, 1], 0xef4444);
    class DisconnectingElement {
      getLoadedModel() {
        return discCur;
      }
      async loadModel(m: any) {
        disconnectLoads++;
        discCur = m;
      }
    }
    const discEl = new DisconnectingElement() as SceneEditableElement;
    sceneEditsPlugin.onElementConnected?.(discEl);
    const pRc = await discEl.previewNodeEdit!({
      target: 'Tower',
      replacement: buildTowerScene('Tower', [1, 2, 1], 0x3b82f6),
    });
    assert.equal(pRc.status, 'preview');
    assert.equal(disconnectLoads, 1);
    sceneEditsPlugin.onElementDisconnected?.(discEl);
    await Promise.resolve();
    assert.equal(
      disconnectLoads,
      1,
      'onElementDisconnected must not reload active.before onto a tearing-down element',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(discEl, 'loadModel'),
      false,
    );
  }

  // 16. Package exports & standalone TypeScript declaration check (`three-live/edits`)
  {
    const rootCandidates = [
      process.cwd(),
      path.resolve(__dirname, '../..'),
      path.resolve(__dirname, '../../..'),
    ];
    const repoRoot = rootCandidates.find((p) =>
      fs.existsSync(path.join(p, 'three-live/package.json')),
    );
    assert.ok(repoRoot, 'Located monorepo root');
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot!, 'package.json'), 'utf8'),
    );
    const tlPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot!, 'three-live/package.json'), 'utf8'),
    );
    const rootTypesPath = path.join(repoRoot!, rootPkg.exports['./edits'].types);
    const tlTypesPath = path.join(
      repoRoot!,
      'three-live',
      tlPkg.exports['./edits'].types,
    );
    assert.equal(rootTypesPath, tlTypesPath);
    if (fs.existsSync(tlTypesPath)) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-edits-dts-'));
      try {
        // Copy ONLY the standalone .d.ts into an isolated temp directory (simulating npm pack!)
        fs.copyFileSync(tlTypesPath, path.join(tmpDir, 'three-live-edits.d.ts'));
        const consumerPath = path.join(tmpDir, 'consumer.ts');
        fs.writeFileSync(
          consumerPath,
          [
            'import {',
            '  SceneEditor,',
            '  sceneEditsPlugin,',
            '  prepareSceneEdit,',
            '  computeSubtreeBounds,',
            '  computeSubtreeBoundsSize,',
            '  type SceneEditOptions,',
            '  type SceneEditReceipt,',
            '  type SceneEditConstraints,',
            '  type SceneEditHost,',
            '  type SceneEditableElement,',
            '  type SceneEditPayload,',
            '  type SubtreeBounds,',
            "} from './three-live-edits';",
            'export type Check = [SceneEditor, typeof sceneEditsPlugin, typeof prepareSceneEdit, typeof computeSubtreeBounds, typeof computeSubtreeBoundsSize, SceneEditOptions, SceneEditReceipt, SceneEditConstraints, SceneEditHost, SceneEditableElement, SceneEditPayload, SubtreeBounds];',
          ].join('\n'),
        );
        const tscBin = [
          path.join(repoRoot!, 'node_modules/typescript/bin/tsc'),
          path.join(repoRoot!, 'three-live/node_modules/typescript/bin/tsc'),
        ].find((p) => fs.existsSync(p));
        assert.ok(tscBin, 'Located tsc binary');
        execFileSync(
          process.execPath,
          [
            tscBin!,
            '--noEmit',
            '--strict',
            '--target',
            'es2020',
            '--module',
            'esnext',
            '--moduleResolution',
            'bundler',
            consumerPath,
          ],
          {stdio: 'pipe'},
        );
      } finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
      }
    }
  }

  sceneEditsPlugin.onElementDisconnected?.(host);
  console.log(
    '   ✅ [PASS] scene-edits add-on: bounds/material preservation, constraint rejection, fail-closed capabilities, supersession, and undo',
  );
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
