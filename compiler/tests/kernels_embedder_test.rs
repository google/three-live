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

//! External Boa embedder & per-kernel conformance tests for `three_live_kernels`
//! (`THREE_LIVE_KERNELS_ABI_VERSION = 1`) and the standalone hosted compiler bundle
//! (`three-live-compiler-bundle.min.js` + `engine-requirements.json`).

use std::ffi::CStr;
use std::rc::Rc;

use boa_engine::{
    builtins::typed_array::TypedArrayKind,
    context::HostHooks,
    js_string,
    module::IdleModuleLoader,
    object::builtins::{
        AlignedVec, JsArray, JsArrayBuffer, JsFloat32Array, JsTypedArray, JsUint16Array,
        JsUint32Array, JsUint8Array,
    },
    vm::RuntimeLimits,
    Context, JsNativeError, JsObject, JsResult, JsString, JsValue, NativeFunction, Script, Source,
};
use three_live_compiler::kernels::{
    three_live_kernel_free, three_live_kernels_abi_version, three_live_kernels_table,
    ThreeLiveKernelBuffer, ThreeLiveKernelInvokeFn, ThreeLiveKernelSlice,
    THREE_LIVE_KERNELS_ABI_VERSION, THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED, THREE_LIVE_KERNEL_OK,
};

const HOSTED_BUNDLE_JS: &str = three_live_compiler::engine::EMBEDDED_THREE_AUTHOR_ENGINE_JS;
const ENGINE_REQUIREMENTS_JSON: &str = include_str!("../../three-live/engine-requirements.json");

#[derive(Debug, Clone, Copy)]
struct EmbedderHostHooks {
    max_buffer_bytes: u64,
}

impl HostHooks for EmbedderHostHooks {
    fn max_buffer_size(&self, _context: &mut Context) -> u64 {
        self.max_buffer_bytes
    }
}

struct KernelBufGuard(ThreeLiveKernelBuffer);

impl Drop for KernelBufGuard {
    fn drop(&mut self) {
        if !self.0.data.is_null() {
            unsafe {
                three_live_kernel_free(self.0.data, self.0.capacity);
            }
            self.0.data = std::ptr::null_mut();
        }
    }
}

fn make_u8_array(bytes: &[u8], ctx: &mut Context) -> JsResult<JsUint8Array> {
    let mut aligned = AlignedVec::with_capacity(64, bytes.len());
    aligned.extend_from_slice(bytes);
    let buf = JsArrayBuffer::from_byte_block(aligned, ctx)?;
    JsUint8Array::from_array_buffer(buf, ctx)
}

fn make_f32_array_bytes(bytes: &[u8], ctx: &mut Context) -> JsResult<JsFloat32Array> {
    let mut aligned = AlignedVec::with_capacity(64, bytes.len());
    aligned.extend_from_slice(bytes);
    let buf = JsArrayBuffer::from_byte_block(aligned, ctx)?;
    JsFloat32Array::from_array_buffer(buf, ctx)
}

fn make_u16_array_bytes(bytes: &[u8], ctx: &mut Context) -> JsResult<JsUint16Array> {
    let mut aligned = AlignedVec::with_capacity(64, bytes.len());
    aligned.extend_from_slice(bytes);
    let buf = JsArrayBuffer::from_byte_block(aligned, ctx)?;
    JsUint16Array::from_array_buffer(buf, ctx)
}

fn make_u32_array_bytes(bytes: &[u8], ctx: &mut Context) -> JsResult<JsUint32Array> {
    let mut aligned = AlignedVec::with_capacity(64, bytes.len());
    aligned.extend_from_slice(bytes);
    let buf = JsArrayBuffer::from_byte_block(aligned, ctx)?;
    JsUint32Array::from_array_buffer(buf, ctx)
}

fn read_typed_bytes(val: &JsValue, ctx: &mut Context) -> (Vec<u8>, Option<TypedArrayKind>) {
    let Some(obj) = val.as_object() else {
        return (Vec::new(), None);
    };
    if let Ok(ta) = JsTypedArray::from_object(obj.clone()) {
        let kind = ta.kind();
        if let Ok(bv) = ta.buffer(ctx) {
            if let Some(bo) = bv.as_object() {
                if let Ok(ab) = JsArrayBuffer::from_object(bo) {
                    if let Some(data) = ab.data() {
                        let off = ta.byte_offset(ctx).unwrap_or(0);
                        let len = ta.byte_length(ctx).unwrap_or(0);
                        let end = off.saturating_add(len).min(data.len());
                        let start = off.min(end);
                        return (data[start..end].to_vec(), kind);
                    }
                }
            }
        }
    } else if let Ok(ab) = JsArrayBuffer::from_object(obj) {
        if let Some(data) = ab.data() {
            return (data.to_vec(), None);
        }
    }
    (Vec::new(), None)
}

/// Generic C-ABI kernel binder: reads `three_live_kernels_table(&count)` and binds every entry on
/// `ctx` using ONLY `desc.js_global_name`, `desc.signature`, and `desc.invoke` — zero per-kernel
/// FFI glue or hardcoded kernel names.
fn bind_all_kernels_from_c_abi_table(ctx: &mut Context) -> usize {
    assert_eq!(three_live_kernels_abi_version(), THREE_LIVE_KERNELS_ABI_VERSION);
    let mut count = 0usize;
    let table_ptr = unsafe { three_live_kernels_table(&mut count) };
    assert!(!table_ptr.is_null() && count >= 20);
    let descriptors = unsafe { std::slice::from_raw_parts(table_ptr, count) };

    for desc in descriptors {
        let js_name = unsafe { CStr::from_ptr(desc.js_global_name).to_str().unwrap().to_string() };
        let sig = unsafe { CStr::from_ptr(desc.signature).to_str().unwrap().to_string() };
        let (in_part, out_part) = sig.split_once(")->").expect("valid signature");
        let in_tokens: Vec<String> = in_part
            .trim_start_matches('(')
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        let ret_token = out_part.to_string();
        let invoke: ThreeLiveKernelInvokeFn = desc.invoke;
        let arity = in_tokens.len();

        let closure = unsafe {
            NativeFunction::from_closure(move |_this, args, context| {
                let mut scalars: Vec<f64> = Vec::new();
                let mut owned_slices: Vec<Vec<u8>> = Vec::new();

                for (idx, tok) in in_tokens.iter().enumerate() {
                    let arg = args.get(idx).cloned().unwrap_or(JsValue::undefined());
                    match tok.as_str() {
                        "f" => {
                            let n = if arg.is_undefined() {
                                f64::NAN
                            } else if let Some(b) = arg.as_boolean() {
                                if b {
                                    1.0
                                } else {
                                    0.0
                                }
                            } else {
                                arg.to_number(context)?
                            };
                            scalars.push(n);
                        }
                        "b" => {
                            let (bytes, _) = read_typed_bytes(&arg, context);
                            owned_slices.push(bytes);
                        }
                        "u32s" => {
                            let (bytes, kind) = read_typed_bytes(&arg, context);
                            if kind == Some(TypedArrayKind::Uint16) {
                                let mut u32_bytes = Vec::with_capacity(bytes.len() * 2);
                                for c in bytes.as_chunks::<2>().0 {
                                    let v = u16::from_ne_bytes([c[0], c[1]]) as u32;
                                    u32_bytes.extend_from_slice(&v.to_ne_bytes());
                                }
                                owned_slices.push(u32_bytes);
                            } else if kind == Some(TypedArrayKind::Uint32) {
                                owned_slices.push(bytes);
                            } else {
                                owned_slices.push(Vec::new());
                            }
                        }
                        "i" => {
                            let (bytes, kind) = read_typed_bytes(&arg, context);
                            scalars.push(if kind == Some(TypedArrayKind::Uint16) {
                                1.0
                            } else {
                                0.0
                            });
                            owned_slices.push(bytes);
                        }
                        "s" => {
                            if arg.is_undefined() || arg.is_null() {
                                owned_slices.push(Vec::new());
                            } else {
                                let js_s = arg.to_string(context)?;
                                owned_slices.push(js_s.to_std_string_escaped().into_bytes());
                            }
                        }
                        "a" => {
                            let mut f64_bytes = Vec::new();
                            if let Some(obj) = arg.as_object() {
                                if let Ok(arr) = JsArray::from_object(obj) {
                                    let len = arr.length(context)? as usize;
                                    f64_bytes.reserve(len * 8);
                                    for i in 0..len {
                                        let v =
                                            arr.at(i as i64, context)?.as_number().unwrap_or(0.0);
                                        f64_bytes.extend_from_slice(&v.to_ne_bytes());
                                    }
                                }
                            }
                            owned_slices.push(f64_bytes);
                        }
                        "z" => {
                            let mut packed = Vec::new();
                            if let Some(obj) = arg.as_object() {
                                let arr = JsArray::from_object(obj).map_err(|e| {
                                    JsNativeError::typ().with_message(format!("{}", e))
                                })?;
                                let len = arr.length(context)? as u32;
                                packed.extend_from_slice(&len.to_le_bytes());
                                for i in 0..len {
                                    let item = arr.at(i as i64, context)?;
                                    let item_obj = item.as_object().ok_or_else(|| {
                                        JsNativeError::typ().with_message("entry must be object")
                                    })?;
                                    let name = item_obj
                                        .get(js_string!("filename"), context)
                                        .ok()
                                        .and_then(|v| {
                                            v.as_string().map(|s| s.to_std_string_escaped())
                                        })
                                        .unwrap_or_else(|| format!("file_{}", i));
                                    let data_val = item_obj
                                        .get(js_string!("data"), context)
                                        .unwrap_or(JsValue::undefined());
                                    let (data, _) = read_typed_bytes(&data_val, context);
                                    packed.extend_from_slice(&(name.len() as u32).to_le_bytes());
                                    packed.extend_from_slice(name.as_bytes());
                                    packed.extend_from_slice(&(data.len() as u32).to_le_bytes());
                                    packed.extend_from_slice(&data);
                                }
                            }
                            owned_slices.push(packed);
                        }
                        other => panic!("Unsupported input token {}", other),
                    }
                }

                let c_slices: Vec<ThreeLiveKernelSlice> = owned_slices
                    .iter()
                    .map(|v| ThreeLiveKernelSlice { data: v.as_ptr(), len: v.len() })
                    .collect();

                let guard = KernelBufGuard(invoke(
                    scalars.as_ptr(),
                    scalars.len(),
                    c_slices.as_ptr(),
                    c_slices.len(),
                ));

                if guard.0.status != THREE_LIVE_KERNEL_OK {
                    let msg = format!("Kernel status error {}", guard.0.status);
                    return if guard.0.status == THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED {
                        Err(JsNativeError::range().with_message(msg).into())
                    } else {
                        Err(JsNativeError::typ().with_message(msg).into())
                    };
                }

                let out_bytes: &[u8] = if guard.0.data.is_null() || guard.0.len == 0 {
                    &[]
                } else {
                    std::slice::from_raw_parts(guard.0.data, guard.0.len)
                };

                match ret_token.as_str() {
                    "geom" => {
                        let p_len =
                            u32::from_ne_bytes(out_bytes[0..4].try_into().unwrap()) as usize * 4;
                        let n_len =
                            u32::from_ne_bytes(out_bytes[4..8].try_into().unwrap()) as usize * 4;
                        let u_len =
                            u32::from_ne_bytes(out_bytes[8..12].try_into().unwrap()) as usize * 4;
                        let i_len =
                            u32::from_ne_bytes(out_bytes[12..16].try_into().unwrap()) as usize * 4;
                        let mut o = 16usize;
                        let pos = make_f32_array_bytes(&out_bytes[o..o + p_len], context)?;
                        o += p_len;
                        let norm = make_f32_array_bytes(&out_bytes[o..o + n_len], context)?;
                        o += n_len;
                        let uvs = make_f32_array_bytes(&out_bytes[o..o + u_len], context)?;
                        o += u_len;
                        let idx = make_u32_array_bytes(&out_bytes[o..o + i_len], context)?;
                        let obj = JsObject::with_object_proto(context.intrinsics());
                        obj.set(js_string!("positions"), pos, false, context)?;
                        obj.set(js_string!("normals"), norm, false, context)?;
                        obj.set(js_string!("uvs"), uvs, false, context)?;
                        obj.set(js_string!("indices"), idx, false, context)?;
                        Ok(JsValue::from(obj))
                    }
                    "f32" => Ok(JsValue::from(make_f32_array_bytes(out_bytes, context)?)),
                    "idx" => {
                        if out_bytes.len() < 4 {
                            return Ok(JsValue::from(make_u16_array_bytes(&[], context)?));
                        }
                        if out_bytes[0] != 0 {
                            Ok(JsValue::from(make_u32_array_bytes(&out_bytes[4..], context)?))
                        } else {
                            Ok(JsValue::from(make_u16_array_bytes(&out_bytes[4..], context)?))
                        }
                    }
                    "u8" => Ok(JsValue::from(make_u8_array(out_bytes, context)?)),
                    "u8?" => {
                        if guard.0.data.is_null() || out_bytes.is_empty() {
                            Ok(JsValue::null())
                        } else {
                            Ok(JsValue::from(make_u8_array(&out_bytes[1..], context)?))
                        }
                    }
                    "str" => {
                        let s = String::from_utf8_lossy(out_bytes).into_owned();
                        Ok(JsValue::from(js_string!(s)))
                    }
                    "u32" => {
                        let v = u32::from_ne_bytes(out_bytes[0..4].try_into().unwrap());
                        Ok(JsValue::new(v))
                    }
                    "maps3?" => {
                        if guard.0.data.is_null() || out_bytes.len() < 4 {
                            return Ok(JsValue::null());
                        }
                        let m = u32::from_ne_bytes(out_bytes[0..4].try_into().unwrap()) as usize;
                        let a = make_u8_array(&out_bytes[4..4 + m], context)?;
                        let n = make_u8_array(&out_bytes[4 + m..4 + 2 * m], context)?;
                        let orm = make_u8_array(&out_bytes[4 + 2 * m..4 + 3 * m], context)?;
                        Ok(JsArray::from_iter([a.into(), n.into(), orm.into()], context).into())
                    }
                    "maps2?" => {
                        if guard.0.data.is_null() || out_bytes.len() < 4 {
                            return Ok(JsValue::null());
                        }
                        let m = u32::from_ne_bytes(out_bytes[0..4].try_into().unwrap()) as usize;
                        let n = make_u8_array(&out_bytes[4..4 + m], context)?;
                        let orm = make_u8_array(&out_bytes[4 + m..4 + 2 * m], context)?;
                        Ok(JsArray::from_iter([n.into(), orm.into()], context).into())
                    }
                    "pnguri?" => {
                        if guard.0.data.is_null() || out_bytes.len() < 32 {
                            return Ok(JsValue::null());
                        }
                        let r = f64::from_ne_bytes(out_bytes[0..8].try_into().unwrap());
                        let g = f64::from_ne_bytes(out_bytes[8..16].try_into().unwrap());
                        let b = f64::from_ne_bytes(out_bytes[16..24].try_into().unwrap());
                        let a = f64::from_ne_bytes(out_bytes[24..32].try_into().unwrap());
                        let uri = String::from_utf8_lossy(&out_bytes[32..]).into_owned();
                        Ok(JsArray::from_iter(
                            [
                                JsValue::from(js_string!(uri)),
                                JsValue::new(r),
                                JsValue::new(g),
                                JsValue::new(b),
                                JsValue::new(a),
                            ],
                            context,
                        )
                        .into())
                    }
                    "pngrgba?" => {
                        if guard.0.data.is_null() || out_bytes.len() < 8 {
                            return Ok(JsValue::null());
                        }
                        let w = u32::from_ne_bytes(out_bytes[0..4].try_into().unwrap());
                        let h = u32::from_ne_bytes(out_bytes[4..8].try_into().unwrap());
                        let rgba = make_u8_array(&out_bytes[8..], context)?;
                        Ok(JsArray::from_iter(
                            [JsValue::new(w), JsValue::new(h), rgba.into()],
                            context,
                        )
                        .into())
                    }
                    other => panic!("Unsupported return token {}", other),
                }
            })
        };

        ctx.register_global_builtin_callable(JsString::from(js_name), arity, closure)
            .expect("register kernel");
    }
    count
}

fn eval_budgeted(ctx: &mut Context, code: &str, opcodes: u32) -> Result<JsValue, String> {
    let parsed = Script::parse(Source::from_bytes(code.as_bytes()), None, ctx)
        .map_err(|e| format!("{}", e))?;
    let mut fut = std::pin::pin!(parsed.evaluate_async_with_budget(ctx, opcodes));
    let waker = std::task::Waker::noop();
    let mut task_cx = std::task::Context::from_waker(waker);
    let mut yields = 0u32;
    loop {
        match std::future::Future::poll(fut.as_mut(), &mut task_cx) {
            std::task::Poll::Ready(Ok(v)) => return Ok(v),
            std::task::Poll::Ready(Err(e)) => return Err(format!("{}", e)),
            std::task::Poll::Pending => {
                yields += 1;
                if yields > 2000 {
                    return Err("Budgeted evaluation exceeded max yield count".to_string());
                }
            }
        }
    }
}

fn build_external_boa_host(bind_native_kernels: bool) -> Context {
    let req: serde_json::Value =
        serde_json::from_str(ENGINE_REQUIREMENTS_JSON).expect("engine-requirements.json");
    let max_buf = req["quotas"]["maxArrayBufferBytes"].as_u64().unwrap();
    let mut ctx = Context::builder()
        .host_hooks(Rc::new(EmbedderHostHooks { max_buffer_bytes: max_buf }))
        .module_loader(Rc::new(IdleModuleLoader))
        .build()
        .expect("build Boa context");

    let mut limits = RuntimeLimits::default();
    let loop_lim = req["runtimeLimits"]["loopIterationLimit"].as_u64().unwrap();
    limits.set_loop_iteration_limit(if bind_native_kernels { loop_lim } else { loop_lim * 20 });
    limits.set_recursion_limit(req["runtimeLimits"]["recursionLimit"].as_u64().unwrap() as usize);
    limits.set_stack_size_limit(req["runtimeLimits"]["stackSizeLimit"].as_u64().unwrap() as usize);
    ctx.set_runtime_limits(limits);

    if bind_native_kernels {
        let bound = bind_all_kernels_from_c_abi_table(&mut ctx);
        assert_eq!(bound, 24);
    }

    ctx.eval(Source::from_bytes(HOSTED_BUNDLE_JS.as_bytes()))
        .expect("evaluate standalone hosted compiler bundle");
    ctx
}

#[test]
fn external_boa_embedder_compiles_glb_usdz_and_ai_ops_without_compiler_engine() {
    let mut ctx = build_external_boa_host(true);

    // Install host contract + budgeted evalScript bridge + sandbox hardening.
    ctx.eval(Source::from_bytes(
        b"globalThis.__charged = 0;\
          globalThis.__three_live_host__ = {\
            version: 1,\
            now: () => 42.5,\
            log: () => {},\
            charge: (n) => { globalThis.__charged += n; }\
          };",
    ))
    .unwrap();

    // Verify sandbox hardening with `disableSyncCompile: false` for controlled `aiCall` tests,
    // then also test `disableSyncCompile: true` budgeted flow below.
    ctx.eval(Source::from_bytes(b"ThreeEngine.installSandboxHardening();")).unwrap();
    // Host contract is captured privately and hidden from untrusted user scripts.
    let host_hidden = ctx
        .eval(Source::from_bytes(b"typeof globalThis.__three_live_host__ === 'undefined'"))
        .unwrap()
        .to_boolean();
    assert!(host_hidden);

    // 1. Rich scene with Mechanical kit, CSG, ProceduralTexture, InstancedMesh, variants, TSL
    let script = r#"
        const gearGeo = new THREE.Mechanical.SpurGearGeometry({ teeth: 14, module: 0.04, thickness: 0.05 });
        const tex = THREE.ProceduralTexture.brushedMetal({ size: 32 });
        const matA = new THREE.MeshStandardMaterial({ ...tex, metalness: 0.9, roughness: 0.25 });
        const matB = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
        const gear = new THREE.Mesh(gearGeo, matA);
        gear.name = 'MainGear';
        gear.userData.variants = { Steel: matA, Brass: matB };
        gear.userData.xr = { grab: '1-hand', physics: 'dynamic' };
        scene.add(gear);

        const blockA = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), matB);
        const blockB = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), matB);
        const carved = THREE.CSG.subtract(blockA, blockB);
        carved.name = 'CarvedHousing';
        carved.position.set(0.8, 0.2, 0);
        scene.add(carved);

        const pins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), matA, 4);
        pins.name = 'Pins';
        for (let i = 0; i < 4; i++) {
            pins.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 0.1, 0, -0.4));
        }
        scene.add(pins);

        const tslMat = new THREE.MeshStandardNodeMaterial();
        tslMat.colorNode = THREE.TSL.mix(THREE.TSL.vec3(0.1, 0.5, 0.9), THREE.TSL.vec3(0.9, 0.3, 0.2), THREE.TSL.uv().x);
        const orb = new THREE.Mesh(new THREE.TorusKnotGeometry(0.15, 0.04, 24, 6), tslMat);
        orb.name = 'ShaderOrb';
        orb.position.set(-0.7, 0.3, 0);
        scene.add(orb);
    "#;

    // Budgeted host evaluation flow (`wrapIsolatedScript` + `evaluate_async_with_budget`)
    ctx.eval(Source::from_bytes(b"ThreeEngine.resetScene();")).unwrap();
    ctx.global_object()
        .set(js_string!("__host_input_script__"), js_string!(script), false, &mut ctx)
        .unwrap();
    let wrapped = ctx
        .eval(Source::from_bytes(b"ThreeEngine.wrapIsolatedScript(__host_input_script__);"))
        .unwrap()
        .as_string()
        .unwrap()
        .to_std_string_escaped();

    eval_budgeted(&mut ctx, &wrapped, 10_000).expect("budgeted user script execution");

    let glb_val = eval_budgeted(&mut ctx, "ThreeEngine.serializeCurrentSceneToGLB();", 10_000)
        .expect("serialize GLB");
    let (glb_bytes, _) = read_typed_bytes(&glb_val, &mut ctx);
    assert!(glb_bytes.len() > 1000);
    assert_eq!(&glb_bytes[0..4], b"glTF");
    let parsed_sg = three_live_compiler::read_glb(&glb_bytes).expect("valid GLB");
    assert_eq!(parsed_sg.meshes.len(), 4);
    assert!(parsed_sg.variants.is_some());

    let usdz_val = eval_budgeted(&mut ctx, "ThreeEngine.serializeCurrentSceneToUSDZ();", 10_000)
        .expect("serialize USDZ");
    let (usdz_bytes, _) = read_typed_bytes(&usdz_val, &mut ctx);
    assert_eq!(&usdz_bytes[0..4], b"PK\x03\x04");
    // Verify Apple 64-byte payload alignment on first entry
    let fn_len = u16::from_le_bytes([usdz_bytes[26], usdz_bytes[27]]) as usize;
    let extra_len = u16::from_le_bytes([usdz_bytes[28], usdz_bytes[29]]) as usize;
    assert_eq!((30 + fn_len + extra_len) % 64, 0);

    // 2. glbToUSDZ
    let glb_u8 = make_u8_array(&glb_bytes, &mut ctx).unwrap();
    ctx.global_object().set(js_string!("__host_glb__"), glb_u8, false, &mut ctx).unwrap();
    let converted_val =
        eval_budgeted(&mut ctx, "ThreeEngine.glbToUSDZ(__host_glb__);", 10_000).unwrap();
    let (converted_usdz, _) = read_typed_bytes(&converted_val, &mut ctx);
    assert_eq!(&converted_usdz[0..4], b"PK\x03\x04");

    // 3. aiCall protocol ops (validate, describe, select, voice_setup, texture_key)
    let ai_validate_req = serde_json::json!({
        "op": "validate",
        "code": script,
    })
    .to_string();
    ctx.global_object()
        .set(js_string!("__ai_req__"), js_string!(ai_validate_req), false, &mut ctx)
        .unwrap();
    let ai_resp_str = ctx
        .eval(Source::from_bytes(b"ThreeEngine.aiCall(__ai_req__);"))
        .unwrap()
        .as_string()
        .unwrap()
        .to_std_string_escaped();
    let ai_resp: serde_json::Value = serde_json::from_str(&ai_resp_str).unwrap();
    assert_eq!(ai_resp["ok"], serde_json::json!(true));
    assert_eq!(ai_resp["meshCount"], serde_json::json!(4));

    let ai_select_req = serde_json::json!({
        "op": "select",
        "source": script,
        "query": "the carved housing on the right"
    })
    .to_string();
    ctx.global_object()
        .set(js_string!("__ai_req__"), js_string!(ai_select_req), false, &mut ctx)
        .unwrap();
    let sel_str = ctx
        .eval(Source::from_bytes(b"ThreeEngine.aiCall(__ai_req__);"))
        .unwrap()
        .as_string()
        .unwrap()
        .to_std_string_escaped();
    let sel_resp: serde_json::Value = serde_json::from_str(&sel_str).unwrap();
    assert_eq!(sel_resp["names"], serde_json::json!(["CarvedHousing"]));

    // 4. Sandbox hardening blocks eval, Function, constructor chain, and sync compile when disabled
    assert!(eval_budgeted(&mut ctx, "eval('1 + 1')", 10_000).is_err());
    assert!(eval_budgeted(&mut ctx, "(function(){}).constructor('return 1')()", 10_000).is_err());
    ctx.eval(Source::from_bytes(
        b"ThreeEngine.installSandboxHardening({ disableSyncCompile: true });",
    ))
    .unwrap();
    assert!(eval_budgeted(&mut ctx, "ThreeEngine.compileToGLB('1+1')", 10_000).is_err());
}

#[test]
fn native_kernels_match_pure_js_fallbacks() {
    let mut ctx_native = build_external_boa_host(true);
    let mut ctx_fallback = build_external_boa_host(false);

    // Confirm fallback context has zero `__three_live_native_*__` hooks installed
    let has_native = ctx_fallback
        .eval(Source::from_bytes(b"typeof globalThis.__three_live_native_box__ === 'function'"))
        .unwrap()
        .to_boolean();
    assert!(!has_native);

    let probe = r#"
        (() => {
            const box = new THREE.BoxGeometry(1.5, 2.0, 0.5);
            const plane = new THREE.PlaneGeometry(2.0, 3.0, 4, 3);
            const sphere = new THREE.SphereGeometry(1.2, 12, 8);
            const cyl = new THREE.CylinderGeometry(0.4, 0.6, 1.5, 12);
            const torus = new THREE.TorusGeometry(1.0, 0.25, 8, 16);
            const knot = new THREE.TorusKnotGeometry(0.8, 0.2, 24, 6, 2, 3);

            const custom = new THREE.BufferGeometry();
            custom.setAttribute('position', new THREE.BufferAttribute([0,0,0, 1,0,0, 0,1,0, 0,0,1], 3));
            custom.setIndex([0, 1, 2, 0, 2, 3]);
            custom.computeVertexNormals();

            const fnv = (u8) => {
                let h = 0x811c9dc5;
                for (let i = 0; i < u8.length; i++) {
                    h ^= u8[i];
                    h = Math.imul(h, 0x01000193) >>> 0;
                }
                return h >>> 0;
            };
            const presetHashes = [];
            for (const name of ['checkerboard', 'grid', 'wood', 'marble', 'brushedMetal', 'carbonFiber', 'concrete', 'brick', 'fabric', 'leather', 'rust']) {
                const maps = THREE.ProceduralTexture[name]({ size: 16, seed: 7 });
                presetHashes.push([
                    fnv(maps.map.image._data),
                    fnv(maps.normalMap.image._data),
                    fnv(maps.roughnessMap.image._data),
                    maps.map.image.toDataURL(),
                ]);
            }

            const csgA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
            const csgB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.4), new THREE.MeshStandardMaterial());
            const csgOut = THREE.CSG.subtract(csgA, csgB);

            const utf8 = Array.from(new TextEncoder().encode('Hello Three-Live 🌍 Ω'));
            const decoded = new TextDecoder().decode(new Uint8Array(utf8));

            ThreeEngine.resetScene();
            const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial(THREE.ProceduralTexture.checkerboard({ size: 16 })));
            mesh.name = 'CheckerBox';
            scene.add(mesh);
            const usdz = scene.toUSDZ();

            return JSON.stringify({
                boxPos: Array.from(box.attributes.position.array),
                boxIdx: Array.from(box.index.array),
                planePos: Array.from(plane.attributes.position.array),
                planeIdx: Array.from(plane.index.array),
                spherePos: Array.from(sphere.attributes.position.array),
                sphereIdx: Array.from(sphere.index.array),
                cylPos: Array.from(cyl.attributes.position.array),
                cylIdx: Array.from(cyl.index.array),
                torusPos: Array.from(torus.attributes.position.array),
                torusIdx: Array.from(torus.index.array),
                knotPos: Array.from(knot.attributes.position.array),
                knotIdx: Array.from(knot.index.array),
                customNorm: Array.from(custom.attributes.normal.array),
                csgVertCount: csgOut.geometry.attributes.position.count,
                presetHashes,
                utf8,
                decoded,
                usdzMagic: [usdz[0], usdz[1], usdz[2], usdz[3]],
                usdzAligned: ((30 + (usdz[26] | (usdz[27] << 8)) + (usdz[28] | (usdz[29] << 8))) % 64) === 0
            });
        })()
    "#;

    let res_nat_val = ctx_native.eval(Source::from_bytes(probe.as_bytes())).unwrap_or_else(|e| {
        let msg = e
            .as_opaque()
            .and_then(|v| v.to_string(&mut ctx_native).ok())
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_else(|| format!("{:?}", e));
        panic!("ctx_native failed: {}", msg);
    });
    let res_nat_str = res_nat_val.as_string().unwrap().to_std_string_escaped();
    let res_fb_val = ctx_fallback.eval(Source::from_bytes(probe.as_bytes())).unwrap_or_else(|e| {
        let msg = e
            .as_opaque()
            .and_then(|v| v.to_string(&mut ctx_fallback).ok())
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_else(|| format!("{:?}", e));
        panic!("ctx_fallback failed: {}", msg);
    });
    let res_fb_str = res_fb_val.as_string().unwrap().to_std_string_escaped();

    let nat: serde_json::Value = serde_json::from_str(&res_nat_str).unwrap();
    let fb: serde_json::Value = serde_json::from_str(&res_fb_str).unwrap();

    // Exact byte/integer parity
    for exact_key in [
        "boxPos",
        "boxIdx",
        "planePos",
        "planeIdx",
        "sphereIdx",
        "cylIdx",
        "torusIdx",
        "knotIdx",
        "csgVertCount",
        "presetHashes",
        "utf8",
        "decoded",
        "usdzMagic",
        "usdzAligned",
    ] {
        assert_eq!(nat[exact_key], fb[exact_key], "exact parity mismatch on {}", exact_key);
    }

    // Float trig kernels (`f32` vs `f64` sin/cos rounded to f32) agree within 1e-4
    for float_key in ["spherePos", "cylPos", "torusPos", "customNorm"] {
        let a = nat[float_key].as_array().unwrap();
        let b = fb[float_key].as_array().unwrap();
        assert_eq!(a.len(), b.len(), "length mismatch on {}", float_key);
        for (idx, (va, vb)) in a.iter().zip(b.iter()).enumerate() {
            let da = va.as_f64().unwrap();
            let db = vb.as_f64().unwrap();
            assert!(
                (da - db).abs() < 1e-4,
                "{}[{}] diverged: native={} vs fallback={}",
                float_key,
                idx,
                da,
                db
            );
        }
    }

    // TorusKnot uses Frenet framing in Rust vs shared `buildSweptTube` framing in JS:
    // verify identical vertex buffer length and matching 3D bounding box.
    let kp_nat = nat["knotPos"].as_array().unwrap();
    let kp_fb = fb["knotPos"].as_array().unwrap();
    assert_eq!(kp_nat.len(), kp_fb.len());
    for axis in 0..3 {
        let max_nat = kp_nat
            .iter()
            .skip(axis)
            .step_by(3)
            .map(|v| v.as_f64().unwrap())
            .fold(f64::NEG_INFINITY, f64::max);
        let max_fb = kp_fb
            .iter()
            .skip(axis)
            .step_by(3)
            .map(|v| v.as_f64().unwrap())
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(
            (max_nat - max_fb).abs() < 0.05,
            "knot axis {} max mismatch: {} vs {}",
            axis,
            max_nat,
            max_fb
        );
    }
}
