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
import {parseGLB, ThreeView} from '../src/three-view';
import {keyframeAnimationPlugin, sampleChannel} from '../src/plugins/keyframes';
function animationGLB(kind: 'clip' | 'absent' | 'empty' = 'clip'): ArrayBuffer {
  const bin = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, // positions
    0, 1, // times
    0, 0, 0, 2, 0, 0, // translations
  ]);
  const gltf: any = {
    asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}],
    nodes: [{name: 'MovingTriangle', mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
    buffers: [{byteLength: bin.byteLength}],
    bufferViews: [
      {buffer: 0, byteOffset: 0, byteLength: 36},
      {buffer: 0, byteOffset: 36, byteLength: 8},
      {buffer: 0, byteOffset: 44, byteLength: 24},
    ],
    accessors: [
      {bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0]},
      {bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1]},
      {bufferView: 2, componentType: 5126, count: 2, type: 'VEC3'},
    ],
  };
  if (kind !== 'absent') gltf.animations = kind === 'empty' ? [] : [{
    name: 'Slide', samplers: [{input: 1, output: 2, interpolation: 'LINEAR'}],
    channels: [{sampler: 0, target: {node: 0, path: 'translation'}}],
  }];
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonSize = (json.length + 3) & ~3;
  const buffer = new ArrayBuffer(28 + jsonSize + bin.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonSize, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonSize).fill(32);
  new Uint8Array(buffer, 20, json.length).set(json);
  view.setUint32(20 + jsonSize, bin.byteLength, true);
  view.setUint32(24 + jsonSize, 0x004e4942, true);
  new Uint8Array(buffer, 28 + jsonSize).set(new Uint8Array(bin.buffer));
  return buffer;
}


const late = parseGLB(animationGLB());
assert.deepEqual(late.animations, [], 'default return shape remains compatible without the add-on');
assert.equal(late.animationsParsed, false);
ThreeView.registerPlugin(keyframeAnimationPlugin);
keyframeAnimationPlugin.onParseGLB!(late);
assert.equal(late.animations?.[0].name, 'Slide');
assert.equal(late.animationsParsed, true);
const midpoint = [0, 0, 0]; sampleChannel(late.animations![0].channels[0], .5, midpoint);
assert.equal(midpoint[0], 1);
for (const kind of ['absent', 'empty'] as const) {
  const data = parseGLB(animationGLB(kind)), clips = data.animations;
  assert.equal(data.animationsParsed, true);
  assert.deepEqual(clips, []);
  Object.defineProperty(data.gltf, 'animations', {get() { throw Error('must not reparse'); }});
  keyframeAnimationPlugin.onParseGLB!(data);
  assert.equal(data.animations, clips);
}
const supplied = {gltf: late.gltf, bin: late.bin, animations: []};
keyframeAnimationPlugin.onParseGLB!(supplied);
assert.deepEqual(supplied.animations, [], 'explicit caller-supplied empty arrays remain authoritative');
const invalid = {...late, animations: undefined, animationsParsed: false, bin: new ArrayBuffer(0)};
assert.throws(() => keyframeAnimationPlugin.onParseGLB!(invalid));
assert.equal(invalid.animationsParsed, false, 'failure never publishes a parsed marker');
invalid.bin = late.bin; keyframeAnimationPlugin.onParseGLB!(invalid);
assert.equal(invalid.animations?.length, 1);
console.log('PASS binary GLB parsing, late registration, cached empty results, caller arrays, and failed parsing retry');
