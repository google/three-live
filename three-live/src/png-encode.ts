/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Shared RGBA8 -> `data:image/png;base64,...` encoder used by
 * `THREE.DataTexture` (core) and `THREE.CanvasTexture` (procedural add-on).
 *
 * Emits multi-block stored-DEFLATE PNGs (any size up to `maxDim`, box-filtered
 * when larger) that the worker's async PNG deflater and the GLB/USDZ exporters
 * already understand, and computes the linear-space average color used for
 * untextured fallbacks. Uses the native Rust accelerator
 * (`__three_live_native_encode_rgba_png__`) when the Boa host provides it.
 */

import {calculateCRC32} from './three-convert';

/** Default backing size for `CanvasTexture` bakes. */
export const PNG_DEFAULT_BACKING_DIM = 512;

/** Hard per-axis cap for baked texture PNGs (matches `CanvasTexture`). */
export const PNG_MAX_TEXTURE_DIM = 2048;

/** Encoded PNG data URI plus its linear-space RGBA average color. */
export interface PngDataUri {
  uri: string;
  avgColor: [number, number, number, number];
}

const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const SRGB_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

/** Optional native Rust accelerator installed by the Boa host. */
// tslint:disable-next-line:no-any Native host callable.
function nativePngEncoder(): any {
  return typeof globalThis !== 'undefined'
    ? (globalThis as Record<string, unknown>)[
        '__three_live_native_encode_rgba_png__'
      ]
    : undefined;
}

/**
 * Encodes an RGBA8 buffer (`srcW x srcH`) into a multi-block stored-DEFLATE
 * `data:image/png;base64,...` URI (capped at `maxDim` with box-filter
 * downsampling when oversized) and computes linear `avgColor`.
 */
export function encodeRgbaToPngDataUri(
  srcData: ArrayLike<number>,
  srcW: number,
  srcH: number,
  flipY: boolean,
  isLinearColorSpace: boolean,
  maxDim = PNG_DEFAULT_BACKING_DIM,
): PngDataUri {
  if (
    !srcData ||
    srcW <= 0 ||
    srcH <= 0 ||
    srcData.length < srcW * srcH * 4
  ) {
    return {uri: '', avgColor: [1, 1, 1, 1]};
  }
  const nativeEncodeRgbaPng = nativePngEncoder();
  if (typeof nativeEncodeRgbaPng === 'function') {
    const res = nativeEncodeRgbaPng(
      srcData,
      srcW,
      srcH,
      flipY,
      isLinearColorSpace,
      maxDim,
    );
    if (Array.isArray(res) && typeof res[0] === 'string') {
      return {uri: res[0], avgColor: [res[1], res[2], res[3], res[4]]};
    }
  }
  const scale =
    srcW > maxDim || srcH > maxDim ? maxDim / Math.max(srcW, srcH) : 1;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));
  const stride = 1 + dstW * 4;
  const rawLen = dstH * stride;
  const numBlocks = Math.max(1, Math.ceil(rawLen / 65535));
  const idatLen = 2 + numBlocks * 5 + rawLen + 4;
  // 8 (PNG sig) + 25 (IHDR) + (12 + idatLen) (IDAT) + 12 (IEND)
  const png = new Uint8Array(57 + idatLen);
  const dv = new DataView(png.buffer);
  dv.setUint32(0, 0x89504e47);
  dv.setUint32(4, 0x0d0a1a0a);
  dv.setUint32(8, 13);
  dv.setUint32(12, 0x49484452); // IHDR
  dv.setUint32(16, dstW);
  dv.setUint32(20, dstH);
  png[24] = 8;
  png[25] = 6;
  dv.setUint32(29, calculateCRC32(png.subarray(12, 29)));

  dv.setUint32(33, idatLen);
  dv.setUint32(37, 0x49444154); // IDAT
  png[41] = 0x78;
  png[42] = 0x01;

  // Build raw scanlines first, then chunk into <=65535-byte stored DEFLATE blocks.
  const raw = new Uint8Array(rawLen);
  let rp = 0;
  let s1 = 1;
  let s2 = 0;
  let sumLinR = 0;
  let sumLinG = 0;
  let sumLinB = 0;
  let sumA = 0;
  const exact1to1 = dstW === srcW && dstH === srcH;

  for (let y = 0; y < dstH; y++) {
    raw[rp++] = 0;
    s2 = (s2 + s1) % 65521;
    const py = flipY ? dstH - 1 - y : y;
    const sy0 = exact1to1 ? py : Math.floor((py * srcH) / dstH);
    const sy1 = exact1to1
      ? py + 1
      : Math.max(sy0 + 1, Math.floor(((py + 1) * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (exact1to1) {
        const idx = (sy0 * srcW + x) * 4;
        r = srcData[idx] | 0;
        g = srcData[idx + 1] | 0;
        b = srcData[idx + 2] | 0;
        a = srcData[idx + 3] | 0;
      } else {
        const sx0 = Math.floor((x * srcW) / dstW);
        const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * srcW) / dstW));
        let cnt = 0;
        for (let yy = sy0; yy < sy1 && yy < srcH; yy++) {
          for (let xx = sx0; xx < sx1 && xx < srcW; xx++) {
            const idx = (yy * srcW + xx) * 4;
            r += srcData[idx] | 0;
            g += srcData[idx + 1] | 0;
            b += srcData[idx + 2] | 0;
            a += srcData[idx + 3] | 0;
            cnt++;
          }
        }
        if (cnt > 1) {
          r = (r / cnt + 0.5) | 0;
          g = (g / cnt + 0.5) | 0;
          b = (b / cnt + 0.5) | 0;
          a = (a / cnt + 0.5) | 0;
        }
      }
      raw[rp++] = r;
      s1 += r;
      s2 += s1;
      raw[rp++] = g;
      s1 += g;
      s2 += s1;
      raw[rp++] = b;
      s1 += b;
      s2 += s1;
      raw[rp++] = a;
      s1 += a;
      s2 += s1;
      sumLinR += isLinearColorSpace ? r / 255 : SRGB_LUT[r];
      sumLinG += isLinearColorSpace ? g / 255 : SRGB_LUT[g];
      sumLinB += isLinearColorSpace ? b / 255 : SRGB_LUT[b];
      sumA += a / 255;
    }
    s1 %= 65521;
    s2 %= 65521;
  }

  let wp = 43;
  let rem = rawLen;
  let roff = 0;
  while (rem > 0 || roff === 0) {
    const blkLen = Math.min(65535, rem);
    const isFinal = rem - blkLen === 0 ? 1 : 0;
    png[wp++] = isFinal;
    dv.setUint16(wp, blkLen, true);
    dv.setUint16(wp + 2, ~blkLen & 0xffff, true);
    wp += 4;
    if (blkLen > 0) {
      png.set(raw.subarray(roff, roff + blkLen), wp);
      wp += blkLen;
      roff += blkLen;
      rem -= blkLen;
    }
    if (isFinal) break;
  }
  dv.setUint32(wp, ((s2 << 16) | s1) >>> 0);
  wp += 4;
  dv.setUint32(wp, calculateCRC32(png.subarray(37, wp)));
  wp += 4;
  dv.setUint32(wp, 0);
  dv.setUint32(wp + 4, 0x49454e44); // IEND
  dv.setUint32(wp + 8, 0xae426082);

  const nPx = Math.max(1, dstW * dstH);
  const avgColor: PngDataUri['avgColor'] = [
    sumLinR / nPx,
    sumLinG / nPx,
    sumLinB / nPx,
    sumA / nPx,
  ];
  const parts: string[] = ['data:image/png;base64,'];
  for (let i = 0; i < png.length; i += 3) {
    const n = (png[i] << 16) | ((png[i + 1] ?? 0) << 8) | (png[i + 2] ?? 0);
    parts.push(
      B64_CHARS[(n >> 18) & 63] +
        B64_CHARS[(n >> 12) & 63] +
        (i + 1 < png.length ? B64_CHARS[(n >> 6) & 63] : '=') +
        (i + 2 < png.length ? B64_CHARS[n & 63] : '='),
    );
  }
  return {uri: parts.join(''), avgColor};
}
