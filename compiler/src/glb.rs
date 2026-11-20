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

//! Pure Rust glTF 2.0 Binary (`.glb`) Reader (`read_glb`) for spatial linting and headless
//! rasterization (`three-live-cli`). Scene-to-GLB serialization is unified on TypeScript
//! (`three-convert.ts::sceneToGLB`).

use crate::scene::SceneGraph;

const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_VERSION: u32 = 2;
const CHUNK_TYPE_JSON: u32 = 0x4E4F534A; // "JSON"
const CHUNK_TYPE_BIN: u32 = 0x004E4942; // "BIN\0"

#[inline]
fn sanitize_finite(val: f32, fallback: f32) -> f32 {
    if val.is_finite() {
        val
    } else {
        fallback
    }
}

/// Decomposes a column-major 4x4 matrix into `(translation, rotation_quat, scale)`.
fn decompose_mat4(m: &[f32]) -> ([f32; 3], [f32; 4], [f32; 3]) {
    if m.len() < 16 {
        return ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0]);
    }
    let tx = sanitize_finite(m[12], 0.0);
    let ty = sanitize_finite(m[13], 0.0);
    let tz = sanitize_finite(m[14], 0.0);

    let m00 = sanitize_finite(m[0], 1.0);
    let m01 = sanitize_finite(m[1], 0.0);
    let m02 = sanitize_finite(m[2], 0.0);
    let m10 = sanitize_finite(m[4], 0.0);
    let m11 = sanitize_finite(m[5], 1.0);
    let m12 = sanitize_finite(m[6], 0.0);
    let m20 = sanitize_finite(m[8], 0.0);
    let m21 = sanitize_finite(m[9], 0.0);
    let m22 = sanitize_finite(m[10], 1.0);

    let mut sx = (m00 * m00 + m01 * m01 + m02 * m02).sqrt();
    let sy = (m10 * m10 + m11 * m11 + m12 * m12).sqrt();
    let sz = (m20 * m20 + m21 * m21 + m22 * m22).sqrt();

    let det = m00 * (m11 * m22 - m21 * m12) - m10 * (m01 * m22 - m21 * m02)
        + m20 * (m01 * m12 - m11 * m02);
    if det < 0.0 {
        sx = -sx;
    }

    let inv_sx = if sx.abs() > 1e-8 { 1.0 / sx } else { 0.0 };
    let inv_sy = if sy.abs() > 1e-8 { 1.0 / sy } else { 0.0 };
    let inv_sz = if sz.abs() > 1e-8 { 1.0 / sz } else { 0.0 };

    let r00 = m00 * inv_sx;
    let r01 = m01 * inv_sx;
    let r02 = m02 * inv_sx;
    let r10 = m10 * inv_sy;
    let r11 = m11 * inv_sy;
    let r12 = m12 * inv_sy;
    let r20 = m20 * inv_sz;
    let r21 = m21 * inv_sz;
    let r22 = m22 * inv_sz;

    let trace = r00 + r11 + r22;
    let (mut qx, mut qy, mut qz, mut qw) = if trace > 0.0 {
        let s = 0.5 / (trace + 1.0).sqrt();
        ((r12 - r21) * s, (r20 - r02) * s, (r01 - r10) * s, 0.25 / s)
    } else if r00 > r11 && r00 > r22 {
        let s = 2.0 * (1.0 + r00 - r11 - r22).max(0.0).sqrt();
        if s > 1e-8 {
            (0.25 * s, (r10 + r01) / s, (r20 + r02) / s, (r12 - r21) / s)
        } else {
            (0.0, 0.0, 0.0, 1.0)
        }
    } else if r11 > r22 {
        let s = 2.0 * (1.0 + r11 - r00 - r22).max(0.0).sqrt();
        if s > 1e-8 {
            ((r10 + r01) / s, 0.25 * s, (r12 + r21) / s, (r20 - r02) / s)
        } else {
            (0.0, 0.0, 0.0, 1.0)
        }
    } else {
        let s = 2.0 * (1.0 + r22 - r00 - r11).max(0.0).sqrt();
        if s > 1e-8 {
            ((r20 + r02) / s, (r12 + r21) / s, 0.25 * s, (r01 - r10) / s)
        } else {
            (0.0, 0.0, 0.0, 1.0)
        }
    };
    let qlen = (qx * qx + qy * qy + qz * qz + qw * qw).sqrt();
    if qlen > 1e-8 && qlen.is_finite() {
        qx /= qlen;
        qy /= qlen;
        qz /= qlen;
        qw /= qlen;
    } else {
        qx = 0.0;
        qy = 0.0;
        qz = 0.0;
        qw = 1.0;
    }
    ([tx, ty, tz], [qx, qy, qz, qw], [sx, sy, sz])
}

/// Parses a binary glTF 2.0 (`.glb`) container into a [`SceneGraph`] for spatial linting
/// and headless rasterization.
pub fn read_glb(glb: &[u8]) -> Result<SceneGraph, String> {
    use crate::scene::{Material3D, Mesh3D, MeshMaterialGroup, SceneNode};

    if glb.len() < 20 {
        return Err("GLB buffer too short (< 20 bytes)".to_string());
    }
    let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
    if magic != GLB_MAGIC {
        return Err("Invalid GLB magic header (expected 'glTF')".to_string());
    }
    let version = u32::from_le_bytes([glb[4], glb[5], glb[6], glb[7]]);
    if version != GLB_VERSION {
        return Err(format!("Unsupported GLB version {} (expected 2)", version));
    }

    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let json_type = u32::from_le_bytes([glb[16], glb[17], glb[18], glb[19]]);
    if json_type != CHUNK_TYPE_JSON {
        return Err("GLB chunk 0 is not a JSON chunk".to_string());
    }
    let json_end = 20usize
        .checked_add(json_len)
        .filter(|&end| end <= glb.len())
        .ok_or_else(|| "GLB JSON chunk length out of bounds".to_string())?;

    let gltf: serde_json::Value = serde_json::from_slice(&glb[20..json_end])
        .map_err(|e| format!("Invalid GLB JSON chunk: {}", e))?;

    let mut bin_slice: &[u8] = &[];
    if json_end + 8 <= glb.len() {
        let bin_len = u32::from_le_bytes([
            glb[json_end],
            glb[json_end + 1],
            glb[json_end + 2],
            glb[json_end + 3],
        ]) as usize;
        let bin_type = u32::from_le_bytes([
            glb[json_end + 4],
            glb[json_end + 5],
            glb[json_end + 6],
            glb[json_end + 7],
        ]);
        if bin_type == CHUNK_TYPE_BIN {
            let bin_start = json_end + 8;
            let bin_end = bin_start.saturating_add(bin_len).min(glb.len());
            bin_slice = &glb[bin_start..bin_end];
        }
    }

    let buffer_views = gltf["bufferViews"].as_array().cloned().unwrap_or_default();
    let accessors = gltf["accessors"].as_array().cloned().unwrap_or_default();

    let read_acc_f32 = |acc_idx: usize, comps: usize| -> Vec<f32> {
        let Some(acc) = accessors.get(acc_idx) else {
            return Vec::new();
        };
        let Some(bv_idx) = acc["bufferView"].as_u64().map(|v| v as usize) else {
            return Vec::new();
        };
        let Some(bv) = buffer_views.get(bv_idx) else {
            return Vec::new();
        };
        let count = usize::try_from(acc["count"].as_u64().unwrap_or(0)).unwrap_or(0);
        if count == 0 || count > crate::constants::SECURITY_3D_MAX_VERTICES {
            return Vec::new();
        }
        let bv_offset =
            usize::try_from(bv["byteOffset"].as_u64().unwrap_or(0)).unwrap_or(usize::MAX);
        let acc_offset =
            usize::try_from(acc["byteOffset"].as_u64().unwrap_or(0)).unwrap_or(usize::MAX);
        let elem_bytes = comps * 4;
        let stride =
            bv["byteStride"].as_u64().and_then(|v| usize::try_from(v).ok()).unwrap_or(elem_bytes);
        if stride < elem_bytes {
            return Vec::new();
        }
        let Some(start) = bv_offset.checked_add(acc_offset) else {
            return Vec::new();
        };
        let Some(last_elem_off) =
            (count - 1).checked_mul(stride).and_then(|d| start.checked_add(d))
        else {
            return Vec::new();
        };
        if last_elem_off.checked_add(elem_bytes).is_none_or(|end| end > bin_slice.len()) {
            return Vec::new();
        }
        let Some(out_cap) = count.checked_mul(comps) else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(out_cap);
        for i in 0..count {
            let elem_off = start + i * stride;
            for c in 0..comps {
                let o = elem_off + c * 4;
                let v = f32::from_le_bytes([
                    bin_slice[o],
                    bin_slice[o + 1],
                    bin_slice[o + 2],
                    bin_slice[o + 3],
                ]);
                out.push(sanitize_finite(v, 0.0));
            }
        }
        out
    };

    let read_acc_u32 = |acc_idx: usize| -> Vec<u32> {
        let Some(acc) = accessors.get(acc_idx) else {
            return Vec::new();
        };
        let Some(bv_idx) = acc["bufferView"].as_u64().map(|v| v as usize) else {
            return Vec::new();
        };
        let Some(bv) = buffer_views.get(bv_idx) else {
            return Vec::new();
        };
        let count = usize::try_from(acc["count"].as_u64().unwrap_or(0)).unwrap_or(0);
        if count == 0 || count > crate::constants::SECURITY_3D_MAX_INDICES {
            return Vec::new();
        }
        let comp_type = acc["componentType"].as_u64().unwrap_or(5125) as u32;
        let elem_bytes = match comp_type {
            5121 => 1usize,
            5123 => 2usize,
            5125 => 4usize,
            _ => return Vec::new(),
        };
        let bv_offset =
            usize::try_from(bv["byteOffset"].as_u64().unwrap_or(0)).unwrap_or(usize::MAX);
        let acc_offset =
            usize::try_from(acc["byteOffset"].as_u64().unwrap_or(0)).unwrap_or(usize::MAX);
        let Some(start) = bv_offset.checked_add(acc_offset) else {
            return Vec::new();
        };
        if count
            .checked_mul(elem_bytes)
            .and_then(|n| start.checked_add(n))
            .is_none_or(|end| end > bin_slice.len())
        {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(count);
        match comp_type {
            5121 => {
                for i in 0..count {
                    if let Some(&b) = bin_slice.get(start + i) {
                        out.push(b as u32);
                    }
                }
            }
            5123 => {
                for i in 0..count {
                    let o = start + i * 2;
                    if o + 2 <= bin_slice.len() {
                        out.push(u16::from_le_bytes([bin_slice[o], bin_slice[o + 1]]) as u32);
                    }
                }
            }
            _ => {
                for i in 0..count {
                    let o = start + i * 4;
                    if o + 4 <= bin_slice.len() {
                        out.push(u32::from_le_bytes([
                            bin_slice[o],
                            bin_slice[o + 1],
                            bin_slice[o + 2],
                            bin_slice[o + 3],
                        ]));
                    }
                }
            }
        }
        out
    };

    // 1. Materials
    let resolve_tex_uri = |tex_info: &serde_json::Value| -> Option<String> {
        let tex_idx = tex_info["index"].as_u64()? as usize;
        let img_idx = gltf["textures"].get(tex_idx)?["source"].as_u64()? as usize;
        gltf["images"].get(img_idx)?["uri"].as_str().map(|s| s.to_string())
    };
    let mut materials = Vec::new();
    if let Some(mats) = gltf["materials"].as_array() {
        for (i, m) in mats.iter().enumerate() {
            let name = m["name"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Material_{}", i));
            let pbr = &m["pbrMetallicRoughness"];
            let bc = pbr["baseColorFactor"]
                .as_array()
                .map(|a| {
                    [
                        a.first().and_then(|v| v.as_f64()).unwrap_or(0.8) as f32,
                        a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.8) as f32,
                        a.get(2).and_then(|v| v.as_f64()).unwrap_or(0.8) as f32,
                        a.get(3).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                    ]
                })
                .unwrap_or([0.8, 0.8, 0.8, 1.0]);
            let metallic = pbr["metallicFactor"].as_f64().unwrap_or(0.1) as f32;
            let roughness = pbr["roughnessFactor"].as_f64().unwrap_or(0.5) as f32;
            let double_sided = m["doubleSided"].as_bool().unwrap_or(true);
            let base_color_texture = resolve_tex_uri(&pbr["baseColorTexture"]);
            let metallic_roughness_texture = resolve_tex_uri(&pbr["metallicRoughnessTexture"]);
            let normal_texture = resolve_tex_uri(&m["normalTexture"]);
            let normal_scale = m["normalTexture"]["scale"].as_f64().unwrap_or(1.0) as f32;
            let emissive_texture = resolve_tex_uri(&m["emissiveTexture"]);
            let emissive_factor = m["emissiveFactor"]
                .as_array()
                .map(|a| {
                    [
                        a.first().and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                        a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                        a.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                    ]
                })
                .unwrap_or([0.0, 0.0, 0.0]);
            let occlusion_texture = resolve_tex_uri(&m["occlusionTexture"]);
            let occlusion_strength =
                m["occlusionTexture"]["strength"].as_f64().unwrap_or(1.0) as f32;
            let alpha_blend = m["alphaMode"].as_str() == Some("BLEND");
            let tsl = m["extras"]
                .get(crate::tsl::TSL_EXTRAS_KEY)
                .cloned()
                .filter(|v| crate::tsl::validate_tsl_graph(v, &name).is_ok());
            materials.push(Material3D {
                name,
                base_color: bc,
                metallic,
                roughness,
                double_sided,
                base_color_texture,
                metallic_roughness_texture,
                normal_texture,
                normal_scale,
                emissive_factor,
                emissive_texture,
                occlusion_texture,
                occlusion_strength,
                alpha_blend,
                tsl,
                ..Default::default()
            });
        }
    }

    // 2. Meshes
    let mut meshes = Vec::new();
    if let Some(gltf_meshes) = gltf["meshes"].as_array() {
        for (i, gm) in gltf_meshes.iter().enumerate() {
            let name =
                gm["name"].as_str().map(|s| s.to_string()).unwrap_or_else(|| format!("Mesh_{}", i));
            let prims = gm["primitives"].as_array().map(|p| p.as_slice()).unwrap_or(&[]);
            if prims.is_empty() {
                meshes.push(Mesh3D {
                    name,
                    positions: Vec::new(),
                    normals: Vec::new(),
                    uvs: Vec::new(),
                    colors: Vec::new(),
                    indices: Vec::new(),
                    material_index: None,
                    groups: Vec::new(),
                    variant_mappings: None,
                    xr_traits: None,
                    xr_normalized: None,
                    xr_scenecore: None,
                    xr_hubs: None,
                    translation: [0.0; 3],
                    scale: [1.0; 3],
                });
                continue;
            }

            let any_norm = prims.iter().any(|p| p["attributes"]["NORMAL"].as_u64().is_some());
            let any_uv = prims.iter().any(|p| p["attributes"]["TEXCOORD_0"].as_u64().is_some());
            let any_col = prims.iter().any(|p| p["attributes"]["COLOR_0"].as_u64().is_some());

            let mut positions: Vec<[f32; 3]> = Vec::new();
            let mut normals: Vec<[f32; 3]> = Vec::new();
            let mut uvs: Vec<[f32; 2]> = Vec::new();
            let mut colors: Vec<[f32; 3]> = Vec::new();
            let mut indices: Vec<u32> = Vec::new();
            let mut groups: Vec<MeshMaterialGroup> = Vec::new();
            let mut attr_cache: Vec<(
                Option<u64>,
                Option<u64>,
                Option<u64>,
                Option<u64>,
                usize,
                usize,
            )> = Vec::new();

            for prim in prims {
                let pos_acc = prim["attributes"]["POSITION"].as_u64();
                let norm_acc = prim["attributes"]["NORMAL"].as_u64();
                let uv_acc = prim["attributes"]["TEXCOORD_0"].as_u64();
                let prim_col_acc = prim["attributes"]["COLOR_0"].as_u64();
                let col_acc = prim_col_acc.or_else(|| {
                    let mut shared: Option<u64> = None;
                    for p in prims {
                        if p["attributes"]["POSITION"].as_u64() == pos_acc
                            && p["attributes"]["NORMAL"].as_u64() == norm_acc
                            && p["attributes"]["TEXCOORD_0"].as_u64() == uv_acc
                        {
                            if let Some(ca) = p["attributes"]["COLOR_0"].as_u64() {
                                if shared.is_some_and(|prev| prev != ca) {
                                    return None;
                                }
                                shared = Some(ca);
                            }
                        }
                    }
                    shared
                });
                let key = (pos_acc, norm_acc, uv_acc, col_acc);

                let (v_offset, v_count) = if let Some(&(_, _, _, _, off, cnt)) =
                    attr_cache.iter().find(|&&(pa, na, ua, ca, _, _)| (pa, na, ua, ca) == key)
                {
                    (off, cnt)
                } else {
                    let pos_flat =
                        pos_acc.map(|idx| read_acc_f32(idx as usize, 3)).unwrap_or_default();
                    let cnt = pos_flat.len() / 3;
                    if cnt == 0
                        || positions.len().saturating_add(cnt)
                            > crate::constants::SECURITY_3D_MAX_VERTICES
                    {
                        continue;
                    }
                    let off = positions.len();
                    for chunk in pos_flat.as_chunks::<3>().0 {
                        positions.push([chunk[0], chunk[1], chunk[2]]);
                    }

                    if any_norm {
                        let norm_flat =
                            norm_acc.map(|idx| read_acc_f32(idx as usize, 3)).unwrap_or_default();
                        let mut added = 0usize;
                        for chunk in norm_flat.as_chunks::<3>().0.iter().take(cnt) {
                            normals.push([chunk[0], chunk[1], chunk[2]]);
                            added += 1;
                        }
                        normals.resize(normals.len() + cnt.saturating_sub(added), [0.0, 1.0, 0.0]);
                    }

                    if any_uv {
                        let uv_flat =
                            uv_acc.map(|idx| read_acc_f32(idx as usize, 2)).unwrap_or_default();
                        let mut added = 0usize;
                        for chunk in uv_flat.as_chunks::<2>().0.iter().take(cnt) {
                            uvs.push([chunk[0], chunk[1]]);
                            added += 1;
                        }
                        uvs.resize(uvs.len() + cnt.saturating_sub(added), [0.0, 0.0]);
                    }

                    if any_col {
                        let col_acc_usize = col_acc.map(|idx| idx as usize);
                        let col_comps = col_acc_usize
                            .and_then(|idx| accessors.get(idx))
                            .and_then(|a| a["type"].as_str())
                            .map(|t| if t == "VEC4" { 4 } else { 3 })
                            .unwrap_or(3);
                        let col_flat = col_acc_usize
                            .map(|idx| read_acc_f32(idx, col_comps))
                            .unwrap_or_default();
                        let mut added = 0usize;
                        for chunk in col_flat.chunks_exact(col_comps).take(cnt) {
                            colors.push([chunk[0], chunk[1], chunk[2]]);
                            added += 1;
                        }
                        colors.resize(colors.len() + cnt.saturating_sub(added), [1.0, 1.0, 1.0]);
                    }

                    attr_cache.push((pos_acc, norm_acc, uv_acc, col_acc, off, cnt));
                    (off, cnt)
                };

                let prim_indices: Vec<u32> = if let Some(idx_acc) = prim["indices"].as_u64() {
                    read_acc_u32(idx_acc as usize)
                } else if prims.len() > 1 {
                    (0..v_count as u32).collect()
                } else {
                    Vec::new()
                };

                let material_index = prim["material"].as_u64().map(|idx| idx as usize);
                let use_vertex_colors = prim_col_acc.is_some();
                if prims.len() == 1 {
                    indices = prim_indices;
                    groups.push(MeshMaterialGroup {
                        start: 0,
                        count: indices.len(),
                        material_index,
                        use_vertex_colors,
                    });
                } else {
                    if indices.len().saturating_add(prim_indices.len())
                        > crate::constants::SECURITY_3D_MAX_INDICES
                    {
                        break;
                    }
                    let start = indices.len();
                    let count = prim_indices.len();
                    if count == 0 {
                        continue;
                    }
                    for raw_i in prim_indices {
                        indices.push((v_offset as u32).saturating_add(raw_i));
                    }
                    groups.push(MeshMaterialGroup {
                        start,
                        count,
                        material_index,
                        use_vertex_colors,
                    });
                }
            }

            let material_index = groups.first().and_then(|g| g.material_index);
            if prims.len() <= 1 {
                groups.clear();
            }

            meshes.push(Mesh3D {
                name,
                positions,
                normals,
                uvs,
                colors,
                indices,
                material_index,
                groups,
                variant_mappings: None,
                xr_traits: None,
                xr_normalized: None,
                xr_scenecore: None,
                xr_hubs: None,
                translation: [0.0; 3],
                scale: [1.0; 3],
            });
        }
    }

    // 3. Nodes (reconstruct parent indices in pre-order)
    let mut nodes = Vec::new();
    if let Some(gltf_nodes) = gltf["nodes"].as_array() {
        let mut parents: Vec<Option<usize>> = vec![None; gltf_nodes.len()];
        for (p_idx, gn) in gltf_nodes.iter().enumerate() {
            if let Some(children) = gn["children"].as_array() {
                for c in children {
                    if let Some(c_idx) = c.as_u64().map(|v| v as usize) {
                        if c_idx < gltf_nodes.len() && c_idx > p_idx {
                            parents[c_idx] = Some(p_idx);
                        }
                    }
                }
            }
        }

        for (i, gn) in gltf_nodes.iter().enumerate() {
            let name = gn["name"].as_str().unwrap_or("").to_string();
            let (translation, rotation, scale) = if let Some(mat_arr) = gn["matrix"].as_array() {
                let mut m = [0.0f32; 16];
                for (k, v) in mat_arr.iter().take(16).enumerate() {
                    m[k] = v.as_f64().unwrap_or(0.0) as f32;
                }
                decompose_mat4(&m)
            } else {
                let t = gn["translation"]
                    .as_array()
                    .map(|a| {
                        [
                            a.first().and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                            a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                            a.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                        ]
                    })
                    .unwrap_or([0.0, 0.0, 0.0]);
                let r = gn["rotation"]
                    .as_array()
                    .map(|a| {
                        [
                            a.first().and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                            a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                            a.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                            a.get(3).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                        ]
                    })
                    .unwrap_or([0.0, 0.0, 0.0, 1.0]);
                let s = gn["scale"]
                    .as_array()
                    .map(|a| {
                        [
                            a.first().and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                            a.get(1).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                            a.get(2).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                        ]
                    })
                    .unwrap_or([1.0, 1.0, 1.0]);
                (t, r, s)
            };

            let mesh = gn["mesh"].as_u64().map(|m| m as usize).filter(|&m| m < meshes.len());
            let xr_normalized = gn["extras"]["xr"].as_object().map(|_| gn["extras"]["xr"].clone());
            let visible =
                gn["extensions"]["KHR_node_visibility"]["visible"].as_bool().unwrap_or(true);
            let shadow = gn["extras"]["shadow"].as_object().and_then(|_| {
                serde_json::from_value::<crate::scene::NodeShadowConfig>(
                    gn["extras"]["shadow"].clone(),
                )
                .ok()
            });
            nodes.push(SceneNode {
                name,
                parent: parents[i],
                translation,
                rotation,
                scale,
                mesh,
                xr_normalized,
                visible,
                shadow,
                ..Default::default()
            });
        }
    }

    let mut lights: Vec<crate::scene::Light3D> =
        serde_json::from_value(gltf["asset"]["extras"]["lights"].clone()).unwrap_or_default();
    if lights.is_empty() {
        if let Some(khr_defs) = gltf["extensions"]["KHR_lights_punctual"]["lights"].as_array() {
            for (li, kl) in khr_defs.iter().enumerate() {
                let light_type = kl["type"].as_str().unwrap_or("directional").to_string();
                let color = kl["color"]
                    .as_array()
                    .map(|a| {
                        [
                            a.first().and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                            a.get(1).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                            a.get(2).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
                        ]
                    })
                    .unwrap_or([1.0, 1.0, 1.0]);
                let intensity = kl["intensity"].as_f64().unwrap_or(1.0) as f32;
                let range = kl["range"].as_f64().unwrap_or(0.0) as f32;
                let inner_cone_angle = kl["spot"]["innerConeAngle"].as_f64().unwrap_or(0.0) as f32;
                let outer_cone_angle =
                    kl["spot"]["outerConeAngle"].as_f64().unwrap_or(std::f64::consts::FRAC_PI_3)
                        as f32;
                let shadow = kl["extras"]["shadow"].as_object().and_then(|_| {
                    serde_json::from_value::<crate::scene::LightShadowConfig>(
                        kl["extras"]["shadow"].clone(),
                    )
                    .ok()
                });
                let node_index = gltf["nodes"].as_array().and_then(|gn_arr| {
                    gn_arr.iter().position(|gn| {
                        gn["extensions"]["KHR_lights_punctual"]["light"].as_u64() == Some(li as u64)
                    })
                });
                let node_ref = node_index.and_then(|ni| nodes.get(ni));
                let position = node_ref.map(|n| n.translation).unwrap_or([0.0; 3]);
                let direction = if light_type == "directional" || light_type == "spot" {
                    node_ref.map(|n| {
                        let q = n.rotation;
                        let s = if light_type == "directional" { 1.0 } else { -1.0 };
                        [
                            s * 2.0 * (q[0] * q[2] + q[3] * q[1]),
                            s * 2.0 * (q[1] * q[2] - q[3] * q[0]),
                            s * (1.0 - 2.0 * (q[0] * q[0] + q[1] * q[1])),
                        ]
                    })
                } else {
                    None
                };
                lights.push(crate::scene::Light3D {
                    light_type,
                    color,
                    ground_color: None,
                    intensity,
                    position,
                    direction,
                    range,
                    inner_cone_angle,
                    outer_cone_angle,
                    node_index,
                    shadow,
                });
            }
        }
    }

    Ok(SceneGraph {
        meshes,
        materials,
        lights,
        camera: None,
        interactivity: gltf["extensions"]["KHR_interactivity"]
            .as_object()
            .map(|_| gltf["extensions"]["KHR_interactivity"].clone()),
        variants: gltf["extensions"]["KHR_materials_variants"]
            .as_object()
            .map(|_| gltf["extensions"]["KHR_materials_variants"].clone()),
        nodes,
        diagnostics: Vec::new(),
    })
}
