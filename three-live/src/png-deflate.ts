/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Async PNG / GLB texture compressor (see {@link makePngDeflater}). */
export interface PngDeflater {
  /**
   * Re-encodes a stored-DEFLATE 8-bit RGBA PNG (what the synchronous in-engine
   * encoders write) with adaptive filtering and DEFLATE. Resolves to the input
   * when it is not such a PNG or would not shrink.
   */
  png(bytes: Uint8Array): Promise<Uint8Array>;
  /**
   * Applies {@link PngDeflater.png} to every PNG image of a GLB, moving
   * `data:image/png` URI images into the BIN chunk.
   */
  glb(bytes: Uint8Array): Promise<Uint8Array>;
}

/**
 * Builds a {@link PngDeflater} on top of `CompressionStream('deflate')`, or
 * returns null when the platform has none.
 *
 * Self-contained on purpose: the sandbox worker receives it through
 * `Function.prototype.toString`, so it may reference nothing from module scope
 * and avoids syntax that compilers lower into module-level helpers (async
 * functions, spread, `for...of`).
 */
export function makePngDeflater(
  // tslint:disable-next-line:no-any CompressionStream constructor (or undefined).
  CS: any,
): PngDeflater | null {
  if (typeof CS !== 'function') return null;
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (b: Uint8Array, start: number, end: number): number => {
    let c = 0xffffffff;
    for (let i = start; i < end; i++)
      c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (b: Uint8Array, o: number): number =>
    ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const put32 = (b: Uint8Array, o: number, v: number): void => {
    b[o] = v >>> 24;
    b[o + 1] = (v >>> 16) & 255;
    b[o + 2] = (v >>> 8) & 255;
    b[o + 3] = v & 255;
  };

  const deflate = (raw: Uint8Array): Promise<Uint8Array> => {
    const cs = new CS('deflate');
    const writer = cs.writable.getWriter();
    writer.write(raw).catch(() => {});
    writer.close().catch(() => {});
    const reader = cs.readable.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    const pump = (): Promise<Uint8Array> =>
      reader.read().then((r: {done: boolean; value?: Uint8Array}) => {
        if (r.done) {
          const out = new Uint8Array(total);
          let o = 0;
          for (let i = 0; i < parts.length; i++) {
            out.set(parts[i], o);
            o += parts[i].length;
          }
          return out;
        }
        if (r.value) {
          parts.push(r.value);
          total += r.value.length;
        }
        return pump();
      });
    return pump();
  };

  // Scanlines (filter byte 0) of a stored-DEFLATE 8-bit RGBA PNG, else null.
  const storedScanlines = (
    png: Uint8Array,
  ): {w: number; h: number; raw: Uint8Array} | null => {
    if (
      png.length < 45 ||
      u32(png, 0) !== 0x89504e47 ||
      u32(png, 12) !== 0x49484452
    ) {
      return null;
    }
    const w = u32(png, 16);
    const h = u32(png, 20);
    if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0 || !w || !h)
      return null;
    if (w > 4096 || h > 4096) return null;
    const stride = 1 + w * 4;
    const raw = new Uint8Array(stride * h);
    let rp = 0;
    let pos = 33;
    let z = -2; // zlib header bytes still to skip
    let blockLeft = 0;
    let hdr: number[] = [];
    let final = false;
    while (pos + 8 <= png.length && !final) {
      const len = u32(png, pos);
      const type = u32(png, pos + 4);
      const ds = pos + 8;
      const de = ds + len;
      if (de + 4 > png.length) return null;
      if (type === 0x49444154) {
        for (let i = ds; i < de && !final; ) {
          if (z < 0) {
            z++;
            i++;
          } else if (blockLeft > 0) {
            const n = Math.min(blockLeft, de - i);
            if (rp + n > raw.length) return null;
            raw.set(png.subarray(i, i + n), rp);
            rp += n;
            i += n;
            blockLeft -= n;
            if (blockLeft === 0 && hdr[0] & 1) final = true;
          } else {
            hdr.push(png[i++]);
            if (hdr.length === 1 && (hdr[0] >> 1) & 3) return null; // not stored
            if (hdr.length === 5) {
              const l = hdr[1] | (hdr[2] << 8);
              if ((l ^ (hdr[3] | (hdr[4] << 8))) !== 0xffff) return null;
              blockLeft = l;
              if (l === 0) {
                if (hdr[0] & 1) final = true;
                hdr = [];
              }
            }
          }
          if (blockLeft === 0 && hdr.length === 5) hdr = [];
        }
      } else if (type === 0x49454e44) {
        break;
      }
      pos = de + 4;
    }
    if (rp !== raw.length) return null;
    for (let y = 0; y < h; y++) if (raw[y * stride] !== 0) return null;
    return {w, h, raw};
  };

  // Per-row adaptive filter (None / Sub / Up / Paeth, minimum sum of |signed|).
  const filterRows = (raw: Uint8Array, w: number, h: number): Uint8Array => {
    const rb = w * 4;
    const stride = rb + 1;
    const out = new Uint8Array(raw.length);
    const cand = new Uint8Array(rb);
    const best = new Uint8Array(rb);
    for (let y = 0; y < h; y++) {
      const cur = y * stride + 1;
      const prev = cur - stride;
      let bestFt = 0;
      let bestScore = Infinity;
      for (let ft = 0; ft < 5; ft++) {
        if (ft === 3 || ((ft === 2 || ft === 4) && y === 0)) continue;
        let score = 0;
        for (let i = 0; i < rb; i++) {
          const a = i >= 4 ? raw[cur + i - 4] : 0;
          const b = y > 0 ? raw[prev + i] : 0;
          let p = 0;
          if (ft === 1) p = a;
          else if (ft === 2) p = b;
          else if (ft === 4) {
            const c = i >= 4 && y > 0 ? raw[prev + i - 4] : 0;
            const pp = a + b - c;
            const pa = Math.abs(pp - a);
            const pb = Math.abs(pp - b);
            const pc = Math.abs(pp - c);
            p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          }
          const v = (raw[cur + i] - p) & 255;
          cand[i] = v;
          score += v < 128 ? v : 256 - v;
        }
        if (score < bestScore) {
          bestScore = score;
          bestFt = ft;
          best.set(cand);
        }
      }
      out[y * stride] = bestFt;
      out.set(best, cur);
    }
    return out;
  };

  const png = (bytes: Uint8Array): Promise<Uint8Array> => {
    let parsed: {w: number; h: number; raw: Uint8Array} | null = null;
    try {
      parsed = storedScanlines(bytes);
    } catch {
      parsed = null;
    }
    if (!parsed) return Promise.resolve(bytes);
    const {w, h, raw} = parsed;
    return deflate(filterRows(raw, w, h)).then(
      (z) => {
        const outLen = 33 + 12 + z.length + 12;
        if (outLen >= bytes.length) return bytes;
        const out = new Uint8Array(outLen);
        out.set(bytes.subarray(0, 33), 0); // signature + IHDR
        put32(out, 33, z.length);
        put32(out, 37, 0x49444154);
        out.set(z, 41);
        put32(out, 41 + z.length, crc32(out, 37, 41 + z.length));
        const e = 45 + z.length;
        put32(out, e, 0);
        put32(out, e + 4, 0x49454e44);
        put32(out, e + 8, 0xae426082);
        return out;
      },
      () => bytes,
    );
  };

  const b64Table = new Int16Array(128).fill(-1);
  const b64Chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i++) b64Table[b64Chars.charCodeAt(i)] = i;
  const b64 = (str: string): Uint8Array | null => {
    let len = str.length;
    while (len > 0 && str.charCodeAt(len - 1) === 61) len--; // '='
    const out = new Uint8Array(Math.floor((len * 3) / 4));
    let acc = 0;
    let bits = 0;
    let o = 0;
    for (let i = 0; i < len; i++) {
      const c = str.charCodeAt(i);
      const v = c < 128 ? b64Table[c] : -1;
      if (v < 0) return null;
      acc = ((acc << 6) | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 255;
      }
    }
    return o === out.length ? out : null;
  };

  // Embedded PNGs are DEFLATEd; `data:image/png` URI images also move into the
  // BIN chunk (a quarter smaller than base64).
  const glb = (bytes: Uint8Array): Promise<Uint8Array> => {
    const le32 = (b: Uint8Array, o: number) =>
      (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    const setLe32 = (b: Uint8Array, o: number, v: number) => {
      b[o] = v & 255;
      b[o + 1] = (v >>> 8) & 255;
      b[o + 2] = (v >>> 16) & 255;
      b[o + 3] = v >>> 24;
    };
    // tslint:disable-next-line:no-any Parsed glTF JSON.
    let gltf: any;
    let bin = new Uint8Array(0);
    try {
      if (bytes.length < 20 || le32(bytes, 0) !== 0x46546c67) {
        return Promise.resolve(bytes);
      }
      const total = Math.min(bytes.length, le32(bytes, 8));
      const jsonLen = le32(bytes, 12);
      if (le32(bytes, 16) !== 0x4e4f534a || 20 + jsonLen > total) {
        return Promise.resolve(bytes);
      }
      gltf = JSON.parse(
        new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)),
      );
      const bo = 20 + jsonLen;
      if (bo + 8 <= total) {
        const binLen = le32(bytes, bo);
        if (le32(bytes, bo + 4) !== 0x004e4942 || bo + 8 + binLen > total) {
          return Promise.resolve(bytes);
        }
        bin = bytes.subarray(bo + 8, bo + 8 + binLen);
      }
    } catch {
      return Promise.resolve(bytes);
    }
    if (!gltf || typeof gltf !== 'object') return Promise.resolve(bytes);
    const views = Array.isArray(gltf.bufferViews) ? gltf.bufferViews : [];
    const images = Array.isArray(gltf.images) ? gltf.images : [];
    const viewTargets: number[] = [];
    const uriImages: number[] = [];
    const uriBytes: Uint8Array[] = [];
    const prefix = 'data:image/png;base64,';
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      if (!im || typeof im !== 'object') continue;
      const v = views[im.bufferView];
      if (typeof im.uri === 'string' && im.uri.indexOf(prefix) === 0) {
        const raw = b64(im.uri.slice(prefix.length));
        if (raw) {
          uriImages.push(i);
          uriBytes.push(raw);
        }
      } else if (
        im.mimeType === 'image/png' &&
        v &&
        (v.buffer || 0) === 0 &&
        viewTargets.indexOf(im.bufferView) < 0
      ) {
        viewTargets.push(im.bufferView);
      }
    }
    if (!viewTargets.length && !uriImages.length) return Promise.resolve(bytes);
    // Existing views must be disjoint and inside the BIN chunk to be repacked.
    const order: number[] = [];
    for (let i = 0; i < views.length; i++) order.push(i);
    order.sort(
      (a, b) => (views[a].byteOffset || 0) - (views[b].byteOffset || 0),
    );
    let end = 0;
    for (let k = 0; k < order.length; k++) {
      const v = views[order[k]];
      const off = v.byteOffset || 0;
      if (
        typeof v.byteLength !== 'number' ||
        (v.buffer || 0) !== 0 ||
        off < end ||
        off + v.byteLength > bin.length
      ) {
        return Promise.resolve(bytes);
      }
      end = off + v.byteLength;
    }
    const slice = (i: number) => {
      const off = views[i].byteOffset || 0;
      return bin.subarray(off, off + views[i].byteLength);
    };
    const jobs: Array<Promise<Uint8Array>> = [];
    for (let t = 0; t < viewTargets.length; t++) {
      jobs.push(png(slice(viewTargets[t])));
    }
    for (let t = 0; t < uriBytes.length; t++) jobs.push(png(uriBytes[t]));
    return Promise.all(jobs).then((packed) => {
      const data: Uint8Array[] = [];
      for (let i = 0; i < views.length; i++) {
        const t = viewTargets.indexOf(i);
        data.push(t >= 0 ? packed[t] : slice(i));
      }
      let size = 0;
      for (let k = 0; k < order.length; k++) {
        size = ((size + 3) & ~3) + data[order[k]].length;
      }
      for (let t = 0; t < uriImages.length; t++) {
        size = ((size + 3) & ~3) + packed[viewTargets.length + t].length;
      }
      const binLen = (size + 3) & ~3;
      const newBin = new Uint8Array(binLen);
      let o = 0;
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        o = (o + 3) & ~3;
        newBin.set(data[i], o);
        views[i].byteOffset = o;
        views[i].byteLength = data[i].length;
        o += data[i].length;
      }
      for (let t = 0; t < uriImages.length; t++) {
        const d = packed[viewTargets.length + t];
        o = (o + 3) & ~3;
        newBin.set(d, o);
        const im = images[uriImages[t]];
        delete im.uri;
        im.mimeType = 'image/png';
        im.bufferView = views.length;
        views.push({buffer: 0, byteOffset: o, byteLength: d.length});
        o += d.length;
      }
      gltf.bufferViews = views;
      if (!Array.isArray(gltf.buffers) || !gltf.buffers.length) {
        gltf.buffers = [{byteLength: binLen}];
      } else {
        gltf.buffers[0].byteLength = binLen;
      }
      let json = new TextEncoder().encode(JSON.stringify(gltf));
      const jsonLen = (json.length + 3) & ~3;
      if (jsonLen !== json.length) {
        const padded = new Uint8Array(jsonLen).fill(0x20);
        padded.set(json);
        json = padded;
      }
      const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
      setLe32(out, 0, 0x46546c67);
      setLe32(out, 4, 2);
      setLe32(out, 8, out.length);
      setLe32(out, 12, jsonLen);
      setLe32(out, 16, 0x4e4f534a);
      out.set(json, 20);
      setLe32(out, 20 + jsonLen, binLen);
      setLe32(out, 24 + jsonLen, 0x004e4942);
      out.set(newBin, 28 + jsonLen);
      return out.length < bytes.length ? out : bytes;
    });
  };

  return {png, glb};
}
