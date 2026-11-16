/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef THREE_LIVE_KERNELS_H_  // NOLINT(build/header_guard)
#define THREE_LIVE_KERNELS_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * ABI version of the stateless, Boa-free `three_live_kernels` library.
 */
#define THREE_LIVE_KERNELS_ABI_VERSION 1u

/** Status codes returned in `ThreeLiveKernelBuffer::status`. */
#define THREE_LIVE_KERNEL_OK 0u
#define THREE_LIVE_KERNEL_ERR_INVALID_ARG 1u
#define THREE_LIVE_KERNEL_ERR_QUOTA_EXCEEDED 2u
#define THREE_LIVE_KERNEL_ERR_INTERNAL 3u

/**
 * Borrowed read-only byte slice passed into a kernel.
 */
typedef struct ThreeLiveKernelSlice {
  const uint8_t* data;
  size_t len;
} ThreeLiveKernelSlice;

/**
 * Heap-allocated byte buffer returned by a kernel.
 *
 * `data` is 1-byte aligned (`uint8_t*`) and `NULL` whenever `len == 0` or
 * `status != 0`. Callers reading multi-byte fields (`uint32_t`, `float`,
 * `double`) must copy via `memcpy` or unaligned loads rather than casting
 * `data` directly to typed pointers. When `data != NULL`, release it with
 * `three_live_kernel_free(data, capacity)`.
 */
typedef struct ThreeLiveKernelBuffer {
  uint8_t* data;
  size_t len;
  size_t capacity;
  uint32_t status;
} ThreeLiveKernelBuffer;

/**
 * Generic C-ABI dispatcher signature shared by all entries in
 * `three_live_kernels_table(&count)`.
 */
typedef ThreeLiveKernelBuffer (*ThreeLiveKernelInvokeFn)(
    const double* scalars, size_t scalar_count,
    const ThreeLiveKernelSlice* slices, size_t slice_count);

/**
 * Static descriptor for one native kernel so host JS embedders (Boa, QuickJS,
 * JavaScriptCore, V8) can bind all `__three_live_native_*__` accelerators
 * generically without hardcoding per-kernel FFI glue.
 *
 * `signature` grammar (`(<inputs>)->output`):
 *   Inputs:
 *     - `f`: scalar `double` pushed to `scalars`
 *     - `b`: binary TypedArray/ArrayBuffer view pushed to `slices`
 *     - `u32s`: optional index TypedArray normalized to `uint32_t` LE bytes in
 * `slices`
 *     - `i`: Uint16Array/Uint32Array bytes in `slices` + `1.0` (`u16`) or `0.0`
 * (`u32`) in `scalars`
 *     - `s`: UTF-8 string bytes in `slices`
 *     - `a`: JS numeric `Array` packed as native-endian `double`s in `slices`
 *     - `z`: USDZ entry list `[count:u32][name_len:u32, name_utf8,
 * data_len:u32, data]*` in `slices` Outputs (`ThreeLiveKernelBuffer` payload
 * when `status == THREE_LIVE_KERNEL_OK`):
 *     - `geom`: `[pos_f32_len:u32, norm_f32_len:u32, uv_f32_len:u32,
 * idx_u32_len:u32]` + `positions(f32)` + `normals(f32)` + `uvs(f32)` +
 * `indices(u32)`
 *     - `f32`: raw `float` (`f32`) array bytes
 *     - `idx`: `[is_u32:u8, 0, 0, 0]` + `uint16_t` or `uint32_t` array bytes
 *     - `u8`: raw `uint8_t` bytes
 *     - `u8?`: `data == NULL` -> `null`, else `[1u8]` + raw `uint8_t` bytes
 *     - `str`: UTF-8 string bytes
 *     - `u32`: 4-byte `uint32_t`
 *     - `maps3?`: `data == NULL` -> `null`, else `[map_bytes:u32]` + `albedo` +
 * `normal` + `orm`
 *     - `maps2?`: `data == NULL` -> `null`, else `[map_bytes:u32]` + `normal` +
 * `orm`
 *     - `pnguri?`: `data == NULL` -> `null`, else `[avg_rgba:f64x4]` +
 * `uri_utf8`
 *     - `pngrgba?`: `data == NULL` -> `null`, else `[width:u32, height:u32]` +
 * `rgba_bytes`
 */
typedef struct ThreeLiveKernelDescriptor {
  uint32_t kernel_id;
  const char* name;
  const char* js_global_name;
  const char* signature;
  const void* fn_ptr;
  ThreeLiveKernelInvokeFn invoke;
} ThreeLiveKernelDescriptor;

/** Returns `THREE_LIVE_KERNELS_ABI_VERSION` (`1`). */
uint32_t three_live_kernels_abi_version(void);

/**
 * Returns a pointer to the static `ThreeLiveKernelDescriptor` table and writes
 * the number of descriptors to `*out_count` (when `out_count != NULL`).
 */
const ThreeLiveKernelDescriptor* three_live_kernels_table(size_t* out_count);

/**
 * Frees a buffer previously allocated by any `three_live_kernel_*` function.
 * Safe to call with `data == NULL`; ownership-checked against internal
 * registry.
 */
void three_live_kernel_free(uint8_t* data, size_t capacity);

/* Typed C-ABI entry points */

ThreeLiveKernelBuffer three_live_kernel_box(float width, float height,
                                            float depth);
ThreeLiveKernelBuffer three_live_kernel_plane(float width, float height,
                                              uint32_t width_segments,
                                              uint32_t height_segments);
ThreeLiveKernelBuffer three_live_kernel_sphere(float radius,
                                               uint32_t width_segments,
                                               uint32_t height_segments);
ThreeLiveKernelBuffer three_live_kernel_cylinder(float radius_top,
                                                 float radius_bottom,
                                                 float height,
                                                 uint32_t radial_segments);
ThreeLiveKernelBuffer three_live_kernel_torus(float radius, float tube,
                                              uint32_t radial_segments,
                                              uint32_t tubular_segments,
                                              float arc);
ThreeLiveKernelBuffer three_live_kernel_torus_knot(float radius, float tube,
                                                   uint32_t tubular_segments,
                                                   uint32_t radial_segments,
                                                   float p, float q);
ThreeLiveKernelBuffer three_live_kernel_compute_vertex_normals(
    ThreeLiveKernelSlice positions_f32, ThreeLiveKernelSlice indices_u32);
ThreeLiveKernelBuffer three_live_kernel_csg_boolean(
    ThreeLiveKernelSlice pos_a, ThreeLiveKernelSlice norm_a,
    ThreeLiveKernelSlice uv_a, ThreeLiveKernelSlice idx_a,
    ThreeLiveKernelSlice mat_a, ThreeLiveKernelSlice pos_b,
    ThreeLiveKernelSlice norm_b, ThreeLiveKernelSlice uv_b,
    ThreeLiveKernelSlice idx_b, ThreeLiveKernelSlice mat_b, uint32_t op_code);
ThreeLiveKernelBuffer three_live_kernel_f32_array(
    ThreeLiveKernelSlice numbers_f64);
ThreeLiveKernelBuffer three_live_kernel_index_array(
    ThreeLiveKernelSlice numbers_f64);
ThreeLiveKernelBuffer three_live_kernel_material_preset(
    uint32_t kind, uint32_t size, int64_t scale, uint32_t seed, double r,
    double g, double b, double r2, double g2, double b2, double roughness,
    double normal_strength);
ThreeLiveKernelBuffer three_live_kernel_derive_texture_maps(
    ThreeLiveKernelSlice albedo_rgba, uint32_t size, double normal_strength,
    double roughness, double metalness);
ThreeLiveKernelBuffer three_live_kernel_seam_blend(ThreeLiveKernelSlice rgba,
                                                   uint32_t size);
uint32_t three_live_kernel_crc32(ThreeLiveKernelSlice bytes);
ThreeLiveKernelBuffer three_live_kernel_format_usda_points(
    ThreeLiveKernelSlice positions_f32);
ThreeLiveKernelBuffer three_live_kernel_format_usda_uvs(
    ThreeLiveKernelSlice uvs_f32);
ThreeLiveKernelBuffer three_live_kernel_format_usda_ints(
    ThreeLiveKernelSlice ints_bytes, uint32_t is_u16);
ThreeLiveKernelBuffer three_live_kernel_build_usdz_zip(
    ThreeLiveKernelSlice packed_entries);
ThreeLiveKernelBuffer three_live_kernel_encode_rgba_png(
    ThreeLiveKernelSlice rgba, uint32_t src_w, uint32_t src_h, uint32_t flip_y,
    uint32_t is_linear, uint32_t max_dim);
ThreeLiveKernelBuffer three_live_kernel_compress_png_uri(
    ThreeLiveKernelSlice uri_utf8);
ThreeLiveKernelBuffer three_live_kernel_decode_b64_image(
    ThreeLiveKernelSlice uri_utf8);
ThreeLiveKernelBuffer three_live_kernel_decode_png(
    ThreeLiveKernelSlice png_bytes);
ThreeLiveKernelBuffer three_live_kernel_utf8_encode(
    ThreeLiveKernelSlice utf8_bytes);
ThreeLiveKernelBuffer three_live_kernel_utf8_decode(
    ThreeLiveKernelSlice raw_bytes);

#ifdef __cplusplus
}
#endif

#endif  // THREE_LIVE_KERNELS_H_  // NOLINT(build/header_guard)
