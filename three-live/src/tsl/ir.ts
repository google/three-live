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
 * @fileoverview Canonical Loop-Free TSL (`extras.tsl`) IR Schema and
 * Single-Pass `O(N)` Topological DAG Validator (`TL501–TL504`).
 */

/** glTF material `extras` key for loop-free TSL node graphs (`materials[i].extras.tsl`). */
export const TSL_EXTRAS_KEY = 'tsl';

/** Hard per-material SSA node quota preventing GPU ALU amplification / TDR. */
export const MAX_TSL_NODES = 128;

/** Hard per-material user uniform quota mapped to `vec4 uTslParams[16]`. */
export const MAX_TSL_UNIFORMS = 16;

/** Time wrap period in seconds preserving fp32 phase precision over long runs. */
export const TSL_TIME_PERIOD_SEC = 3600;

/** Scalar and vector value types supported in `extras.tsl`. */
export type TslType = 'float' | 'vec2' | 'vec3' | 'vec4';

/** Built-in shader stage inputs available to `extras.tsl` graphs. */
export type TslBuiltinName =
  | 'positionLocal'
  | 'positionWorld'
  | 'normalLocal'
  | 'normalWorld'
  | 'viewDirection'
  | 'uv'
  | 'vertexColor'
  | 'instanceIndex'
  | 'time';

/** Complete bounded op vocabulary of `extras.tsl` v1. */
export type TslOpName =
  | 'const'
  | 'builtin'
  | 'uniform'
  | 'swizzle'
  | 'construct'
  | 'neg'
  | 'abs'
  | 'sign'
  | 'floor'
  | 'ceil'
  | 'fract'
  | 'sqrt'
  | 'exp'
  | 'log'
  | 'sin'
  | 'cos'
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'mod'
  | 'pow'
  | 'atan2'
  | 'min'
  | 'max'
  | 'step'
  | 'clamp'
  | 'mix'
  | 'smoothstep'
  | 'dot'
  | 'cross'
  | 'length'
  | 'distance'
  | 'normalize'
  | 'reflect'
  | 'fresnel'
  | 'simplexNoise2D'
  | 'simplexNoise3D'
  | 'voronoi2D'
  | 'checker'
  | 'triplanar'
  | 'hueShift'
  | 'bumpFromHeight';

/** Serialized uniform entry in `extras.tsl.uniforms`. */
export interface TslUniformDef {
  readonly type: TslType;
  readonly value: number | readonly number[];
}

/** Single SSA node in `extras.tsl.nodes`. */
export interface TslIrNode {
  readonly op: TslOpName;
  readonly type: TslType;
  readonly args?: readonly number[];
  readonly value?: readonly number[];
  readonly name?: string;
  readonly mask?: string;
}

/** Output socket map in `extras.tsl.outputs`. */
export interface TslOutputs {
  readonly color?: number;
  readonly opacity?: number;
  readonly emissive?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly normalScale?: number;
  readonly bump?: number;
  readonly position?: number;
}

/** Canonical serialized `extras.tsl` v1 material node-graph payload. */
export interface TslMaterialGraph {
  readonly version: 1;
  readonly uniforms?: Record<string, TslUniformDef>;
  readonly nodes: readonly TslIrNode[];
  readonly outputs: TslOutputs;
}

/** Indexed uniform slot bound to `uTslParams[slot]`. */
export interface ValidatedTslUniformSlot {
  readonly name: string;
  readonly slot: number;
  readonly type: TslType;
  readonly defaultVec4: readonly [number, number, number, number];
}

/** Normalized SSA node ready for GLSL, WGSL, MaterialX, Filament, or CPU codegen. */
export interface ValidatedTslNode {
  readonly op: TslOpName;
  readonly type: TslType;
  readonly args: readonly number[];
  readonly value?: readonly number[];
  readonly builtin?: TslBuiltinName;
  readonly uniformSlot?: number;
  readonly mask?: string;
}

/** Structured diagnostic produced when validating an `extras.tsl` graph. */
export interface TslValidationIssue {
  readonly code: 'TL501' | 'TL502' | 'TL503' | 'TL504';
  readonly message: string;
  readonly hint: string;
}

/** Validated, immutable `extras.tsl` graph with precomputed metadata. */
export interface ValidatedTslGraph {
  readonly nodes: readonly ValidatedTslNode[];
  readonly outputs: TslOutputs;
  readonly uniformSlots: readonly ValidatedTslUniformSlot[];
  readonly uniformSlotByName: ReadonlyMap<string, ValidatedTslUniformSlot>;
  /** Structural 32-bit FNV-1a hash (independent of runtime uniform values). */
  readonly hash: string;
  readonly usesTime: boolean;
  readonly usesVertexPosition: boolean;
  readonly usesDerivatives: boolean;
  readonly fragmentReachable: Uint8Array;
  readonly vertexReachable: Uint8Array;
}

/** Result of `validateTslGraph`: either a validated DAG or a diagnostic issue. */
export type TslValidationResult =
  | {readonly ok: true; readonly graph: ValidatedTslGraph}
  | {readonly ok: false; readonly issue: TslValidationIssue};

const BUILTIN_TYPES: Readonly<Record<string, TslType>> = {
  positionLocal: 'vec3',
  positionWorld: 'vec3',
  normalLocal: 'vec3',
  normalWorld: 'vec3',
  viewDirection: 'vec3',
  uv: 'vec2',
  vertexColor: 'vec4',
  instanceIndex: 'float',
  time: 'float',
};

const OUTPUT_SOCKET_TYPES: Readonly<Record<string, TslType>> = {
  color: 'vec3',
  opacity: 'float',
  emissive: 'vec3',
  roughness: 'float',
  metalness: 'float',
  normalScale: 'float',
  bump: 'vec3',
  position: 'vec3',
};

const UNARY_OPS = new Set([
  'neg',
  'abs',
  'sign',
  'floor',
  'ceil',
  'fract',
  'sqrt',
  'exp',
  'log',
  'sin',
  'cos',
  'normalize',
]);

const BCAST_OPS = new Set([
  'add',
  'sub',
  'mul',
  'div',
  'mod',
  'pow',
  'atan2',
  'min',
  'max',
]);

// Exact fixed signatures `[arg0Type, arg1Type?, ...]` -> `returnType`
const FIXED_OP_SIGS: Readonly<
  Record<string, readonly [readonly TslType[], TslType]>
> = {
  cross: [['vec3', 'vec3'], 'vec3'],
  fresnel: [['float'], 'float'],
  simplexNoise2D: [['vec2'], 'float'],
  checker: [['vec2'], 'float'],
  simplexNoise3D: [['vec3'], 'float'],
  voronoi2D: [['vec2', 'float'], 'float'],
  triplanar: [['vec3', 'float'], 'float'],
  hueShift: [['vec3', 'float'], 'vec3'],
  bumpFromHeight: [['float', 'float'], 'vec3'],
};

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** GLSL-style `mod(a, b) = a - b * floor(a / safeB)`. */
export function tslSafeMod(a: number, b: number): number {
  const d = Math.abs(b) < 1e-6 ? (b < 0 ? -1e-6 : 1e-6) : b;
  return a - d * Math.floor(a / d);
}

/** Returns component count (`1..4`) for `type`. */
export function tslTypeArity(type: TslType): 1 | 2 | 3 | 4 {
  return type === 'vec4' ? 4 : type === 'vec3' ? 3 : type === 'vec2' ? 2 : 1;
}

/** Returns `TslType` for component count `1..4`, or `null` if out of range. */
export function tslTypeFromArity(arity: number): TslType | null {
  return arity === 1
    ? 'float'
    : arity === 2
      ? 'vec2'
      : arity === 3
        ? 'vec3'
        : arity === 4
          ? 'vec4'
          : null;
}

function isTslType(v: unknown): v is TslType {
  return v === 'float' || v === 'vec2' || v === 'vec3' || v === 'vec4';
}

function fail(
  code: TslValidationIssue['code'],
  message: string,
  hint = 'Use loop-free THREE.TSL expressions on MeshStandardNodeMaterial (<= 128 nodes, <= 16 uniforms).',
): TslValidationResult {
  return {ok: false, issue: {code, message, hint}};
}

function fnv1aStr(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h = Math.imul((h ^ s.charCodeAt(i)) >>> 0, 16777619) >>> 0;
  }
  return h;
}

const _f32Scratch = new Float32Array(1);
const _u32Scratch = new Uint32Array(_f32Scratch.buffer);

function fnv1aNum(h: number, n: number): number {
  _f32Scratch[0] = n;
  return Math.imul((h ^ _u32Scratch[0]) >>> 0, 16777619) >>> 0;
}

/** Packs a scalar or numeric tuple into a 4-component `vec4` uniform value. */
export function packUniformVec4(
  type: TslType,
  rawVal: unknown,
): [number, number, number, number] | null {
  const arity = tslTypeArity(type);
  if (arity === 1) {
    const n =
      typeof rawVal === 'number'
        ? rawVal
        : Array.isArray(rawVal) && rawVal.length === 1
          ? Number(rawVal[0])
          : NaN;
    return Number.isFinite(n) ? [Math.fround(n), 0, 0, 0] : null;
  }
  if (!Array.isArray(rawVal) && !(rawVal instanceof Float32Array)) return null;
  if (rawVal.length < arity) return null;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < arity; i++) {
    const n = Number(rawVal[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = Math.fround(n);
  }
  return out;
}

/**
 * Validates an untrusted `extras.tsl` JSON object in `O(N)` time,
 * guaranteeing acyclicity, quotas, type safety, and stage boundaries.
 */
export function validateTslGraph(
  raw: unknown,
  materialLabel = 'Material',
): TslValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('TL501', `Invalid extras.tsl on '${materialLabel}'.`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== 1) {
    return fail('TL501', `Unsupported TSL version on '${materialLabel}'.`);
  }

  const uniformSlots: ValidatedTslUniformSlot[] = [];
  const uniformSlotByName = new Map<string, ValidatedTslUniformSlot>();
  const rawUniforms = obj['uniforms'];
  if (rawUniforms !== undefined && rawUniforms !== null) {
    if (typeof rawUniforms !== 'object' || Array.isArray(rawUniforms)) {
      return fail('TL501', `Invalid TSL uniforms on '${materialLabel}'.`);
    }
    const uRec = rawUniforms as Record<string, unknown>;
    const uKeys = Object.keys(uRec).sort();
    if (uKeys.length > MAX_TSL_UNIFORMS) {
      return fail(
        'TL502',
        `TSL '${materialLabel}' exceeds MAX_TSL_UNIFORMS (${MAX_TSL_UNIFORMS}).`,
      );
    }
    for (let slot = 0; slot < uKeys.length; slot++) {
      const name = uKeys[slot];
      const uEntry = uRec[name] as Record<string, unknown> | undefined;
      const uType = uEntry && !Array.isArray(uEntry) ? uEntry['type'] : null;
      const packed = isTslType(uType)
        ? packUniformVec4(uType, uEntry!['value'])
        : null;
      if (
        FORBIDDEN_KEYS.has(name) ||
        !SAFE_IDENT.test(name) ||
        !isTslType(uType) ||
        !packed
      ) {
        return fail(
          'TL501',
          `Invalid TSL uniform '${name}' on '${materialLabel}'.`,
        );
      }
      const slotInfo: ValidatedTslUniformSlot = {
        name,
        slot,
        type: uType,
        defaultVec4: packed,
      };
      uniformSlots.push(slotInfo);
      uniformSlotByName.set(name, slotInfo);
    }
  }

  const rawNodes = obj['nodes'];
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return fail('TL501', `Empty TSL nodes on '${materialLabel}'.`);
  }
  if (rawNodes.length > MAX_TSL_NODES) {
    return fail(
      'TL502',
      `TSL '${materialLabel}' exceeds MAX_TSL_NODES (${MAX_TSL_NODES}).`,
    );
  }

  const nodes: ValidatedTslNode[] = [];
  let hash = 2166136261;
  for (const u of uniformSlots) {
    hash = fnv1aStr(hash, `U:${u.slot}:${u.type};`);
  }

  for (let idx = 0; idx < rawNodes.length; idx++) {
    const rn = rawNodes[idx];
    if (!rn || typeof rn !== 'object' || Array.isArray(rn)) {
      return fail('TL501', `Invalid TSL node ${idx} on '${materialLabel}'.`);
    }
    const nRec = rn as Record<string, unknown>;
    const opRaw = nRec['op'];
    const type = nRec['type'];
    if (
      opRaw === 'loop' ||
      opRaw === 'while' ||
      opRaw === 'for' ||
      opRaw === 'call'
    ) {
      return fail(
        'TL504',
        `Unsupported loop/call op '${opRaw}' at node ${idx} on '${materialLabel}'.`,
      );
    }
    if (typeof opRaw !== 'string' || !isTslType(type)) {
      return fail('TL501', `Malformed TSL node ${idx} on '${materialLabel}'.`);
    }
    const op = opRaw as TslOpName;

    const rawArgs = nRec['args'];
    const args: number[] = [];
    if (rawArgs !== undefined) {
      if (!Array.isArray(rawArgs) || rawArgs.length > 4) {
        return fail(
          'TL501',
          `Invalid args at node ${idx} on '${materialLabel}'.`,
        );
      }
      for (const a of rawArgs) {
        if (
          typeof a !== 'number' ||
          !Number.isInteger(a) ||
          a < 0 ||
          a >= idx
        ) {
          return fail(
            'TL501',
            `Cyclic or out-of-order arg at node ${idx} on '${materialLabel}'.`,
          );
        }
        args.push(a);
      }
    }

    hash = fnv1aStr(hash, `N${idx}:${op}:${type}:`);
    for (const a of args) hash = fnv1aStr(hash, `${a},`);

    const tA = args.map((a) => nodes[a].type);

    if (op === 'const') {
      const arity = tslTypeArity(type);
      const rawVal = nRec['value'];
      if (
        args.length !== 0 ||
        !Array.isArray(rawVal) ||
        rawVal.length !== arity
      ) {
        return fail(
          'TL501',
          `Invalid const node ${idx} on '${materialLabel}'.`,
        );
      }
      const vals: number[] = [];
      for (let c = 0; c < arity; c++) {
        const num = Number(rawVal[c]);
        if (!Number.isFinite(num)) {
          return fail('TL501', `Non-finite const at node ${idx}.`);
        }
        const f = Math.fround(num);
        vals.push(f);
        hash = fnv1aNum(hash, f);
      }
      nodes.push({op, type, args: [], value: vals});
    } else if (op === 'builtin') {
      const bName = nRec['name'];
      if (
        args.length !== 0 ||
        typeof bName !== 'string' ||
        BUILTIN_TYPES[bName] !== type
      ) {
        return fail('TL501', `Invalid builtin at node ${idx}.`);
      }
      hash = fnv1aStr(hash, bName);
      nodes.push({op, type, args: [], builtin: bName as TslBuiltinName});
    } else if (op === 'uniform') {
      const uName = nRec['name'];
      const slotInfo =
        typeof uName === 'string' ? uniformSlotByName.get(uName) : undefined;
      if (args.length !== 0 || !slotInfo || slotInfo.type !== type) {
        return fail('TL501', `Invalid uniform ref at node ${idx}.`);
      }
      hash = fnv1aStr(hash, `S${slotInfo.slot}`);
      nodes.push({op, type, args: [], uniformSlot: slotInfo.slot});
    } else if (op === 'swizzle') {
      const mask = nRec['mask'];
      if (
        args.length !== 1 ||
        typeof mask !== 'string' ||
        !/^[xyzw]{1,4}$/.test(mask) ||
        tslTypeFromArity(mask.length) !== type
      ) {
        return fail('TL501', `Invalid swizzle at node ${idx}.`);
      }
      const srcAr = tslTypeArity(tA[0]);
      for (let c = 0; c < mask.length; c++) {
        if ('xyzw'.indexOf(mask[c]) >= srcAr) {
          return fail(
            'TL501',
            `Swizzle '.${mask}' out of bounds at node ${idx}.`,
          );
        }
      }
      hash = fnv1aStr(hash, mask);
      nodes.push({op, type, args, mask});
    } else if (op === 'construct') {
      const targetAr = tslTypeArity(type);
      const sum = tA.reduce((acc, t) => acc + tslTypeArity(t), 0);
      if (
        args.length === 0 ||
        (!(args.length === 1 && tA[0] === 'float') && sum !== targetAr)
      ) {
        return fail('TL501', `Invalid construct at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else if (UNARY_OPS.has(op)) {
      if (args.length !== 1 || tA[0] !== type) {
        return fail('TL501', `Type mismatch on '${op}' at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else if (BCAST_OPS.has(op)) {
      const resolved =
        args.length === 2
          ? tA[0] === tA[1]
            ? tA[0]
            : tA[0] === 'float'
              ? tA[1]
              : tA[1] === 'float'
                ? tA[0]
                : null
          : null;
      if (resolved !== type) {
        return fail('TL501', `Type mismatch on '${op}' at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else if (op === 'step') {
      if (
        args.length !== 2 ||
        (tA[0] !== tA[1] && tA[0] !== 'float') ||
        type !== tA[1]
      ) {
        return fail('TL501', `Invalid 'step' at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else if (op === 'clamp') {
      const ok =
        args.length === 3 &&
        type === tA[0] &&
        ((tA[1] === tA[0] && tA[2] === tA[0]) ||
          (tA[1] === 'float' && tA[2] === 'float'));
      if (!ok) return fail('TL501', `Invalid 'clamp' at node ${idx}.`);
      nodes.push({op, type, args});
    } else if (op === 'mix') {
      const ok =
        args.length === 3 &&
        tA[0] === tA[1] &&
        type === tA[0] &&
        (tA[2] === tA[0] || tA[2] === 'float');
      if (!ok) return fail('TL501', `Invalid 'mix' at node ${idx}.`);
      nodes.push({op, type, args});
    } else if (op === 'smoothstep') {
      const ok =
        args.length === 3 &&
        type === tA[2] &&
        ((tA[0] === tA[2] && tA[1] === tA[2]) ||
          (tA[0] === 'float' && tA[1] === 'float'));
      if (!ok) return fail('TL501', `Invalid 'smoothstep' at node ${idx}.`);
      nodes.push({op, type, args});
    } else if (op === 'dot' || op === 'distance') {
      if (args.length !== 2 || tA[0] !== tA[1] || type !== 'float') {
        return fail('TL501', `Invalid '${op}' at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else if (op === 'length') {
      if (args.length !== 1 || type !== 'float') {
        return fail('TL501', `Invalid 'length' at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else if (op === 'reflect') {
      if (
        args.length !== 2 ||
        tA[0] !== tA[1] ||
        tA[0] === 'float' ||
        type !== tA[0]
      ) {
        return fail('TL501', `Invalid 'reflect' at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else if (op in FIXED_OP_SIGS) {
      const [expArgs, expOut] = FIXED_OP_SIGS[op];
      if (
        args.length !== expArgs.length ||
        type !== expOut ||
        expArgs.some((et, k) => tA[k] !== et)
      ) {
        return fail('TL501', `Invalid '${op}' at node ${idx}.`);
      }
      nodes.push({op, type, args});
    } else {
      return fail('TL501', `Unknown TSL op '${String(op)}' at node ${idx}.`);
    }
  }

  const rawOutputs = obj['outputs'];
  if (
    !rawOutputs ||
    typeof rawOutputs !== 'object' ||
    Array.isArray(rawOutputs)
  ) {
    return fail('TL501', `Missing TSL outputs on '${materialLabel}'.`);
  }
  const outRec = rawOutputs as Record<string, unknown>;
  const outputs: Record<string, number> = {};
  let outputCount = 0;

  for (const key of Object.keys(outRec).sort()) {
    const expTy = OUTPUT_SOCKET_TYPES[key];
    if (!expTy) {
      return fail(
        'TL501',
        `Unknown TSL socket '${key}' on '${materialLabel}'.`,
      );
    }
    const outIdx = outRec[key];
    if (outIdx === undefined || outIdx === null) continue;
    if (
      typeof outIdx !== 'number' ||
      !Number.isInteger(outIdx) ||
      outIdx < 0 ||
      outIdx >= nodes.length ||
      nodes[outIdx].type !== expTy
    ) {
      return fail(
        'TL501',
        `Invalid TSL output '${key}' on '${materialLabel}'.`,
      );
    }
    outputs[key] = outIdx;
    outputCount++;
    hash = fnv1aStr(hash, `O:${key}=${outIdx};`);
  }

  if (outputCount === 0) {
    return fail('TL501', `No active TSL outputs on '${materialLabel}'.`);
  }

  const fragmentReachable = new Uint8Array(nodes.length);
  const vertexReachable = new Uint8Array(nodes.length);
  for (const [key, outIdx] of Object.entries(outputs)) {
    if (key === 'position') vertexReachable[outIdx] = 1;
    else fragmentReachable[outIdx] = 1;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (fragmentReachable[i]) {
      for (const a of nodes[i].args) fragmentReachable[a] = 1;
    }
    if (vertexReachable[i]) {
      for (const a of nodes[i].args) vertexReachable[a] = 1;
    }
  }

  let usesTime = false;
  let usesDerivatives = false;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (
      vertexReachable[i] &&
      ((n.op === 'builtin' && n.builtin === 'viewDirection') ||
        n.op === 'fresnel' ||
        n.op === 'bumpFromHeight')
    ) {
      return fail(
        'TL503',
        `Fragment-only TSL op '${n.builtin || n.op}' used in positionNode on '${materialLabel}'.`,
      );
    }
    if (fragmentReachable[i] || vertexReachable[i]) {
      if (n.op === 'builtin' && n.builtin === 'time') usesTime = true;
      if (n.op === 'bumpFromHeight') usesDerivatives = true;
    }
  }

  return {
    ok: true,
    graph: {
      nodes,
      outputs: outputs as TslOutputs,
      uniformSlots,
      uniformSlotByName,
      hash: (hash >>> 0).toString(16).padStart(8, '0'),
      usesTime,
      usesVertexPosition: outputs['position'] !== undefined,
      usesDerivatives,
      fragmentReachable,
      vertexReachable,
    },
  };
}
