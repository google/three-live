/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview End-to-end capability security tests for `<xr-live>` and its
 * spatial plugins (`splat-loader`, `persistent-anchors`, `shared-room`,
 * `spatial-audio`, `gemini-live`, `world-understanding`, `depth-particles`,
 * and `xr-mobile-bridge`), including `userData.xr.*` privilege-escalation
 * refusal while procedural geometry continues to render cleanly.
 */

import {
  CAPABILITIES_NONE,
  CapabilityDeniedDetail,
  ensureCapabilityChecker,
  resetCapabilityDenials,
} from '../../three-live/src/capabilities';
import {getSharedRegistry, ThreeLiveViewer} from '../../three-live/src/plugin';
import {THREE} from '../../three-live/src/three-author';
import {sceneToCanvas3D} from '../../three-live/src/three-convert';
import {ThreeLiveElement} from '../../three-live/src/three-live-element';
import {registerXRTraitSerializer} from '../../three-live/src/xr-trait-schema';
import {depthParticlesPlugin} from '../src/plugins/depth-particles';
import {XRGeminiLiveController} from '../src/plugins/gemini-live';
import {XRPersistentAnchorsController} from '../src/plugins/persistent-anchors';
import {XRSharedRoomController} from '../src/plugins/shared-room';
import {
  spatialAudioPlugin,
  XRSpatialAudioEmitterController,
} from '../src/plugins/spatial-audio';
import {loadSplat, XRSplatLoader} from '../src/plugins/splat-loader';
import {worldUnderstandingPlugin} from '../src/plugins/world-understanding';
import {XRInputManager} from '../src/xr-input';
import {XRLiveElement} from '../src/xr-live-element';
import {launchBestMobileOrHeadsetAR} from '../src/xr-mobile-bridge';
import {XRTraitSystem} from '../src/xr-traits';

ensureCapabilityChecker();
registerXRTraitSerializer();

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

function createFakeHost(capabilities = 'scripts'): {
  attrs: Map<string, string>;
  host: {
    capabilities: string;
    denied: CapabilityDeniedDetail[];
    events: Array<{type: string; detail: unknown}>;
    captureViewFrame: () => Promise<{base64: string; mimeType: string}>;
    getAttribute: (name: string) => string | null;
    hasAttribute: (name: string) => boolean;
    addEventListener: () => void;
    removeEventListener: () => void;
    onCapabilityDenied: (d: CapabilityDeniedDetail) => void;
    dispatchEvent: (e: Event) => boolean;
  };
  viewer: ThreeLiveViewer;
} {
  const attrs = new Map<string, string>([
    ['capabilities', capabilities],
    ['persistent-anchors', 'studio'],
    ['shared-room-voice', ''],
    ['allow-remote-splats', ''],
  ]);
  const host = {
    capabilities,
    denied: [] as CapabilityDeniedDetail[],
    events: [] as Array<{type: string; detail: unknown}>,
    captureViewFrame: async () => ({base64: '/9g=', mimeType: 'image/jpeg'}),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    hasAttribute: (name: string) => attrs.has(name),
    addEventListener: () => {},
    removeEventListener: () => {},
    onCapabilityDenied(d: CapabilityDeniedDetail) {
      this.denied.push(d);
    },
    dispatchEvent(e: Event) {
      this.events.push({
        type: e.type,
        detail: (e as CustomEvent).detail,
      });
      return true;
    },
  };
  const scene = new THREE.Scene();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({color: 0x38bdf8}),
  );
  m.name = 'EscalatorNode';
  m.userData.xr = {
    grab: '1-hand',
    splatUrl: 'https://cdn.example.com/room.spz',
    anchor: {target: 'floor', id: 'escalator-1', persist: true},
    sync: true,
    worldUnderstanding: {planes: true, meshes: true, reticle: true},
    particles: {preset: 'sparks', count: 32, collideWithDepth: true},
    audioEmitter: {
      src: 'https://cdn.example.com/secret.mp3',
      autoplay: true,
      playOnSelect: true,
    },
  };
  scene.add(m);
  const converted = sceneToCanvas3D(scene);
  const viewer: ThreeLiveViewer = {
    container: host as unknown as HTMLElement,
    meshes: [
      {
        name: 'EscalatorNode',
        nodeIndex: 0,
        transform: new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1,
        ]),
        position: [0, 0, -1],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        primitives: [],
        extras: (
          converted.gltf.nodes?.[0] as {extras?: Record<string, unknown>}
        )?.extras,
      },
    ],
    lastGltf: converted.gltf,
  } as unknown as ThreeLiveViewer;
  return {attrs, host, viewer};
}

async function runXRCapabilitiesTests(): Promise<void> {
  console.log('🥽 Running XR-Live Capability Security Tests...\n');

  ThreeLiveElement.defaultCapabilities = CAPABILITIES_NONE;
  ThreeLiveElement.allowClientScripts = false;
  getSharedRegistry().onCapabilityDenied = null;

  assert(
    XRLiveElement.observedAttributes.includes('capabilities'),
    'XRLiveElement inherits observed capabilities attribute',
  );

  // 1. Author-controlled `userData.xr.*` traits CANNOT escalate privileges when host only grants `scripts`
  const {host, viewer} = createFakeHost('scripts');
  assert(
    viewer.meshes.length === 1,
    'Procedural mesh still compiles cleanly even when userData.xr declares sensitive traits',
  );

  // 1a. `splatUrl` blocked without `remote_content` + `network`
  let splatFetched = false;
  const fakeFetch = (async () => {
    splatFetched = true;
    throw new Error('unexpected splat fetch');
  }) as typeof fetch;
  let directRejected = false;
  try {
    await loadSplat('https://cdn.example.com/room.spz', fakeFetch, true, host);
  } catch {
    directRejected = true;
  }
  const splats = new XRSplatLoader(fakeFetch);
  splats.sync(viewer as unknown as Parameters<XRSplatLoader['sync']>[0]);
  assert(
    directRejected &&
      !splatFetched &&
      host.denied.some((d) => d.capability === 'remote_content'),
    'splatUrl and loadSplat refuse remote downloads without remote_content',
  );

  // 1b. `audioEmitter.src` blocked without `remote_content`, while preset+src strips `src`
  const audio = new XRSpatialAudioEmitterController();
  audio.update(viewer, 0.016);
  assert(
    audio.trigger(viewer, 0) === null &&
      !host.events.some((e) => e.type === 'xraudioplay'),
    'spatialAudio refuses remote audioEmitter.src without remote_content',
  );

  const dualViewer: ThreeLiveViewer = {
    container: host as unknown as HTMLElement,
    meshes: [
      {
        name: 'DualSpeaker',
        nodeIndex: 0,
        transform: new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, -2, 1,
        ]),
        position: [0, 1.6, -2],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        extras: {
          xr: {
            audioEmitter: {
              preset: 'hum',
              src: 'https://evil.example.com/spy.mp3',
              autoplay: false,
              playOnSelect: true,
            },
          },
        },
      },
    ],
  } as unknown as ThreeLiveViewer;
  const dualAudio = new XRSpatialAudioEmitterController();
  const mix = dualAudio.trigger(dualViewer, 0);
  const playEvt = host.events.find((e) => e.type === 'xraudioplay');
  assert(
    mix !== null && (playEvt?.detail as {src: string | null})?.src === null,
    'spatialAudio plays synthesized preset and strips untrusted src when preset is set',
  );

  // 1c. `persistent-anchors` (`localStorage` + URL hash) blocked without `storage`
  let storageTouched = false;
  const anchors = new XRPersistentAnchorsController(
    {
      getItem: () => {
        storageTouched = true;
        return null;
      },
      setItem: () => {
        storageTouched = true;
      },
      removeItem: () => {
        storageTouched = true;
      },
    },
    {
      getPathname: () => '/demo',
      getHash: () => '#xr-state=abc',
      setHash: () => {
        storageTouched = true;
      },
    },
  );
  const anchorViewer = viewer as unknown as Parameters<
    XRPersistentAnchorsController['save']
  >[0];
  assert(
    anchors.save(anchorViewer, host) === '' &&
      anchors.restore(anchorViewer, host).count === 0 &&
      !storageTouched &&
      host.denied.some((d) => d.capability === 'storage'),
    'persistentAnchors refuses localStorage and URL hash access without storage capability',
  );

  // 1d. `shared-room` WebSocket + WebRTC voice signaling blocked without `network` + `microphone`
  let wsOpened = false;
  const origWS = (globalThis as {WebSocket?: unknown}).WebSocket;
  (globalThis as {WebSocket?: unknown}).WebSocket = class FakeWS {
    constructor() {
      wsOpened = true;
    }
    send(): void {}
    close(): void {}
  };
  try {
    const room = new XRSharedRoomController('peer-alice');
    const roomViewer = viewer as unknown as Parameters<
      XRSharedRoomController['connect']
    >[1];
    const joined = room.connect(
      'wss://relay.example.com/room/alpha?token=SECRET',
      roomViewer,
      host,
    );
    assert(
      !joined &&
        !wsOpened &&
        host.denied.some(
          (d) => d.capability === 'network' && !d.url?.includes('SECRET'),
        ),
      'sharedRoom refuses WebSocket connection without network capability',
    );

    host.capabilities = 'scripts network';
    resetCapabilityDenials(host);
    const sentWire: string[] = [];
    const joinedWithNet = room.connect('room-alpha', roomViewer, host, {
      send: (raw: string) => sentWire.push(raw),
      close: () => {},
    });
    const rtcSent = room.broadcastRtcSignal('peer-bob', 'offer', {
      sdp: 'v=0\r\n',
    });
    assert(
      joinedWithNet &&
        !rtcSent &&
        sentWire.length === 0 &&
        host.denied.some((d) => d.capability === 'microphone'),
      'sharedRoom.broadcastRtcSignal refuses WebRTC voice signaling without microphone capability',
    );
    room.dispose(roomViewer);
  } finally {
    (globalThis as {WebSocket?: unknown}).WebSocket = origWS;
  }

  // 1e. `sensors` gates world-understanding plane/mesh reads & depth-particles hardware depth
  host.capabilities = 'scripts';
  resetCapabilityDenials(host);
  let sensorsRead = false;
  const fakeFrame = {
    get detectedPlanes() {
      sensorsRead = true;
      return new Set();
    },
    getPose: () => ({
      transform: {
        matrix: new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1,
        ]),
      },
    }),
    getViewerPose: () => ({
      views: [
        {
          projectionMatrix: new Float32Array(16),
          transform: {
            matrix: new Float32Array([
              1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1,
            ]),
          },
          getDepthInformation: () => {
            sensorsRead = true;
            return null;
          },
        },
      ],
    }),
  };
  worldUnderstandingPlugin.onXRFrame!(viewer, {}, fakeFrame, {});
  depthParticlesPlugin.onXRFrame!(viewer, {}, fakeFrame, {});
  assert(
    !sensorsRead && host.denied.some((d) => d.capability === 'sensors'),
    'worldUnderstanding and depthParticles refuse XRFrame plane/depth reads without sensors capability',
  );

  // 1f. `gemini-live` gates session (`ai` + `network`), mic (`microphone`), and frames (`camera`)
  const sentMsgs: Array<Record<string, unknown>> = [];
  const fakeTransport = {
    onMessage: undefined as ((m: Record<string, unknown>) => void) | undefined,
    onClose: undefined as (() => void) | undefined,
    send: (m: Record<string, unknown>) => {
      sentMsgs.push(m);
    },
    close: () => {},
  };
  const gemini = new XRGeminiLiveController(host);
  let geminiConnectRejected = false;
  try {
    gemini.connect({transport: fakeTransport, streamFrames: false});
  } catch {
    geminiConnectRejected = true;
  }
  assert(
    geminiConnectRejected &&
      sentMsgs.length === 0 &&
      host.denied.some((d) => d.capability === 'ai'),
    'XRGeminiLiveController refuses connect without ai capability',
  );
  host.capabilities = 'scripts ai network';
  resetCapabilityDenials(host);
  gemini.connect({
    transport: fakeTransport,
    setup: {model: 'models/gemini-live'},
    streamFrames: false,
  });
  assert(
    sentMsgs.length === 1,
    'XRGeminiLiveController connects when ai + network granted',
  );
  gemini.sendAudioChunk(new Int16Array([1, 2]), 16000);
  const frameSentDenied = await gemini.sendFrame();
  assert(
    sentMsgs.length === 1 &&
      !frameSentDenied &&
      host.denied.some((d) => d.capability === 'microphone') &&
      host.denied.some((d) => d.capability === 'camera'),
    'XRGeminiLiveController blocks sendAudioChunk without microphone and sendFrame without camera',
  );
  host.capabilities = 'scripts ai network microphone camera';
  resetCapabilityDenials(host);
  gemini.sendAudioChunk(new Int16Array([1, 2]), 16000);
  const frameSentAllowed = await gemini.sendFrame();
  assert(
    frameSentAllowed && sentMsgs.length === 3,
    'XRGeminiLiveController sends audio and viewport frames once microphone + camera are granted',
  );
  gemini.disconnect();

  // 1g. `xr-mobile-bridge` gates external AR handoff (`external_handoff`)
  host.capabilities = 'scripts';
  resetCapabilityDenials(host);
  let handoffDenied = false;
  try {
    await launchBestMobileOrHeadsetAR('https://cdn.example.com/model.usdz', {
      element: host,
      forceFallback: 'ios-quicklook',
    });
  } catch {
    handoffDenied = true;
  }
  assert(
    handoffDenied &&
      host.denied.some((d) => d.capability === 'external_handoff'),
    'launchBestMobileOrHeadsetAR refuses external Quick Look handoff without external_handoff capability',
  );

  // 1h. Audit Regression Coverage: XRInputManager `allowHands = false` skips `frame.getJointPose`,
  //     dynamic `ai` revocation blocks `XRGeminiLiveController.sendText`, & `spatialAudioPlugin` hooks
  let jointPoseCalled = false;
  const inputMgr = new XRInputManager(new XRTraitSystem(), () => {}, undefined);
  inputMgr.processXRFrame(
    {meshes: []},
    {
      inputSources: [
        {
          handedness: 'right',
          hand: new Map([
            ['index-finger-tip', {}],
            ['thumb-tip', {}],
          ]),
        },
      ],
    },
    {
      getJointPose: () => {
        jointPoseCalled = true;
        return null;
      },
    },
    {},
    false,
  );
  assert(
    !jointPoseCalled,
    'XRInputManager.processXRFrame skips XRHand joint pose reads when allowHands is false',
  );

  host.capabilities = 'scripts ai network';
  resetCapabilityDenials(host);
  const revMsgs: Array<Record<string, unknown>> = [];
  let revClosed = false;
  gemini.connect({
    transport: {
      send: (m) => revMsgs.push(m),
      close: () => {
        revClosed = true;
      },
    },
    streamFrames: false,
  });
  gemini.sendText('hello allowed');
  assert(
    revMsgs.length === 1,
    'XRGeminiLiveController.sendText sends when ai is granted',
  );
  host.capabilities = 'scripts';
  resetCapabilityDenials(host);
  gemini.sendText('blocked after revoke');
  assert(
    revMsgs.length === 1 && host.denied.some((d) => d.capability === 'ai'),
    'XRGeminiLiveController.sendText is blocked once ai capability is dynamically revoked',
  );
  gemini.disconnect();
  assert(revClosed, 'XRGeminiLiveController.disconnect closes transport');

  const khrViewer = {
    container: host,
    meshes: [
      {
        name: 'Bell',
        transform: new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        ]),
        primitives: [],
      },
    ],
    gltf: {
      extensions: {
        KHR_audio_emitter: {
          audio: [{uri: 'https://cdn.example.com/bell.mp3'}],
          sources: [{audio: 0, autoPlay: true}],
          emitters: [{type: 'positional', sources: [0]}],
        },
      },
      nodes: [{mesh: 0, extensions: {KHR_audio_emitter: {emitter: 0}}}],
    },
  } as unknown as ThreeLiveViewer;
  spatialAudioPlugin.onLoadModel?.(khrViewer);
  spatialAudioPlugin.onDestroy?.({} as WebGL2RenderingContext, khrViewer);
  assert(
    typeof spatialAudioPlugin.onLoadModel === 'function' &&
      typeof spatialAudioPlugin.onDestroy === 'function',
    'spatialAudioPlugin exposes onLoadModel/onDestroy hooks and reads viewer.gltf',
  );

  console.log(
    `\n🏆 XR Capability Security Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runXRCapabilitiesTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
