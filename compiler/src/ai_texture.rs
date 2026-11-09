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

//! AI PBR textures (roadmap B5): `userData.xr.material = { preset, prompt, size, seed }`.
//!
//! Compiling stays a pure function of `(script, texture pack)`. A **texture pack** maps a
//! content key (FNV-1a 64 of the canonical `{prompt, size, seed}`) to a seamless sRGB albedo PNG.
//! Normal and occlusion-roughness-metalness maps are re-derived on-device from the albedo with
//! integer luminance sums and IEEE-754 `+ - * / sqrt` in the same operation order as the JS
//! kernels in `three-live/src/plugins/procedural.ts`, so Web workers, the CLI / MCP server,
//! Android, and iOS produce byte-identical maps. Keep the two in lockstep
//! (`three-live/tests/fixtures/texture_cases.json`).
//!
//! The compiler never touches the network. Generation (provider call → resize → seam blend →
//! PNG) happens only in explicit host code paths ([`add_generated_texture`]).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use boa_engine::object::builtins::JsArray;
use boa_engine::{js_string, Context, JsResult, JsValue, NativeFunction};
use serde_json::{json, Map, Value};

use crate::material_preset::{height_to_normal, unit_to_byte};

/// `format` field of a serialized texture pack.
pub const TEXTURE_PACK_FORMAT: &str = "three-live-texture-pack";
/// Current texture pack schema version.
pub const TEXTURE_PACK_VERSION: u64 = 1;
/// Longest accepted prompt, in UTF-16 code units (matches JS `String.length`).
pub const MAX_TEXTURE_PROMPT_CHARS: usize = 500;
/// Accepted texture edge lengths.
pub const TEXTURE_SIZES: [u32; 2] = [256, 512];
/// Default texture edge length.
pub const DEFAULT_TEXTURE_SIZE: u32 = 512;
/// Most entries a pack may hold.
pub const MAX_PACK_ENTRIES: usize = 64;
/// Largest decoded albedo PNG accepted per entry.
pub const MAX_ALBEDO_PNG_BYTES: usize = 2 * 1024 * 1024;
/// Largest provider image accepted by [`prepare_albedo`].
pub const MAX_SOURCE_IMAGE_BYTES: usize = 16 * 1024 * 1024;

/// Canonical texture request (`userData.xr.material.{prompt, size, seed}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextureSpec {
    pub prompt: String,
    pub size: u32,
    pub seed: u32,
}

/// Collapses runs of ASCII whitespace / control characters to one space and trims. Returns
/// `None` for empty prompts and prompts longer than [`MAX_TEXTURE_PROMPT_CHARS`].
pub fn canonical_prompt(raw: &str) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let mut pending_space = false;
    for ch in raw.chars() {
        if (ch as u32) <= 0x20 || ch as u32 == 0x7f {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(ch);
    }
    if out.is_empty() || out.encode_utf16().count() > MAX_TEXTURE_PROMPT_CHARS {
        return None;
    }
    Some(out)
}

/// Snaps a requested size to 256 / 512 (non-finite → 512). AI textures export at their full
/// size (presets export at 256), so 512 is the ceiling that keeps GLBs reasonable.
pub fn canonical_texture_size(raw: f64) -> u32 {
    if !raw.is_finite() {
        DEFAULT_TEXTURE_SIZE
    } else if raw <= 384.0 {
        256
    } else {
        512
    }
}

/// `Math.round(Math.abs(seed)) >>> 0` (non-finite → 1).
pub fn canonical_texture_seed(raw: f64) -> u32 {
    let v = if raw.is_finite() { raw.abs() } else { 1.0 };
    let r = (v + 0.5).floor();
    (r % 4_294_967_296.0) as u32
}

impl TextureSpec {
    /// Canonicalizes raw spec fields; `None` when the prompt is empty or too long.
    pub fn new(prompt: &str, size: Option<f64>, seed: Option<f64>) -> Option<Self> {
        Some(TextureSpec {
            prompt: canonical_prompt(prompt)?,
            size: size.map(canonical_texture_size).unwrap_or(DEFAULT_TEXTURE_SIZE),
            seed: seed.map(canonical_texture_seed).unwrap_or(1),
        })
    }

    /// Parses `{prompt, size?, seed?}` from JSON.
    pub fn from_json(v: &Value) -> Option<Self> {
        let prompt = v.get("prompt")?.as_str()?;
        TextureSpec::new(
            prompt,
            v.get("size").and_then(Value::as_f64),
            v.get("seed").and_then(Value::as_f64),
        )
    }

    /// Content key: 16 lowercase hex digits of FNV-1a 64 over
    /// `"three-live-texture\x1f1\x1f{prompt}\x1f{size}\x1f{seed}"` (UTF-8).
    pub fn key(&self) -> String {
        let s = format!(
            "three-live-texture\u{1f}1\u{1f}{}\u{1f}{}\u{1f}{}",
            self.prompt, self.size, self.seed
        );
        format!("{:016x}", fnv1a64(s.as_bytes()))
    }

    pub fn to_json(&self) -> Value {
        json!({"prompt": self.prompt, "size": self.size, "seed": self.seed})
    }
}

/// FNV-1a 64-bit hash.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Clamps derivation parameters exactly like the JS side.
fn clamp_unit(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Derives `[normal, orm]` RGBA8 maps from a seamless `n × n` sRGB albedo.
///
/// Height is the high-passed Rec. 709 luminance (`81·Y − Σ₉ₓ₉ Y`, wrap-around), normalized to
/// `[0, 1]`; normals use [`height_to_normal`]; ORM is `R = 255`,
/// `G = roughness + 0.35·(0.5 − h)`, `B = metalness`.
pub fn derive_texture_maps(
    albedo: &[u8],
    n: usize,
    normal_strength: f64,
    roughness: f64,
    metalness: f64,
) -> (Vec<u8>, Vec<u8>) {
    assert_eq!(albedo.len(), n * n * 4, "albedo must be n*n*4 bytes");
    let mut lum = vec![0i64; n * n];
    for (i, l) in lum.iter_mut().enumerate() {
        let o = i * 4;
        *l = 2126 * albedo[o] as i64 + 7152 * albedo[o + 1] as i64 + 722 * albedo[o + 2] as i64;
    }
    // Separable 9×9 wrap-around box sums (exact integers).
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

/// One pack entry: canonical spec, opaque seamless albedo, and provenance metadata.
#[derive(Debug, Clone)]
pub struct PackEntry {
    pub spec: TextureSpec,
    /// `spec.size² × 4` RGBA8 bytes, alpha forced to 255.
    pub rgba: Vec<u8>,
    pub provenance: Value,
}

/// In-memory texture pack, keyed by [`TextureSpec::key`].
#[derive(Debug, Clone, Default)]
pub struct TexturePack {
    pub entries: BTreeMap<String, PackEntry>,
}

fn is_key(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Decodes a PNG and checks it is exactly `size × size`; alpha is forced to 255.
fn decode_albedo_png(png: &[u8], size: u32) -> Result<Vec<u8>, String> {
    if png.len() < 8 || &png[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("albedo must be a PNG".to_string());
    }
    let img = crate::reference::decode_png(png)?;
    if img.width != size || img.height != size {
        return Err(format!("albedo is {}x{}, expected {}x{}", img.width, img.height, size, size));
    }
    let mut rgba = img.rgba;
    for px in rgba.chunks_exact_mut(4) {
        px[3] = 255;
    }
    Ok(rgba)
}

impl TexturePack {
    /// Parses and validates a serialized pack (format, version, key/spec agreement, PNG size).
    pub fn from_json_str(text: &str) -> Result<Self, String> {
        let v: Value =
            serde_json::from_str(text).map_err(|e| format!("texture pack: invalid JSON: {}", e))?;
        Self::from_json(&v)
    }

    pub fn from_json(v: &Value) -> Result<Self, String> {
        let err = |m: String| format!("texture pack: {}", m);
        if v.get("format").and_then(Value::as_str) != Some(TEXTURE_PACK_FORMAT) {
            return Err(err(format!("format must be \"{}\"", TEXTURE_PACK_FORMAT)));
        }
        if v.get("version").and_then(Value::as_u64) != Some(TEXTURE_PACK_VERSION) {
            return Err(err(format!("version must be {}", TEXTURE_PACK_VERSION)));
        }
        let entries = v
            .get("entries")
            .and_then(Value::as_object)
            .ok_or_else(|| err("entries must be an object".to_string()))?;
        if entries.len() > MAX_PACK_ENTRIES {
            return Err(err(format!("more than {} entries", MAX_PACK_ENTRIES)));
        }
        let mut pack = TexturePack::default();
        for (key, e) in entries {
            if !is_key(key) {
                return Err(err(format!("invalid key '{}'", key)));
            }
            let spec = e
                .get("spec")
                .and_then(TextureSpec::from_json)
                .ok_or_else(|| err(format!("entry {}: invalid spec", key)))?;
            if spec.key() != *key {
                return Err(err(format!(
                    "entry {}: key does not match its spec ({})",
                    key,
                    spec.key()
                )));
            }
            let url = e
                .get("albedo")
                .and_then(Value::as_str)
                .ok_or_else(|| err(format!("entry {}: missing albedo", key)))?;
            let b64 = url.strip_prefix("data:image/png;base64,").ok_or_else(|| {
                err(format!("entry {}: albedo must be a data:image/png;base64 URL", key))
            })?;
            let png =
                crate::render::decode_base64_str(b64, MAX_ALBEDO_PNG_BYTES).ok_or_else(|| {
                    err(format!("entry {}: albedo is not valid base64 or exceeds 2 MB", key))
                })?;
            let rgba = decode_albedo_png(&png, spec.size)
                .map_err(|m| err(format!("entry {}: {}", key, m)))?;
            let provenance = e.get("provenance").cloned().unwrap_or(Value::Null);
            pack.entries.insert(key.clone(), PackEntry { spec, rgba, provenance });
        }
        Ok(pack)
    }

    /// Serializes with entries sorted by key (deterministic output).
    pub fn to_json(&self) -> Result<Value, String> {
        let mut entries = Map::new();
        for (key, e) in &self.entries {
            let png = crate::render::encode_png_rgba_compressed(e.spec.size, e.spec.size, &e.rgba)?;
            let mut obj = json!({
                "spec": e.spec.to_json(),
                "albedo": format!("data:image/png;base64,{}", crate::mcp::encode_base64(&png)),
            });
            if !e.provenance.is_null() {
                obj["provenance"] = e.provenance.clone();
            }
            entries.insert(key.clone(), obj);
        }
        Ok(json!({
            "format": TEXTURE_PACK_FORMAT,
            "version": TEXTURE_PACK_VERSION,
            "entries": entries,
        }))
    }
}

/// Seam blend: crossfades each edge band (`n / 8`) with the image shifted by `n / 2` so the
/// texture wraps without a visible seam. Deterministic, but not part of the parity contract
/// (only stored pack albedos are).
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

/// Turns provider image bytes (PNG or JPEG) into a pack albedo: center-crop to square,
/// area-resample to `size`, force opaque, and seam-blend.
pub fn prepare_albedo(image: &[u8], size: u32) -> Result<Vec<u8>, String> {
    if image.len() > MAX_SOURCE_IMAGE_BYTES {
        return Err("generated image exceeds 16 MB".to_string());
    }
    let img = if image.len() >= 8 && &image[0..8] == b"\x89PNG\r\n\x1a\n" {
        crate::reference::decode_png(image)?
    } else if image.len() >= 3 && image[0] == 0xFF && image[1] == 0xD8 && image[2] == 0xFF {
        crate::reference::decode_jpeg(image)?
    } else {
        return Err("generated image must be PNG or JPEG".to_string());
    };
    let side = img.width.min(img.height);
    let (x0, y0) = ((img.width - side) / 2, (img.height - side) / 2);
    let mut square = Vec::with_capacity((side * side * 4) as usize);
    for y in 0..side {
        let row = (((y0 + y) * img.width + x0) * 4) as usize;
        square.extend_from_slice(&img.rgba[row..row + (side * 4) as usize]);
    }
    let sq = crate::reference::ReferenceImage { width: side, height: side, rgba: square };
    let mut rgba =
        if side == size { sq.rgba } else { crate::reference::resample_area(&sq, size, size) };
    for px in rgba.chunks_exact_mut(4) {
        px[3] = 255;
    }
    Ok(seam_blend(&rgba, size as usize))
}

/// Adds a generated image to `pack` under `spec` (replacing any existing entry).
pub fn add_generated_texture(
    pack: &mut TexturePack,
    spec: &TextureSpec,
    image: &[u8],
    provenance: Value,
) -> Result<String, String> {
    if pack.entries.len() >= MAX_PACK_ENTRIES && !pack.entries.contains_key(&spec.key()) {
        return Err(format!("texture pack is full ({} entries)", MAX_PACK_ENTRIES));
    }
    let rgba = prepare_albedo(image, spec.size)?;
    let key = spec.key();
    pack.entries.insert(key.clone(), PackEntry { spec: spec.clone(), rgba, provenance });
    Ok(key)
}

// ---------------------------------------------------------------------------------------------
// Compile-time lookups (thread-local active pack + native callable)
// ---------------------------------------------------------------------------------------------

/// One `userData.xr.material.prompt` encountered during a compile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextureLookup {
    pub key: String,
    pub spec: TextureSpec,
    pub hit: bool,
}

thread_local! {
    static ACTIVE_PACK: RefCell<Option<Rc<TexturePack>>> = const { RefCell::new(None) };
    // `None` outside `with_texture_pack`, so ordinary compiles never accumulate lookups.
    static LOOKUPS: RefCell<Option<Vec<TextureLookup>>> = const { RefCell::new(None) };
    // Per-compile token (0 outside `with_texture_pack`) so the JS side never reuses textures
    // memoized under a different pack on a cached engine.
    static ACTIVE_TOKEN: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

static NEXT_TOKEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Runs `f` with `pack` as the active texture pack and returns the lookups the compile made
/// (deduplicated by key, first-seen order). Nested calls restore the outer pack.
pub fn with_texture_pack<R>(
    pack: Option<Rc<TexturePack>>,
    f: impl FnOnce() -> R,
) -> (R, Vec<TextureLookup>) {
    let token = if pack.is_some() {
        NEXT_TOKEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    } else {
        0
    };
    let prev_token = ACTIVE_TOKEN.with(|t| t.replace(token));
    let prev_pack = ACTIVE_PACK.with(|p| p.replace(pack));
    let prev_lookups = LOOKUPS.with(|l| l.replace(Some(Vec::new())));
    let out = f();
    let lookups = LOOKUPS.with(|l| l.replace(prev_lookups)).unwrap_or_default();
    ACTIVE_PACK.with(|p| p.replace(prev_pack));
    ACTIVE_TOKEN.with(|t| t.set(prev_token));
    (out, lookups)
}

fn record_lookup(spec: &TextureSpec, key: &str, hit: bool) {
    LOOKUPS.with(|l| {
        let mut l = l.borrow_mut();
        let Some(l) = l.as_mut() else { return };
        if !l.iter().any(|x| x.key == key) {
            l.push(TextureLookup { key: key.to_string(), spec: spec.clone(), hit });
        }
    });
}

fn arg_f64(args: &[JsValue], i: usize, ctx: &mut Context) -> JsResult<f64> {
    Ok(args.get(i).map(|v| v.to_number(ctx)).transpose()?.unwrap_or(f64::NAN))
}

/// `__three_live_native_texture_pack__(prompt, size, seed, normalStrength, roughness,
/// metalness)` → `[albedo, normal, orm]` RGBA8 `Uint8Array`s on a pack hit, else `null`.
/// Records every lookup for the compile report.
pub fn native_texture_pack(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let prompt = match args.first() {
        Some(v) if v.is_string() => v.to_string(context)?.to_std_string_escaped(),
        _ => return Ok(JsValue::null()),
    };
    let size = arg_f64(args, 1, context)?;
    let seed = arg_f64(args, 2, context)?;
    let ns = arg_f64(args, 3, context)?;
    let rough = arg_f64(args, 4, context)?;
    let metal = arg_f64(args, 5, context)?;
    let Some(spec) = TextureSpec::new(&prompt, Some(size), Some(seed)) else {
        return Ok(JsValue::null());
    };
    let key = spec.key();
    let entry =
        ACTIVE_PACK.with(|p| p.borrow().as_ref().and_then(|pk| pk.entries.get(&key).cloned()));
    record_lookup(&spec, &key, entry.is_some());
    let Some(entry) = entry else {
        return Ok(JsValue::null());
    };
    let n = entry.spec.size as usize;
    let (normal, orm) = derive_texture_maps(&entry.rgba, n, ns, rough, metal);
    let mk = |bytes: &[u8], ctx: &mut Context| -> JsResult<JsValue> {
        Ok(crate::usdz::js_uint8_array_from_slice(bytes, ctx)?.into())
    };
    let a = mk(&entry.rgba, context)?;
    let nm = mk(&normal, context)?;
    let o = mk(&orm, context)?;
    Ok(JsArray::from_iter([a, nm, o], context).into())
}

/// `__three_live_native_texture_pack_token__()` → the active compile's pack token (0 = no pack).
pub fn native_texture_pack_token(
    _this: &JsValue,
    _args: &[JsValue],
    _context: &mut Context,
) -> JsResult<JsValue> {
    Ok(JsValue::from(ACTIVE_TOKEN.with(|t| t.get()) as f64))
}

/// Registers `__three_live_native_texture_pack__` and `__three_live_native_texture_pack_token__`.
pub fn register_native_texture_callables(context: &mut Context) -> JsResult<()> {
    context.register_global_builtin_callable(
        js_string!("__three_live_native_texture_pack__"),
        6,
        NativeFunction::from_fn_ptr(native_texture_pack),
    )?;
    context.register_global_builtin_callable(
        js_string!("__three_live_native_texture_pack_token__"),
        0,
        NativeFunction::from_fn_ptr(native_texture_pack_token),
    )
}

// ---------------------------------------------------------------------------------------------
// `ai_call` ops (mobile apps reuse the Rust implementation)
// ---------------------------------------------------------------------------------------------

fn decode_b64_arg(req: &Value, field: &str, max: usize) -> Result<Vec<u8>, String> {
    let s = req.get(field).and_then(Value::as_str).ok_or_else(|| format!("missing '{}'", field))?;
    let s = s.split_once(";base64,").map(|(_, b)| b).unwrap_or(s);
    crate::render::decode_base64_str(s, max)
        .ok_or_else(|| format!("'{}' is not valid base64", field))
}

/// `{"op": "texture_key", "prompt", "size"?, "seed"?}` → `{"key", "spec"}`.
pub fn texture_key_call(req: &Value) -> Value {
    match TextureSpec::from_json(req) {
        Some(spec) => json!({"key": spec.key(), "spec": spec.to_json()}),
        None => json!({"error": format!(
            "prompt must be a non-empty string of at most {} characters",
            MAX_TEXTURE_PROMPT_CHARS
        )}),
    }
}

/// `{"op": "texture_pack_validate", "pack": {...} | "..."}` → `{"ok", "keys", "error"?}`.
pub fn texture_pack_validate_call(req: &Value) -> Value {
    let parsed = match req.get("pack") {
        Some(Value::String(s)) => TexturePack::from_json_str(s),
        Some(v) => TexturePack::from_json(v),
        None => Err("missing 'pack'".to_string()),
    };
    match parsed {
        Ok(p) => json!({"ok": true, "keys": p.entries.keys().collect::<Vec<_>>()}),
        Err(e) => json!({"ok": false, "keys": [], "error": e}),
    }
}

/// `{"op": "texture_pack_add", "pack"?, "spec": {...}, "image": base64 PNG/JPEG,
/// "provenance"?}` → `{"key", "pack"}` with the prepared (cropped, resized, seam-blended) entry.
pub fn texture_pack_add_call(req: &Value) -> Value {
    let run = || -> Result<Value, String> {
        let mut pack = match req.get("pack") {
            None | Some(Value::Null) => TexturePack::default(),
            Some(Value::String(s)) => TexturePack::from_json_str(s)?,
            Some(v) => TexturePack::from_json(v)?,
        };
        let spec = req
            .get("spec")
            .and_then(TextureSpec::from_json)
            .ok_or_else(|| "invalid 'spec'".to_string())?;
        let image = decode_b64_arg(req, "image", MAX_SOURCE_IMAGE_BYTES)?;
        let provenance = req.get("provenance").cloned().unwrap_or(Value::Null);
        let key = add_generated_texture(&mut pack, &spec, &image, provenance)?;
        Ok(json!({"key": key, "pack": pack.to_json()?}))
    };
    run().unwrap_or_else(|e| json!({"error": e}))
}

/// `{"op": "texture_derive", "albedo": base64 RGBA8, "size", "normalStrength"?, "roughness"?,
/// "metalness"?}` → `{"normal", "orm"}` (base64 RGBA8).
pub fn texture_derive_call(req: &Value) -> Value {
    let run = || -> Result<Value, String> {
        let size = req.get("size").and_then(Value::as_u64).ok_or("missing 'size'")? as usize;
        if !(4..=512).contains(&size) {
            return Err("size must be in 4..=512".to_string());
        }
        let albedo = decode_b64_arg(req, "albedo", size * size * 4)?;
        if albedo.len() != size * size * 4 {
            return Err(format!("albedo must be {} bytes of RGBA8", size * size * 4));
        }
        let f = |k: &str, d: f64| req.get(k).and_then(Value::as_f64).unwrap_or(d);
        let (normal, orm) = derive_texture_maps(
            &albedo,
            size,
            f("normalStrength", 1.0),
            f("roughness", 0.8),
            f("metalness", 0.0),
        );
        Ok(json!({
            "normal": crate::mcp::encode_base64(&normal),
            "orm": crate::mcp::encode_base64(&orm),
        }))
    };
    run().unwrap_or_else(|e| json!({"error": e}))
}

/// Deterministic synthetic albedos shared with `three-live/tests/three_procedural_test.ts`
/// (`texture_cases.json`): 0 = gradient, 1 = checker, 2 = hash noise.
pub fn synthetic_albedo(kind: u32, n: usize) -> Vec<u8> {
    let mut out = vec![0u8; n * n * 4];
    for y in 0..n {
        for x in 0..n {
            let o = (y * n + x) * 4;
            let (r, g, b) = match kind {
                0 => (((x * 8) & 255) as u8, ((y * 8) & 255) as u8, (((x + y) * 4) & 255) as u8),
                1 => {
                    let on = ((x >> 2) + (y >> 2)) & 1 == 1;
                    if on {
                        (220, 200, 180)
                    } else {
                        (40, 50, 60)
                    }
                }
                _ => {
                    let h =
                        (x as u32).wrapping_mul(73_856_093) ^ (y as u32).wrapping_mul(19_349_663);
                    ((h & 255) as u8, ((h >> 8) & 255) as u8, ((h >> 16) & 255) as u8)
                }
            };
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = 255;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::material_preset::fnv1a32;

    const CASES: &str = include_str!("../../three-live/tests/fixtures/texture_cases.json");

    #[test]
    fn keys_match_the_shared_fixture() {
        let cases: Value = serde_json::from_str(CASES).unwrap();
        for c in cases["keys"].as_array().unwrap() {
            let spec = TextureSpec::new(
                c["prompt"].as_str().unwrap(),
                c.get("size").and_then(Value::as_f64),
                c.get("seed").and_then(Value::as_f64),
            );
            match c.get("key").and_then(Value::as_str) {
                Some(k) => {
                    let spec = spec.unwrap_or_else(|| panic!("spec rejected: {}", c));
                    assert_eq!(spec.prompt, c["canonicalPrompt"].as_str().unwrap(), "{}", c);
                    assert_eq!(spec.size as u64, c["canonicalSize"].as_u64().unwrap(), "{}", c);
                    assert_eq!(spec.seed as u64, c["canonicalSeed"].as_u64().unwrap(), "{}", c);
                    assert_eq!(spec.key(), k, "{}", c);
                }
                None => assert!(spec.is_none(), "expected rejection: {}", c),
            }
        }
    }

    #[test]
    fn derived_maps_match_the_shared_fixture() {
        let cases: Value = serde_json::from_str(CASES).unwrap();
        for c in cases["derive"].as_array().unwrap() {
            let n = c["size"].as_u64().unwrap() as usize;
            let albedo = synthetic_albedo(c["albedo"].as_u64().unwrap() as u32, n);
            let (normal, orm) = derive_texture_maps(
                &albedo,
                n,
                c["normalStrength"].as_f64().unwrap(),
                c["roughness"].as_f64().unwrap(),
                c["metalness"].as_f64().unwrap(),
            );
            let got = [fnv1a32(&albedo), fnv1a32(&normal), fnv1a32(&orm)];
            let want: Vec<u32> = c["hashes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_u64().unwrap() as u32)
                .collect();
            assert_eq!(got.to_vec(), want, "{}", c["name"]);
        }
    }

    #[test]
    fn flat_albedo_gives_flat_normals_and_mid_roughness() {
        let albedo = vec![128u8; 16 * 16 * 4];
        let (normal, orm) = derive_texture_maps(&albedo, 16, 1.0, 0.6, 1.0);
        assert!(normal.chunks_exact(4).all(|p| p == [128, 128, 255, 255]));
        assert!(orm.chunks_exact(4).all(|p| p == [255, unit_to_byte(0.6), 255, 255]));
    }

    #[test]
    fn pack_round_trips_and_rejects_tampering() {
        let spec = TextureSpec::new("  mossy\tstone  ", Some(256.0), Some(3.0)).unwrap();
        let img = synthetic_albedo(2, 300);
        let png = crate::render::encode_png_rgba_compressed(300, 300, &img).unwrap();
        let mut pack = TexturePack::default();
        let key = add_generated_texture(&mut pack, &spec, &png, json!({"model": "test"})).unwrap();
        assert_eq!(key, spec.key());
        let text = pack.to_json().unwrap().to_string();
        let back = TexturePack::from_json_str(&text).unwrap();
        assert_eq!(back.entries[&key].rgba, pack.entries[&key].rgba);
        assert_eq!(back.entries[&key].provenance["model"], "test");
        // Determinism of serialization.
        assert_eq!(back.to_json().unwrap().to_string(), text);

        let mut v: Value = serde_json::from_str(&text).unwrap();
        v["entries"][&key]["spec"]["seed"] = json!(4);
        assert!(TexturePack::from_json(&v).unwrap_err().contains("does not match"));
        let mut v: Value = serde_json::from_str(&text).unwrap();
        v["version"] = json!(2);
        assert!(TexturePack::from_json(&v).is_err());
        let mut v: Value = serde_json::from_str(&text).unwrap();
        v["entries"][&key]["albedo"] = json!("data:image/jpeg;base64,AAAA");
        assert!(TexturePack::from_json(&v).is_err());
    }

    #[test]
    fn seam_blend_wraps_edges() {
        let n = 64;
        // A smooth ramp with a hard seam at the wrap (x = 63 → 0, y = 63 → 0).
        let mut img = vec![0u8; n * n * 4];
        for y in 0..n {
            for x in 0..n {
                let o = (y * n + x) * 4;
                img[o..o + 4].copy_from_slice(&[(x * 3) as u8, (y * 3) as u8, 128, 255]);
            }
        }
        let raw_seam = (img[0] as i32 - img[(n - 1) * 4] as i32).abs();
        assert!(raw_seam > 150);
        let out = seam_blend(&img, n);
        // Left/right and top/bottom edge texels come from the half-shifted image, whose
        // neighbours across the wrap are adjacent texels of the original.
        let px = |x: usize, y: usize| &out[(y * n + x) * 4..(y * n + x) * 4 + 3];
        for y in 0..n {
            let (a, b) = (px(0, y), px(n - 1, y));
            for c in 0..3 {
                assert!(
                    (a[c] as i32 - b[c] as i32).abs() <= 16,
                    "row {} c {}: {:?} vs {:?}",
                    y,
                    c,
                    a,
                    b
                );
            }
        }
    }

    #[test]
    fn native_lookup_records_hits_and_misses() {
        let spec = TextureSpec::new("brick", Some(256.0), Some(1.0)).unwrap();
        let mut pack = TexturePack::default();
        pack.entries.insert(
            spec.key(),
            PackEntry {
                spec: spec.clone(),
                rgba: synthetic_albedo(1, 256),
                provenance: Value::Null,
            },
        );
        let (_, lookups) = with_texture_pack(Some(Rc::new(pack)), || {
            let mut ctx = Context::default();
            register_native_texture_callables(&mut ctx).unwrap();
            let hit = ctx
                .eval(boa_engine::Source::from_bytes(
                    "__three_live_native_texture_pack__('  brick ', 256, 1, 1, 0.8, 0)[1].length",
                ))
                .unwrap();
            assert_eq!(hit.as_number(), Some((256 * 256 * 4) as f64));
            let miss = ctx
                .eval(boa_engine::Source::from_bytes(
                    "__three_live_native_texture_pack__('marble', 512, 1, 1, 0.8, 0)",
                ))
                .unwrap();
            assert!(miss.is_null());
        });
        assert_eq!(lookups.len(), 2);
        assert!(lookups[0].hit && !lookups[1].hit);
        assert_eq!(lookups[1].spec.prompt, "marble");
    }

    #[test]
    fn ai_call_ops_round_trip() {
        let k = texture_key_call(&json!({"prompt": "a  b", "size": 900, "seed": -2.5}));
        assert_eq!(k["spec"], json!({"prompt": "a b", "size": 512, "seed": 3}));
        assert!(texture_key_call(&json!({"prompt": "   "}))["error"].is_string());
        let albedo = crate::mcp::encode_base64(&synthetic_albedo(2, 8));
        let d = texture_derive_call(&json!({"albedo": albedo, "size": 8}));
        assert!(d["normal"].is_string() && d["orm"].is_string(), "{}", d);
        let png = crate::render::encode_png_rgba_compressed(8, 8, &synthetic_albedo(1, 8)).unwrap();
        let added = texture_pack_add_call(&json!({
            "spec": {"prompt": "tiles", "size": 256},
            "image": crate::mcp::encode_base64(&png),
        }));
        assert!(added["key"].is_string(), "{}", added);
        let v = texture_pack_validate_call(&json!({"pack": added["pack"]}));
        assert_eq!(v["ok"], true, "{}", v);
    }
}
