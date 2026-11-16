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

//! Stateless, Boa-free C-ABI native geometry, texture, PNG, CRC-32, and USDZ accelerators
//! (`THREE_LIVE_KERNELS_ABI_VERSION = 1`).
//!
//! Host applications that already embed a JavaScript engine (such as Boa, QuickJS,
//! JavaScriptCore, or V8) can link `three_live_kernels` without pulling in a second JS engine
//! and bind all `__three_live_native_*__` hooks generically via [`three_live_kernels_table`].

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::os::raw::c_char;
use std::sync::{Arc, Mutex, OnceLock};

use crate::constants::{
    SECURITY_3D_MAX_HEAP_BYTES, SECURITY_3D_MAX_INDICES, SECURITY_3D_MAX_VERTICES,
};
use crate::geometry::{
    buffers_to_csg_polygons, compute_vertex_normals_slice, csg_polygons_to_geometry, evaluate_csg,
    generate_box, generate_cylinder, generate_plane, generate_sphere, generate_torus,
    generate_torus_knot, NativeGeometry,
};
use crate::material_preset::{
    generate_material_preset, height_to_normal, unit_to_byte, PresetParams, MATERIAL_PRESETS,
};
use crate::usdz::{
    calculate_crc32, decode_b64_image_data_uri, encode_rgba_png_data_uri_impl,
    format_usda_ints_from_bytes, format_usda_points_from_bytes, format_usda_uvs_from_bytes,
    try_build_usdz_zip_refs, ZipEntryRef,
};

/// ABI version of `three_live_kernels.h`.
pub const THREE_LIVE_KERNELS_ABI_VERSION: u32 = 1;

pub const THREE_LIVE_KERNEL_OK: u32 = 0;
pub const THREE_LIVE_KERNEL_ERR_INVALID_ARG: u32 = 1;
pub const THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED: u32 = 2;
pub const THREE_LIVE_KERNEL_ERR_INTERNAL: u32 = 3;

/// Maximum PNG byte size accepted by [`decode_png_rgba`].
pub const MAX_KERNEL_PNG_BYTES: usize = 32 * 1024 * 1024;
/// Maximum PNG dimension accepted by [`decode_png_rgba`].
pub const MAX_KERNEL_PNG_DIM: u32 = 8192;
const MAX_KERNEL_PNG_PIXELS: u64 = 40_000_000;
/// Largest derived normal / ORM map edge (`1024` albedos downsample 2x to `512`).
pub const MAX_DERIVED_MAP_SIZE: usize = 512;
/// `miniz_oxide` DEFLATE level for stored-PNG recompression.
pub const TEXTURE_PNG_LEVEL: u8 = 3;

const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// FNV-1a 64-bit hash.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Encodes arbitrary bytes as standard RFC 4648 base64.
pub fn encode_base64(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(BASE64_TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(BASE64_TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(BASE64_TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Decodes standard RFC 4648 base64 (ignoring ASCII whitespace) up to `max_out` bytes.
pub fn decode_base64_str(b64: &str, max_out: usize) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity((b64.len() / 4 * 3).min(max_out));
    let mut buf = 0u32;
    let mut bits = 0u32;
    let mut seen_pad = false;
    for b in b64.bytes() {
        if b.is_ascii_whitespace() {
            continue;
        }
        if b == b'=' {
            seen_pad = true;
            continue;
        }
        if seen_pad {
            return None;
        }
        let v = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            if out.len() >= max_out {
                return None;
            }
            out.push((buf >> bits) as u8);
        }
    }
    if bits >= 6 || (bits > 0 && ((buf & ((1 << bits) - 1)) != 0)) {
        return None;
    }
    Some(out)
}

/// Decodes a PNG image (all standard color types, bit depths 1/2/4/8/16, `tRNS`, and Adam7
/// interlacing) into `(width, height, rgba_bytes)`.
pub fn decode_png_rgba(png: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let bad = |m: &str| format!("Invalid PNG reference: {}", m);
    if png.len() < 8 || &png[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(bad("missing PNG signature"));
    }
    let mut pos = 8usize;
    let mut ihdr: Option<(u32, u32, u8, u8, u8)> = None;
    let mut idat = Vec::new();
    let mut plte: Vec<[u8; 3]> = Vec::new();
    let mut trns: Vec<u8> = Vec::new();
    while pos + 12 <= png.len() {
        let len = u32::from_be_bytes([png[pos], png[pos + 1], png[pos + 2], png[pos + 3]]) as usize;
        let ctype = &png[pos + 4..pos + 8];
        let start = pos + 8;
        let end = start.checked_add(len).ok_or_else(|| bad("chunk length overflow"))?;
        if end + 4 > png.len() {
            return Err(bad("truncated chunk"));
        }
        let data = &png[start..end];
        match ctype {
            b"IHDR" => {
                if len != 13 {
                    return Err(bad("IHDR length"));
                }
                let w = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                let h = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                ihdr = Some((w, h, data[8], data[9], data[12]));
            }
            b"PLTE" => {
                plte = data.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
            }
            b"tRNS" => trns = data.to_vec(),
            b"IDAT" => {
                if idat.len() + data.len() > MAX_KERNEL_PNG_BYTES {
                    return Err(bad("IDAT too large"));
                }
                idat.extend_from_slice(data);
            }
            b"IEND" => break,
            _ => {}
        }
        pos = end + 4;
    }
    let (w, h, depth, ctype, interlace) = ihdr.ok_or_else(|| bad("missing IHDR"))?;
    if w == 0 || h == 0 {
        return Err("Reference image has zero width or height".to_string());
    }
    if w > MAX_KERNEL_PNG_DIM
        || h > MAX_KERNEL_PNG_DIM
        || (w as u64) * (h as u64) > MAX_KERNEL_PNG_PIXELS
    {
        return Err(format!(
            "Reference image {}x{} is too large (max {} px per side, 40 MP total)",
            w, h, MAX_KERNEL_PNG_DIM
        ));
    }
    let channels: usize = match ctype {
        0 => 1,
        2 => 3,
        3 => 1,
        4 => 2,
        6 => 4,
        _ => return Err(bad("unknown color type")),
    };
    let depth_ok = match ctype {
        0 => matches!(depth, 1 | 2 | 4 | 8 | 16),
        3 => matches!(depth, 1 | 2 | 4 | 8),
        _ => matches!(depth, 8 | 16),
    };
    if !depth_ok {
        return Err(bad("invalid bit depth for color type"));
    }
    if ctype == 3 && plte.is_empty() {
        return Err(bad("palette image without PLTE"));
    }
    if interlace > 1 {
        return Err(bad("unknown interlace method"));
    }
    let (wu, hu) = (w as usize, h as usize);
    let bits_pp = channels * depth as usize;
    let bpp = bits_pp.div_ceil(8).max(1);
    let passes: &[(usize, usize, usize, usize)] = if interlace == 1 {
        &[
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    } else {
        &[(0, 0, 1, 1)]
    };
    let pass_dims: Vec<(usize, usize)> = passes
        .iter()
        .map(|&(x0, y0, dx, dy)| {
            let pw = if wu > x0 { (wu - x0).div_ceil(dx) } else { 0 };
            let ph = if hu > y0 { (hu - y0).div_ceil(dy) } else { 0 };
            (pw, ph)
        })
        .collect();
    let expected: usize = pass_dims
        .iter()
        .filter(|(pw, ph)| *pw > 0 && *ph > 0)
        .map(|&(pw, ph)| ph * (1 + (pw * bits_pp).div_ceil(8)))
        .sum();
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(&idat, expected + 4096)
        .map_err(|_| bad("corrupt or oversized zlib stream"))?;
    if raw.len() < expected {
        return Err(bad("image data is truncated"));
    }

    let max_v = (1u32 << depth) - 1;
    let mut out = vec![0u8; wu * hu * 4];
    let mut off = 0usize;
    for (pi, &(x0, y0, dx, dy)) in passes.iter().enumerate() {
        let (pw, ph) = pass_dims[pi];
        if pw == 0 || ph == 0 {
            continue;
        }
        let row_len = (pw * bits_pp).div_ceil(8);
        let mut prev = vec![0u8; row_len];
        let mut cur = vec![0u8; row_len];
        for ry in 0..ph {
            let ft = raw[off];
            cur.copy_from_slice(&raw[off + 1..off + 1 + row_len]);
            off += 1 + row_len;
            unfilter_png_row(ft, &mut cur, &prev, bpp).map_err(|e| bad(&e))?;
            for rx in 0..pw {
                let px = convert_png_pixel(&cur, rx, ctype, depth, channels, max_v, &plte, &trns);
                let (x, y) = (x0 + rx * dx, y0 + ry * dy);
                let o = (y * wu + x) * 4;
                out[o..o + 4].copy_from_slice(&px);
            }
            std::mem::swap(&mut prev, &mut cur);
        }
    }
    Ok((w, h, out))
}

fn unfilter_png_row(ft: u8, cur: &mut [u8], prev: &[u8], bpp: usize) -> Result<(), String> {
    match ft {
        0 => {}
        1 => {
            for i in bpp..cur.len() {
                cur[i] = cur[i].wrapping_add(cur[i - bpp]);
            }
        }
        2 => {
            for i in 0..cur.len() {
                cur[i] = cur[i].wrapping_add(prev[i]);
            }
        }
        3 => {
            for i in 0..cur.len() {
                let a = if i >= bpp { cur[i - bpp] as u16 } else { 0 };
                cur[i] = cur[i].wrapping_add(((a + prev[i] as u16) / 2) as u8);
            }
        }
        4 => {
            for i in 0..cur.len() {
                let a = if i >= bpp { cur[i - bpp] as i16 } else { 0 };
                let b = prev[i] as i16;
                let c = if i >= bpp { prev[i - bpp] as i16 } else { 0 };
                let p = a + b - c;
                let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
                let pred = if pa <= pb && pa <= pc {
                    a
                } else if pb <= pc {
                    b
                } else {
                    c
                };
                cur[i] = cur[i].wrapping_add(pred as u8);
            }
        }
        _ => return Err(format!("unknown filter type {}", ft)),
    }
    Ok(())
}

#[inline]
fn read_png_sample(row: &[u8], idx: usize, depth: u8) -> u32 {
    match depth {
        8 => row[idx] as u32,
        16 => ((row[idx * 2] as u32) << 8) | row[idx * 2 + 1] as u32,
        _ => {
            let bit = idx * depth as usize;
            let byte = row[bit / 8];
            let shift = 8 - depth as usize - (bit % 8);
            ((byte >> shift) as u32) & ((1u32 << depth) - 1)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn convert_png_pixel(
    row: &[u8],
    x: usize,
    ctype: u8,
    depth: u8,
    channels: usize,
    max_v: u32,
    plte: &[[u8; 3]],
    trns: &[u8],
) -> [u8; 4] {
    let to8 = |v: u32| -> u8 {
        if depth == 16 {
            (v >> 8) as u8
        } else if depth == 8 {
            v as u8
        } else {
            ((v * 255 + max_v / 2) / max_v) as u8
        }
    };
    let base = x * channels;
    match ctype {
        0 => {
            let v = read_png_sample(row, base, depth);
            let key = (trns.len() >= 2).then(|| u16::from_be_bytes([trns[0], trns[1]]) as u32);
            let g = to8(v);
            [g, g, g, if key == Some(v) { 0 } else { 255 }]
        }
        2 => {
            let (r, g, b) = (
                read_png_sample(row, base, depth),
                read_png_sample(row, base + 1, depth),
                read_png_sample(row, base + 2, depth),
            );
            let keyed = trns.len() >= 6
                && r == u16::from_be_bytes([trns[0], trns[1]]) as u32
                && g == u16::from_be_bytes([trns[2], trns[3]]) as u32
                && b == u16::from_be_bytes([trns[4], trns[5]]) as u32;
            [to8(r), to8(g), to8(b), if keyed { 0 } else { 255 }]
        }
        3 => {
            let i = read_png_sample(row, base, depth) as usize;
            let c = plte.get(i).copied().unwrap_or([0, 0, 0]);
            [c[0], c[1], c[2], trns.get(i).copied().unwrap_or(255)]
        }
        4 => {
            let g = to8(read_png_sample(row, base, depth));
            [g, g, g, to8(read_png_sample(row, base + 1, depth))]
        }
        _ => [
            to8(read_png_sample(row, base, depth)),
            to8(read_png_sample(row, base + 1, depth)),
            to8(read_png_sample(row, base + 2, depth)),
            to8(read_png_sample(row, base + 3, depth)),
        ],
    }
}

/// Encodes RGBA8 pixels into a compressed PNG at an explicit `miniz_oxide` level (`1..=9`).
pub fn encode_png_rgba_level(
    width: u32,
    height: u32,
    rgba: &[u8],
    level: u8,
) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("PNG dimensions must be >= 1x1".to_string());
    }
    let w = width as usize;
    let h = height as usize;
    let row_bytes = w.checked_mul(4).ok_or("PNG width overflow")?;
    let needed = row_bytes.checked_mul(h).ok_or("PNG size overflow")?;
    if rgba.len() < needed {
        return Err(format!(
            "RGBA buffer too small for {}x{} PNG ({} < {})",
            w,
            h,
            rgba.len(),
            needed
        ));
    }
    let mut raw = Vec::with_capacity(h * (1 + row_bytes));
    let mut cand = vec![0u8; row_bytes];
    let mut best = vec![0u8; row_bytes];
    for y in 0..h {
        let cur = &rgba[y * row_bytes..(y + 1) * row_bytes];
        let prev = if y > 0 { Some(&rgba[(y - 1) * row_bytes..y * row_bytes]) } else { None };
        let mut best_ft = 0u8;
        let mut best_score = u64::MAX;
        for ft in 0u8..5 {
            if ft >= 2 && prev.is_none() && ft != 4 {
                continue;
            }
            let mut score = 0u64;
            for i in 0..row_bytes {
                let a = if i >= 4 { cur[i - 4] as i16 } else { 0 };
                let b = prev.map(|p| p[i] as i16).unwrap_or(0);
                let c = if i >= 4 { prev.map(|p| p[i - 4] as i16).unwrap_or(0) } else { 0 };
                let pred = match ft {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => (a + b) / 2,
                    _ => {
                        let pp = a + b - c;
                        let (pa, pb, pc) = ((pp - a).abs(), (pp - b).abs(), (pp - c).abs());
                        if pa <= pb && pa <= pc {
                            a
                        } else if pb <= pc {
                            b
                        } else {
                            c
                        }
                    }
                };
                let v = (cur[i] as i16 - pred) as u8;
                cand[i] = v;
                score += (v as i8).unsigned_abs() as u64;
            }
            if score < best_score {
                best_score = score;
                best_ft = ft;
                best.copy_from_slice(&cand);
            }
        }
        raw.push(best_ft);
        raw.extend_from_slice(&best);
    }
    let zlib = miniz_oxide::deflate::compress_to_vec_zlib(&raw, level.clamp(1, 9));

    let mut png = Vec::with_capacity(64 + zlib.len());
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    let write_chunk = |out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let crc_start = out.len();
        out.extend_from_slice(chunk_type);
        out.extend_from_slice(data);
        let crc = calculate_crc32(&out[crc_start..]);
        out.extend_from_slice(&crc.to_be_bytes());
    };
    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&width.to_be_bytes());
    ihdr[4..8].copy_from_slice(&height.to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 6;
    write_chunk(&mut png, b"IHDR", &ihdr);
    write_chunk(&mut png, b"IDAT", &zlib);
    write_chunk(&mut png, b"IEND", &[]);
    Ok(png)
}

/// Re-encodes an 8-bit RGBA PNG whose zlib stream starts with a stored (uncompressed) DEFLATE
/// block with adaptive filtering and DEFLATE. Returns `None` when already compressed, not 8-bit
/// RGBA, or when re-encoding would not shrink it.
pub fn recompress_stored_png(png: &[u8]) -> Option<Vec<u8>> {
    if png.len() < 33 || &png[0..8] != b"\x89PNG\r\n\x1a\n" || &png[12..16] != b"IHDR" {
        return None;
    }
    if png[24] != 8 || png[25] != 6 || png[28] != 0 {
        return None;
    }
    let mut pos = 8usize;
    let mut first_block = None;
    while pos + 12 <= png.len() {
        let len = u32::from_be_bytes([png[pos], png[pos + 1], png[pos + 2], png[pos + 3]]) as usize;
        if &png[pos + 4..pos + 8] == b"IDAT" {
            if len >= 3 && pos + 8 + 3 <= png.len() {
                first_block = Some(png[pos + 10]);
            }
            break;
        }
        pos = pos.checked_add(12 + len)?;
    }
    if (first_block? >> 1) & 3 != 0 {
        return None;
    }
    let (w, h, rgba) = decode_png_rgba(png).ok()?;
    let out = encode_png_rgba_level(w, h, &rgba, TEXTURE_PNG_LEVEL).ok()?;
    (out.len() < png.len()).then_some(out)
}

thread_local! {
    static PNG_URI_CACHE: RefCell<Vec<((u64, usize), Arc<str>)>> = const { RefCell::new(Vec::new()) };
}
const PNG_URI_CACHE_ENTRIES: usize = 24;

/// [`recompress_stored_png`] for a `data:image/png;base64,...` URI (cached per thread).
pub fn compress_png_data_uri(uri: &str) -> Arc<str> {
    let Some(b64) = uri.strip_prefix("data:image/png;base64,") else {
        return Arc::from(uri);
    };
    let id = (fnv1a64(uri.as_bytes()), uri.len());
    if let Some(hit) =
        PNG_URI_CACHE.with(|c| c.borrow().iter().find(|(k, _)| *k == id).map(|(_, v)| v.clone()))
    {
        return hit;
    }
    let out: Arc<str> = decode_base64_str(b64, 17 * 1024 * 1024)
        .and_then(|png| recompress_stored_png(&png))
        .map(|png| Arc::from(format!("data:image/png;base64,{}", encode_base64(&png))))
        .unwrap_or_else(|| Arc::from(uri));
    PNG_URI_CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= PNG_URI_CACHE_ENTRIES {
            c.remove(0);
        }
        c.push((id, out.clone()));
    });
    out
}

/// Edge length of the normal / ORM maps derived from an `n x n` albedo.
pub fn derived_map_size(n: usize) -> usize {
    if n > MAX_DERIVED_MAP_SIZE && n.is_multiple_of(2) {
        n / 2
    } else {
        n
    }
}

/// Exact 2x2 box downsample of an even `n x n` RGBA8 image (`(a + b + c + d + 2) >> 2`).
pub fn box_downsample_2x(rgba: &[u8], n: usize) -> Vec<u8> {
    let m = n / 2;
    let mut out = vec![0u8; m * m * 4];
    for y in 0..m {
        for x in 0..m {
            let i0 = (2 * y * n + 2 * x) * 4;
            let i1 = i0 + n * 4;
            let o = (y * m + x) * 4;
            for c in 0..4 {
                let s = rgba[i0 + c] as u32
                    + rgba[i0 + 4 + c] as u32
                    + rgba[i1 + c] as u32
                    + rgba[i1 + 4 + c] as u32;
                out[o + c] = ((s + 2) >> 2) as u8;
            }
        }
    }
    out
}

#[inline]
fn clamp_unit(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Derives `(normal, orm)` RGBA8 maps from a seamless `n x n` sRGB albedo, matching the JS
/// kernels in `three-live/src/plugins/procedural.ts` bit-for-bit.
pub fn derive_texture_maps(
    albedo: &[u8],
    n: usize,
    normal_strength: f64,
    roughness: f64,
    metalness: f64,
) -> (Vec<u8>, Vec<u8>) {
    assert_eq!(albedo.len(), n * n * 4, "albedo must be n*n*4 bytes");
    if derived_map_size(n) != n {
        let half = box_downsample_2x(albedo, n);
        return derive_texture_maps(&half, n / 2, normal_strength, roughness, metalness);
    }
    let mut lum = vec![0i64; n * n];
    for (i, l) in lum.iter_mut().enumerate() {
        let o = i * 4;
        *l = 2126 * albedo[o] as i64 + 7152 * albedo[o + 1] as i64 + 722 * albedo[o + 2] as i64;
    }
    let r = 4usize.min(n.saturating_sub(1) / 2);
    let mut hsum = vec![0i64; n * n];
    for y in 0..n {
        for x in 0..n {
            let mut s = 0i64;
            for d in 0..=2 * r {
                s += lum[y * n + (x + n + d - r) % n];
            }
            hsum[y * n + x] = s;
        }
    }
    let taps = ((2 * r + 1) * (2 * r + 1)) as i64;
    let mut hp = vec![0i64; n * n];
    let (mut lo, mut hi) = (i64::MAX, i64::MIN);
    for y in 0..n {
        for x in 0..n {
            let mut s = 0i64;
            for d in 0..=2 * r {
                s += hsum[((y + n + d - r) % n) * n + x];
            }
            let v = taps * lum[y * n + x] - s;
            hp[y * n + x] = v;
            lo = lo.min(v);
            hi = hi.max(v);
        }
    }
    let range = hi - lo;
    let height: Vec<f64> =
        hp.iter().map(|&v| if range == 0 { 0.5 } else { (v - lo) as f64 / range as f64 }).collect();
    let ns = if normal_strength.is_finite() { normal_strength.clamp(0.0, 8.0) } else { 1.0 };
    let normal = height_to_normal(&height, n, ns);
    let rough = clamp_unit(roughness);
    let metal = unit_to_byte(clamp_unit(metalness));
    let mut orm = vec![0u8; n * n * 4];
    for (i, h) in height.iter().enumerate() {
        let o = i * 4;
        orm[o] = 255;
        orm[o + 1] = unit_to_byte(rough + 0.35 * (0.5 - h));
        orm[o + 2] = metal;
        orm[o + 3] = 255;
    }
    (normal, orm)
}

/// Seam-blends an `n x n` RGBA8 image across opposite wrap edges (`n / 8` band).
pub fn seam_blend(rgba: &[u8], n: usize) -> Vec<u8> {
    let band = (n / 8).max(1) as f64;
    let half = n / 2;
    let smooth = |t: f64| {
        let t = t.clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    };
    let mut out = vec![0u8; n * n * 4];
    for y in 0..n {
        let dy = (y.min(n - 1 - y) as f64 + 0.5) / band;
        for x in 0..n {
            let dx = (x.min(n - 1 - x) as f64 + 0.5) / band;
            let w = 1.0 - smooth(dx.min(dy));
            let o = (y * n + x) * 4;
            let s = (((y + half) % n) * n + (x + half) % n) * 4;
            for c in 0..3 {
                let a = rgba[o + c] as f64;
                let b = rgba[s + c] as f64;
                out[o + c] = (a + (b - a) * w + 0.5).floor().clamp(0.0, 255.0) as u8;
            }
            out[o + 3] = 255;
        }
    }
    out
}

// =============================================================================================
// C-ABI Types, Ownership-Tracked Buffer Allocator, and Table Descriptors
// =============================================================================================

/// Borrowed byte slice passed into a C-ABI kernel.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ThreeLiveKernelSlice {
    pub data: *const u8,
    pub len: usize,
}

impl ThreeLiveKernelSlice {
    /// Converts into a safe Rust byte slice (empty when `len == 0`, `data.is_null()`, or
    /// `len > isize::MAX as usize`). Prefer [`Self::as_bytes_capped`] in FFI entrypoints.
    ///
    /// # Safety
    /// When `0 < len <= isize::MAX as usize` and `!data.is_null()`, `data` must point to `len`
    /// readable bytes.
    #[inline]
    pub unsafe fn as_bytes<'a>(&self) -> &'a [u8] {
        if self.len == 0 || self.data.is_null() || self.len > isize::MAX as usize {
            &[]
        } else {
            std::slice::from_raw_parts(self.data, self.len)
        }
    }

    /// Validates `len <= max_bytes` (and `len <= isize::MAX`) **before** forming a Rust slice.
    ///
    /// # Safety
    /// When `0 < len <= max_bytes` and `!data.is_null()`, `data` must point to `len` readable
    /// bytes.
    #[inline]
    pub unsafe fn as_bytes_capped<'a>(&self, max_bytes: usize) -> Result<&'a [u8], u32> {
        if self.len == 0 || self.data.is_null() {
            return Ok(&[]);
        }
        if self.len > max_bytes || self.len > isize::MAX as usize {
            return Err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        Ok(std::slice::from_raw_parts(self.data, self.len))
    }
}

/// Owned byte buffer returned by a C-ABI kernel. Free with [`three_live_kernel_free`].
#[repr(C)]
#[derive(Debug)]
pub struct ThreeLiveKernelBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub capacity: usize,
    pub status: u32,
}

impl ThreeLiveKernelBuffer {
    #[inline]
    pub fn empty_ok() -> Self {
        Self { data: std::ptr::null_mut(), len: 0, capacity: 0, status: THREE_LIVE_KERNEL_OK }
    }

    #[inline]
    pub fn err(status: u32) -> Self {
        Self { data: std::ptr::null_mut(), len: 0, capacity: 0, status }
    }

    pub fn from_vec(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::empty_ok();
        }
        let boxed = bytes.into_boxed_slice();
        let len = boxed.len();
        let ptr = Box::into_raw(boxed) as *mut u8;
        register_kernel_alloc(ptr, len);
        Self { data: ptr, len, capacity: len, status: THREE_LIVE_KERNEL_OK }
    }
}

static KERNEL_ALLOCATIONS: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();

fn lock_kernel_allocs() -> std::sync::MutexGuard<'static, HashMap<usize, usize>> {
    KERNEL_ALLOCATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn register_kernel_alloc(ptr: *mut u8, cap: usize) {
    lock_kernel_allocs().insert(ptr as usize, cap);
}

fn unregister_kernel_alloc(ptr: *mut u8) -> Option<usize> {
    lock_kernel_allocs().remove(&(ptr as usize))
}

/// Generic C-ABI invoke function signature.
pub type ThreeLiveKernelInvokeFn = unsafe extern "C" fn(
    scalars: *const f64,
    scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer;

/// Static C-ABI descriptor entry returned by [`three_live_kernels_table`].
#[repr(C)]
pub struct ThreeLiveKernelDescriptor {
    pub kernel_id: u32,
    pub name: *const c_char,
    pub js_global_name: *const c_char,
    pub signature: *const c_char,
    pub fn_ptr: *const c_void,
    pub invoke: ThreeLiveKernelInvokeFn,
}

unsafe impl Sync for ThreeLiveKernelDescriptor {}

/// Frees a buffer returned by any `three_live_kernel_*` function.
///
/// # Safety
/// `data` must be `NULL` or a pointer returned by a `three_live_kernel_*` function.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_free(data: *mut u8, _capacity: usize) {
    if data.is_null() {
        return;
    }
    let _ = std::panic::catch_unwind(|| {
        if let Some(alloc_len) = unregister_kernel_alloc(data) {
            let _ = Box::from_raw(std::ptr::slice_from_raw_parts_mut(data, alloc_len));
        }
    });
}

/// Returns [`THREE_LIVE_KERNELS_ABI_VERSION`] (`1`).
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernels_abi_version() -> u32 {
    THREE_LIVE_KERNELS_ABI_VERSION
}

// =============================================================================================
// Binary Packing Helpers
// =============================================================================================

fn pack_geometry(geo: &NativeGeometry) -> ThreeLiveKernelBuffer {
    let pos_len = geo.positions.len();
    let norm_len = geo.normals.len();
    let uv_len = geo.uvs.len();
    let idx_len = geo.indices.len();
    let total_bytes = 16 + (pos_len + norm_len + uv_len + idx_len) * 4;
    let mut out = Vec::with_capacity(total_bytes);
    out.extend_from_slice(&(pos_len as u32).to_ne_bytes());
    out.extend_from_slice(&(norm_len as u32).to_ne_bytes());
    out.extend_from_slice(&(uv_len as u32).to_ne_bytes());
    out.extend_from_slice(&(idx_len as u32).to_ne_bytes());
    for &v in &geo.positions {
        out.extend_from_slice(&v.to_ne_bytes());
    }
    for &v in &geo.normals {
        out.extend_from_slice(&v.to_ne_bytes());
    }
    for &v in &geo.uvs {
        out.extend_from_slice(&v.to_ne_bytes());
    }
    for &v in &geo.indices {
        out.extend_from_slice(&v.to_ne_bytes());
    }
    ThreeLiveKernelBuffer::from_vec(out)
}

fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes.as_chunks::<4>().0.iter().map(|c| f32::from_ne_bytes([c[0], c[1], c[2], c[3]])).collect()
}

fn bytes_to_u32_vec(bytes: &[u8]) -> Vec<u32> {
    bytes.as_chunks::<4>().0.iter().map(|c| u32::from_ne_bytes([c[0], c[1], c[2], c[3]])).collect()
}

#[inline]
unsafe fn scalar_at_raw(ptr: *const f64, count: usize, idx: usize, default: f64) -> f64 {
    if ptr.is_null() || idx >= count || idx > isize::MAX as usize / std::mem::size_of::<f64>() {
        return default;
    }
    let v = ptr.add(idx).read_unaligned();
    if v.is_nan() {
        default
    } else {
        v
    }
}

#[inline]
unsafe fn slice_at_raw(
    ptr: *const ThreeLiveKernelSlice,
    count: usize,
    idx: usize,
) -> ThreeLiveKernelSlice {
    if ptr.is_null()
        || idx >= count
        || idx > isize::MAX as usize / std::mem::size_of::<ThreeLiveKernelSlice>()
    {
        return ThreeLiveKernelSlice { data: std::ptr::null(), len: 0 };
    }
    ptr.add(idx).read_unaligned()
}

fn catch_kernel<F: FnOnce() -> ThreeLiveKernelBuffer>(f: F) -> ThreeLiveKernelBuffer {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
        .unwrap_or_else(|_| ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_INTERNAL))
}

// =============================================================================================
// Typed C-ABI Kernel Implementations
// =============================================================================================

#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernel_box(
    width: f32,
    height: f32,
    depth: f32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| pack_geometry(&generate_box(width, height, depth)))
}

#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernel_plane(
    width: f32,
    height: f32,
    width_segments: u32,
    height_segments: u32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let ws = (width_segments as usize).clamp(1, 2048);
        let hs = (height_segments as usize).clamp(1, 2048);
        if (ws + 1) * (hs + 1) > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        pack_geometry(&generate_plane(width, height, ws, hs))
    })
}

#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernel_sphere(
    radius: f32,
    width_segments: u32,
    height_segments: u32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let ws = (width_segments as usize).clamp(3, 2048);
        let hs = (height_segments as usize).clamp(2, 2048);
        if (ws + 1) * (hs + 1) > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        pack_geometry(&generate_sphere(radius, ws, hs))
    })
}

#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernel_cylinder(
    radius_top: f32,
    radius_bottom: f32,
    height: f32,
    radial_segments: u32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let rs = (radial_segments as usize).clamp(3, 2048);
        if (rs + 1) * 2 > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        pack_geometry(&generate_cylinder(radius_top, radius_bottom, height, rs))
    })
}

#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernel_torus(
    radius: f32,
    tube: f32,
    radial_segments: u32,
    tubular_segments: u32,
    arc: f32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let rs = (radial_segments as usize).clamp(3, 2048);
        let ts = (tubular_segments as usize).clamp(3, 2048);
        if (rs + 1) * (ts + 1) > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        pack_geometry(&generate_torus(radius, tube, rs, ts, arc))
    })
}

#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernel_torus_knot(
    radius: f32,
    tube: f32,
    tubular_segments: u32,
    radial_segments: u32,
    p: f32,
    q: f32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let ts = (tubular_segments as usize).clamp(3, 2048);
        let rs = (radial_segments as usize).clamp(3, 2048);
        if (ts + 1) * (rs + 1) > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        pack_geometry(&generate_torus_knot(radius, tube, ts, rs, p, q))
    })
}

/// # Safety
/// `positions_f32` and `indices_u32` must reference valid memory when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_compute_vertex_normals(
    positions_f32: ThreeLiveKernelSlice,
    indices_u32: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let pos_bytes = match positions_f32.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let idx_bytes = match indices_u32.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let positions = bytes_to_f32_vec(pos_bytes);
        let vert_count = positions.len() / 3;
        if vert_count == 0 {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        if vert_count > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        let indices_opt =
            if idx_bytes.is_empty() { None } else { Some(bytes_to_u32_vec(idx_bytes)) };
        let normals = compute_vertex_normals_slice(&positions, indices_opt.as_deref());
        let mut out = Vec::with_capacity(normals.len() * 4);
        for &n in &normals {
            out.extend_from_slice(&n.to_ne_bytes());
        }
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// All non-empty `ThreeLiveKernelSlice` arguments must point to valid memory.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_csg_boolean(
    pos_a: ThreeLiveKernelSlice,
    norm_a: ThreeLiveKernelSlice,
    uv_a: ThreeLiveKernelSlice,
    idx_a: ThreeLiveKernelSlice,
    mat_a: ThreeLiveKernelSlice,
    pos_b: ThreeLiveKernelSlice,
    norm_b: ThreeLiveKernelSlice,
    uv_b: ThreeLiveKernelSlice,
    idx_b: ThreeLiveKernelSlice,
    mat_b: ThreeLiveKernelSlice,
    op_code: u32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let pa = match pos_a.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let pb = match pos_b.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        if pa.is_empty() || pb.is_empty() {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_INVALID_ARG);
        }
        let na = match norm_a.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let ua = match uv_a.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let ia = match idx_a.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let ma = match mat_a.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let nb = match norm_b.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let ub = match uv_b.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let ib = match idx_b.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let mb = match mat_b.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };

        let pos_a_v = bytes_to_f32_vec(pa);
        let norm_a_v = (!na.is_empty()).then(|| bytes_to_f32_vec(na));
        let uv_a_v = (!ua.is_empty()).then(|| bytes_to_f32_vec(ua));
        let idx_a_v = (!ia.is_empty()).then(|| bytes_to_u32_vec(ia));
        let mat_a_v = (!ma.is_empty()).then(|| bytes_to_f32_vec(ma));

        let pos_b_v = bytes_to_f32_vec(pb);
        let norm_b_v = (!nb.is_empty()).then(|| bytes_to_f32_vec(nb));
        let uv_b_v = (!ub.is_empty()).then(|| bytes_to_f32_vec(ub));
        let idx_b_v = (!ib.is_empty()).then(|| bytes_to_u32_vec(ib));
        let mat_b_v = (!mb.is_empty()).then(|| bytes_to_f32_vec(mb));

        let polys_a = buffers_to_csg_polygons(
            &pos_a_v,
            norm_a_v.as_deref(),
            uv_a_v.as_deref(),
            idx_a_v.as_deref(),
            mat_a_v.as_deref(),
        );
        let polys_b = buffers_to_csg_polygons(
            &pos_b_v,
            norm_b_v.as_deref(),
            uv_b_v.as_deref(),
            idx_b_v.as_deref(),
            mat_b_v.as_deref(),
        );

        if polys_a.len() + polys_b.len() > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        let result_polys = evaluate_csg(&polys_a, &polys_b, op_code);
        let geo = csg_polygons_to_geometry(&result_polys);
        if geo.positions.len() / 3 > SECURITY_3D_MAX_VERTICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        pack_geometry(&geo)
    })
}

/// # Safety
/// `numbers_f64` must reference valid `f64` bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_f32_array(
    numbers_f64: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let max_bytes = (SECURITY_3D_MAX_VERTICES * 16 * 8).min(SECURITY_3D_MAX_HEAP_BYTES);
        let bytes = match numbers_f64.as_bytes_capped(max_bytes) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let count = bytes.len() / 8;
        if count > SECURITY_3D_MAX_VERTICES * 16 {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        let mut out = Vec::with_capacity(count * 4);
        for c in bytes.as_chunks::<8>().0 {
            let v = f64::from_ne_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]) as f32;
            out.extend_from_slice(&v.to_ne_bytes());
        }
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// `numbers_f64` must reference valid `f64` bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_index_array(
    numbers_f64: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match numbers_f64.as_bytes_capped(SECURITY_3D_MAX_INDICES * 8) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let count = bytes.len() / 8;
        if count > SECURITY_3D_MAX_INDICES {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        let mut vals = Vec::with_capacity(count);
        let mut max_idx = 0u32;
        for c in bytes.as_chunks::<8>().0 {
            let v = f64::from_ne_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]) as u32;
            if v > max_idx {
                max_idx = v;
            }
            vals.push(v);
        }
        if max_idx > 65535 {
            let mut out = Vec::with_capacity(4 + vals.len() * 4);
            out.extend_from_slice(&[1u8, 0, 0, 0]);
            for &v in &vals {
                out.extend_from_slice(&v.to_ne_bytes());
            }
            ThreeLiveKernelBuffer::from_vec(out)
        } else {
            let mut out = Vec::with_capacity(4 + vals.len() * 2);
            out.extend_from_slice(&[0u8, 0, 0, 0]);
            for &v in &vals {
                out.extend_from_slice(&(v as u16).to_ne_bytes());
            }
            ThreeLiveKernelBuffer::from_vec(out)
        }
    })
}

#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "C" fn three_live_kernel_material_preset(
    kind: u32,
    size: u32,
    scale: i64,
    seed: u32,
    r: f64,
    g: f64,
    b: f64,
    r2: f64,
    g2: f64,
    b2: f64,
    roughness: f64,
    normal_strength: f64,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        if kind as usize >= MATERIAL_PRESETS.len()
            || !(4..=512).contains(&size)
            || !(1..=256).contains(&scale)
            || [r, g, b, r2, g2, b2, roughness, normal_strength].iter().any(|v| !v.is_finite())
        {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        let p = PresetParams {
            kind,
            size: size as usize,
            scale,
            seed,
            color: [r, g, b],
            color2: [r2, g2, b2],
            roughness,
            normal_strength,
        };
        let maps = generate_material_preset(&p);
        let map_len = maps.albedo.len();
        let mut out = Vec::with_capacity(4 + map_len * 3);
        out.extend_from_slice(&(map_len as u32).to_ne_bytes());
        out.extend_from_slice(&maps.albedo);
        out.extend_from_slice(&maps.normal);
        out.extend_from_slice(&maps.orm);
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// `albedo_rgba` must reference valid RGBA8 bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_derive_texture_maps(
    albedo_rgba: ThreeLiveKernelSlice,
    size: u32,
    normal_strength: f64,
    roughness: f64,
    metalness: f64,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let n = size as usize;
        if !(4..=1024).contains(&n) {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        let Ok(albedo) = albedo_rgba.as_bytes_capped(n * n * 4) else {
            return ThreeLiveKernelBuffer::empty_ok();
        };
        if albedo.len() != n * n * 4 {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        let (normal, orm) = derive_texture_maps(albedo, n, normal_strength, roughness, metalness);
        let map_len = normal.len();
        let mut out = Vec::with_capacity(4 + map_len * 2);
        out.extend_from_slice(&(map_len as u32).to_ne_bytes());
        out.extend_from_slice(&normal);
        out.extend_from_slice(&orm);
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// `rgba` must reference valid RGBA8 bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_seam_blend(
    rgba: ThreeLiveKernelSlice,
    size: u32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let n = size as usize;
        if !(2..=2048).contains(&n) {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        let Ok(src) = rgba.as_bytes_capped(n * n * 4) else {
            return ThreeLiveKernelBuffer::empty_ok();
        };
        if src.len() != n * n * 4 {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        let blended = seam_blend(src, n);
        let mut out = Vec::with_capacity(1 + blended.len());
        out.push(1u8);
        out.extend_from_slice(&blended);
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// `bytes` must reference valid memory when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_crc32(bytes: ThreeLiveKernelSlice) -> u32 {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        bytes.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES).map(calculate_crc32).unwrap_or(0)
    }))
    .unwrap_or(0)
}

/// # Safety
/// `positions_f32` must reference valid `f32` bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_format_usda_points(
    positions_f32: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match positions_f32.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let s = format_usda_points_from_bytes(bytes);
        ThreeLiveKernelBuffer::from_vec(s.into_bytes())
    })
}

/// # Safety
/// `uvs_f32` must reference valid `f32` bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_format_usda_uvs(
    uvs_f32: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match uvs_f32.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let s = format_usda_uvs_from_bytes(bytes);
        ThreeLiveKernelBuffer::from_vec(s.into_bytes())
    })
}

/// # Safety
/// `ints_bytes` must reference valid integer bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_format_usda_ints(
    ints_bytes: ThreeLiveKernelSlice,
    is_u16: u32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match ints_bytes.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let s = format_usda_ints_from_bytes(bytes, is_u16 != 0);
        ThreeLiveKernelBuffer::from_vec(s.into_bytes())
    })
}

/// Builds a 64-byte aligned USDZ archive from packed entries:
/// `[count: u32][name_len: u32, name_utf8, data_len: u32, data_bytes]*` (little-endian `u32`).
///
/// # Safety
/// `packed_entries` must reference valid memory when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_build_usdz_zip(
    packed_entries: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let buf = match packed_entries.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        if buf.len() < 4 {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_INVALID_ARG);
        }
        let count = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        if count > 1024 {
            return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        }
        let mut off = 4usize;
        let mut names = Vec::with_capacity(count);
        let mut payloads: Vec<&[u8]> = Vec::with_capacity(count);
        for _ in 0..count {
            if off + 4 > buf.len() {
                return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_INVALID_ARG);
            }
            let name_len =
                u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]]) as usize;
            off += 4;
            if off.checked_add(name_len).is_none_or(|e| e + 4 > buf.len()) {
                return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_INVALID_ARG);
            }
            let name = String::from_utf8_lossy(&buf[off..off + name_len]).into_owned();
            off += name_len;
            let data_len =
                u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]]) as usize;
            off += 4;
            if off.checked_add(data_len).is_none_or(|e| e > buf.len()) {
                return ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_INVALID_ARG);
            }
            names.push(name);
            payloads.push(&buf[off..off + data_len]);
            off += data_len;
        }
        let refs: Vec<ZipEntryRef<'_>> = names
            .iter()
            .zip(payloads.iter())
            .map(|(n, d)| ZipEntryRef { filename: n.as_str(), data: *d })
            .collect();
        match try_build_usdz_zip_refs(&refs) {
            Ok(zip) => ThreeLiveKernelBuffer::from_vec(zip),
            Err(_) => ThreeLiveKernelBuffer::err(THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED),
        }
    })
}

/// # Safety
/// `rgba` must reference valid RGBA8 bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_encode_rgba_png(
    rgba: ThreeLiveKernelSlice,
    src_w: u32,
    src_h: u32,
    flip_y: u32,
    is_linear: u32,
    max_dim: u32,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match rgba.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let Some((uri, avg)) = encode_rgba_png_data_uri_impl(
            bytes,
            src_w as usize,
            src_h as usize,
            flip_y != 0,
            is_linear != 0,
            (max_dim as usize).clamp(1, 2048),
        ) else {
            return ThreeLiveKernelBuffer::empty_ok();
        };
        let mut out = Vec::with_capacity(32 + uri.len());
        for &c in &avg {
            out.extend_from_slice(&c.to_ne_bytes());
        }
        out.extend_from_slice(uri.as_bytes());
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// `uri_utf8` must reference valid UTF-8 bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_compress_png_uri(
    uri_utf8: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match uri_utf8.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let Ok(s) = std::str::from_utf8(bytes) else {
            return ThreeLiveKernelBuffer::from_vec(bytes.to_vec());
        };
        let compressed = compress_png_data_uri(s);
        ThreeLiveKernelBuffer::from_vec(compressed.as_bytes().to_vec())
    })
}

/// # Safety
/// `uri_utf8` must reference valid UTF-8 bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_decode_b64_image(
    uri_utf8: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match uri_utf8.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let Ok(s) = std::str::from_utf8(bytes) else {
            return ThreeLiveKernelBuffer::empty_ok();
        };
        let Some(decoded) = decode_b64_image_data_uri(s) else {
            return ThreeLiveKernelBuffer::empty_ok();
        };
        let mut out = Vec::with_capacity(1 + decoded.len());
        out.push(1u8);
        out.extend_from_slice(&decoded);
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// `png_bytes` must reference valid bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_decode_png(
    png_bytes: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match png_bytes.as_bytes_capped(MAX_KERNEL_PNG_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let Ok((w, h, rgba)) = decode_png_rgba(bytes) else {
            return ThreeLiveKernelBuffer::empty_ok();
        };
        let mut out = Vec::with_capacity(8 + rgba.len());
        out.extend_from_slice(&w.to_ne_bytes());
        out.extend_from_slice(&h.to_ne_bytes());
        out.extend_from_slice(&rgba);
        ThreeLiveKernelBuffer::from_vec(out)
    })
}

/// # Safety
/// `utf8_bytes` must reference valid bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_utf8_encode(
    utf8_bytes: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match utf8_bytes.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        ThreeLiveKernelBuffer::from_vec(bytes.to_vec())
    })
}

/// # Safety
/// `raw_bytes` must reference valid bytes when non-empty.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernel_utf8_decode(
    raw_bytes: ThreeLiveKernelSlice,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let bytes = match raw_bytes.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let decoded = String::from_utf8_lossy(bytes).into_owned();
        ThreeLiveKernelBuffer::from_vec(decoded.into_bytes())
    })
}

// =============================================================================================
// Uniform C-ABI Dispatcher Trampolines & Descriptor Table
// =============================================================================================

unsafe extern "C" fn invoke_box(
    scalars: *const f64,
    scalar_count: usize,
    _slices: *const ThreeLiveKernelSlice,
    _slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_box(
            scalar_at_raw(scalars, scalar_count, 0, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 1, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 2, 1.0) as f32,
        )
    })
}

unsafe extern "C" fn invoke_plane(
    scalars: *const f64,
    scalar_count: usize,
    _slices: *const ThreeLiveKernelSlice,
    _slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_plane(
            scalar_at_raw(scalars, scalar_count, 0, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 1, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 2, 1.0).max(1.0) as u32,
            scalar_at_raw(scalars, scalar_count, 3, 1.0).max(1.0) as u32,
        )
    })
}

unsafe extern "C" fn invoke_sphere(
    scalars: *const f64,
    scalar_count: usize,
    _slices: *const ThreeLiveKernelSlice,
    _slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_sphere(
            scalar_at_raw(scalars, scalar_count, 0, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 1, 16.0).max(3.0) as u32,
            scalar_at_raw(scalars, scalar_count, 2, 12.0).max(2.0) as u32,
        )
    })
}

unsafe extern "C" fn invoke_cylinder(
    scalars: *const f64,
    scalar_count: usize,
    _slices: *const ThreeLiveKernelSlice,
    _slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_cylinder(
            scalar_at_raw(scalars, scalar_count, 0, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 1, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 2, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 3, 16.0).max(3.0) as u32,
        )
    })
}

unsafe extern "C" fn invoke_torus(
    scalars: *const f64,
    scalar_count: usize,
    _slices: *const ThreeLiveKernelSlice,
    _slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_torus(
            scalar_at_raw(scalars, scalar_count, 0, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 1, 0.4) as f32,
            scalar_at_raw(scalars, scalar_count, 2, 12.0).max(3.0) as u32,
            scalar_at_raw(scalars, scalar_count, 3, 48.0).max(3.0) as u32,
            scalar_at_raw(scalars, scalar_count, 4, std::f64::consts::TAU) as f32,
        )
    })
}

unsafe extern "C" fn invoke_torus_knot(
    scalars: *const f64,
    scalar_count: usize,
    _slices: *const ThreeLiveKernelSlice,
    _slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_torus_knot(
            scalar_at_raw(scalars, scalar_count, 0, 1.0) as f32,
            scalar_at_raw(scalars, scalar_count, 1, 0.4) as f32,
            scalar_at_raw(scalars, scalar_count, 2, 64.0).max(3.0) as u32,
            scalar_at_raw(scalars, scalar_count, 3, 8.0).max(3.0) as u32,
            scalar_at_raw(scalars, scalar_count, 4, 2.0) as f32,
            scalar_at_raw(scalars, scalar_count, 5, 3.0) as f32,
        )
    })
}

unsafe extern "C" fn invoke_compute_vertex_normals(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_compute_vertex_normals(
            slice_at_raw(slices, slice_count, 0),
            slice_at_raw(slices, slice_count, 1),
        )
    })
}

unsafe extern "C" fn invoke_csg_boolean(
    scalars: *const f64,
    scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_csg_boolean(
            slice_at_raw(slices, slice_count, 0),
            slice_at_raw(slices, slice_count, 1),
            slice_at_raw(slices, slice_count, 2),
            slice_at_raw(slices, slice_count, 3),
            slice_at_raw(slices, slice_count, 4),
            slice_at_raw(slices, slice_count, 5),
            slice_at_raw(slices, slice_count, 6),
            slice_at_raw(slices, slice_count, 7),
            slice_at_raw(slices, slice_count, 8),
            slice_at_raw(slices, slice_count, 9),
            scalar_at_raw(scalars, scalar_count, 0, 0.0) as u32,
        )
    })
}

unsafe extern "C" fn invoke_f32_array(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_f32_array(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_index_array(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_index_array(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_material_preset(
    scalars: *const f64,
    scalar_count: usize,
    _slices: *const ThreeLiveKernelSlice,
    _slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        if scalars.is_null() || scalar_count < 12 {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        let mut a = [0.0f64; 12];
        for (i, slot) in a.iter_mut().enumerate() {
            *slot = scalars.add(i).read_unaligned();
        }
        if a.iter().any(|v| !v.is_finite())
            || a[0] < 0.0
            || a[0] >= MATERIAL_PRESETS.len() as f64
            || !(4.0..=512.0).contains(&a[1])
            || !(1.0..=256.0).contains(&a[2])
            || a[0].fract() != 0.0
            || a[1].fract() != 0.0
            || a[2].fract() != 0.0
            || a[3] < 0.0
            || a[3] > u32::MAX as f64
            || a[3].fract() != 0.0
        {
            return ThreeLiveKernelBuffer::empty_ok();
        }
        three_live_kernel_material_preset(
            a[0] as u32,
            a[1] as u32,
            a[2] as i64,
            a[3] as u32,
            a[4],
            a[5],
            a[6],
            a[7],
            a[8],
            a[9],
            a[10],
            a[11],
        )
    })
}

unsafe extern "C" fn invoke_derive_texture_maps(
    scalars: *const f64,
    scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_derive_texture_maps(
            slice_at_raw(slices, slice_count, 0),
            scalar_at_raw(scalars, scalar_count, 0, 0.0) as u32,
            scalar_at_raw(scalars, scalar_count, 1, 1.0),
            scalar_at_raw(scalars, scalar_count, 2, 0.5),
            scalar_at_raw(scalars, scalar_count, 3, 0.0),
        )
    })
}

unsafe extern "C" fn invoke_seam_blend(
    scalars: *const f64,
    scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_seam_blend(
            slice_at_raw(slices, slice_count, 0),
            scalar_at_raw(scalars, scalar_count, 0, 0.0) as u32,
        )
    })
}

unsafe extern "C" fn invoke_crc32(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        let s = slice_at_raw(slices, slice_count, 0);
        let bytes = match s.as_bytes_capped(SECURITY_3D_MAX_HEAP_BYTES) {
            Ok(b) => b,
            Err(status) => return ThreeLiveKernelBuffer::err(status),
        };
        let crc = calculate_crc32(bytes);
        ThreeLiveKernelBuffer::from_vec(crc.to_ne_bytes().to_vec())
    })
}

unsafe extern "C" fn invoke_format_usda_points(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_format_usda_points(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_format_usda_uvs(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_format_usda_uvs(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_format_usda_ints(
    scalars: *const f64,
    scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_format_usda_ints(
            slice_at_raw(slices, slice_count, 0),
            u32::from(scalar_at_raw(scalars, scalar_count, 0, 0.0) != 0.0),
        )
    })
}

unsafe extern "C" fn invoke_build_usdz_zip(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_build_usdz_zip(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_encode_rgba_png(
    scalars: *const f64,
    scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| {
        three_live_kernel_encode_rgba_png(
            slice_at_raw(slices, slice_count, 0),
            scalar_at_raw(scalars, scalar_count, 0, 0.0).max(0.0) as u32,
            scalar_at_raw(scalars, scalar_count, 1, 0.0).max(0.0) as u32,
            u32::from(scalar_at_raw(scalars, scalar_count, 2, 0.0) != 0.0),
            u32::from(scalar_at_raw(scalars, scalar_count, 3, 0.0) != 0.0),
            scalar_at_raw(scalars, scalar_count, 4, 512.0).clamp(1.0, 2048.0) as u32,
        )
    })
}

unsafe extern "C" fn invoke_compress_png_uri(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_compress_png_uri(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_decode_b64_image(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_decode_b64_image(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_decode_png(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_decode_png(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_utf8_encode(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_utf8_encode(slice_at_raw(slices, slice_count, 0)))
}

unsafe extern "C" fn invoke_utf8_decode(
    _scalars: *const f64,
    _scalar_count: usize,
    slices: *const ThreeLiveKernelSlice,
    slice_count: usize,
) -> ThreeLiveKernelBuffer {
    catch_kernel(|| three_live_kernel_utf8_decode(slice_at_raw(slices, slice_count, 0)))
}

macro_rules! cstr {
    ($s:literal) => {
        concat!($s, "\0").as_ptr() as *const c_char
    };
}

static KERNEL_DESCRIPTORS: [ThreeLiveKernelDescriptor; 24] = [
    ThreeLiveKernelDescriptor {
        kernel_id: 1,
        name: cstr!("box"),
        js_global_name: cstr!("__three_live_native_box__"),
        signature: cstr!("(f,f,f)->geom"),
        fn_ptr: three_live_kernel_box as *const c_void,
        invoke: invoke_box,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 2,
        name: cstr!("plane"),
        js_global_name: cstr!("__three_live_native_plane__"),
        signature: cstr!("(f,f,f,f)->geom"),
        fn_ptr: three_live_kernel_plane as *const c_void,
        invoke: invoke_plane,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 3,
        name: cstr!("sphere"),
        js_global_name: cstr!("__three_live_native_sphere__"),
        signature: cstr!("(f,f,f)->geom"),
        fn_ptr: three_live_kernel_sphere as *const c_void,
        invoke: invoke_sphere,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 4,
        name: cstr!("cylinder"),
        js_global_name: cstr!("__three_live_native_cylinder__"),
        signature: cstr!("(f,f,f,f)->geom"),
        fn_ptr: three_live_kernel_cylinder as *const c_void,
        invoke: invoke_cylinder,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 5,
        name: cstr!("torus"),
        js_global_name: cstr!("__three_live_native_torus__"),
        signature: cstr!("(f,f,f,f,f)->geom"),
        fn_ptr: three_live_kernel_torus as *const c_void,
        invoke: invoke_torus,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 6,
        name: cstr!("torus_knot"),
        js_global_name: cstr!("__three_live_native_torus_knot__"),
        signature: cstr!("(f,f,f,f,f,f)->geom"),
        fn_ptr: three_live_kernel_torus_knot as *const c_void,
        invoke: invoke_torus_knot,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 7,
        name: cstr!("compute_vertex_normals"),
        js_global_name: cstr!("__three_live_native_compute_vertex_normals__"),
        signature: cstr!("(b,u32s)->f32"),
        fn_ptr: three_live_kernel_compute_vertex_normals as *const c_void,
        invoke: invoke_compute_vertex_normals,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 8,
        name: cstr!("csg_boolean"),
        js_global_name: cstr!("__three_live_native_csg_boolean__"),
        signature: cstr!("(b,b,b,u32s,b,b,b,b,u32s,b,f)->geom"),
        fn_ptr: three_live_kernel_csg_boolean as *const c_void,
        invoke: invoke_csg_boolean,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 9,
        name: cstr!("f32_array"),
        js_global_name: cstr!("__three_live_native_f32_array__"),
        signature: cstr!("(a)->f32"),
        fn_ptr: three_live_kernel_f32_array as *const c_void,
        invoke: invoke_f32_array,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 10,
        name: cstr!("index_array"),
        js_global_name: cstr!("__three_live_native_index_array__"),
        signature: cstr!("(a)->idx"),
        fn_ptr: three_live_kernel_index_array as *const c_void,
        invoke: invoke_index_array,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 11,
        name: cstr!("material_preset"),
        js_global_name: cstr!("__three_live_native_material_preset__"),
        signature: cstr!("(f,f,f,f,f,f,f,f,f,f,f,f)->maps3?"),
        fn_ptr: three_live_kernel_material_preset as *const c_void,
        invoke: invoke_material_preset,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 12,
        name: cstr!("derive_texture_maps"),
        js_global_name: cstr!("__three_live_native_derive_texture_maps__"),
        signature: cstr!("(b,f,f,f,f)->maps2?"),
        fn_ptr: three_live_kernel_derive_texture_maps as *const c_void,
        invoke: invoke_derive_texture_maps,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 13,
        name: cstr!("seam_blend"),
        js_global_name: cstr!("__three_live_native_seam_blend__"),
        signature: cstr!("(b,f)->u8?"),
        fn_ptr: three_live_kernel_seam_blend as *const c_void,
        invoke: invoke_seam_blend,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 14,
        name: cstr!("crc32"),
        js_global_name: cstr!("__three_live_native_crc32__"),
        signature: cstr!("(b)->u32"),
        fn_ptr: three_live_kernel_crc32 as *const c_void,
        invoke: invoke_crc32,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 15,
        name: cstr!("format_usda_points"),
        js_global_name: cstr!("__three_live_native_format_usda_points__"),
        signature: cstr!("(b)->str"),
        fn_ptr: three_live_kernel_format_usda_points as *const c_void,
        invoke: invoke_format_usda_points,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 16,
        name: cstr!("format_usda_uvs"),
        js_global_name: cstr!("__three_live_native_format_usda_uvs__"),
        signature: cstr!("(b)->str"),
        fn_ptr: three_live_kernel_format_usda_uvs as *const c_void,
        invoke: invoke_format_usda_uvs,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 17,
        name: cstr!("format_usda_ints"),
        js_global_name: cstr!("__three_live_native_format_usda_ints__"),
        signature: cstr!("(i)->str"),
        fn_ptr: three_live_kernel_format_usda_ints as *const c_void,
        invoke: invoke_format_usda_ints,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 18,
        name: cstr!("build_usdz_zip"),
        js_global_name: cstr!("__three_live_native_build_usdz_zip__"),
        signature: cstr!("(z)->u8"),
        fn_ptr: three_live_kernel_build_usdz_zip as *const c_void,
        invoke: invoke_build_usdz_zip,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 19,
        name: cstr!("encode_rgba_png"),
        js_global_name: cstr!("__three_live_native_encode_rgba_png__"),
        signature: cstr!("(b,f,f,f,f,f)->pnguri?"),
        fn_ptr: three_live_kernel_encode_rgba_png as *const c_void,
        invoke: invoke_encode_rgba_png,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 20,
        name: cstr!("compress_png_uri"),
        js_global_name: cstr!("__three_live_native_compress_png_uri__"),
        signature: cstr!("(s)->str"),
        fn_ptr: three_live_kernel_compress_png_uri as *const c_void,
        invoke: invoke_compress_png_uri,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 21,
        name: cstr!("decode_b64_image"),
        js_global_name: cstr!("__three_live_native_decode_b64_image__"),
        signature: cstr!("(s)->u8?"),
        fn_ptr: three_live_kernel_decode_b64_image as *const c_void,
        invoke: invoke_decode_b64_image,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 22,
        name: cstr!("decode_png"),
        js_global_name: cstr!("__three_live_native_decode_png__"),
        signature: cstr!("(b)->pngrgba?"),
        fn_ptr: three_live_kernel_decode_png as *const c_void,
        invoke: invoke_decode_png,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 23,
        name: cstr!("utf8_encode"),
        js_global_name: cstr!("__three_live_native_utf8_encode__"),
        signature: cstr!("(s)->u8"),
        fn_ptr: three_live_kernel_utf8_encode as *const c_void,
        invoke: invoke_utf8_encode,
    },
    ThreeLiveKernelDescriptor {
        kernel_id: 24,
        name: cstr!("utf8_decode"),
        js_global_name: cstr!("__three_live_native_utf8_decode__"),
        signature: cstr!("(b)->str"),
        fn_ptr: three_live_kernel_utf8_decode as *const c_void,
        invoke: invoke_utf8_decode,
    },
];

/// Returns a pointer to the static [`ThreeLiveKernelDescriptor`] table and writes its length to
/// `*out_count` (when `out_count != NULL`).
///
/// # Safety
/// `out_count`, if non-null, must point to a valid writable `usize`.
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "C" fn three_live_kernels_table(
    out_count: *mut usize,
) -> *const ThreeLiveKernelDescriptor {
    if !out_count.is_null() {
        *out_count = KERNEL_DESCRIPTORS.len();
    }
    KERNEL_DESCRIPTORS.as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn table_has_24_valid_descriptors_and_safe_deallocation() {
        assert_eq!(three_live_kernels_abi_version(), THREE_LIVE_KERNELS_ABI_VERSION);
        let mut count = 0usize;
        let ptr = unsafe { three_live_kernels_table(&mut count) };
        assert_eq!(count, 24);
        assert!(!ptr.is_null());

        let slice = unsafe { std::slice::from_raw_parts(ptr, count) };
        for (i, d) in slice.iter().enumerate() {
            assert_eq!(d.kernel_id, (i + 1) as u32);
            let name = unsafe { CStr::from_ptr(d.name).to_str().unwrap() };
            let js_name = unsafe { CStr::from_ptr(d.js_global_name).to_str().unwrap() };
            let sig = unsafe { CStr::from_ptr(d.signature).to_str().unwrap() };
            assert!(!name.is_empty());
            assert!(js_name.starts_with("__three_live_native_"));
            assert!(sig.contains(")->"));
            assert!(!d.fn_ptr.is_null());
        }

        let buf = three_live_kernel_box(2.0, 3.0, 4.0);
        assert_eq!(buf.status, THREE_LIVE_KERNEL_OK);
        assert!(!buf.data.is_null());
        assert!(buf.len > 16);
        unsafe {
            three_live_kernel_free(buf.data, buf.capacity);
            // Double-free and null-free must be safe no-ops
            three_live_kernel_free(buf.data, buf.capacity);
            three_live_kernel_free(std::ptr::null_mut(), 0);
        }

        // Empty Vec never leaks a dangling 0x1 pointer into KERNEL_ALLOCATIONS
        let empty = ThreeLiveKernelBuffer::from_vec(Vec::new());
        assert!(empty.data.is_null());
        assert_eq!(empty.len, 0);
        assert_eq!(empty.status, THREE_LIVE_KERNEL_OK);

        // Oversized slice length is rejected BEFORE std::slice::from_raw_parts
        let bogus = ThreeLiveKernelSlice { data: 1usize as *const u8, len: usize::MAX };
        let err_buf = unsafe { three_live_kernel_utf8_encode(bogus) };
        assert_eq!(err_buf.status, THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED);
        assert!(err_buf.data.is_null());
    }
}
