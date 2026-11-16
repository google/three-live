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

//! JNI exports for Android integration:
//! - `NativeThreeCompilerBackend` (and legacy `ThreeCompiler` aliases) when Cargo feature `boa` is
//!   enabled (`libthree_live_compiler.so`).
//! - `ThreeLiveKernels` C-ABI table discovery even when `boa` is disabled
//!   (`libthree_live_kernels.so`).

use jni::objects::JClass;
use jni::sys::{jint, jlong};
use jni::JNIEnv;

/// Returns `THREE_LIVE_KERNELS_ABI_VERSION` (`1`) for `:mobile:android-kernels`.
#[allow(non_snake_case)]
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub extern "system" fn Java_com_google_threelive_ThreeLiveKernels_nativeAbiVersion<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jint {
    crate::kernels::three_live_kernels_abi_version() as jint
}

/// Returns the number of descriptors in `three_live_kernels_table(&count)`.
#[allow(non_snake_case)]
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "system" fn Java_com_google_threelive_ThreeLiveKernels_nativeKernelCount<
    'local,
>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jint {
    let mut count = 0usize;
    let _ = crate::kernels::three_live_kernels_table(&mut count);
    count as jint
}

/// Returns the native memory address of the static `ThreeLiveKernelDescriptor` table.
#[allow(non_snake_case)]
#[cfg_attr(not(feature = "boa"), no_mangle)]
pub unsafe extern "system" fn Java_com_google_threelive_ThreeLiveKernels_nativeTableAddress<
    'local,
>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> jlong {
    let mut count = 0usize;
    crate::kernels::three_live_kernels_table(&mut count) as usize as jlong
}

#[cfg(feature = "boa")]
mod boa_jni {
    use jni::objects::{JByteArray, JByteBuffer, JClass, JString};
    use jni::sys::{jbyteArray, jlong, jobject, jstring};
    use jni::JNIEnv;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    static ALLOCATED_BUFFERS: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();

    fn buffer_registry() -> &'static Mutex<HashMap<usize, usize>> {
        ALLOCATED_BUFFERS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn lock_buffer_registry() -> std::sync::MutexGuard<'static, HashMap<usize, usize>> {
        buffer_registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn register_direct_buffer(ptr: *mut u8, len: usize) {
        lock_buffer_registry().insert(ptr as usize, len);
    }

    fn unregister_direct_buffer(address: usize) -> Option<usize> {
        lock_buffer_registry().remove(&address)
    }

    fn throw_compiler_error(env: &mut JNIEnv<'_>, msg: &str) {
        if env.throw_new("com/google/threelive/ThreeCompilerException", msg).is_err() {
            let _ = env.throw_new("java/lang/RuntimeException", msg);
        }
    }

    fn read_checked_script(env: &mut JNIEnv<'_>, script: &JString<'_>) -> Option<String> {
        if script.is_null() {
            let _ = env.throw_new("java/lang/IllegalArgumentException", "Script must not be null");
            return None;
        }
        match env.get_string(script) {
            Ok(jstr) => {
                if jstr.to_bytes().len() > crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES {
                    throw_compiler_error(
                        env,
                        &format!(
                            "Script length ({} bytes) exceeds SECURITY_3D_MAX_SCRIPT_BYTES ({})",
                            jstr.to_bytes().len(),
                            crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES
                        ),
                    );
                    return None;
                }
                Some(jstr.into())
            }
            Err(e) => {
                let _ = env.throw_new(
                    "java/lang/IllegalArgumentException",
                    format!("Invalid UTF-8 script: {:?}", e),
                );
                None
            }
        }
    }

    fn compile_to_direct_buffer_impl<'local>(
        mut env: JNIEnv<'local>,
        script: JString<'local>,
    ) -> jobject {
        let outer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let Some(script_str) = read_checked_script(&mut env, &script) else {
                return std::ptr::null_mut();
            };

            match crate::transcode_three_to_glb(&script_str) {
                Ok(bytes) => {
                    if bytes.is_empty() {
                        throw_compiler_error(&mut env, "Compilation produced empty GLB output");
                        return std::ptr::null_mut();
                    }
                    let boxed = bytes.into_boxed_slice();
                    let len = boxed.len();
                    let ptr = Box::into_raw(boxed) as *mut u8;
                    register_direct_buffer(ptr, len);

                    match unsafe { env.new_direct_byte_buffer(ptr, len) } {
                        Ok(byte_buf) => byte_buf.into_raw(),
                        Err(e) => {
                            if let Some(alloc_len) = unregister_direct_buffer(ptr as usize) {
                                let _ = unsafe {
                                    Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                                        ptr, alloc_len,
                                    ))
                                };
                            }
                            let _ = env.throw_new(
                                "java/lang/OutOfMemoryError",
                                format!("Failed to create direct ByteBuffer: {:?}", e),
                            );
                            std::ptr::null_mut()
                        }
                    }
                }
                Err(err) => {
                    throw_compiler_error(&mut env, &err);
                    std::ptr::null_mut()
                }
            }
        }));

        match outer {
            Ok(ptr) => ptr,
            Err(_) => {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    throw_compiler_error(&mut env, "3D Transcoder encountered an internal panic");
                }));
                std::ptr::null_mut()
            }
        }
    }

    fn bytes_result_to_jbytearray(
        env: &mut JNIEnv<'_>,
        res: Result<Vec<u8>, String>,
        empty_msg: &str,
    ) -> jbyteArray {
        match res {
            Ok(bytes) => {
                if bytes.is_empty() {
                    throw_compiler_error(env, empty_msg);
                    return std::ptr::null_mut();
                }
                match env.byte_array_from_slice(&bytes) {
                    Ok(arr) => arr.into_raw(),
                    Err(e) => {
                        let _ = env.throw_new(
                            "java/lang/OutOfMemoryError",
                            format!("Failed to allocate jbyteArray: {:?}", e),
                        );
                        std::ptr::null_mut()
                    }
                }
            }
            Err(err) => {
                throw_compiler_error(env, &err);
                std::ptr::null_mut()
            }
        }
    }

    fn compile_to_byte_array_impl<'local>(
        mut env: JNIEnv<'local>,
        script: JString<'local>,
    ) -> jbyteArray {
        let outer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let Some(script_str) = read_checked_script(&mut env, &script) else {
                return std::ptr::null_mut();
            };
            let res = crate::transcode_three_to_glb(&script_str);
            bytes_result_to_jbytearray(&mut env, res, "Compilation produced empty GLB output")
        }));
        match outer {
            Ok(arr) => arr,
            Err(_) => {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    throw_compiler_error(&mut env, "3D Transcoder encountered an internal panic");
                }));
                std::ptr::null_mut()
            }
        }
    }

    fn compile_to_usdz_impl<'local>(
        mut env: JNIEnv<'local>,
        script: JString<'local>,
    ) -> jbyteArray {
        let outer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let Some(script_str) = read_checked_script(&mut env, &script) else {
                return std::ptr::null_mut();
            };
            let res = crate::transcode_three_to_usdz(&script_str);
            bytes_result_to_jbytearray(&mut env, res, "Compilation produced empty USDZ output")
        }));
        match outer {
            Ok(arr) => arr,
            Err(_) => {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    throw_compiler_error(&mut env, "3D Transcoder encountered an internal panic");
                }));
                std::ptr::null_mut()
            }
        }
    }

    fn glb_to_usdz_impl<'local>(
        mut env: JNIEnv<'local>,
        glb_bytes: JByteArray<'local>,
    ) -> jbyteArray {
        let outer = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if glb_bytes.is_null() {
                let _ = env
                    .throw_new("java/lang/IllegalArgumentException", "GLB bytes must not be null");
                return std::ptr::null_mut();
            }
            let len = match env.get_array_length(&glb_bytes) {
                Ok(n) if n >= 0 => n as usize,
                _ => {
                    throw_compiler_error(&mut env, "Failed to read GLB byte array length");
                    return std::ptr::null_mut();
                }
            };
            if len > crate::constants::SECURITY_3D_MAX_HEAP_BYTES {
                throw_compiler_error(
                    &mut env,
                    &format!(
                        "GLB input size ({} bytes) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
                        len,
                        crate::constants::SECURITY_3D_MAX_HEAP_BYTES
                    ),
                );
                return std::ptr::null_mut();
            }
            let raw = match env.convert_byte_array(&glb_bytes) {
                Ok(v) => v,
                Err(e) => {
                    throw_compiler_error(&mut env, &format!("Failed reading GLB array: {:?}", e));
                    return std::ptr::null_mut();
                }
            };
            let res = crate::transcode_glb_to_usdz(&raw);
            bytes_result_to_jbytearray(&mut env, res, "Conversion produced empty USDZ output")
        }));
        match outer {
            Ok(arr) => arr,
            Err(_) => {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    throw_compiler_error(&mut env, "3D Transcoder encountered an internal panic");
                }));
                std::ptr::null_mut()
            }
        }
    }

    fn ai_call_impl<'local>(mut env: JNIEnv<'local>, request: JString<'local>) -> jstring {
        let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if request.is_null() {
                return "{\"error\":\"null request\"}".to_string();
            }
            match env.get_string(&request) {
                Ok(jstr) => {
                    if jstr.to_bytes().len()
                        > crate::constants::SECURITY_3D_MAX_SCRIPT_BYTES * 2 + 65_536
                    {
                        return "{\"error\":\"request too large\"}".to_string();
                    }
                    let text: String = jstr.into();
                    crate::ai_edit::ai_call(&text)
                }
                Err(_) => "{\"error\":\"request is not valid UTF-8\"}".to_string(),
            }
        }))
        .unwrap_or_else(|_| "{\"error\":\"internal panic\"}".to_string());
        match env.new_string(response) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    }

    fn get_direct_buffer_address_impl<'local>(
        env: JNIEnv<'local>,
        buffer: JByteBuffer<'local>,
    ) -> jlong {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if buffer.is_null() {
                return 0;
            }
            match env.get_direct_buffer_address(&buffer) {
                Ok(ptr) => ptr as usize as jlong,
                Err(_) => 0,
            }
        }))
        .unwrap_or(0)
    }

    // --- NativeThreeCompilerBackend JNI entry points ---

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_NativeThreeCompilerBackend_nativeCompileToDirectBuffer<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        script: JString<'local>,
    ) -> jobject {
        compile_to_direct_buffer_impl(env, script)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_NativeThreeCompilerBackend_nativeCompileToByteArray<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        script: JString<'local>,
    ) -> jbyteArray {
        compile_to_byte_array_impl(env, script)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_NativeThreeCompilerBackend_nativeCompileToUsdz<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        script: JString<'local>,
    ) -> jbyteArray {
        compile_to_usdz_impl(env, script)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_NativeThreeCompilerBackend_nativeGlbToUsdz<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        glb_bytes: JByteArray<'local>,
    ) -> jbyteArray {
        glb_to_usdz_impl(env, glb_bytes)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_NativeThreeCompilerBackend_nativeAiCall<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        request: JString<'local>,
    ) -> jstring {
        ai_call_impl(env, request)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_NativeThreeCompilerBackend_nativeFreeDirectBuffer<
        'local,
    >(
        _env: JNIEnv<'local>,
        _class: JClass<'local>,
        address: jlong,
        capacity: jlong,
    ) {
        three_live_critical_free_buffer(address, capacity);
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_NativeThreeCompilerBackend_nativeGetDirectBufferAddress<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        buffer: JByteBuffer<'local>,
    ) -> jlong {
        get_direct_buffer_address_impl(env, buffer)
    }

    // --- Legacy ThreeCompiler JNI aliases retained for binary ABI compatibility ---

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_compileToDirectBuffer<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        script: JString<'local>,
    ) -> jobject {
        compile_to_direct_buffer_impl(env, script)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_compileToByteArray<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        script: JString<'local>,
    ) -> jbyteArray {
        compile_to_byte_array_impl(env, script)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_nativeAiCall<'local>(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        request: JString<'local>,
    ) -> jstring {
        ai_call_impl(env, request)
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_nativeFreeDirectBuffer<
        'local,
    >(
        _env: JNIEnv<'local>,
        _class: JClass<'local>,
        address: jlong,
        capacity: jlong,
    ) {
        three_live_critical_free_buffer(address, capacity);
    }

    #[no_mangle]
    pub unsafe extern "system" fn Java_com_google_threelive_ThreeCompiler_nativeGetDirectBufferAddress<
        'local,
    >(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
        buffer: JByteBuffer<'local>,
    ) -> jlong {
        get_direct_buffer_address_impl(env, buffer)
    }

    /// Fast native deallocation entry point for `nativeFreeDirectBuffer` and direct native C
    /// callers. Validates ownership against `ALLOCATED_BUFFERS`.
    ///
    /// # Safety
    /// `address` must be the non-null native address of a buffer allocated by
    /// `compileToDirectBuffer`.
    #[no_mangle]
    pub unsafe extern "C" fn three_live_critical_free_buffer(address: jlong, _capacity: jlong) {
        if address != 0 {
            let _ = std::panic::catch_unwind(|| {
                let Ok(addr) = usize::try_from(address as u64) else {
                    return;
                };
                if let Some(alloc_len) = unregister_direct_buffer(addr) {
                    let ptr = addr as *mut u8;
                    let _ = Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, alloc_len));
                }
            });
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_critical_free_buffer_safety() {
            let data = vec![1u8, 2, 3, 4, 5];
            let boxed = data.into_boxed_slice();
            let len = boxed.len();
            let ptr = Box::into_raw(boxed) as *mut u8;
            register_direct_buffer(ptr, len);

            unsafe {
                three_live_critical_free_buffer(ptr as jlong, len as jlong);
                three_live_critical_free_buffer(ptr as jlong, len as jlong);
                three_live_critical_free_buffer(0, 100);
                three_live_critical_free_buffer(ptr as jlong, 0);
                three_live_critical_free_buffer(-1, 100);
            }
        }
    }
}

#[cfg(feature = "boa")]
pub use boa_jni::*;
