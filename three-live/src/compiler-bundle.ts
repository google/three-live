/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Standalone Hosted Compiler Bundle (`ThreeEngine`) for embedding
 * Three-Live scene compilation, USDZ transcoding, and AI scene-editing protocol
 * operations inside a host application's single JavaScript engine (Boa, QuickJS,
 * JavaScriptCore, V8) with optional `three_live_kernels` C-ABI accelerators.
 */

// 1. Install UTF-8 & host polyfills BEFORE importing `three-author`.
import {
  allocateHostedPackToken,
  executeAiProtocolCall,
  getHostedDefaultTexturePack,
  type HostedPackEntry,
  type HostedSceneEvalOutcome,
  type HostedTextureLookup,
} from './ai-protocol';
import {
  getInternalHost,
  installCompilerPolyfills,
  pureJsUtf8Decode,
  pureJsUtf8Encode,
  setInternalHostGetter,
  type ThreeLiveHostContractV1,
} from './compiler-polyfills';
import {installArchitectureKit} from './kits/architecture';
import {installElectronicsKit} from './kits/electronics';
import {installIndustrialKit} from './kits/industrial';
import {installMechanicalKit} from './kits/mechanical';
import {installScienceKit} from './kits/science';
import {getSharedRegistry} from './plugin';
import {
  DEFAULT_SELECT_CAMERA,
  type SelectRawEntry,
} from './plugins/ai-select-match';
import {installCadExtension} from './plugins/cad';
import {installIKExtension} from './plugins/ik';
import {installLodExtension} from './plugins/lod';
import {installProceduralExtension} from './plugins/procedural';
import THREE, {
  clearAuthorWarnings,
  PerspectiveCamera,
  glbToUSDZ as rawGlbToUSDZ,
  Scene,
} from './three-author';
import {
  type ConvertAnimOptions,
  sceneToCanvas3D,
  sceneToGLB,
  sceneToUSDZ,
} from './three-convert';
import {installTslExtension} from './tsl/author';
import {serializeTslToUsda} from './tsl/usdz';
import {registerSimTraitSchema} from './xr-sim-schema';
import {registerXRTraitSerializer} from './xr-trait-schema';

export * from './three-author';
export {
  installCompilerPolyfills,
  pureJsUtf8Decode,
  pureJsUtf8Encode,
  type ThreeLiveHostContractV1,
};

declare const SECURITY_3D_MAX_SCRIPT_BYTES: number;
declare const SECURITY_3D_MAX_HEAP_BYTES: number;

const MAX_SCRIPT_BYTES =
  typeof SECURITY_3D_MAX_SCRIPT_BYTES !== 'undefined'
    ? SECURITY_3D_MAX_SCRIPT_BYTES
    : 1048576;
const MAX_HEAP_BYTES =
  typeof SECURITY_3D_MAX_HEAP_BYTES !== 'undefined'
    ? SECURITY_3D_MAX_HEAP_BYTES
    : 16777216;
const MAX_SANDBOX_STRING_LEN = 4 * 1024 * 1024;

/** Supported `globalThis.__three_live_host__` contract version. */
export const HOST_CONTRACT_VERSION = 1;

installCompilerPolyfills();

const origJsonParse = JSON.parse;
const OrigTextEncoder = TextEncoder;

// Private reference to `Function` used strictly to parse-validate standalone
// `FunctionBody` syntax (never invoked to execute code), plus a separate
// execution reference cleared when `installSandboxHardening({disableSyncCompile: true})`
// is set.
const syntaxValidatorFn: FunctionConstructor = Function;
let capturedFunction: FunctionConstructor | null = Function;
let capturedHost: ThreeLiveHostContractV1 | undefined;
let inUserScriptExecution = false;
let sandboxHardened = false;

interface ScopedPackState {
  readonly pack: Map<string, HostedPackEntry> | null;
  readonly token: number;
  readonly lookupsOut: HostedTextureLookup[] | null;
  readonly seenKeys: Set<string>;
}

let scopedPackState: ScopedPackState | null = null;

// tslint:disable-next-line:no-any
const g = globalThis as Record<string, any>;

function getHost(): ThreeLiveHostContractV1 | undefined {
  return capturedHost ?? getInternalHost();
}

function ensureHostedAuthorGlobals(): void {
  if (typeof g['THREE'] === 'undefined') {
    g['THREE'] = THREE;
  }
  const reg = getSharedRegistry() as {
    tslUsdzSerializer?: unknown;
    canonicalTextureSpec?: (
      o: unknown,
    ) => {key: string; prompt: string; size: number; seed: number} | null;
    deriveTextureMaps?: (
      albedo: Uint8Array,
      size: number,
      normalStrength: number,
      roughness: number,
      metalness: number,
    ) => readonly [Uint8Array, Uint8Array];
  };

  if (typeof g['__three_live_reset_scene__'] !== 'function') {
    const sharedReg = getSharedRegistry();
    registerXRTraitSerializer();
    registerSimTraitSchema();
    installCadExtension(THREE, sharedReg);
    installMechanicalKit(THREE, sharedReg);
    installArchitectureKit(THREE, sharedReg);
    installIndustrialKit(THREE, sharedReg);
    installScienceKit(THREE, sharedReg);
    installElectronicsKit(THREE, sharedReg);
    installIKExtension(THREE, sharedReg);
    installLodExtension(THREE, sharedReg);
    installProceduralExtension(THREE, sharedReg);
    installTslExtension(THREE, sharedReg);
    sharedReg.tslUsdzSerializer = serializeTslToUsda;

    const resetFn = () => {
      clearAuthorWarnings();
      delete g['__three_live_sim_time_ms__'];
      delete g['__three_live_raf_cb__'];
      delete g['__three_live_in_step__'];
      delete g['__three_live_interactivity_fired__'];
      delete g['animate'];
      delete g['__three_live_animate_takes_dt__'];
      const cam = new PerspectiveCamera(45, 1, 0.1, 1000);
      cam.position.set(0, 2, 5);
      g['scene'] = new Scene();
      g['camera'] = cam;
    };
    resetFn();
    Object.defineProperty(g, '__three_live_reset_scene__', {
      value: resetFn,
      writable: false,
      configurable: false,
    });
  }

  // Install closure-backed texture-pack dispatchers that consult `scopedPackState`
  // or `capturedHost` without mutating `globalThis` properties during compilation,
  // while delegating to any pre-registered native Rust pack hook when unscoped.
  const origNativePack =
    typeof g['__three_live_native_texture_pack__'] === 'function'
      ? (g['__three_live_native_texture_pack__'] as (
          prompt: string,
          size: number,
          seed: number,
          ns: number,
          rough: number,
          metal: number,
        ) => Uint8Array[] | null)
      : null;
  const origNativePackToken =
    typeof g['__three_live_native_texture_pack_token__'] === 'function'
      ? (g['__three_live_native_texture_pack_token__'] as () => number)
      : null;

  g['__three_live_native_texture_pack_token__'] = (): number => {
    if (scopedPackState) {
      return scopedPackState.token;
    }
    if (origNativePackToken) {
      return Number(origNativePackToken()) || 0;
    }
    const hostTok = getHost()?.texturePackToken;
    return typeof hostTok === 'function' ? Number(hostTok()) || 0 : 0;
  };

  g['__three_live_native_texture_pack__'] = (
    prompt: string,
    size: number,
    seed: number,
    ns: number,
    rough: number,
    metal: number,
  ): Uint8Array[] | null => {
    if (scopedPackState) {
      const spec =
        typeof reg.canonicalTextureSpec === 'function'
          ? reg.canonicalTextureSpec({prompt, size, seed})
          : null;
      if (!spec) return null;
      const entry = scopedPackState.pack?.get(spec.key);
      let rgba: Uint8Array | null | undefined = entry?.rgba;
      if (!rgba) {
        const hostLookup = getHost()?.texturePackLookup;
        if (typeof hostLookup === 'function') {
          rgba = hostLookup(spec.key, {
            prompt: spec.prompt,
            size: spec.size,
            seed: spec.seed,
          });
        }
      }
      const hit =
        rgba instanceof Uint8Array && rgba.length === spec.size * spec.size * 4;
      if (
        scopedPackState.lookupsOut &&
        !scopedPackState.seenKeys.has(spec.key)
      ) {
        scopedPackState.seenKeys.add(spec.key);
        scopedPackState.lookupsOut.push({
          key: spec.key,
          spec: {prompt: spec.prompt, size: spec.size, seed: spec.seed},
          hit,
        });
      }
      if (hit && rgba && typeof reg.deriveTextureMaps === 'function') {
        const [normal, orm] = reg.deriveTextureMaps(
          rgba,
          spec.size,
          ns,
          rough,
          metal,
        );
        return [rgba, normal, orm];
      }
      return null;
    }
    if (origNativePack) {
      return origNativePack(prompt, size, seed, ns, rough, metal);
    }
    const hostLookup = getHost()?.texturePackLookup;
    if (
      typeof hostLookup === 'function' &&
      typeof reg.canonicalTextureSpec === 'function' &&
      typeof reg.deriveTextureMaps === 'function'
    ) {
      const spec = reg.canonicalTextureSpec({prompt, size, seed});
      if (!spec) return null;
      const rgba = hostLookup(spec.key, {
        prompt: spec.prompt,
        size: spec.size,
        seed: spec.seed,
      });
      if (
        rgba instanceof Uint8Array &&
        rgba.length === spec.size * spec.size * 4
      ) {
        const [normal, orm] = reg.deriveTextureMaps(
          rgba,
          spec.size,
          ns,
          rough,
          metal,
        );
        return [rgba, normal, orm];
      }
    }
    return null;
  };
}

ensureHostedAuthorGlobals();

function assertNotInUserScript(apiName: string): void {
  if (inUserScriptExecution) {
    throw new EvalError(
      `SecurityError: ${apiName} cannot be invoked from inside a scene script`,
    );
  }
}

function resetSceneInternal(): void {
  if (typeof g['__three_live_scrub_globals__'] === 'function') {
    g['__three_live_scrub_globals__']();
  } else if (typeof g['__three_live_reset_scene__'] === 'function') {
    g['__three_live_reset_scene__']();
  }
}

/** Resets `globalThis.scene`, `camera`, `animate`, and non-baseline globals. */
export function resetScene(): void {
  assertNotInUserScript('ThreeEngine.resetScene');
  resetSceneInternal();
}

/**
 * Fallback lexical bracket/string/comment balance check used only when a host
 * overrides `HostEnsureCanCompileStrings` to throw `EvalError` on `Function`.
 */
function assertLexicalBalance(src: string): void {
  const stack: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = i + 1 < n ? src[i + 1] : '';
    if (ch === '/' && next === '/') {
      i += 2;
      while (
        i < n &&
        src[i] !== '\n' &&
        src[i] !== '\r' &&
        src[i] !== '\u2028' &&
        src[i] !== '\u2029'
      ) {
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      let closed = false;
      while (i + 1 < n) {
        if (src[i] === '*' && src[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        throw new SyntaxError('Unterminated block comment in scene script');
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let closed = false;
      while (i < n) {
        const c = src[i++];
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '\n' || c === '\r') break;
        if (c === quote) {
          closed = true;
          break;
        }
      }
      if (!closed) {
        throw new SyntaxError('Unterminated string literal in scene script');
      }
      continue;
    }
    if (ch === '`') {
      i++;
      let closed = false;
      while (i < n) {
        const c = src[i++];
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '`') {
          closed = true;
          break;
        }
        if (c === '$' && i < n && src[i] === '{') {
          stack.push('`');
          i++;
          closed = true;
          break;
        }
      }
      if (!closed) {
        throw new SyntaxError('Unterminated template literal in scene script');
      }
      continue;
    }
    if (ch === '}' && stack.length > 0 && stack[stack.length - 1] === '`') {
      stack.pop();
      i++;
      let closed = false;
      while (i < n) {
        const c = src[i++];
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '`') {
          closed = true;
          break;
        }
        if (c === '$' && i < n && src[i] === '{') {
          stack.push('`');
          i++;
          closed = true;
          break;
        }
      }
      if (!closed) {
        throw new SyntaxError('Unterminated template literal in scene script');
      }
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ')' || ch === ']') {
      const expected = ch === '}' ? '{' : ch === ')' ? '(' : '[';
      if (stack.length === 0 || stack.pop() !== expected) {
        throw new SyntaxError(
          `Unexpected closing token '${ch}' in scene script`,
        );
      }
    }
    i++;
  }
  if (stack.length > 0) {
    throw new SyntaxError('Unterminated block or bracket in scene script');
  }
}

function validateStandaloneScriptSyntax(src: string): void {
  try {
    // Parses `src` as an ECMAScript `FunctionBody` without executing a single
    // instruction, rejecting any unmatched `}` / `)` wrapper-breakout attempt.
    // tslint:disable-next-line:ban
    syntaxValidatorFn(src);
  } catch (e) {
    if (e instanceof EvalError) {
      assertLexicalBalance(src);
      return;
    }
    throw e;
  }
}

/**
 * Validates script byte length + standalone syntax and wraps `script` in an
 * isolated IIFE scope that captures `scene`, `camera`, and `animate` onto `globalThis`.
 *
 * Budgeted hosts (such as Boa's `Script::evaluate_async_with_budget`) can
 * evaluate the returned source at top level so instruction/time budgets cover
 * nested helper calls, then call `serializeCurrentSceneToGLB()` or
 * `serializeCurrentSceneToUSDZ()`.
 */
export function wrapIsolatedScript(script: string): string {
  assertNotInUserScript('ThreeEngine.wrapIsolatedScript');
  const src = String(script ?? '');
  const byteLen = new OrigTextEncoder().encode(src).byteLength;
  if (byteLen > MAX_SCRIPT_BYTES) {
    throw new Error(
      `Script length (${byteLen} bytes) exceeds SECURITY_3D_MAX_SCRIPT_BYTES (${MAX_SCRIPT_BYTES})`,
    );
  }
  getHost()?.charge?.(byteLen);
  validateStandaloneScriptSyntax(src);
  const lower = src.toLowerCase();
  const takesDt =
    lower.includes('function animate(dt') ||
    lower.includes('function animate(delta') ||
    lower.includes('function animate(step') ||
    lower.includes('animate = (dt') ||
    lower.includes('animate = function(dt');
  return (
    '(function(){\n' +
    src +
    '\n;\n' +
    "if (typeof scene === 'object' && scene !== null && Array.isArray(scene.children)) { globalThis.scene = scene; }\n" +
    "if (typeof camera === 'object' && camera !== null && camera.position) { globalThis.camera = camera; }\n" +
    `if (typeof animate === 'function') { globalThis.animate = animate; globalThis.__three_live_animate_takes_dt__ = ${takesDt}; }\n` +
    '})()'
  );
}

function evaluateWrappedScriptInternal(wrapped: string): void {
  const hostEval = getHost()?.evalScript;
  if (typeof hostEval === 'function') {
    hostEval(wrapped);
    return;
  }
  if (!capturedFunction) {
    throw new EvalError(
      'Dynamic code evaluation is disabled in the Three-Live sandbox; evaluate ThreeEngine.wrapIsolatedScript() via budgeted host runner or provide __three_live_host__.evalScript',
    );
  }
  const fn = capturedFunction(wrapped);
  fn();
}

function serializeSceneToGLBInternal(options?: ConvertAnimOptions): Uint8Array {
  const activeScene: Scene =
    g['scene'] && Array.isArray(g['scene'].children)
      ? (g['scene'] as Scene)
      : new Scene();
  return sceneToGLB(activeScene, {
    ...options,
    bakeAnimations: options?.bakeAnimations ?? false,
  });
}

function serializeSceneToUSDZInternal(
  options?: ConvertAnimOptions,
): Uint8Array {
  const activeScene: Scene =
    g['scene'] && Array.isArray(g['scene'].children)
      ? (g['scene'] as Scene)
      : new Scene();
  return sceneToUSDZ(activeScene, options);
}

/** Serializes the currently populated `globalThis.scene` to a binary GLB `Uint8Array`. */
export function serializeCurrentSceneToGLB(
  options?: ConvertAnimOptions,
): Uint8Array {
  assertNotInUserScript('ThreeEngine.serializeCurrentSceneToGLB');
  inUserScriptExecution = true;
  try {
    return serializeSceneToGLBInternal(options);
  } finally {
    inUserScriptExecution = false;
  }
}

/** Serializes the currently populated `globalThis.scene` to a 64-byte aligned USDZ `Uint8Array`. */
export function serializeCurrentSceneToUSDZ(
  options?: ConvertAnimOptions,
): Uint8Array {
  assertNotInUserScript('ThreeEngine.serializeCurrentSceneToUSDZ');
  inUserScriptExecution = true;
  try {
    return serializeSceneToUSDZInternal(options);
  } finally {
    inUserScriptExecution = false;
  }
}

function withScopedHostedPack<T>(
  pack: Map<string, HostedPackEntry> | null,
  token: number,
  lookupsOut: HostedTextureLookup[] | null,
  fn: () => T,
): T {
  if (!pack && !lookupsOut) {
    return fn();
  }
  const prevState = scopedPackState;
  scopedPackState = {
    pack,
    token,
    lookupsOut,
    seenKeys: new Set<string>(),
  };
  try {
    return fn();
  } finally {
    scopedPackState = prevState;
  }
}

/** Compiles a Three-Live JS script into a binary glTF 2.0 (`.glb`) `Uint8Array`. */
export function compileToGLB(
  script: string,
  options?: ConvertAnimOptions,
): Uint8Array {
  assertNotInUserScript('ThreeEngine.compileToGLB');
  resetSceneInternal();
  const {pack, token} = getHostedDefaultTexturePack();
  try {
    return withScopedHostedPack(pack, token, null, () => {
      const wrapped = wrapIsolatedScript(script);
      inUserScriptExecution = true;
      try {
        evaluateWrappedScriptInternal(wrapped);
        return serializeSceneToGLBInternal(options);
      } finally {
        inUserScriptExecution = false;
      }
    });
  } finally {
    try {
      resetSceneInternal();
    } catch {}
  }
}

/** Compiles a Three-Live JS script into an Apple 64-byte aligned `.usdz` `Uint8Array`. */
export function compileToUSDZ(
  script: string,
  options?: ConvertAnimOptions,
): Uint8Array {
  assertNotInUserScript('ThreeEngine.compileToUSDZ');
  resetSceneInternal();
  const {pack, token} = getHostedDefaultTexturePack();
  try {
    return withScopedHostedPack(pack, token, null, () => {
      const wrapped = wrapIsolatedScript(script);
      inUserScriptExecution = true;
      try {
        evaluateWrappedScriptInternal(wrapped);
        return serializeSceneToUSDZInternal(options);
      } finally {
        inUserScriptExecution = false;
      }
    });
  } finally {
    try {
      resetSceneInternal();
    } catch {}
  }
}

/** Transcodes a binary `.glb` buffer into an Apple 64-byte aligned `.usdz` `Uint8Array`. */
export function compileGlbToUSDZ(
  glbBytes: Uint8Array | ArrayBuffer,
): Uint8Array {
  assertNotInUserScript('ThreeEngine.glbToUSDZ');
  const len = glbBytes.byteLength;
  if (len > MAX_HEAP_BYTES) {
    throw new Error(
      `GLB input size (${len} bytes) exceeds SECURITY_3D_MAX_HEAP_BYTES (${MAX_HEAP_BYTES})`,
    );
  }
  const u8 =
    glbBytes instanceof Uint8Array ? glbBytes : new Uint8Array(glbBytes);
  return rawGlbToUSDZ(u8);
}

function runHostedSceneEval(
  code: string,
  overridePack?: Map<string, HostedPackEntry> | null,
  overrideToken?: number,
): HostedSceneEvalOutcome {
  resetSceneInternal();
  const def = getHostedDefaultTexturePack();
  const activePack = overridePack !== undefined ? overridePack : def.pack;
  const activeToken =
    overrideToken !== undefined
      ? overrideToken
      : activePack
        ? allocateHostedPackToken()
        : def.token;
  const lookups: HostedTextureLookup[] = [];
  try {
    return withScopedHostedPack(activePack, activeToken, lookups, () => {
      const wrapped = wrapIsolatedScript(code);
      inUserScriptExecution = true;
      try {
        evaluateWrappedScriptInternal(wrapped);
        const activeScene = g['scene'] as Scene;
        activeScene?.updateMatrixWorld?.(true);
        const c3d = sceneToCanvas3D(activeScene, {bakeAnimations: false});
        const rawExtract =
          typeof g['__three_live_extract_scene_raw__'] === 'function'
            ? g['__three_live_extract_scene_raw__']()
            : null;

        const warnings: string[] = [];
        const codedWarnings: string[] = [];
        if (rawExtract && typeof rawExtract.diagnostics_json === 'string') {
          try {
            const diags = origJsonParse(rawExtract.diagnostics_json) as Array<{
              code?: string;
              severity?: string;
              message?: string;
            }>;
            for (const d of diags) {
              if (d.severity === 'error') {
                return {
                  ok: false,
                  error: d.code
                    ? `[${d.code}] ${d.message}`
                    : String(d.message),
                  warnings: [],
                  codedWarnings: [],
                  meshNames: [],
                  nonEmptyNames: [],
                  meshCount: 0,
                  hasUnnamedXr: false,
                  selectEntries: [],
                  camera: null,
                  textureLookups: lookups,
                  textureMeshes: {},
                };
              }
              if (d.severity === 'warning' && d.message) {
                warnings.push(d.message);
                codedWarnings.push(
                  d.code && !d.message.startsWith('[')
                    ? `[${d.code}] ${d.message}`
                    : d.message,
                );
              }
            }
          } catch {}
        }

        const gltfNodes = Array.isArray(c3d.gltf?.nodes) ? c3d.gltf.nodes : [];
        const meshNames = gltfNodes.map((n: {name?: string}) =>
          typeof n?.name === 'string' ? n.name : '',
        );
        const nonEmptyNames = meshNames.filter((n: string) => n.length > 0);
        const meshCount = gltfNodes.filter(
          (n: {mesh?: number}) => typeof n?.mesh === 'number',
        ).length;

        // Collect unnamed XR / interactivity check + textureMeshes + selectEntries
        let hasUnnamedXr = false;
        const textureMeshes: Record<string, string[]> = {};
        const selectEntries: SelectRawEntry[] = [];
        const reg = getSharedRegistry() as {
          canonicalTextureSpec?: (
            o: unknown,
          ) => {key: string; prompt: string; size: number; seed: number} | null;
        };

        const visitStack: Array<{node: unknown; parentVisible: boolean}> =
          Array.isArray(activeScene?.children)
            ? [...activeScene.children]
                .reverse()
                .map((child) => ({node: child, parentVisible: true}))
            : [];
        const visited = new Set<object>([activeScene]);
        let fallbackMeshIdx = 0;
        while (visitStack.length > 0) {
          const item = visitStack.pop()!;
          const cur = item.node;
          if (!cur || typeof cur !== 'object' || visited.has(cur)) continue;
          visited.add(cur);
          // tslint:disable-next-line:no-any
          const obj = cur as Record<string, any>;
          const rawName = typeof obj['name'] === 'string' ? obj['name'] : '';
          const isVisible = item.parentVisible && obj['visible'] !== false;
          const xr = obj['userData']?.['xr'];
          const inter = obj['userData']?.['interactivity'];
          if (
            !rawName.trim() &&
            ((xr && typeof xr === 'object' && Object.keys(xr).length > 0) ||
              (inter &&
                typeof inter === 'object' &&
                Object.keys(inter).length > 0))
          ) {
            hasUnnamedXr = true;
          }
          if (xr?.material && typeof reg.canonicalTextureSpec === 'function') {
            const spec = reg.canonicalTextureSpec(xr.material);
            if (spec) {
              if (!textureMeshes[spec.key]) textureMeshes[spec.key] = [];
              textureMeshes[spec.key].push(rawName);
            }
          }
          const hasPositions = obj['geometry']?.attributes?.position?.count > 0;
          const curMeshIdx = hasPositions ? fallbackMeshIdx++ : -1;
          if (isVisible && hasPositions) {
            const entryName = rawName || `Mesh_${curMeshIdx}`;
            const posAttr = obj['geometry'].attributes.position;
            const cnt = posAttr.count as number;
            const me: ArrayLike<number> | undefined =
              obj['matrixWorld']?.elements;
            const lo: [number, number, number] = [Infinity, Infinity, Infinity];
            const hi: [number, number, number] = [
              -Infinity,
              -Infinity,
              -Infinity,
            ];
            for (let i = 0; i < cnt; i++) {
              const lx = Number(posAttr.getX(i)) || 0;
              const ly = Number(posAttr.getY(i)) || 0;
              const lz = Number(posAttr.getZ(i)) || 0;
              const wx = me
                ? me[0] * lx + me[4] * ly + me[8] * lz + me[12]
                : lx;
              const wy = me
                ? me[1] * lx + me[5] * ly + me[9] * lz + me[13]
                : ly;
              const wz = me
                ? me[2] * lx + me[6] * ly + me[10] * lz + me[14]
                : lz;
              if (wx < lo[0]) lo[0] = wx;
              if (wx > hi[0]) hi[0] = wx;
              if (wy < lo[1]) lo[1] = wy;
              if (wy > hi[1]) hi[1] = wy;
              if (wz < lo[2]) lo[2] = wz;
              if (wz > hi[2]) hi[2] = wz;
            }
            if (Number.isFinite(lo[0])) {
              const rawMat = Array.isArray(obj['material'])
                ? obj['material'][0]
                : obj['material'];
              const c = rawMat?.color;
              const color: [number, number, number] | null =
                c && typeof c.r === 'number'
                  ? [Number(c.r) || 0, Number(c.g) || 0, Number(c.b) || 0]
                  : null;
              selectEntries.push({name: entryName, min: lo, max: hi, color});
            }
          }
          if (Array.isArray(obj['children'])) {
            for (let i = obj['children'].length - 1; i >= 0; i--) {
              visitStack.push({
                node: obj['children'][i],
                parentVisible: isVisible,
              });
            }
          }
        }

        const cam = rawExtract?.camera;
        const selectCam =
          cam && Array.isArray(cam.position) && Array.isArray(cam.target)
            ? {
                eye: [
                  Number(cam.position[0]) || 0,
                  Number(cam.position[1]) || 0,
                  Number(cam.position[2]) || 0,
                ] as [number, number, number],
                target: [
                  Number(cam.target[0]) || 0,
                  Number(cam.target[1]) || 0,
                  Number(cam.target[2]) || 0,
                ] as [number, number, number],
              }
            : DEFAULT_SELECT_CAMERA;

        return {
          ok: true,
          warnings,
          codedWarnings,
          meshNames,
          nonEmptyNames,
          meshCount,
          hasUnnamedXr,
          selectEntries,
          camera: selectCam,
          textureLookups: lookups,
          textureMeshes,
        };
      } finally {
        inUserScriptExecution = false;
      }
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      warnings: [],
      codedWarnings: [],
      meshNames: [],
      nonEmptyNames: [],
      meshCount: 0,
      hasUnnamedXr: false,
      selectEntries: [],
      camera: null,
      textureLookups: lookups,
      textureMeshes: {},
    };
  } finally {
    try {
      resetSceneInternal();
    } catch {}
  }
}

/** Executes one synchronous JSON AI scene-editing / selection / texture / voice op. */
export function aiCall(requestJson: string): string {
  assertNotInUserScript('ThreeEngine.aiCall');
  return executeAiProtocolCall(String(requestJson ?? ''), runHostedSceneEval);
}

/** Options for `installSandboxHardening()`. */
export interface SandboxHardeningOptions {
  /**
   * When `true`, drops the private `Function` fallback so user scripts can ONLY
   * be evaluated via `globalThis.__three_live_host__.evalScript` or external
   * budgeted evaluation of `ThreeEngine.wrapIsolatedScript(script)`.
   * Recommended for Boa embedders using `Script::evaluate_async_with_budget`.
   */
  disableSyncCompile?: boolean;
}

/**
 * Locks down dynamic code evaluation (`eval`, `Function`, generator/async
 * `.prototype.constructor` back-references), hides `__three_live_host__` behind
 * private closure state, caps `String.prototype.repeat` / `padStart` / `padEnd`
 * to 4M characters, freezes built-in, registry, and `THREE` prototypes, locks
 * baseline globals + native hooks, and installs `__three_live_scrub_globals__`.
 *
 * Call once after loading the bundle and binding any `__three_live_native_*__`
 * kernels on the realm, before evaluating untrusted user scripts.
 */
export function installSandboxHardening(
  options?: SandboxHardeningOptions,
): void {
  assertNotInUserScript('ThreeEngine.installSandboxHardening');
  if (options?.disableSyncCompile) {
    capturedFunction = null;
  }
  if (sandboxHardened) return;
  sandboxHardened = true;
  const origFunction = syntaxValidatorFn;

  // 1. Capture `globalThis.__three_live_host__` into private closure state and
  //    permanently hide/lock `globalThis.__three_live_host__` from user scripts.
  const initialHost = getInternalHost();
  if (initialHost && typeof initialHost === 'object') {
    capturedHost = Object.freeze({...initialHost});
  }
  setInternalHostGetter(() => capturedHost);
  try {
    delete g['__three_live_host__'];
  } catch {}
  try {
    Object.defineProperty(g, '__three_live_host__', {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch {}

  // tslint:disable-next-line:no-any
  const freezeObjAndProto = (obj: any): void => {
    if (!obj) return;
    try {
      Object.freeze(obj);
    } catch {}
    if (obj.prototype) {
      try {
        Object.freeze(obj.prototype);
      } catch {}
    }
  };

  const blockDynamicCode = () => {
    throw new EvalError(
      'Dynamic code evaluation is disabled in the Three-Live sandbox',
    );
  };
  const dynamicCodeProtos: object[] = [];
  const collectProto = (sample: unknown) => {
    try {
      const proto = Object.getPrototypeOf(sample);
      if (proto) dynamicCodeProtos.push(proto);
    } catch {}
  };
  collectProto(() => {});
  try {
    collectProto(function* () {});
  } catch {}
  try {
    collectProto(async () => {});
  } catch {}
  try {
    collectProto(async function* () {});
  } catch {}
  for (const proto of dynamicCodeProtos) {
    try {
      Object.defineProperty(proto, 'constructor', {
        value: blockDynamicCode,
        writable: false,
        configurable: false,
      });
    } catch {}
  }
  for (const name of ['eval', 'Function']) {
    try {
      Object.defineProperty(g, name, {
        value: blockDynamicCode,
        writable: false,
        configurable: false,
      });
    } catch {}
  }

  // 2. Coerce arguments ONCE before calling original string methods so stateful
  //    `valueOf()` / `toString()` objects cannot bypass the 4M-char cap on the second read.
  const origRepeat = String.prototype.repeat;
  const origPadStart = String.prototype.padStart;
  const origPadEnd = String.prototype.padEnd;
  Object.defineProperty(String.prototype, 'repeat', {
    value(this: string, count: number) {
      if (this === null || this === undefined) {
        throw new TypeError(
          'String.prototype.repeat called on null or undefined',
        );
      }
      const str = String(this);
      const rawCount = Number(count);
      if (rawCount < 0 || rawCount === Infinity) {
        throw new RangeError('Invalid count value');
      }
      const n = Number.isNaN(rawCount) ? 0 : Math.floor(rawCount);
      if (n > 0 && str.length * n > MAX_SANDBOX_STRING_LEN) {
        throw new RangeError(
          'SecurityError: String.prototype.repeat exceeds sandbox string limit',
        );
      }
      return origRepeat.call(str, n);
    },
    writable: false,
    configurable: false,
  });
  Object.defineProperty(String.prototype, 'padStart', {
    value(this: string, targetLength: number, padString?: string) {
      if (this === null || this === undefined) {
        throw new TypeError(
          'String.prototype.padStart called on null or undefined',
        );
      }
      const str = String(this);
      const rawLen = Number(targetLength);
      const len = Number.isNaN(rawLen) ? 0 : Math.trunc(rawLen);
      if (len > MAX_SANDBOX_STRING_LEN) {
        throw new RangeError(
          'SecurityError: String.prototype.padStart exceeds sandbox string limit',
        );
      }
      const pad = padString === undefined ? undefined : String(padString);
      return origPadStart.call(str, len, pad);
    },
    writable: false,
    configurable: false,
  });
  Object.defineProperty(String.prototype, 'padEnd', {
    value(this: string, targetLength: number, padString?: string) {
      if (this === null || this === undefined) {
        throw new TypeError(
          'String.prototype.padEnd called on null or undefined',
        );
      }
      const str = String(this);
      const rawLen = Number(targetLength);
      const len = Number.isNaN(rawLen) ? 0 : Math.trunc(rawLen);
      if (len > MAX_SANDBOX_STRING_LEN) {
        throw new RangeError(
          'SecurityError: String.prototype.padEnd exceeds sandbox string limit',
        );
      }
      const pad = padString === undefined ? undefined : String(padString);
      return origPadEnd.call(str, len, pad);
    },
    writable: false,
    configurable: false,
  });

  // 3. Freeze built-in constructors, prototypes, `%TypedArray%`, and iterators,
  //    and lock baseline global bindings so user scripts cannot shadow `JSON`,
  //    `TextEncoder`, `Uint8Array`, etc.
  const typedArrayBase = Object.getPrototypeOf(Uint8Array);
  const typedArrayProto = Object.getPrototypeOf(Uint8Array.prototype);
  [
    Object,
    Array,
    origFunction,
    blockDynamicCode,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Error,
    TypeError,
    RangeError,
    EvalError,
    SyntaxError,
    ReferenceError,
    URIError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    ArrayBuffer,
    DataView,
    typedArrayBase,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    Math,
    JSON,
    Reflect,
    Proxy,
    g['TextEncoder'],
    g['TextDecoder'],
    g['console'],
    g['performance'],
  ].forEach(freezeObjAndProto);

  for (const extraProto of [
    typedArrayProto,
    ...dynamicCodeProtos,
    (() => {
      try {
        return Object.getPrototypeOf([][Symbol.iterator]());
      } catch {
        return null;
      }
    })(),
    (() => {
      try {
        return Object.getPrototypeOf(''[Symbol.iterator]());
      } catch {
        return null;
      }
    })(),
    (() => {
      try {
        return Object.getPrototypeOf(new Map()[Symbol.iterator]());
      } catch {
        return null;
      }
    })(),
    (() => {
      try {
        return Object.getPrototypeOf(new Set()[Symbol.iterator]());
      } catch {
        return null;
      }
    })(),
  ]) {
    if (extraProto) {
      try {
        Object.freeze(extraProto);
      } catch {}
    }
  }

  const lockedGlobals = [
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'RegExp',
    'Date',
    'Error',
    'TypeError',
    'RangeError',
    'EvalError',
    'SyntaxError',
    'ReferenceError',
    'URIError',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Promise',
    'ArrayBuffer',
    'DataView',
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array',
    'Math',
    'JSON',
    'Reflect',
    'Proxy',
    'TextEncoder',
    'TextDecoder',
    'console',
    'performance',
  ];
  for (const globalName of lockedGlobals) {
    if (g[globalName] !== undefined) {
      try {
        Object.defineProperty(g, globalName, {
          value: g[globalName],
          writable: false,
          configurable: false,
        });
      } catch {}
    }
  }

  // 4. Freeze `THREE`, shared plugin registry (`tslUsdzSerializer`, `plugins`),
  //    and lock `globalThis.__THREE_LIVE_REGISTRY__` to prevent USDA injection or
  //    cross-compile hook persistence.
  const sharedRegistry = getSharedRegistry();
  if (typeof g['THREE'] === 'object' && g['THREE'] !== null) {
    for (const key of Object.keys(g['THREE'])) {
      freezeObjAndProto(g['THREE'][key]);
    }
    const authNs = sharedRegistry.authorNamespace;
    if (authNs && typeof authNs === 'object') {
      for (const key of Object.keys(authNs)) {
        freezeObjAndProto((authNs as Record<string, unknown>)[key]);
      }
      try {
        Object.freeze(authNs);
      } catch {}
    }
    try {
      Object.freeze(g['THREE']);
    } catch {}
    try {
      Object.defineProperty(g, 'THREE', {
        value: g['THREE'],
        writable: false,
        configurable: false,
      });
    } catch {}
  }

  try {
    if (sharedRegistry.plugins) {
      Object.freeze(sharedRegistry.plugins);
    }
    Object.freeze(sharedRegistry);
    Object.defineProperty(g, '__THREE_LIVE_REGISTRY__', {
      value: sharedRegistry,
      writable: false,
      configurable: false,
    });
  } catch {}

  if (typeof g['document'] === 'object' && g['document'] !== null) {
    try {
      if (g['document'].body?.style) Object.freeze(g['document'].body.style);
      if (g['document'].body) Object.freeze(g['document'].body);
      if (g['document'].documentElement) {
        Object.freeze(g['document'].documentElement);
      }
      Object.freeze(g['document']);
      Object.defineProperty(g, 'document', {
        value: g['document'],
        writable: false,
        configurable: false,
      });
    } catch {}
  }

  if (
    typeof g['window'] === 'object' &&
    g['window'] !== null &&
    g['window'] !== g
  ) {
    try {
      Object.freeze(g['window']);
      Object.defineProperty(g, 'window', {
        value: g['window'],
        writable: false,
        configurable: false,
      });
    } catch {}
  }

  // 5. Lock EVERY native hook slot (even when `undefined`) so user scripts
  //    cannot inject forged JS hooks into unbound accelerator slots.
  const nativeHooks = [
    '__three_live_native_crc32__',
    '__three_live_native_build_usdz_zip__',
    '__three_live_native_format_usda_points__',
    '__three_live_native_format_usda_uvs__',
    '__three_live_native_format_usda_ints__',
    '__three_live_native_utf8_encode__',
    '__three_live_native_utf8_decode__',
    '__three_live_native_encode_rgba_png__',
    '__three_live_native_compress_png_uri__',
    '__three_live_native_decode_b64_image__',
    '__three_live_native_decode_png__',
    '__three_live_native_stash_glb__',
    '__three_live_native_stash_usdz__',
    '__three_live_native_torus_knot__',
    '__three_live_native_sphere__',
    '__three_live_native_cylinder__',
    '__three_live_native_box__',
    '__three_live_native_plane__',
    '__three_live_native_torus__',
    '__three_live_native_csg_boolean__',
    '__three_live_native_f32_array__',
    '__three_live_native_index_array__',
    '__three_live_native_compute_vertex_normals__',
    '__three_live_native_material_preset__',
    '__three_live_native_derive_texture_maps__',
    '__three_live_native_seam_blend__',
    '__three_live_native_texture_pack__',
    '__three_live_native_texture_pack_token__',
    '__three_live_extract_scene_raw__',
  ];
  for (const hookName of nativeHooks) {
    const fn = typeof g[hookName] === 'function' ? g[hookName] : undefined;
    try {
      Object.defineProperty(g, hookName, {
        value: fn,
        writable: false,
        configurable: false,
      });
    } catch {}
  }

  if (typeof g['ThreeEngine'] === 'object' && g['ThreeEngine'] !== null) {
    try {
      Object.freeze(g['ThreeEngine']);
      Object.defineProperty(g, 'ThreeEngine', {
        value: g['ThreeEngine'],
        writable: false,
        configurable: false,
      });
    } catch {}
  }

  const innerReset = g['__three_live_reset_scene__'];
  if (typeof innerReset === 'function') innerReset();
  const baselineKeys = new Set<PropertyKey>(Reflect.ownKeys(g));

  const scrubGlobals = () => {
    assertNotInUserScript('__three_live_scrub_globals__');
    if (typeof innerReset === 'function') innerReset();
    for (const key of Reflect.ownKeys(g)) {
      if (!baselineKeys.has(key)) {
        try {
          delete g[key];
        } catch {}
        if (Object.prototype.hasOwnProperty.call(g, key)) {
          try {
            g[key] = undefined;
          } catch {}
        }
      }
    }
  };

  Object.defineProperty(g, '__three_live_scrub_globals__', {
    value: scrubGlobals,
    writable: false,
    configurable: false,
  });
}

export {compileGlbToUSDZ as glbToUSDZ};
// tslint:disable-next-line:no-default-export
export default THREE;
