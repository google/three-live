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

  const isNode = (v: unknown): v is TSLNode =>
    Boolean(v && (v as {isTSLNode?: unknown}).isTSLNode === true);

  const toNode = (v: unknown, preferredArity = 1): TSLNode => {
    if (isNode(v)) return v;
    if (typeof v === 'number' || typeof v === 'boolean') {
      const f = fin(Number(v), 0);
      return preferredArity > 1
        ? new TSLNode(
            'const',
            typeOfArity(preferredArity),
            [],
            new Array(preferredArity).fill(f),
          )
        : new TSLNode('const', 'float', [], [f]);
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
      if ('x' in obj && 'y' in obj) {
        if ('z' in obj && 'w' in obj) {
          return new TSLNode(
            'const',
            'vec4',
            [],
            [fin(obj['x']), fin(obj['y']), fin(obj['z']), fin(obj['w'], 1)],
          );
        }
        if ('z' in obj) {
          return new TSLNode(
            'const',
            'vec3',
            [],
            [fin(obj['x']), fin(obj['y']), fin(obj['z'])],
          );
        }
        return new TSLNode('const', 'vec2', [], [fin(obj['x']), fin(obj['y'])]);
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
      return n._op === 'const' && n._val
        ? new TSLNode(
            'const',
            targetType,
            [],
            new Array(tArity).fill(n._val[0]),
          )
        : new TSLNode('construct', targetType, [n]);
    }
    if (nArity > tArity) return n.swizzle('xyzw'.slice(0, tArity));
    const pad: TSLNode[] = [n];
    for (let k = nArity; k < tArity; k++) {
      pad.push(new TSLNode('const', 'float', [], [k === 3 ? 1 : 0]));
    }
    return new TSLNode('construct', targetType, pad);
  };

  class TSLNode {
    declare readonly isTSLNode: true;
    declare readonly _op: string;
    declare readonly _type: TslType;
    declare readonly _args: TSLNode[];
    declare readonly _val?: number[];
    declare readonly _name?: string;
    declare readonly _mask?: string;
    declare _uVal?: unknown;

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
      if (this._op === 'uniform') this._uVal = v;
    }

    swizzle(rawMask: string): TSLNode {
      const mapped = String(rawMask || 'x')
        .trim()
        .replace(/[rgba]/g, (c) => 'xyzw'['rgba'.indexOf(c)]);
      if (!/^[xyzw]{1,4}$/.test(mapped)) {
        warnTsl('TL501', `Invalid TSL swizzle '${rawMask}'`, '.x');
        return new TSLNode('const', 'float', [], [0]);
      }
      const srcArity = arityOf(this._type);
      if (srcArity === 1 && mapped === 'x') return this;
      for (let i = 0; i < mapped.length; i++) {
        if ('xyzw'.indexOf(mapped[i]) >= srcArity) {
          warnTsl('TL501', `TSL swizzle '.${rawMask}' out of range`, '0');
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
      if (nt._type !== 'float' && nt._type !== ty) nt = coerceToType(nt, ty);
      return new TSLNode('mix', ty, [na, nb, nt]);
    }
    step(x: unknown): TSLNode {
      const nx = toNode(x);
      return this._type === 'float'
        ? new TSLNode('step', nx._type, [this, nx])
        : new TSLNode('step', this._type, [this, coerceToType(nx, this._type)]);
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

    // Populated dynamically on TSLNode.prototype below
    // tslint:disable-next-line:no-any
    [key: string]: any;
  }

  // Install swizzle getters & fluent unary/binary operators compactly
  const proto = TSLNode.prototype;
  for (const [prop, mask] of [
    ['x', 'x'],
    ['y', 'y'],
    ['z', 'z'],
    ['w', 'w'],
    ['r', 'x'],
    ['g', 'y'],
    ['b', 'z'],
    ['a', 'w'],
    ['xy', 'xy'],
    ['xz', 'xz'],
    ['yz', 'yz'],
    ['xyz', 'xyz'],
    ['rgb', 'xyz'],
    ['xyzw', 'xyzw'],
    ['rgba', 'xyzw'],
  ] as const) {
    Object.defineProperty(proto, prop, {
      get(this: TSLNode) {
        return this.swizzle(mask);
      },
    });
  }
  const BIN_OPS = [
    'add',
    'sub',
    'mul',
    'div',
    'mod',
    'pow',
    'atan2',
    'min',
    'max',
  ] as const;
  for (const op of BIN_OPS) {
    proto[op] = function (this: TSLNode, b: unknown): TSLNode {
      const [na, nb, t] = broadcastPair(this, b);
      return new TSLNode(op, t, [na, nb]);
    };
  }
  const UN_OPS = [
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
  ] as const;
  for (const op of UN_OPS) {
    proto[op] = function (this: TSLNode): TSLNode {
      return new TSLNode(op, this._type, [this]);
    };
  }

  // Dual property + zero-arg callable builtin (`TSL.uv` AND `TSL.uv()`).
  // Explicitly redefine `.length` so `Function.length` (0) does not shadow
  // `TSLNode.prototype.length()`!
  const makeBuiltin = (name: string, type: TslType): TSLNode => {
    const base = new TSLNode('builtin', type, [], undefined, name);
    const callable = () => base;
    Object.setPrototypeOf(callable, proto);
    Object.defineProperty(callable, 'length', {
      value: proto.length,
      configurable: true,
    });
    Object.assign(callable, base);
    return callable as unknown as TSLNode;
  };

  const buildVec = (targetType: TslType, items: unknown[]): TSLNode => {
    const arity = arityOf(targetType);
    if (items.length === 0) {
      return new TSLNode('const', targetType, [], new Array(arity).fill(0));
    }
    if (items.length === 1) return coerceToType(items[0], targetType);
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

  // tslint:disable-next-line:no-any
  const TSL: Record<string, any> = {
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

    Loop: (): TSLNode => {
      warnTsl('TL504', 'THREE.TSL.Loop', 'loop-free TSL constant');
      return new TSLNode('const', 'float', [], [0]);
    },
    While: (): TSLNode => {
      warnTsl('TL504', 'THREE.TSL.While', 'loop-free TSL constant');
      return new TSLNode('const', 'float', [], [0]);
    },
  };
  for (const op of BIN_OPS) {
    TSL[op] = (a: unknown, b: unknown): TSLNode => toNode(a)[op](b);
  }
  for (const op of UN_OPS) {
    TSL[op] = (a: unknown): TSLNode => toNode(a)[op]();
  }

  class MeshStandardNodeMaterial extends threeNs.MeshPhysicalMaterial {
    declare isMeshStandardNodeMaterial: boolean;
    declare colorNode: unknown;
    declare private _opacityNode: unknown;
    declare emissiveNode: unknown;
    declare roughnessNode: unknown;
    declare metalnessNode: unknown;
    declare normalScaleNode: unknown;
    declare bumpNode: unknown;
    declare positionNode: unknown;

    get opacityNode(): unknown {
      return this._opacityNode;
    }

    set opacityNode(v: unknown) {
      this._opacityNode = v;
      if (
        v !== null &&
        v !== undefined &&
        !(Number((this as unknown as Record<string, unknown>)['alphaTest']) > 0)
      ) {
        (this as unknown as Record<string, unknown>)['transparent'] = true;
      }
    }

    constructor(opts: Record<string, unknown> = {}) {
      super(opts);
      this._opacityNode = null;
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
      } = {version: 1, nodes: ssaNodes, outputs};
      if (Object.keys(uniforms).length > 0) result.uniforms = uniforms;
      return result as unknown as TslMaterialGraph;
    }

    clone(): MeshStandardNodeMaterial {
      const c = new MeshStandardNodeMaterial();
      for (const k of [
        'name',
        '_em',
        'roughness',
        'metalness',
        'emissiveIntensity',
        'opacity',
        'transparent',
        'wireframe',
        'side',
        'doubleSided',
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'emissiveMap',
        'aoMap',
        'aoMapIntensity',
        'bumpMap',
        'bumpScale',
        'clearcoat',
        'clearcoatRoughness',
        'sheen',
        'sheenRoughness',
        'ior',
        'transmission',
        'thickness',
        'attenuationDistance',
        'dispersion',
        'iridescence',
        'iridescenceIOR',
        'colorNode',
        'opacityNode',
        'emissiveNode',
        'roughnessNode',
        'metalnessNode',
        'normalScaleNode',
        'bumpNode',
        'positionNode',
      ]) {
        // tslint:disable-next-line:no-any
        (c as any)[k] = (this as any)[k];
      }
      c.color.copy(this.color);
      c.emissive.copy(this.emissive);
      c.normalScale.copy(this.normalScale);
      c.sheenColor.copy(this.sheenColor);
      c.attenuationColor.copy(this.attenuationColor);
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
    if (!reg.authorNamespace) reg.authorNamespace = {};
    Object.assign(reg.authorNamespace, exportsMap);
  }

  return exportsMap;
}
