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

/** Minimal glTF accessor shape read by {@link readAccessorAsFloat32}. */
export interface GltfAccessorLike {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  normalized?: boolean;
  count?: number;
}

const COMPONENT_SIZE: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

/**
 * Reads `comps` components per element of a glTF accessor as `Float32Array`,
 * honoring `componentType`, `normalized` (glTF dequantization rules, as used
 * by `KHR_mesh_quantization` / gltfpack), and the bufferView `byteStride`.
 *
 * Tightly packed, 4-byte-aligned FLOAT accessors are returned as a zero-copy
 * view of `bin`. Returns `null` for accessors without a bufferView (or with
 * zero elements) and throws `RangeError` when the accessor reads past `bin`.
 */
export function readAccessorAsFloat32(
  gltf: {bufferViews?: Array<{byteOffset?: number; byteStride?: number}>},
  bin: ArrayBuffer,
  acc: GltfAccessorLike | null | undefined,
  comps: number,
): Float32Array | null {
  if (!acc || acc.bufferView === undefined) return null;
  const bv = gltf.bufferViews?.[acc.bufferView];
  if (!bv) return null;
  const count = Number(acc.count ?? 0);
  if (!Number.isInteger(count) || count <= 0) return null;
  const ct = acc.componentType ?? 5126;
  const size = COMPONENT_SIZE[ct];
  if (!size) {
    throw new RangeError(`glTF accessor has unsupported componentType ${ct}`);
  }
  const elem = size * comps;
  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elem;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (
    !Number.isInteger(base) ||
    base < 0 ||
    stride < elem ||
    base + (count - 1) * stride + elem > bin.byteLength
  ) {
    throw new RangeError(
      `glTF accessor reads past the end of the binary buffer (${bin.byteLength} bytes)`,
    );
  }
  if (ct === 5126 && stride === elem && base % 4 === 0) {
    return new Float32Array(bin, base, count * comps);
  }
  const dv = new DataView(bin);
  const norm = acc.normalized === true;
  const out = new Float32Array(count * comps);
  for (let i = 0; i < count; i++) {
    const row = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const o = row + c * size;
      let v: number;
      switch (ct) {
        case 5126:
          v = dv.getFloat32(o, true);
          break;
        case 5120:
          v = dv.getInt8(o);
          if (norm) v = Math.max(v / 127, -1);
          break;
        case 5121:
          v = dv.getUint8(o);
          if (norm) v /= 255;
          break;
        case 5122:
          v = dv.getInt16(o, true);
          if (norm) v = Math.max(v / 32767, -1);
          break;
        case 5123:
          v = dv.getUint16(o, true);
          if (norm) v /= 65535;
          break;
        default:
          v = dv.getUint32(o, true);
          if (norm) v /= 4294967295;
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

/** `KHR_texture_transform` parameters on a glTF `textureInfo`. */
export interface TextureTransformLike {
  offset?: number[];
  rotation?: number;
  scale?: number[];
}

/**
 * Bakes a `KHR_texture_transform` into interleaved `uv` pairs in place, in the
 * spec order `T * R * S` (scale, then rotate, then offset) that three.js
 * `GLTFLoader` also applies. Non-finite components fall back to identity.
 */
export function applyTextureTransform(
  uv: Float32Array,
  t: TextureTransformLike,
): void {
  const fin = (v: unknown, d: number): number => {
    const n = Number(v ?? d);
    return Number.isFinite(n) ? n : d;
  };
  const ox = fin(t.offset?.[0], 0);
  const oy = fin(t.offset?.[1], 0);
  const sx = fin(t.scale?.[0], 1);
  const sy = fin(t.scale?.[1], 1);
  const r = fin(t.rotation, 0);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const a = c * sx;
  const b = s * sy;
  const d = -s * sx;
  const e = c * sy;
  for (let i = 0; i + 1 < uv.length; i += 2) {
    const u = uv[i]!;
    const v = uv[i + 1]!;
    uv[i] = a * u + b * v + ox;
    uv[i + 1] = d * u + e * v + oy;
  }
}

/** Rounds float noise (e.g. `cos(PI/2)`) so identity checks stay exact. */
function cleanUv(v: number): number {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
}

/**
 * Converts three.js `Texture` UV parameters (`offset`, `repeat`, `rotation`,
 * `center`) into a `KHR_texture_transform`, folding `center` into `offset`.
 * The result reproduces three.js `Matrix3.setUvTransform` exactly when
 * `repeat.x === repeat.y`, `rotation` is 0, or `rotation` is a quarter turn
 * (the scale components swap). three.js scales after rotating while glTF
 * scales first, so other non-uniform rotated textures export with
 * `scale = repeat`, like three.js `GLTFExporter`. Returns `null` for identity
 * transforms, non-texture values, and non-finite components.
 */
export function textureTransformOf(tex: unknown): TextureTransformLike | null {
  if (!tex || typeof tex !== 'object') return null;
  const t = tex as {
    offset?: {x?: unknown; y?: unknown};
    repeat?: {x?: unknown; y?: unknown};
    center?: {x?: unknown; y?: unknown};
    rotation?: unknown;
  };
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d;
  const sx = num(t.repeat?.x, 1);
  const sy = num(t.repeat?.y, 1);
  const r = num(t.rotation, 0);
  const cx = num(t.center?.x, 0);
  const cy = num(t.center?.y, 0);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const ox = cleanUv(-sx * (c * cx + s * cy) + cx + num(t.offset?.x, 0));
  const oy = cleanUv(-sy * (-s * cx + c * cy) + cy + num(t.offset?.y, 0));
  // diag(sx, sy) * R(r) equals R(r) * diag(sy, sx) for odd quarter turns.
  const [gx, gy] = cleanUv(c) === 0 ? [sy, sx] : [sx, sy];
  const out: TextureTransformLike = {};
  if (ox !== 0 || oy !== 0) out.offset = [ox, oy];
  if (cleanUv(r) !== 0) out.rotation = r;
  if (gx !== 1 || gy !== 1) out.scale = [gx, gy];
  return out.offset || out.rotation !== undefined || out.scale ? out : null;
}

/**
 * Returns the `KHR_texture_transform` of a glTF material (base color first,
 * then the other PBR textures). Renderers that bake the transform into
 * `TEXCOORD_0` (WebGL2 / WebGPU `ThreeView`, the USDZ exporter, and the
 * native preview renderer) apply this one transform to every texture of the
 * primitive.
 */
export function materialTextureTransform(
  // tslint:disable-next-line:no-any glTF material JSON.
  mat: any,
): TextureTransformLike | null {
  if (!mat || typeof mat !== 'object') return null;
  const infos = [
    mat.pbrMetallicRoughness?.baseColorTexture,
    mat.pbrMetallicRoughness?.metallicRoughnessTexture,
    mat.normalTexture,
    mat.occlusionTexture,
    mat.emissiveTexture,
  ];
  for (const info of infos) {
    const t = info?.extensions?.KHR_texture_transform;
    if (t && typeof t === 'object') return t as TextureTransformLike;
  }
  return null;
}
