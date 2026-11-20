/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getSharedRegistry} from './plugin';

/** Canonical capability names shared across Web, Android, and iOS. */
export type ThreeLiveCapabilityName =
  | 'scripts'
  | 'network'
  | 'remote_content'
  | 'camera'
  | 'microphone'
  | 'sensors'
  | 'storage'
  | 'ai'
  | 'external_handoff';

/** Network scheme and optional origin allowlist configuration. */
export interface ThreeLiveNetworkPolicy {
  readonly enabled: boolean;
  readonly schemes: ReadonlySet<string>;
  readonly explicitSchemes: boolean;
  readonly origins: ReadonlySet<string> | null;
}

/** Normalized capability policy evaluated at each sensitive access point. */
export interface ThreeLiveCapabilities {
  readonly scripts: boolean;
  readonly network: ThreeLiveNetworkPolicy;
  readonly remoteContent: boolean;
  readonly camera: boolean;
  readonly microphone: boolean;
  readonly sensors: boolean;
  readonly storage: boolean;
  readonly ai: boolean;
  readonly externalHandoff: boolean;
}

/** Flexible input accepted by `el.capabilities` and `ThreeLiveElement.defaultCapabilities`. */
export interface ThreeLiveCapabilitiesInit {
  readonly scripts?: boolean;
  readonly network?:
    | boolean
    | {
        readonly enabled?: boolean;
        readonly schemes?: Iterable<string>;
        readonly explicitSchemes?: boolean;
        readonly origins?: Iterable<string> | null;
      };
  readonly remoteContent?: boolean;
  readonly remote_content?: boolean;
  readonly camera?: boolean;
  readonly microphone?: boolean;
  readonly sensors?: boolean;
  readonly storage?: boolean;
  readonly ai?: boolean;
  readonly externalHandoff?: boolean;
  readonly external_handoff?: boolean;
}

/** Non-nullable input accepted by {@link parseCapabilities} and `el.capabilities`. */
export type ThreeLiveCapabilitiesInput =
  | string
  | ThreeLiveCapabilities
  | ThreeLiveCapabilitiesInit;

/** Payload delivered to `three-capability-denied` events and `onCapabilityDenied` callbacks. */
export interface CapabilityDeniedDetail {
  readonly capability: ThreeLiveCapabilityName;
  readonly feature: string;
  readonly message: string;
  readonly url?: string;
}

type BoolCapKey = Exclude<keyof ThreeLiveCapabilities, 'network'>;

const DEFAULT_SCHEMES: ReadonlySet<string> = new Set(['https', 'wss']);
const NON_NET_RE = /^(?:data|blob|asset|content|file|android\.resource):/i;
const LOOPBACK_RE = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i;
const BOOL_KEYS: readonly BoolCapKey[] = [
  'scripts',
  'remoteContent',
  'camera',
  'microphone',
  'sensors',
  'storage',
  'ai',
  'externalHandoff',
];
const WIRE_TO_KEY: Readonly<Record<string, BoolCapKey>> = {
  scripts: 'scripts',
  remote_content: 'remoteContent',
  camera: 'camera',
  microphone: 'microphone',
  sensors: 'sensors',
  storage: 'storage',
  ai: 'ai',
  external_handoff: 'externalHandoff',
};

/** Normalizes an origin string to `scheme://host[:port]`. */
export function normalizeCapabilityOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const s = u.protocol.slice(0, -1).toLowerCase();
    if (!s || !u.hostname) return null;
    const p =
      ((s === 'https' || s === 'wss') && u.port === '443') ||
      ((s === 'http' || s === 'ws') && u.port === '80')
        ? ''
        : u.port;
    return `${s}://${u.hostname.toLowerCase()}${p ? ':' + p : ''}`;
  } catch {
    return null;
  }
}

/** Sanitizes a URL for diagnostics by stripping credentials, query strings, and hashes. */
export function sanitizeDiagnosticUrl(raw: string): string {
  const full = raw.trim().slice(0, 8192);
  if (NON_NET_RE.test(full)) {
    return `${full.slice(0, full.indexOf(':') + 1)}<local>`;
  }
  const basePart = full.split(/[?#]/)[0];
  const baseHref =
    (typeof location !== 'undefined' && location.href) || 'https://localhost/';
  for (const candidate of [full, basePart]) {
    try {
      const u = new URL(candidate, baseHref);
      u.username = u.password = u.search = u.hash = '';
      return u.href.slice(0, 256);
    } catch {
      // Fall through to credential-stripping fallback.
    }
  }
  return basePart
    .replace(/\/\/[^/@\s]*@/, '//')
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]*/i, '$1')
    .slice(0, 128);
}

function makeNet(
  enabled: boolean,
  schemes: ReadonlySet<string> = DEFAULT_SCHEMES,
  explicitSchemes = false,
  origins: ReadonlySet<string> | null = null,
): ThreeLiveNetworkPolicy {
  return Object.freeze({enabled, schemes, explicitSchemes, origins});
}

/** Default secure policy: all capabilities disabled. */
export const CAPABILITIES_NONE: ThreeLiveCapabilities = Object.freeze({
  scripts: false,
  network: makeNet(false),
  remoteContent: false,
  camera: false,
  microphone: false,
  sensors: false,
  storage: false,
  ai: false,
  externalHandoff: false,
});

/** Preset for static `.glb` / `.usdz` viewing and 1-tap AR (`viewer`). */
export const CAPABILITIES_VIEWER: ThreeLiveCapabilities = Object.freeze({
  ...CAPABILITIES_NONE,
  network: makeNet(true),
  remoteContent: true,
  camera: true,
  externalHandoff: true,
});

/** Preset enabling all capabilities (`all`), intended for trusted demos and playgrounds. */
export const CAPABILITIES_ALL: ThreeLiveCapabilities = Object.freeze({
  scripts: true,
  network: makeNet(true),
  remoteContent: true,
  camera: true,
  microphone: true,
  sensors: true,
  storage: true,
  ai: true,
  externalHandoff: true,
});

/** Parses an attribute string or init object into a normalized {@link ThreeLiveCapabilities}. */
export function parseCapabilities(
  input: ThreeLiveCapabilitiesInput | null | undefined,
  base: ThreeLiveCapabilities = CAPABILITIES_NONE,
): ThreeLiveCapabilities {
  if (input == null) return base;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return CAPABILITIES_NONE;
    const flags: Record<BoolCapKey, boolean> = {
      scripts: base.scripts,
      remoteContent: base.remoteContent,
      camera: base.camera,
      microphone: base.microphone,
      sensors: base.sensors,
      storage: base.storage,
      ai: base.ai,
      externalHandoff: base.externalHandoff,
    };
    let netOn = base.network.enabled;
    let schemes = new Set(base.network.schemes);
    let explicit = base.network.explicitSchemes;
    let origins = base.network.origins ? new Set(base.network.origins) : null;
    let originsSpecified = false;

    for (const raw of trimmed.split(/\s+/)) {
      if (!raw) continue;
      const neg = raw.length > 1 && raw[0] === '-';
      const tok = neg ? raw.slice(1) : raw;
      const val = !neg;
      const [head, originPart = ''] = tok.split('@');
      const [rawName, schemePart = ''] = head.toLowerCase().split(':');
      const name = rawName.replace(/-/g, '_');
      if (name === 'none' && val) {
        for (const k of BOOL_KEYS) flags[k] = false;
        netOn = explicit = false;
        schemes = new Set(DEFAULT_SCHEMES);
        origins = null;
        originsSpecified = false;
      } else if (name === 'all' || name === '*') {
        for (const k of BOOL_KEYS) flags[k] = val;
        netOn = val;
        explicit = false;
        schemes = new Set(DEFAULT_SCHEMES);
        origins = null;
        originsSpecified = false;
      } else if (name === 'viewer') {
        netOn =
          flags.remoteContent =
          flags.camera =
          flags.externalHandoff =
            val;
      } else if (name === 'network') {
        netOn = val;
        if (val && schemePart) {
          const list = schemePart
            .split(/[|,]/)
            .map((s) => s.trim().replace(/:$/, ''))
            .filter(Boolean);
          if (list.length) {
            schemes = new Set(list);
            explicit = true;
          }
        } else if (val && !originPart) {
          schemes = new Set(DEFAULT_SCHEMES);
          explicit = false;
          origins = null;
          originsSpecified = false;
        }
        if (val && originPart) {
          if (!originsSpecified) {
            origins = new Set();
            originsSpecified = true;
          }
          origins ??= new Set();
          for (const o of originPart.split(/[|,]/)) {
            const norm = normalizeCapabilityOrigin(o);
            if (norm) origins.add(norm);
          }
        }
      } else if (name in WIRE_TO_KEY) {
        flags[WIRE_TO_KEY[name]] = val;
      }
    }
    return {
      ...flags,
      network: makeNet(netOn, schemes, explicit, origins),
    };
  }

  const init = input as ThreeLiveCapabilitiesInit;
  let network = base.network;
  if (typeof init.network === 'boolean') {
    network = makeNet(init.network);
  } else if (init.network && typeof init.network === 'object') {
    const n = init.network;
    const hasS = n.schemes != null;
    const schemes = hasS
      ? new Set(
          Array.from(n.schemes!, (s) =>
            s.trim().replace(/:$/, '').toLowerCase(),
          ).filter(Boolean),
        )
      : new Set(base.network.schemes);
    let origins = base.network.origins;
    if (n.origins === null) {
      origins = null;
    } else if (n.origins !== undefined) {
      const set = new Set<string>();
      for (const o of n.origins) {
        const norm = normalizeCapabilityOrigin(o);
        if (norm) set.add(norm);
      }
      origins = set;
    }
    network = makeNet(
      n.enabled ?? true,
      schemes,
      n.explicitSchemes ?? hasS,
      origins,
    );
  }
  return {
    scripts: init.scripts ?? base.scripts,
    network,
    remoteContent:
      init.remoteContent ?? init.remote_content ?? base.remoteContent,
    camera: init.camera ?? base.camera,
    microphone: init.microphone ?? base.microphone,
    sensors: init.sensors ?? base.sensors,
    storage: init.storage ?? base.storage,
    ai: init.ai ?? base.ai,
    externalHandoff:
      init.externalHandoff ?? init.external_handoff ?? base.externalHandoff,
  };
}

/** Returns true when `url` uses a non-network scheme (`data:`, `blob:`, `file:`, etc.). */
export function isNonNetworkUrl(url: string): boolean {
  return NON_NET_RE.test(url.trim());
}

/**
 * Returns true when `raw` is a clean relative path (no scheme, protocol-relative
 * `//`, `..`, `\`, `%`, or whitespace) that resolves to the document's own
 * origin. Opaque-origin hosts (`location.origin === 'null'`) always return
 * false. Used for host-authored attributes such as `poster`, where a
 * same-origin fetch cannot exfiltrate data to a third party.
 */
export function isSameOriginRelativeUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url || /[\x00-\x20\\%]/.test(url)) return false;
  if (url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  if (url.split(/[/?#]/).includes('..')) return false;
  const origin = typeof location !== 'undefined' ? location.origin : '';
  if (!origin || origin === 'null') return false;
  try {
    const base =
      (typeof document !== 'undefined' && document.baseURI) || location.href;
    return new URL(url, base).origin === origin;
  } catch {
    return false;
  }
}

/** Checks whether `caps.network` permits connecting to `rawUrl`. */
export function isNetworkUrlPermitted(
  caps: ThreeLiveCapabilities,
  rawUrl?: string,
): boolean {
  if (!caps.network.enabled) return false;
  if (!rawUrl) return true;
  const t = rawUrl.trim();
  if (!t) return false;
  if (isNonNetworkUrl(t)) return true;
  try {
    const base =
      (typeof document !== 'undefined' && document.baseURI) ||
      (typeof location !== 'undefined' && location.href) ||
      'https://localhost/';
    const u = new URL(t, base);
    const s = u.protocol.slice(0, -1).toLowerCase();
    if (isNonNetworkUrl(`${s}:`)) return true;
    const loopback =
      (s === 'http' || s === 'ws') && LOOPBACK_RE.test(u.hostname);
    if (
      !caps.network.schemes.has(s) &&
      (caps.network.explicitSchemes || !loopback)
    ) {
      return false;
    }
    if (caps.network.origins !== null) {
      const origin = normalizeCapabilityOrigin(u.href);
      if (!origin || !caps.network.origins.has(origin)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Evaluates whether `caps` grants `capability` (and optional `url`). */
export function hasCapabilityInPolicy(
  caps: ThreeLiveCapabilities,
  capability: ThreeLiveCapabilityName,
  url?: string,
): boolean {
  if (capability === 'network') return isNetworkUrlPermitted(caps, url);
  if (capability === 'remote_content') {
    return Boolean(
      (url && isNonNetworkUrl(url)) ||
        (caps.remoteContent && isNetworkUrlPermitted(caps, url)),
    );
  }
  if (capability === 'ai') return caps.ai && isNetworkUrlPermitted(caps, url);
  return caps[WIRE_TO_KEY[capability]];
}

interface CapabilityHostLike {
  __tlEl?: boolean;
  capabilities?: ThreeLiveCapabilitiesInput | null;
  allowClientScripts?: boolean;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  dispatchEvent?: (event: Event) => boolean;
  fireEvent?: (type: string, detail?: unknown) => void;
  onCapabilityDenied?: ((detail: CapabilityDeniedDetail) => void) | null;
  __tlCapsOverride?: ThreeLiveCapabilities | null;
  __tlCapsInit?: ThreeLiveCapabilitiesInit | null;
}

const deniedDedup = new WeakMap<object, Set<string>>();

/** Clears deduplicated denial records for `host`. */
export function resetCapabilityDenials(host?: object | null): void {
  if (host) deniedDedup.delete(host);
}

/** Resolves the effective {@link ThreeLiveCapabilities} for `host` (or global default). */
export function resolveHostCapabilities(host?: unknown): ThreeLiveCapabilities {
  const reg = getSharedRegistry();
  let base = reg.defaultCapabilities ?? CAPABILITIES_NONE;
  if (reg.allowClientScripts && !base.scripts) base = {...base, scripts: true};
  if (!host || typeof host !== 'object') return base;
  const h = host as CapabilityHostLike;
  const allowAttr =
    typeof h.hasAttribute === 'function' &&
    h.hasAttribute('allow-client-scripts') &&
    h.getAttribute?.('allow-client-scripts') !== 'false';
  const allowScripts =
    allowAttr || (!h.__tlEl && h.allowClientScripts === true);
  const effectiveBase =
    allowScripts && !base.scripts ? {...base, scripts: true} : base;
  const capAttr =
    typeof h.getAttribute === 'function'
      ? h.getAttribute('capabilities')
      : null;
  if (h.__tlCapsInit) {
    return parseCapabilities(h.__tlCapsInit, effectiveBase);
  }
  if (h.__tlCapsOverride) return h.__tlCapsOverride;
  if (
    !h.__tlEl &&
    h.capabilities !== undefined &&
    typeof h.capabilities !== 'function'
  ) {
    return parseCapabilities(h.capabilities, effectiveBase);
  }
  return capAttr !== null
    ? parseCapabilities(capAttr, effectiveBase)
    : effectiveBase;
}

function reportDenial(
  host: unknown,
  capability: ThreeLiveCapabilityName,
  feature: string,
  url?: string,
  dedup = false,
): void {
  const safeUrl = url ? sanitizeDiagnosticUrl(url) : undefined;
  if (dedup && host && typeof host === 'object') {
    let seen = deniedDedup.get(host);
    if (!seen) deniedDedup.set(host, (seen = new Set()));
    const key = `${capability}:${feature}:${safeUrl ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
  }
  const message =
    `[Three-Live] Capability '${capability}' denied for ${feature}` +
    (safeUrl ? ` (${safeUrl})` : '') +
    `. Grant '${capability}' in capabilities to enable.`;
  const detail: CapabilityDeniedDetail = safeUrl
    ? {capability, feature, message, url: safeUrl}
    : {capability, feature, message};
  console?.warn?.(message);
  getSharedRegistry().onCapabilityDenied?.(detail);
  if (host && typeof host === 'object') {
    const h = host as CapabilityHostLike;
    h.onCapabilityDenied?.(detail);
    if (typeof h.fireEvent === 'function') {
      h.fireEvent('three-capability-denied', detail);
    } else if (
      typeof h.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {
      h.dispatchEvent(
        new CustomEvent('three-capability-denied', {
          bubbles: true,
          composed: true,
          detail,
        }),
      );
    }
  }
}

/**
 * Checks `capability` at a sensitive point of access. Logs a diagnostic,
 * dispatches `capability-denied`, and returns `false` without throwing.
 */
export function checkHostCapability(
  host: unknown,
  capability: ThreeLiveCapabilityName,
  feature: string,
  options?: {readonly url?: string; readonly dedup?: boolean},
): boolean {
  const caps = resolveHostCapabilities(host);
  const url = options?.url;
  const dedup = options?.dedup ?? false;
  if (capability === 'remote_content') {
    if (url && isNonNetworkUrl(url)) return true;
    if (!caps.remoteContent) {
      reportDenial(host, 'remote_content', feature, url, dedup);
      return false;
    }
    if (!isNetworkUrlPermitted(caps, url)) {
      reportDenial(host, 'network', feature, url, dedup);
      return false;
    }
    return true;
  }
  if (capability === 'ai') {
    if (!caps.ai) {
      reportDenial(host, 'ai', feature, url, dedup);
      return false;
    }
    if (!isNetworkUrlPermitted(caps, url)) {
      reportDenial(host, 'network', feature, url, dedup);
      return false;
    }
    return true;
  }
  if (!hasCapabilityInPolicy(caps, capability, url)) {
    reportDenial(host, capability, feature, url, dedup);
    return false;
  }
  return true;
}

/** Installs {@link checkHostCapability} onto the shared plugin registry. */
export function ensureCapabilityChecker(): void {
  const reg = getSharedRegistry();
  reg.checkCapability = checkHostCapability;
  reg.hasCapability = (host, capability, url) =>
    hasCapabilityInPolicy(resolveHostCapabilities(host), capability, url);
}

ensureCapabilityChecker();
