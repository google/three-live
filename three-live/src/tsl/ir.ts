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
 * @fileoverview Canonical Loop-Free TSL (`GOOGLE_material_tsl`) IR Schema,
 * Single-Pass Topological DAG Validator, and Deterministic CPU Reference
 * Evaluator.
 *
 * Enforces `<= 128` SSA nodes, `<= 16` indexed uniforms (`uTslParams[0..15]`),
 * structural acyclicity (`0 <= arg < idx`), strict vector/swizzle typing,
 * stage-boundary checks (`TL501–TL504`), and IEEE-754 NaN/zero-safe evaluation.
 */

/** glTF material extension identifier for loop-free TSL node graphs. */
export const TSL_EXTENSION_NAME = 'GOOGLE_material_tsl';

/** Hard per-material SSA node quota preventing GPU ALU amplification / TDR. */
export const MAX_TSL_NODES = 128;

/** Hard per-material user uniform quota mapped to `vec4 uTslParams[16]`. */
export const MAX_TSL_UNIFORMS = 16;

/** Time wrap period in seconds preserving fp32 phase precision over long runs. */
export const TSL_TIME_PERIOD_SEC = 3600;

/** Scalar and vector value types supported in `GOOGLE_material_tsl`. */
export type TslType = 'float' | 'vec2' | 'vec3' | 'vec4';

/** Built-in shader stage inputs available to `GOOGLE_material_tsl` graphs. */
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

/** Complete bounded op vocabulary of `GOOGLE_material_tsl` v1. */
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

/** Serialized uniform entry in `GOOGLE_material_tsl.uniforms`. */
export interface TslUniformDef {
  readonly type: TslType;
  readonly value: number | readonly number[];
}

/** Single SSA node in `GOOGLE_material_tsl.nodes`. */
export interface TslIrNode {
  readonly op: TslOpName;
  readonly type: TslType;
  readonly args?: readonly number[];
  readonly value?: readonly number[];
  readonly name?: string;
  readonly mask?: string;
}

/** Output socket map in `GOOGLE_material_tsl.outputs`. */
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

/** Canonical serialized `GOOGLE_material_tsl` v1 material extension payload. */
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

/** Structured diagnostic produced when validating a `GOOGLE_material_tsl` graph. */
export interface TslValidationIssue {
  readonly code: 'TL501' | 'TL502' | 'TL503' | 'TL504';
  readonly message: string;
  readonly hint: string;
}

/** Validated, immutable `GOOGLE_material_tsl` graph with precomputed metadata. */
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
  /** Nodes reachable from fragment outputs (`color`, `opacity`, `emissive`, etc.). */
  readonly fragmentReachable: Uint8Array;
  /** Nodes reachable from vertex `position` output. */
  readonly vertexReachable: Uint8Array;
}

/** Result of `validateTslGraph`: either a validated DAG or a diagnostic issue. */
export type TslValidationResult =
  | {readonly ok: true; readonly graph: ValidatedTslGraph}
  | {readonly ok: false; readonly issue: TslValidationIssue};

const BUILTIN_TYPES: Readonly<Record<TslBuiltinName, TslType>> = {
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

const OUTPUT_SOCKET_TYPES: Readonly<Record<keyof TslOutputs, TslType>> = {
  color: 'vec3',
  opacity: 'float',
  emissive: 'vec3',
  roughness: 'float',
  metalness: 'float',
  normalScale: 'float',
  bump: 'vec3',
  position: 'vec3',
};

const SAFE_UNIFORM_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const UNARY_SAME_TYPE_OPS = new Set<TslOpName>([
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

const BINARY_BROADCAST_OPS = new Set<TslOpName>([
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

/** Returns component count (`1..4`) for `type`. */
export function tslTypeArity(type: TslType): 1 | 2 | 3 | 4 {
  switch (type) {
    case 'float':
      return 1;
    case 'vec2':
      return 2;
    case 'vec3':
      return 3;
    case 'vec4':
      return 4;
    default:
      return 1;
  }
}

/** Returns `TslType` for component count `1..4`, or `null` if out of range. */
export function tslTypeFromArity(arity: number): TslType | null {
  switch (arity) {
    case 1:
      return 'float';
    case 2:
      return 'vec2';
    case 3:
      return 'vec3';
    case 4:
      return 'vec4';
    default:
      return null;
  }
}

function isTslType(v: unknown): v is TslType {
  return v === 'float' || v === 'vec2' || v === 'vec3' || v === 'vec4';
}

function resolveBroadcastBinaryType(a: TslType, b: TslType): TslType | null {
  if (a === b) return a;
  if (a === 'float') return b;
  if (b === 'float') return a;
  return null;
}

function fail(
  code: TslValidationIssue['code'],
  message: string,
  hint = 'Construct materials using THREE.MeshStandardNodeMaterial and loop-free THREE.TSL expressions (<= 128 nodes, <= 16 uniforms).',
): TslValidationResult {
  return {ok: false, issue: {code, message, hint}};
}

function fnv1aStr(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h = Math.imul((h ^ s.charCodeAt(i)) >>> 0, 16777619) >>> 0;
  }
  return h;
}

function fnv1aNum(h: number, n: number): number {
  const f = new Float32Array([n]);
  const u = new Uint32Array(f.buffer);
  return Math.imul((h ^ u[0]) >>> 0, 16777619) >>> 0;
}

/**
 * Packs a scalar or numeric tuple into a 4-component `vec4` uniform value,
 * validating finiteness and arity.
 */
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
    if (!Number.isFinite(n)) return null;
    return [Math.fround(n), 0, 0, 0];
  }
  if (!Array.isArray(rawVal) && !(rawVal instanceof Float32Array)) {
    return null;
  }
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
 * Validates an untrusted `GOOGLE_material_tsl` JSON object in `O(N)` time,
 * guaranteeing acyclicity, node/uniform quotas, type safety, swizzle bounds,
 * and vertex/fragment stage validity before any GPU compiler sees it.
 */
export function validateTslGraph(
  raw: unknown,
  materialLabel = 'Material',
): TslValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail(
      'TL501',
      `Invalid GOOGLE_material_tsl payload on '${materialLabel}': expected an object.`,
    );
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== 1) {
    return fail(
      'TL501',
      `Unsupported GOOGLE_material_tsl version '${String(obj['version'])}' on '${materialLabel}' (expected 1).`,
    );
  }

  // 1. Uniforms (<= 16, sanitized identifiers, mapped to deterministic slots 0..15)
  const uniformSlots: ValidatedTslUniformSlot[] = [];
  const uniformSlotByName = new Map<string, ValidatedTslUniformSlot>();
  const rawUniforms = obj['uniforms'];
  if (rawUniforms !== undefined && rawUniforms !== null) {
    if (typeof rawUniforms !== 'object' || Array.isArray(rawUniforms)) {
      return fail(
        'TL501',
        `Invalid uniforms map on '${materialLabel}': expected an object.`,
      );
    }
    const uRec = rawUniforms as Record<string, unknown>;
    const uKeys = Object.keys(uRec).sort();
    if (uKeys.length > MAX_TSL_UNIFORMS) {
      return fail(
        'TL502',
        `TSL material '${materialLabel}' declares ${uKeys.length} uniforms, exceeding MAX_TSL_UNIFORMS (${MAX_TSL_UNIFORMS}).`,
        'Consolidate scalar parameters into vec4 uniforms or inline constants via TSL.float(...).',
      );
    }
    for (let slot = 0; slot < uKeys.length; slot++) {
      const name = uKeys[slot];
      if (FORBIDDEN_KEYS.has(name) || !SAFE_UNIFORM_IDENT.test(name)) {
        return fail(
          'TL501',
          `Invalid TSL uniform identifier '${name}' on '${materialLabel}'.`,
        );
      }
      const uEntry = uRec[name];
      if (!uEntry || typeof uEntry !== 'object' || Array.isArray(uEntry)) {
        return fail(
          'TL501',
          `Malformed uniform definition '${name}' on '${materialLabel}'.`,
        );
      }
      const uType = (uEntry as Record<string, unknown>)['type'];
      if (!isTslType(uType)) {
        return fail(
          'TL501',
          `Unsupported type '${String(uType)}' for uniform '${name}' on '${materialLabel}'.`,
        );
      }
      const packed = packUniformVec4(
        uType,
        (uEntry as Record<string, unknown>)['value'],
      );
      if (!packed) {
        return fail(
          'TL501',
          `Non-finite or mismatched initial value for uniform '${name}' (${uType}) on '${materialLabel}'.`,
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

  // 2. Nodes (1..128, strict topological acyclicity arg < idx, strict typing)
  const rawNodes = obj['nodes'];
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return fail(
      'TL501',
      `GOOGLE_material_tsl on '${materialLabel}' must contain at least 1 node.`,
    );
  }
  if (rawNodes.length > MAX_TSL_NODES) {
    return fail(
      'TL502',
      `TSL material '${materialLabel}' has ${rawNodes.length} nodes, exceeding MAX_TSL_NODES (${MAX_TSL_NODES}).`,
      'Factor shared sub-expressions into variables or simplify procedural noise octaves to <= 128 SSA nodes.',
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
      return fail(
        'TL501',
        `Node ${idx} on '${materialLabel}' is not an object.`,
      );
    }
    const nRec = rn as Record<string, unknown>;
    const opRaw = nRec['op'];
    const typeRaw = nRec['type'];
    if (typeof opRaw !== 'string') {
      return fail('TL501', `Node ${idx} on '${materialLabel}' is missing op.`);
    }
    if (
      opRaw === 'loop' ||
      opRaw === 'while' ||
      opRaw === 'for' ||
      opRaw === 'call'
    ) {
      return fail(
        'TL504',
        `Unsupported imperative/loop op '${opRaw}' at node ${idx} on '${materialLabel}'.`,
        'Three-Live TSL requires loop-free acyclic expressions; replace loops with fixed unrolled octaves.',
      );
    }
    if (!isTslType(typeRaw)) {
      return fail(
        'TL501',
        `Node ${idx} on '${materialLabel}' has invalid type '${String(typeRaw)}'.`,
      );
    }
    const op = opRaw as TslOpName;
    const type = typeRaw;

    // Validate args array (if present) for strict topological order `0 <= arg < idx`.
    const rawArgs = nRec['args'];
    const args: number[] = [];
    if (rawArgs !== undefined) {
      if (!Array.isArray(rawArgs) || rawArgs.length > 4) {
        return fail(
          'TL501',
          `Node ${idx} (${op}) on '${materialLabel}' has invalid args list.`,
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
            `Node ${idx} (${op}) on '${materialLabel}' references out-of-order or cyclic arg ${String(a)} (must satisfy 0 <= arg < ${idx}).`,
          );
        }
        args.push(a);
      }
    }

    hash = fnv1aStr(hash, `N${idx}:${op}:${type}:`);
    for (const a of args) {
      hash = fnv1aStr(hash, `${a},`);
    }

    if (op === 'const') {
      if (args.length !== 0) {
        return fail(
          'TL501',
          `Const node ${idx} on '${materialLabel}' must not have args.`,
        );
      }
      const rawVal = nRec['value'];
      const arity = tslTypeArity(type);
      if (!Array.isArray(rawVal) || rawVal.length !== arity) {
        return fail(
          'TL501',
          `Const node ${idx} (${type}) on '${materialLabel}' requires value array of length ${arity}.`,
        );
      }
      const vals: number[] = [];
      for (let c = 0; c < arity; c++) {
        const num = Number(rawVal[c]);
        if (!Number.isFinite(num)) {
          return fail(
            'TL501',
            `Const node ${idx} on '${materialLabel}' contains non-finite number.`,
          );
        }
        const f = Math.fround(num);
        vals.push(f);
        hash = fnv1aNum(hash, f);
      }
      nodes.push({op, type, args: [], value: vals});
      continue;
    }

    if (op === 'builtin') {
      if (args.length !== 0) {
        return fail(
          'TL501',
          `Builtin node ${idx} on '${materialLabel}' must not have args.`,
        );
      }
      const bName = nRec['name'];
      if (typeof bName !== 'string' || !(bName in BUILTIN_TYPES)) {
        return fail(
          'TL501',
          `Unknown builtin '${String(bName)}' at node ${idx} on '${materialLabel}'.`,
        );
      }
      const expected = BUILTIN_TYPES[bName as TslBuiltinName];
      if (type !== expected) {
        return fail(
          'TL501',
          `Builtin '${bName}' at node ${idx} on '${materialLabel}' has type '${type}', expected '${expected}'.`,
        );
      }
      hash = fnv1aStr(hash, bName);
      nodes.push({op, type, args: [], builtin: bName as TslBuiltinName});
      continue;
    }

    if (op === 'uniform') {
      if (args.length !== 0) {
        return fail(
          'TL501',
          `Uniform node ${idx} on '${materialLabel}' must not have args.`,
        );
      }
      const uName = nRec['name'];
      const slotInfo =
        typeof uName === 'string' ? uniformSlotByName.get(uName) : undefined;
      if (!slotInfo) {
        return fail(
          'TL501',
          `Uniform node ${idx} on '${materialLabel}' references undeclared uniform '${String(uName)}'.`,
        );
      }
      if (slotInfo.type !== type) {
        return fail(
          'TL501',
          `Uniform node ${idx} ('${slotInfo.name}') has type '${type}', expected '${slotInfo.type}'.`,
        );
      }
      hash = fnv1aStr(hash, `S${slotInfo.slot}`);
      nodes.push({op, type, args: [], uniformSlot: slotInfo.slot});
      continue;
    }

    if (op === 'swizzle') {
      if (args.length !== 1) {
        return fail(
          'TL501',
          `Swizzle node ${idx} on '${materialLabel}' requires exactly 1 arg.`,
        );
      }
      const maskRaw = nRec['mask'];
      if (typeof maskRaw !== 'string' || !/^[xyzw]{1,4}$/.test(maskRaw)) {
        return fail(
          'TL501',
          `Invalid swizzle mask '${String(maskRaw)}' at node ${idx} on '${materialLabel}'.`,
        );
      }
      const srcArity = tslTypeArity(nodes[args[0]].type);
      for (let c = 0; c < maskRaw.length; c++) {
        const compIdx = 'xyzw'.indexOf(maskRaw[c]);
        if (compIdx < 0 || compIdx >= srcArity) {
          return fail(
            'TL501',
            `Swizzle '.${maskRaw}' at node ${idx} exceeds source type '${nodes[args[0]].type}'.`,
          );
        }
      }
      const expectedType = tslTypeFromArity(maskRaw.length);
      if (type !== expectedType) {
        return fail(
          'TL501',
          `Swizzle '.${maskRaw}' at node ${idx} has type '${type}', expected '${String(expectedType)}'.`,
        );
      }
      hash = fnv1aStr(hash, maskRaw);
      nodes.push({op, type, args, mask: maskRaw});
      continue;
    }

    if (op === 'construct') {
      const targetArity = tslTypeArity(type);
      if (args.length === 0 || args.length > 4) {
        return fail(
          'TL501',
          `Construct node ${idx} (${type}) on '${materialLabel}' has invalid arg count ${args.length}.`,
        );
      }
      if (args.length === 1 && nodes[args[0]].type === 'float') {
        nodes.push({op, type, args});
        continue;
      }
      let sum = 0;
      for (const a of args) {
        sum += tslTypeArity(nodes[a].type);
      }
      if (sum !== targetArity) {
        return fail(
          'TL501',
          `Construct node ${idx} (${type}) on '${materialLabel}' has ${sum} scalar components, expected ${targetArity}.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (UNARY_SAME_TYPE_OPS.has(op)) {
      if (args.length !== 1 || nodes[args[0]].type !== type) {
        return fail(
          'TL501',
          `Unary op '${op}' at node ${idx} on '${materialLabel}' mismatches operand type.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (BINARY_BROADCAST_OPS.has(op)) {
      if (args.length !== 2) {
        return fail(
          'TL501',
          `Binary op '${op}' at node ${idx} on '${materialLabel}' requires 2 args.`,
        );
      }
      const resolved = resolveBroadcastBinaryType(
        nodes[args[0]].type,
        nodes[args[1]].type,
      );
      if (!resolved || resolved !== type) {
        return fail(
          'TL501',
          `Binary op '${op}' at node ${idx} on '${materialLabel}' cannot combine '${nodes[args[0]].type}' and '${nodes[args[1]].type}' into '${type}'.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'step') {
      if (args.length !== 2) {
        return fail('TL501', `Op 'step' at node ${idx} requires 2 args.`);
      }
      const tEdge = nodes[args[0]].type;
      const tX = nodes[args[1]].type;
      if ((tEdge !== tX && tEdge !== 'float') || type !== tX) {
        return fail(
          'TL501',
          `Op 'step' at node ${idx} has incompatible types (${tEdge}, ${tX}) -> ${type}.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'clamp') {
      if (args.length !== 3) {
        return fail('TL501', `Op 'clamp' at node ${idx} requires 3 args.`);
      }
      const tX = nodes[args[0]].type;
      const tLo = nodes[args[1]].type;
      const tHi = nodes[args[2]].type;
      const boundsOk =
        (tLo === tX && tHi === tX) || (tLo === 'float' && tHi === 'float');
      if (!boundsOk || type !== tX) {
        return fail(
          'TL501',
          `Op 'clamp' at node ${idx} has incompatible types (${tX}, ${tLo}, ${tHi}) -> ${type}.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'mix') {
      if (args.length !== 3) {
        return fail('TL501', `Op 'mix' at node ${idx} requires 3 args.`);
      }
      const tA = nodes[args[0]].type;
      const tB = nodes[args[1]].type;
      const tT = nodes[args[2]].type;
      if (tA !== tB || (tT !== tA && tT !== 'float') || type !== tA) {
        return fail(
          'TL501',
          `Op 'mix' at node ${idx} has incompatible types (${tA}, ${tB}, ${tT}) -> ${type}.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'smoothstep') {
      if (args.length !== 3) {
        return fail('TL501', `Op 'smoothstep' at node ${idx} requires 3 args.`);
      }
      const tE0 = nodes[args[0]].type;
      const tE1 = nodes[args[1]].type;
      const tX = nodes[args[2]].type;
      const edgesOk =
        (tE0 === tX && tE1 === tX) || (tE0 === 'float' && tE1 === 'float');
      if (!edgesOk || type !== tX) {
        return fail(
          'TL501',
          `Op 'smoothstep' at node ${idx} has incompatible types (${tE0}, ${tE1}, ${tX}) -> ${type}.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'dot' || op === 'distance') {
      if (
        args.length !== 2 ||
        nodes[args[0]].type !== nodes[args[1]].type ||
        type !== 'float'
      ) {
        return fail(
          'TL501',
          `Op '${op}' at node ${idx} requires two matching types and 'float' output.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'length') {
      if (args.length !== 1 || type !== 'float') {
        return fail(
          'TL501',
          `Op 'length' at node ${idx} requires 1 arg and 'float' output.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'cross') {
      if (
        args.length !== 2 ||
        nodes[args[0]].type !== 'vec3' ||
        nodes[args[1]].type !== 'vec3' ||
        type !== 'vec3'
      ) {
        return fail(
          'TL501',
          `Op 'cross' at node ${idx} requires (vec3, vec3) -> vec3.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'reflect') {
      if (
        args.length !== 2 ||
        nodes[args[0]].type !== nodes[args[1]].type ||
        nodes[args[0]].type === 'float' ||
        type !== nodes[args[0]].type
      ) {
        return fail(
          'TL501',
          `Op 'reflect' at node ${idx} requires matching vector types.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'fresnel') {
      if (
        args.length !== 1 ||
        nodes[args[0]].type !== 'float' ||
        type !== 'float'
      ) {
        return fail(
          'TL501',
          `Op 'fresnel' at node ${idx} requires (float) -> float.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'simplexNoise2D' || op === 'checker') {
      if (
        args.length !== 1 ||
        nodes[args[0]].type !== 'vec2' ||
        type !== 'float'
      ) {
        return fail(
          'TL501',
          `Op '${op}' at node ${idx} requires (vec2) -> float.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'simplexNoise3D') {
      if (
        args.length !== 1 ||
        nodes[args[0]].type !== 'vec3' ||
        type !== 'float'
      ) {
        return fail(
          'TL501',
          `Op 'simplexNoise3D' at node ${idx} requires (vec3) -> float.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'voronoi2D') {
      if (
        args.length !== 2 ||
        nodes[args[0]].type !== 'vec2' ||
        nodes[args[1]].type !== 'float' ||
        type !== 'float'
      ) {
        return fail(
          'TL501',
          `Op 'voronoi2D' at node ${idx} requires (vec2, float) -> float.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'triplanar') {
      if (
        args.length !== 2 ||
        nodes[args[0]].type !== 'vec3' ||
        nodes[args[1]].type !== 'float' ||
        type !== 'float'
      ) {
        return fail(
          'TL501',
          `Op 'triplanar' at node ${idx} requires (vec3, float) -> float.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'hueShift') {
      if (
        args.length !== 2 ||
        nodes[args[0]].type !== 'vec3' ||
        nodes[args[1]].type !== 'float' ||
        type !== 'vec3'
      ) {
        return fail(
          'TL501',
          `Op 'hueShift' at node ${idx} requires (vec3, float) -> vec3.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    if (op === 'bumpFromHeight') {
      if (
        args.length !== 2 ||
        nodes[args[0]].type !== 'float' ||
        nodes[args[1]].type !== 'float' ||
        type !== 'vec3'
      ) {
        return fail(
          'TL501',
          `Op 'bumpFromHeight' at node ${idx} requires (float, float) -> vec3.`,
        );
      }
      nodes.push({op, type, args});
      continue;
    }

    return fail(
      'TL501',
      `Unknown TSL op '${String(op)}' at node ${idx} on '${materialLabel}'.`,
    );
  }

  // 3. Outputs validation & stage reachability (fragment vs vertex)
  const rawOutputs = obj['outputs'];
  if (
    !rawOutputs ||
    typeof rawOutputs !== 'object' ||
    Array.isArray(rawOutputs)
  ) {
    return fail(
      'TL501',
      `Missing outputs object in GOOGLE_material_tsl on '${materialLabel}'.`,
    );
  }
  const outRec = rawOutputs as Record<string, unknown>;
  const outputs: Record<string, number> = {};
  let outputCount = 0;

  for (const key of Object.keys(outRec).sort()) {
    if (!(key in OUTPUT_SOCKET_TYPES)) {
      return fail(
        'TL501',
        `Unknown TSL output socket '${key}' on '${materialLabel}'.`,
      );
    }
    const outIdx = outRec[key];
    if (outIdx === undefined || outIdx === null) continue;
    if (
      typeof outIdx !== 'number' ||
      !Number.isInteger(outIdx) ||
      outIdx < 0 ||
      outIdx >= nodes.length
    ) {
      return fail(
        'TL501',
        `Output '${key}' on '${materialLabel}' references out-of-range node ${String(outIdx)}.`,
      );
    }
    const expectedType = OUTPUT_SOCKET_TYPES[key as keyof TslOutputs];
    if (nodes[outIdx].type !== expectedType) {
      return fail(
        'TL501',
        `Output '${key}' on '${materialLabel}' has type '${nodes[outIdx].type}', expected '${expectedType}'.`,
      );
    }
    outputs[key] = outIdx;
    outputCount++;
    hash = fnv1aStr(hash, `O:${key}=${outIdx};`);
  }

  if (outputCount === 0) {
    return fail(
      'TL501',
      `GOOGLE_material_tsl on '${materialLabel}' specifies no active outputs.`,
    );
  }

  // Backward reachability pass (since args < idx, single reverse sweep marks exact closure!)
  const fragmentReachable = new Uint8Array(nodes.length);
  const vertexReachable = new Uint8Array(nodes.length);
  for (const [key, outIdx] of Object.entries(outputs)) {
    if (key === 'position') {
      vertexReachable[outIdx] = 1;
    } else {
      fragmentReachable[outIdx] = 1;
    }
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
    if (vertexReachable[i]) {
      if (
        (n.op === 'builtin' && n.builtin === 'viewDirection') ||
        n.op === 'fresnel' ||
        n.op === 'bumpFromHeight'
      ) {
        return fail(
          'TL503',
          `Fragment-only node '${n.op === 'builtin' ? n.builtin : n.op}' (node ${i}) cannot be wired into vertex positionNode on '${materialLabel}'.`,
          'Use positionLocal, positionWorld, normalLocal, normalWorld, uv, time, or simplexNoise3D inside positionNode.',
        );
      }
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

// =========================================================================
// Deterministic CPU Reference Evaluator (Matches GLSL / WGSL / Rust)
// =========================================================================

/** Per-vertex / per-fragment surface state passed to `evaluateTslGraphCpu`. */
export interface TslEvalContext {
  readonly positionLocal?: readonly [number, number, number];
  readonly positionWorld?: readonly [number, number, number];
  readonly normalLocal?: readonly [number, number, number];
  readonly normalWorld?: readonly [number, number, number];
  readonly viewDirection?: readonly [number, number, number];
  readonly uv?: readonly [number, number];
  readonly vertexColor?: readonly [number, number, number, number];
  readonly instanceIndex?: number;
  readonly time?: number;
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;
  /** Optional screen-space world position & height derivatives for `bumpFromHeight`. */
  readonly dpdx?: readonly [number, number, number];
  readonly dpdy?: readonly [number, number, number];
  readonly dhdx?: number;
  readonly dhdy?: number;
}

/** Evaluated PBR socket outputs from `evaluateTslGraphCpu`. */
export interface TslEvalOutputs {
  readonly color?: [number, number, number];
  readonly opacity?: number;
  readonly emissive?: [number, number, number];
  readonly roughness?: number;
  readonly metalness?: number;
  readonly normalScale?: number;
  readonly bump?: [number, number, number];
  readonly position?: [number, number, number];
}

/** Safe zero-guarded division (`abs(b) < 1e-6` clamped away from zero). */
export function tslSafeDiv(a: number, b: number): number {
  const denom = Math.abs(b) < 1e-6 ? (b < 0 ? -1e-6 : 1e-6) : b;
  return a / denom;
}

/** GLSL-style `mod(a, b) = a - b * floor(a / safeB)`. */
export function tslSafeMod(a: number, b: number): number {
  const d = Math.abs(b) < 1e-6 ? (b < 0 ? -1e-6 : 1e-6) : b;
  return a - d * Math.floor(a / d);
}

/** Defined across all real `(a, b)` including `(0, 0)`, `(0, -1)`, and `(-2, 0.5)`. */
export function tslSafePow(a: number, b: number): number {
  const exp = Math.min(Math.max(b, -64), 64);
  if (Math.abs(exp) < 1e-8) return 1;
  if (a <= 0) return 0;
  return Math.pow(Math.max(a, 1e-8), exp);
}

/** Order-safe clamp (`minVal > maxVal` swapped cleanly). */
export function tslSafeClamp(x: number, lo: number, hi: number): number {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return Math.min(Math.max(x, a), b);
}

/** Zero-width-safe Hermite smoothstep (`edge0 == edge1` never produces NaN). */
export function tslSafeSmoothstep(e0: number, e1: number, x: number): number {
  const t = tslSafeClamp(tslSafeDiv(x - e0, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mod289Scalar(x: number): number {
  return x - Math.floor(x * (1 / 289)) * 289;
}

function permuteScalar(x: number): number {
  return mod289Scalar((x * 34 + 10) * x);
}

function taylorInvSqrtScalar(r: number): number {
  return 1.79284291400159 - 0.85373472095314 * r;
}

/**
 * Pure-ALU Ashima 2D Simplex Noise mapped to `[0, 1]`.
 * Identical polynomial constants are emitted in GLSL, WGSL, and Rust.
 */
export function tslSimplexNoise2D(vx: number, vy: number): number {
  const c0 = 0.211324865405187; // (3.0 - sqrt(3.0)) / 6.0
  const c1 = 0.366025403784439; // 0.5 * (sqrt(3.0) - 1.0)
  const c2 = -0.577350269189626; // -1.0 + 2.0 * c0
  const c3 = 0.024390243902439; // 1.0 / 41.0

  const s = (vx + vy) * c1;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  const t = (ix + iy) * c0;
  const x0x = vx - ix + t;
  const x0y = vy - iy + t;

  const i1x = x0x > x0y ? 1 : 0;
  const i1y = x0x > x0y ? 0 : 1;
  const x1x = x0x + c0 - i1x;
  const x1y = x0y + c0 - i1y;
  const x2x = x0x + c2;
  const x2y = x0y + c2;

  ix = mod289Scalar(ix);
  iy = mod289Scalar(iy);
  const p0 = permuteScalar(permuteScalar(iy) + ix);
  const p1 = permuteScalar(permuteScalar(iy + i1y) + ix + i1x);
  const p2 = permuteScalar(permuteScalar(iy + 1) + ix + 1);

  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0);
  let m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y), 0);
  let m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y), 0);
  m0 = m0 * m0 * m0 * m0;
  m1 = m1 * m1 * m1 * m1;
  m2 = m2 * m2 * m2 * m2;

  const gx0 = 2 * (p0 * c3 - Math.floor(p0 * c3)) - 1;
  const gx1 = 2 * (p1 * c3 - Math.floor(p1 * c3)) - 1;
  const gx2 = 2 * (p2 * c3 - Math.floor(p2 * c3)) - 1;
  const hy0 = Math.abs(gx0) - 0.5;
  const hy1 = Math.abs(gx1) - 0.5;
  const hy2 = Math.abs(gx2) - 0.5;
  const ox0 = gx0 - Math.floor(gx0 + 0.5);
  const ox1 = gx1 - Math.floor(gx1 + 0.5);
  const ox2 = gx2 - Math.floor(gx2 + 0.5);

  m0 *= 1.79284291400159 - 0.85373472095314 * (ox0 * ox0 + hy0 * hy0);
  m1 *= 1.79284291400159 - 0.85373472095314 * (ox1 * ox1 + hy1 * hy1);
  m2 *= 1.79284291400159 - 0.85373472095314 * (ox2 * ox2 + hy2 * hy2);

  const g0 = ox0 * x0x + hy0 * x0y;
  const g1 = ox1 * x1x + hy1 * x1y;
  const g2 = ox2 * x2x + hy2 * x2y;
  const n = 130 * (m0 * g0 + m1 * g1 + m2 * g2);
  return tslSafeClamp(0.5 + 0.5 * n, 0, 1);
}

/**
 * Pure-ALU Ashima 3D Simplex Noise mapped to `[0, 1]`.
 */
export function tslSimplexNoise3D(vx: number, vy: number, vz: number): number {
  const c0 = 1 / 6;
  const c1 = 1 / 3;
  const s = (vx + vy + vz) * c1;
  let i0 = Math.floor(vx + s);
  let i1 = Math.floor(vy + s);
  let i2 = Math.floor(vz + s);
  const t = (i0 + i1 + i2) * c0;
  const x0 = vx - i0 + t;
  const y0 = vy - i1 + t;
  const z0 = vz - i2 + t;

  const gx = x0 >= y0 ? 1 : 0;
  const gy = y0 >= z0 ? 1 : 0;
  const gz = z0 >= x0 ? 1 : 0;
  const l0 = 1 - gz;
  const l1 = 1 - gx;
  const l2 = 1 - gy;

  const i1x = Math.min(gx, l0);
  const i1y = Math.min(gy, l1);
  const i1z = Math.min(gz, l2);
  const i2x = Math.max(gx, l0);
  const i2y = Math.max(gy, l1);
  const i2z = Math.max(gz, l2);

  const x1 = x0 - i1x + c0;
  const y1 = y0 - i1y + c0;
  const z1 = z0 - i1z + c0;
  const x2 = x0 - i2x + c1;
  const y2 = y0 - i2y + c1;
  const z2 = z0 - i2z + c1;
  const x3 = x0 - 0.5;
  const y3 = y0 - 0.5;
  const z3 = z0 - 0.5;

  i0 = mod289Scalar(i0);
  i1 = mod289Scalar(i1);
  i2 = mod289Scalar(i2);

  const p0 = permuteScalar(permuteScalar(permuteScalar(i2) + i1) + i0);
  const p1 = permuteScalar(
    permuteScalar(permuteScalar(i2 + i1z) + i1 + i1y) + i0 + i1x,
  );
  const p2 = permuteScalar(
    permuteScalar(permuteScalar(i2 + i2z) + i1 + i2y) + i0 + i2x,
  );
  const p3 = permuteScalar(
    permuteScalar(permuteScalar(i2 + 1) + i1 + 1) + i0 + 1,
  );

  const ns = 1 / 7;
  const ps = [p0, p1, p2, p3];
  const xs = [x0, x1, x2, x3];
  const ys = [y0, y1, y2, y3];
  const zs = [z0, z1, z2, z3];
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const pk = ps[k];
    const j = pk - 49 * Math.floor(pk * ns * ns);
    const x_ = Math.floor(j * ns);
    const y_ = Math.floor(j - 7 * x_);
    // Symmetric gradient octants: x_ in 0..6 -> [-6/7..6/7]
    let gxK = x_ * (2 / 7) + 1 / 7 - 1;
    let gyK = y_ * (2 / 7) + 1 / 7 - 1;
    const gzK = 1 - Math.abs(gxK) - Math.abs(gyK);
    const sz = gzK < 0 ? 1 : 0;
    gxK -= sz * (gxK >= 0 ? 1 : -1);
    gyK -= sz * (gyK >= 0 ? 1 : -1);
    const inv = taylorInvSqrtScalar(gxK * gxK + gyK * gyK + gzK * gzK);
    gxK *= inv;
    gyK *= inv;
    const gzN = gzK * inv;
    let m = Math.max(0.6 - (xs[k] * xs[k] + ys[k] * ys[k] + zs[k] * zs[k]), 0);
    m = m * m;
    m = m * m;
    sum += m * (gxK * xs[k] + gyK * ys[k] + gzN * zs[k]);
  }
  return tslSafeClamp(0.5 + 0.5 * (42 * sum), 0, 1);
}

/** Pure-ALU polynomial cellular F1 Voronoi distance in `[0, 1]`. */
export function tslVoronoi2D(ux: number, uy: number, jitter: number): number {
  const nx = Math.floor(ux);
  const ny = Math.floor(uy);
  const fx = ux - nx;
  const fy = uy - ny;
  const jit = tslSafeClamp(jitter, 0, 1);
  let minDist = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const qx = mod289Scalar(nx + dx);
      const qy = mod289Scalar(ny + dy);
      const pA = permuteScalar(permuteScalar(qx) + qy) * (1 / 41);
      const pB = permuteScalar(permuteScalar(qy + 7) + qx + 13) * (1 / 41);
      const hx = pA - Math.floor(pA);
      const hy = pB - Math.floor(pB);
      const rx = dx + 0.5 + (hx - 0.5) * jit - fx;
      const ry = dy + 0.5 + (hy - 0.5) * jit - fy;
      const d = Math.hypot(rx, ry);
      if (d < minDist) minDist = d;
    }
  }
  return tslSafeClamp(minDist, 0, 1);
}

/**
 * Evaluates a validated `GOOGLE_material_tsl` DAG on the CPU.
 */
export function evaluateTslGraphCpu(
  graph: ValidatedTslGraph,
  ctx: TslEvalContext = {},
): TslEvalOutputs {
  const posL = ctx.positionLocal ?? [0, 0, 0];
  const posW = ctx.positionWorld ?? posL;
  const normL = ctx.normalLocal ?? [0, 1, 0];
  const normW = ctx.normalWorld ?? normL;
  const viewD = ctx.viewDirection ?? [0, 0, 1];
  const uv = ctx.uv ?? [0, 0];
  const vCol = ctx.vertexColor ?? [1, 1, 1, 1];
  const instIdx = Number.isFinite(ctx.instanceIndex)
    ? (ctx.instanceIndex as number)
    : 0;
  const wrappedTime = tslSafeMod(
    Number.isFinite(ctx.time) ? (ctx.time as number) : 0,
    TSL_TIME_PERIOD_SEC,
  );

  // Prepare uniform slot table [0..15]
  const uTable: Array<[number, number, number, number]> =
    graph.uniformSlots.map((s) => {
      const override = ctx.uniforms?.[s.name];
      if (override !== undefined) {
        const packed = packUniformVec4(s.type, override);
        if (packed) return packed;
      }
      return [
        s.defaultVec4[0],
        s.defaultVec4[1],
        s.defaultVec4[2],
        s.defaultVec4[3],
      ];
    });

  const vals: number[][] = new Array(graph.nodes.length);

  const getComp = (v: number[], i: number): number =>
    v.length === 1 ? v[0] : v[i];

  const normVec = (v: readonly number[]): number[] => {
    let sq = 0;
    for (let i = 0; i < v.length; i++) sq += v[i] * v[i];
    const len = Math.sqrt(sq);
    return len > 1e-6 ? v.map((c) => c / len) : v.map(() => 0);
  };

  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const arity = tslTypeArity(n.type);
    switch (n.op) {
      case 'const':
        vals[i] = [...(n.value ?? [0])];
        break;
      case 'builtin':
        switch (n.builtin!) {
          case 'positionLocal':
            vals[i] = [posL[0], posL[1], posL[2]];
            break;
          case 'positionWorld':
            vals[i] = [posW[0], posW[1], posW[2]];
            break;
          case 'normalLocal':
            vals[i] = [normL[0], normL[1], normL[2]];
            break;
          case 'normalWorld':
            vals[i] = [normW[0], normW[1], normW[2]];
            break;
          case 'viewDirection':
            vals[i] = [viewD[0], viewD[1], viewD[2]];
            break;
          case 'uv':
            vals[i] = [uv[0], uv[1]];
            break;
          case 'vertexColor':
            vals[i] = [vCol[0], vCol[1], vCol[2], vCol[3]];
            break;
          case 'instanceIndex':
            vals[i] = [instIdx];
            break;
          case 'time':
            vals[i] = [wrappedTime];
            break;
          default:
            vals[i] = [0];
            break;
        }
        break;
      case 'uniform': {
        const u = uTable[n.uniformSlot ?? 0] ?? [0, 0, 0, 0];
        vals[i] = u.slice(0, arity);
        break;
      }
      case 'swizzle': {
        const src = vals[n.args[0]];
        const m = n.mask!;
        const out: number[] = [];
        for (let c = 0; c < m.length; c++) {
          out.push(src['xyzw'.indexOf(m[c])] ?? 0);
        }
        vals[i] = out;
        break;
      }
      case 'construct': {
        if (n.args.length === 1 && vals[n.args[0]].length === 1) {
          const s = vals[n.args[0]][0];
          vals[i] = new Array(arity).fill(s);
        } else {
          const out: number[] = [];
          for (const a of n.args) {
            for (const comp of vals[a]) out.push(comp);
          }
          vals[i] = out.slice(0, arity);
        }
        break;
      }
      case 'neg':
        vals[i] = vals[n.args[0]].map((x) => -x);
        break;
      case 'abs':
        vals[i] = vals[n.args[0]].map((x) => Math.abs(x));
        break;
      case 'sign':
        vals[i] = vals[n.args[0]].map((x) => (x > 0 ? 1 : x < 0 ? -1 : 0));
        break;
      case 'floor':
        vals[i] = vals[n.args[0]].map((x) => Math.floor(x));
        break;
      case 'ceil':
        vals[i] = vals[n.args[0]].map((x) => Math.ceil(x));
        break;
      case 'fract':
        vals[i] = vals[n.args[0]].map((x) => x - Math.floor(x));
        break;
      case 'sqrt':
        vals[i] = vals[n.args[0]].map((x) => Math.sqrt(Math.max(x, 0)));
        break;
      case 'exp':
        vals[i] = vals[n.args[0]].map((x) =>
          Math.exp(tslSafeClamp(x, -80, 80)),
        );
        break;
      case 'log':
        vals[i] = vals[n.args[0]].map((x) => Math.log(Math.max(x, 1e-8)));
        break;
      case 'sin':
        vals[i] = vals[n.args[0]].map((x) => Math.sin(x));
        break;
      case 'cos':
        vals[i] = vals[n.args[0]].map((x) => Math.cos(x));
        break;
      case 'normalize':
        vals[i] = normVec(vals[n.args[0]]);
        break;
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
      case 'mod':
      case 'pow':
      case 'atan2':
      case 'min':
      case 'max':
      case 'step': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        const out: number[] = new Array(arity);
        for (let c = 0; c < arity; c++) {
          const av = getComp(a, c);
          const bv = getComp(b, c);
          switch (n.op) {
            case 'add':
              out[c] = av + bv;
              break;
            case 'sub':
              out[c] = av - bv;
              break;
            case 'mul':
              out[c] = av * bv;
              break;
            case 'div':
              out[c] = tslSafeDiv(av, bv);
              break;
            case 'mod':
              out[c] = tslSafeMod(av, bv);
              break;
            case 'pow':
              out[c] = tslSafePow(av, bv);
              break;
            case 'atan2':
              out[c] =
                Math.abs(av) < 1e-8 && Math.abs(bv) < 1e-8
                  ? 0
                  : Math.atan2(av, bv);
              break;
            case 'min':
              out[c] = Math.min(av, bv);
              break;
            case 'max':
              out[c] = Math.max(av, bv);
              break;
            case 'step':
              out[c] = bv < av ? 0 : 1;
              break;
            default:
              out[c] = 0;
              break;
          }
        }
        vals[i] = out;
        break;
      }
      case 'clamp': {
        const x = vals[n.args[0]];
        const lo = vals[n.args[1]];
        const hi = vals[n.args[2]];
        const out: number[] = new Array(arity);
        for (let c = 0; c < arity; c++) {
          out[c] = tslSafeClamp(getComp(x, c), getComp(lo, c), getComp(hi, c));
        }
        vals[i] = out;
        break;
      }
      case 'mix': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        const t = vals[n.args[2]];
        const out: number[] = new Array(arity);
        for (let c = 0; c < arity; c++) {
          const tv = getComp(t, c);
          out[c] = a[c] + (b[c] - a[c]) * tv;
        }
        vals[i] = out;
        break;
      }
      case 'smoothstep': {
        const e0 = vals[n.args[0]];
        const e1 = vals[n.args[1]];
        const x = vals[n.args[2]];
        const out: number[] = new Array(arity);
        for (let c = 0; c < arity; c++) {
          out[c] = tslSafeSmoothstep(
            getComp(e0, c),
            getComp(e1, c),
            getComp(x, c),
          );
        }
        vals[i] = out;
        break;
      }
      case 'dot': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        let d = 0;
        for (let c = 0; c < a.length; c++) d += a[c] * b[c];
        vals[i] = [d];
        break;
      }
      case 'length': {
        const a = vals[n.args[0]];
        let sq = 0;
        for (let c = 0; c < a.length; c++) sq += a[c] * a[c];
        vals[i] = [Math.sqrt(sq)];
        break;
      }
      case 'distance': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        let sq = 0;
        for (let c = 0; c < a.length; c++) {
          const d = a[c] - b[c];
          sq += d * d;
        }
        vals[i] = [Math.sqrt(sq)];
        break;
      }
      case 'cross': {
        const a = vals[n.args[0]];
        const b = vals[n.args[1]];
        vals[i] = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        break;
      }
      case 'reflect': {
        const inc = vals[n.args[0]];
        const nrm = vals[n.args[1]];
        let d = 0;
        for (let c = 0; c < inc.length; c++) d += nrm[c] * inc[c];
        vals[i] = inc.map((ic, c) => ic - 2 * d * nrm[c]);
        break;
      }
      case 'fresnel': {
        const nw = normVec(normW);
        const vd = normVec(viewD);
        const ndv = tslSafeClamp(
          nw[0] * vd[0] + nw[1] * vd[1] + nw[2] * vd[2],
          0,
          1,
        );
        const power = Math.max(vals[n.args[0]][0], 1e-3);
        vals[i] = [tslSafePow(1 - ndv, power)];
        break;
      }
      case 'simplexNoise2D': {
        const p = vals[n.args[0]];
        vals[i] = [tslSimplexNoise2D(p[0], p[1])];
        break;
      }
      case 'simplexNoise3D': {
        const p = vals[n.args[0]];
        vals[i] = [tslSimplexNoise3D(p[0], p[1], p[2])];
        break;
      }
      case 'voronoi2D': {
        const p = vals[n.args[0]];
        const jit = vals[n.args[1]][0];
        vals[i] = [tslVoronoi2D(p[0], p[1], jit)];
        break;
      }
      case 'checker': {
        const p = vals[n.args[0]];
        const m = tslSafeMod(Math.floor(p[0]) + Math.floor(p[1]), 2);
        vals[i] = [m >= 1 ? 1 : 0];
        break;
      }
      case 'triplanar': {
        const p = vals[n.args[0]];
        const sharp = tslSafeClamp(vals[n.args[1]][0], 0.5, 16);
        const nw = normVec(normW);
        const wx = tslSafePow(Math.max(Math.abs(nw[0]), 1e-4), sharp);
        const wy = tslSafePow(Math.max(Math.abs(nw[1]), 1e-4), sharp);
        const wz = tslSafePow(Math.max(Math.abs(nw[2]), 1e-4), sharp);
        const wSum = Math.max(wx + wy + wz, 1e-6);
        const nx = tslSimplexNoise2D(p[1], p[2]);
        const ny = tslSimplexNoise2D(p[0], p[2]);
        const nz = tslSimplexNoise2D(p[0], p[1]);
        vals[i] = [(wx * nx + wy * ny + wz * nz) / wSum];
        break;
      }
      case 'hueShift': {
        const rgb = vals[n.args[0]];
        const ang = vals[n.args[1]][0];
        const k = 0.5773502691896258;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const dotKRgb = k * (rgb[0] + rgb[1] + rgb[2]);
        const cx = k * (rgb[2] - rgb[1]);
        const cy = k * (rgb[0] - rgb[2]);
        const cz = k * (rgb[1] - rgb[0]);
        vals[i] = [
          rgb[0] * cosA + cx * sinA + k * dotKRgb * (1 - cosA),
          rgb[1] * cosA + cy * sinA + k * dotKRgb * (1 - cosA),
          rgb[2] * cosA + cz * sinA + k * dotKRgb * (1 - cosA),
        ];
        break;
      }
      case 'bumpFromHeight': {
        const strength = vals[n.args[1]][0];
        const nw = normVec(normW);
        const dx = ctx.dpdx;
        const dy = ctx.dpdy;
        const dhx = ctx.dhdx ?? 0;
        const dhy = ctx.dhdy ?? 0;
        if (dx && dy && (dhx !== 0 || dhy !== 0)) {
          const r1 = [
            dy[1] * nw[2] - dy[2] * nw[1],
            dy[2] * nw[0] - dy[0] * nw[2],
            dy[0] * nw[1] - dy[1] * nw[0],
          ];
          const r2 = [
            nw[1] * dx[2] - nw[2] * dx[1],
            nw[2] * dx[0] - nw[0] * dx[2],
            nw[0] * dx[1] - nw[1] * dx[0],
          ];
          const det = dx[0] * r1[0] + dx[1] * r1[1] + dx[2] * r1[2];
          if (Math.abs(det) > 1e-8) {
            const sg = det < 0 ? -1 : 1;
            const ad = Math.abs(det);
            vals[i] = normVec([
              ad * nw[0] - strength * sg * (dhx * r1[0] + dhy * r2[0]),
              ad * nw[1] - strength * sg * (dhx * r1[1] + dhy * r2[1]),
              ad * nw[2] - strength * sg * (dhx * r1[2] + dhy * r2[2]),
            ]);
            break;
          }
        }
        vals[i] = [nw[0], nw[1], nw[2]];
        break;
      }
      default:
        vals[i] = new Array(arity).fill(0);
        break;
    }
  }

  const out: {
    color?: [number, number, number];
    opacity?: number;
    emissive?: [number, number, number];
    roughness?: number;
    metalness?: number;
    normalScale?: number;
    bump?: [number, number, number];
    position?: [number, number, number];
  } = {};

  if (graph.outputs.color !== undefined) {
    const v = vals[graph.outputs.color];
    out.color = [Math.max(0, v[0]), Math.max(0, v[1]), Math.max(0, v[2])];
  }
  if (graph.outputs.opacity !== undefined) {
    out.opacity = tslSafeClamp(vals[graph.outputs.opacity][0], 0, 1);
  }
  if (graph.outputs.emissive !== undefined) {
    const v = vals[graph.outputs.emissive];
    out.emissive = [Math.max(0, v[0]), Math.max(0, v[1]), Math.max(0, v[2])];
  }
  if (graph.outputs.roughness !== undefined) {
    out.roughness = tslSafeClamp(vals[graph.outputs.roughness][0], 0.04, 1);
  }
  if (graph.outputs.metalness !== undefined) {
    out.metalness = tslSafeClamp(vals[graph.outputs.metalness][0], 0, 1);
  }
  if (graph.outputs.normalScale !== undefined) {
    out.normalScale = Math.max(0, vals[graph.outputs.normalScale][0]);
  }
  if (graph.outputs.bump !== undefined) {
    const v = normVec(vals[graph.outputs.bump]);
    out.bump = [v[0], v[1], v[2]];
  }
  if (graph.outputs.position !== undefined) {
    const v = vals[graph.outputs.position];
    out.position = [v[0], v[1], v[2]];
  }
  return out;
}
