/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Portable synchronous JSON protocol (`ThreeEngine.aiCall`) for
 * hosted compiler embedders on Android, iOS, and desktop JS engines.
 *
 * Implements the same `{"op": "...", ...}` request/response contract as
 * `compiler/src/ai_edit.rs::ai_call` on top of the shared TypeScript AI
 * modules (`ai-select-match.ts`, `ai-select.ts`, `ai-image.ts`,
 * `ai-texture.ts`, `ai-voice.ts`, and `procedural.ts`).
 */

import {getInternalHost} from './compiler-polyfills';
import {getSharedRegistry} from './plugin';
import {
  type AISpatialPriors,
  buildImageMessages,
  imageRepairMessage,
} from './plugins/ai-image';
import {describeSelection, SELECT_PROMPT} from './plugins/ai-select';
import {
  buildSelectIndex,
  DEFAULT_SELECT_CAMERA,
  matchSelection,
  parseVoiceCommand,
  type SelectCamera,
  type SelectIndexEntry,
  type SelectRawEntry,
} from './plugins/ai-select-match';
import {
  type AITextureSpec,
  MAX_ALBEDO_PNG_BYTES,
  MAX_PACK_ENTRIES,
  MAX_SOURCE_IMAGE_BYTES,
  prepareAlbedo,
  TEXTURE_PACK_FORMAT,
  TEXTURE_PACK_VERSION,
  TEXTURE_PROMPT_SUFFIX,
  type TexturePackJSON,
} from './plugins/ai-texture';
import {
  geminiLiveAdapter,
  realtimeAdapter,
  VOICE_TOOLS,
} from './plugins/ai-voice';

/** System prompt for complete-script scene edits (`messages` op). */
const EDIT_SYSTEM_PROMPT = [
  'You edit Three.js scene scripts for Three-Live, which compiles them to glTF for Web, Android, and iOS.',
  'Reply with the COMPLETE updated script in a single ```js code block and nothing else.',
  'Rules:',
  '- Use the pre-defined globals `THREE`, `scene`, and `camera`. No imports, renderer, loaders, DOM, network, or timers.',
  '- Change only what the instruction asks; keep every other object, name, and value as it is.',
  '- Give new meshes and groups descriptive `.name` values; keep existing names stable.',
  '- Keep objects resting on y = 0 and within view of the camera.',
  '- Supported: core geometries and materials (MeshStandardMaterial / MeshPhysicalMaterial with PBR maps, and MeshStandardNodeMaterial with loop-free THREE.TSL colorNode / emissiveNode / roughnessNode / metalnessNode / opacityNode / bumpNode / positionNode), lights, Group, InstancedMesh, THREE.CSG, THREE.SweepGeometry / HelixGeometry / LoftGeometry / PatternInstancer, domain kits when loaded (THREE.Mechanical, THREE.Architecture, THREE.Industrial, THREE.Science, THREE.Electronics), THREE.CanvasTexture, THREE.ProceduralTexture presets (wood, marble, brick, concrete, brushedMetal, rust, leather, fabric, carbonFiber, checkerboard, grid, clapboard, shiplap, stucco, shingle), and declarative mesh.userData.xr traits. Optional per-frame motion: function animate(t) { ... }.',
  '- Keep every userData.xr.material preset; add a prompt (AI texture) only when the instruction asks for a specific surface.',
].join('\n');

const VOICE_BASE_INSTRUCTIONS = [
  'You are a voice assistant inside a live 3D scene editor.',
  'Keep spoken replies short: one sentence.',
  'To change the scene, call edit_scene with the request; never describe code.',
  'After a tool result, say briefly what changed, or why it could not be done.',
  'When the user refers to objects by name, color, or position, call select_meshes with their words first.',
  'If its result has a question, ask it and wait; otherwise say what is selected, and if they also asked for a change, call edit_scene.',
].join(' ');

const MAX_SCRIPT_BYTES = 1048576;
const MAX_INSTRUCTION_CHARS = 2000;
const MAX_SELECTION_CHARS = 200;
const MAX_SELECTED = 50;
const MAX_WARNINGS = 20;

const origJsonParse = JSON.parse;
const origJsonStringify = JSON.stringify;
const OrigTextEncoder = TextEncoder;

/** Single AI texture-pack lookup recorded during scene evaluation. */
export interface HostedTextureLookup {
  readonly key: string;
  readonly spec: AITextureSpec;
  readonly hit: boolean;
}

/** Structured outcome returned by a hosted scene-evaluation callback. */
export interface HostedSceneEvalOutcome {
  readonly ok: boolean;
  readonly error?: string;
  readonly warnings: string[];
  readonly codedWarnings: string[];
  readonly meshNames: string[];
  readonly nonEmptyNames: string[];
  readonly meshCount: number;
  readonly hasUnnamedXr: boolean;
  readonly selectEntries: SelectRawEntry[];
  readonly camera: SelectCamera | null;
  readonly textureLookups: HostedTextureLookup[];
  readonly textureMeshes: Record<string, string[]>;
}

/** Decoded RGBA8 albedo entry stored in a hosted texture pack. */
export interface HostedPackEntry {
  readonly spec: AITextureSpec;
  readonly rgba: Uint8Array;
  readonly provenance?: Record<string, unknown>;
}

let defaultTexturePack: Map<string, HostedPackEntry> | null = null;
let defaultTexturePackToken = 0;
let nextTexturePackToken = 1;

/** Returns the active default hosted texture pack and memoization token. */
export function getHostedDefaultTexturePack(): {
  pack: Map<string, HostedPackEntry> | null;
  token: number;
} {
  return {pack: defaultTexturePack, token: defaultTexturePackToken};
}

/** Allocates a fresh non-zero texture-pack memoization token. */
export function allocateHostedPackToken(): number {
  return nextTexturePackToken++;
}

function truncateChars(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join('');
}

function normalizeSelection(names: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const name = truncateChars(n, MAX_SELECTION_CHARS);
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_SELECTED) break;
  }
  return out;
}

function selectionArg(req: Record<string, unknown>): string[] {
  const raw = req['selection'];
  if (typeof raw === 'string') return normalizeSelection([raw]);
  if (Array.isArray(raw)) return normalizeSelection(raw);
  return [];
}

function selectionSentence(selected: readonly string[]): string {
  if (selected.length === 0) return '';
  if (selected.length === 1) {
    return `The user selected the mesh named "${selected[0]}"; the instruction refers to it.\n`;
  }
  return `The user selected the meshes named ${selected.map((m) => `"${m}"`).join(', ')}; the instruction refers to them.\n`;
}

function buildMessages(
  source: string,
  selection: readonly string[],
  instruction: string,
): Array<{role: string; content: string}> {
  const cleanInst = truncateChars(instruction.trim(), MAX_INSTRUCTION_CHARS);
  const user =
    `Current scene script:\n\`\`\`js\n${source}\n\`\`\`\n` +
    selectionSentence(normalizeSelection(selection)) +
    `Instruction: ${cleanInst}`;
  return [
    {role: 'system', content: EDIT_SYSTEM_PROMPT},
    {role: 'user', content: user},
  ];
}

function repairMessage(error: string): string {
  return `That script was rejected by the Three-Live sandbox: ${error}\nReturn the complete corrected script in a single \`\`\`js code block.`;
}

function extractScript(reply: string): string {
  let first: string | null = null;
  let rest = reply;
  while (true) {
    const start = rest.indexOf('```');
    if (start < 0) break;
    const after = rest.slice(start + 3);
    const nl = after.indexOf('\n');
    if (nl < 0) break;
    const info = after.slice(0, nl).trim();
    const langMatch = /^[A-Za-z0-9_+-]*/.exec(info);
    const lang = (langMatch ? langMatch[0] : '').toLowerCase();
    const bodyStart = after.slice(nl + 1);
    const end = bodyStart.indexOf('```');
    if (end < 0) {
      if (first === null) return bodyStart.trim();
      break;
    }
    const body = bodyStart.slice(0, end).trim();
    if (
      lang === 'js' ||
      lang === 'javascript' ||
      lang === 'ts' ||
      lang === 'typescript' ||
      lang === 'mjs'
    ) {
      return body;
    }
    if (first === null) first = body;
    rest = bodyStart.slice(end + 3);
  }
  if (first !== null) return first;
  const words = reply.split(/[^A-Za-z0-9_$]+/);
  return words.includes('scene') ? reply.trim() : '';
}

function mentionsRemoval(instruction: string): boolean {
  return instruction
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((w) => w === 'remove' || w === 'delete' || w === 'rename');
}

function describeResult(applied: boolean, error?: string): string {
  if (applied) return 'Done.';
  const reason = (error ?? 'the edit was rejected')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  return `Sorry, I couldn't apply that: ${truncateChars(reason || 'the edit was rejected', 160)}`;
}

function extractScriptFromSource(source: string): string {
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  const re =
    /<script\b[^>]*\btype\s*=\s*["']text\/three["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.length > 0 ? blocks.join('\n') : source;
}

function asVec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? [x, y, z]
    : null;
}

function entriesFromJson(v: unknown): SelectRawEntry[] {
  if (!Array.isArray(v)) return [];
  const out: SelectRawEntry[] = [];
  for (const e of v.slice(0, 5000)) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec['name'] !== 'string') continue;
    const name = truncateChars(rec['name'], 200);
    if (!name) continue;
    const min = asVec3(rec['min']);
    const max = asVec3(rec['max']);
    if (!min || !max) continue;
    const color = asVec3(rec['color']);
    out.push({name, min, max, color});
  }
  return out;
}

function cameraFromJson(v: unknown, fallback: SelectCamera): SelectCamera {
  if (!v || typeof v !== 'object') return fallback;
  const rec = v as Record<string, unknown>;
  return {
    eye: asVec3(rec['eye']) ?? fallback.eye,
    target: asVec3(rec['target']) ?? fallback.target,
  };
}

function indexJson(index: readonly SelectIndexEntry[]): unknown[] {
  const r = (x: number) => Math.round(x * 100) / 100;
  return index.slice(0, 300).map((e) => ({
    id: e.id,
    name: e.name,
    color: e.colorName,
    center: [r(e.center[0]), r(e.center[1]), r(e.center[2])],
    size: r(Math.cbrt(e.size)),
  }));
}

function speakableName(name: string): string {
  let out = '';
  let prev = '';
  for (const c of name) {
    if (prev) {
      const lowerUpper = prev >= 'a' && prev <= 'z' && c >= 'A' && c <= 'Z';
      const alphaDigit =
        ((prev >= 'a' && prev <= 'z') || (prev >= 'A' && prev <= 'Z')) &&
        c >= '0' &&
        c <= '9';
      if (lowerUpper || alphaDigit) out += ' ';
    }
    out += c === '_' || c === '-' || c === '.' ? ' ' : c;
    prev = c;
  }
  return out.trim().split(/\s+/).filter(Boolean).join(' ');
}

function speakList(names: readonly string[], joiner: string): string {
  const shown = names.slice(0, 5).map(speakableName);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} ${joiner} ${more} more`;
  if (shown.length < 2) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} ${joiner} ${shown[shown.length - 1]}`;
}

function describeVoiceSelection(
  mode: string,
  matched: Record<string, unknown> | null,
  meshes: readonly string[],
  query: string,
): string {
  if (mode === 'clear') return 'Selection cleared.';
  if (!matched) return 'Which object?';
  const list = (k: string): string[] =>
    Array.isArray(matched[k])
      ? (matched[k] as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : [];
  const names = list('names');
  const candidates = list('candidates');
  const reason = typeof matched['reason'] === 'string' ? matched['reason'] : '';
  const conf =
    typeof matched['confidence'] === 'string' ? matched['confidence'] : 'none';
  if (conf === 'high') {
    if (mode === 'remove') {
      return meshes.length === 0
        ? `Removed ${speakList(names, 'and')}. Nothing is selected.`
        : `Removed ${speakList(names, 'and')}. ${meshes.length} selected.`;
    }
    if (mode === 'add') {
      return `Added ${speakList(names, 'and')}. ${meshes.length} selected.`;
    }
    return names.length === 1
      ? `Selected ${speakableName(names[0])}.`
      : `Selected ${names.length}: ${speakList(names, 'and')}.`;
  }
  if (conf === 'ambiguous') {
    return reason === 'count_mismatch'
      ? `I found ${candidates.length}: ${speakList(candidates, 'and')}. Which ones?`
      : `Which one: ${speakList(candidates, 'or')}?`;
  }
  const q = truncateChars(
    query.trim().split(/\s+/).filter(Boolean).join(' '),
    80,
  );
  if (reason === 'relation') {
    return `I can't tell which one "${q}" is yet. Try its name or color, or tap it.`;
  }
  if (reason === 'empty') return 'Which object?';
  return `I couldn't find "${q}".`;
}

// ---------------------------------------------------------------------------
// Base64 + Minimal Synchronous PNG / RFC-1951 Inflate Codec for Texture Packs
// ---------------------------------------------------------------------------

const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_CHARS[(n >>> 18) & 63] +
      B64_CHARS[(n >>> 12) & 63] +
      B64_CHARS[(n >>> 6) & 63] +
      B64_CHARS[n & 63];
  }
  if (i < len) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const n = (b0 << 16) | (b1 << 8);
    out += B64_CHARS[(n >>> 18) & 63] + B64_CHARS[(n >>> 12) & 63];
    out += i + 1 < len ? B64_CHARS[(n >>> 6) & 63] + '=' : '==';
  }
  return out;
}

function decodeBase64(raw: string, maxBytes: number): Uint8Array | null {
  let clean = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) continue;
    clean += raw[i];
  }
  if (clean.length === 0 || clean.length % 4 === 1) return null;
  if (Math.floor((clean.length * 3) / 4) > maxBytes + 3) return null;
  const out = new Uint8Array(Math.ceil((clean.length * 3) / 4));
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    if (ch === 61) break;
    let v = -1;
    if (ch >= 65 && ch <= 90) v = ch - 65;
    else if (ch >= 97 && ch <= 122) v = ch - 71;
    else if (ch >= 48 && ch <= 57) v = ch + 4;
    else if (ch === 43) v = 62;
    else if (ch === 47) v = 63;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (p >= maxBytes) return null;
      out[p++] = (acc >>> bits) & 255;
    }
  }
  return out.subarray(0, p);
}

function inflateZlib(zlibBytes: Uint8Array, maxOut: number): Uint8Array {
  if (zlibBytes.length < 6) throw new Error('truncated zlib stream');
  const cmf = zlibBytes[0];
  const flg = zlibBytes[1];
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0 || flg & 0x20) {
    throw new Error('unsupported zlib header');
  }
  let bitPos = 16;
  const maxBits = (zlibBytes.length - 4) * 8;
  const readBits = (n: number): number => {
    if (bitPos + n > maxBits) throw new Error('truncated deflate data');
    let val = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = (bitPos + i) >>> 3;
      const bitIdx = (bitPos + i) & 7;
      val |= ((zlibBytes[byteIdx] >>> bitIdx) & 1) << i;
    }
    bitPos += n;
    return val;
  };
  const buildTree = (
    lengths: Int32Array,
  ): {counts: Int32Array; syms: Int32Array} => {
    const counts = new Int32Array(16);
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] > 0) counts[lengths[i]]++;
    }
    const offs = new Int32Array(16);
    let code = 0;
    for (let b = 1; b <= 15; b++) {
      offs[b] = code;
      code += counts[b];
    }
    const syms = new Int32Array(code);
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (len > 0) syms[offs[len]++] = i;
    }
    return {counts, syms};
  };
  const decodeSym = (t: {counts: Int32Array; syms: Int32Array}): number => {
    let code = 0;
    let first = 0;
    let idx = 0;
    for (let len = 1; len <= 15; len++) {
      code |= readBits(1);
      const count = t.counts[len];
      if (code - count < first) return t.syms[idx + (code - first)];
      idx += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('invalid Huffman code');
  };
  const fixedLit = new Int32Array(288);
  fixedLit.fill(8, 0, 144);
  fixedLit.fill(9, 144, 256);
  fixedLit.fill(7, 256, 280);
  fixedLit.fill(8, 280, 288);
  const fixedDist = new Int32Array(32).fill(5);
  const fixedLitTree = buildTree(fixedLit);
  const fixedDistTree = buildTree(fixedDist);
  const LEN_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
    83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const LEN_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0,
  ];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
    769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13,
  ];
  const CL_ORDER = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
  ];

  const out = new Uint8Array(maxOut);
  let op = 0;
  let bfinal = 0;
  while (!bfinal) {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      bitPos = (bitPos + 7) & ~7;
      const bytePos = bitPos >>> 3;
      if (bytePos + 4 > zlibBytes.length - 4) {
        throw new Error('truncated stored block');
      }
      const len = zlibBytes[bytePos] | (zlibBytes[bytePos + 1] << 8);
      const nlen = zlibBytes[bytePos + 2] | (zlibBytes[bytePos + 3] << 8);
      if ((len ^ nlen) !== 0xffff) throw new Error('corrupt stored block');
      if (op + len > maxOut || bytePos + 4 + len > zlibBytes.length - 4) {
        throw new Error('inflated output exceeds expected size');
      }
      out.set(zlibBytes.subarray(bytePos + 4, bytePos + 4 + len), op);
      op += len;
      bitPos = (bytePos + 4 + len) * 8;
    } else if (btype === 1 || btype === 2) {
      let litTree = fixedLitTree;
      let distTree = fixedDistTree;
      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLens = new Int32Array(19);
        for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
        const clTree = buildTree(clLens);
        const allLens = new Int32Array(hlit + hdist);
        let idx = 0;
        while (idx < allLens.length) {
          const sym = decodeSym(clTree);
          if (sym < 16) {
            allLens[idx++] = sym;
          } else {
            const rep =
              sym === 16
                ? readBits(2) + 3
                : sym === 17
                  ? readBits(3) + 3
                  : readBits(7) + 11;
            const val = sym === 16 ? (idx > 0 ? allLens[idx - 1] : 0) : 0;
            for (let k = 0; k < rep && idx < allLens.length; k++) {
              allLens[idx++] = val;
            }
          }
        }
        litTree = buildTree(allLens.subarray(0, hlit));
        distTree = buildTree(allLens.subarray(hlit));
      }
      while (true) {
        const sym = decodeSym(litTree);
        if (sym < 256) {
          if (op >= maxOut) throw new Error('inflated output overflow');
          out[op++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= LEN_BASE.length) throw new Error('invalid length symbol');
          const length = LEN_BASE[li] + readBits(LEN_EXTRA[li]);
          const di = decodeSym(distTree);
          if (di >= DIST_BASE.length) throw new Error('invalid dist symbol');
          const dist = DIST_BASE[di] + readBits(DIST_EXTRA[di]);
          if (dist > op || op + length > maxOut) {
            throw new Error('invalid back-reference');
          }
          for (let k = 0; k < length; k++) {
            out[op] = out[op - dist];
            op++;
          }
        }
      }
    } else {
      throw new Error('invalid deflate block type');
    }
  }
  return out.subarray(0, op);
}

function decodePngSync(png: Uint8Array): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  // Prefer native kernel / host hook when available.
  // tslint:disable-next-line:no-any
  const nativeDecode = (globalThis as any).__three_live_native_decode_png__;
  if (typeof nativeDecode === 'function') {
    const res = nativeDecode(png);
    if (res && res.rgba instanceof Uint8Array) return res;
    if (Array.isArray(res) && res[2] instanceof Uint8Array) {
      return {
        width: Number(res[0]) >>> 0,
        height: Number(res[1]) >>> 0,
        rgba: res[2],
      };
    }
  }
  if (
    png.length < 33 ||
    png[0] !== 0x89 ||
    png[1] !== 0x50 ||
    png[2] !== 0x4e ||
    png[3] !== 0x47
  ) {
    throw new Error('albedo must be a PNG');
  }
  const u32 = (o: number) =>
    ((png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3]) >>>
    0;
  if (u32(12) !== 0x49484452) throw new Error('missing PNG IHDR');
  const width = u32(16);
  const height = u32(20);
  const bitDepth = png[24];
  const colorType = png[25];
  const interlace = png[28];
  if (!width || !height || width > 4096 || height > 4096) {
    throw new Error('unsupported PNG dimensions');
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error('unsupported PNG bit depth or interlace');
  }
  const bpp =
    colorType === 6
      ? 4
      : colorType === 2
        ? 3
        : colorType === 4
          ? 2
          : colorType === 0
            ? 1
            : 0;
  if (!bpp) throw new Error('unsupported PNG color type');
  const idatParts: Uint8Array[] = [];
  let idatTotal = 0;
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = u32(pos);
    const type = u32(pos + 4);
    const ds = pos + 8;
    const de = ds + len;
    if (de + 4 > png.length) throw new Error('truncated PNG chunk');
    if (type === 0x49444154) {
      idatParts.push(png.subarray(ds, de));
      idatTotal += len;
    } else if (type === 0x49454e44) {
      break;
    }
    pos = de + 4;
  }
  const zlibData = new Uint8Array(idatTotal);
  let zp = 0;
  for (const part of idatParts) {
    zlibData.set(part, zp);
    zp += part.length;
  }
  const rowBytes = width * bpp;
  const stride = 1 + rowBytes;
  const raw = inflateZlib(zlibData, stride * height);
  if (raw.length < stride * height) throw new Error('short PNG image data');
  const unfiltered = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * stride];
    const srcOff = y * stride + 1;
    const dstOff = y * rowBytes;
    const prevOff = (y - 1) * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[srcOff + i];
      const a = i >= bpp ? unfiltered[dstOff + i - bpp] : 0;
      const b = y > 0 ? unfiltered[prevOff + i] : 0;
      const c = i >= bpp && y > 0 ? unfiltered[prevOff + i - bpp] : 0;
      let val = x;
      if (ft === 1) val = (x + a) & 255;
      else if (ft === 2) val = (x + b) & 255;
      else if (ft === 3) val = (x + ((a + b) >>> 1)) & 255;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (x + pr) & 255;
      } else if (ft !== 0) {
        throw new Error('invalid PNG filter');
      }
      unfiltered[dstOff + i] = val;
    }
  }
  if (colorType === 6) {
    return {width, height, rgba: unfiltered};
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (colorType === 2) {
      rgba[o] = unfiltered[i * 3];
      rgba[o + 1] = unfiltered[i * 3 + 1];
      rgba[o + 2] = unfiltered[i * 3 + 2];
      rgba[o + 3] = 255;
    } else if (colorType === 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = unfiltered[i * 2];
      rgba[o + 3] = unfiltered[i * 2 + 1];
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = unfiltered[i];
      rgba[o + 3] = 255;
    }
  }
  return {width, height, rgba};
}

function encodeAlbedoPngDataUri(rgba: Uint8Array, size: number): string {
  const reg = getSharedRegistry() as {
    encodeRgbaPngDataUri?: (rgba: Uint8Array, w: number, h: number) => string;
  };
  if (typeof reg.encodeRgbaPngDataUri !== 'function') {
    throw new Error('encodeRgbaPngDataUri unavailable');
  }
  const uri = reg.encodeRgbaPngDataUri(rgba, size, size);
  // tslint:disable-next-line:no-any
  const compress = (globalThis as any).__three_live_native_compress_png_uri__;
  return typeof compress === 'function' ? compress(uri) || uri : uri;
}

function canonicalSpec(raw: unknown): (AITextureSpec & {key: string}) | null {
  const reg = getSharedRegistry() as {
    canonicalTextureSpec?: (
      o: unknown,
    ) => (AITextureSpec & {key: string}) | null;
  };
  return typeof reg.canonicalTextureSpec === 'function'
    ? reg.canonicalTextureSpec(raw)
    : null;
}

function parseHostedPack(input: unknown): Map<string, HostedPackEntry> {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      throw new Error(`texture pack: invalid JSON: ${(e as Error).message}`);
    }
  }
  const p = parsed as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || p['format'] !== TEXTURE_PACK_FORMAT) {
    throw new Error(`texture pack: format must be "${TEXTURE_PACK_FORMAT}"`);
  }
  if (p['version'] !== TEXTURE_PACK_VERSION) {
    throw new Error(`texture pack: version must be ${TEXTURE_PACK_VERSION}`);
  }
  const entriesObj = p['entries'];
  if (
    !entriesObj ||
    typeof entriesObj !== 'object' ||
    Array.isArray(entriesObj)
  ) {
    throw new Error('texture pack: entries must be an object');
  }
  const keys = Object.keys(entriesObj);
  if (keys.length > MAX_PACK_ENTRIES) {
    throw new Error(`texture pack: more than ${MAX_PACK_ENTRIES} entries`);
  }
  const out = new Map<string, HostedPackEntry>();
  for (const key of keys.sort()) {
    if (!/^[0-9a-f]{16}$/.test(key)) {
      throw new Error(`texture pack: invalid key '${key}'`);
    }
    const e = (entriesObj as Record<string, unknown>)[key] as
      | Record<string, unknown>
      | undefined;
    const spec = canonicalSpec(e?.['spec']);
    if (!spec) throw new Error(`texture pack: entry ${key}: invalid spec`);
    if (spec.key !== key) {
      throw new Error(
        `texture pack: entry ${key}: key does not match its spec (${spec.key})`,
      );
    }
    const url = typeof e?.['albedo'] === 'string' ? e['albedo'] : '';
    const prefix = 'data:image/png;base64,';
    if (!url.startsWith(prefix)) {
      throw new Error(
        `texture pack: entry ${key}: albedo must be a data:image/png;base64 URL`,
      );
    }
    const png = decodeBase64(url.slice(prefix.length), MAX_ALBEDO_PNG_BYTES);
    if (!png) {
      throw new Error(
        `texture pack: entry ${key}: albedo is not valid base64 or exceeds 6 MB`,
      );
    }
    let img: {width: number; height: number; rgba: Uint8Array};
    try {
      img = decodePngSync(png);
    } catch (err) {
      throw new Error(`texture pack: entry ${key}: ${(err as Error).message}`);
    }
    if (img.width !== spec.size || img.height !== spec.size) {
      throw new Error(
        `texture pack: entry ${key}: albedo is ${img.width}x${img.height}, expected ${spec.size}x${spec.size}`,
      );
    }
    const rgba = new Uint8Array(img.rgba);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    const prov = e?.['provenance'];
    out.set(key, {
      spec: {prompt: spec.prompt, size: spec.size, seed: spec.seed},
      rgba,
      ...(prov && typeof prov === 'object' && !Array.isArray(prov)
        ? {provenance: prov as Record<string, unknown>}
        : {}),
    });
  }
  return out;
}

function serializeHostedPack(
  pack: ReadonlyMap<string, HostedPackEntry>,
): TexturePackJSON {
  const entries: Record<string, TexturePackJSON['entries'][string]> = {};
  for (const key of [...pack.keys()].sort()) {
    const e = pack.get(key)!;
    entries[key] = {
      spec: e.spec,
      albedo: encodeAlbedoPngDataUri(e.rgba, e.spec.size),
      ...(e.provenance ? {provenance: e.provenance} : {}),
    };
  }
  return {
    format: TEXTURE_PACK_FORMAT,
    version: TEXTURE_PACK_VERSION,
    entries,
  };
}

function decodeGeneratedImageSync(bytes: Uint8Array): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('generated image exceeds 16 MB');
  }
  // Allow closure-captured host hook for JPEG/WebP decoding when running inside a native host.
  const hostDecode = getInternalHost()?.decodeImage;
  if (typeof hostDecode === 'function') {
    const decoded = hostDecode(bytes);
    if (decoded && decoded.rgba instanceof Uint8Array) return decoded;
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return decodePngSync(bytes);
  }
  throw new Error('generated image must be PNG or JPEG');
}

// ---------------------------------------------------------------------------
// Main Synchronous Protocol Dispatcher
// ---------------------------------------------------------------------------

/** Executes one synchronous JSON AI protocol request and returns a JSON string response. */
export function executeAiProtocolCall(
  requestJson: string,
  runSceneEval: (
    code: string,
    pack?: Map<string, HostedPackEntry> | null,
    packToken?: number,
  ) => HostedSceneEvalOutcome,
): string {
  try {
    return executeAiProtocolCallInner(requestJson, runSceneEval);
  } catch (e) {
    return origJsonStringify({
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function executeAiProtocolCallInner(
  requestJson: string,
  runSceneEval: (
    code: string,
    pack?: Map<string, HostedPackEntry> | null,
    packToken?: number,
  ) => HostedSceneEvalOutcome,
): string {
  let req: Record<string, unknown>;
  try {
    const parsed: unknown = origJsonParse(requestJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return origJsonStringify({
        error: 'invalid request JSON: expected object',
      });
    }
    req = parsed as Record<string, unknown>;
  } catch (e) {
    return origJsonStringify({
      error: `invalid request JSON: ${(e as Error).message}`,
    });
  }

  const strArg = (k: string): string | undefined =>
    typeof req[k] === 'string' ? (req[k] as string) : undefined;
  const stringsArg = (k: string): string[] | undefined =>
    Array.isArray(req[k])
      ? (req[k] as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;

  const op = strArg('op') ?? '';

  const loadSelectScene = ():
    | {ok: true; raw: SelectRawEntry[]; camera: SelectCamera}
    | {ok: false; err: Record<string, unknown>} => {
    let fallback = DEFAULT_SELECT_CAMERA;
    let raw: SelectRawEntry[];
    if (req['entries'] !== undefined) {
      raw = entriesFromJson(req['entries']);
    } else if (typeof req['source'] === 'string') {
      const script = extractScriptFromSource(req['source'] as string);
      const res = runSceneEval(script);
      if (!res.ok) {
        return {
          ok: false,
          err: {error: `scene failed to run: ${res.error ?? 'unknown error'}`},
        };
      }
      if (res.camera) fallback = res.camera;
      raw = res.selectEntries;
    } else {
      return {ok: false, err: {error: "needs 'entries' or 'source'"}};
    }
    return {ok: true, raw, camera: cameraFromJson(req['camera'], fallback)};
  };

  switch (op) {
    case 'messages':
      return JSON.stringify({
        messages: buildMessages(
          strArg('source') ?? '',
          selectionArg(req),
          strArg('instruction') ?? '',
        ),
      });

    case 'repair':
      return JSON.stringify({
        message: repairMessage(strArg('error') ?? ''),
      });

    case 'extract':
      return JSON.stringify({
        code: extractScript(strArg('reply') ?? ''),
      });

    case 'validate': {
      const code = strArg('code') ?? '';
      const selection = selectionArg(req);
      const instruction = strArg('instruction') ?? '';
      if (!code.trim()) {
        return JSON.stringify({
          ok: false,
          warnings: [],
          meshNames: [],
          meshCount: 0,
          error: 'The model reply did not contain a scene script.',
        });
      }
      if (new OrigTextEncoder().encode(code).byteLength > MAX_SCRIPT_BYTES) {
        return JSON.stringify({
          ok: false,
          warnings: [],
          meshNames: [],
          meshCount: 0,
          error: 'The generated script exceeds the 1 MB script limit.',
        });
      }
      const res = runSceneEval(code);
      if (!res.ok) {
        return JSON.stringify({
          ok: false,
          warnings: [],
          meshNames: [],
          meshCount: 0,
          error: res.error ?? 'Scene validation failed.',
        });
      }
      const lost = selection.filter((sel) => !res.meshNames.includes(sel));
      let error: string | undefined;
      if (res.meshCount === 0) {
        error = 'The edited scene contains no meshes.';
      } else if (lost.length > 0 && !mentionsRemoval(instruction)) {
        error =
          lost.length === 1
            ? `The edited scene no longer contains the selected mesh "${lost[0]}".`
            : `The edited scene no longer contains the selected meshes ${lost.map((m) => `"${m}"`).join(', ')}.`;
      }
      return JSON.stringify({
        ok: error === undefined,
        warnings: res.warnings.slice(0, MAX_WARNINGS),
        meshNames: res.meshNames,
        meshCount: res.meshCount,
        ...(error !== undefined ? {error} : {}),
      });
    }

    case 'describe':
      return JSON.stringify({
        text: describeResult(Boolean(req['applied']), strArg('error')),
      });

    case 'select': {
      const loaded = loadSelectScene();
      if (!loaded.ok) return JSON.stringify(loaded.err);
      const index = buildSelectIndex(loaded.raw);
      const within = stringsArg('within') ?? null;
      const match = matchSelection(
        index,
        strArg('query') ?? '',
        loaded.camera,
        within,
      );
      return JSON.stringify({
        ...match,
        ...(req['withIndex'] === true ? {index: indexJson(index)} : {}),
      });
    }

    case 'select_messages': {
      const loaded = loadSelectScene();
      if (!loaded.ok) return JSON.stringify(loaded.err);
      let raw = loaded.raw;
      const within = stringsArg('within');
      if (within) raw = raw.filter((e) => within.includes(e.name));
      const index = buildSelectIndex(raw);
      const selected = (stringsArg('selection') ?? []).slice(0, 50);
      const query = truncateChars(strArg('query') ?? '', 500);
      const r = (x: number) => Math.round(x * 100) / 100;
      const fx = loaded.camera.target[0] - loaded.camera.eye[0];
      const fz = loaded.camera.target[2] - loaded.camera.eye[2];
      const rl = Math.hypot(fx, fz) || 1;
      const payload = {
        camera: {
          eye: loaded.camera.eye.map(r),
          target: loaded.camera.target.map(r),
          right: [r(-fz / rl), 0, r(fx / rl)],
        },
        objects: indexJson(index),
        selected,
        request: query,
      };
      return JSON.stringify({
        messages: [
          {role: 'system', content: SELECT_PROMPT},
          {role: 'user', content: JSON.stringify(payload)},
        ],
        names: index.slice(0, 300).map((e) => e.name),
      });
    }

    case 'select_parse': {
      const names = stringsArg('names') ?? [];
      const reply = strArg('reply') ?? '';
      let parsed: Record<string, unknown> = {};
      const a = reply.indexOf('{');
      const b = reply.lastIndexOf('}');
      if (a >= 0 && b > a) {
        try {
          const v: unknown = JSON.parse(reply.slice(a, b + 1));
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            parsed = v as Record<string, unknown>;
          }
        } catch {}
      }
      const picked: string[] = [];
      if (Array.isArray(parsed['ids'])) {
        for (const id of parsed['ids']) {
          if (
            typeof id === 'number' &&
            Number.isInteger(id) &&
            id >= 0 &&
            id < names.length
          ) {
            const name = names[id];
            if (!picked.includes(name) && picked.length < MAX_SELECTED) {
              picked.push(name);
            }
          }
        }
      }
      let q = '';
      let inCtrl = false;
      const rawQ =
        typeof parsed['question'] === 'string' ? parsed['question'] : '';
      for (const c of rawQ) {
        const cp = c.codePointAt(0) ?? 0;
        if (cp < 0x20 || cp === 0x7f) {
          if (!inCtrl) q += ' ';
          inCtrl = true;
        } else {
          q += c;
          inCtrl = false;
        }
      }
      const question = truncateChars(q.trim(), 300);
      const high = parsed['confidence'] === 'high' && picked.length > 0;
      return JSON.stringify({
        names: picked,
        confidence: high ? 'high' : 'low',
        question,
      });
    }

    case 'select_say': {
      const meshes = stringsArg('meshes') ?? [];
      const rawMatch = req['match'];
      const matched =
        rawMatch && typeof rawMatch === 'object' && !Array.isArray(rawMatch)
          ? (rawMatch as Record<string, unknown>)
          : null;
      return JSON.stringify({
        text: describeVoiceSelection(
          strArg('mode') ?? 'replace',
          matched,
          meshes,
          strArg('query') ?? '',
        ),
      });
    }

    case 'select_context':
      return JSON.stringify({
        text: describeSelection(stringsArg('meshes') ?? []),
      });

    case 'parse_command':
      return JSON.stringify(parseVoiceCommand(strArg('text') ?? ''));

    case 'image_messages': {
      try {
        const messages = buildImageMessages(
          strArg('imageUrl') ?? '',
          strArg('prompt') ?? '',
          (req['priors'] as AISpatialPriors | null | undefined) ?? null,
        );
        return JSON.stringify({messages});
      } catch (e) {
        return JSON.stringify({error: (e as Error).message});
      }
    }

    case 'image_validate': {
      const code = strArg('code') ?? '';
      if (!code.trim()) {
        return JSON.stringify({
          ok: false,
          error: 'The model reply did not contain a scene script.',
          warnings: [],
          meshNames: [],
          meshCount: 0,
        });
      }
      if (new OrigTextEncoder().encode(code).byteLength > MAX_SCRIPT_BYTES) {
        return JSON.stringify({
          ok: false,
          error: 'The generated script exceeds the 1 MB script limit.',
          warnings: [],
          meshNames: [],
          meshCount: 0,
        });
      }
      const res = runSceneEval(code);
      if (!res.ok) {
        return JSON.stringify({
          ok: false,
          error: res.error ?? 'Scene validation failed.',
          warnings: [],
          meshNames: [],
          meshCount: 0,
        });
      }
      if (res.meshCount === 0) {
        return JSON.stringify({
          ok: false,
          error: 'The generated scene contains no meshes.',
          warnings: [],
          meshNames: [],
          meshCount: 0,
        });
      }
      const warnings = res.codedWarnings.slice(0, MAX_WARNINGS);
      if (
        res.hasUnnamedXr &&
        warnings.length < MAX_WARNINGS &&
        !warnings.some((w) => w.includes('TL204'))
      ) {
        warnings.push(
          '[TL204] Node with userData.xr is missing a unique .name.',
        );
      }
      return origJsonStringify({
        ok: true,
        warnings,
        meshNames: res.nonEmptyNames,
        meshCount: res.meshCount,
      });
    }

    case 'image_repair':
      return JSON.stringify({
        message: imageRepairMessage(
          strArg('error') ?? null,
          stringsArg('warnings') ?? [],
        ),
      });

    case 'texture_key': {
      const spec = canonicalSpec(req);
      if (!spec) {
        return JSON.stringify({
          error: 'prompt must be a non-empty string of at most 500 characters',
        });
      }
      return JSON.stringify({
        key: spec.key,
        spec: {prompt: spec.prompt, size: spec.size, seed: spec.seed},
      });
    }

    case 'texture_derive': {
      const size = Number(req['size']);
      if (!Number.isInteger(size) || size < 4 || size > 1024) {
        return JSON.stringify({error: 'size must be in 4..=1024'});
      }
      const rawB64 = strArg('albedo');
      if (!rawB64) return JSON.stringify({error: "missing 'albedo'"});
      const b64Part = rawB64.includes(';base64,')
        ? rawB64.slice(rawB64.indexOf(';base64,') + 8)
        : rawB64;
      const albedo = decodeBase64(b64Part, size * size * 4);
      if (!albedo) {
        return JSON.stringify({error: "'albedo' is not valid base64"});
      }
      if (albedo.length !== size * size * 4) {
        return JSON.stringify({
          error: `albedo must be ${size * size * 4} bytes of RGBA8`,
        });
      }
      const reg = getSharedRegistry() as {
        deriveTextureMaps?: (
          albedo: Uint8Array,
          size: number,
          normalStrength: number,
          roughness: number,
          metalness: number,
        ) =>
          | readonly [Uint8Array, Uint8Array]
          | {normal: Uint8Array; orm: Uint8Array; mapSize?: number};
      };
      if (typeof reg.deriveTextureMaps !== 'function') {
        return origJsonStringify({error: 'deriveTextureMaps unavailable'});
      }
      const numOr = (k: string, d: number) =>
        typeof req[k] === 'number' && Number.isFinite(req[k] as number)
          ? (req[k] as number)
          : d;
      const derived = reg.deriveTextureMaps(
        albedo,
        size,
        numOr('normalStrength', 1.0),
        numOr('roughness', 0.8),
        numOr('metalness', 0.0),
      );
      const [normal, orm] = Array.isArray(derived)
        ? derived
        : [derived.normal, derived.orm];
      const mapSize = size > 512 && size % 2 === 0 ? size / 2 : size;
      return origJsonStringify({
        normal: encodeBase64(normal),
        orm: encodeBase64(orm),
        mapSize,
      });
    }

    case 'texture_pack_validate': {
      if (req['pack'] === undefined) {
        return JSON.stringify({ok: false, keys: [], error: "missing 'pack'"});
      }
      try {
        const pack = parseHostedPack(req['pack']);
        return JSON.stringify({ok: true, keys: [...pack.keys()]});
      } catch (e) {
        return JSON.stringify({
          ok: false,
          keys: [],
          error: (e as Error).message,
        });
      }
    }

    case 'texture_pack_add': {
      try {
        const pack =
          req['pack'] === undefined || req['pack'] === null
            ? new Map<string, HostedPackEntry>()
            : parseHostedPack(req['pack']);
        const spec = canonicalSpec(req['spec']);
        if (!spec) return JSON.stringify({error: "invalid 'spec'"});
        if (pack.size >= MAX_PACK_ENTRIES && !pack.has(spec.key)) {
          return JSON.stringify({
            error: `texture pack is full (${MAX_PACK_ENTRIES} entries)`,
          });
        }
        const rawImg = strArg('image');
        if (!rawImg) return JSON.stringify({error: "missing 'image'"});
        const b64Part = rawImg.includes(';base64,')
          ? rawImg.slice(rawImg.indexOf(';base64,') + 8)
          : rawImg;
        const imgBytes = decodeBase64(b64Part, MAX_SOURCE_IMAGE_BYTES);
        if (!imgBytes) {
          return JSON.stringify({error: "'image' is not valid base64"});
        }
        const decoded = decodeGeneratedImageSync(imgBytes);
        const rgba = prepareAlbedo(decoded, spec.size);
        const prov = req['provenance'];
        pack.set(spec.key, {
          spec: {prompt: spec.prompt, size: spec.size, seed: spec.seed},
          rgba,
          ...(prov && typeof prov === 'object' && !Array.isArray(prov)
            ? {provenance: prov as Record<string, unknown>}
            : {}),
        });
        return JSON.stringify({
          key: spec.key,
          pack: serializeHostedPack(pack),
        });
      } catch (e) {
        return JSON.stringify({error: (e as Error).message});
      }
    }

    case 'texture_pack_set': {
      try {
        if (req['pack'] === undefined || req['pack'] === null) {
          defaultTexturePack = null;
          defaultTexturePackToken = 0;
          return JSON.stringify({ok: true, keys: []});
        }
        const pack = parseHostedPack(req['pack']);
        defaultTexturePack = pack;
        defaultTexturePackToken = allocateHostedPackToken();
        return JSON.stringify({ok: true, keys: [...pack.keys()]});
      } catch (e) {
        return JSON.stringify({ok: false, error: (e as Error).message});
      }
    }

    case 'texture_requests': {
      const code = strArg('code') ?? '';
      const token = defaultTexturePack ? allocateHostedPackToken() : 0;
      const res = runSceneEval(code, defaultTexturePack, token);
      if (!res.ok) {
        return JSON.stringify({error: res.error ?? 'Scene validation failed.'});
      }
      return JSON.stringify({
        requests: res.textureLookups.map((l) => ({
          key: l.key,
          spec: l.spec,
          hit: l.hit,
          meshes: res.textureMeshes[l.key] ?? [],
        })),
      });
    }

    case 'texture_image_request': {
      const spec = canonicalSpec(req['spec']);
      if (!spec) return JSON.stringify({error: "invalid 'spec'"});
      const model = (strArg('model') ?? '').trim();
      return JSON.stringify({
        key: spec.key,
        body: {
          prompt: `${spec.prompt}${TEXTURE_PROMPT_SUFFIX}`,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
          ...(model ? {model} : {}),
        },
      });
    }

    case 'texture_image_parse': {
      const bodyStr = strArg('body') ?? '';
      let parsed: Record<string, unknown>;
      try {
        const v: unknown = JSON.parse(bodyStr);
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          return JSON.stringify({
            error: 'image endpoint returned non-JSON content',
          });
        }
        parsed = v as Record<string, unknown>;
      } catch {
        return JSON.stringify({
          error: 'image endpoint returned non-JSON content',
        });
      }
      if (parsed['error'] && typeof parsed['error'] === 'object') {
        const msg =
          typeof (parsed['error'] as Record<string, unknown>)['message'] ===
          'string'
            ? ((parsed['error'] as Record<string, unknown>)[
                'message'
              ] as string)
            : 'unknown error';
        return JSON.stringify({error: `image endpoint error: ${msg}`});
      }
      const dataArr = Array.isArray(parsed['data']) ? parsed['data'] : null;
      const item =
        dataArr && dataArr[0] && typeof dataArr[0] === 'object'
          ? (dataArr[0] as Record<string, unknown>)
          : null;
      if (!item) {
        return JSON.stringify({error: 'image endpoint response had no data'});
      }
      let b64: string | null = null;
      if (typeof item['b64_json'] === 'string') {
        b64 = item['b64_json'] as string;
      } else if (typeof item['url'] === 'string') {
        const url = item['url'] as string;
        if (url.startsWith('data:image/') && url.includes(';base64,')) {
          b64 = url.slice(url.indexOf(';base64,') + 8);
        } else {
          return JSON.stringify({
            error:
              'image endpoint returned an image URL; use response_format "b64_json"',
          });
        }
      } else {
        return JSON.stringify({error: 'image endpoint response had no image'});
      }
      const bytes = decodeBase64(b64, MAX_SOURCE_IMAGE_BYTES);
      if (!bytes) {
        return JSON.stringify({
          error: 'image is not valid base64 or exceeds 16 MB',
        });
      }
      return JSON.stringify({image: encodeBase64(bytes)});
    }

    default: {
      if (op.startsWith('voice_')) {
        const provider = strArg('provider') || 'ai-realtime';
        if (provider !== 'ai-realtime' && provider !== 'gemini-live') {
          return JSON.stringify({
            error: `unknown voice provider '${provider}' (use ai-realtime or gemini-live)`,
          });
        }
        const adapter =
          provider === 'gemini-live' ? geminiLiveAdapter : realtimeAdapter;
        if (op === 'voice_setup') {
          const extra = (strArg('instructions') ?? '').trim();
          const instructions = extra
            ? `${VOICE_BASE_INSTRUCTIONS}\n${truncateChars(extra, MAX_INSTRUCTION_CHARS)}`
            : VOICE_BASE_INSTRUCTIONS;
          const overrides =
            req['session'] &&
            typeof req['session'] === 'object' &&
            !Array.isArray(req['session'])
              ? (req['session'] as Record<string, unknown>)
              : undefined;
          return JSON.stringify({
            messages: adapter.setup({
              instructions,
              tools: VOICE_TOOLS,
              model: strArg('model'),
              voice: strArg('voice'),
              overrides,
            }),
            inputRate: adapter.inputRate,
          });
        }
        if (op === 'voice_audio') {
          return JSON.stringify({
            message: adapter.audio(strArg('audio') ?? ''),
          });
        }
        if (op === 'voice_text') {
          return JSON.stringify({
            messages: adapter.text(
              strArg('text') ?? '',
              typeof req['respond'] === 'boolean'
                ? (req['respond'] as boolean)
                : true,
            ),
          });
        }
        if (op === 'voice_tool_result') {
          const rawOut = req['output'];
          if (provider === 'gemini-live') {
            return origJsonStringify({
              messages: [
                {
                  toolResponse: {
                    functionResponses: [
                      {
                        id: strArg('id') ?? '',
                        name: strArg('name') ?? '',
                        response: rawOut ?? null,
                      },
                    ],
                  },
                },
              ],
            });
          }
          return origJsonStringify({
            messages: [
              {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: strArg('id') ?? '',
                  output: origJsonStringify(rawOut ?? null),
                },
              },
              {type: 'response.create'},
            ],
          });
        }
        if (op === 'voice_parse') {
          const msg =
            req['message'] &&
            typeof req['message'] === 'object' &&
            !Array.isArray(req['message'])
              ? (req['message'] as Record<string, unknown>)
              : {};
          return JSON.stringify({events: adapter.parse(msg)});
        }
        if (op === 'voice_tools') {
          return JSON.stringify({
            tools: VOICE_TOOLS,
            instructions: VOICE_BASE_INSTRUCTIONS,
          });
        }
      }
      return JSON.stringify({error: `unknown op '${op}'`});
    }
  }
}
