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
 * @fileoverview Loop-Free TSL (`extras.tsl`) -> Apple RealityKit /
 * Quick Look USDZ `UsdShade` + MaterialX (`ND_*`) `NodeGraph` Compiler.
 */

import {fmtShaderFloat} from './glsl';
import {
  TSL_TIME_PERIOD_SEC,
  tslTypeArity,
  validateTslGraph,
  type TslType,
  type ValidatedTslGraph,
} from './ir';

/** Result of compiling an `extras.tsl` graph to USDA `NodeGraph`. */
export interface CompiledTslUsda {
  readonly nodeGraphUsda: string;
  readonly surfaceConnections: Readonly<Record<string, string>>;
  readonly surfaceInputsUsda: string;
  readonly usesTime: boolean;
}

const USD_TYS: Readonly<Record<TslType, string>> = {
  float: 'float',
  vec2: 'float2',
  vec3: 'float3',
  vec4: 'float4',
};
const MTX_TYS: Readonly<Record<TslType, string>> = {
  float: 'float',
  vec2: 'vector2',
  vec3: 'vector3',
  vec4: 'vector4',
};
function usdType(ty: TslType): string {
  return USD_TYS[ty] || 'float';
}
function mtxSuffix(ty: TslType): string {
  return MTX_TYS[ty] || 'float';
}

function fmtUsdTuple(vals: readonly number[], arity: number): string {
  if (arity === 1) return fmtShaderFloat(vals[0] ?? 0);
  const parts: string[] = [];
  for (let i = 0; i < arity; i++) {
    parts.push(fmtShaderFloat(vals[i] ?? 0));
  }
  return `(${parts.join(', ')})`;
}

/**
 * Compiles a validated or raw `extras.tsl` graph into an Apple
 * RealityKit-compatible `def NodeGraph "TSLGraph"` block and `UsdPreviewSurface`
 * input connections.
 */
export function serializeTslToUsda(
  rawOrValidated: unknown,
  matSafeId: string,
  basePbrInputsUsda = '',
): CompiledTslUsda | null {
  let graph: ValidatedTslGraph;
  if (
    rawOrValidated &&
    typeof rawOrValidated === 'object' &&
    'fragmentReachable' in (rawOrValidated as Record<string, unknown>)
  ) {
    graph = rawOrValidated as ValidatedTslGraph;
  } else {
    const res = validateTslGraph(rawOrValidated, matSafeId);
    if (!res.ok) return null;
    graph = res.graph;
  }

  const hasFrag = graph.fragmentReachable.some((r) => r === 1);
  if (!hasFrag) return null;

  const cleanMatId =
    (matSafeId || 'Material')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^([0-9])/, '_$1') || 'Material';
  const ngPath = `/Root/Materials/${cleanMatId}/TSLGraph`;
  const shaders: string[] = [];
  const ngInputs: string[] = [];
  let auxCounter = 0;

  // Declare hygienic uniform inputs `u_0..u_15` on `TSLGraph` (zero user identifiers in USDA)
  for (const slot of graph.uniformSlots) {
    const uTy = usdType(slot.type);
    const ar = tslTypeArity(slot.type);
    ngInputs.push(
      `${uTy} inputs:u_${slot.slot} = ${fmtUsdTuple(slot.defaultVec4, ar)}`,
    );
  }

  const emitShader = (
    name: string,
    infoId: string,
    outType: string,
    lines: string[],
  ): string => {
    shaders.push(
      `def Shader "${name}"\n{\nuniform token info:id = "${infoId}"\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${outType} outputs:out\n}`,
    );
    return `${ngPath}/${name}.outputs:out`;
  };

  const emitConst = (ty: TslType, vals: readonly number[]): string => {
    const ar = tslTypeArity(ty);
    const id = `C_${auxCounter++}`;
    return emitShader(id, `ND_constant_${mtxSuffix(ty)}`, usdType(ty), [
      `${usdType(ty)} inputs:value = ${fmtUsdTuple(vals, ar)}`,
    ]);
  };

  const splatScalarToVec = (scalarRef: string, dstTy: TslType): string => {
    if (dstTy === 'float') return scalarRef;
    const ar = tslTypeArity(dstTy);
    const id = `B_${auxCounter++}`;
    const inLines: string[] = [];
    for (let k = 1; k <= ar; k++) {
      inLines.push(`float inputs:in${k}.connect = <${scalarRef}>`);
    }
    return emitShader(
      id,
      `ND_combine${ar}_${mtxSuffix(dstTy)}`,
      usdType(dstTy),
      inLines,
    );
  };

  const ensureType = (ref: string, srcTy: TslType, dstTy: TslType): string =>
    srcTy === dstTy ? ref : splatScalarToVec(ref, dstTy);

  const extractComp = (vecRef: string, srcTy: TslType, idx: number): string => {
    if (srcTy === 'float') return vecRef;
    const id = `E_${auxCounter++}`;
    return emitShader(id, `ND_extract_${mtxSuffix(srcTy)}`, 'float', [
      `${usdType(srcTy)} inputs:in.connect = <${vecRef}>`,
      `int inputs:index = ${idx}`,
    ]);
  };

  // Lazy shared built-in readers inside `TSLGraph`
  const builtinRefs = new Map<string, string>();
  const getBuiltinRef = (bName: string): string => {
    const existing = builtinRefs.get(bName);
    if (existing) return existing;
    let ref = '';
    switch (bName) {
      case 'positionLocal':
        ref = emitShader('BI_posLocal', 'ND_position_vector3', 'float3', [
          'string inputs:space = "object"',
        ]);
        break;
      case 'positionWorld':
        ref = emitShader('BI_posWorld', 'ND_position_vector3', 'float3', [
          'string inputs:space = "world"',
        ]);
        break;
      case 'normalLocal':
        ref = emitShader('BI_normLocal', 'ND_normal_vector3', 'float3', [
          'string inputs:space = "object"',
        ]);
        break;
      case 'normalWorld':
        ref = emitShader('BI_normWorld', 'ND_normal_vector3', 'float3', [
          'string inputs:space = "world"',
        ]);
        break;
      case 'viewDirection': {
        // MaterialX `ND_viewdirection_vector3` points eye->surface; negate for surface->eye `V`.
        const rawV = emitShader(
          'BI_rawView',
          'ND_viewdirection_vector3',
          'float3',
          ['string inputs:space = "world"'],
        );
        ref = emitShader('BI_viewDir', 'ND_multiply_vector3FA', 'float3', [
          `float3 inputs:in1.connect = <${rawV}>`,
          'float inputs:in2 = -1.0',
        ]);
        break;
      }
      case 'uv':
        ref = emitShader('BI_uv', 'ND_texcoord_vector2', 'float2', [
          'int inputs:index = 0',
        ]);
        break;
      case 'vertexColor': {
        const vc4 = emitShader('BI_vcCol', 'ND_geomcolor_color4', 'color4f', [
          'int inputs:index = 0',
        ]);
        ref = emitShader('BI_vcVec', 'ND_convert_color4_vector4', 'float4', [
          `color4f inputs:in.connect = <${vc4}>`,
        ]);
        break;
      }
      case 'instanceIndex':
        ref = emitConst('float', [0]);
        break;
      case 'time': {
        const rawT = emitShader('BI_rawTime', 'ND_time_float', 'float', []);
        ref = emitShader('BI_time', 'ND_modulo_float', 'float', [
          `float inputs:in1.connect = <${rawT}>`,
          `float inputs:in2 = ${fmtShaderFloat(TSL_TIME_PERIOD_SEC)}`,
        ]);
        break;
      }
      default:
        ref = emitConst('float', [0]);
        break;
    }
    builtinRefs.set(bName, ref);
    return ref;
  };

  const nodeRefs: string[] = new Array(graph.nodes.length).fill('');

  for (let i = 0; i < graph.nodes.length; i++) {
    if (!graph.fragmentReachable[i]) continue;
    const n = graph.nodes[i];
    const ty = n.type;
    const uTy = usdType(ty);
    const mSuf = mtxSuffix(ty);
    const ar = tslTypeArity(ty);
    const r0 = n.args[0] !== undefined ? nodeRefs[n.args[0]] : '';
    const r1 = n.args[1] !== undefined ? nodeRefs[n.args[1]] : '';
    const r2 = n.args[2] !== undefined ? nodeRefs[n.args[2]] : '';
    const t0 = n.args[0] !== undefined ? graph.nodes[n.args[0]].type : 'float';
    const t1 = n.args[1] !== undefined ? graph.nodes[n.args[1]].type : 'float';
    const t2 = n.args[2] !== undefined ? graph.nodes[n.args[2]].type : 'float';
    const nid = `N${i}`;

    switch (n.op) {
      case 'const':
        nodeRefs[i] = emitShader(nid, `ND_constant_${mSuf}`, uTy, [
          `${uTy} inputs:value = ${fmtUsdTuple(n.value ?? [0], ar)}`,
        ]);
        break;
      case 'builtin':
        nodeRefs[i] = getBuiltinRef(n.builtin ?? 'time');
        break;
      case 'uniform':
        nodeRefs[i] = `${ngPath}.inputs:u_${n.uniformSlot ?? 0}`;
        break;
      case 'swizzle': {
        const mask = n.mask ?? 'x';
        if (t0 === 'float') {
          nodeRefs[i] = splatScalarToVec(r0, ty);
        } else if (mask.length === 1) {
          nodeRefs[i] = extractComp(r0, t0, 'xyzw'.indexOf(mask[0]));
        } else {
          const comps = Array.from(mask).map((ch) =>
            extractComp(r0, t0, 'xyzw'.indexOf(ch)),
          );
          nodeRefs[i] = emitShader(
            nid,
            `ND_combine${mask.length}_${mSuf}`,
            uTy,
            comps.map((c, idx) => `float inputs:in${idx + 1}.connect = <${c}>`),
          );
        }
        break;
      }
      case 'construct': {
        if (ty === 'float') {
          nodeRefs[i] = r0;
        } else if (n.args.length === 1 && t0 === 'float') {
          nodeRefs[i] = splatScalarToVec(r0, ty);
        } else {
          const scalars: string[] = [];
          for (const ai of n.args) {
            const aTy = graph.nodes[ai].type;
            const aRef = nodeRefs[ai];
            const aAr = tslTypeArity(aTy);
            if (aAr === 1) {
              scalars.push(aRef);
            } else {
              for (let c = 0; c < aAr; c++) {
                scalars.push(extractComp(aRef, aTy, c));
              }
            }
          }
          nodeRefs[i] = emitShader(
            nid,
            `ND_combine${ar}_${mSuf}`,
            uTy,
            scalars
              .slice(0, ar)
              .map((c, idx) => `float inputs:in${idx + 1}.connect = <${c}>`),
          );
        }
        break;
      }
      case 'neg': {
        nodeRefs[i] = emitShader(nid, `ND_multiply_${mSuf}`, uTy, [
          `${uTy} inputs:in1.connect = <${r0}>`,
          `${uTy} inputs:in2 = ${fmtUsdTuple([-1, -1, -1, -1], ar)}`,
        ]);
        break;
      }
      case 'abs':
      case 'sign':
      case 'floor':
      case 'ceil':
      case 'sqrt':
      case 'exp':
      case 'sin':
      case 'cos':
      case 'normalize': {
        const mtxOp = n.op === 'abs' ? 'absval' : n.op;
        if (n.op === 'normalize' && ty === 'float') {
          nodeRefs[i] = emitShader(nid, 'ND_sign_float', 'float', [
            `float inputs:in.connect = <${r0}>`,
          ]);
        } else {
          nodeRefs[i] = emitShader(nid, `ND_${mtxOp}_${mSuf}`, uTy, [
            `${uTy} inputs:in.connect = <${r0}>`,
          ]);
        }
        break;
      }
      case 'log':
        nodeRefs[i] = emitShader(nid, `ND_ln_${mSuf}`, uTy, [
          `${uTy} inputs:in.connect = <${r0}>`,
        ]);
        break;
      case 'fract': {
        nodeRefs[i] = emitShader(nid, `ND_modulo_${mSuf}`, uTy, [
          `${uTy} inputs:in1.connect = <${r0}>`,
          `${uTy} inputs:in2 = ${fmtUsdTuple([1, 1, 1, 1], ar)}`,
        ]);
        break;
      }
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
      case 'mod':
      case 'pow':
      case 'atan2':
      case 'min':
      case 'max': {
        const opMap: Record<string, string> = {
          add: 'add',
          sub: 'subtract',
          mul: 'multiply',
          div: 'divide',
          mod: 'modulo',
          pow: 'power',
          atan2: 'atan2',
          min: 'min',
          max: 'max',
        };
        const b0 = ensureType(r0, t0, ty);
        const b1 = ensureType(r1, t1, ty);
        nodeRefs[i] = emitShader(nid, `ND_${opMap[n.op]}_${mSuf}`, uTy, [
          `${uTy} inputs:in1.connect = <${b0}>`,
          `${uTy} inputs:in2.connect = <${b1}>`,
        ]);
        break;
      }
      case 'step': {
        const bEdge = ensureType(r0, t0, ty);
        if (ty === 'float') {
          nodeRefs[i] = emitShader(nid, 'ND_ifgreater_float', 'float', [
            `float inputs:value1.connect = <${r1}>`,
            `float inputs:value2.connect = <${bEdge}>`,
            'float inputs:in1 = 1.0',
            'float inputs:in2 = 0.0',
          ]);
        } else {
          const comps: string[] = [];
          for (let c = 0; c < ar; c++) {
            const ce = extractComp(bEdge, ty, c);
            const cx = extractComp(r1, ty, c);
            comps.push(
              emitShader(`S_${auxCounter++}`, 'ND_ifgreater_float', 'float', [
                `float inputs:value1.connect = <${cx}>`,
                `float inputs:value2.connect = <${ce}>`,
                'float inputs:in1 = 1.0',
                'float inputs:in2 = 0.0',
              ]),
            );
          }
          nodeRefs[i] = emitShader(
            nid,
            `ND_combine${ar}_${mSuf}`,
            uTy,
            comps.map((c, idx) => `float inputs:in${idx + 1}.connect = <${c}>`),
          );
        }
        break;
      }
      case 'clamp': {
        const bLow = ensureType(r1, t1, ty);
        const bHigh = ensureType(r2, t2, ty);
        nodeRefs[i] = emitShader(nid, `ND_clamp_${mSuf}`, uTy, [
          `${uTy} inputs:in.connect = <${r0}>`,
          `${uTy} inputs:low.connect = <${bLow}>`,
          `${uTy} inputs:high.connect = <${bHigh}>`,
        ]);
        break;
      }
      case 'mix': {
        const bMix = ensureType(r2, t2, ty);
        // Note: MaterialX `ND_mix` computes `fg * mix + bg * (1 - mix)`, so `bg = a0`, `fg = a1`!
        nodeRefs[i] = emitShader(nid, `ND_mix_${mSuf}`, uTy, [
          `${uTy} inputs:bg.connect = <${r0}>`,
          `${uTy} inputs:fg.connect = <${r1}>`,
          `${uTy} inputs:mix.connect = <${bMix}>`,
        ]);
        break;
      }
      case 'smoothstep': {
        const bLow = ensureType(r0, t0, ty);
        const bHigh = ensureType(r1, t1, ty);
        nodeRefs[i] = emitShader(nid, `ND_smoothstep_${mSuf}`, uTy, [
          `${uTy} inputs:in.connect = <${r2}>`,
          `${uTy} inputs:low.connect = <${bLow}>`,
          `${uTy} inputs:high.connect = <${bHigh}>`,
        ]);
        break;
      }
      case 'dot':
        if (t0 === 'float') {
          nodeRefs[i] = emitShader(nid, 'ND_multiply_float', 'float', [
            `float inputs:in1.connect = <${r0}>`,
            `float inputs:in2.connect = <${r1}>`,
          ]);
        } else {
          nodeRefs[i] = emitShader(
            nid,
            `ND_dotproduct_${mtxSuffix(t0)}`,
            'float',
            [
              `${usdType(t0)} inputs:in1.connect = <${r0}>`,
              `${usdType(t0)} inputs:in2.connect = <${r1}>`,
            ],
          );
        }
        break;
      case 'length':
        if (t0 === 'float') {
          nodeRefs[i] = emitShader(nid, 'ND_absval_float', 'float', [
            `float inputs:in.connect = <${r0}>`,
          ]);
        } else {
          nodeRefs[i] = emitShader(
            nid,
            `ND_magnitude_${mtxSuffix(t0)}`,
            'float',
            [`${usdType(t0)} inputs:in.connect = <${r0}>`],
          );
        }
        break;
      case 'distance': {
        const diff = emitShader(
          `D_${auxCounter++}`,
          `ND_subtract_${mtxSuffix(t0)}`,
          usdType(t0),
          [
            `${usdType(t0)} inputs:in1.connect = <${r0}>`,
            `${usdType(t0)} inputs:in2.connect = <${r1}>`,
          ],
        );
        nodeRefs[i] =
          t0 === 'float'
            ? emitShader(nid, 'ND_absval_float', 'float', [
                `float inputs:in.connect = <${diff}>`,
              ])
            : emitShader(nid, `ND_magnitude_${mtxSuffix(t0)}`, 'float', [
                `${usdType(t0)} inputs:in.connect = <${diff}>`,
              ]);
        break;
      }
      case 'cross':
        nodeRefs[i] = emitShader(nid, 'ND_crossproduct_vector3', 'float3', [
          `float3 inputs:in1.connect = <${r0}>`,
          `float3 inputs:in2.connect = <${r1}>`,
        ]);
        break;
      case 'reflect':
        if (ty === 'vec3') {
          nodeRefs[i] = emitShader(nid, 'ND_reflect_vector3', 'float3', [
            `float3 inputs:in.connect = <${r0}>`,
            `float3 inputs:normal.connect = <${r1}>`,
          ]);
        } else {
          // `I - 2 * dot(N, I) * N`
          const dp =
            ty === 'float'
              ? emitShader(`RF_${auxCounter++}`, 'ND_multiply_float', 'float', [
                  `float inputs:in1.connect = <${r1}>`,
                  `float inputs:in2.connect = <${r0}>`,
                ])
              : emitShader(
                  `RF_${auxCounter++}`,
                  `ND_dotproduct_${mSuf}`,
                  'float',
                  [
                    `${uTy} inputs:in1.connect = <${r1}>`,
                    `${uTy} inputs:in2.connect = <${r0}>`,
                  ],
                );
          const twoDp = emitShader(
            `RF_${auxCounter++}`,
            'ND_multiply_float',
            'float',
            [`float inputs:in1.connect = <${dp}>`, 'float inputs:in2 = 2.0'],
          );
          const scaledN = emitShader(
            `RF_${auxCounter++}`,
            `ND_multiply_${mSuf}`,
            uTy,
            [
              `${uTy} inputs:in1.connect = <${r1}>`,
              `${uTy} inputs:in2.connect = <${ensureType(twoDp, 'float', ty)}>`,
            ],
          );
          nodeRefs[i] = emitShader(nid, `ND_subtract_${mSuf}`, uTy, [
            `${uTy} inputs:in1.connect = <${r0}>`,
            `${uTy} inputs:in2.connect = <${scaledN}>`,
          ]);
        }
        break;
      case 'fresnel': {
        const nw = getBuiltinRef('normalWorld');
        const vd = getBuiltinRef('viewDirection');
        const ndv = emitShader(
          `FR_${auxCounter++}`,
          'ND_dotproduct_vector3',
          'float',
          [
            `float3 inputs:in1.connect = <${nw}>`,
            `float3 inputs:in2.connect = <${vd}>`,
          ],
        );
        const clamped = emitShader(
          `FR_${auxCounter++}`,
          'ND_clamp_float',
          'float',
          [
            `float inputs:in.connect = <${ndv}>`,
            'float inputs:low = 0.0',
            'float inputs:high = 1.0',
          ],
        );
        const base = emitShader(
          `FR_${auxCounter++}`,
          'ND_subtract_float',
          'float',
          ['float inputs:in1 = 1.0', `float inputs:in2.connect = <${clamped}>`],
        );
        nodeRefs[i] = emitShader(nid, 'ND_power_float', 'float', [
          `float inputs:in1.connect = <${base}>`,
          `float inputs:in2.connect = <${r0}>`,
        ]);
        break;
      }
      case 'simplexNoise2D':
        nodeRefs[i] = emitShader(nid, 'ND_noise2d_float', 'float', [
          `float2 inputs:texcoord.connect = <${r0}>`,
          'float inputs:amplitude = 0.5',
          'float inputs:pivot = 0.5',
        ]);
        break;
      case 'simplexNoise3D':
        nodeRefs[i] = emitShader(nid, 'ND_noise3d_float', 'float', [
          `float3 inputs:position.connect = <${r0}>`,
          'float inputs:amplitude = 0.5',
          'float inputs:pivot = 0.5',
        ]);
        break;
      case 'voronoi2D':
        nodeRefs[i] = emitShader(nid, 'ND_cellnoise2d_float', 'float', [
          `float2 inputs:texcoord.connect = <${r0}>`,
        ]);
        break;
      case 'checker': {
        const fl = emitShader(
          `CK_${auxCounter++}`,
          'ND_floor_vector2',
          'float2',
          [`float2 inputs:in.connect = <${r0}>`],
        );
        const fx = extractComp(fl, 'vec2', 0);
        const fy = extractComp(fl, 'vec2', 1);
        const sm = emitShader(`CK_${auxCounter++}`, 'ND_add_float', 'float', [
          `float inputs:in1.connect = <${fx}>`,
          `float inputs:in2.connect = <${fy}>`,
        ]);
        const md = emitShader(
          `CK_${auxCounter++}`,
          'ND_modulo_float',
          'float',
          [`float inputs:in1.connect = <${sm}>`, 'float inputs:in2 = 2.0'],
        );
        nodeRefs[i] = emitShader(nid, 'ND_ifgreater_float', 'float', [
          `float inputs:value1.connect = <${md}>`,
          'float inputs:value2 = 0.999',
          'float inputs:in1 = 1.0',
          'float inputs:in2 = 0.0',
        ]);
        break;
      }
      case 'triplanar':
        nodeRefs[i] = emitShader(nid, 'ND_noise3d_float', 'float', [
          `float3 inputs:position.connect = <${r0}>`,
          'float inputs:amplitude = 0.5',
          'float inputs:pivot = 0.5',
        ]);
        break;
      case 'hueShift': {
        const c3 = emitShader(
          `HS_${auxCounter++}`,
          'ND_convert_vector3_color3',
          'color3f',
          [`float3 inputs:in.connect = <${r0}>`],
        );
        // Convert radians -> normalized hue turn `angle / (2 * PI)`
        const hueTurn = emitShader(
          `HS_${auxCounter++}`,
          'ND_multiply_float',
          'float',
          [
            `float inputs:in1.connect = <${r1}>`,
            'float inputs:in2 = 0.15915494',
          ],
        );
        const amtVec = emitShader(
          `HS_${auxCounter++}`,
          'ND_combine3_vector3',
          'float3',
          [
            `float inputs:in1.connect = <${hueTurn}>`,
            'float inputs:in2 = 1.0',
            'float inputs:in3 = 1.0',
          ],
        );
        const adj = emitShader(
          `HS_${auxCounter++}`,
          'ND_hsvadjust_color3',
          'color3f',
          [
            `color3f inputs:in.connect = <${c3}>`,
            `float3 inputs:amount.connect = <${amtVec}>`,
          ],
        );
        nodeRefs[i] = emitShader(nid, 'ND_convert_color3_vector3', 'float3', [
          `color3f inputs:in.connect = <${adj}>`,
        ]);
        break;
      }
      case 'bumpFromHeight': {
        nodeRefs[i] = emitShader(nid, 'ND_heighttonormal_vector3', 'float3', [
          `float inputs:in.connect = <${r0}>`,
          `float inputs:scale.connect = <${r1}>`,
        ]);
        break;
      }
      default:
        nodeRefs[i] = emitConst(ty, [0, 0, 0, 0]);
        break;
    }
  }

  const ngOutputs: string[] = [];
  const surfaceConnections: Record<string, string> = {};

  if (graph.outputs.color !== undefined) {
    const colShader = emitShader(
      'OUT_color',
      'ND_convert_vector3_color3',
      'color3f',
      [`float3 inputs:in.connect = <${nodeRefs[graph.outputs.color]}>`],
    );
    ngOutputs.push(`color3f outputs:diffuseColor.connect = <${colShader}>`);
    surfaceConnections['diffuseColor'] = `${ngPath}.outputs:diffuseColor`;
  }
  if (graph.outputs.emissive !== undefined) {
    const emShader = emitShader(
      'OUT_emissive',
      'ND_convert_vector3_color3',
      'color3f',
      [`float3 inputs:in.connect = <${nodeRefs[graph.outputs.emissive]}>`],
    );
    ngOutputs.push(`color3f outputs:emissiveColor.connect = <${emShader}>`);
    surfaceConnections['emissiveColor'] = `${ngPath}.outputs:emissiveColor`;
  }
  if (graph.outputs.opacity !== undefined) {
    ngOutputs.push(
      `float outputs:opacity.connect = <${nodeRefs[graph.outputs.opacity]}>`,
    );
    surfaceConnections['opacity'] = `${ngPath}.outputs:opacity`;
  }
  if (graph.outputs.roughness !== undefined) {
    ngOutputs.push(
      `float outputs:roughness.connect = <${nodeRefs[graph.outputs.roughness]}>`,
    );
    surfaceConnections['roughness'] = `${ngPath}.outputs:roughness`;
  }
  if (graph.outputs.metalness !== undefined) {
    ngOutputs.push(
      `float outputs:metallic.connect = <${nodeRefs[graph.outputs.metalness]}>`,
    );
    surfaceConnections['metallic'] = `${ngPath}.outputs:metallic`;
  }
  if (graph.outputs.bump !== undefined) {
    ngOutputs.push(
      `normal3f outputs:normal.connect = <${nodeRefs[graph.outputs.bump]}>`,
    );
    surfaceConnections['normal'] = `${ngPath}.outputs:normal`;
  }

  if (ngOutputs.length === 0) return null;

  const pbrSpecs: ReadonlyArray<[string, string]> = [
    ['diffuseColor', 'color3f'],
    ['metallic', 'float'],
    ['roughness', 'float'],
    ['opacity', 'float'],
    ['emissiveColor', 'color3f'],
    ['normal', 'normal3f'],
  ];
  let surfaceInputsUsda = basePbrInputsUsda;
  for (const [k, uType] of pbrSpecs) {
    const target = surfaceConnections[k];
    if (!target) continue;
    const newLine = `${uType} inputs:${k}.connect = <${target}>`;
    const re = new RegExp(`^${uType}\\s+inputs:${k}[^\n]*$`, 'm');
    if (re.test(surfaceInputsUsda)) {
      surfaceInputsUsda = surfaceInputsUsda.replace(re, newLine);
    } else {
      surfaceInputsUsda += `${surfaceInputsUsda.endsWith('\n') || !surfaceInputsUsda ? '' : '\n'}${newLine}\n`;
    }
  }

  const bodyParts = [...ngInputs, ...ngOutputs, ...shaders];
  const nodeGraphUsda = `def NodeGraph "TSLGraph"\n{\n${bodyParts.join('\n')}\n}\n`;
  return {
    nodeGraphUsda,
    surfaceConnections,
    surfaceInputsUsda,
    usesTime: graph.usesTime,
  };
}
