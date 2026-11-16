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

//! three-live-compiler: In-process Pure Rust Three.js to binary GLB compiler.

#[cfg(feature = "boa")]
pub mod ai_edit;
#[cfg(feature = "boa")]
pub mod ai_image;
#[cfg(feature = "boa")]
pub mod ai_select;
#[cfg(feature = "boa")]
pub mod ai_texture;
#[cfg(feature = "boa")]
pub mod ai_voice;
pub mod constants;
#[cfg(feature = "boa")]
pub mod engine;
#[cfg(feature = "boa")]
pub mod ffi;
pub mod geometry;
#[cfg(feature = "boa")]
pub mod glb;
#[cfg(feature = "boa")]
pub mod gym;
pub mod kernels;
pub mod material_preset;
#[cfg(feature = "boa")]
pub mod mcp;
#[cfg(feature = "boa")]
pub mod reference;
#[cfg(feature = "boa")]
pub mod render;
#[cfg(feature = "boa")]
pub mod scene;
#[cfg(feature = "boa")]
pub mod scene_link;
#[cfg(feature = "boa")]
pub mod sim;
#[cfg(feature = "boa")]
pub mod spatial_lint;
#[cfg(feature = "boa")]
pub mod time;
#[cfg(feature = "boa")]
pub mod tsl;
pub mod usdz;

#[cfg(all(feature = "boa", target_arch = "wasm32"))]
pub mod wasm;

#[cfg(feature = "jni")]
pub mod jni;

pub use constants::*;
pub use geometry::*;
pub use kernels::{
    three_live_kernel_free, three_live_kernels_abi_version, three_live_kernels_table,
    ThreeLiveKernelBuffer, ThreeLiveKernelDescriptor, ThreeLiveKernelSlice,
    THREE_LIVE_KERNELS_ABI_VERSION,
};
pub use usdz::*;

#[cfg(feature = "boa")]
mod boa_api {
    use std::cell::RefCell;

    pub use crate::engine::{classify_script_error, ThreeEngine};
    pub use crate::glb::read_glb;
    pub use crate::mcp::*;
    pub use crate::reference::{
        compare_scene_to_reference, decode_reference_image, encode_rgba_png_data_url,
        format_reference_metrics_note, load_reference_bytes, ReferenceComparison, ReferenceImage,
        ReferenceMetrics,
    };
    pub use crate::render::*;
    pub use crate::scene::{CameraConfig, Diagnostic, SceneGraph};
    pub use crate::sim::*;
    pub use crate::spatial_lint::*;
    pub use crate::tsl::*;

    #[cfg(any(feature = "wasm", target_arch = "wasm32"))]
    pub use crate::wasm::*;

    /// Convenience aliases for the main compilation entry points.
    pub use super::transcode_three_to_glb as compile_three_to_glb;
    pub use super::transcode_three_to_usdz as compile_three_to_usdz;

    struct TlsEngineSlot(std::mem::ManuallyDrop<Option<ThreeEngine>>);

    impl TlsEngineSlot {
        const fn new() -> Self {
            Self(std::mem::ManuallyDrop::new(None))
        }
        fn as_mut(&mut self) -> &mut Option<ThreeEngine> {
            &mut self.0
        }
        fn clear(&mut self) {
            // Explicitly drops ThreeEngine during normal execution while boa_gc TLS is alive.
            let _ = self.0.take();
        }
    }

    thread_local! {
        static THREAD_LOCAL_CACHE_ENABLED: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
        static THREAD_LOCAL_ENGINE: RefCell<TlsEngineSlot> = const { RefCell::new(TlsEngineSlot::new()) };
    }

    /// Sets whether thread-local ThreeEngine VM caching is enabled for the current thread.
    pub fn set_thread_local_cache_enabled(enabled: bool) {
        THREAD_LOCAL_CACHE_ENABLED.with(|c| c.set(enabled));
        if !enabled {
            clear_thread_local_engine();
        }
    }

    /// Returns whether thread-local ThreeEngine VM caching is enabled for the current thread.
    pub fn is_thread_local_cache_enabled() -> bool {
        THREAD_LOCAL_CACHE_ENABLED.with(|c| c.get())
    }

    /// Clears the thread-local engine for the current thread to reclaim memory.
    pub fn clear_thread_local_engine() {
        THREAD_LOCAL_ENGINE.with(|cell| {
            cell.borrow_mut().clear();
        });
    }

    fn panic_payload_message(err: &(dyn std::any::Any + Send)) -> String {
        if let Some(s) = err.downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = err.downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        }
    }

    /// Pre-warms the thread-local Boa context if thread-local caching is enabled.
    pub fn prewarm_thread_local_engine() -> Result<(), String> {
        if !is_thread_local_cache_enabled() {
            return Ok(());
        }
        THREAD_LOCAL_ENGINE.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.as_mut().is_none() {
                let init_res =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(ThreeEngine::new));
                match init_res {
                    Ok(Ok(eng)) => *slot.as_mut() = Some(eng),
                    Ok(Err(e)) => return Err(e),
                    Err(panic_err) => {
                        return Err(format!(
                            "3D Transcoder failed to prewarm ThreeEngine (internal panic: {})",
                            panic_payload_message(&*panic_err)
                        ))
                    }
                }
            }
            Ok(())
        })
    }

    /// Executes a function using either the cached thread-local ThreeEngine (if caching is enabled)
    /// or a transient ThreeEngine fallback. If an error occurs in the cached engine, the engine
    /// is discarded to ensure a clean VM on subsequent calls.
    pub fn with_three_engine<F, R>(f: F) -> Result<R, String>
    where
        F: FnOnce(&mut ThreeEngine) -> Result<R, String>,
    {
        if is_thread_local_cache_enabled() {
            THREAD_LOCAL_ENGINE.with(|cell| {
                let mut slot = cell.borrow_mut();
                if slot.as_mut().is_none() {
                    let init_res =
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(ThreeEngine::new));
                    match init_res {
                        Ok(Ok(eng)) => *slot.as_mut() = Some(eng),
                        Ok(Err(e)) => return Err(e),
                        Err(panic_err) => {
                            return Err(format!(
                                "3D Transcoder failed to initialize ThreeEngine (internal panic: {})",
                                panic_payload_message(&*panic_err)
                            ));
                        }
                    }
                }
                let engine = slot.as_mut().as_mut().unwrap();
                let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(engine)));
                match panic_res {
                    Ok(Ok(res)) => Ok(res),
                    Ok(Err(err)) => {
                        slot.clear();
                        Err(err)
                    }
                    Err(panic_err) => {
                        slot.clear();
                        Err(format!(
                            "3D Transcoder encountered an internal panic ({}); safely recovered",
                            panic_payload_message(&*panic_err)
                        ))
                    }
                }
            })
        } else {
            let init_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(ThreeEngine::new));
            let mut engine = match init_res {
                Ok(Ok(eng)) => eng,
                Ok(Err(e)) => return Err(e),
                Err(panic_err) => {
                    return Err(format!(
                        "3D Transcoder failed to initialize ThreeEngine (internal panic: {})",
                        panic_payload_message(&*panic_err)
                    ));
                }
            };
            let panic_res =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&mut engine)));
            match panic_res {
                Ok(res) => res,
                Err(panic_err) => Err(format!(
                    "3D Transcoder encountered an internal panic ({}); safely recovered",
                    panic_payload_message(&*panic_err)
                )),
            }
        }
    }
}

#[cfg(feature = "boa")]
pub use boa_api::*;

#[cfg(feature = "boa")]
#[derive(Debug, Clone, Default)]
pub struct ConversionResult {
    pub success: bool,
    pub glb_bytes: Vec<u8>,
    pub error_message: String,
}

/// Transcodes a Three.js scene-building script into binary GLB wire bytes via the unified
/// TypeScript `sceneToGLB` serializer.
/// Compatible with Crubit cc_bindings_from_rust.
#[cfg(feature = "boa")]
pub fn transcode_three_to_glb(script: &str) -> Result<Vec<u8>, String> {
    with_three_engine(|engine| engine.compile_glb(script))
}

/// Validates a Three.js script without serializing full GLB buffers.
#[cfg(feature = "boa")]
pub fn validate_three_script(script: &str) -> Result<SceneGraph, String> {
    with_three_engine(|engine| engine.execute(script))
}

/// Transcodes a Three.js scene-building script into an Apple 64-byte aligned binary USDZ archive.
#[cfg(feature = "boa")]
pub fn transcode_three_to_usdz(script: &str) -> Result<Vec<u8>, String> {
    with_three_engine(|engine| engine.compile_usdz(script))
}

/// Transcodes a binary glTF 2.0 (GLB) buffer into an Apple 64-byte aligned binary USDZ archive.
#[cfg(feature = "boa")]
pub fn transcode_glb_to_usdz(glb: &[u8]) -> Result<Vec<u8>, String> {
    with_three_engine(|engine| engine.glb_to_usdz(glb))
}

/// Returns `true` when `source` or `filename` looks like an HTML document containing
/// `<three-live>`, `<xr-live>`, or `<script type="text/three">`.
#[cfg(feature = "boa")]
mod html_lint {
    use super::*;

    pub fn is_html_source(source: &str, filename: &str) -> bool {
        let lower_name = filename.to_ascii_lowercase();
        if lower_name.ends_with(".html") || lower_name.ends_with(".htm") {
            return true;
        }
        let trimmed = source.trim_start();
        if trimmed.starts_with("<!DOCTYPE")
            || trimmed.starts_with("<!doctype")
            || trimmed.starts_with("<html")
            || trimmed.starts_with("<three-live")
            || trimmed.starts_with("<xr-live")
        {
            return true;
        }
        let lower_src = source.to_ascii_lowercase();
        lower_src.contains("<three-live")
            || lower_src.contains("<xr-live")
            || lower_src.contains("type=\"text/three\"")
            || lower_src.contains("type='text/three'")
    }

    const XR_ONLY_ATTRS: &[&str] = &[
        "xr-mode",
        "xr-depth",
        "xr-hands",
        "xr-hit-test",
        "xr-planes",
        "xr-meshes",
        "xr-anchors",
        "xr-lighting",
        "xr-dom-overlay",
        "spatial-measure",
        "shared-room",
        "room-id",
        "signaling-url",
        "voice",
        "passthrough",
    ];

    const XR_ONLY_PLUGINS: &[&str] = &[
        "xr-depth",
        "xr-hands",
        "spatial-measure",
        "shared-room",
        "world-understanding",
        "gaussian-splats",
        "persistent-anchors",
        "gaze-dwell",
        "magnetic-snap",
        "exploded-view",
        "spatial-locomotion",
        "spatial-audio",
        "character-controller",
        "steering-agents",
        "hit-zones",
        "objectives",
        "synth-audio",
    ];

    fn find_tag_end(s: &str, start: usize) -> Option<usize> {
        let bytes = s.as_bytes();
        let mut in_quote: Option<u8> = None;
        let mut i = start;
        while i < bytes.len() {
            let b = bytes[i];
            if let Some(q) = in_quote {
                if b == q {
                    in_quote = None;
                }
            } else if b == b'"' || b == b'\'' {
                in_quote = Some(b);
            } else if b == b'>' {
                return Some(i);
            }
            i += 1;
        }
        None
    }

    /// Parses an opening HTML tag `<tag ...>` into `(attr_name_lower, Option<attr_value>)` pairs,
    /// properly respecting single- and double-quoted attribute values.
    fn parse_open_tag_attrs(open_tag: &str) -> Vec<(String, Option<String>)> {
        let mut attrs = Vec::new();
        let bytes = open_tag.as_bytes();
        let mut i = 0usize;
        // Skip `<tag_name`
        while i < bytes.len()
            && !bytes[i].is_ascii_whitespace()
            && bytes[i] != b'>'
            && bytes[i] != b'/'
        {
            i += 1;
        }
        while i < bytes.len() {
            while i < bytes.len()
                && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/' || bytes[i] == b'>')
            {
                i += 1;
            }
            if i >= bytes.len() {
                break;
            }
            let name_start = i;
            while i < bytes.len()
                && !bytes[i].is_ascii_whitespace()
                && bytes[i] != b'='
                && bytes[i] != b'>'
                && bytes[i] != b'/'
            {
                i += 1;
            }
            if i == name_start {
                i += 1;
                continue;
            }
            let name = open_tag[name_start..i].to_ascii_lowercase();
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'=' {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                    let quote = bytes[i];
                    i += 1;
                    let val_start = i;
                    while i < bytes.len() && bytes[i] != quote {
                        i += 1;
                    }
                    let val = open_tag[val_start..i].to_string();
                    if i < bytes.len() {
                        i += 1;
                    }
                    attrs.push((name, Some(val)));
                } else {
                    let val_start = i;
                    while i < bytes.len()
                        && !bytes[i].is_ascii_whitespace()
                        && bytes[i] != b'>'
                        && bytes[i] != b'/'
                    {
                        i += 1;
                    }
                    let val = open_tag[val_start..i].to_string();
                    attrs.push((name, Some(val)));
                }
            } else {
                attrs.push((name, None));
            }
        }
        attrs
    }

    fn strip_html_comments(html: &str) -> String {
        let mut out = String::with_capacity(html.len());
        let mut rest = html;
        while let Some(start) = rest.find("<!--") {
            out.push_str(&rest[..start]);
            let after_start = &rest[start + 4..];
            if let Some(end) = after_start.find("-->") {
                // Preserve newlines so line numbers remain stable if needed
                for ch in after_start[..end].chars() {
                    if ch == '\n' {
                        out.push('\n');
                    }
                }
                rest = &after_start[end + 3..];
            } else {
                return out;
            }
        }
        out.push_str(rest);
        out
    }

    fn extract_three_scripts_from_fragment(fragment: &str) -> Vec<String> {
        let mut scripts = Vec::new();
        let lower = fragment.to_ascii_lowercase();
        let mut cursor = 0usize;
        while let Some(rel) = lower[cursor..].find("<script") {
            let tag_start = cursor + rel;
            let Some(tag_end) = find_tag_end(&lower, tag_start + 7) else {
                break;
            };
            let open_tag = &fragment[tag_start..=tag_end];
            let attrs = parse_open_tag_attrs(open_tag);
            let is_three = attrs.iter().any(|(k, v)| {
                k == "type"
                    && v.as_deref()
                        .map(|s| s.trim().eq_ignore_ascii_case("text/three"))
                        .unwrap_or(false)
            });
            let content_start = tag_end + 1;
            if let Some(close_rel) = lower[content_start..].find("</script") {
                let content_end = content_start + close_rel;
                if is_three {
                    scripts.push(fragment[content_start..content_end].to_string());
                }
                cursor = content_end + 8;
            } else {
                break;
            }
        }
        scripts
    }

    #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
    struct HtmlCapMask {
        scripts: bool,
        network: bool,
        remote_content: bool,
        camera: bool,
        microphone: bool,
        sensors: bool,
        storage: bool,
        ai: bool,
        external_handoff: bool,
    }

    impl HtmlCapMask {
        fn parse(raw_caps: Option<&str>, allow_client_scripts_attr: Option<Option<&str>>) -> Self {
            let mut mask = Self::default();
            if let Some(opt_val) = allow_client_scripts_attr {
                if opt_val.map(|v| !v.trim().eq_ignore_ascii_case("false")).unwrap_or(true) {
                    mask.scripts = true;
                }
            }
            if let Some(spec) = raw_caps {
                for raw in spec.split_whitespace() {
                    if raw.is_empty() {
                        continue;
                    }
                    let neg = raw.len() > 1 && raw.starts_with('-');
                    let tok = if neg { &raw[1..] } else { raw };
                    let val = !neg;
                    let head = tok.split('@').next().unwrap_or(tok);
                    let name = head
                        .split(':')
                        .next()
                        .unwrap_or(head)
                        .to_ascii_lowercase()
                        .replace('-', "_");
                    match name.as_str() {
                        "none" if val => mask = Self::default(),
                        "all" | "*" => {
                            mask = Self {
                                scripts: val,
                                network: val,
                                remote_content: val,
                                camera: val,
                                microphone: val,
                                sensors: val,
                                storage: val,
                                ai: val,
                                external_handoff: val,
                            };
                        }
                        "viewer" => {
                            mask.network = val;
                            mask.remote_content = val;
                            mask.camera = val;
                            mask.external_handoff = val;
                        }
                        "scripts" => mask.scripts = val,
                        "network" => mask.network = val,
                        "remote_content" => mask.remote_content = val,
                        "camera" => mask.camera = val,
                        "microphone" => mask.microphone = val,
                        "sensors" => mask.sensors = val,
                        "storage" => mask.storage = val,
                        "ai" => mask.ai = val,
                        "external_handoff" => mask.external_handoff = val,
                        _ => {}
                    }
                }
            }
            mask
        }
    }

    fn is_non_network_html_url(raw: &str) -> bool {
        let trimmed = raw.trim().to_ascii_lowercase();
        trimmed.is_empty()
            || trimmed.starts_with("data:")
            || trimmed.starts_with("blob:")
            || trimmed.starts_with("asset:")
            || trimmed.starts_with("file:")
            || trimmed.starts_with("content:")
            || trimmed.starts_with("android.resource:")
    }

    fn lint_html_element_capabilities(
        tag_name: &str,
        attrs: &[(String, Option<String>)],
        caps: HtmlCapMask,
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        let find_attr = |name: &str| -> Option<Option<&str>> {
            attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_deref())
        };
        let bool_enabled = |name: &str| -> bool {
            find_attr(name)
                .map(|v| v.map(|s| !s.trim().eq_ignore_ascii_case("false")).unwrap_or(true))
                .unwrap_or(false)
        };
        let mode_enabled = |name: &str| -> bool {
            find_attr(name)
                .map(|v| {
                    v.map(|s| {
                        let t = s.trim();
                        !t.is_empty()
                            && !t.eq_ignore_ascii_case("none")
                            && !t.eq_ignore_ascii_case("false")
                            && !t.eq_ignore_ascii_case("off")
                    })
                    .unwrap_or(true)
                })
                .unwrap_or(false)
        };

        let mut push_missing = |feature: &str, missing: &[&str]| {
            if missing.is_empty() {
                return;
            }
            let list = missing.join(" ");
            diagnostics.push(Diagnostic {
                code: "TL403".to_string(),
                severity: "warning".to_string(),
                message: format!(
                    "<{}> declares '{}' without granting required capability '{}' in capabilities.",
                    tag_name, feature, list
                ),
                node: None,
                line: None,
                column: None,
                hint: Some(format!(
                    "Add '{}' to <{} capabilities=\"...\"> so '{}' is permitted at runtime.",
                    list, tag_name, feature
                )),
            });
        };

        if let Some(opt_val) = find_attr("script-src") {
            let mut missing = Vec::new();
            if !caps.scripts {
                missing.push("scripts");
            }
            if let Some(url) = opt_val.filter(|u| !is_non_network_html_url(u)) {
                let _ = url;
                if !caps.remote_content {
                    missing.push("remote_content");
                }
                if !caps.network {
                    missing.push("network");
                }
            }
            push_missing("script-src", &missing);
        }

        for url_attr in ["src", "ios-src", "poster", "texture-pack"] {
            if let Some(Some(url)) = find_attr(url_attr) {
                if !is_non_network_html_url(url) {
                    let mut missing = Vec::new();
                    if !caps.remote_content {
                        missing.push("remote_content");
                    }
                    if !caps.network {
                        missing.push("network");
                    }
                    push_missing(url_attr, &missing);
                }
            }
        }

        for env_attr in ["environment-image", "skybox-image"] {
            if let Some(Some(url)) = find_attr(env_attr) {
                let t = url.trim();
                let builtin = t.eq_ignore_ascii_case("neutral")
                    || t.eq_ignore_ascii_case("legacy")
                    || t.eq_ignore_ascii_case("none");
                if !builtin && !is_non_network_html_url(t) {
                    let mut missing = Vec::new();
                    if !caps.remote_content {
                        missing.push("remote_content");
                    }
                    if !caps.network {
                        missing.push("network");
                    }
                    push_missing(env_attr, &missing);
                }
            }
        }

        let xr_mode = find_attr("xr-mode").and_then(|v| v).map(|v| v.trim());
        let explicit_ar_mode = xr_mode.map(|v| v.eq_ignore_ascii_case("ar")).unwrap_or(false);
        let explicit_vr_mode = xr_mode.map(|v| v.eq_ignore_ascii_case("vr")).unwrap_or(false);
        if (bool_enabled("ar") || explicit_ar_mode) && !caps.camera && !caps.external_handoff {
            let feat = if bool_enabled("ar") { "ar" } else { "xr-mode=\"ar\"" };
            push_missing(feat, &["camera"]);
        }
        if explicit_vr_mode && !caps.sensors {
            push_missing("xr-mode=\"vr\"", &["sensors"]);
        }

        for sensor_attr in ["xr-depth", "xr-hands", "world-understanding", "depth-particles"] {
            if mode_enabled(sensor_attr) && !caps.sensors {
                push_missing(sensor_attr, &["sensors"]);
            }
        }
        if bool_enabled("webmcp-allow-depth") && !caps.sensors {
            push_missing("webmcp-allow-depth", &["sensors"]);
        }

        if bool_enabled("allow-remote-splats") {
            let mut missing = Vec::new();
            if !caps.remote_content {
                missing.push("remote_content");
            }
            if !caps.network {
                missing.push("network");
            }
            push_missing("allow-remote-splats", &missing);
        }

        if mode_enabled("shared-room") && !caps.network {
            push_missing("shared-room", &["network"]);
        }
        if bool_enabled("shared-room-voice") {
            let mut missing = Vec::new();
            if !caps.network {
                missing.push("network");
            }
            if !caps.microphone {
                missing.push("microphone");
            }
            push_missing("shared-room-voice", &missing);
        }

        if mode_enabled("persistent-anchors") && !caps.storage {
            push_missing("persistent-anchors", &["storage"]);
        }
        if bool_enabled("persist-url-hash") && !caps.storage {
            push_missing("persist-url-hash", &["storage"]);
        }

        for ai_attr in ["ai-endpoint", "ai-image-endpoint"] {
            if let Some(Some(v)) = find_attr(ai_attr) {
                if !v.trim().is_empty() {
                    let mut missing = Vec::new();
                    if !caps.scripts {
                        missing.push("scripts");
                    }
                    if !caps.ai {
                        missing.push("ai");
                    }
                    if !caps.network {
                        missing.push("network");
                    }
                    push_missing(ai_attr, &missing);
                }
            }
        }

        if bool_enabled("ai-voice-button") || mode_enabled("ai-voice-url") {
            let feat =
                if bool_enabled("ai-voice-button") { "ai-voice-button" } else { "ai-voice-url" };
            let mut missing = Vec::new();
            if !caps.scripts {
                missing.push("scripts");
            }
            if !caps.ai {
                missing.push("ai");
            }
            if !caps.network {
                missing.push("network");
            }
            if !caps.microphone {
                missing.push("microphone");
            }
            push_missing(feat, &missing);
        }
    }

    fn lint_scene_traits_against_html_capabilities(
        scene: &SceneGraph,
        caps: HtmlCapMask,
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        let mut push_trait_missing = |node_name: &str, trait_name: &str, missing: &[&str]| {
            if missing.is_empty() {
                return;
            }
            let list = missing.join(" ");
            diagnostics.push(Diagnostic {
            code: "TL403".to_string(),
            severity: "warning".to_string(),
            message: format!(
                "Node '{}' uses 'userData.xr.{}' without host capability '{}'.",
                node_name, trait_name, list
            ),
            node: if node_name.is_empty() { None } else { Some(node_name.to_string()) },
            line: None,
            column: None,
            hint: Some(format!(
                "Grant '{}' in the host element's capabilities attribute to enable 'userData.xr.{}'.",
                list, trait_name
            )),
        });
        };

        for node in &scene.nodes {
            let Some(xr) = node.xr_normalized.as_ref().or(node.xr_traits.as_ref()) else {
                continue;
            };
            let Some(obj) = xr.as_object() else {
                continue;
            };
            if let Some(splat_url) = obj.get("splatUrl").and_then(|v| v.as_str()) {
                if !is_non_network_html_url(splat_url) {
                    let mut missing = Vec::new();
                    if !caps.remote_content {
                        missing.push("remote_content");
                    }
                    if !caps.network {
                        missing.push("network");
                    }
                    push_trait_missing(&node.name, "splatUrl", &missing);
                }
            }
            for (audio_key, label) in [("audioEmitter", "audioEmitter.src"), ("audio", "audio.src")]
            {
                if let Some(audio_obj) = obj.get(audio_key).and_then(|v| v.as_object()) {
                    let has_preset = audio_obj
                        .get("preset")
                        .and_then(|v| v.as_str())
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false);
                    if !has_preset {
                        if let Some(src) = audio_obj.get("src").and_then(|v| v.as_str()) {
                            if !is_non_network_html_url(src) {
                                let mut missing = Vec::new();
                                if !caps.remote_content {
                                    missing.push("remote_content");
                                }
                                if !caps.network {
                                    missing.push("network");
                                }
                                push_trait_missing(&node.name, label, &missing);
                                break;
                            }
                        }
                    }
                }
            }
            let persist_anchor = obj
                .get("anchorPersist")
                .and_then(|v| v.as_object())
                .and_then(|a| a.get("persist"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                || obj
                    .get("anchor")
                    .and_then(|v| v.as_object())
                    .and_then(|a| a.get("persist"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
            if persist_anchor && !caps.storage {
                push_trait_missing(&node.name, "anchor.persist", &["storage"]);
            }
            if obj.get("holdToAsk").filter(|v| !v.is_null() && v.as_bool() != Some(false)).is_some()
            {
                let mut missing = Vec::new();
                if !caps.ai {
                    missing.push("ai");
                }
                if !caps.network {
                    missing.push("network");
                }
                if !caps.microphone {
                    missing.push("microphone");
                }
                push_trait_missing(&node.name, "holdToAsk", &missing);
            }
            if obj
                .get("worldUnderstanding")
                .filter(|v| !v.is_null() && v.as_bool() != Some(false))
                .is_some()
                && !caps.sensors
            {
                push_trait_missing(&node.name, "worldUnderstanding", &["sensors"]);
            }
        }
    }

    /// Extracts `<script type="text/three">` blocks from an HTML document and validates
    /// `<three-live>` / `<xr-live>` host attributes (`TL401`, `TL402`, `TL403`).
    pub fn extract_and_lint_html(html: &str) -> (Vec<String>, Vec<Diagnostic>) {
        let (scripts, diagnostics, _) = extract_and_lint_html_with_caps(html);
        (scripts, diagnostics)
    }

    fn extract_and_lint_html_with_caps(
        html: &str,
    ) -> (Vec<String>, Vec<Diagnostic>, Vec<(String, HtmlCapMask)>) {
        let cleaned = strip_html_comments(html);
        let mut scripts = Vec::new();
        let mut scoped_scripts: Vec<(String, HtmlCapMask)> = Vec::new();
        let mut diagnostics = Vec::new();
        let lower = cleaned.to_ascii_lowercase();

        for tag_name in ["three-live", "xr-live"] {
            let open_pat = format!("<{}", tag_name);
            let close_pat = format!("</{}", tag_name);
            let mut cursor = 0usize;
            while let Some(rel) = lower[cursor..].find(&open_pat) {
                let tag_start = cursor + rel;
                let after_name = tag_start + open_pat.len();
                if after_name < lower.len() {
                    let next_b = lower.as_bytes()[after_name];
                    if !next_b.is_ascii_whitespace() && next_b != b'>' && next_b != b'/' {
                        cursor = after_name;
                        continue;
                    }
                }
                let Some(open_end) = find_tag_end(&lower, after_name) else {
                    break;
                };
                let open_tag = &cleaned[tag_start..=open_end];
                let attrs = parse_open_tag_attrs(open_tag);
                let has_attr = |name: &str| attrs.iter().any(|(k, _)| k == name);
                let get_attr = |name: &str| -> Option<&str> {
                    attrs.iter().find(|(k, _)| k == name).and_then(|(_, v)| v.as_deref())
                };
                let allow_scripts_attr = attrs
                    .iter()
                    .find(|(k, _)| k == "allow-client-scripts")
                    .map(|(_, v)| v.as_deref());
                let elem_caps = HtmlCapMask::parse(get_attr("capabilities"), allow_scripts_attr);

                let is_self_closing = open_tag.trim_end().ends_with("/>");
                let inner_start = open_end + 1;
                let (inner_html, inner_lower, next_cursor) = if is_self_closing {
                    ("", "", inner_start)
                } else if let Some(close_rel) = lower[inner_start..].find(&close_pat) {
                    let close_start = inner_start + close_rel;
                    (
                        &cleaned[inner_start..close_start],
                        &lower[inner_start..close_start],
                        close_start + close_pat.len(),
                    )
                } else {
                    (&cleaned[inner_start..], &lower[inner_start..], cleaned.len())
                };

                let elem_scripts = extract_three_scripts_from_fragment(inner_html);
                let has_script_attr = has_attr("script");
                if (!elem_scripts.is_empty() || has_script_attr) && !elem_caps.scripts {
                    diagnostics.push(Diagnostic {
                    code: "TL401".to_string(),
                    severity: "error".to_string(),
                    message: format!(
                        "<{}> contains an inline <script type=\"text/three\"> without granting 'scripts' in capabilities (or 'allow-client-scripts').",
                        tag_name
                    ),
                    node: None,
                    line: None,
                    column: None,
                    hint: Some(format!(
                        "Add 'capabilities=\"scripts\"' (or 'allow-client-scripts') to <{}> so the sandboxed script runner is permitted to execute.",
                        tag_name
                    )),
                });
                }
                lint_html_element_capabilities(tag_name, &attrs, elem_caps, &mut diagnostics);
                for s in elem_scripts {
                    scoped_scripts.push((s.clone(), elem_caps));
                    scripts.push(s);
                }

                if tag_name == "three-live" {
                    let mut flagged = Vec::new();
                    for &xr_attr in XR_ONLY_ATTRS {
                        if has_attr(xr_attr) {
                            flagged.push(xr_attr.to_string());
                        }
                    }
                    if let Some(plugins_val) = get_attr("plugins") {
                        for token in
                            plugins_val.split(|c: char| c == ',' || c.is_ascii_whitespace())
                        {
                            let t = token.trim().to_ascii_lowercase();
                            if XR_ONLY_PLUGINS.contains(&t.as_str()) && !flagged.contains(&t) {
                                flagged.push(t);
                            }
                        }
                    }
                    if inner_lower.contains("slot=\"spatial\"")
                        || inner_lower.contains("slot='spatial'")
                    {
                        flagged.push("<div slot=\"spatial\">".to_string());
                    }
                    if inner_lower.contains("<xr-anchor") {
                        flagged.push("<xr-anchor>".to_string());
                    }
                    for feat in flagged {
                        diagnostics.push(Diagnostic {
                        code: "TL402".to_string(),
                        severity: "warning".to_string(),
                        message: format!(
                            "<three-live> element uses <xr-live>-only feature '{}'; it will be ignored unless upgraded to <xr-live>.",
                            feat
                        ),
                        node: None,
                        line: None,
                        column: None,
                        hint: Some(
                            "Replace <three-live> with <xr-live> and include xr-live.min.js (plus xr-live-spatial.min.js or xr-live-sim.min.js if needed)."
                                .to_string(),
                        ),
                    });
                    }
                }

                cursor = next_cursor;
            }
        }

        if scripts.is_empty() {
            scripts = extract_three_scripts_from_fragment(&cleaned);
        }

        (scripts, diagnostics, scoped_scripts)
    }

    /// Extracts either raw JS source or `<script type="text/three">` blocks from HTML source,
    /// returning `(combined_script, html_diagnostics)`.
    pub fn extract_script_from_source(source: &str) -> (String, Vec<Diagnostic>) {
        if is_html_source(source, "") {
            let (scripts, diags) = extract_and_lint_html(source);
            (scripts.join("\n;\n"), diags)
        } else {
            (source.to_string(), Vec::new())
        }
    }

    /// Validates a `.js` or `.html` scene source, returning the extracted [`SceneGraph`] (when JS
    /// execution succeeded) along with all structured `TL1xx`, `TL2xx`, and `TL4xx` diagnostics.
    pub fn validate_scene_source(
        source: &str,
        filename: &str,
    ) -> (Option<SceneGraph>, Vec<Diagnostic>) {
        if is_html_source(source, filename) {
            let (scripts, mut html_diags, scoped_scripts) = extract_and_lint_html_with_caps(source);
            if scripts.is_empty() {
                return (
                    Some(SceneGraph { diagnostics: html_diags.clone(), ..Default::default() }),
                    html_diags,
                );
            }
            let combined = scripts.join("\n;\n");
            match validate_three_script(&combined) {
                Ok(mut scene) => {
                    push_texture_quota_diagnostic(&mut scene);
                    if let Some(&(_, first_caps)) = scoped_scripts.first() {
                        let uniform = scoped_scripts.iter().all(|(_, c)| *c == first_caps);
                        if uniform {
                            lint_scene_traits_against_html_capabilities(
                                &scene,
                                first_caps,
                                &mut html_diags,
                            );
                        } else {
                            for (elem_script, elem_caps) in &scoped_scripts {
                                if let Ok(elem_scene) = validate_three_script(elem_script) {
                                    lint_scene_traits_against_html_capabilities(
                                        &elem_scene,
                                        *elem_caps,
                                        &mut html_diags,
                                    );
                                }
                            }
                        }
                    }
                    let mut all_diags = html_diags;
                    all_diags.append(&mut scene.diagnostics);
                    scene.diagnostics = all_diags.clone();
                    (Some(scene), all_diags)
                }
                Err(err_msg) => {
                    html_diags.push(classify_script_error(&err_msg, &combined));
                    (None, html_diags)
                }
            }
        } else {
            match validate_three_script(source) {
                Ok(mut scene) => {
                    push_texture_quota_diagnostic(&mut scene);
                    let diags = scene.diagnostics.clone();
                    (Some(scene), diags)
                }
                Err(err_msg) => {
                    let diag = classify_script_error(&err_msg, source);
                    (None, vec![diag])
                }
            }
        }
    }

    /// Flags scenes whose materials reference more unique texture images than
    /// `SECURITY_3D_MAX_TEXTURES`, so `validate` / `render` report the same quota failure that
    /// `.glb` / `.usdz` export would hit (identical images are shared, matching the GLB writer).
    pub(crate) fn push_texture_quota_diagnostic(scene: &mut SceneGraph) {
        let mut uris = std::collections::HashSet::new();
        for m in &scene.materials {
            for t in [
                &m.base_color_texture,
                &m.metallic_roughness_texture,
                &m.normal_texture,
                &m.emissive_texture,
                &m.occlusion_texture,
            ] {
                if let Some(u) = t.as_deref().filter(|u| !u.is_empty()) {
                    uris.insert(u);
                }
            }
        }
        if uris.len() > constants::SECURITY_3D_MAX_TEXTURES {
            let n = uris.len();
            scene.diagnostics.push(Diagnostic {
            code: "TL105".to_string(),
            severity: "error".to_string(),
            message: format!(
                "Scene uses {} unique textures, exceeding SECURITY_3D_MAX_TEXTURES ({}); .glb and \
                 .usdz export will fail.",
                n,
                constants::SECURITY_3D_MAX_TEXTURES
            ),
            hint: Some(
                "Share textures between materials. Each THREE.ProceduralTexture preset adds up to 3 \
                 textures: reuse one preset result across meshes, pass normalStrength: 0 to skip \
                 its normal map, or use fewer distinct presets."
                    .to_string(),
            ),
            ..Default::default()
        });
        }
    }

    /// Validates a `.js` or `.html` scene source and runs the full Phase 2 spatial, frustum,
    /// grounding, and lighting linter (`TL301–TL307`), returning a structured [`ValidationReport`].
    pub fn validate_and_lint_scene(
        source: &str,
        filename: &str,
        execution_time_ms: f64,
    ) -> ValidationReport {
        let (scene_opt, base_diags) = validate_scene_source(source, filename);
        build_validation_report(filename, execution_time_ms, scene_opt.as_ref(), base_diags)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_permissive_llm_fallbacks_compile_to_glb_and_usdz() {
            let script = r#"
            const aspect = window.innerWidth / window.innerHeight;
            const shaderMat = new THREE.ShaderMaterial({
                uniforms: { color: { value: new THREE.Color(0x00ff88) } },
                vertexShader: 'void main() { gl_Position = vec4(0.0); }',
                fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }'
            });
            const icosa = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), shaderMat);
            scene.add(icosa);

            const capsule = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.25, 0.8),
                new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
            );
            scene.add(capsule);

            const unknownMesh = new THREE.Mesh(
                new THREE.HallucinatedGeometry(1, 2),
                new THREE.HallucinatedMaterial()
            );
            scene.add(unknownMesh);

            const spot = new THREE.SpotLight(0xffffff, 2.0);
            spot.position.set(1, 3, 2);
            scene.add(spot);

            const controls = new THREE.OrbitControls(camera, document.createElement('canvas'));
            controls.update();

            function animate() {
                requestAnimationFrame(animate);
            }
            animate();
        "#;

            let glb = transcode_three_to_glb(script).expect(
                "LLM script with unsupported Three.js features should gracefully compile to GLB",
            );
            assert!(glb.len() > 100);
            assert_eq!(&glb[0..4], b"glTF");

            let usdz = transcode_three_to_usdz(script).expect(
                "LLM script with unsupported Three.js features should gracefully compile to USDZ",
            );
            assert!(usdz.len() > 100);
            assert_eq!(&usdz[0..2], b"PK");
        }

        #[test]
        fn test_instanced_mesh_and_material_variants_compile_to_glb_and_usdz() {
            let script = r#"
            const midnight = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.2 });
            const gold = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, metalness: 0.9 });
            const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2), midnight);
            body.name = 'WatchCase';
            body.userData.variants = {
                'Midnight': midnight,
                'Solar Gold': gold,
            };
            scene.add(body);

            const studGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8);
            const studMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const studs = new THREE.InstancedMesh(studGeo, studMat, 4);
            studs.name = 'Studs';
            for (let i = 0; i < 4; i++) {
                const m = new THREE.Matrix4().makeTranslation(i * 0.4, 0, 0);
                studs.setMatrixAt(i, m);
                studs.setColorAt(i, new THREE.Color(0xff0000));
            }
            scene.add(studs);
        "#;

            let glb = transcode_three_to_glb(script)
                .expect("InstancedMesh + variants should compile to GLB");
            assert!(glb.len() > 200);
            let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
            let json_str = std::str::from_utf8(&glb[20..20 + json_len]).unwrap();
            assert!(
                json_str.contains("KHR_materials_variants"),
                "GLB JSON must include KHR_materials_variants"
            );
            assert!(
                json_str.contains("EXT_mesh_gpu_instancing"),
                "GLB JSON must include EXT_mesh_gpu_instancing"
            );
            assert!(json_str.contains("Solar Gold"), "GLB JSON must include Solar Gold variant");

            let usdz = transcode_three_to_usdz(script)
                .expect("InstancedMesh + variants should compile to USDZ");
            assert!(usdz.len() > 200);
            assert_eq!(&usdz[0..2], b"PK");
        }

        #[test]
        fn test_html_capabilities_satisfy_tl401_and_lint_tl403() {
            let ok_html = r#"
            <xr-live capabilities="scripts network remote_content sensors storage">
              <script type="text/three">
                const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
                m.name = 'Crate';
                m.userData.xr = {
                  splatUrl: 'https://cdn.example.com/room.spz',
                  anchor: { target: 'table', persist: true },
                  worldUnderstanding: { planes: true }
                };
                scene.add(m);
              </script>
            </xr-live>
        "#;
            let (_, ok_diags) = validate_scene_source(ok_html, "ok.html");
            assert!(
                !ok_diags.iter().any(|d| d.code == "TL401" || d.code == "TL403"),
                "Expected zero TL401/TL403 diagnostics when capabilities are granted, got: {:?}",
                ok_diags
            );

            let missing_html = r#"
            <xr-live capabilities="scripts" xr-hands="gestures" shared-room="lobby" persistent-anchors="room1">
              <script type="text/three">
                const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
                m.name = 'Speaker';
                m.userData.xr = {
                  splatUrl: 'https://cdn.example.com/room.spz',
                  audio: { src: 'https://cdn.example.com/clip.mp3' },
                  holdToAsk: { prompt: 'What is this?' }
                };
                scene.add(m);
              </script>
            </xr-live>
        "#;
            let (_, diags) = validate_scene_source(missing_html, "missing.html");
            assert!(!diags.iter().any(|d| d.code == "TL401"));
            let tl403: Vec<&str> =
                diags.iter().filter(|d| d.code == "TL403").map(|d| d.message.as_str()).collect();
            assert!(tl403.iter().any(|m| m.contains("xr-hands")));
            assert!(tl403.iter().any(|m| m.contains("shared-room")));
            assert!(tl403.iter().any(|m| m.contains("persistent-anchors")));
            assert!(tl403.iter().any(|m| m.contains("userData.xr.splatUrl")));
            assert!(tl403.iter().any(|m| m.contains("userData.xr.audio.src")));
            assert!(tl403.iter().any(|m| m.contains("userData.xr.holdToAsk")));

            // Audit regressions: `texture-pack`, `xr-mode="vr"`, `allow-client-scripts` +
            // `-scripts` negation, and multi-element HTML capability isolation.
            let lockdown_html = r#"
            <xr-live allow-client-scripts capabilities="none" texture-pack="https://cdn.example.com/p.json" xr-mode="vr">
              <script type="text/three">
                scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
              </script>
            </xr-live>
        "#;
            let (_, lock_diags) = validate_scene_source(lockdown_html, "lockdown.html");
            assert!(
                lock_diags.iter().any(|d| d.code == "TL401"),
                "capabilities=\"none\" must override allow-client-scripts and emit TL401"
            );
            assert!(lock_diags
                .iter()
                .any(|d| d.code == "TL403" && d.message.contains("texture-pack")));
            assert!(lock_diags
                .iter()
                .any(|d| d.code == "TL403" && d.message.contains("xr-mode=\"vr\"")));

            let multi_html = r#"
            <xr-live capabilities="all">
              <script type="text/three">
                const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
                a.name = 'AllowedBox';
                a.userData.xr = { holdToAsk: { prompt: 'Hi' } };
                scene.add(a);
              </script>
            </xr-live>
            <xr-live capabilities="scripts">
              <script type="text/three">
                const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
                b.name = 'RestrictedSplat';
                b.userData.xr = { splatUrl: 'https://cdn.example.com/room.spz' };
                scene.add(b);
              </script>
            </xr-live>
        "#;
            let (_, multi_diags) = validate_scene_source(multi_html, "multi.html");
            assert!(
            multi_diags
                .iter()
                .any(|d| d.code == "TL403" && d.message.contains("RestrictedSplat")),
            "Restricted sibling element must still receive TL403 even when another element has capabilities=\"all\""
        );
            assert!(!multi_diags
                .iter()
                .any(|d| d.code == "TL403" && d.message.contains("AllowedBox")));
        }
    }
}

#[cfg(feature = "boa")]
pub use html_lint::*;
