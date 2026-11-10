/**
 * @license
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

/**
 * @fileoverview Entry point for `three-live-tsl.min.js` (`three-live/tsl`):
 * opt-in Loop-Free `THREE.TSL` & `MeshStandardNodeMaterial` add-on across
 * WebGL2, WebGPU `GPURenderBundle`, and USDZ `UsdShade` / MaterialX.
 */

import {registerPlugin} from './plugin';
import {tslPlugin} from './plugins/tsl';

registerPlugin(tslPlugin);

export {setMaterialUniform, tslPlugin} from './plugins/tsl';
export {installTslExtension, type TSLNodeLike} from './tsl/author';
export {compileTslToGlsl, fmtShaderFloat} from './tsl/glsl';
export {
  MAX_TSL_NODES,
  MAX_TSL_UNIFORMS,
  packUniformVec4,
  TSL_EXTRAS_KEY,
  TSL_TIME_PERIOD_SEC,
  tslSafeMod,
  tslTypeArity,
  tslTypeFromArity,
  validateTslGraph,
  type TslBuiltinName,
  type TslIrNode,
  type TslMaterialGraph,
  type TslOpName,
  type TslOutputs,
  type TslType,
  type TslUniformDef,
  type TslValidationIssue,
  type TslValidationResult,
  type ValidatedTslGraph,
  type ValidatedTslNode,
  type ValidatedTslUniformSlot,
} from './tsl/ir';
export {serializeTslToUsda, type CompiledTslUsda} from './tsl/usdz';
export {compileTslToWgsl, TSL_WGSL_UNIFORM_BYTES} from './tsl/wgsl';
