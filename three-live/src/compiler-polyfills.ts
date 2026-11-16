/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Self-contained UTF-8 `TextEncoder` / `TextDecoder` polyfills
 * and `globalThis.__three_live_host__` v1 shims for bare JS realms (Boa,
 * QuickJS, JavaScriptCore) when host or native hooks are absent.
 */

/** Contract exposed on `globalThis.__three_live_host__` before sandbox hardening. */
export interface ThreeLiveHostContractV1 {
  readonly version: 1;
  now?(): number;
  log?(level: 'info' | 'warn' | 'error', message: string): void;
  charge?(units: number): void;
  texturePackLookup?(
    key: string,
    spec: {prompt: string; size: number; seed: number},
  ): Uint8Array | null | undefined;
  texturePackToken?(): number;
  evalScript?(wrappedSource: string): void;
  decodeImage?(
    bytes: Uint8Array,
  ): {width: number; height: number; rgba: Uint8Array} | null | undefined;
}

let internalHostGetter: (() => ThreeLiveHostContractV1 | undefined) | null =
  null;

/** Registers a closure-captured host getter once `installSandboxHardening` hides `__three_live_host__`. */
export function setInternalHostGetter(
  getter: () => ThreeLiveHostContractV1 | undefined,
): void {
  internalHostGetter = getter;
}

/** Returns the active host contract without exposing `__three_live_host__` on `globalThis`. */
export function getInternalHost(): ThreeLiveHostContractV1 | undefined {
  if (internalHostGetter) {
    return internalHostGetter();
  }
  // tslint:disable-next-line:no-any
  const h = (globalThis as Record<string, any>)['__three_live_host__'];
  return h && typeof h === 'object'
    ? (h as ThreeLiveHostContractV1)
    : undefined;
}

/** Pure-JS UTF-8 string -> `Uint8Array` encoder (surrogate-pair safe). */
export function pureJsUtf8Encode(str: string): Uint8Array {
  const s = String(str);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + (((c - 0xd800) << 10) | (c2 - 0xdc00));
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        i++;
      } else {
        out.push(0xef, 0xbf, 0xbd);
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd);
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/** Pure-JS UTF-8 `Uint8Array` -> string decoder (replaces malformed sequences with U+FFFD). */
export function pureJsUtf8Decode(input: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    input instanceof Uint8Array
      ? input
      : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
  let out = '';
  let i = 0;
  const n = bytes.byteLength;
  while (i < n) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i < n) {
      const b1 = bytes[i++];
      const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      out +=
        (b1 & 0xc0) === 0x80 && cp >= 0x80 ? String.fromCharCode(cp) : '\ufffd';
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < n) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      out +=
        (b1 & 0xc0) === 0x80 &&
        (b2 & 0xc0) === 0x80 &&
        cp >= 0x800 &&
        (cp < 0xd800 || cp > 0xdfff)
          ? String.fromCharCode(cp)
          : '\ufffd';
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < n) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const cp =
        ((b0 & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f);
      if (
        (b1 & 0xc0) === 0x80 &&
        (b2 & 0xc0) === 0x80 &&
        (b3 & 0xc0) === 0x80 &&
        cp >= 0x10000 &&
        cp <= 0x10ffff
      ) {
        const u = cp - 0x10000;
        out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      } else {
        out += '\ufffd';
      }
    } else {
      out += '\ufffd';
    }
  }
  return out;
}

/** Installs `TextEncoder`, `TextDecoder`, `performance.now`, and `console` shims if absent. */
export function installCompilerPolyfills(): void {
  // tslint:disable-next-line:no-any
  const g = globalThis as Record<string, any>;
  if (typeof g['TextEncoder'] === 'undefined') {
    g['TextEncoder'] = class TextEncoder {
      readonly encoding = 'utf-8';
      encode(str = ''): Uint8Array {
        const fn = g['__three_live_native_utf8_encode__'];
        return typeof fn === 'function'
          ? fn(String(str))
          : pureJsUtf8Encode(String(str));
      }
    };
  }
  if (typeof g['TextDecoder'] === 'undefined') {
    g['TextDecoder'] = class TextDecoder {
      readonly encoding = 'utf-8';
      decode(bytes?: ArrayBuffer | ArrayBufferView | null): string {
        if (bytes === undefined || bytes === null) return '';
        const fn = g['__three_live_native_utf8_decode__'];
        if (typeof fn === 'function') {
          const u8 =
            bytes instanceof Uint8Array
              ? bytes
              : ArrayBuffer.isView(bytes)
                ? new Uint8Array(
                    bytes.buffer,
                    bytes.byteOffset,
                    bytes.byteLength,
                  )
                : new Uint8Array(bytes);
          return fn(u8);
        }
        return pureJsUtf8Decode(bytes);
      }
    };
  }
  if (typeof g['performance'] === 'undefined') {
    g['performance'] = {
      now: (): number => {
        const hostNow = getInternalHost()?.now;
        return typeof hostNow === 'function' ? hostNow() : Date.now();
      },
    };
  }
  if (typeof g['console'] === 'undefined') {
    const emit =
      (level: 'info' | 'warn' | 'error') =>
      (...args: unknown[]) => {
        const hostLog = getInternalHost()?.log;
        if (typeof hostLog === 'function') {
          hostLog(level, args.map((a) => String(a)).join(' '));
        }
      };
    g['console'] = {
      log: emit('info'),
      info: emit('info'),
      warn: emit('warn'),
      error: emit('error'),
    };
  }
}

installCompilerPolyfills();
