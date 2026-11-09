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

import * as assert from 'assert';
import {getSharedRegistry} from '../src/plugin';
import THREE, {
  clearAuthorWarnings,
  getAuthorWarnings,
} from '../src/three-author';
import {sceneToGLB} from '../src/three-convert';
import {parseGLB} from '../src/three-view';
import {installTslExtension} from '../src/tsl/author';
import {
  evaluateTslGraphCpu,
  MAX_TSL_NODES,
  MAX_TSL_UNIFORMS,
  TSL_EXTENSION_NAME,
  tslSimplexNoise2D,
  tslSimplexNoise3D,
  tslVoronoi2D,
  validateTslGraph,
} from '../src/tsl/ir';

console.log('=== Running Loop-Free TSL IR & Authoring Tests (B1) ===');

installTslExtension(THREE, getSharedRegistry());
// tslint:disable-next-line:no-any
const T = THREE as any;
const {TSL, MeshStandardNodeMaterial} = T;

// 1. Authoring hologram + GLB round-trip + CSE deduplication + callable builtins
{
  const scene = new THREE.Scene();
  const pulseSpeed = TSL.uniform(6.0, 'uPulseSpeed');
  const holoMat = new MeshStandardNodeMaterial({
    color: 0x0284c7,
    transparent: true,
    roughness: 0.15,
    metalness: 0.1,
  });
  const sharedRim = TSL.fresnel(TSL.float(2.5));
  const scanline = TSL.sin(
    TSL.positionWorld.y.mul(80).sub(TSL.time().mul(pulseSpeed)),
  )
    .mul(0.5)
    .add(0.5);
  holoMat.colorNode = TSL.color(0x0284c7);
  holoMat.emissiveNode = TSL.color(0x38bdf8).mul(
    sharedRim.add(scanline.mul(0.35)),
  );
  holoMat.opacityNode = sharedRim.mul(0.75).add(0.15).clamp(0.05, 0.95);

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), holoMat);
  mesh.name = 'HoloSphere';
  scene.add(mesh);

  const glbBytes = sceneToGLB(scene);
  const parsed = parseGLB(glbBytes);
  const gltf = parsed.gltf;
  assert.ok(
    Array.isArray(gltf.extensionsUsed) &&
      gltf.extensionsUsed.includes(TSL_EXTENSION_NAME),
    'extensionsUsed includes GOOGLE_material_tsl',
  );
  const matDef = gltf.materials[0];
  assert.strictEqual(matDef.alphaMode, 'BLEND');
  const rawTsl = matDef.extensions?.[TSL_EXTENSION_NAME];
  assert.ok(rawTsl, 'material extensions.GOOGLE_material_tsl present');
  assert.strictEqual(rawTsl.version, 1);

  // `sharedRim` used in both emissiveNode and opacityNode must be CSE-deduplicated to 1 fresnel op!
  const fresnelCount = rawTsl.nodes.filter(
    (n: {op: string}) => n.op === 'fresnel',
  ).length;
  assert.strictEqual(
    fresnelCount,
    1,
    'CSE deduplicates shared fresnel subgraph',
  );

  const vRes = validateTslGraph(rawTsl, 'HoloMat');
  assert.strictEqual(vRes.ok, true);
  if (vRes.ok) {
    assert.strictEqual(vRes.graph.usesTime, true);
    assert.strictEqual(vRes.graph.usesVertexPosition, false);
    assert.strictEqual(vRes.graph.uniformSlots.length, 1);
    assert.strictEqual(vRes.graph.uniformSlots[0].name, 'uPulseSpeed');

    // Grazing view angle -> high Fresnel rim opacity & emissive
    const grazing = evaluateTslGraphCpu(vRes.graph, {
      normalWorld: [1, 0, 0],
      viewDirection: [0, 0, 1],
      positionWorld: [0, 0.2, 0],
      time: 0.5,
    });
    // Head-on view angle -> low Fresnel rim opacity
    const center = evaluateTslGraphCpu(vRes.graph, {
      normalWorld: [0, 0, 1],
      viewDirection: [0, 0, 1],
      positionWorld: [0, 0.2, 0],
      time: 0.5,
    });
    assert.ok((grazing.opacity ?? 0) > 0.85, 'Grazing Fresnel opacity high');
    assert.ok((center.opacity ?? 1) < 0.2, 'Center Fresnel opacity low');
  }
  console.log(
    '   [PASS] Hologram TSL authoring, CSE deduplication & GLB round-trip',
  );
}

// 2. Worker serialization self-containment check (Function.prototype.toString)
{
  const src = installTslExtension.toString();
  const isolatedFn = new Function(
    'threeNs',
    'reg',
    `return (${src})(threeNs, reg);`,
  );
  const mockReg: Record<string, unknown> = {};
  const ext = isolatedFn(THREE, mockReg);
  assert.ok(ext && ext.TSL && ext.MeshStandardNodeMaterial);
  const m = new ext.MeshStandardNodeMaterial({
    roughnessNode: ext.TSL.remap(
      ext.TSL.simplexNoise3D(ext.TSL.positionWorld.mul(4)),
      0,
      1,
      0.2,
      0.6,
    ),
  });
  const g = m._serializeTslGraph();
  assert.ok(
    g && validateTslGraph(g).ok,
    'Worker-serialized TSL graph validates',
  );
  console.log(
    '   [PASS] installTslExtension is 100% self-contained for Worker sandbox',
  );
}

// 3. Cycle, forward-ref, quota, swizzle, and stage validation (`TL501–TL504`)
{
  // Self-cycle arg == idx
  const cycleRes = validateTslGraph({
    version: 1,
    nodes: [{op: 'sin', type: 'float', args: [0]}],
    outputs: {opacity: 0},
  });
  assert.strictEqual(cycleRes.ok, false);
  if (!cycleRes.ok) assert.strictEqual(cycleRes.issue.code, 'TL501');

  // Forward reference arg > idx
  const fwdRes = validateTslGraph({
    version: 1,
    nodes: [
      {op: 'sin', type: 'float', args: [1]},
      {op: 'const', type: 'float', value: [1]},
    ],
    outputs: {opacity: 0},
  });
  assert.strictEqual(fwdRes.ok, false);
  if (!fwdRes.ok) assert.strictEqual(fwdRes.issue.code, 'TL501');

  // Exceeds MAX_TSL_NODES (129 nodes)
  const manyNodes = [
    {op: 'builtin', name: 'time', type: 'float'},
    ...Array.from({length: MAX_TSL_NODES}, (_, k) => ({
      op: 'sin',
      type: 'float',
      args: [k],
    })),
  ];
  const overNodes = validateTslGraph({
    version: 1,
    nodes: manyNodes,
    outputs: {opacity: manyNodes.length - 1},
  });
  assert.strictEqual(overNodes.ok, false);
  if (!overNodes.ok) assert.strictEqual(overNodes.issue.code, 'TL502');

  // Exceeds MAX_TSL_UNIFORMS (17 uniforms)
  const overUniformsMap: Record<string, {type: string; value: number}> = {};
  for (let k = 0; k <= MAX_TSL_UNIFORMS; k++) {
    overUniformsMap[`u_${k}`] = {type: 'float', value: k};
  }
  const overUniforms = validateTslGraph({
    version: 1,
    uniforms: overUniformsMap,
    nodes: [{op: 'const', type: 'float', value: [0.5]}],
    outputs: {opacity: 0},
  });
  assert.strictEqual(overUniforms.ok, false);
  if (!overUniforms.ok) assert.strictEqual(overUniforms.issue.code, 'TL502');

  // Invalid swizzle `.z` on `vec2`
  const badSwiz = validateTslGraph({
    version: 1,
    nodes: [
      {op: 'builtin', name: 'uv', type: 'vec2'},
      {op: 'swizzle', type: 'float', args: [0], mask: 'z'},
    ],
    outputs: {opacity: 1},
  });
  assert.strictEqual(badSwiz.ok, false);
  if (!badSwiz.ok) assert.strictEqual(badSwiz.issue.code, 'TL501');

  // Fragment-only `fresnel` wired into `position` -> TL503
  const badStage = validateTslGraph({
    version: 1,
    nodes: [
      {op: 'const', type: 'float', value: [2]},
      {op: 'fresnel', type: 'float', args: [0]},
      {op: 'construct', type: 'vec3', args: [1]},
    ],
    outputs: {position: 2},
  });
  assert.strictEqual(badStage.ok, false);
  if (!badStage.ok) assert.strictEqual(badStage.issue.code, 'TL503');

  // Imperative loop op -> TL504
  const badLoop = validateTslGraph({
    version: 1,
    nodes: [{op: 'loop', type: 'float', args: []}],
    outputs: {opacity: 0},
  });
  assert.strictEqual(badLoop.ok, false);
  if (!badLoop.ok) assert.strictEqual(badLoop.issue.code, 'TL504');

  // Authoring-side TSL.Loop emits TL504 warning and degrades cleanly
  clearAuthorWarnings();
  const loopNode = TSL.Loop();
  assert.ok(
    getAuthorWarnings().some((w) => w.includes('[TL504]')),
    'TSL.Loop records TL504 warning',
  );
  assert.ok(loopNode.isTSLNode);
  console.log(
    '   [PASS] TL501–TL504 DAG quota, acyclicity, swizzle & stage validation',
  );
}

// 4. NaN / Inf / Divide-by-zero / Domain-edge fuzz suite (60+ edge inputs)
{
  const mat = new MeshStandardNodeMaterial();
  const uA = TSL.uniform(0, 'uA');
  const uB = TSL.uniform(0, 'uB');
  const stressScalar = uA
    .div(uB)
    .add(uA.mod(uB))
    .add(TSL.sqrt(uA))
    .add(TSL.log(uA))
    .add(TSL.exp(uA))
    .add(TSL.pow(uA, uB))
    .add(TSL.atan2(uA, uB))
    .add(TSL.smoothstep(uA, uB, TSL.float(0.5)))
    .add(TSL.clamp(uA, uB, uA));
  const zeroVecNorm = TSL.vec3(uA, uB, 0).normalize();
  mat.colorNode = zeroVecNorm.add(stressScalar.clamp(-10, 10));
  mat.roughnessNode = TSL.triplanar(2.0, 4.0);
  mat.metalnessNode = TSL.voronoi2D(TSL.uv().mul(5), 1.0);
  mat.emissiveNode = TSL.hueShift(
    TSL.color(0xff5500),
    TSL.checker(TSL.uv.mul(8)).mul(1.57),
  );

  const g = mat._serializeTslGraph();
  assert.ok(g);
  const v = validateTslGraph(g);
  assert.strictEqual(v.ok, true);
  if (v.ok) {
    const edgePairs: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, -1],
      [-2, 0.5],
      [-100, -0.25],
      [0, 0.0],
      [1e-12, -1e-12],
      [500, 500],
      [-500, 500],
      [0.5, 0.5],
      [2.0, -2.0],
    ];
    for (let k = 0; k < 60; k++) {
      const [a, b] =
        k < edgePairs.length
          ? edgePairs[k]
          : [Math.sin(k * 1.7) * 50, Math.cos(k * 2.3) * 50];
      const out = evaluateTslGraphCpu(v.graph, {
        normalWorld: [0, 0, 0], // degenerate zero normal!
        viewDirection: [0, 0, 0], // degenerate zero viewDir!
        uv: [k * 0.13, -k * 0.29],
        positionWorld: [k * 0.3, -k * 0.1, k * 0.2],
        time: k * 1000,
        uniforms: {uA: a, uB: b},
      });
      for (const c of out.color ?? []) {
        assert.ok(Number.isFinite(c), `Finite color for (${a}, ${b})`);
      }
      for (const c of out.emissive ?? []) {
        assert.ok(Number.isFinite(c), `Finite emissive for (${a}, ${b})`);
      }
      assert.ok(Number.isFinite(out.roughness ?? NaN));
      assert.ok(Number.isFinite(out.metalness ?? NaN));
    }
  }
  console.log('   [PASS] 60+ domain-edge fuzz cases produce 0 NaNs / Infs');
}

// 5. Pinned cross-language polynomial noise, structural hash order-invariance,
//    clone() fidelity & conflicting uniform type rejection
{
  const s2 = tslSimplexNoise2D(1.25, -2.5);
  const s3 = tslSimplexNoise3D(0.75, 1.5, -0.5);
  const v2 = tslVoronoi2D(2.3, 4.1, 0.8);
  assert.ok(s2 >= 0 && s2 <= 1, `s2 in [0,1]: ${s2}`);
  assert.ok(s3 >= 0 && s3 <= 1, `s3 in [0,1]: ${s3}`);
  assert.ok(v2 >= 0 && v2 <= 1, `v2 in [0,1]: ${v2}`);
  assert.strictEqual(s2, tslSimplexNoise2D(1.25, -2.5));
  assert.strictEqual(s3, tslSimplexNoise3D(0.75, 1.5, -0.5));
  assert.strictEqual(v2, tslVoronoi2D(2.3, 4.1, 0.8));

  // Output key insertion order must NOT change structural `graph.hash`!
  const sharedNodes = [
    {op: 'const', type: 'vec3', value: [0.25, 0.5, 0.75]},
    {op: 'uniform', name: 'uGain', type: 'float'},
    {op: 'mul', type: 'vec3', args: [0, 1]},
  ];
  const gOrderA = validateTslGraph({
    version: 1,
    uniforms: {uGain: {type: 'float', value: 2.0}},
    nodes: sharedNodes,
    outputs: {emissive: 2, color: 0, opacity: 1},
  });
  const gOrderB = validateTslGraph({
    version: 1,
    uniforms: {uGain: {type: 'float', value: 99.0}}, // runtime uniform value must not change structural hash!
    nodes: sharedNodes,
    outputs: {color: 0, opacity: 1, emissive: 2},
  });
  assert.strictEqual(gOrderA.ok, true);
  assert.strictEqual(gOrderB.ok, true);
  if (gOrderA.ok && gOrderB.ok) {
    assert.strictEqual(gOrderA.graph.hash, '69150e26');
    assert.strictEqual(
      gOrderA.graph.hash,
      gOrderB.graph.hash,
      'Structural hash is invariant to output key order and uniform values',
    );
    console.log(
      `   [PASS] Deterministic parity vectors (hash=${gOrderA.graph.hash}, s2=${s2.toFixed(6)}, s3=${s3.toFixed(6)}, v2=${v2.toFixed(6)})`,
    );
  }

  // Conflicting uniform types with identical name must emit TL501 and degrade cleanly
  clearAuthorWarnings();
  const conflictMat = new MeshStandardNodeMaterial();
  conflictMat.opacityNode = TSL.uniform(0.5, 'uClash');
  conflictMat.colorNode = TSL.uniform([1, 0, 0], 'uClash');
  assert.strictEqual(conflictMat._serializeTslGraph(), null);
  assert.ok(
    getAuthorWarnings().some((w) => w.includes('[TL501]')),
    'Conflicting uniform types emit TL501 warning',
  );

  // clone() preserves all PBR, luxury, and TSL socket properties
  const orig = new MeshStandardNodeMaterial({
    name: 'OrigTSL',
    color: 0x123456,
    emissive: 0x00ff88,
    emissiveIntensity: 2.5,
    clearcoat: 0.8,
    ior: 1.45,
    transmission: 0.4,
    iridescence: 0.6,
    colorNode: TSL.color(0x38bdf8),
    roughnessNode: TSL.float(0.22),
  });
  const cloned = orig.clone();
  assert.strictEqual(cloned.name, 'OrigTSL');
  assert.strictEqual(cloned._em, true);
  assert.strictEqual(cloned.clearcoat, 0.8);
  assert.strictEqual(cloned.iridescence, 0.6);
  assert.strictEqual(cloned.colorNode, orig.colorNode);
  assert.strictEqual(cloned.roughnessNode, orig.roughnessNode);
  console.log(
    '   [PASS] Conflicting uniform guard & lossless clone() verified',
  );
}

console.log('=== All Loop-Free TSL B1 Tests Passed! ===');
