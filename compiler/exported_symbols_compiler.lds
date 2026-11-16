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
{
  global:
    three_live_compile;
    three_live_compile_usdz;
    three_live_glb_to_usdz;
    three_live_free_buffer;
    three_live_free_error;
    three_live_ai_call;
    three_live_free_string;
    three_live_critical_free_buffer;
    Java_com_google_threelive_NativeThreeCompilerBackend_*;
    Java_com_google_threelive_ThreeCompiler_*;
  local:
    *;
};
