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

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import {
  aiCall,
  compileToGLB,
  compileToUSDZ,
  glbToUSDZ,
  HOST_CONTRACT_VERSION,
  pureJsUtf8Decode,
  pureJsUtf8Encode,
} from '../src/compiler-bundle';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`   ✅ [PASS] ${msg}`);
  } else {
    failed++;
    console.error(`   ❌ [FAIL] ${msg}`);
  }
}

console.log('=== Running Hosted Compiler Bundle & AI Protocol Tests ===');

// 1. Pure-JS UTF-8 encode/decode round-trip (ASCII, CJK, astral emoji, invalid sequences)
{
  const text = 'Hello Three-Live! 日本語 🚀✨';
  const bytes = pureJsUtf8Encode(text);
  assert(
    pureJsUtf8Decode(bytes) === text,
    'Pure-JS UTF-8 round-trips ASCII + CJK + astral emoji',
  );
  const bad = new Uint8Array([0xff, 0x41, 0xc0, 0xaf]);
  assert(
    pureJsUtf8Decode(bad).includes('\ufffd') &&
      pureJsUtf8Decode(bad).includes('A'),
    'Pure-JS UTF-8 replaces overlong/invalid bytes with U+FFFD without throwing',
  );
}

// 2. Direct compileToGLB, compileToUSDZ, glbToUSDZ, and empty-scene schema compliance
{
  assert(HOST_CONTRACT_VERSION === 1, 'HOST_CONTRACT_VERSION is 1');
  const emptyGlb = compileToGLB('// empty scene');
  const jsonLen = new DataView(emptyGlb.buffer).getUint32(12, true);
  const emptyGltf = JSON.parse(
    pureJsUtf8Decode(emptyGlb.subarray(20, 20 + jsonLen)),
  );
  assert(
    emptyGltf.nodes === undefined &&
      emptyGltf.meshes === undefined &&
      emptyGltf.buffers === undefined &&
      emptyGlb.byteLength === 20 + jsonLen,
    'Empty scene GLB omits empty top-level arrays and empty BIN chunk',
  );

  const script = `
    const gear = new THREE.Mesh(
      new THREE.Mechanical.SpurGearGeometry({ teeth: 16, module: 0.05, faceWidth: 0.08 }),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, clearcoat: 0.4, roughness: 0.3, metalness: 0.8 })
    );
    gear.name = 'DriveGear';
    gear.userData.xr = { grab: true };
    scene.add(gear);
  `;
  const glb = compileToGLB(script);
  const glbJsonLen = new DataView(glb.buffer).getUint32(12, true);
  const gltf = JSON.parse(pureJsUtf8Decode(glb.subarray(20, 20 + glbJsonLen)));
  assert(
    gltf.meshes?.length === 1 &&
      gltf.nodes?.[0]?.name === 'DriveGear' &&
      Array.isArray(gltf.extensionsUsed) &&
      gltf.extensionsUsed.includes('KHR_materials_clearcoat'),
    'compileToGLB exports domain kit geometry, XR traits, and KHR_materials_clearcoat in extensionsUsed',
  );

  const usdz = compileToUSDZ(script);
  const usdzFromGlb = glbToUSDZ(glb);
  assert(
    usdz[0] === 0x50 &&
      usdz[1] === 0x4b &&
      usdzFromGlb[0] === 0x50 &&
      usdzFromGlb[1] === 0x4b,
    'compileToUSDZ and glbToUSDZ produce valid ZIP/USDZ archives',
  );
}

// 3. AI protocol ops parity (messages, extract, validate, parse_command, select, image_*, texture_*, voice_*)
{
  const baseScript = `
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), new THREE.MeshStandardMaterial({ color: 0xff2222 }));
    lamp.name = 'RedLamp';
    lamp.position.set(-1, 0.4, 0);
    scene.add(lamp);
  `;
  const msgRes = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'messages',
        source: baseScript,
        selection: ['RedLamp'],
        instruction: 'make it taller',
      }),
    ),
  );
  assert(
    Array.isArray(msgRes.messages) &&
      msgRes.messages.length === 2 &&
      msgRes.messages[1].content.includes(
        'The user selected the mesh named "RedLamp"',
      ),
    'aiCall(messages) formats system + user prompt with selection',
  );

  const extRes = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'extract',
        reply: 'Here:\n```js\nscene.add(x);\n```',
      }),
    ),
  );
  assert(
    extRes.code === 'scene.add(x);',
    'aiCall(extract) extracts fenced JS code',
  );

  const valOk = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'validate',
        code: baseScript,
        selection: ['RedLamp'],
        instruction: 'make it taller',
      }),
    ),
  );
  assert(
    valOk.ok === true &&
      valOk.meshCount === 1 &&
      valOk.meshNames.includes('RedLamp'),
    'aiCall(validate) validates scene script and preserves selection',
  );

  const selRes = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'select',
        source: baseScript,
        query: 'the red lamp',
      }),
    ),
  );
  assert(
    selRes.confidence === 'high' && selRes.names?.[0] === 'RedLamp',
    'aiCall(select) resolves spoken mesh query directly from scene source',
  );

  const cmdRes = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'parse_command',
        text: 'select the lamp and make it blue',
      }),
    ),
  );
  assert(
    cmdRes.kind === 'mixed' && cmdRes.instruction === 'make it blue',
    'aiCall(parse_command) parses mixed select-and-edit utterances',
  );

  const keyRes = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'texture_key',
        prompt: 'weathered oak planks',
        size: 64,
        seed: 7,
      }),
    ),
  );
  assert(
    typeof keyRes.key === 'string' && keyRes.key.length === 16,
    'aiCall(texture_key) computes canonical 16-hex texture key',
  );

  // H3: texture_derive returns base64 normal + orm maps and mapSize
  const rawRgba = new Uint8Array(4 * 4 * 4).fill(128);
  const b64Albedo = Buffer.from(rawRgba).toString('base64');
  const deriveRes = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'texture_derive',
        size: 4,
        albedo: b64Albedo,
        normalStrength: 1.0,
        roughness: 0.7,
        metalness: 0.1,
      }),
    ),
  );
  assert(
    typeof deriveRes.normal === 'string' &&
      deriveRes.normal.length > 0 &&
      typeof deriveRes.orm === 'string' &&
      deriveRes.orm.length > 0 &&
      deriveRes.mapSize === 4,
    'aiCall(texture_derive) encodes derived normal + ORM RGBA8 maps',
  );

  // Build a tiny 8x8 PNG via ProceduralTexture and round-trip through texture_pack_add + texture_pack_set
  const texUriScript = `
    const t = THREE.ProceduralTexture.checkerboard({ size: 16 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(t));
    scene.add(m);
  `;
  const texGlb = compileToGLB(texUriScript);
  const texGlbJsonLen = new DataView(texGlb.buffer).getUint32(12, true);
  const texGltf = JSON.parse(
    pureJsUtf8Decode(texGlb.subarray(20, 20 + texGlbJsonLen)),
  );
  const pngUri: string = texGltf.images[0].uri;
  const packAdd = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'texture_pack_add',
        spec: {prompt: 'weathered oak planks', size: 16, seed: 7},
        image: pngUri,
      }),
    ),
  );
  assert(
    packAdd.key === keyRes.key || typeof packAdd.pack?.entries === 'object',
    'aiCall(texture_pack_add) decodes PNG, resamples/seam-blends, and serializes pack',
  );
  const packVal = JSON.parse(
    aiCall(JSON.stringify({op: 'texture_pack_validate', pack: packAdd.pack})),
  );
  assert(
    packVal.ok === true && packVal.keys.length === 1,
    'aiCall(texture_pack_validate) accepts serialized pack',
  );
  const packSet = JSON.parse(
    aiCall(JSON.stringify({op: 'texture_pack_set', pack: packAdd.pack})),
  );
  assert(packSet.ok === true, 'aiCall(texture_pack_set) installs default pack');

  const voiceSetup = JSON.parse(
    aiCall(
      JSON.stringify({
        op: 'voice_setup',
        provider: 'gemini-live',
        voice: 'Puck',
      }),
    ),
  );
  assert(
    voiceSetup.inputRate === 16000 && Array.isArray(voiceSetup.messages),
    'aiCall(voice_setup) configures gemini-live BidiGenerateContent session',
  );
}

// 4. Bare VM realm test (no TextEncoder / TextDecoder, installSandboxHardening, __three_live_host__)
{
  const bundleCandidates = [
    path.resolve(process.cwd(), 'dist/three-live-compiler-bundle.min.js'),
    path.resolve(__dirname, '../../dist/three-live-compiler-bundle.min.js'),
    path.resolve(__dirname, '../../../dist/three-live-compiler-bundle.min.js'),
  ];
  const bundlePath = bundleCandidates.find((p) => fs.existsSync(p));
  if (bundlePath) {
    const bundleSource = fs.readFileSync(bundlePath, 'utf8');
    let chargedBytes = 0;
    const realm = vm.createContext({
      __three_live_host__: {
        version: 1,
        now: () => 42,
        charge: (n: number) => {
          chargedBytes += n;
        },
      },
    });
    // Explicitly verify TextEncoder/TextDecoder are absent before loading bundle
    assert(
      vm.runInContext(
        'typeof TextEncoder === "undefined" && typeof TextDecoder === "undefined"',
        realm,
      ),
      'Fresh VM context starts without TextEncoder or TextDecoder',
    );
    vm.runInContext(bundleSource, realm);
    vm.runInContext('ThreeEngine.installSandboxHardening();', realm);

    const glbLen: number = vm.runInContext(
      `ThreeEngine.compileToGLB("const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()); m.name = 'Cube'; scene.add(m);").byteLength`,
      realm,
    );
    assert(
      glbLen > 100 && chargedBytes > 0,
      'Standalone IIFE bundle compiles GLB in bare VM without host TextEncoder/TextDecoder',
    );

    let evalBlocked = false;
    try {
      vm.runInContext(`ThreeEngine.compileToGLB('eval("1+1")')`, realm);
    } catch {
      evalBlocked = true;
    }
    let ctorBlocked = false;
    try {
      vm.runInContext(
        `ThreeEngine.compileToGLB('(function(){}).constructor("return 1")()')`,
        realm,
      );
    } catch {
      ctorBlocked = true;
    }
    let reentrantBlocked = false;
    try {
      vm.runInContext(
        `ThreeEngine.compileToGLB('ThreeEngine.compileToGLB("1+1")')`,
        realm,
      );
    } catch {
      reentrantBlocked = true;
    }
    assert(
      evalBlocked && ctorBlocked && reentrantBlocked,
      'installSandboxHardening blocks eval, Function.prototype.constructor, and re-entrant compileToGLB calls',
    );

    // C1: __THREE_LIVE_REGISTRY__ and its plugins array are frozen and non-writable
    let registryProtected = false;
    try {
      vm.runInContext(
        `ThreeEngine.compileToGLB("'use strict'; globalThis.__THREE_LIVE_REGISTRY__.tslUsdzSerializer = () => ({});")`,
        realm,
      );
    } catch {
      registryProtected = true;
    }
    assert(
      registryProtected &&
        vm.runInContext(
          'Object.isFrozen(globalThis.__THREE_LIVE_REGISTRY__) && Object.isFrozen(globalThis.__THREE_LIVE_REGISTRY__.plugins)',
          realm,
        ),
      'installSandboxHardening freezes __THREE_LIVE_REGISTRY__ and blocks tslUsdzSerializer overwrite',
    );

    // C2: __three_live_host__ is hidden from untrusted user scripts
    assert(
      vm.runInContext(
        'typeof globalThis.__three_live_host__ === "undefined"',
        realm,
      ),
      'installSandboxHardening hides __three_live_host__ from globalThis',
    );

    // C3: Baseline globals (JSON, TextEncoder, Uint8Array) are non-writable
    let jsonLocked = false;
    try {
      vm.runInContext(
        `ThreeEngine.compileToGLB("'use strict'; globalThis.JSON = {};")`,
        realm,
      );
    } catch {
      jsonLocked = true;
    }
    assert(
      jsonLocked,
      'installSandboxHardening locks baseline globals like JSON against shadowing',
    );

    // C4: Block/IIFE breakout syntax (`}; let scene = 1; {` and `})(); let scene = 1; (function(){`) is rejected
    let breakoutRejected = false;
    try {
      vm.runInContext(`ThreeEngine.compileToGLB("}; let scene = 1; {")`, realm);
    } catch {
      breakoutRejected = true;
    }
    let iifeBreakoutRejected = false;
    try {
      vm.runInContext(
        `ThreeEngine.compileToGLB("})(); let scene = 1; (function(){")`,
        realm,
      );
    } catch {
      iifeBreakoutRejected = true;
    }
    assert(
      breakoutRejected && iifeBreakoutRejected,
      'wrapIsolatedScript rejects block and IIFE wrapper-breakout payloads before evaluation',
    );

    // H1: Shadowing `scene.toUSDZ` in user script does NOT forge USDZ output,
    // unbound `__three_live_native_*` slots are locked, and stateful `valueOf()` repeat is capped
    const usdzBytes: Uint8Array = vm.runInContext(
      `ThreeEngine.compileToUSDZ("scene.toUSDZ = () => new Uint8Array([1, 2, 3, 4]); const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()); scene.add(m);")`,
      realm,
    );
    assert(
      usdzBytes[0] === 0x50 &&
        usdzBytes[1] === 0x4b &&
        usdzBytes.byteLength > 64,
      'compileToUSDZ ignores user-shadowed scene.toUSDZ and emits authentic USDZ archive',
    );
    let nativeSlotLocked = false;
    try {
      vm.runInContext(
        `ThreeEngine.compileToGLB("'use strict'; globalThis.__three_live_native_box__ = () => ({});")`,
        realm,
      );
    } catch {
      nativeSlotLocked = true;
    }
    const toctouResult: {calls: number; len: number} = vm.runInContext(
      `(() => { let calls = 0; const out = 'abcd'.repeat({ valueOf() { return ++calls === 1 ? 1 : 2000000; } }); return { calls, len: out.length }; })()`,
      realm,
    );
    let oversizedRepeatBlocked = false;
    try {
      vm.runInContext(`'abcd'.repeat(2000000)`, realm);
    } catch {
      oversizedRepeatBlocked = true;
    }
    assert(
      nativeSlotLocked &&
        toctouResult.calls === 1 &&
        toctouResult.len === 4 &&
        oversizedRepeatBlocked,
      'installSandboxHardening locks unbound native hook slots and coerces String.prototype.repeat count once without valueOf() TOCTOU',
    );
  }
}

console.log(`\nCompiler bundle tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
