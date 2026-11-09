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

import {getSharedRegistry, registerPlugin} from '../src/plugin';
import {aiPlugin} from '../src/plugins/ai';
import {
  createAIImageProvider,
  type DecodedImage,
  parseTexturePack,
  prepareAlbedo,
  seamBlend,
  serializeTexturePack,
  TEXTURE_PROMPT_SUFFIX,
  type TextureCache,
  type TextureCacheRecord,
  type TextureImageCodec,
  type TexturePackEntry,
  textureRequests,
  type ThreeLiveImageProvider,
} from '../src/plugins/ai-texture';
import {proceduralPlugin} from '../src/plugins/procedural';
import {makePngDeflater} from '../src/png-deflate';
import {buildSandboxWorkerSource, Scene, THREE} from '../src/three-author';
import {sceneToGLB} from '../src/three-convert';

registerPlugin(proceduralPlugin);

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

const reg = getSharedRegistry() as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(5);
  }
  return true;
}

// A fake "PNG": PNG magic + width + height + raw RGBA (lets Node tests run
// without createImageBitmap).
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function fakePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + rgba.length);
  out.set(PNG_MAGIC);
  const dv = new DataView(out.buffer);
  dv.setUint32(8, w);
  dv.setUint32(12, h);
  out.set(rgba, 16);
  return out;
}
const fakeCodec: TextureImageCodec = {
  async decode(bytes: Uint8Array): Promise<DecodedImage> {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint32(8);
    const height = dv.getUint32(12);
    return {width, height, rgba: bytes.slice(16, 16 + width * height * 4)};
  },
  async encodePng(rgba: Uint8Array, size: number) {
    return fakePng(size, size, rgba);
  },
};
function gradient(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.set([(x * 255) / w, (y * 255) / h, 90, 128], (y * w + x) * 4);
    }
  }
  return out;
}
function memCache(): TextureCache & {store: Map<string, TextureCacheRecord>} {
  const store = new Map<string, TextureCacheRecord>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(rec) {
      store.set(rec.key, rec);
    },
  };
}

// Host-realm script runner that behaves like the sandbox worker: the pack
// passed in `options.texturePack` is visible to the procedural plugin.
const runs: Array<{script: string; packKeys: string[]}> = [];
getSharedRegistry().scriptRunner = {
  async execute(script: string, _sandbox: string, cb: any, opts?: any) {
    runs.push({script, packKeys: Object.keys(opts?.texturePack ?? {})});
    setTimeout(() => {
      const g = globalThis as any;
      if (opts?.texturePack) g.__three_live_texture_pack__ = opts.texturePack;
      try {
        const scene = new Scene();
        // eslint-disable-next-line no-new-func
        new Function('THREE', 'scene', 'camera', script)(THREE, scene, {
          position: {set() {}},
          lookAt() {},
        });
        scene.updateMatrixWorld(true);
        const glb = scene.toGLB();
        cb.onModelReady(
          glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
        );
      } catch (e) {
        cb.onError?.(e);
      } finally {
        delete g.__three_live_texture_pack__;
      }
    }, 0);
    return {terminate() {}};
  },
} as any;

const WALL_SCRIPT = [
  "const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2), new THREE.MeshStandardMaterial({ color: 0x777777 }));",
  "wall.name = 'Wall';",
  "wall.userData.xr = { material: { preset: 'brick', prompt: 'mossy temple stone', size: 256, seed: 3 } };",
  'scene.add(wall);',
  "const floor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), new THREE.MeshStandardMaterial());",
  "floor.name = 'Floor';",
  "floor.userData.xr = { material: { preset: 'concrete', prompt: 'polished terrazzo', size: 256 } };",
  'scene.add(floor);',
  "const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());",
  "plain.name = 'Plain';",
  "plain.userData.xr = { material: 'wood' };",
  'scene.add(plain);',
].join('\n');

function fakeProvider(calls: string[], fail = new Set<string>()): ThreeLiveImageProvider {
  return {
    name: 'fake-images',
    model: 'fake-1',
    async generateImage({prompt}) {
      calls.push(prompt);
      await sleep(1);
      if (fail.has(prompt)) throw new Error('provider refused');
      return fakePng(600, 400, gradient(600, 400));
    },
  };
}

function fakeElement(attrs: Record<string, string> = {}, cache = memCache()) {
  const events: Array<{type: string; detail: any}> = [];
  const el: any = {
    allowClientScripts: true,
    sandbox: 'worker',
    getAttribute: (n: string) => attrs[n] ?? null,
    hasAttribute: (n: string) => n in attrs,
    querySelector: () => null,
    fireEvent: (type: string, detail: unknown) => events.push({type, detail}),
    executeScript(script: string) {
      return new Promise((resolve, reject) => {
        getSharedRegistry().scriptRunner!.execute(
          script,
          'worker',
          {onModelReady: resolve, onError: reject} as any,
          {allowClientScripts: true},
        );
      });
    },
    textureCache: cache,
    textureCodec: fakeCodec,
  };
  aiPlugin.onElementConnected?.(el);
  return {el, events, cache};
}

async function run(): Promise<void> {
  // 1. Image provider: request shape, responses, and endpoint rules.
  let threw = '';
  try {
    createAIImageProvider({endpoint: 'http://example.com/v1/images/generations'});
  } catch (e) {
    threw = String(e);
  }
  assert(threw.includes('https://'), 'createAIImageProvider rejects non-https non-loopback endpoints');
  const seen: any[] = [];
  const png = fakePng(2, 2, new Uint8Array(16));
  const b64 = btoa(String.fromCharCode(...png));
  const provider = createAIImageProvider({
    endpoint: 'https://proxy.example.com/v1/images/generations',
    model: 'imagen-x',
    headers: {Authorization: 'Bearer t'},
    fetch: (async (url: string, init: any) => {
      seen.push({url, init, body: JSON.parse(init.body)});
      return new Response(JSON.stringify({data: [{b64_json: b64}]}), {status: 200});
    }) as any,
  });
  const got = await provider.generateImage({prompt: 'rusty steel', size: 512, seed: 1});
  const body = seen[0]?.body;
  assert(
    body?.prompt === 'rusty steel' + TEXTURE_PROMPT_SUFFIX &&
      body.model === 'imagen-x' &&
      body.size === '1024x1024' &&
      body.n === 1 &&
      body.response_format === 'b64_json' &&
      seen[0].init.headers.Authorization === 'Bearer t' &&
      got instanceof Uint8Array &&
      got.length === png.length,
    'Image provider posts an OpenAI-compatible Images request and decodes b64_json',
  );
  const urlProvider = (allow: boolean, url: string) =>
    createAIImageProvider({
      endpoint: 'https://proxy.example.com/v1/images/generations',
      responseFormat: null,
      allowResponseUrls: allow,
      fetch: (async (u: string, init: any) => {
        if (init?.method === 'POST') {
          if ('response_format' in JSON.parse(init.body)) throw new Error('unexpected response_format');
          return new Response(JSON.stringify({data: [{url}]}), {status: 200});
        }
        return new Response(png, {status: 200});
      }) as any,
    });
  let urlErr = '';
  try {
    await urlProvider(false, 'https://proxy.example.com/img.png').generateImage({prompt: 'a', size: 256, seed: 1});
  } catch (e) {
    urlErr = String(e);
  }
  let crossErr = '';
  try {
    await urlProvider(true, 'https://evil.example.net/img.png').generateImage({prompt: 'a', size: 256, seed: 1});
  } catch (e) {
    crossErr = String(e);
  }
  const sameOrigin = await urlProvider(true, '/img.png').generateImage({prompt: 'a', size: 256, seed: 1});
  assert(
    urlErr.includes('b64_json') && crossErr.includes('b64_json') && (sameOrigin as Uint8Array).length === png.length,
    'Image URLs are refused unless allowResponseUrls is set and the URL is same-origin',
  );
  let httpErr = '';
  try {
    await createAIImageProvider({
      endpoint: 'http://localhost:8188/v1/images/generations',
      fetch: (async () => new Response('quota', {status: 429})) as any,
    }).generateImage({prompt: 'a', size: 256, seed: 1});
  } catch (e) {
    httpErr = String(e);
  }
  assert(httpErr.includes('HTTP 429'), 'Provider HTTP errors surface with their status (loopback http allowed)');

  // 2. Albedo preparation: center crop, resample, opaque, seamless.
  const prepared = prepareAlbedo({width: 600, height: 400, rgba: gradient(600, 400)}, 256);
  let opaque = true;
  for (let i = 3; i < prepared.length; i += 4) opaque &&= prepared[i] === 255;
  const px = (x: number, y: number) => prepared[(y * 256 + x) * 4];
  let seamOk = true;
  for (let y = 0; y < 256; y++) seamOk &&= Math.abs(px(0, y) - px(255, y)) <= 16;
  const flat = seamBlend(new Uint8Array(16 * 16 * 4).fill(77), 16);
  assert(
    prepared.length === 256 * 256 * 4 && opaque && seamOk && flat.every((v, i) => (i % 4 === 3 ? v === 255 : v === 77)),
    'prepareAlbedo crops, resamples, forces opaque, and blends seams (a flat image stays flat)',
  );

  // 3. Pack round trip and validation.
  const spec = reg.canonicalTextureSpec({prompt: ' mossy  temple stone', size: 256, seed: 3});
  const entry: TexturePackEntry = {
    key: spec.key,
    spec: {prompt: spec.prompt, size: 256, seed: 3},
    rgba: prepared,
    provenance: {provider: 'fake-images'},
  };
  const json = await serializeTexturePack(new Map([[spec.key, entry]]), fakeCodec);
  const back = await parseTexturePack(JSON.parse(JSON.stringify(json)), fakeCodec);
  assert(
    back.get(spec.key)?.rgba.every((v, i) => v === prepared[i]) === true &&
      (back.get(spec.key)?.provenance as any)?.provider === 'fake-images',
    'Texture packs round-trip through JSON',
  );
  const rejects = async (mutate: (j: any) => void, needle: string) => {
    const j = JSON.parse(JSON.stringify(json));
    mutate(j);
    try {
      await parseTexturePack(j, fakeCodec);
      return false;
    } catch (e) {
      return String(e).includes(needle);
    }
  };
  assert(
    (await rejects((j) => (j.entries[spec.key].spec.seed = 4), 'does not match')) &&
      (await rejects((j) => (j.version = 2), 'version')) &&
      (await rejects((j) => (j.format = 'x'), 'format')) &&
      (await rejects((j) => (j.entries[spec.key].spec.size = 512), 'does not match')) &&
      (await rejects((j) => (j.entries[spec.key].albedo = 'data:image/jpeg;base64,AAAA'), 'data:image/png')) &&
      (await rejects((j) => (j.entries['zz'] = j.entries[spec.key]), 'invalid key')),
    'Texture pack validation rejects key/spec mismatches, wrong versions/formats, sizes, MIME types, and keys',
  );

  // 4. Element flow: auto generation after the first compile, then hot-swap.
  const calls: string[] = [];
  const infos: string[] = [];
  const origInfo = console.info;
  console.info = (m: string) => infos.push(String(m));
  const auto = fakeElement();
  auto.el.aiImageProvider = fakeProvider(calls);
  runs.length = 0;
  const firstModel = await auto.el.executeScript(WALL_SCRIPT);
  const requests = textureRequests(firstModel);
  assert(
    requests.length === 2 &&
      requests.some((r) => r.meshes.includes('Wall') && r.key === spec.key) &&
      requests.every((r) => r.spec.size === 256),
    'textureRequests lists each prompt (canonical spec + meshes) from the compiled GLB',
  );
  const swapped = await until(() => runs.length >= 2 && runs[runs.length - 1].packKeys.length === 2);
  assert(
    swapped &&
      runs[0].packKeys.length === 0 &&
      calls.length === 2 &&
      auto.events.some((e) => e.type === 'three-live-texture-start') &&
      auto.events.filter((e) => e.type === 'three-live-texture' && e.detail.source === 'provider').length === 2 &&
      auto.cache.store.size === 2,
    'Missing textures are generated once, cached, and hot-swapped by recompiling with the pack',
  );
  assert(
    infos.filter((m) => m.includes('exportTexturePack')).length === 1,
    'Runtime generation logs the production hint once',
  );
  const exported = await auto.el.exportTexturePack();
  assert(
    Object.keys(exported.entries).length === 2 &&
      (exported.entries[spec.key] as any).provenance.model === 'fake-1',
    'exportTexturePack serializes generated entries with provenance',
  );

  // 5. A second element reuses the cache without calling the provider.
  const calls2: string[] = [];
  const cached = fakeElement({}, auto.cache);
  cached.el.aiImageProvider = fakeProvider(calls2);
  runs.length = 0;
  await cached.el.executeScript(WALL_SCRIPT);
  const cacheSwap = await until(() => runs.length >= 2 && runs[runs.length - 1].packKeys.length === 2);
  assert(
    cacheSwap &&
      calls2.length === 0 &&
      cached.events.filter((e) => e.type === 'three-live-texture' && e.detail.source === 'cache').length === 2,
    'Cached textures resolve without provider calls',
  );

  // 6. Manual mode and no-provider pages never call a provider on their own.
  const calls3: string[] = [];
  const manual = fakeElement({'ai-textures': 'manual'});
  manual.el.aiImageProvider = fakeProvider(calls3);
  runs.length = 0;
  await manual.el.executeScript(WALL_SCRIPT);
  await sleep(30);
  const none = fakeElement();
  await none.el.executeScript(WALL_SCRIPT);
  await sleep(30);
  assert(calls3.length === 0 && runs.length === 2, 'ai-textures="manual" and pages without a provider only use packs and presets');
  const res = await manual.el.generateTextures({meshes: ['Wall']});
  assert(
    res.generated.length === 1 &&
      res.generated[0] === spec.key &&
      calls3.length === 1 &&
      Object.keys(res.pack.entries).length === 1 &&
      runs[runs.length - 1].packKeys.includes(spec.key),
    'generateTextures({meshes}) generates only the requested textures and recompiles',
  );
  let noProvider = '';
  try {
    await none.el.generateTextures();
  } catch (e) {
    noProvider = String(e);
  }
  assert(noProvider.includes('no image provider'), 'generateTextures explains how to configure a provider');

  // 7. Failures are reported once and not retried automatically.
  const calls4: string[] = [];
  const failing = fakeElement();
  failing.el.aiImageProvider = fakeProvider(calls4, new Set(['polished terrazzo']));
  runs.length = 0;
  await failing.el.executeScript(WALL_SCRIPT);
  await until(() => runs.length >= 2);
  await sleep(30);
  const errs = failing.events.filter((e) => e.type === 'three-live-texture-error');
  assert(
    errs.length === 1 &&
      errs[0].detail.error.includes('provider refused') &&
      calls4.filter((p) => p === 'polished terrazzo').length === 1 &&
      runs[runs.length - 1].packKeys.length === 1,
    'A failed generation fires three-live-texture-error once and the scene keeps its preset',
  );

  // 8. Packs set by the page are used directly (no generation).
  const calls5: string[] = [];
  const packed = fakeElement();
  packed.el.aiImageProvider = fakeProvider(calls5);
  runs.length = 0;
  await packed.el.executeScript(WALL_SCRIPT);
  await until(() => runs.length >= 2);
  const packJson = exported;
  const fresh = fakeElement();
  fresh.el.aiImageProvider = fakeProvider(calls5 /* shared counter */);
  fresh.el.texturePack = packJson;
  await until(() => fresh.el.texturePack !== null);
  runs.length = 0;
  const before = calls5.length;
  await fresh.el.executeScript(WALL_SCRIPT);
  await sleep(30);
  assert(
    runs[0].packKeys.length === 2 && calls5.length === before && fresh.el.texturePack?.format === 'three-live-texture-pack',
    'el.texturePack supplies the pack to every compile, so nothing is generated',
  );
  console.info = origInfo;

  // 9. The sandbox worker keeps only well-formed pack entries.
  const src = buildSandboxWorkerSource('/* engine */', 'nonce-1', {
    allowClientScripts: true,
    allowedScriptUrl: null,
  });
  assert(
    src.includes('__three_live_texture_pack__') && src.includes('[0-9a-f]{16}'),
    'Sandbox worker installs a sanitized __three_live_texture_pack__',
  );

  // 10. PNG / GLB DEFLATE pass (B5e).
  await deflaterTests(src);

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

/** Decodes an 8-bit RGBA PNG (any filters) with node:zlib, for assertions. */
function decodeRgbaPng(png: Uint8Array): {w: number; h: number; rgba: Uint8Array} {
  const zlib = require('zlib') as typeof import('zlib');
  const b = Buffer.from(png);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= b.length; ) {
    const len = b.readUInt32BE(p);
    if (b.toString('ascii', p + 4, p + 8) === 'IDAT') {
      idat.push(b.subarray(p + 8, p + 8 + len));
    }
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rb = w * 4;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (rb + 1)];
    for (let i = 0; i < rb; i++) {
      const x = raw[y * (rb + 1) + 1 + i];
      const a = i >= 4 ? rgba[y * rb + i - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * rb + i] : 0;
      const c = i >= 4 && y > 0 ? rgba[(y - 1) * rb + i - 4] : 0;
      let pred = 0;
      if (ft === 1) pred = a;
      else if (ft === 2) pred = up;
      else if (ft === 3) pred = (a + up) >> 1;
      else if (ft === 4) {
        const pp = a + up - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - up);
        const pc = Math.abs(pp - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      rgba[y * rb + i] = (x + pred) & 255;
    }
  }
  return {w, h, rgba};
}

async function deflaterTests(workerSrc: string): Promise<void> {
  assert(
    makePngDeflater(undefined) === null,
    'makePngDeflater returns null without CompressionStream',
  );
  const d = makePngDeflater(
    (globalThis as {CompressionStream?: unknown}).CompressionStream,
  )!;
  const n = 96;
  const rgba = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const x = i % n;
    const y = Math.floor(i / n);
    rgba.set([x * 2, y * 2, (x * y) & 255, 255], i * 4);
  }
  const uri = reg.encodeRgbaPngDataUri(rgba, n, n) as string;
  const stored = new Uint8Array(Buffer.from(uri.split(',')[1], 'base64'));
  const packed = await d.png(stored);
  const back = decodeRgbaPng(packed);
  assert(
    packed.length < stored.length / 4 &&
      back.w === n &&
      back.h === n &&
      Buffer.compare(Buffer.from(back.rgba), Buffer.from(rgba)) === 0,
    'Stored PNGs are re-encoded with filters + DEFLATE, pixel-exact',
  );
  assert(
    (await d.png(packed)) === packed &&
      (await d.png(new Uint8Array([1, 2, 3]))).length === 3,
    'Already-compressed PNGs and non-PNG bytes pass through unchanged',
  );

  // A GLB with a CanvasTexture: images shrink, geometry bytes survive.
  const canvas: any = (globalThis as any).document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366aa';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(32, 32, 64, 64);
  const scene = new Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({map: new THREE.CanvasTexture(canvas)}),
  );
  scene.add(mesh);
  const glb = sceneToGLB(scene as any);
  const out = await d.glb(glb);
  const parse = (g: Uint8Array) => {
    const dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
    const jl = dv.getUint32(12, true);
    const json = JSON.parse(Buffer.from(g.subarray(20, 20 + jl)).toString());
    const bin = g.subarray(28 + jl, 28 + jl + dv.getUint32(20 + jl, true));
    const view = (i: number) => {
      const v = json.bufferViews[i];
      return bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    };
    return {json, view, total: dv.getUint32(8, true)};
  };
  const a = parse(glb);
  const b = parse(out);
  const posView = a.json.accessors[a.json.meshes[0].primitives[0].attributes.POSITION].bufferView;
  const srcUri: string = a.json.images[0].uri;
  const imgA = decodeRgbaPng(
    new Uint8Array(Buffer.from(srcUri.split(',')[1], 'base64')),
  );
  const imgB = decodeRgbaPng(b.view(b.json.images[0].bufferView));
  assert(
    out.length < glb.length / 2 &&
      b.json.images[0].uri === undefined &&
      b.json.images[0].mimeType === 'image/png' &&
      b.total === out.length &&
      Buffer.compare(Buffer.from(imgA.rgba), Buffer.from(imgB.rgba)) === 0 &&
      Buffer.compare(Buffer.from(a.view(posView)), Buffer.from(b.view(posView))) === 0 &&
      b.json.buffers[0].byteLength % 4 === 0,
    'GLB pass DEFLATEs PNG images into the BIN chunk losslessly',
  );
  assert(
    workerSrc.includes('CompressionStream'),
    'Sandbox worker DEFLATEs GLB textures before posting 3D_MODEL_READY',
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
