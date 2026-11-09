/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview AI PBR textures for `<three-live>` / `<xr-live>` (roadmap B5).
 *
 * `userData.xr.material = { preset, prompt, size, seed }` declares an optional
 * AI texture next to an A8 preset. The sandboxed compile only ever reads a
 * **texture pack** (content key → seamless albedo); this module supplies it:
 *
 *   pack (attribute / API / inline script) → IndexedDB cache → image provider
 *   (only when one is configured) → preset fallback.
 *
 * Key canonicalization and normal / ORM derivation live in the procedural
 * plugin (shared with the sandbox and byte-identical to the Rust compiler);
 * this module handles provider calls, image preparation, caching, and
 * hot-swapping (by recompiling the current scene with the updated pack).
 */

import {getSharedRegistry} from '../plugin';

/** `format` field of a serialized texture pack. */
export const TEXTURE_PACK_FORMAT = 'three-live-texture-pack';
/** Current texture pack schema version. */
export const TEXTURE_PACK_VERSION = 1;
/** Most entries a pack may hold. */
export const MAX_PACK_ENTRIES = 64;
/** Largest albedo PNG accepted per pack entry. */
export const MAX_ALBEDO_PNG_BYTES = 2 * 1024 * 1024;
/** Largest provider image accepted. */
export const MAX_SOURCE_IMAGE_BYTES = 16 * 1024 * 1024;
/** IndexedDB cache budget (least recently used entries are evicted). */
export const MAX_CACHE_BYTES = 64 * 1024 * 1024;
/** Appended to every prompt sent to an image provider (shared with the Rust CLI). */
export const TEXTURE_PROMPT_SUFFIX =
  ' Seamless tileable PBR albedo texture, flat even lighting, orthographic top-down view, no perspective, no shadows, no text.';

/** Canonical texture request. */
export interface AITextureSpec {
  readonly prompt: string;
  readonly size: number;
  readonly seed: number;
}

/** A pluggable image generation backend. */
export interface ThreeLiveImageProvider {
  generateImage(request: {
    readonly prompt: string;
    readonly size: number;
    readonly seed: number;
    readonly signal?: AbortSignal;
  }): Promise<Blob | ArrayBuffer | Uint8Array>;
  /** Recorded as pack provenance. */
  readonly name?: string;
  readonly model?: string;
}

/** Options for {@link createAIImageProvider}. */
export interface AIImageProviderOptions {
  /** Full Images API URL (`https://…/v1/images/generations`, or `http://` on loopback). */
  readonly endpoint: string;
  readonly model?: string;
  /** Extra request headers (e.g. a short-lived bearer token for your proxy). */
  readonly headers?: Readonly<Record<string, string>>;
  /** `response_format` sent to the endpoint (default `'b64_json'`; `null` omits it). */
  readonly responseFormat?: 'b64_json' | null;
  /** Requested image size (default `'1024x1024'`; results are resized on-device). */
  readonly imageSize?: string;
  /** Accept `data[0].url` responses (same origin as `endpoint` only). Default false. */
  readonly allowResponseUrls?: boolean;
  /** Request timeout in milliseconds (default 120000). */
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/** Decoded RGBA8 image. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** Image decoding / PNG encoding used by this module (injectable for tests). */
export interface TextureImageCodec {
  decode(bytes: Uint8Array): Promise<DecodedImage>;
  encodePng(rgba: Uint8Array, size: number): Promise<Uint8Array>;
}

/** Persistent cache of generated albedos. */
export interface TextureCache {
  get(key: string): Promise<TextureCacheRecord | null>;
  put(record: TextureCacheRecord): Promise<void>;
}

/** One cached albedo. */
export interface TextureCacheRecord {
  readonly key: string;
  readonly spec: AITextureSpec;
  readonly rgba: Uint8Array;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

/** In-memory pack entry. */
export interface TexturePackEntry {
  readonly key: string;
  readonly spec: AITextureSpec;
  /** `size² × 4` opaque RGBA8. */
  readonly rgba: Uint8Array;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

/** Serialized texture pack (`scene.textures.json`). */
export interface TexturePackJSON {
  readonly format: typeof TEXTURE_PACK_FORMAT;
  readonly version: number;
  readonly entries: Readonly<
    Record<
      string,
      {
        readonly spec: AITextureSpec;
        readonly albedo: string;
        readonly provenance?: Readonly<Record<string, unknown>>;
      }
    >
  >;
}

/** A prompt the compiled scene asked for that the pack does not have. */
export interface TextureMiss {
  readonly key: string;
  readonly spec: AITextureSpec;
  /** Node names using it. */
  readonly meshes: readonly string[];
}

/** Options for `el.generateTextures()`. */
export interface GenerateTexturesOptions {
  /** Only these node names (default: every missing texture). */
  readonly meshes?: readonly string[];
  /** Regenerate even when the pack or cache already has the texture. */
  readonly force?: boolean;
  /** Provider override (defaults to `el.aiImageProvider`, then `ai-image-*`). */
  readonly provider?: ThreeLiveImageProvider;
  /** Parallel provider requests (1..4, default 2). */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/** Result of `el.generateTextures()`. */
export interface GenerateTexturesResult {
  readonly generated: readonly string[];
  readonly cached: readonly string[];
  readonly failed: ReadonlyArray<{readonly key: string; readonly error: string}>;
  readonly pack: TexturePackJSON;
}

type Registry = {
  canonicalTextureSpec?: (o: unknown) => (AITextureSpec & {key: string}) | null;
  encodeRgbaPngDataUri?: (rgba: Uint8Array, w: number, h: number) => string;
};

function registry(): Registry {
  return getSharedRegistry() as unknown as Registry;
}

/** Canonical spec + key (requires the procedural plugin). */
export function textureSpec(
  o: unknown,
): (AITextureSpec & {key: string}) | null {
  const fn = registry().canonicalTextureSpec;
  if (typeof fn !== 'function') {
    throw new Error(
      'AI textures need the procedural plugin (three-live-procedural.min.js or a full bundle).',
    );
  }
  return fn(o);
}

function isAllowedEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function base64ToBytes(b64: string, max: number): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (clean.length > Math.ceil((max * 4) / 3) + 4) {
    throw new Error('image exceeds the size limit');
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function toBytes(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof (data as Blob).arrayBuffer === 'function') {
    return new Uint8Array(await (data as Blob).arrayBuffer());
  }
  throw new Error('image provider returned no image bytes');
}

/**
 * Creates an image provider for any OpenAI-compatible Images endpoint
 * (`POST {model, prompt, n, size, response_format}` → `data[0].b64_json`).
 * Works with OpenAI Images, Gemini / Imagen through Gemini's OpenAI-compatible
 * endpoint, and most proxies.
 */
export function createAIImageProvider(
  options: AIImageProviderOptions,
): ThreeLiveImageProvider {
  const endpoint = String(options?.endpoint ?? '');
  if (!isAllowedEndpoint(endpoint)) {
    throw new Error(
      'ai-image: endpoint must be an https:// URL (or http:// on localhost).',
    );
  }
  const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof doFetch !== 'function') {
    throw new Error('ai-image: no fetch() implementation is available.');
  }
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 120000);
  const origin = new URL(endpoint).origin;
  return {
    name: 'openai-images',
    model: options.model,
    async generateImage({prompt, signal}) {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(signal?.reason);
      if (signal?.aborted) onAbort();
      signal?.addEventListener('abort', onAbort, {once: true});
      const timer = setTimeout(
        () => ctrl.abort(new Error(`ai-image: timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
      try {
        const body: Record<string, unknown> = {
          prompt: prompt + TEXTURE_PROMPT_SUFFIX,
          n: 1,
          size: options.imageSize || '1024x1024',
        };
        if (options.model) body['model'] = options.model;
        if (options.responseFormat !== null) {
          body['response_format'] = options.responseFormat ?? 'b64_json';
        }
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', ...options.headers},
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(
            `ai-image: HTTP ${res.status} from endpoint: ${text.slice(0, 300)}`,
          );
        }
        // tslint:disable-next-line:no-any Untyped provider JSON.
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error('ai-image: endpoint returned non-JSON content.');
        }
        const item = json?.data?.[0];
        if (typeof item?.b64_json === 'string') {
          return base64ToBytes(item.b64_json, MAX_SOURCE_IMAGE_BYTES);
        }
        const url = typeof item?.url === 'string' ? item.url : '';
        if (url.startsWith('data:image/')) {
          return base64ToBytes(url.slice(url.indexOf(',') + 1), MAX_SOURCE_IMAGE_BYTES);
        }
        if (url) {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(url, endpoint).origin === origin;
          } catch {}
          if (!options.allowResponseUrls || !sameOrigin) {
            throw new Error(
              'ai-image: the endpoint returned an image URL; use response_format "b64_json" (or allowResponseUrls for same-origin URLs).',
            );
          }
          const img = await doFetch(new URL(url, endpoint).href, {signal: ctrl.signal});
          if (!img.ok) throw new Error(`ai-image: HTTP ${img.status} fetching the image.`);
          const bytes = new Uint8Array(await img.arrayBuffer());
          if (bytes.length > MAX_SOURCE_IMAGE_BYTES) {
            throw new Error('ai-image: image exceeds 16 MB.');
          }
          return bytes;
        }
        throw new Error('ai-image: response had no image.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

function imageKind(b: Uint8Array): 'png' | 'jpeg' | 'webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** Browser codec: `createImageBitmap` + canvas (no color conversion). */
export const browserImageCodec: TextureImageCodec = {
  async decode(bytes) {
    const kind = imageKind(bytes);
    if (!kind) throw new Error('image must be PNG, JPEG, or WebP');
    const blob = new Blob([bytes], {type: `image/${kind}`});
    const bmp = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const {width, height} = bmp;
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), {width, height});
    const ctx = canvas.getContext('2d', {willReadFrequently: true}) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('2D canvas unavailable for image decoding');
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const data = ctx.getImageData(0, 0, width, height).data;
    return {width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)};
  },
  async encodePng(rgba, size) {
    const enc = registry().encodeRgbaPngDataUri;
    if (typeof enc === 'function') {
      const uri = enc(rgba, size, size);
      return base64ToBytes(uri.slice(uri.indexOf(',') + 1), Infinity);
    }
    throw new Error('PNG encoding needs the procedural plugin');
  },
};

/** Area-average resample (nearest when upscaling); mirrors `resample_area` in Rust. */
export function resampleArea(
  rgba: Uint8Array,
  sw: number,
  sh: number,
  ow: number,
  oh: number,
): Uint8Array {
  const out = new Uint8Array(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const sy0 = Math.floor((y * sh) / oh);
    const sy1 = Math.min(sh, Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / oh)));
    for (let x = 0; x < ow; x++) {
      const sx0 = Math.floor((x * sw) / ow);
      const sx1 = Math.min(sw, Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / ow)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let cnt = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const s = (yy * sw + xx) * 4;
          r += rgba[s];
          g += rgba[s + 1];
          b += rgba[s + 2];
          a += rgba[s + 3];
          cnt++;
        }
      }
      const o = (y * ow + x) * 4;
      out[o] = Math.floor((r + cnt / 2) / cnt);
      out[o + 1] = Math.floor((g + cnt / 2) / cnt);
      out[o + 2] = Math.floor((b + cnt / 2) / cnt);
      out[o + 3] = Math.floor((a + cnt / 2) / cnt);
    }
  }
  return out;
}

/** Edge-band crossfade with the half-shifted image; mirrors `seam_blend` in Rust. */
export function seamBlend(rgba: Uint8Array, n: number): Uint8Array {
  const band = Math.max(1, Math.floor(n / 8));
  const half = Math.floor(n / 2);
  const smooth = (t: number) => {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  };
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const dy = (Math.min(y, n - 1 - y) + 0.5) / band;
    for (let x = 0; x < n; x++) {
      const dx = (Math.min(x, n - 1 - x) + 0.5) / band;
      const w = 1 - smooth(Math.min(dx, dy));
      const o = (y * n + x) * 4;
      const s = (((y + half) % n) * n + ((x + half) % n)) * 4;
      for (let c = 0; c < 3; c++) {
        const a = rgba[o + c];
        out[o + c] = Math.max(0, Math.min(255, Math.floor(a + (rgba[s + c] - a) * w + 0.5)));
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Center-crop to square, resample to `size`, force opaque, seam-blend. */
export function prepareAlbedo(img: DecodedImage, size: number): Uint8Array {
  const side = Math.min(img.width, img.height);
  if (!(side > 0)) throw new Error('generated image is empty');
  const x0 = Math.floor((img.width - side) / 2);
  const y0 = Math.floor((img.height - side) / 2);
  const sq = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    const row = ((y0 + y) * img.width + x0) * 4;
    sq.set(img.rgba.subarray(row, row + side * 4), y * side * 4);
  }
  const rgba = side === size ? sq : resampleArea(sq, side, side, size, size);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return seamBlend(rgba, size);
}

/** Parses and validates a serialized pack (format, version, key/spec agreement, PNG size). */
export async function parseTexturePack(
  input: unknown,
  codec: TextureImageCodec = browserImageCodec,
): Promise<Map<string, TexturePackEntry>> {
  const v = typeof input === 'string' ? JSON.parse(input) : input;
  // tslint:disable-next-line:no-any Untyped pack JSON.
  const p = v as any;
  if (!p || p.format !== TEXTURE_PACK_FORMAT) {
    throw new Error(`texture pack: format must be "${TEXTURE_PACK_FORMAT}"`);
  }
  if (p.version !== TEXTURE_PACK_VERSION) {
    throw new Error(`texture pack: version must be ${TEXTURE_PACK_VERSION}`);
  }
  if (!p.entries || typeof p.entries !== 'object' || Array.isArray(p.entries)) {
    throw new Error('texture pack: entries must be an object');
  }
  const keys = Object.keys(p.entries);
  if (keys.length > MAX_PACK_ENTRIES) {
    throw new Error(`texture pack: more than ${MAX_PACK_ENTRIES} entries`);
  }
  const out = new Map<string, TexturePackEntry>();
  for (const key of keys) {
    const e = p.entries[key];
    if (!/^[0-9a-f]{16}$/.test(key)) throw new Error(`texture pack: invalid key '${key}'`);
    const spec = textureSpec(e?.spec);
    if (!spec) throw new Error(`texture pack: entry ${key}: invalid spec`);
    if (spec.key !== key) {
      throw new Error(`texture pack: entry ${key}: key does not match its spec (${spec.key})`);
    }
    const url = typeof e?.albedo === 'string' ? e.albedo : '';
    const prefix = 'data:image/png;base64,';
    if (!url.startsWith(prefix)) {
      throw new Error(`texture pack: entry ${key}: albedo must be a data:image/png;base64 URL`);
    }
    const png = base64ToBytes(url.slice(prefix.length), MAX_ALBEDO_PNG_BYTES);
    if (png.length > MAX_ALBEDO_PNG_BYTES || imageKind(png) !== 'png') {
      throw new Error(`texture pack: entry ${key}: albedo is not a PNG within 2 MB`);
    }
    const img = await codec.decode(png);
    if (img.width !== spec.size || img.height !== spec.size) {
      throw new Error(
        `texture pack: entry ${key}: albedo is ${img.width}x${img.height}, expected ${spec.size}x${spec.size}`,
      );
    }
    const rgba = new Uint8Array(img.rgba);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    const provenance =
      e.provenance && typeof e.provenance === 'object' ? e.provenance : undefined;
    out.set(key, {
      key,
      spec: {prompt: spec.prompt, size: spec.size, seed: spec.seed},
      rgba,
      ...(provenance ? {provenance} : {}),
    });
  }
  return out;
}

/** Serializes a pack (entries sorted by key). */
export async function serializeTexturePack(
  pack: ReadonlyMap<string, TexturePackEntry>,
  codec: TextureImageCodec = browserImageCodec,
): Promise<TexturePackJSON> {
  const entries: Record<string, TexturePackJSON['entries'][string]> = {};
  for (const key of [...pack.keys()].sort()) {
    const e = pack.get(key)!;
    const png = await codec.encodePng(e.rgba, e.spec.size);
    entries[key] = {
      spec: e.spec,
      albedo: `data:image/png;base64,${bytesToBase64(png)}`,
      ...(e.provenance ? {provenance: e.provenance} : {}),
    };
  }
  return {format: TEXTURE_PACK_FORMAT, version: TEXTURE_PACK_VERSION, entries};
}

// tslint:disable-next-line:no-any Untyped glTF JSON.
function gltfJson(model: unknown): any {
  // tslint:disable-next-line:no-any Untyped glTF JSON.
  const direct = (model as {gltf?: any} | null)?.gltf;
  if (direct) return direct;
  if (model instanceof ArrayBuffer && model.byteLength >= 20) {
    const dv = new DataView(model);
    if (dv.getUint32(0, true) === 0x46546c67) {
      try {
        return JSON.parse(
          new TextDecoder().decode(new Uint8Array(model, 20, dv.getUint32(12, true))),
        );
      } catch {}
    }
  }
  return null;
}

/** Every AI texture the compiled model asks for (`extras.xr.material.prompt`). */
export function textureRequests(model: unknown): TextureMiss[] {
  const byKey = new Map<string, {spec: AITextureSpec; meshes: string[]}>();
  for (const n of gltfJson(model)?.nodes ?? []) {
    const mat = n?.extras?.xr?.material;
    if (!mat || typeof mat !== 'object' || mat.prompt == null) continue;
    const spec = textureSpec(mat);
    if (!spec) continue;
    const entry = byKey.get(spec.key) ?? {
      spec: {prompt: spec.prompt, size: spec.size, seed: spec.seed},
      meshes: [],
    };
    if (typeof n.name === 'string' && n.name) entry.meshes.push(n.name);
    byKey.set(spec.key, entry);
  }
  return [...byKey].map(([key, v]) => ({key, spec: v.spec, meshes: v.meshes}));
}

/** IndexedDB cache (`three-live-textures`), or null where IndexedDB is unavailable. */
export function indexedDbTextureCache(maxBytes = MAX_CACHE_BYTES): TextureCache | null {
  if (typeof indexedDB === 'undefined') return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('three-live-textures', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('textures', {keyPath: 'key'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void) =>
    db().then(
      (d) =>
        new Promise<T | undefined>((resolve, reject) => {
          const tx = d.transaction('textures', mode);
          const r = fn(tx.objectStore('textures'));
          tx.oncomplete = () => resolve(r ? r.result : undefined);
          tx.onerror = () => reject(tx.error);
        }),
    );
  return {
    async get(key) {
      try {
        // tslint:disable-next-line:no-any Stored record.
        const rec: any = await run('readonly', (s) => s.get(key));
        if (!rec || !(rec.rgba instanceof Uint8Array)) return null;
        void run('readwrite', (s) => s.put({...rec, t: Date.now()})).catch(() => {});
        return rec as TextureCacheRecord;
      } catch {
        return null;
      }
    },
    async put(record) {
      try {
        await run('readwrite', (s) => s.put({...record, t: Date.now()}));
        // LRU eviction over the store.
        const all = ((await run('readonly', (s) => s.getAll())) ?? []) as Array<
          TextureCacheRecord & {t: number}
        >;
        let total = all.reduce((n, r) => n + (r.rgba?.byteLength ?? 0), 0);
        all.sort((a, b) => a.t - b.t);
        const evict: string[] = [];
        for (const r of all) {
          if (total <= maxBytes) break;
          total -= r.rgba?.byteLength ?? 0;
          evict.push(r.key);
        }
        if (evict.length) {
          await run('readwrite', (s) => {
            for (const k of evict) s.delete(k);
          });
        }
      } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// Element integration
// ---------------------------------------------------------------------------

/** The subset of `<three-live>` / `<xr-live>` the texture runtime relies on. */
export interface AITextureElement {
  getAttribute?(name: string): string | null;
  querySelector?(selector: string): {textContent: string | null} | null;
  fireEvent?(type: string, detail?: unknown): void;
  executeScript(script: string): Promise<unknown>;
  loadScriptFromSrc?(src: string): Promise<unknown>;
  aiImageProvider?: ThreeLiveImageProvider;
  texturePack?: TexturePackJSON | null;
  textureCache?: TextureCache | null;
  textureCodec?: TextureImageCodec;
  generateTextures?: (o?: GenerateTexturesOptions) => Promise<GenerateTexturesResult>;
  exportTexturePack?: () => Promise<TexturePackJSON>;
  __tlTex?: TextureState;
}

interface TextureState {
  pack: Map<string, TexturePackEntry>;
  packJson: TexturePackJSON | null;
  failed: Set<string>;
  inflight: Map<string, Promise<boolean>>;
  lastModel: unknown;
  lastRun: {kind: 'script'; value: string} | {kind: 'url'; value: string} | null;
  cache: TextureCache | null | undefined;
  loadSeq: number;
}

let pendingPack: Record<string, {size: number; rgba: Uint8Array}> | null = null;
let hinted = false;

function state(el: AITextureElement): TextureState {
  return (el.__tlTex ??= {
    pack: new Map(),
    packJson: null,
    failed: new Set(),
    inflight: new Map(),
    lastModel: null,
    lastRun: null,
    cache: undefined,
    loadSeq: 0,
  });
}

function compileMap(el: AITextureElement): Record<string, {size: number; rgba: Uint8Array}> | null {
  const st = el.__tlTex;
  if (!st || st.pack.size === 0) return null;
  const out: Record<string, {size: number; rgba: Uint8Array}> = {};
  for (const [k, e] of st.pack) out[k] = {size: e.spec.size, rgba: e.rgba};
  return out;
}

/**
 * Wraps the shared script runner (once) so element compiles carry the
 * element's texture pack into the sandbox.
 */
function ensureRunnerWrapped(): void {
  const reg = getSharedRegistry() as unknown as {
    // tslint:disable-next-line:no-any ScriptRunner shape.
    scriptRunner?: any;
  };
  const r = reg.scriptRunner;
  if (!r || r.__tlTexWrapped) return;
  const withPack = (o: unknown) =>
    pendingPack && !(o as {texturePack?: unknown} | undefined)?.texturePack
      ? {...(o as object), texturePack: pendingPack}
      : o;
  reg.scriptRunner = {
    __tlTexWrapped: true,
    // tslint:disable-next-line:no-any Pass-through runner arguments.
    execute: (s: string, sb: string, cb: any, o?: unknown) => r.execute(s, sb, cb, withPack(o)),
    ...(typeof r.executeUrl === 'function'
      ? {
          // tslint:disable-next-line:no-any Pass-through runner arguments.
          executeUrl: (u: string, sb: string, cb: any, o?: unknown) =>
            r.executeUrl(u, sb, cb, withPack(o)),
        }
      : {}),
  };
}

/** Runs `fn` (which must call the script runner synchronously) with the element's pack. */
export function withElementTexturePack<T>(el: AITextureElement, fn: () => T): T {
  ensureRunnerWrapped();
  const prev = pendingPack;
  pendingPack = compileMap(el);
  try {
    return fn();
  } finally {
    pendingPack = prev;
  }
}

function resolveImageProvider(
  el: AITextureElement,
  override?: ThreeLiveImageProvider,
): ThreeLiveImageProvider | null {
  const p = override ?? el.aiImageProvider;
  if (p && typeof p.generateImage === 'function') return p;
  const endpoint = el.getAttribute?.('ai-image-endpoint');
  if (!endpoint) return null;
  return createAIImageProvider({
    endpoint,
    model: el.getAttribute?.('ai-image-model') || undefined,
  });
}

function cacheFor(el: AITextureElement): TextureCache | null {
  if (el.textureCache !== undefined) return el.textureCache;
  const st = state(el);
  if (st.cache === undefined) st.cache = indexedDbTextureCache();
  return st.cache;
}

function codecFor(el: AITextureElement): TextureImageCodec {
  return el.textureCodec ?? browserImageCodec;
}

function recompile(el: AITextureElement): Promise<unknown> {
  // Fall back to the inline scene when the plugin loaded after it ran.
  const inline = el.querySelector?.(
    'script[type="text/three"], script[type="text/three-live"]',
  )?.textContent;
  const run =
    state(el).lastRun ?? (inline ? ({kind: 'script', value: inline} as const) : null);
  if (!run) return Promise.resolve();
  return run.kind === 'url' && typeof el.loadScriptFromSrc === 'function'
    ? el.loadScriptFromSrc(run.value)
    : el.executeScript(run.value);
}

function addEntry(el: AITextureElement, entry: TexturePackEntry): void {
  const st = state(el);
  st.pack.set(entry.key, entry);
  st.packJson = null;
  st.failed.delete(entry.key);
}

async function fromCache(el: AITextureElement, misses: readonly TextureMiss[]): Promise<string[]> {
  const cache = cacheFor(el);
  if (!cache) return [];
  const hits: string[] = [];
  for (const m of misses) {
    const rec = await cache.get(m.key);
    if (
      rec &&
      rec.spec?.size === m.spec.size &&
      rec.rgba?.length === m.spec.size * m.spec.size * 4
    ) {
      addEntry(el, {key: m.key, spec: m.spec, rgba: rec.rgba, provenance: rec.provenance});
      el.fireEvent?.('three-live-texture', {key: m.key, meshes: m.meshes, source: 'cache'});
      hits.push(m.key);
    }
  }
  return hits;
}

async function generateOne(
  el: AITextureElement,
  provider: ThreeLiveImageProvider,
  m: TextureMiss,
  signal?: AbortSignal,
): Promise<boolean> {
  const st = state(el);
  const existing = st.inflight.get(m.key);
  if (existing) return existing;
  const job = (async () => {
    try {
      const raw = await toBytes(
        await provider.generateImage({...m.spec, signal}),
      );
      if (raw.length > MAX_SOURCE_IMAGE_BYTES) throw new Error('generated image exceeds 16 MB');
      const rgba = prepareAlbedo(await codecFor(el).decode(raw), m.spec.size);
      const provenance = {
        provider: provider.name ?? 'custom',
        ...(provider.model ? {model: provider.model} : {}),
        createdAt: new Date().toISOString(),
      };
      addEntry(el, {key: m.key, spec: m.spec, rgba, provenance});
      void cacheFor(el)?.put({key: m.key, spec: m.spec, rgba, provenance});
      el.fireEvent?.('three-live-texture', {key: m.key, meshes: m.meshes, source: 'provider'});
      return true;
    } catch (e: unknown) {
      st.failed.add(m.key);
      el.fireEvent?.('three-live-texture-error', {
        key: m.key,
        meshes: m.meshes,
        error: String((e as Error)?.message || e),
      });
      return false;
    } finally {
      st.inflight.delete(m.key);
    }
  })();
  st.inflight.set(m.key, job);
  return job;
}

async function runPool<T>(items: readonly T[], n: number, fn: (t: T) => Promise<unknown>) {
  let i = 0;
  const workers = Array.from({length: Math.min(n, items.length)}, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/** Called after every element compile with the resulting model. */
export function onElementCompiled(el: AITextureElement, model: unknown): void {
  const st = state(el);
  st.lastModel = model;
  let misses: TextureMiss[];
  try {
    misses = textureRequests(model).filter((m) => !st.pack.has(m.key));
  } catch {
    return;
  }
  const pending = misses.filter((m) => !st.failed.has(m.key) && !st.inflight.has(m.key));
  if (!pending.length) return;
  void (async () => {
    const hits = await fromCache(el, pending);
    if (hits.length) {
      // The recompile reports whatever is still missing.
      await recompile(el).catch(() => {});
      return;
    }
    if ((el.getAttribute?.('ai-textures') || 'auto').toLowerCase() === 'manual') return;
    const provider = resolveImageProvider(el);
    if (!provider) return;
    el.fireEvent?.('three-live-texture-start', {keys: pending.map((m) => m.key)});
    const results = await Promise.all(pending.map((m) => generateOne(el, provider, m)));
    const made = results.filter(Boolean).length;
    if (made) {
      if (!hinted) {
        hinted = true;
        console.info(
          `[three-live] Generated ${made} AI texture(s) at runtime. Each visitor without a cached copy triggers new (and different) generations. For consistent results, save el.exportTexturePack() and load it via texture-pack.`,
        );
      }
      await recompile(el).catch(() => {});
    }
  })();
}

/** Records how the element's current scene was loaded (for hot-swap recompiles). */
export function onElementRun(
  el: AITextureElement,
  run: {kind: 'script'; value: string} | {kind: 'url'; value: string},
): void {
  state(el).lastRun = run;
}

async function setPack(el: AITextureElement, json: unknown): Promise<void> {
  const st = state(el);
  const seq = ++st.loadSeq;
  if (json == null) {
    st.pack = new Map();
    st.packJson = null;
    await recompile(el).catch(() => {});
    return;
  }
  try {
    const parsed = await parseTexturePack(json, codecFor(el));
    if (seq !== st.loadSeq) return;
    st.pack = parsed;
    st.packJson = (typeof json === 'string' ? JSON.parse(json) : json) as TexturePackJSON;
    st.failed.clear();
    await recompile(el).catch(() => {});
  } catch (e: unknown) {
    el.fireEvent?.('three-live-texture-error', {
      key: null,
      meshes: [],
      error: String((e as Error)?.message || e),
    });
  }
}

async function loadPackUrl(el: AITextureElement, url: string): Promise<void> {
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : undefined;
    const res = await fetch(new URL(url, base).href, {credentials: 'same-origin'});
    if (!res.ok) throw new Error(`HTTP ${res.status} loading texture-pack "${url}"`);
    await setPack(el, await res.json());
  } catch (e: unknown) {
    el.fireEvent?.('three-live-texture-error', {
      key: null,
      meshes: [],
      error: String((e as Error)?.message || e),
    });
  }
}

/** Generates (or loads from cache) the textures the current scene is missing. */
export async function generateTextures(
  el: AITextureElement,
  options: GenerateTexturesOptions = {},
): Promise<GenerateTexturesResult> {
  const st = state(el);
  const only = options.meshes ? new Set(options.meshes) : null;
  const wanted = textureRequests(st.lastModel).filter(
    (m) =>
      (options.force || !st.pack.has(m.key)) &&
      (!only || m.meshes.some((n) => only.has(n))),
  );
  const cached: string[] = [];
  const generated: string[] = [];
  const failed: Array<{key: string; error: string}> = [];
  let todo = wanted;
  if (!options.force) {
    const hits = new Set(await fromCache(el, wanted));
    cached.push(...hits);
    todo = wanted.filter((m) => !hits.has(m.key));
  }
  if (todo.length) {
    const provider = resolveImageProvider(el, options.provider);
    if (!provider) {
      throw new Error(
        'generateTextures: no image provider. Set el.aiImageProvider, or the ai-image-endpoint (and ai-image-model) attributes.',
      );
    }
    el.fireEvent?.('three-live-texture-start', {keys: todo.map((m) => m.key)});
    const n = Math.max(1, Math.min(4, Math.floor(Number(options.concurrency ?? 2)) || 2));
    const onError = (ev: {key: string; error: string}) => failed.push(ev);
    await runPool(todo, n, async (m) => {
      st.failed.delete(m.key);
      if (options.force) st.pack.delete(m.key);
      const ok = await generateOne(el, provider, m, options.signal);
      if (ok) generated.push(m.key);
      else onError({key: m.key, error: 'generation failed (see three-live-texture-error)'});
    });
  }
  if (cached.length || generated.length) await recompile(el).catch(() => {});
  return {generated, cached, failed, pack: await exportTexturePack(el)};
}

/** Serializes the element's current texture pack. */
export async function exportTexturePack(el: AITextureElement): Promise<TexturePackJSON> {
  const st = state(el);
  return (st.packJson ??= await serializeTexturePack(st.pack, codecFor(el)));
}

/** Adds `texturePack`, `generateTextures()`, and `exportTexturePack()` to an element. */
export function installTextureSupport(el: AITextureElement): void {
  if (!el || (el as {__tlTexInstalled?: boolean}).__tlTexInstalled) return;
  (el as {__tlTexInstalled?: boolean}).__tlTexInstalled = true;
  state(el);
  Object.defineProperty(el, 'texturePack', {
    get: () => el.__tlTex?.packJson ?? null,
    set: (v: unknown) => void setPack(el, v),
    configurable: true,
  });
  el.generateTextures = (o?: GenerateTexturesOptions) => generateTextures(el, o);
  el.exportTexturePack = () => exportTexturePack(el);
  const inline = el.querySelector?.('script[type="application/three-live-texture-pack"]');
  if (inline?.textContent?.trim()) {
    void setPack(el, inline.textContent);
  }
  const url = el.getAttribute?.('texture-pack');
  if (url) void loadPackUrl(el, url);
  const node = el as unknown as Node;
  if (typeof MutationObserver !== 'undefined' && node && typeof node.nodeType === 'number') {
    new MutationObserver(() => {
      const next = el.getAttribute?.('texture-pack');
      if (next) void loadPackUrl(el, next);
    }).observe(node, {attributes: true, attributeFilter: ['texture-pack']});
  }
}
