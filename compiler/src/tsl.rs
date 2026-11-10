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

//! Canonical Loop-Free TSL (`GOOGLE_material_tsl`) Validator, Deterministic CPU
//! Evaluator, and Static PBR Fallback Texture Baker (`TL501–TL504`).
//!
//! Kept in 1:1 numerical lockstep with `three-live/src/tsl/ir.ts`.

use crate::render::encode_png_rgba_compressed;
use crate::scene::Diagnostic;
use std::collections::BTreeMap;

/// glTF 2.0 material extension name for loop-free TSL node graphs.
pub const TSL_EXTENSION_NAME: &str = "GOOGLE_material_tsl";

/// Hard per-material SSA node quota preventing GPU ALU amplification / TDR.
pub const MAX_TSL_NODES: usize = 128;

/// Hard per-material user uniform quota mapped to `vec4 uTslParams[16]`.
pub const MAX_TSL_UNIFORMS: usize = 16;

/// Time wrap period in seconds preserving fp32 phase precision.
pub const TSL_TIME_PERIOD_SEC: f32 = 3600.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TslType {
    Float,
    Vec2,
    Vec3,
    Vec4,
}

impl TslType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "float" => Some(Self::Float),
            "vec2" => Some(Self::Vec2),
            "vec3" => Some(Self::Vec3),
            "vec4" => Some(Self::Vec4),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Float => "float",
            Self::Vec2 => "vec2",
            Self::Vec3 => "vec3",
            Self::Vec4 => "vec4",
        }
    }

    pub fn arity(self) -> usize {
        match self {
            Self::Float => 1,
            Self::Vec2 => 2,
            Self::Vec3 => 3,
            Self::Vec4 => 4,
        }
    }

    pub fn from_arity(n: usize) -> Option<Self> {
        match n {
            1 => Some(Self::Float),
            2 => Some(Self::Vec2),
            3 => Some(Self::Vec3),
            4 => Some(Self::Vec4),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TslBuiltin {
    PositionLocal,
    PositionWorld,
    NormalLocal,
    NormalWorld,
    ViewDirection,
    Uv,
    VertexColor,
    InstanceIndex,
    Time,
}

impl TslBuiltin {
    pub fn from_str(s: &str) -> Option<(Self, TslType)> {
        match s {
            "positionLocal" => Some((Self::PositionLocal, TslType::Vec3)),
            "positionWorld" => Some((Self::PositionWorld, TslType::Vec3)),
            "normalLocal" => Some((Self::NormalLocal, TslType::Vec3)),
            "normalWorld" => Some((Self::NormalWorld, TslType::Vec3)),
            "viewDirection" => Some((Self::ViewDirection, TslType::Vec3)),
            "uv" => Some((Self::Uv, TslType::Vec2)),
            "vertexColor" => Some((Self::VertexColor, TslType::Vec4)),
            "instanceIndex" => Some((Self::InstanceIndex, TslType::Float)),
            "time" => Some((Self::Time, TslType::Float)),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::PositionLocal => "positionLocal",
            Self::PositionWorld => "positionWorld",
            Self::NormalLocal => "normalLocal",
            Self::NormalWorld => "normalWorld",
            Self::ViewDirection => "viewDirection",
            Self::Uv => "uv",
            Self::VertexColor => "vertexColor",
            Self::InstanceIndex => "instanceIndex",
            Self::Time => "time",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TslOp {
    Const,
    Builtin(TslBuiltin),
    Uniform(usize),
    Swizzle([u8; 4], u8),
    Construct,
    Neg,
    Abs,
    Sign,
    Floor,
    Ceil,
    Fract,
    Sqrt,
    Exp,
    Log,
    Sin,
    Cos,
    Normalize,
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Pow,
    Atan2,
    Min,
    Max,
    Step,
    Clamp,
    Mix,
    Smoothstep,
    Dot,
    Cross,
    Length,
    Distance,
    Reflect,
    Fresnel,
    SimplexNoise2D,
    SimplexNoise3D,
    Voronoi2D,
    Checker,
    Triplanar,
    HueShift,
    BumpFromHeight,
}

#[derive(Debug, Clone)]
pub struct ValidatedTslUniformSlot {
    pub name: String,
    pub slot: usize,
    pub ty: TslType,
    pub default_vec4: [f32; 4],
}

#[derive(Debug, Clone)]
pub struct ValidatedTslNode {
    pub op: TslOp,
    pub op_name: &'static str,
    pub ty: TslType,
    pub args: Vec<usize>,
    pub const_val: [f32; 4],
}

#[derive(Debug, Clone, Default)]
pub struct TslOutputs {
    pub color: Option<usize>,
    pub opacity: Option<usize>,
    pub emissive: Option<usize>,
    pub roughness: Option<usize>,
    pub metalness: Option<usize>,
    pub normal_scale: Option<usize>,
    pub bump: Option<usize>,
    pub position: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct ValidatedTslGraph {
    pub nodes: Vec<ValidatedTslNode>,
    pub outputs: TslOutputs,
    pub uniform_slots: Vec<ValidatedTslUniformSlot>,
    pub hash: String,
    pub uses_time: bool,
    pub uses_vertex_position: bool,
    pub uses_derivatives: bool,
    pub fragment_reachable: Vec<bool>,
    pub vertex_reachable: Vec<bool>,
}

fn make_diag(code: &str, message: String, hint: &str, mat_label: &str) -> Diagnostic {
    Diagnostic {
        code: code.to_string(),
        severity: "warning".to_string(),
        message,
        node: Some(mat_label.to_string()),
        line: None,
        column: None,
        hint: Some(hint.to_string()),
    }
}

fn fnv1a_str(mut h: u32, s: &str) -> u32 {
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16_777_619);
    }
    h
}

fn fnv1a_f32(h: u32, v: f32) -> u32 {
    let bits = v.to_bits();
    (h ^ bits).wrapping_mul(16_777_619)
}

fn is_valid_uniform_ident(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 64
        || matches!(name, "__proto__" | "constructor" | "prototype")
    {
        return false;
    }
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Packs a JSON scalar or array into a validated `[f32; 4]` uniform vector.
pub fn pack_uniform_vec4(ty: TslType, val: &serde_json::Value) -> Option<[f32; 4]> {
    let arity = ty.arity();
    if arity == 1 {
        let n =
            val.as_f64().or_else(|| val.as_array().filter(|a| a.len() == 1)?.first()?.as_f64())?;
        if !n.is_finite() {
            return None;
        }
        return Some([n as f32, 0.0, 0.0, 0.0]);
    }
    let arr = val.as_array()?;
    if arr.len() < arity {
        return None;
    }
    let mut out = [0.0f32; 4];
    for (i, slot) in out.iter_mut().enumerate().take(arity) {
        let n = arr[i].as_f64()?;
        if !n.is_finite() {
            return None;
        }
        *slot = n as f32;
    }
    Some(out)
}

fn resolve_broadcast(a: TslType, b: TslType) -> Option<TslType> {
    if a == b {
        Some(a)
    } else if a == TslType::Float {
        Some(b)
    } else if b == TslType::Float {
        Some(a)
    } else {
        None
    }
}

/// Validates a `GOOGLE_material_tsl` JSON value in `O(N)` time.
pub fn validate_tsl_graph(
    raw: &serde_json::Value,
    material_label: &str,
) -> Result<ValidatedTslGraph, Diagnostic> {
    const DEFAULT_HINT: &str = "Construct materials using THREE.MeshStandardNodeMaterial and loop-free THREE.TSL expressions (<= 128 nodes, <= 16 uniforms).";

    let Some(obj) = raw.as_object() else {
        return Err(make_diag(
            "TL501",
            format!(
                "Invalid GOOGLE_material_tsl payload on '{}': expected an object.",
                material_label
            ),
            DEFAULT_HINT,
            material_label,
        ));
    };

    if obj.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return Err(make_diag(
            "TL501",
            format!(
                "Unsupported GOOGLE_material_tsl version on '{}' (expected 1).",
                material_label
            ),
            DEFAULT_HINT,
            material_label,
        ));
    }

    // 1. Uniforms (sorted by name to match JS `Object.keys(uRec).sort()`)
    let mut uniform_slots = Vec::new();
    let mut uniform_by_name: BTreeMap<String, usize> = BTreeMap::new();
    if let Some(u_val) = obj.get("uniforms").filter(|v| !v.is_null()) {
        let Some(u_map) = u_val.as_object() else {
            return Err(make_diag(
                "TL501",
                format!("Invalid uniforms map on '{}': expected an object.", material_label),
                DEFAULT_HINT,
                material_label,
            ));
        };
        if u_map.len() > MAX_TSL_UNIFORMS {
            return Err(make_diag(
                "TL502",
                format!(
                    "TSL material '{}' declares {} uniforms, exceeding MAX_TSL_UNIFORMS ({}).",
                    material_label,
                    u_map.len(),
                    MAX_TSL_UNIFORMS
                ),
                "Consolidate scalar parameters into vec4 uniforms or inline constants via TSL.float(...).",
                material_label,
            ));
        }
        let mut sorted_keys: Vec<&String> = u_map.keys().collect();
        sorted_keys.sort();
        for (slot, key) in sorted_keys.into_iter().enumerate() {
            if !is_valid_uniform_ident(key) {
                return Err(make_diag(
                    "TL501",
                    format!("Invalid TSL uniform identifier '{}' on '{}'.", key, material_label),
                    DEFAULT_HINT,
                    material_label,
                ));
            }
            let entry = &u_map[key];
            let Some(ty_str) = entry.get("type").and_then(|v| v.as_str()) else {
                return Err(make_diag(
                    "TL501",
                    format!("Uniform '{}' on '{}' is missing a valid type.", key, material_label),
                    DEFAULT_HINT,
                    material_label,
                ));
            };
            let Some(ty) = TslType::from_str(ty_str) else {
                return Err(make_diag(
                    "TL501",
                    format!(
                        "Unsupported type '{}' for uniform '{}' on '{}'.",
                        ty_str, key, material_label
                    ),
                    DEFAULT_HINT,
                    material_label,
                ));
            };
            let Some(default_vec4) = entry.get("value").and_then(|v| pack_uniform_vec4(ty, v))
            else {
                return Err(make_diag(
                    "TL501",
                    format!(
                        "Non-finite or mismatched initial value for uniform '{}' on '{}'.",
                        key, material_label
                    ),
                    DEFAULT_HINT,
                    material_label,
                ));
            };
            uniform_by_name.insert(key.clone(), slot);
            uniform_slots.push(ValidatedTslUniformSlot {
                name: key.clone(),
                slot,
                ty,
                default_vec4,
            });
        }
    }

    // 2. Nodes
    let Some(raw_nodes) = obj.get("nodes").and_then(|v| v.as_array()) else {
        return Err(make_diag(
            "TL501",
            format!("GOOGLE_material_tsl on '{}' is missing nodes array.", material_label),
            DEFAULT_HINT,
            material_label,
        ));
    };
    if raw_nodes.is_empty() {
        return Err(make_diag(
            "TL501",
            format!("GOOGLE_material_tsl on '{}' must contain at least 1 node.", material_label),
            DEFAULT_HINT,
            material_label,
        ));
    }
    if raw_nodes.len() > MAX_TSL_NODES {
        return Err(make_diag(
            "TL502",
            format!(
                "TSL material '{}' has {} nodes, exceeding MAX_TSL_NODES ({}).",
                material_label,
                raw_nodes.len(),
                MAX_TSL_NODES
            ),
            "Factor shared sub-expressions into variables or simplify procedural noise octaves to <= 128 SSA nodes.",
            material_label,
        ));
    }

    let mut nodes: Vec<ValidatedTslNode> = Vec::with_capacity(raw_nodes.len());
    let mut hash: u32 = 2_166_136_261;
    for u in &uniform_slots {
        hash = fnv1a_str(hash, &format!("U:{}:{};", u.slot, u.ty.as_str()));
    }

    for (idx, rn) in raw_nodes.iter().enumerate() {
        let Some(n_obj) = rn.as_object() else {
            return Err(make_diag(
                "TL501",
                format!("Node {} on '{}' is not an object.", idx, material_label),
                DEFAULT_HINT,
                material_label,
            ));
        };
        let Some(op_raw) = n_obj.get("op").and_then(|v| v.as_str()) else {
            return Err(make_diag(
                "TL501",
                format!("Node {} on '{}' is missing op.", idx, material_label),
                DEFAULT_HINT,
                material_label,
            ));
        };
        if matches!(op_raw, "loop" | "while" | "for" | "call") {
            return Err(make_diag(
                "TL504",
                format!(
                    "Unsupported imperative/loop op '{}' at node {} on '{}'.",
                    op_raw, idx, material_label
                ),
                "Three-Live TSL requires loop-free acyclic expressions; replace loops with fixed unrolled octaves.",
                material_label,
            ));
        }
        let Some(ty) = n_obj.get("type").and_then(|v| v.as_str()).and_then(TslType::from_str)
        else {
            return Err(make_diag(
                "TL501",
                format!("Node {} on '{}' has invalid type.", idx, material_label),
                DEFAULT_HINT,
                material_label,
            ));
        };

        let mut args: Vec<usize> = Vec::new();
        if let Some(raw_args) = n_obj.get("args") {
            let Some(a_arr) = raw_args.as_array().filter(|a| a.len() <= 4) else {
                return Err(make_diag(
                    "TL501",
                    format!(
                        "Node {} ({}) on '{}' has invalid args list.",
                        idx, op_raw, material_label
                    ),
                    DEFAULT_HINT,
                    material_label,
                ));
            };
            for a_val in a_arr {
                let Some(a_idx) = a_val.as_u64().and_then(|v| usize::try_from(v).ok()) else {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Node {} ({}) on '{}' has non-integer arg.",
                            idx, op_raw, material_label
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                };
                if a_idx >= idx {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Node {} ({}) on '{}' references out-of-order or cyclic arg {} (must satisfy 0 <= arg < {}).",
                            idx, op_raw, material_label, a_idx, idx
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                args.push(a_idx);
            }
        }

        hash = fnv1a_str(hash, &format!("N{}:{}:{}:", idx, op_raw, ty.as_str()));
        for &a in &args {
            hash = fnv1a_str(hash, &format!("{},", a));
        }

        let mut const_val = [0.0f32; 4];
        let (op, op_name): (TslOp, &'static str) = match op_raw {
            "const" => {
                if !args.is_empty() {
                    return Err(make_diag(
                        "TL501",
                        format!("Const node {} on '{}' must not have args.", idx, material_label),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let arity = ty.arity();
                let Some(v_arr) =
                    n_obj.get("value").and_then(|v| v.as_array()).filter(|a| a.len() == arity)
                else {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Const node {} on '{}' requires value array of length {}.",
                            idx, material_label, arity
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                };
                for c in 0..arity {
                    let Some(num) = v_arr[c].as_f64().filter(|n| n.is_finite()) else {
                        return Err(make_diag(
                            "TL501",
                            format!(
                                "Const node {} on '{}' contains non-finite number.",
                                idx, material_label
                            ),
                            DEFAULT_HINT,
                            material_label,
                        ));
                    };
                    let f = num as f32;
                    const_val[c] = f;
                    hash = fnv1a_f32(hash, f);
                }
                (TslOp::Const, "const")
            }
            "builtin" => {
                if !args.is_empty() {
                    return Err(make_diag(
                        "TL501",
                        format!("Builtin node {} on '{}' must not have args.", idx, material_label),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let Some(b_str) = n_obj.get("name").and_then(|v| v.as_str()) else {
                    return Err(make_diag(
                        "TL501",
                        format!("Builtin node {} on '{}' missing name.", idx, material_label),
                        DEFAULT_HINT,
                        material_label,
                    ));
                };
                let Some((b_enum, expected_ty)) = TslBuiltin::from_str(b_str) else {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Unknown builtin '{}' at node {} on '{}'.",
                            b_str, idx, material_label
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                };
                if ty != expected_ty {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Builtin '{}' at node {} on '{}' has type '{}', expected '{}'.",
                            b_str,
                            idx,
                            material_label,
                            ty.as_str(),
                            expected_ty.as_str()
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                hash = fnv1a_str(hash, b_str);
                (TslOp::Builtin(b_enum), "builtin")
            }
            "uniform" => {
                if !args.is_empty() {
                    return Err(make_diag(
                        "TL501",
                        format!("Uniform node {} on '{}' must not have args.", idx, material_label),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let Some(u_name) = n_obj.get("name").and_then(|v| v.as_str()) else {
                    return Err(make_diag(
                        "TL501",
                        format!("Uniform node {} on '{}' missing name.", idx, material_label),
                        DEFAULT_HINT,
                        material_label,
                    ));
                };
                let Some(&slot) = uniform_by_name.get(u_name) else {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Uniform node {} on '{}' references undeclared uniform '{}'.",
                            idx, material_label, u_name
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                };
                if uniform_slots[slot].ty != ty {
                    return Err(make_diag(
                        "TL501",
                        format!("Uniform node {} ('{}') mismatches declared type.", idx, u_name),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                hash = fnv1a_str(hash, &format!("S{}", slot));
                (TslOp::Uniform(slot), "uniform")
            }
            "swizzle" => {
                if args.len() != 1 {
                    return Err(make_diag(
                        "TL501",
                        format!("Swizzle node {} on '{}' requires 1 arg.", idx, material_label),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let Some(mask) = n_obj
                    .get("mask")
                    .and_then(|v| v.as_str())
                    .filter(|m| !m.is_empty() && m.len() <= 4)
                else {
                    return Err(make_diag(
                        "TL501",
                        format!("Invalid swizzle mask at node {} on '{}'.", idx, material_label),
                        DEFAULT_HINT,
                        material_label,
                    ));
                };
                let src_arity = nodes[args[0]].ty.arity();
                let mut mask_idx = [0u8; 4];
                for (c, ch) in mask.chars().enumerate() {
                    let comp = match ch {
                        'x' => 0usize,
                        'y' => 1usize,
                        'z' => 2usize,
                        'w' => 3usize,
                        _ => {
                            return Err(make_diag(
                                "TL501",
                                format!(
                                    "Invalid swizzle char '{}' at node {} on '{}'.",
                                    ch, idx, material_label
                                ),
                                DEFAULT_HINT,
                                material_label,
                            ));
                        }
                    };
                    if comp >= src_arity {
                        return Err(make_diag(
                            "TL501",
                            format!(
                                "Swizzle '.{}' at node {} exceeds source type '{}'.",
                                mask,
                                idx,
                                nodes[args[0]].ty.as_str()
                            ),
                            DEFAULT_HINT,
                            material_label,
                        ));
                    }
                    mask_idx[c] = comp as u8;
                }
                if TslType::from_arity(mask.len()) != Some(ty) {
                    return Err(make_diag(
                        "TL501",
                        format!("Swizzle '.{}' at node {} mismatches output type.", mask, idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                hash = fnv1a_str(hash, mask);
                (TslOp::Swizzle(mask_idx, mask.len() as u8), "swizzle")
            }
            "construct" => {
                if args.is_empty() || args.len() > 4 {
                    return Err(make_diag(
                        "TL501",
                        format!("Construct node {} has invalid arg count.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                if !(args.len() == 1 && nodes[args[0]].ty == TslType::Float) {
                    let sum: usize = args.iter().map(|&a| nodes[a].ty.arity()).sum();
                    if sum != ty.arity() {
                        return Err(make_diag(
                            "TL501",
                            format!(
                                "Construct node {} ({}) has {} components, expected {}.",
                                idx,
                                ty.as_str(),
                                sum,
                                ty.arity()
                            ),
                            DEFAULT_HINT,
                            material_label,
                        ));
                    }
                }
                (TslOp::Construct, "construct")
            }
            "neg" | "abs" | "sign" | "floor" | "ceil" | "fract" | "sqrt" | "exp" | "log"
            | "sin" | "cos" | "normalize" => {
                if args.len() != 1 || nodes[args[0]].ty != ty {
                    return Err(make_diag(
                        "TL501",
                        format!("Unary op '{}' at node {} mismatches operand type.", op_raw, idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                match op_raw {
                    "neg" => (TslOp::Neg, "neg"),
                    "abs" => (TslOp::Abs, "abs"),
                    "sign" => (TslOp::Sign, "sign"),
                    "floor" => (TslOp::Floor, "floor"),
                    "ceil" => (TslOp::Ceil, "ceil"),
                    "fract" => (TslOp::Fract, "fract"),
                    "sqrt" => (TslOp::Sqrt, "sqrt"),
                    "exp" => (TslOp::Exp, "exp"),
                    "log" => (TslOp::Log, "log"),
                    "sin" => (TslOp::Sin, "sin"),
                    "cos" => (TslOp::Cos, "cos"),
                    _ => (TslOp::Normalize, "normalize"),
                }
            }
            "add" | "sub" | "mul" | "div" | "mod" | "pow" | "atan2" | "min" | "max" => {
                if args.len() != 2
                    || resolve_broadcast(nodes[args[0]].ty, nodes[args[1]].ty) != Some(ty)
                {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Binary op '{}' at node {} has incompatible operand types.",
                            op_raw, idx
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                match op_raw {
                    "add" => (TslOp::Add, "add"),
                    "sub" => (TslOp::Sub, "sub"),
                    "mul" => (TslOp::Mul, "mul"),
                    "div" => (TslOp::Div, "div"),
                    "mod" => (TslOp::Mod, "mod"),
                    "pow" => (TslOp::Pow, "pow"),
                    "atan2" => (TslOp::Atan2, "atan2"),
                    "min" => (TslOp::Min, "min"),
                    _ => (TslOp::Max, "max"),
                }
            }
            "step" => {
                if args.len() != 2 {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'step' at node {} requires 2 args.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let t_edge = nodes[args[0]].ty;
                let t_x = nodes[args[1]].ty;
                if (t_edge != t_x && t_edge != TslType::Float) || ty != t_x {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'step' at node {} has incompatible types.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Step, "step")
            }
            "clamp" => {
                if args.len() != 3 {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'clamp' at node {} requires 3 args.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let (t_x, t_lo, t_hi) = (nodes[args[0]].ty, nodes[args[1]].ty, nodes[args[2]].ty);
                let ok = (t_lo == t_x && t_hi == t_x)
                    || (t_lo == TslType::Float && t_hi == TslType::Float);
                if !ok || ty != t_x {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'clamp' at node {} has incompatible types.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Clamp, "clamp")
            }
            "mix" => {
                if args.len() != 3 {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'mix' at node {} requires 3 args.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let (t_a, t_b, t_t) = (nodes[args[0]].ty, nodes[args[1]].ty, nodes[args[2]].ty);
                if t_a != t_b || (t_t != t_a && t_t != TslType::Float) || ty != t_a {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'mix' at node {} has incompatible types.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Mix, "mix")
            }
            "smoothstep" => {
                if args.len() != 3 {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'smoothstep' at node {} requires 3 args.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                let (t_e0, t_e1, t_x) = (nodes[args[0]].ty, nodes[args[1]].ty, nodes[args[2]].ty);
                let ok = (t_e0 == t_x && t_e1 == t_x)
                    || (t_e0 == TslType::Float && t_e1 == TslType::Float);
                if !ok || ty != t_x {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'smoothstep' at node {} has incompatible types.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Smoothstep, "smoothstep")
            }
            "dot" | "distance" => {
                if args.len() != 2 || nodes[args[0]].ty != nodes[args[1]].ty || ty != TslType::Float
                {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Op '{}' at node {} requires matching operands -> float.",
                            op_raw, idx
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                if op_raw == "dot" {
                    (TslOp::Dot, "dot")
                } else {
                    (TslOp::Distance, "distance")
                }
            }
            "length" => {
                if args.len() != 1 || ty != TslType::Float {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'length' at node {} requires 1 arg -> float.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Length, "length")
            }
            "cross" => {
                if args.len() != 2
                    || nodes[args[0]].ty != TslType::Vec3
                    || nodes[args[1]].ty != TslType::Vec3
                    || ty != TslType::Vec3
                {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'cross' at node {} requires (vec3, vec3) -> vec3.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Cross, "cross")
            }
            "reflect" => {
                if args.len() != 2
                    || nodes[args[0]].ty != nodes[args[1]].ty
                    || nodes[args[0]].ty == TslType::Float
                    || ty != nodes[args[0]].ty
                {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'reflect' at node {} requires matching vector types.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Reflect, "reflect")
            }
            "fresnel" => {
                if args.len() != 1 || nodes[args[0]].ty != TslType::Float || ty != TslType::Float {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'fresnel' at node {} requires (float) -> float.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Fresnel, "fresnel")
            }
            "simplexNoise2D" | "checker" => {
                if args.len() != 1 || nodes[args[0]].ty != TslType::Vec2 || ty != TslType::Float {
                    return Err(make_diag(
                        "TL501",
                        format!("Op '{}' at node {} requires (vec2) -> float.", op_raw, idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                if op_raw == "simplexNoise2D" {
                    (TslOp::SimplexNoise2D, "simplexNoise2D")
                } else {
                    (TslOp::Checker, "checker")
                }
            }
            "simplexNoise3D" => {
                if args.len() != 1 || nodes[args[0]].ty != TslType::Vec3 || ty != TslType::Float {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'simplexNoise3D' at node {} requires (vec3) -> float.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::SimplexNoise3D, "simplexNoise3D")
            }
            "voronoi2D" => {
                if args.len() != 2
                    || nodes[args[0]].ty != TslType::Vec2
                    || nodes[args[1]].ty != TslType::Float
                    || ty != TslType::Float
                {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'voronoi2D' at node {} requires (vec2, float) -> float.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Voronoi2D, "voronoi2D")
            }
            "triplanar" => {
                if args.len() != 2
                    || nodes[args[0]].ty != TslType::Vec3
                    || nodes[args[1]].ty != TslType::Float
                    || ty != TslType::Float
                {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'triplanar' at node {} requires (vec3, float) -> float.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::Triplanar, "triplanar")
            }
            "hueShift" => {
                if args.len() != 2
                    || nodes[args[0]].ty != TslType::Vec3
                    || nodes[args[1]].ty != TslType::Float
                    || ty != TslType::Vec3
                {
                    return Err(make_diag(
                        "TL501",
                        format!("Op 'hueShift' at node {} requires (vec3, float) -> vec3.", idx),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::HueShift, "hueShift")
            }
            "bumpFromHeight" => {
                if args.len() != 2
                    || nodes[args[0]].ty != TslType::Float
                    || nodes[args[1]].ty != TslType::Float
                    || ty != TslType::Vec3
                {
                    return Err(make_diag(
                        "TL501",
                        format!(
                            "Op 'bumpFromHeight' at node {} requires (float, float) -> vec3.",
                            idx
                        ),
                        DEFAULT_HINT,
                        material_label,
                    ));
                }
                (TslOp::BumpFromHeight, "bumpFromHeight")
            }
            _ => {
                return Err(make_diag(
                    "TL501",
                    format!("Unknown TSL op '{}' at node {} on '{}'.", op_raw, idx, material_label),
                    DEFAULT_HINT,
                    material_label,
                ));
            }
        };

        nodes.push(ValidatedTslNode { op, op_name, ty, args, const_val });
    }

    // 3. Outputs
    let Some(raw_outputs) = obj.get("outputs").and_then(|v| v.as_object()) else {
        return Err(make_diag(
            "TL501",
            format!("Missing outputs object in GOOGLE_material_tsl on '{}'.", material_label),
            DEFAULT_HINT,
            material_label,
        ));
    };

    let mut outputs = TslOutputs::default();
    let mut output_count = 0usize;

    let mut out_keys: Vec<&String> = raw_outputs.keys().collect();
    out_keys.sort();
    for key in out_keys {
        let val = &raw_outputs[key];
        if val.is_null() {
            continue;
        }
        let expected_ty = match key.as_str() {
            "color" | "emissive" | "bump" | "position" => TslType::Vec3,
            "opacity" | "roughness" | "metalness" | "normalScale" => TslType::Float,
            _ => {
                return Err(make_diag(
                    "TL501",
                    format!("Unknown TSL output socket '{}' on '{}'.", key, material_label),
                    DEFAULT_HINT,
                    material_label,
                ));
            }
        };
        let Some(out_idx) =
            val.as_u64().and_then(|v| usize::try_from(v).ok()).filter(|&i| i < nodes.len())
        else {
            return Err(make_diag(
                "TL501",
                format!("Output '{}' on '{}' references out-of-range node.", key, material_label),
                DEFAULT_HINT,
                material_label,
            ));
        };
        if nodes[out_idx].ty != expected_ty {
            return Err(make_diag(
                "TL501",
                format!(
                    "Output '{}' on '{}' has type '{}', expected '{}'.",
                    key,
                    material_label,
                    nodes[out_idx].ty.as_str(),
                    expected_ty.as_str()
                ),
                DEFAULT_HINT,
                material_label,
            ));
        }
        match key.as_str() {
            "color" => outputs.color = Some(out_idx),
            "opacity" => outputs.opacity = Some(out_idx),
            "emissive" => outputs.emissive = Some(out_idx),
            "roughness" => outputs.roughness = Some(out_idx),
            "metalness" => outputs.metalness = Some(out_idx),
            "normalScale" => outputs.normal_scale = Some(out_idx),
            "bump" => outputs.bump = Some(out_idx),
            "position" => outputs.position = Some(out_idx),
            _ => {}
        }
        output_count += 1;
        hash = fnv1a_str(hash, &format!("O:{}={};", key, out_idx));
    }

    if output_count == 0 {
        return Err(make_diag(
            "TL501",
            format!("GOOGLE_material_tsl on '{}' specifies no active outputs.", material_label),
            DEFAULT_HINT,
            material_label,
        ));
    }

    let mut fragment_reachable = vec![false; nodes.len()];
    let mut vertex_reachable = vec![false; nodes.len()];
    for opt in [
        outputs.color,
        outputs.opacity,
        outputs.emissive,
        outputs.roughness,
        outputs.metalness,
        outputs.normal_scale,
        outputs.bump,
    ]
    .into_iter()
    .flatten()
    {
        fragment_reachable[opt] = true;
    }
    if let Some(pos_idx) = outputs.position {
        vertex_reachable[pos_idx] = true;
    }
    for i in (0..nodes.len()).rev() {
        if fragment_reachable[i] {
            for &a in &nodes[i].args {
                fragment_reachable[a] = true;
            }
        }
        if vertex_reachable[i] {
            for &a in &nodes[i].args {
                vertex_reachable[a] = true;
            }
        }
    }

    let mut uses_time = false;
    let mut uses_derivatives = false;
    for (i, n) in nodes.iter().enumerate() {
        if vertex_reachable[i]
            && matches!(
                n.op,
                TslOp::Builtin(TslBuiltin::ViewDirection) | TslOp::Fresnel | TslOp::BumpFromHeight
            )
        {
            let offender = match n.op {
                TslOp::Builtin(TslBuiltin::ViewDirection) => "viewDirection",
                _ => n.op_name,
            };
            return Err(make_diag(
                "TL503",
                format!(
                    "Fragment-only TSL op '{}' (node {}) cannot be wired into vertex positionNode on '{}'.",
                    offender, i, material_label
                ),
                "Use positionLocal, positionWorld, normalLocal, normalWorld, uv, time, or simplexNoise3D inside positionNode.",
                material_label,
            ));
        }
        if fragment_reachable[i] || vertex_reachable[i] {
            if n.op == TslOp::Builtin(TslBuiltin::Time) {
                uses_time = true;
            }
            if n.op == TslOp::BumpFromHeight {
                uses_derivatives = true;
            }
        }
    }

    Ok(ValidatedTslGraph {
        nodes,
        uses_vertex_position: outputs.position.is_some(),
        outputs,
        uniform_slots,
        hash: format!("{:08x}", hash),
        uses_time,
        uses_derivatives,
        fragment_reachable,
        vertex_reachable,
    })
}

// =========================================================================
// Deterministic CPU Evaluator & PBR Texture Baker
// =========================================================================

#[derive(Debug, Clone)]
pub struct TslEvalContext<'a> {
    pub position_local: [f32; 3],
    pub position_world: [f32; 3],
    pub normal_local: [f32; 3],
    pub normal_world: [f32; 3],
    pub view_direction: [f32; 3],
    pub uv: [f32; 2],
    pub vertex_color: [f32; 4],
    pub instance_index: f32,
    pub time: f32,
    pub uniform_overrides: Option<&'a BTreeMap<String, [f32; 4]>>,
}

impl Default for TslEvalContext<'_> {
    fn default() -> Self {
        Self {
            position_local: [0.0, 0.0, 0.0],
            position_world: [0.0, 0.0, 0.0],
            normal_local: [0.0, 1.0, 0.0],
            normal_world: [0.0, 1.0, 0.0],
            view_direction: [0.0, 0.0, 1.0],
            uv: [0.0, 0.0],
            vertex_color: [1.0, 1.0, 1.0, 1.0],
            instance_index: 0.0,
            time: 0.0,
            uniform_overrides: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct TslEvalOutputs {
    pub color: Option<[f32; 3]>,
    pub opacity: Option<f32>,
    pub emissive: Option<[f32; 3]>,
    pub roughness: Option<f32>,
    pub metalness: Option<f32>,
    pub normal_scale: Option<f32>,
    pub bump: Option<[f32; 3]>,
    pub position: Option<[f32; 3]>,
}

#[inline]
pub fn tsl_safe_div(a: f32, b: f32) -> f32 {
    let denom = if b.abs() < 1e-6 {
        if b < 0.0 {
            -1e-6
        } else {
            1e-6
        }
    } else {
        b
    };
    a / denom
}

#[inline]
pub fn tsl_safe_mod(a: f32, b: f32) -> f32 {
    let d = if b.abs() < 1e-6 {
        if b < 0.0 {
            -1e-6
        } else {
            1e-6
        }
    } else {
        b
    };
    a - d * (a / d).floor()
}

#[inline]
pub fn tsl_safe_pow(a: f32, b: f32) -> f32 {
    let exp = b.clamp(-64.0, 64.0);
    if exp.abs() < 1e-8 {
        1.0
    } else if a <= 0.0 {
        0.0
    } else {
        a.max(1e-8).powf(exp)
    }
}

#[inline]
pub fn tsl_safe_clamp(x: f32, lo: f32, hi: f32) -> f32 {
    let a = lo.min(hi);
    let b = lo.max(hi);
    x.max(a).min(b)
}

#[inline]
pub fn tsl_safe_smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = tsl_safe_clamp(tsl_safe_div(x - e0, e1 - e0), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn mod289(x: f32) -> f32 {
    x - (x * (1.0 / 289.0)).floor() * 289.0
}

#[inline]
fn permute(x: f32) -> f32 {
    mod289((x * 34.0 + 10.0) * x)
}

#[inline]
fn taylor_inv_sqrt(r: f32) -> f32 {
    1.792_842_9 - 0.853_734_73 * r
}

/// Pure-ALU Ashima 2D Simplex Noise in `[0, 1]`.
pub fn tsl_simplex_noise_2d(vx: f32, vy: f32) -> f32 {
    let c0: f32 = 0.211_324_87;
    let c1: f32 = 0.366_025_4;
    let c2: f32 = -0.577_350_26;
    let c3: f32 = 0.024_390_243;

    let s = (vx + vy) * c1;
    let mut ix = (vx + s).floor();
    let mut iy = (vy + s).floor();
    let t = (ix + iy) * c0;
    let x0x = vx - ix + t;
    let x0y = vy - iy + t;

    let (i1x, i1y) = if x0x > x0y { (1.0, 0.0) } else { (0.0, 1.0) };
    let x1x = x0x + c0 - i1x;
    let x1y = x0y + c0 - i1y;
    let x2x = x0x + c2;
    let x2y = x0y + c2;

    ix = mod289(ix);
    iy = mod289(iy);
    let p0 = permute(permute(iy) + ix);
    let p1 = permute(permute(iy + i1y) + ix + i1x);
    let p2 = permute(permute(iy + 1.0) + ix + 1.0);

    let mut m0 = (0.5 - (x0x * x0x + x0y * x0y)).max(0.0);
    let mut m1 = (0.5 - (x1x * x1x + x1y * x1y)).max(0.0);
    let mut m2 = (0.5 - (x2x * x2x + x2y * x2y)).max(0.0);
    m0 = m0 * m0 * m0 * m0;
    m1 = m1 * m1 * m1 * m1;
    m2 = m2 * m2 * m2 * m2;

    let gx0 = 2.0 * (p0 * c3 - (p0 * c3).floor()) - 1.0;
    let gx1 = 2.0 * (p1 * c3 - (p1 * c3).floor()) - 1.0;
    let gx2 = 2.0 * (p2 * c3 - (p2 * c3).floor()) - 1.0;
    let hy0 = gx0.abs() - 0.5;
    let hy1 = gx1.abs() - 0.5;
    let hy2 = gx2.abs() - 0.5;
    let ox0 = gx0 - (gx0 + 0.5).floor();
    let ox1 = gx1 - (gx1 + 0.5).floor();
    let ox2 = gx2 - (gx2 + 0.5).floor();

    m0 *= taylor_inv_sqrt(ox0 * ox0 + hy0 * hy0);
    m1 *= taylor_inv_sqrt(ox1 * ox1 + hy1 * hy1);
    m2 *= taylor_inv_sqrt(ox2 * ox2 + hy2 * hy2);

    let g0 = ox0 * x0x + hy0 * x0y;
    let g1 = ox1 * x1x + hy1 * x1y;
    let g2 = ox2 * x2x + hy2 * x2y;
    let n = 130.0 * (m0 * g0 + m1 * g1 + m2 * g2);
    tsl_safe_clamp(0.5 + 0.5 * n, 0.0, 1.0)
}

/// Pure-ALU Ashima 3D Simplex Noise in `[0, 1]`.
pub fn tsl_simplex_noise_3d(vx: f32, vy: f32, vz: f32) -> f32 {
    let c0: f32 = 1.0 / 6.0;
    let c1: f32 = 1.0 / 3.0;
    let s = (vx + vy + vz) * c1;
    let mut i0 = (vx + s).floor();
    let mut i1 = (vy + s).floor();
    let mut i2 = (vz + s).floor();
    let t = (i0 + i1 + i2) * c0;
    let x0 = vx - i0 + t;
    let y0 = vy - i1 + t;
    let z0 = vz - i2 + t;

    let gx: f32 = if x0 >= y0 { 1.0 } else { 0.0 };
    let gy: f32 = if y0 >= z0 { 1.0 } else { 0.0 };
    let gz: f32 = if z0 >= x0 { 1.0 } else { 0.0 };
    let l0 = 1.0 - gz;
    let l1 = 1.0 - gx;
    let l2 = 1.0 - gy;

    let i1x = gx.min(l0);
    let i1y = gy.min(l1);
    let i1z = gz.min(l2);
    let i2x = gx.max(l0);
    let i2y = gy.max(l1);
    let i2z = gz.max(l2);

    let x1 = x0 - i1x + c0;
    let y1 = y0 - i1y + c0;
    let z1 = z0 - i1z + c0;
    let x2 = x0 - i2x + c1;
    let y2 = y0 - i2y + c1;
    let z2 = z0 - i2z + c1;
    let x3 = x0 - 0.5;
    let y3 = y0 - 0.5;
    let z3 = z0 - 0.5;

    i0 = mod289(i0);
    i1 = mod289(i1);
    i2 = mod289(i2);

    let p0 = permute(permute(permute(i2) + i1) + i0);
    let p1 = permute(permute(permute(i2 + i1z) + i1 + i1y) + i0 + i1x);
    let p2 = permute(permute(permute(i2 + i2z) + i1 + i2y) + i0 + i2x);
    let p3 = permute(permute(permute(i2 + 1.0) + i1 + 1.0) + i0 + 1.0);

    let ns: f32 = 1.0 / 7.0;
    let ps = [p0, p1, p2, p3];
    let xs = [x0, x1, x2, x3];
    let ys = [y0, y1, y2, y3];
    let zs = [z0, z1, z2, z3];
    let mut sum = 0.0f32;
    for k in 0..4 {
        let pk = ps[k];
        let j = pk - 49.0 * (pk * ns * ns).floor();
        let x_ = (j * ns).floor();
        let y_ = (j - 7.0 * x_).floor();
        let mut gx_k = x_ * (2.0 / 7.0) + (1.0 / 7.0) - 1.0;
        let mut gy_k = y_ * (2.0 / 7.0) + (1.0 / 7.0) - 1.0;
        let gz_k = 1.0 - gx_k.abs() - gy_k.abs();
        let sz = if gz_k < 0.0 { 1.0 } else { 0.0 };
        gx_k -= sz * if gx_k >= 0.0 { 1.0 } else { -1.0 };
        gy_k -= sz * if gy_k >= 0.0 { 1.0 } else { -1.0 };
        let inv = taylor_inv_sqrt(gx_k * gx_k + gy_k * gy_k + gz_k * gz_k);
        gx_k *= inv;
        gy_k *= inv;
        let gz_n = gz_k * inv;
        let mut m = (0.6 - (xs[k] * xs[k] + ys[k] * ys[k] + zs[k] * zs[k])).max(0.0);
        m *= m;
        m *= m;
        sum += m * (gx_k * xs[k] + gy_k * ys[k] + gz_n * zs[k]);
    }
    tsl_safe_clamp(0.5 + 0.5 * (42.0 * sum), 0.0, 1.0)
}

/// Pure-ALU cellular F1 Voronoi distance in `[0, 1]`.
pub fn tsl_voronoi_2d(ux: f32, uy: f32, jitter: f32) -> f32 {
    let nx = ux.floor();
    let ny = uy.floor();
    let fx = ux - nx;
    let fy = uy - ny;
    let jit = tsl_safe_clamp(jitter, 0.0, 1.0);
    let mut min_dist = 8.0f32;
    for dy in -1..=1 {
        for dx in -1..=1 {
            let qx = mod289(nx + dx as f32);
            let qy = mod289(ny + dy as f32);
            let p_a = permute(permute(qx) + qy) * (1.0 / 41.0);
            let p_b = permute(permute(qy + 7.0) + qx + 13.0) * (1.0 / 41.0);
            let hx = p_a - p_a.floor();
            let hy = p_b - p_b.floor();
            let rx = dx as f32 + 0.5 + (hx - 0.5) * jit - fx;
            let ry = dy as f32 + 0.5 + (hy - 0.5) * jit - fy;
            let d = (rx * rx + ry * ry).sqrt();
            if d < min_dist {
                min_dist = d;
            }
        }
    }
    tsl_safe_clamp(min_dist, 0.0, 1.0)
}

#[inline]
fn norm_slice(v: &[f32]) -> [f32; 4] {
    let mut sq = 0.0f32;
    for &c in v {
        sq += c * c;
    }
    let len = sq.sqrt();
    let mut out = [0.0f32; 4];
    if len > 1e-6 {
        for (i, &c) in v.iter().enumerate() {
            out[i] = c / len;
        }
    }
    out
}

/// Evaluates `graph` at `ctx` (`vertex_only = true` evaluates only `vertex_reachable` nodes).
pub fn evaluate_tsl_graph(
    graph: &ValidatedTslGraph,
    ctx: &TslEvalContext<'_>,
    vertex_only: bool,
) -> TslEvalOutputs {
    let wrapped_time =
        tsl_safe_mod(if ctx.time.is_finite() { ctx.time } else { 0.0 }, TSL_TIME_PERIOD_SEC);

    let mut vals = vec![[0.0f32; 4]; graph.nodes.len()];

    for (i, n) in graph.nodes.iter().enumerate() {
        if vertex_only && !graph.vertex_reachable[i] {
            continue;
        }
        let arity = n.ty.arity();
        let get_c = |node_idx: usize, comp: usize, vals: &[[f32; 4]]| -> f32 {
            if graph.nodes[node_idx].ty == TslType::Float {
                vals[node_idx][0]
            } else {
                vals[node_idx][comp]
            }
        };

        match n.op {
            TslOp::Const => vals[i] = n.const_val,
            TslOp::Builtin(b) => match b {
                TslBuiltin::PositionLocal => {
                    vals[i] =
                        [ctx.position_local[0], ctx.position_local[1], ctx.position_local[2], 0.0]
                }
                TslBuiltin::PositionWorld => {
                    vals[i] =
                        [ctx.position_world[0], ctx.position_world[1], ctx.position_world[2], 0.0]
                }
                TslBuiltin::NormalLocal => {
                    vals[i] = [ctx.normal_local[0], ctx.normal_local[1], ctx.normal_local[2], 0.0]
                }
                TslBuiltin::NormalWorld => {
                    vals[i] = [ctx.normal_world[0], ctx.normal_world[1], ctx.normal_world[2], 0.0]
                }
                TslBuiltin::ViewDirection => {
                    vals[i] =
                        [ctx.view_direction[0], ctx.view_direction[1], ctx.view_direction[2], 0.0]
                }
                TslBuiltin::Uv => vals[i] = [ctx.uv[0], ctx.uv[1], 0.0, 0.0],
                TslBuiltin::VertexColor => vals[i] = ctx.vertex_color,
                TslBuiltin::InstanceIndex => vals[i] = [ctx.instance_index, 0.0, 0.0, 0.0],
                TslBuiltin::Time => vals[i] = [wrapped_time, 0.0, 0.0, 0.0],
            },
            TslOp::Uniform(slot) => {
                if let Some(u_info) = graph.uniform_slots.get(slot) {
                    if let Some(ov) = ctx.uniform_overrides.and_then(|m| m.get(&u_info.name)) {
                        vals[i] = *ov;
                    } else {
                        vals[i] = u_info.default_vec4;
                    }
                }
            }
            TslOp::Swizzle(mask, len) => {
                let src = vals[n.args[0]];
                for c in 0..(len as usize) {
                    vals[i][c] = src[mask[c] as usize];
                }
            }
            TslOp::Construct => {
                if n.args.len() == 1 && graph.nodes[n.args[0]].ty == TslType::Float {
                    let s = vals[n.args[0]][0];
                    for c in 0..arity {
                        vals[i][c] = s;
                    }
                } else {
                    let mut k = 0usize;
                    for &a in &n.args {
                        let a_arity = graph.nodes[a].ty.arity();
                        for c in 0..a_arity {
                            if k < arity {
                                vals[i][k] = vals[a][c];
                                k += 1;
                            }
                        }
                    }
                }
            }
            TslOp::Neg => {
                for c in 0..arity {
                    vals[i][c] = -vals[n.args[0]][c];
                }
            }
            TslOp::Abs => {
                for c in 0..arity {
                    vals[i][c] = vals[n.args[0]][c].abs();
                }
            }
            TslOp::Sign => {
                for c in 0..arity {
                    let x = vals[n.args[0]][c];
                    vals[i][c] = if x > 0.0 {
                        1.0
                    } else if x < 0.0 {
                        -1.0
                    } else {
                        0.0
                    };
                }
            }
            TslOp::Floor => {
                for c in 0..arity {
                    vals[i][c] = vals[n.args[0]][c].floor();
                }
            }
            TslOp::Ceil => {
                for c in 0..arity {
                    vals[i][c] = vals[n.args[0]][c].ceil();
                }
            }
            TslOp::Fract => {
                for c in 0..arity {
                    let x = vals[n.args[0]][c];
                    vals[i][c] = x - x.floor();
                }
            }
            TslOp::Sqrt => {
                for c in 0..arity {
                    vals[i][c] = vals[n.args[0]][c].max(0.0).sqrt();
                }
            }
            TslOp::Exp => {
                for c in 0..arity {
                    vals[i][c] = tsl_safe_clamp(vals[n.args[0]][c], -80.0, 80.0).exp();
                }
            }
            TslOp::Log => {
                for c in 0..arity {
                    vals[i][c] = vals[n.args[0]][c].max(1e-8).ln();
                }
            }
            TslOp::Sin => {
                for c in 0..arity {
                    vals[i][c] = vals[n.args[0]][c].sin();
                }
            }
            TslOp::Cos => {
                for c in 0..arity {
                    vals[i][c] = vals[n.args[0]][c].cos();
                }
            }
            TslOp::Normalize => {
                vals[i] = norm_slice(&vals[n.args[0]][..arity]);
            }
            TslOp::Add
            | TslOp::Sub
            | TslOp::Mul
            | TslOp::Div
            | TslOp::Mod
            | TslOp::Pow
            | TslOp::Atan2
            | TslOp::Min
            | TslOp::Max
            | TslOp::Step => {
                let (a0, a1) = (n.args[0], n.args[1]);
                for c in 0..arity {
                    let av = get_c(a0, c, &vals);
                    let bv = get_c(a1, c, &vals);
                    vals[i][c] = match n.op {
                        TslOp::Add => av + bv,
                        TslOp::Sub => av - bv,
                        TslOp::Mul => av * bv,
                        TslOp::Div => tsl_safe_div(av, bv),
                        TslOp::Mod => tsl_safe_mod(av, bv),
                        TslOp::Pow => tsl_safe_pow(av, bv),
                        TslOp::Atan2 => {
                            if av.abs() < 1e-8 && bv.abs() < 1e-8 {
                                0.0
                            } else {
                                av.atan2(bv)
                            }
                        }
                        TslOp::Min => av.min(bv),
                        TslOp::Max => av.max(bv),
                        _ => {
                            if bv < av {
                                0.0
                            } else {
                                1.0
                            }
                        }
                    };
                }
            }
            TslOp::Clamp => {
                let (a0, a1, a2) = (n.args[0], n.args[1], n.args[2]);
                for c in 0..arity {
                    vals[i][c] = tsl_safe_clamp(
                        get_c(a0, c, &vals),
                        get_c(a1, c, &vals),
                        get_c(a2, c, &vals),
                    );
                }
            }
            TslOp::Mix => {
                let (a0, a1, a2) = (n.args[0], n.args[1], n.args[2]);
                for c in 0..arity {
                    let a = vals[a0][c];
                    let b = vals[a1][c];
                    let t = get_c(a2, c, &vals);
                    vals[i][c] = a + (b - a) * t;
                }
            }
            TslOp::Smoothstep => {
                let (a0, a1, a2) = (n.args[0], n.args[1], n.args[2]);
                for c in 0..arity {
                    vals[i][c] = tsl_safe_smoothstep(
                        get_c(a0, c, &vals),
                        get_c(a1, c, &vals),
                        get_c(a2, c, &vals),
                    );
                }
            }
            TslOp::Dot => {
                let src_a = graph.nodes[n.args[0]].ty.arity();
                let mut d = 0.0f32;
                for c in 0..src_a {
                    d += vals[n.args[0]][c] * vals[n.args[1]][c];
                }
                vals[i][0] = d;
            }
            TslOp::Length => {
                let src_a = graph.nodes[n.args[0]].ty.arity();
                let mut sq = 0.0f32;
                for c in 0..src_a {
                    let x = vals[n.args[0]][c];
                    sq += x * x;
                }
                vals[i][0] = sq.sqrt();
            }
            TslOp::Distance => {
                let src_a = graph.nodes[n.args[0]].ty.arity();
                let mut sq = 0.0f32;
                for c in 0..src_a {
                    let d = vals[n.args[0]][c] - vals[n.args[1]][c];
                    sq += d * d;
                }
                vals[i][0] = sq.sqrt();
            }
            TslOp::Cross => {
                let a = vals[n.args[0]];
                let b = vals[n.args[1]];
                vals[i] = [
                    a[1] * b[2] - a[2] * b[1],
                    a[2] * b[0] - a[0] * b[2],
                    a[0] * b[1] - a[1] * b[0],
                    0.0,
                ];
            }
            TslOp::Reflect => {
                let inc = vals[n.args[0]];
                let nrm = vals[n.args[1]];
                let mut d = 0.0f32;
                for c in 0..arity {
                    d += nrm[c] * inc[c];
                }
                for c in 0..arity {
                    vals[i][c] = inc[c] - 2.0 * d * nrm[c];
                }
            }
            TslOp::Fresnel => {
                let nw = norm_slice(&ctx.normal_world);
                let vd = norm_slice(&ctx.view_direction);
                let ndv = tsl_safe_clamp(nw[0] * vd[0] + nw[1] * vd[1] + nw[2] * vd[2], 0.0, 1.0);
                let power = vals[n.args[0]][0].max(1e-3);
                vals[i][0] = tsl_safe_pow(1.0 - ndv, power);
            }
            TslOp::SimplexNoise2D => {
                let p = vals[n.args[0]];
                vals[i][0] = tsl_simplex_noise_2d(p[0], p[1]);
            }
            TslOp::SimplexNoise3D => {
                let p = vals[n.args[0]];
                vals[i][0] = tsl_simplex_noise_3d(p[0], p[1], p[2]);
            }
            TslOp::Voronoi2D => {
                let p = vals[n.args[0]];
                let jit = vals[n.args[1]][0];
                vals[i][0] = tsl_voronoi_2d(p[0], p[1], jit);
            }
            TslOp::Checker => {
                let p = vals[n.args[0]];
                let m = tsl_safe_mod(p[0].floor() + p[1].floor(), 2.0);
                vals[i][0] = if m >= 1.0 { 1.0 } else { 0.0 };
            }
            TslOp::Triplanar => {
                let p = vals[n.args[0]];
                let sharp = tsl_safe_clamp(vals[n.args[1]][0], 0.5, 16.0);
                let nw = norm_slice(&ctx.normal_world);
                let wx = tsl_safe_pow(nw[0].abs().max(1e-4), sharp);
                let wy = tsl_safe_pow(nw[1].abs().max(1e-4), sharp);
                let wz = tsl_safe_pow(nw[2].abs().max(1e-4), sharp);
                let w_sum = (wx + wy + wz).max(1e-6);
                let nx = tsl_simplex_noise_2d(p[1], p[2]);
                let ny = tsl_simplex_noise_2d(p[0], p[2]);
                let nz = tsl_simplex_noise_2d(p[0], p[1]);
                vals[i][0] = (wx * nx + wy * ny + wz * nz) / w_sum;
            }
            TslOp::HueShift => {
                let rgb = vals[n.args[0]];
                let ang = vals[n.args[1]][0];
                let k: f32 = 0.577_350_26;
                let cos_a = ang.cos();
                let sin_a = ang.sin();
                let dot_k_rgb = k * (rgb[0] + rgb[1] + rgb[2]);
                let cx = k * (rgb[2] - rgb[1]);
                let cy = k * (rgb[0] - rgb[2]);
                let cz = k * (rgb[1] - rgb[0]);
                vals[i] = [
                    rgb[0] * cos_a + cx * sin_a + k * dot_k_rgb * (1.0 - cos_a),
                    rgb[1] * cos_a + cy * sin_a + k * dot_k_rgb * (1.0 - cos_a),
                    rgb[2] * cos_a + cz * sin_a + k * dot_k_rgb * (1.0 - cos_a),
                    0.0,
                ];
            }
            TslOp::BumpFromHeight => {
                let nw = norm_slice(&ctx.normal_world);
                vals[i] = [nw[0], nw[1], nw[2], 0.0];
            }
        }
    }

    let mut out = TslEvalOutputs::default();
    if let Some(idx) = graph.outputs.position {
        let v = vals[idx];
        out.position = Some([v[0], v[1], v[2]]);
    }
    if vertex_only {
        return out;
    }
    if let Some(idx) = graph.outputs.color {
        let v = vals[idx];
        out.color = Some([v[0].max(0.0), v[1].max(0.0), v[2].max(0.0)]);
    }
    if let Some(idx) = graph.outputs.opacity {
        out.opacity = Some(tsl_safe_clamp(vals[idx][0], 0.0, 1.0));
    }
    if let Some(idx) = graph.outputs.emissive {
        let v = vals[idx];
        out.emissive = Some([v[0].max(0.0), v[1].max(0.0), v[2].max(0.0)]);
    }
    if let Some(idx) = graph.outputs.roughness {
        out.roughness = Some(tsl_safe_clamp(vals[idx][0], 0.04, 1.0));
    }
    if let Some(idx) = graph.outputs.metalness {
        out.metalness = Some(tsl_safe_clamp(vals[idx][0], 0.0, 1.0));
    }
    if let Some(idx) = graph.outputs.normal_scale {
        out.normal_scale = Some(vals[idx][0].max(0.0));
    }
    if let Some(idx) = graph.outputs.bump {
        let n = norm_slice(&vals[idx][..3]);
        out.bump = Some([n[0], n[1], n[2]]);
    }
    out
}

/// Baked `size × size` fallback PBR maps for runtimes without live shader compilation.
#[derive(Debug, Clone)]
pub struct BakedTslPbrMaps {
    pub size: u32,
    pub base_color_png_uri: Option<String>,
    pub orm_png_uri: Option<String>,
    pub emissive_png_uri: Option<String>,
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[inline]
fn linear_to_srgb_u8(c: f32) -> u8 {
    let cl = c.clamp(0.0, 1.0);
    let s = if cl <= 0.003_130_8 { cl * 12.92 } else { 1.055 * cl.powf(1.0 / 2.4) - 0.055 };
    (s.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

/// Bakes static UV-space TSL outputs (`color`/`opacity`, `roughness`/`metalness`, `emissive`)
/// into `size × size` compressed PNG data URIs (default `256×256`).
pub fn bake_tsl_pbr_maps(
    graph: &ValidatedTslGraph,
    base_color: [f32; 4],
    base_roughness: f32,
    base_metallic: f32,
    size: u32,
) -> Result<BakedTslPbrMaps, String> {
    let dim = size.clamp(16, 512);
    let count = (dim * dim) as usize;
    let need_albedo = graph.outputs.color.is_some() || graph.outputs.opacity.is_some();
    let need_orm = graph.outputs.roughness.is_some() || graph.outputs.metalness.is_some();
    let need_emissive = graph.outputs.emissive.is_some();

    let mut albedo = if need_albedo { vec![0u8; count * 4] } else { Vec::new() };
    let mut orm = if need_orm { vec![0u8; count * 4] } else { Vec::new() };
    let mut emissive = if need_emissive { vec![0u8; count * 4] } else { Vec::new() };

    for y in 0..dim {
        let v = (y as f32 + 0.5) / (dim as f32);
        for x in 0..dim {
            let u = (x as f32 + 0.5) / (dim as f32);
            let px = u * 2.0 - 1.0;
            let py = (1.0 - v) * 2.0 - 1.0;
            let ctx = TslEvalContext {
                position_local: [px, py, 0.0],
                position_world: [px, py, 0.0],
                normal_local: [0.0, 0.0, 1.0],
                normal_world: [0.0, 0.0, 1.0],
                view_direction: [0.0, 0.0, 1.0],
                uv: [u, v],
                vertex_color: [1.0, 1.0, 1.0, 1.0],
                instance_index: 0.0,
                time: 0.0,
                uniform_overrides: None,
            };
            let ev = evaluate_tsl_graph(graph, &ctx, false);
            let off = ((y * dim + x) as usize) * 4;
            if need_albedo {
                let rgb = ev.color.unwrap_or([base_color[0], base_color[1], base_color[2]]);
                let a = ev.opacity.unwrap_or(base_color[3]);
                albedo[off] = linear_to_srgb_u8(rgb[0]);
                albedo[off + 1] = linear_to_srgb_u8(rgb[1]);
                albedo[off + 2] = linear_to_srgb_u8(rgb[2]);
                albedo[off + 3] = (a.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            }
            if need_orm {
                let r = ev.roughness.unwrap_or(base_roughness);
                let m = ev.metalness.unwrap_or(base_metallic);
                orm[off] = 255;
                orm[off + 1] = (r.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                orm[off + 2] = (m.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                orm[off + 3] = 255;
            }
            if need_emissive {
                let em = ev.emissive.unwrap_or([0.0, 0.0, 0.0]);
                emissive[off] = linear_to_srgb_u8(em[0]);
                emissive[off + 1] = linear_to_srgb_u8(em[1]);
                emissive[off + 2] = linear_to_srgb_u8(em[2]);
                emissive[off + 3] = 255;
            }
        }
    }

    let to_uri = |buf: &[u8]| -> Result<Option<String>, String> {
        if buf.is_empty() {
            return Ok(None);
        }
        let png = encode_png_rgba_compressed(dim, dim, buf)?;
        Ok(Some(format!("data:image/png;base64,{}", encode_base64(&png))))
    };

    Ok(BakedTslPbrMaps {
        size: dim,
        base_color_png_uri: to_uri(&albedo)?,
        orm_png_uri: to_uri(&orm)?,
        emissive_png_uri: to_uri(&emissive)?,
    })
}
