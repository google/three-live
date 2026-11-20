/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview End-to-end capability security tests for `<three-live>` and
 * `ThreeView` covering all 9 canonical capabilities, presets, scheme/origin
 * allowlists, diagnostic URL sanitization, 60 Hz deduplication, and fail-closed
 * runtime enforcement.
 */

import {
  CAPABILITIES_ALL,
  CAPABILITIES_NONE,
  CAPABILITIES_VIEWER,
  CapabilityDeniedDetail,
  checkHostCapability,
  ensureCapabilityChecker,
  hasCapabilityInPolicy,
  normalizeCapabilityOrigin,
  parseCapabilities,
  resetCapabilityDenials,
  resolveHostCapabilities,
  sanitizeDiagnosticUrl,
} from '../src/capabilities';
import * as ThreeLiveIndex from '../src/index';
import {getSharedRegistry} from '../src/plugin';
import {aiPlugin, editScene} from '../src/plugins/ai';
import {compileFromImage} from '../src/plugins/ai-image';
import {generateTextures} from '../src/plugins/ai-texture';
import {connectVoice, selectByVoice} from '../src/plugins/ai-voice';
import {environmentMapPlugin} from '../src/plugins/envmap';
import {ThreeLiveElement} from '../src/three-live-element';
import {ThreeView} from '../src/three-view';
import {activateAR, launchQuickLook, launchSceneViewer} from '../src/three-xr';

ensureCapabilityChecker();
ThreeView.registerPlugin(environmentMapPlugin);
ThreeView.registerPlugin(aiPlugin);

/** Headless canvas with a no-op WebGL2 context (mirrors three_view_test.ts). */
function makeMockCanvas(): HTMLCanvasElement {
  return {
    width: 400,
    height: 400,
    clientWidth: 400,
    clientHeight: 400,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 400}),
    getContext: () =>
      new Proxy(
        {
          canvas: {width: 400, height: 400},
          getShaderParameter: () => true,
          getProgramParameter: () => true,
          getAttribLocation: () => 0,
        },
        {
          get(target: Record<string, unknown>, prop: string) {
            if (prop in target) return target[prop];
            return () => ({});
          },
        },
      ),
  } as unknown as HTMLCanvasElement;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

async function runCapabilitiesTests(): Promise<void> {
  console.log('🔐 Running Three-Live Capability Security Tests...\n');

  // 1. Default secure-by-default policy (`CAPABILITIES_NONE`)
  ThreeLiveElement.defaultCapabilities = CAPABILITIES_NONE;
  ThreeLiveElement.allowClientScripts = false;
  getSharedRegistry().onCapabilityDenied = null;

  assert(
    ThreeLiveElement.observedAttributes.includes('capabilities'),
    'ThreeLiveElement observes capabilities attribute',
  );
  for (const cap of [
    'scripts',
    'network',
    'remote_content',
    'camera',
    'microphone',
    'sensors',
    'storage',
    'ai',
    'external_handoff',
  ] as const) {
    assert(
      !hasCapabilityInPolicy(
        CAPABILITIES_NONE,
        cap,
        'https://cdn.example.com/a.glb',
      ),
      `CAPABILITIES_NONE denies '${cap}' by default`,
    );
    assert(
      hasCapabilityInPolicy(
        CAPABILITIES_ALL,
        cap,
        'https://cdn.example.com/a.glb',
      ),
      `CAPABILITIES_ALL grants '${cap}'`,
    );
  }

  // 2. Presets, negation, and scheme/origin allowlists
  const viewer = parseCapabilities('viewer');
  assert(!viewer.scripts, 'viewer preset leaves scripts disabled');
  assert(
    viewer.network.enabled &&
      viewer.remoteContent &&
      viewer.camera &&
      viewer.externalHandoff,
    'viewer preset enables network, remote_content, camera, external_handoff',
  );
  assert(
    !viewer.microphone && !viewer.sensors && !viewer.storage && !viewer.ai,
    'viewer preset leaves microphone, sensors, storage, ai disabled',
  );

  const scoped = parseCapabilities(
    'all -ai -microphone network:https@https://cdn.example.com:443/models',
  );
  assert(
    scoped.scripts && !scoped.ai && !scoped.microphone,
    'negation (-cap) overrides all',
  );
  assert(
    hasCapabilityInPolicy(
      scoped,
      'network',
      'https://cdn.example.com/scene.glb',
    ),
    'origin-scoped network allows matching origin and scheme',
  );
  assert(
    !hasCapabilityInPolicy(scoped, 'network', 'wss://cdn.example.com/live'),
    'explicit scheme allowlist blocks unlisted wss:// scheme',
  );
  assert(
    !hasCapabilityInPolicy(
      scoped,
      'network',
      'https://evil.example.com/scene.glb',
    ),
    'origin allowlist blocks unlisted origin',
  );
  assert(
    !hasCapabilityInPolicy(
      scoped,
      'network',
      'http://localhost:8080/scene.glb',
    ),
    'explicit scheme allowlist disables implicit loopback http:// exception',
  );
  assert(
    normalizeCapabilityOrigin('HTTPS://CDN.EXAMPLE.COM:443/a/b?x=1') ===
      'https://cdn.example.com',
    'normalizeCapabilityOrigin strips default ports, paths, and lowercases host',
  );

  // 3. Diagnostic URL sanitization & 60 Hz frame-loop deduplication
  assert(
    sanitizeDiagnosticUrl(
      'https://alice:super-secret@API.EXAMPLE.COM:8443/v1/live?key=AIzaSy123#token=xyz',
    ) === 'https://api.example.com:8443/v1/live',
    'sanitizeDiagnosticUrl strips credentials, query strings, and fragments',
  );
  assert(
    !sanitizeDiagnosticUrl(
      'https://alice:super-secret@[bad-ipv6]/v1?key=123',
    ).includes('super-secret'),
    'sanitizeDiagnosticUrl strips credentials even when URL parsing falls back',
  );
  assert(
    sanitizeDiagnosticUrl('data:model/gltf-binary;base64,AAAA') ===
      'data:<local>',
    'sanitizeDiagnosticUrl redacts local data: payloads',
  );

  const dedupHost: {
    capabilities: string;
    onCapabilityDenied?: (d: CapabilityDeniedDetail) => void;
    dispatchEvent: (e: Event) => boolean;
  } = {
    capabilities: 'none',
    dispatchEvent: () => true,
  };
  const dedupEvents: CapabilityDeniedDetail[] = [];
  dedupHost.onCapabilityDenied = (d) => dedupEvents.push(d);
  for (let i = 0; i < 10; i++) {
    checkHostCapability(dedupHost, 'sensors', 'handTracking', {dedup: true});
  }
  assert(
    dedupEvents.length === 1,
    'dedup suppresses repeated frame-loop denials',
  );
  resetCapabilityDenials(dedupHost);
  checkHostCapability(dedupHost, 'sensors', 'handTracking', {dedup: true});
  assert(
    dedupEvents.length === 2,
    'resetCapabilityDenials re-arms denial reporting',
  );

  // 4. `<three-live>` element attribute/property reflection & backward-compatible `allow-client-scripts`
  class TestThreeLiveElement extends ThreeLiveElement {
    private readonly attrs = new Map<string, string>();
    readonly dispatched: Event[] = [];
    override getAttribute(name: string): string | null {
      return this.attrs.get(name) ?? null;
    }
    override setAttribute(name: string, value: string): void {
      const old = this.getAttribute(name);
      this.attrs.set(name, value);
      this.attributeChangedCallback(name, old, value);
    }
    override removeAttribute(name: string): void {
      const old = this.getAttribute(name);
      this.attrs.delete(name);
      this.attributeChangedCallback(name, old, null);
    }
    override hasAttribute(name: string): boolean {
      return this.attrs.has(name);
    }
    override dispatchEvent(event: Event): boolean {
      this.dispatched.push(event);
      return true;
    }
  }

  const el = new TestThreeLiveElement();
  const elementDenials: CapabilityDeniedDetail[] = [];
  el.onCapabilityDenied = (d) => elementDenials.push(d);
  assert(
    !el.hasCapability('scripts'),
    'ThreeLiveElement defaults to scripts=false',
  );
  el.setAttribute('allow-client-scripts', '');
  assert(
    el.hasCapability('scripts') && !el.hasCapability('network'),
    'legacy allow-client-scripts enables scripts without enabling sensitive capabilities',
  );
  el.removeAttribute('allow-client-scripts');
  el.capabilities = CAPABILITIES_VIEWER;
  assert(
    el.hasCapability('remote_content', 'https://cdn.example.com/a.glb') &&
      !el.hasCapability('scripts'),
    'el.capabilities setter applies CAPABILITIES_VIEWER without recursion',
  );
  el.capabilities = null;
  assert(
    resolveHostCapabilities(el).remoteContent === false,
    'clearing el.capabilities restores defaultCapabilities',
  );

  // `executeScript` refused when scripts=false, succeeds with sandbox runner when scripts=true
  let runnerInvocations = 0;
  ThreeLiveElement.registerScriptRunner({
    execute: async (_script, _mode, callbacks) => {
      runnerInvocations++;
      // `onModelReady` is the real ScriptExecutionCallbacks hook; calling a
      // nonexistent callback left executeScript() pending forever, which
      // silently ended this test file before the assertions below ran.
      callbacks.onModelReady({
        gltf: {asset: {version: '2.0'}, meshes: []},
        bin: new ArrayBuffer(0),
      } as never);
      return undefined;
    },
  });
  let scriptRefused = false;
  try {
    await el.executeScript('scene.add(new THREE.Mesh());');
  } catch {
    scriptRefused = true;
  }
  assert(
    scriptRefused &&
      runnerInvocations === 0 &&
      elementDenials.some((d) => d.capability === 'scripts'),
    'executeScript refuses execution and emits scripts denial when scripts=false',
  );

  el.capabilities = 'scripts';
  await el.executeScript(
    'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()));',
  );
  assert(
    runnerInvocations === 1,
    'executeScript invokes registered sandbox runner when capabilities="scripts"',
  );

  // 5. Remote content & external glTF image URI gating (`remote_content` + `network`)
  let fetchCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCount++;
    throw new Error('unexpected network fetch');
  }) as typeof fetch;
  try {
    const viewHost = {
      capabilities: 'scripts',
      denied: [] as CapabilityDeniedDetail[],
      onCapabilityDenied(d: CapabilityDeniedDetail) {
        this.denied.push(d);
      },
    };
    const view = new ThreeView(
      viewHost as unknown as HTMLElement,
      makeMockCanvas(),
    );
    // Remote `.glb` URLs are fetched by the element (ThreeView only accepts
    // bytes), so gate them there.
    const remoteEl = new TestThreeLiveElement();
    remoteEl.capabilities = 'scripts';
    const remoteDenied: CapabilityDeniedDetail[] = [];
    remoteEl.onCapabilityDenied = (d) => remoteDenied.push(d);
    (remoteEl as unknown as {viewer: unknown}).viewer = {loadGLBData() {}};
    let loadFailed = false;
    try {
      await remoteEl.loadModel('https://cdn.example.com/model.glb?sig=SECRET');
    } catch {
      loadFailed = true;
    }
    assert(
      loadFailed &&
        fetchCount === 0 &&
        remoteDenied.some(
          (d) =>
            d.capability === 'remote_content' && !d.url?.includes('SECRET'),
        ),
      'loadModel blocks remote .glb before fetch and sanitizes diagnostic URL',
    );

    // Inline data: URI is local/non-network and does not require `remote_content`,
    // EXCEPT if the embedded glTF JSON references an external `images[].uri`!
    let imageSrcAssigned = false;
    const origImage = (globalThis as {Image?: unknown}).Image;
    (globalThis as {Image?: unknown}).Image = class FakeImage {
      set src(_v: string) {
        imageSrcAssigned = true;
      }
    };
    try {
      const gltfJson = JSON.stringify({
        asset: {version: '2.0'},
        scenes: [{nodes: [0]}],
        nodes: [{name: 'Box'}],
        images: [{uri: 'https://evil.example.com/exfil.png?cookie=123'}],
        textures: [{source: 0}],
      });
      const jsonBytes = new TextEncoder().encode(gltfJson);
      const paddedLen = (jsonBytes.length + 3) & ~3;
      const glb = new Uint8Array(12 + 8 + paddedLen);
      const dv = new DataView(glb.buffer);
      dv.setUint32(0, 0x46546c67, true);
      dv.setUint32(4, 2, true);
      dv.setUint32(8, glb.byteLength, true);
      dv.setUint32(12, paddedLen, true);
      dv.setUint32(16, 0x4e4f534a, true);
      glb.set(jsonBytes, 20);
      for (let i = 20 + jsonBytes.length; i < glb.length; i++) glb[i] = 0x20;
      view.loadModel(glb);
      assert(
        !imageSrcAssigned &&
          viewHost.denied.some(
            (d) =>
              d.feature === 'gltfImageUri' &&
              d.capability === 'remote_content',
          ),
        'Embedded glTF external images[].uri is blocked without remote_content capability',
      );
    } finally {
      (globalThis as {Image?: unknown}).Image = origImage;
    }

    // Environment HDRI (`environment-image`) gated on `remote_content`
    const envViewer = {
      container: viewHost,
      gl: makeMockCanvas().getContext('webgl2'),
      environmentTexture: null as unknown,
    };
    await environmentMapPlugin.setEnvironmentImage?.(
      envViewer,
      'https://cdn.example.com/studio.hdr',
    );
    assert(
      envViewer.environmentTexture === null &&
        fetchCount === 0 &&
        viewHost.denied.some(
          (d) =>
            d.capability === 'remote_content' &&
            d.feature === 'environmentTexture',
        ),
      'environment-image refuses remote HDRI without remote_content',
    );
  } finally {
    globalThis.fetch = origFetch;
  }

  // 6. AI, Microphone, Storage, and External Handoff gating
  const aiHost = new TestThreeLiveElement();
  aiHost.capabilities = 'scripts';
  const aiDenied: CapabilityDeniedDetail[] = [];
  aiHost.onCapabilityDenied = (d) => aiDenied.push(d);

  // A gated AI call either throws or reports `applied: false`; either way the
  // provider must never be called.
  const refuses = async (run: () => Promise<unknown>): Promise<boolean> => {
    try {
      const res = (await run()) as {applied?: boolean} | undefined;
      return res?.applied !== true;
    } catch {
      return true;
    }
  };
  let llmCalls = 0;
  const fakeLlm = {
    complete: async () => {
      llmCalls++;
      return 'scene.add(new THREE.Mesh());';
    },
  };

  const editRefused = await refuses(() =>
    editScene(aiHost, 'make it gold', {
      source: 'scene.add(new THREE.Mesh());',
      provider: fakeLlm,
    } as Parameters<typeof editScene>[2]),
  );
  assert(
    editRefused &&
      llmCalls === 0 &&
      aiDenied.some((d) => d.capability === 'ai'),
    'editScene refuses LLM call without ai capability',
  );

  const imgRefused = await refuses(() =>
    compileFromImage(
      aiHost,
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      {provider: fakeLlm} as Parameters<typeof compileFromImage>[2],
    ),
  );
  assert(
    imgRefused && llmCalls === 0,
    'compileFromImage refuses LLM call without ai capability',
  );

  let imageCalls = 0;
  await refuses(() =>
    generateTextures(aiHost, {
      provider: {
        generateImage: async () => {
          imageCalls++;
          return new Uint8Array([1, 2, 3]);
        },
      },
    } as Parameters<typeof generateTextures>[1]),
  );
  assert(
    imageCalls === 0,
    'generateTextures refuses image generation without ai capability',
  );

  let voiceDenied = false;
  try {
    await connectVoice(aiHost, {
      transport: {
        send: () => {},
        close: () => {},
        onMessage: null,
        onClose: null,
      },
    } as unknown as Parameters<typeof connectVoice>[1]);
  } catch {
    voiceDenied = true;
  }
  assert(
    voiceDenied,
    'connectVoice refuses session without ai + microphone capabilities',
  );

  // External handoff (`launchQuickLook`, `launchSceneViewer`, `activateAR`).
  // The capability check runs before any DOM use, so empty DOM stand-ins are
  // enough to reach it.
  const g = globalThis as Record<string, unknown>;
  const hadDocument = 'document' in g;
  const hadWindow = 'window' in g;
  const prevDocument = g['document'];
  const prevWindow = g['window'];
  if (!hadDocument) g['document'] = {};
  if (!hadWindow) g['window'] = {};
  const handoffDenied = (launch: () => void): boolean => {
    try {
      launch();
      return false;
    } catch (e) {
      return /external_handoff/.test(String((e as Error)?.message ?? e));
    }
  };
  try {
    assert(
      handoffDenied(() =>
        launchQuickLook('https://cdn.example.com/model.usdz', {host: aiHost}),
      ),
      'launchQuickLook refuses external AR handoff without external_handoff capability',
    );
    assert(
      handoffDenied(() =>
        launchSceneViewer('https://cdn.example.com/model.glb', {host: aiHost}),
      ),
      'launchSceneViewer refuses external AR handoff without external_handoff capability',
    );
  } finally {
    if (hadDocument) g['document'] = prevDocument;
    else delete g['document'];
    if (hadWindow) g['window'] = prevWindow;
    else delete g['window'];
  }
  const arRes = await activateAR({
    glbUrl: 'https://cdn.example.com/model.glb',
    preferredModes: ['scene-viewer'],
    host: aiHost,
  });
  assert(
    !arRes.launched &&
      aiDenied.some((d) => d.capability === 'external_handoff'),
    'activateAR refuses Scene Viewer handoff and reports external_handoff denial',
  );

  // 7. Audit Regression Coverage: long userinfo tokens, allow-client-scripts lockdown,
  //    capabilities="all" resetting base origins, {src} image bypass, lazy selectByVoice, & exports
  const longToken = 'SECRET_JWT_' + 'x'.repeat(320);
  const sanitizedLong = sanitizeDiagnosticUrl(
    `https://oauth2:${longToken}@api.example.com/v1/scene?key=K`,
  );
  assert(
    !sanitizedLong.includes('SECRET_JWT_') &&
      !sanitizedLong.includes('oauth2') &&
      sanitizedLong.startsWith('https://api.example.com/v1/scene'),
    'sanitizeDiagnosticUrl strips >256-char OAuth/JWT userinfo tokens before truncating',
  );
  const sanitizedMalformedLong = sanitizeDiagnosticUrl(
    `https://oauth2:${longToken}@[bad/path?key=K`,
  );
  assert(
    !sanitizedMalformedLong.includes('SECRET_JWT_'),
    'sanitizeDiagnosticUrl fallback redacts unclosed/long credentials on malformed URLs',
  );

  const lockHost = new TestThreeLiveElement();
  lockHost.setAttribute('allow-client-scripts', '');
  assert(
    lockHost.hasCapability('scripts'),
    'allow-client-scripts enables scripts when no capabilities override negates it',
  );
  // `ai` also needs `network` (the provider endpoint is a network request).
  lockHost.setAttribute('capabilities', 'ai network');
  assert(
    lockHost.hasCapability('scripts') && lockHost.hasCapability('ai'),
    'allow-client-scripts composes additively with capabilities="ai network"',
  );
  lockHost.setAttribute('capabilities', 'viewer -scripts');
  assert(
    !lockHost.hasCapability('scripts'),
    'explicit -scripts overrides legacy allow-client-scripts attribute',
  );
  lockHost.capabilities = 'none';
  assert(
    !lockHost.hasCapability('scripts'),
    'capabilities="none" overrides legacy allow-client-scripts attribute',
  );
  lockHost.capabilities = {scripts: false};
  assert(
    !lockHost.hasCapability('scripts') &&
      lockHost.getAttribute('capabilities') === null,
    'el.capabilities = {scripts: false} overrides allow-client-scripts and clears stale attribute',
  );

  const restrictedBase = parseCapabilities(
    'network:https@https://cdn1.example.com',
  );
  const expandedAll = parseCapabilities('all', restrictedBase);
  assert(
    expandedAll.network.origins === null &&
      hasCapabilityInPolicy(
        expandedAll,
        'network',
        'https://other.example.com/x',
      ),
    'capabilities="all" resets inherited network origin restrictions',
  );
  const replacedOrigin = parseCapabilities(
    'network@https://cdn2.example.com',
    restrictedBase,
  );
  assert(
    !hasCapabilityInPolicy(
      replacedOrigin,
      'network',
      'https://cdn1.example.com/a',
    ) &&
      hasCapabilityInPolicy(
        replacedOrigin,
        'network',
        'https://cdn2.example.com/a',
      ),
    'string network@origin replaces base origin allowlist consistently with object init',
  );

  // `compileFromImage` with `{src: 'https://...'}` object must enforce `remote_content`
  const imgBypassHost = new TestThreeLiveElement();
  imgBypassHost.capabilities = 'scripts ai network';
  const imgBypassDenied: CapabilityDeniedDetail[] = [];
  imgBypassHost.onCapabilityDenied = (d) => imgBypassDenied.push(d);
  const drawableRefused = await refuses(() =>
    compileFromImage(
      imgBypassHost,
      {
        src: 'https://untrusted.example.com/ref.png',
      } as unknown as HTMLImageElement,
      {provider: fakeLlm} as Parameters<typeof compileFromImage>[2],
    ),
  );
  assert(
    drawableRefused &&
      llmCalls === 0 &&
      imgBypassDenied.some((d) => d.capability === 'remote_content'),
    'compileFromImage blocks {src: "https://..."} drawable fallback without remote_content',
  );

  // `selectByVoice` Tier-1 local match must NOT fire spurious `ai` denial when ai-endpoint is set
  const voiceLocalHost = new TestThreeLiveElement();
  voiceLocalHost.capabilities = 'scripts';
  voiceLocalHost.setAttribute('ai-endpoint', 'https://llm.example.com/v1/chat');
  (voiceLocalHost as unknown as {viewer: unknown}).viewer = {
    setSelectedMesh() {},
    // The matcher indexes meshes with world bounds, so give it one primitive.
    meshes: [
      {
        name: 'SolarPanel',
        visible: true,
        primitives: [
          {positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])},
        ],
      },
    ],
  };
  aiPlugin.onElementConnected?.(voiceLocalHost);
  const spuriousDenied: CapabilityDeniedDetail[] = [];
  voiceLocalHost.onCapabilityDenied = (d) => spuriousDenied.push(d);
  const selRes = await selectByVoice(
    voiceLocalHost as unknown as Parameters<typeof selectByVoice>[0],
    'SolarPanel',
  );
  assert(
    selRes.applied && spuriousDenied.length === 0,
    'selectByVoice Tier-1 local match does not emit spurious ai capability denial',
  );

  // Runtime top-level exports match `three-live.d.ts`
  assert(
    typeof ThreeLiveIndex.resetCapabilityDenials === 'function' &&
      typeof ThreeLiveIndex.hasCapabilityInPolicy === 'function' &&
      typeof ThreeLiveIndex.isNetworkUrlPermitted === 'function' &&
      typeof ThreeLiveIndex.sanitizeDiagnosticUrl === 'function',
    'three-live entrypoint exports capability utility functions declared in three-live.d.ts',
  );

  console.log(
    `\n🏆 Capability Security Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runCapabilitiesTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
