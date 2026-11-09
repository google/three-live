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
 * @fileoverview Self-Contained Loop-Free `THREE.TSL` & `MeshStandardNodeMaterial`
 * Authoring Installer (`installTslExtension`).
 *
 * Serialized via `Function.prototype.toString()` into sandboxed Web Workers and
 * invoked inside `ENABLE_SERVER_EXTRACT` for the Rust Boa compiler, keeping core
 * `three-live.min.js` overhead at ~0 B when `three-live-tsl` is not loaded.
 */

import type {TslMaterialGraph, TslType} from './ir';

/** Fluent immutable TSL AST node surface exposed on `THREE.TSL`. */
export interface TSLNodeLike {
  readonly isTSLNode: true;
  readonly nodeType: TslType;
  readonly x: TSLNodeLike;
  readonly y: TSLNodeLike;
  readonly z: TSLNodeLike;
  readonly w: TSLNodeLike;
  readonly r: TSLNodeLike;
  readonly g: TSLNodeLike;
  readonly b: TSLNodeLike;
  readonly a: TSLNodeLike;
  readonly xy: TSLNodeLike;
  readonly xz: TSLNodeLike;
  readonly yz: TSLNodeLike;
  readonly xyz: TSLNodeLike;
  readonly rgb: TSLNodeLike;
  readonly xyzw: TSLNodeLike;
  readonly rgba: TSLNodeLike;
  value?: unknown;
  swizzle(mask: string): TSLNodeLike;
  add(b: unknown): TSLNodeLike;
  sub(b: unknown): TSLNodeLike;
  mul(b: unknown): TSLNodeLike;
  div(b: unknown): TSLNodeLike;
  mod(b: unknown): TSLNodeLike;
  neg(): TSLNodeLike;
  abs(): TSLNodeLike;
  sign(): TSLNodeLike;
  floor(): TSLNodeLike;
  ceil(): TSLNodeLike;
  fract(): TSLNodeLike;
  sqrt(): TSLNodeLike;
  pow(b: unknown): TSLNodeLike;
  exp(): TSLNodeLike;
  log(): TSLNodeLike;
  sin(): TSLNodeLike;
  cos(): TSLNodeLike;
  atan2(x: unknown): TSLNodeLike;
  min(b: unknown): TSLNodeLike;
  max(b: unknown): TSLNodeLike;
  clamp(lo?: unknown, hi?: unknown): TSLNodeLike;
  saturate(): TSLNodeLike;
  oneMinus(): TSLNodeLike;
  mix(b: unknown, t: unknown): TSLNodeLike;
  step(x: unknown): TSLNodeLike;
  smoothstep(e1: unknown, x: unknown): TSLNodeLike;
  dot(b: unknown): TSLNodeLike;
  cross(b: unknown): TSLNodeLike;
  length(): TSLNodeLike;
  distance(b: unknown): TSLNodeLike;
  normalize(): TSLNodeLike;
  reflect(normal: unknown): TSLNodeLike;
  remap(
    inLo: unknown,
    inHi: unknown,
    outLo: unknown,
    outHi: unknown,
  ): TSLNodeLike;
}

/**
 * Installs `THREE.TSL`, `THREE.MeshStandardNodeMaterial`, and
 * `THREE.MeshPhysicalNodeMaterial` onto a `THREE` namespace and shared registry.
 *
 * IMPORTANT: Serialized with `Function.prototype.toString()` for Web Workers!
 * Do NOT reference module-scoped imports or variables inside this function, and
 * initialize all class fields inside `constructor` (no class field initializers).
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installTslExtension(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.MeshPhysicalMaterial) return null;
  if (
    reg?.authorNamespace?.TSL &&
    reg?.authorNamespace?.MeshStandardNodeMaterial
  ) {
    return {
      TSL: reg.authorNamespace.TSL,
      MeshStandardNodeMaterial: reg.authorNamespace.MeshStandardNodeMaterial,
      MeshPhysicalNodeMaterial: reg.authorNamespace.MeshPhysicalNodeMaterial,
    };
  }

  const MAX_NODES = 128;
  const MAX_UNIFORMS = 16;
  let autoUniformCounter = 0;

  const warnTsl = (code: string, detail: string, fallback: string) => {
    if (typeof threeNs.warnUnsupported === 'function') {
      threeNs.warnUnsupported(`${detail} [${code}]`, fallback);
    }
  };

  const arityOf = (t: string): number =>
    t === 'vec4' ? 4 : t === 'vec3' ? 3 : t === 'vec2' ? 2 : 1;

  const typeOfArity = (n: number): TslType =>
    n === 4 ? 'vec4' : n === 3 ? 'vec3' : n === 2 ? 'vec2' : 'float';

  const fin = (v: unknown, fb = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.fround(n) : fb;
  };

  interface RawAst {
    readonly _op: string;
    readonly _type: TslType;
    readonly _args: RawAst[];
    readonly _val?: number[];
    readonly _name?: string;
    readonly _mask?: string;
    _uVal?: unknown;
  }

  const isNode = (v: unknown): v is TSLNode =>
    Boolean(v && (v as {isTSLNode?: unknown}).isTSLNode === true);

  // Coerces numbers, arrays, THREE.Color, and THREE.Vector2/3/4 into a TSLNode.
  const toNode = (v: unknown, preferredArity = 1): TSLNode => {
    if (isNode(v)) return v;
    if (typeof v === 'number' || typeof v === 'boolean') {
      const f = fin(Number(v), 0);
      if (preferredArity > 1) {
        return new TSLNode(
          'const',
          typeOfArity(preferredArity),
          [],
          new Array(preferredArity).fill(f),
        );
      }
      return new TSLNode('const', 'float', [], [f]);
    }
    if (typeof v === 'string') {
      const c = new threeNs.Color(v);
      return new TSLNode(
        'const',
        'vec3',
        [],
        [fin(c.r, 1), fin(c.g, 1), fin(c.b, 1)],
      );
    }
    if (Array.isArray(v) || v instanceof Float32Array) {
      const len = Math.max(1, Math.min(4, v.length));
      const vals: number[] = [];
      for (let i = 0; i < len; i++) vals.push(fin(v[i], 0));
      return new TSLNode('const', typeOfArity(len), [], vals);
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if ('isColor' in obj || ('r' in obj && 'g' in obj && 'b' in obj)) {
        return new TSLNode(
          'const',
          'vec3',
          [],
          [fin(obj['r'], 1), fin(obj['g'], 1), fin(obj['b'], 1)],
        );
      }
      if ('x' in obj && 'y' in obj && 'z' in obj && 'w' in obj) {
        return new TSLNode(
          'const',
          'vec4',
          [],
          [
            fin(obj['x'], 0),
            fin(obj['y'], 0),
            fin(obj['z'], 0),
            fin(obj['w'], 1),
          ],
        );
      }
      if ('x' in obj && 'y' in obj && 'z' in obj) {
        return new TSLNode(
          'const',
          'vec3',
          [],
          [fin(obj['x'], 0), fin(obj['y'], 0), fin(obj['z'], 0)],
        );
      }
      if ('x' in obj && 'y' in obj) {
        return new TSLNode(
          'const',
          'vec2',
          [],
          [fin(obj['x'], 0), fin(obj['y'], 0)],
        );
      }
    }
    return new TSLNode('const', 'float', [], [0]);
  };

  const broadcastPair = (
    rawA: unknown,
    rawB: unknown,
  ): [TSLNode, TSLNode, TslType] => {
    const a = toNode(rawA);
    let b = toNode(rawB);
    if (a._type === b._type) return [a, b, a._type];
    if (a._type === 'float') return [a, b, b._type];
    if (b._type === 'float') return [a, b, a._type];
    // Mismatched vector widths: coerce `b` to `a._type` via swizzle or construct
    const targetArity = arityOf(a._type);
    const bArity = arityOf(b._type);
    if (bArity > targetArity) {
      b = b.swizzle('xyzw'.slice(0, targetArity));
    } else {
      const padArgs: TSLNode[] = [b];
      for (let k = bArity; k < targetArity; k++) {
        padArgs.push(new TSLNode('const', 'float', [], [0]));
      }
      b = new TSLNode('construct', a._type, padArgs);
    }
    return [a, b, a._type];
  };

  const coerceToType = (raw: unknown, targetType: TslType): TSLNode => {
    const n = toNode(raw);
    if (n._type === targetType) return n;
    const tArity = arityOf(targetType);
    const nArity = arityOf(n._type);
    if (tArity === 1) return n.swizzle('x');
    if (nArity === 1) {
      if (n._op === 'const' && n._val) {
        return new TSLNode(
          'const',
          targetType,
          [],
          new Array(tArity).fill(n._val[0]),
        );
      }
      return new TSLNode('construct', targetType, [n]);
    }
    if (nArity > tArity) {
      return n.swizzle('xyzw'.slice(0, tArity));
    }
    const pad: TSLNode[] = [n];
    for (let k = nArity; k < tArity; k++) {
      pad.push(new TSLNode('const', 'float', [], [k === 3 ? 1 : 0]));
    }
    return new TSLNode('construct', targetType, pad);
  };

  class TSLNode implements RawAst {
    readonly isTSLNode: true;
    readonly _op: string;
    readonly _type: TslType;
    readonly _args: TSLNode[];
    readonly _val?: number[];
    readonly _name?: string;
    readonly _mask?: string;
    _uVal?: unknown;

    constructor(
      op: string,
      type: TslType,
      args: TSLNode[],
      val?: number[],
      name?: string,
      mask?: string,
    ) {
      this.isTSLNode = true;
      this._op = op;
      this._type = type;
      this._args = args;
      if (val !== undefined) this._val = val;
      if (name !== undefined) this._name = name;
      if (mask !== undefined) this._mask = mask;
    }

    get nodeType(): TslType {
      return this._type;
    }

    get value(): unknown {
      return this._uVal;
    }

    set value(v: unknown) {
      if (this._op === 'uniform') {
        this._uVal = v;
      }
    }

    swizzle(rawMask: string): TSLNode {
      const mapped = String(rawMask || 'x')
        .trim()
        .replace(/r/g, 'x')
        .replace(/g/g, 'y')
        .replace(/b/g, 'z')
        .replace(/a/g, 'w');
      if (!/^[xyzw]{1,4}$/.test(mapped)) {
        warnTsl('TL501', `Invalid TSL swizzle '${rawMask}'`, '.x');
        return new TSLNode('const', 'float', [], [0]);
      }
      const srcArity = arityOf(this._type);
      if (srcArity === 1 && mapped === 'x') {
        return this;
      }
      for (let i = 0; i < mapped.length; i++) {
        const ci = 'xyzw'.indexOf(mapped[i]);
        if (ci >= srcArity) {
          warnTsl(
            'TL501',
            `TSL swizzle '.${rawMask}' out of range for ${this._type}`,
            'zero constant',
          );
          return new TSLNode(
            'const',
            typeOfArity(mapped.length),
            [],
            new Array(mapped.length).fill(0),
          );
        }
      }
      return new TSLNode(
        'swizzle',
        typeOfArity(mapped.length),
        [this],
        undefined,
        undefined,
        mapped,
      );
    }

    get x(): TSLNode {
      return this.swizzle('x');
    }
    get y(): TSLNode {
      return this.swizzle('y');
    }
    get z(): TSLNode {
      return this.swizzle('z');
    }
    get w(): TSLNode {
      return this.swizzle('w');
    }
    get r(): TSLNode {
      return this.swizzle('x');
    }
    get g(): TSLNode {
      return this.swizzle('y');
    }
    get b(): TSLNode {
      return this.swizzle('z');
    }
    get a(): TSLNode {
      return this.swizzle('w');
    }
    get xy(): TSLNode {
      return this.swizzle('xy');
    }
    get xz(): TSLNode {
      return this.swizzle('xz');
    }
    get yz(): TSLNode {
      return this.swizzle('yz');
    }
    get xyz(): TSLNode {
      return this.swizzle('xyz');
    }
    get rgb(): TSLNode {
      return this.swizzle('xyz');
    }
    get xyzw(): TSLNode {
      return this.swizzle('xyzw');
    }
    get rgba(): TSLNode {
      return this.swizzle('xyzw');
    }

    add(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('add', t, [na, nb]);
    }
    sub(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('sub', t, [na, nb]);
    }
    mul(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('mul', t, [na, nb]);
    }
    div(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('div', t, [na, nb]);
    }
    mod(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('mod', t, [na, nb]);
    }
    pow(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('pow', t, [na, nb]);
    }
    atan2(x: unknown): TSLNode {
      const [ny, nx, t] = broadcastPair(this, x);
      return new TSLNode('atan2', t, [ny, nx]);
    }
    min(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('min', t, [na, nb]);
    }
    max(b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode('max', t, [na, nb]);
    }
    neg(): TSLNode {
      return new TSLNode('neg', this._type, [this]);
    }
    abs(): TSLNode {
      return new TSLNode('abs', this._type, [this]);
    }
    sign(): TSLNode {
      return new TSLNode('sign', this._type, [this]);
    }
    floor(): TSLNode {
      return new TSLNode('floor', this._type, [this]);
    }
    ceil(): TSLNode {
      return new TSLNode('ceil', this._type, [this]);
    }
    fract(): TSLNode {
      return new TSLNode('fract', this._type, [this]);
    }
    sqrt(): TSLNode {
      return new TSLNode('sqrt', this._type, [this]);
    }
    exp(): TSLNode {
      return new TSLNode('exp', this._type, [this]);
    }
    log(): TSLNode {
      return new TSLNode('log', this._type, [this]);
    }
    sin(): TSLNode {
      return new TSLNode('sin', this._type, [this]);
    }
    cos(): TSLNode {
      return new TSLNode('cos', this._type, [this]);
    }
    normalize(): TSLNode {
      return new TSLNode('normalize', this._type, [this]);
    }
    clamp(lo: unknown = 0, hi: unknown = 1): TSLNode {
      let nLo = toNode(lo);
      let nHi = toNode(hi);
      if (nLo._type !== 'float' || nHi._type !== 'float') {
        nLo = coerceToType(nLo, this._type);
        nHi = coerceToType(nHi, this._type);
      }
      return new TSLNode('clamp', this._type, [this, nLo, nHi]);
    }
    saturate(): TSLNode {
      return this.clamp(0, 1);
    }
    oneMinus(): TSLNode {
      return toNode(1, arityOf(this._type)).sub(this);
    }
    mix(b: unknown, t: unknown): TSLNode {
      const [na, nb, ty] = broadcastPair(this, b);
      let nt = toNode(t);
      if (nt._type !== 'float' && nt._type !== ty) {
        nt = coerceToType(nt, ty);
      }
      return new TSLNode('mix', ty, [na, nb, nt]);
    }
    step(x: unknown): TSLNode {
      const nx = toNode(x);
      if (this._type === 'float') {
        return new TSLNode('step', nx._type, [this, nx]);
      }
      const nb = coerceToType(nx, this._type);
      return new TSLNode('step', this._type, [this, nb]);
    }
    smoothstep(e1: unknown, x: unknown): TSLNode {
      const nx = toNode(x);
      let ne0: TSLNode = this;
      let ne1 = toNode(e1);
      if (ne0._type !== 'float' || ne1._type !== 'float') {
        ne0 = coerceToType(ne0, nx._type);
        ne1 = coerceToType(ne1, nx._type);
      }
      return new TSLNode('smoothstep', nx._type, [ne0, ne1, nx]);
    }
    dot(b: unknown): TSLNode {
      const [na, nb] = broadcastPair(this, b);
      return new TSLNode('dot', 'float', [na, nb]);
    }
    cross(b: unknown): TSLNode {
      return new TSLNode('cross', 'vec3', [
        coerceToType(this, 'vec3'),
        coerceToType(b, 'vec3'),
      ]);
    }
    length(): TSLNode {
      return new TSLNode('length', 'float', [this]);
    }
    distance(b: unknown): TSLNode {
      const [na, nb] = broadcastPair(this, b);
      return new TSLNode('distance', 'float', [na, nb]);
    }
    reflect(normal: unknown): TSLNode {
      const vSelf =
        this._type === 'float' ? coerceToType(this, 'vec3') : (this as TSLNode);
      return new TSLNode('reflect', vSelf._type, [
        vSelf,
        coerceToType(normal, vSelf._type),
      ]);
    }
    remap(
      inLo: unknown,
      inHi: unknown,
      outLo: unknown,
      outHi: unknown,
    ): TSLNode {
      const t = this.sub(inLo).div(toNode(inHi).sub(inLo)).clamp(0, 1);
      return toNode(outLo).mix(outHi, t);
    }
  }

  // Creates a builtin node that works both as a property (`TSL.uv.mul(4)`) and
  // as a zero-arg function (`TSL.uv().mul(4)`), matching Three.js `three/tsl`!
  const makeBuiltin = (name: string, type: TslType): TSLNode => {
    const base = new TSLNode('builtin', type, [], undefined, name);
    const callable = () => base;
    Object.setPrototypeOf(callable, TSLNode.prototype);
    Object.assign(callable, base);
    return callable as unknown as TSLNode;
  };

  const buildVec = (targetType: TslType, items: unknown[]): TSLNode => {
    const arity = arityOf(targetType);
    if (items.length === 0) {
      return new TSLNode('const', targetType, [], new Array(arity).fill(0));
    }
    if (items.length === 1) {
      const single = toNode(items[0]);
      if (single._type === targetType) return single;
      if (single._type === 'float') {
        if (single._op === 'const' && single._val) {
          return new TSLNode(
            'const',
            targetType,
            [],
            new Array(arity).fill(single._val[0]),
          );
        }
        return new TSLNode('construct', targetType, [single]);
      }
      return coerceToType(single, targetType);
    }
    const nodes = items.map((it) => toNode(it));
    let allConst = true;
    const flatVals: number[] = [];
    let totalComps = 0;
    for (const nd of nodes) {
      totalComps += arityOf(nd._type);
      if (nd._op === 'const' && nd._val) {
        for (const v of nd._val) flatVals.push(v);
      } else {
        allConst = false;
      }
    }
    if (allConst && flatVals.length >= arity) {
      return new TSLNode('const', targetType, [], flatVals.slice(0, arity));
    }
    if (totalComps === arity) {
      return new TSLNode('construct', targetType, nodes);
    }
    // Normalize component count via scalar swizzles
    const exactArgs: TSLNode[] = [];
    for (const nd of nodes) {
      const a = arityOf(nd._type);
      for (let c = 0; c < a && exactArgs.length < arity; c++) {
        exactArgs.push(a === 1 ? nd : nd.swizzle('xyzw'[c]));
      }
    }
    while (exactArgs.length < arity) {
      exactArgs.push(
        new TSLNode('const', 'float', [], [exactArgs.length === 3 ? 1 : 0]),
      );
    }
    return new TSLNode('construct', targetType, exactArgs);
  };

  const posWorldBuiltin = makeBuiltin('positionWorld', 'vec3');

  const TSL = {
    float: (v: unknown = 0): TSLNode => coerceToType(v, 'float'),
    vec2: (...args: unknown[]): TSLNode => buildVec('vec2', args),
    vec3: (...args: unknown[]): TSLNode => buildVec('vec3', args),
    vec4: (...args: unknown[]): TSLNode => buildVec('vec4', args),
    color: (c: unknown = 0xffffff, g?: unknown, b?: unknown): TSLNode => {
      if (
        typeof c === 'number' &&
        typeof g === 'number' &&
        typeof b === 'number'
      ) {
        const col = new threeNs.Color(c, g, b);
        return new TSLNode(
          'const',
          'vec3',
          [],
          [fin(col.r, 1), fin(col.g, 1), fin(col.b, 1)],
        );
      }
      if (isNode(c)) return coerceToType(c, 'vec3');
      const col = new threeNs.Color(c as number);
      return new TSLNode(
        'const',
        'vec3',
        [],
        [fin(col.r, 1), fin(col.g, 1), fin(col.b, 1)],
      );
    },
    uniform: (initialValue: unknown = 0, rawName?: string): TSLNode => {
      const inferred = toNode(initialValue);
      let cleanName =
        typeof rawName === 'string' && rawName.trim().length > 0
          ? rawName
              .trim()
              .replace(/[^A-Za-z0-9_]/g, '_')
              .slice(0, 63)
          : `uParam_${autoUniformCounter++}`;
      if (/^[0-9]/.test(cleanName)) cleanName = '_' + cleanName.slice(0, 62);
      if (
        cleanName === '__proto__' ||
        cleanName === 'constructor' ||
        cleanName === 'prototype'
      ) {
        cleanName = `uParam_${autoUniformCounter++}`;
      }
      const uNode = new TSLNode(
        'uniform',
        inferred._type,
        [],
        undefined,
        cleanName,
      );
      uNode._uVal = initialValue;
      return uNode;
    },

    positionLocal: makeBuiltin('positionLocal', 'vec3'),
    positionWorld: posWorldBuiltin,
    normalLocal: makeBuiltin('normalLocal', 'vec3'),
    normalWorld: makeBuiltin('normalWorld', 'vec3'),
    viewDirection: makeBuiltin('viewDirection', 'vec3'),
    uv: makeBuiltin('uv', 'vec2'),
    vertexColor: makeBuiltin('vertexColor', 'vec4'),
    instanceIndex: makeBuiltin('instanceIndex', 'float'),
    time: makeBuiltin('time', 'float'),

    add: (a: unknown, b: unknown): TSLNode => toNode(a).add(b),
    sub: (a: unknown, b: unknown): TSLNode => toNode(a).sub(b),
    mul: (a: unknown, b: unknown): TSLNode => toNode(a).mul(b),
    div: (a: unknown, b: unknown): TSLNode => toNode(a).div(b),
    mod: (a: unknown, b: unknown): TSLNode => toNode(a).mod(b),
    neg: (a: unknown): TSLNode => toNode(a).neg(),
    abs: (a: unknown): TSLNode => toNode(a).abs(),
    sign: (a: unknown): TSLNode => toNode(a).sign(),
    floor: (a: unknown): TSLNode => toNode(a).floor(),
    ceil: (a: unknown): TSLNode => toNode(a).ceil(),
    fract: (a: unknown): TSLNode => toNode(a).fract(),
    sqrt: (a: unknown): TSLNode => toNode(a).sqrt(),
    pow: (a: unknown, b: unknown): TSLNode => toNode(a).pow(b),
    exp: (a: unknown): TSLNode => toNode(a).exp(),
    log: (a: unknown): TSLNode => toNode(a).log(),
    sin: (a: unknown): TSLNode => toNode(a).sin(),
    cos: (a: unknown): TSLNode => toNode(a).cos(),
    atan2: (y: unknown, x: unknown): TSLNode => toNode(y).atan2(x),
    min: (a: unknown, b: unknown): TSLNode => toNode(a).min(b),
    max: (a: unknown, b: unknown): TSLNode => toNode(a).max(b),
    clamp: (x: unknown, lo: unknown = 0, hi: unknown = 1): TSLNode =>
      toNode(x).clamp(lo, hi),
    saturate: (x: unknown): TSLNode => toNode(x).saturate(),
    oneMinus: (x: unknown): TSLNode => toNode(x).oneMinus(),
    mix: (a: unknown, b: unknown, t: unknown): TSLNode => toNode(a).mix(b, t),
    step: (edge: unknown, x: unknown): TSLNode => toNode(edge).step(x),
    smoothstep: (e0: unknown, e1: unknown, x: unknown): TSLNode =>
      toNode(e0).smoothstep(e1, x),
    dot: (a: unknown, b: unknown): TSLNode => toNode(a).dot(b),
    cross: (a: unknown, b: unknown): TSLNode => toNode(a).cross(b),
    length: (a: unknown): TSLNode => toNode(a).length(),
    distance: (a: unknown, b: unknown): TSLNode => toNode(a).distance(b),
    normalize: (a: unknown): TSLNode => toNode(a).normalize(),
    reflect: (inc: unknown, nrm: unknown): TSLNode => toNode(inc).reflect(nrm),
    remap: (
      x: unknown,
      inLo: unknown,
      inHi: unknown,
      outLo: unknown,
      outHi: unknown,
    ): TSLNode => toNode(x).remap(inLo, inHi, outLo, outHi),

    fresnel: (power: unknown = 2.0): TSLNode =>
      new TSLNode('fresnel', 'float', [coerceToType(power, 'float')]),
    simplexNoise2D: (p: unknown): TSLNode =>
      new TSLNode('simplexNoise2D', 'float', [coerceToType(p, 'vec2')]),
    simplexNoise3D: (p: unknown): TSLNode =>
      new TSLNode('simplexNoise3D', 'float', [coerceToType(p, 'vec3')]),
    voronoi2D: (p: unknown, jitter: unknown = 1.0): TSLNode =>
      new TSLNode('voronoi2D', 'float', [
        coerceToType(p, 'vec2'),
        coerceToType(jitter, 'float'),
      ]),
    checker: (p: unknown): TSLNode =>
      new TSLNode('checker', 'float', [coerceToType(p, 'vec2')]),
    triplanar: (
      scaleOrCoord: unknown = 1.0,
      sharpness: unknown = 4.0,
    ): TSLNode => {
      const sc = toNode(scaleOrCoord);
      const coord =
        sc._type === 'vec3'
          ? sc
          : posWorldBuiltin.mul(coerceToType(sc, 'float'));
      return new TSLNode('triplanar', 'float', [
        coord,
        coerceToType(sharpness, 'float'),
      ]);
    },
    hueShift: (rgb: unknown, angle: unknown): TSLNode =>
      new TSLNode('hueShift', 'vec3', [
        coerceToType(rgb, 'vec3'),
        coerceToType(angle, 'float'),
      ]),
    bumpFromHeight: (height: unknown, strength: unknown = 1.0): TSLNode =>
      new TSLNode('bumpFromHeight', 'vec3', [
        coerceToType(height, 'float'),
        coerceToType(strength, 'float'),
      ]),

    // Imperative loop constructs explicitly emit TL504 and degrade cleanly.
    Loop: (): TSLNode => {
      warnTsl('TL504', 'THREE.TSL.Loop', 'loop-free TSL constant');
      return new TSLNode('const', 'float', [], [0]);
    },
    While: (): TSLNode => {
      warnTsl('TL504', 'THREE.TSL.While', 'loop-free TSL constant');
      return new TSLNode('const', 'float', [], [0]);
    },
  };

  class MeshStandardNodeMaterial extends threeNs.MeshPhysicalMaterial {
    isMeshStandardNodeMaterial: boolean;
    colorNode: unknown;
    opacityNode: unknown;
    emissiveNode: unknown;
    roughnessNode: unknown;
    metalnessNode: unknown;
    normalScaleNode: unknown;
    bumpNode: unknown;
    positionNode: unknown;

    constructor(opts: Record<string, unknown> = {}) {
      super(opts);
      this.isMeshStandardNodeMaterial = true;
      this.colorNode = opts['colorNode'] ?? null;
      this.opacityNode = opts['opacityNode'] ?? null;
      this.emissiveNode = opts['emissiveNode'] ?? null;
      this.roughnessNode = opts['roughnessNode'] ?? null;
      this.metalnessNode = opts['metalnessNode'] ?? null;
      this.normalScaleNode = opts['normalScaleNode'] ?? null;
      this.bumpNode = opts['bumpNode'] ?? null;
      this.positionNode = opts['positionNode'] ?? null;
    }

    _serializeTslGraph(): TslMaterialGraph | null {
      const socketSpecs: Array<[string, unknown, TslType]> = [
        ['color', this.colorNode, 'vec3'],
        ['opacity', this.opacityNode, 'float'],
        ['emissive', this.emissiveNode, 'vec3'],
        ['roughness', this.roughnessNode, 'float'],
        ['metalness', this.metalnessNode, 'float'],
        ['normalScale', this.normalScaleNode, 'float'],
        ['bump', this.bumpNode, 'vec3'],
        ['position', this.positionNode, 'vec3'],
      ];

      const activeRoots: Array<[string, TSLNode]> = [];
      for (const [key, rawSocket, expectedType] of socketSpecs) {
        if (rawSocket !== null && rawSocket !== undefined) {
          activeRoots.push([key, coerceToType(rawSocket, expectedType)]);
        }
      }
      if (activeRoots.length === 0) return null;

      const ssaNodes: Array<{
        op: string;
        type: TslType;
        args?: number[];
        value?: number[];
        name?: string;
        mask?: string;
      }> = [];
      const uniforms: Record<
        string,
        {type: TslType; value: number | number[]}
      > = {};
      const cseMap = new Map<string, number>();
      const visiting = new Set<TSLNode>();
      let abortedCode = '';
      let abortedDetail = '';

      const emit = (node: TSLNode, inVertexStage: boolean): number => {
        if (abortedCode) return 0;
        if (!node || !node.isTSLNode) {
          abortedCode = 'TL501';
          abortedDetail = 'Invalid non-TSL node in material socket';
          return 0;
        }
        if (visiting.has(node)) {
          abortedCode = 'TL501';
          abortedDetail = 'Cyclic TSL node reference';
          return 0;
        }
        if (
          inVertexStage &&
          ((node._op === 'builtin' && node._name === 'viewDirection') ||
            node._op === 'fresnel' ||
            node._op === 'bumpFromHeight')
        ) {
          abortedCode = 'TL503';
          abortedDetail = `Fragment-only TSL op '${node._name || node._op}' used in positionNode`;
          return 0;
        }

        visiting.add(node);
        const argIndices: number[] = [];
        for (const child of node._args) {
          argIndices.push(emit(child, inVertexStage));
          if (abortedCode) {
            visiting.delete(node);
            return 0;
          }
        }
        visiting.delete(node);

        if (node._op === 'uniform') {
          const uName = node._name || 'uParam';
          if (uName in uniforms) {
            if (uniforms[uName].type !== node._type) {
              abortedCode = 'TL501';
              abortedDetail = `Conflicting types for TSL uniform '${uName}' (${uniforms[uName].type} vs ${node._type})`;
              return 0;
            }
          } else {
            if (Object.keys(uniforms).length >= MAX_UNIFORMS) {
              abortedCode = 'TL502';
              abortedDetail = `TSL material exceeds MAX_TSL_UNIFORMS (${MAX_UNIFORMS})`;
              return 0;
            }
            const coerced = coerceToType(node._uVal ?? 0, node._type);
            const rawVals = coerced._val ?? [0];
            uniforms[uName] = {
              type: node._type,
              value: node._type === 'float' ? rawVals[0] : rawVals,
            };
          }
        }

        const cseKey = `${node._op}|${node._type}|${argIndices.join(',')}|${node._val ? node._val.join(',') : ''}|${node._name ?? ''}|${node._mask ?? ''}`;
        const existing = cseMap.get(cseKey);
        if (existing !== undefined) return existing;

        if (ssaNodes.length >= MAX_NODES) {
          abortedCode = 'TL502';
          abortedDetail = `TSL material exceeds MAX_TSL_NODES (${MAX_NODES})`;
          return 0;
        }

        const idx = ssaNodes.length;
        const entry: {
          op: string;
          type: TslType;
          args?: number[];
          value?: number[];
          name?: string;
          mask?: string;
        } = {op: node._op, type: node._type};
        if (argIndices.length > 0) entry.args = argIndices;
        if (node._val) entry.value = [...node._val];
        if (node._name) entry.name = node._name;
        if (node._mask) entry.mask = node._mask;
        ssaNodes.push(entry);
        cseMap.set(cseKey, idx);
        return idx;
      };

      const outputs: Record<string, number> = {};
      for (const [key, rootNode] of activeRoots) {
        outputs[key] = emit(rootNode, key === 'position');
        if (abortedCode) {
          warnTsl(
            abortedCode,
            abortedDetail,
            'base MeshStandardMaterial factors',
          );
          return null;
        }
      }

      const result: {
        version: 1;
        uniforms?: Record<string, {type: TslType; value: number | number[]}>;
        nodes: typeof ssaNodes;
        outputs: Record<string, number>;
      } = {
        version: 1,
        nodes: ssaNodes,
        outputs,
      };
      if (Object.keys(uniforms).length > 0) {
        result.uniforms = uniforms;
      }
      return result as unknown as TslMaterialGraph;
    }

    clone(): MeshStandardNodeMaterial {
      const c = new MeshStandardNodeMaterial();
      c.name = this.name;
      c.color.copy(this.color);
      c._em = this._em;
      c.roughness = this.roughness;
      c.metalness = this.metalness;
      c.emissive.copy(this.emissive);
      c.emissiveIntensity = this.emissiveIntensity;
      c.opacity = this.opacity;
      c.transparent = this.transparent;
      c.wireframe = this.wireframe;
      c.side = this.side;
      c.doubleSided = this.doubleSided;
      c.map = this.map;
      c.normalMap = this.normalMap;
      c.normalScale.copy(this.normalScale);
      c.roughnessMap = this.roughnessMap;
      c.metalnessMap = this.metalnessMap;
      c.emissiveMap = this.emissiveMap;
      c.aoMap = this.aoMap;
      c.aoMapIntensity = this.aoMapIntensity;
      c.bumpMap = this.bumpMap;
      c.bumpScale = this.bumpScale;
      c.clearcoat = this.clearcoat;
      c.clearcoatRoughness = this.clearcoatRoughness;
      c.sheen = this.sheen;
      c.sheenColor.copy(this.sheenColor);
      c.sheenRoughness = this.sheenRoughness;
      c.ior = this.ior;
      c.transmission = this.transmission;
      c.thickness = this.thickness;
      c.attenuationColor.copy(this.attenuationColor);
      c.attenuationDistance = this.attenuationDistance;
      c.dispersion = this.dispersion;
      c.iridescence = this.iridescence;
      c.iridescenceIOR = this.iridescenceIOR;
      c.colorNode = this.colorNode;
      c.opacityNode = this.opacityNode;
      c.emissiveNode = this.emissiveNode;
      c.roughnessNode = this.roughnessNode;
      c.metalnessNode = this.metalnessNode;
      c.normalScaleNode = this.normalScaleNode;
      c.bumpNode = this.bumpNode;
      c.positionNode = this.positionNode;
      return c;
    }
  }

  const exportsMap = {
    TSL,
    TSLNode,
    MeshStandardNodeMaterial,
    MeshPhysicalNodeMaterial: MeshStandardNodeMaterial,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) {
      reg.authorNamespace = {};
    }
    Object.assign(reg.authorNamespace, exportsMap);
  }

  return exportsMap;
}
