// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview <three-live> Framework-Agnostic Web Component.
 * Custom HTML element providing zero-config 3D viewing, interactive arcball controls,
 * responsive layout, mesh inspection, and one-tap spatial/AR launch.
 */

import {
  HOST_BLOOM_DEFAULT_RADIUS,
  HOST_BLOOM_DEFAULT_THRESHOLD,
  parseNumericAttr,
} from './constants';
import {
  CLIENT_SCRIPTS_DISABLED_ERROR,
  CLIENT_SCRIPTS_DISABLED_TOAST,
} from './messages';
import {
  getSharedRegistry,
  type RendererPreference,
  type ShadowMapsMode,
} from './plugin';
import {
  normalizeToneMapping,
  SANDBOX_HOST_SCENE_LIMITS,
  ThreeView,
  toGLBData,
  type CameraDetail,
  type DecoderType,
  type GLBData,
  type HitDetail,
  type HostSceneLimits,
  type MeshDecoder,
  type OrbitLimits,
  type ToneMappingMode,
} from './three-view';

export type {
  DecoderType,
  MeshDecoder,
  OrbitLimits,
  RendererPreference,
  ShadowMapsMode,
  ToneMappingMode,
};

export type ARMode = 'quick-look' | 'webxr' | 'scene-viewer';

export interface ARLaunchOptions {
  model: any;
  glbUrl?: string;
  view?: ThreeView;
  preferredModes?: ARMode[];
  webXROptions?: {
    onExit?: () => void;
    onError?: (error: Error) => void;
  };
}

export interface ARLaunchResult {
  mode: ARMode | 'fallback-download' | null;
  success: boolean;
  error?: Error;
}

export interface ARProvider {
  activateAR(options: ARLaunchOptions): Promise<ARLaunchResult>;
  createUSDZBlob?(model: any): Blob;
}

export interface ScriptExecutionCallbacks {
  onModelReady: (glbBuffer: ArrayBuffer | GLBData) => void;
  onUpdateTransforms?: (transforms: any) => void;
  onError?: (err: Error) => void;
  onToast?: (message: string) => void;
}

export interface ScriptExecutionHandle {
  terminate: () => void;
}

/**
 * Mandatory sandbox mode for procedural script execution.
 *
 * - `'worker'` (default): the script runs in a dedicated Web Worker with
 *   network, storage and thread-spawning capabilities revoked across the
 *   prototype chain.
 * - `'iframe'`: the script runs in a dedicated Web Worker inside an
 *   opaque-origin `<iframe sandbox="allow-scripts">` (`three-live-sandbox.html`)
 *   with a strict `connect-src 'none'` Content Security Policy.
 */
export type SandboxMode = 'worker' | 'iframe';

/** Options controlling procedural script execution security policy. */
export interface ScriptExecutionOptions {
  readonly allowClientScripts?: boolean;
  /** AI textures for `userData.xr.material.prompt` (B5). */
  readonly texturePack?: Readonly<
    Record<string, {readonly size: number; readonly rgba: Uint8Array}>
  > | null;
}

export interface ScriptRunner {
  execute(
    script: string,
    sandbox: SandboxMode | string,
    callbacks: ScriptExecutionCallbacks,
    options?: ScriptExecutionOptions,
  ): Promise<ScriptExecutionHandle | void>;
  executeUrl?(
    scriptUrl: string,
    sandbox: SandboxMode | string,
    callbacks: ScriptExecutionCallbacks,
    options?: ScriptExecutionOptions,
  ): Promise<ScriptExecutionHandle | void>;
}

export interface CameraState {
  theta?: number;
  phi?: number;
  zoom?: number;
  distance?: number;
}

const vec3WithUnits = (x: number, y: number, z: number) => ({
  x,
  y,
  z,
  toString: () => `${x}m ${y}m ${z}m`,
});

const BaseElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as typeof HTMLElement);

if (typeof CustomEvent === 'undefined' && typeof Event !== 'undefined') {
  (globalThis as Record<string, unknown>)['CustomEvent'] = class<
    T = unknown,
  > extends Event {
    readonly detail: T;
    constructor(type: string, eventInitDict?: CustomEventInit<T>) {
      super(type, eventInitDict);
      this.detail = (eventInitDict?.detail ?? null) as T;
    }
  };
}

/** Reflected HTML attribute properties installed on `ThreeLiveElement.prototype`. */
export interface ThreeLiveElement {
  src: string | null;
  cameraControls: boolean;
  cameraOrbit: string | null;
  cameraTarget: string | null;
  minCameraOrbit: string | null;
  maxCameraOrbit: string | null;
  fieldOfView: string | null;
  iosSrc: string | null;
  scriptSrc: string | null;
  poster: string | null;
  selectedMesh: string | null;
  exposure: number;
  autoRotate: boolean;
  autoRotateDelay: number;
  rotationPerSecond: string;
  arScale: 'auto' | 'fixed';
  arPlacement: 'floor' | 'wall';
  shadowIntensity: number;
  shadowSoftness: number;
  bloom: number;
  outlineSelected: boolean;
  outlineColor: string;
  environmentImage: string | null;
  skyboxImage: string | null;
  autoplay: boolean;
  animationName: string | null;
  /**
   * Optional `three-live-tsl` (`tslPlugin`) method updating a named
   * `TSL.uniform(initialValue, name)` at 60–120 Hz without recompiling shaders.
   */
  setMaterialUniform?(
    materialName: string,
    uniformName: string,
    value: unknown,
  ): boolean;
}

/** Custom `<three-live>` Web Component for declarative 3D/XR rendering. */
export class ThreeLiveElement extends BaseElement {
  static readonly observedAttributes =
    'src ios-src script-src sandbox allow-client-scripts poster camera-controls camera-orbit camera-target min-camera-orbit max-camera-orbit field-of-view selected-mesh ar ar-modes ar-scale ar-placement exposure shadow-intensity shadow-softness tone-mapping bloom bloom-threshold bloom-radius outline outline-selected outline-color environment-image skybox-image autoplay animation-name variant-name auto-rotate auto-rotate-delay rotation-per-second renderer shadow-maps'.split(
      ' ',
    );

  /**
   * URL of the Three-Live IIFE bundle (e.g. `three-live.min.js`) that the
   * worker sandbox loads to obtain the `THREE` runtime.
   *
   * Auto-detected when the library is loaded via a classic `<script src>` tag.
   * If you bundle Three-Live with webpack/Vite/Rollup, set this explicitly:
   *
   * ```js
   * ThreeLiveElement.sandboxEngineSrc =
   *     new URL('three-live/dist/three-live.min.js', import.meta.url).href;
   * ```
   *
   * If it cannot be resolved, sandboxed execution fails closed rather than
   * falling back to evaluating the script in the host realm.
   */
  static get sandboxEngineSrc(): string | null {
    return getSharedRegistry().sandboxEngineSrc ?? null;
  }

  static set sandboxEngineSrc(value: string | null) {
    getSharedRegistry().sandboxEngineSrc = value;
  }

  /**
   * URL of `three-live-sandbox.html` used when executing procedural scripts in
   * `'iframe'` sandbox mode (`<iframe sandbox="allow-scripts">`).
   *
   * When set explicitly, `<three-live>` elements without an explicit `sandbox`
   * attribute automatically default to `'iframe'` sandbox mode. When left
   * unset and `sandbox="iframe"` is specified on an element, the URL is
   * derived automatically alongside `sandboxEngineSrc`.
   */
  static get sandboxIframeSrc(): string | null {
    return getSharedRegistry().sandboxIframeSrc ?? null;
  }

  static set sandboxIframeSrc(value: string | null) {
    getSharedRegistry().sandboxIframeSrc = value;
  }

  /**
   * Global opt-in flag enabling client-modified Three.js script strings
   * (Use Case 1: `el.executeScript(code)` and inline `<script type="text/three">`).
   *
   * Defaults to `false` so only server-generated script URLs (`script-src`) are
   * compiled by the sandbox unless explicitly enabled.
   */
  static get allowClientScripts(): boolean {
    return Boolean(getSharedRegistry().allowClientScripts);
  }

  static set allowClientScripts(value: boolean) {
    getSharedRegistry().allowClientScripts = value;
  }

  /**
   * Registers a pluggable procedural script runner (e.g. from `three-live/full` or `three-author`).
   */
  public static registerScriptRunner(runner: ScriptRunner): void {
    getSharedRegistry().scriptRunner = runner;
  }

  /**
   * Registers `ThreeLiveElement` under `<model-viewer>` (or a custom tag name)
   * if that tag is not already defined in `customElements`. Returns `true` when
   * registered or already bound to a `ThreeLiveElement` subclass.
   */
  static defineModelViewer(tagName = 'model-viewer'): boolean {
    if (typeof customElements === 'undefined') {
      return false;
    }
    const existing = customElements.get(tagName);
    if (existing != null) {
      return (
        existing === ThreeLiveElement ||
        existing.prototype instanceof ThreeLiveElement
      );
    }
    customElements.define(tagName, class extends ThreeLiveElement {});
    return true;
  }

  /**
   * Registers a pluggable mesh/texture decoder (e.g. Draco, Meshopt, KTX2).
   */
  public static registerDecoder(type: string, decoder: MeshDecoder): void {
    ThreeView.registerDecoder(type, decoder);
  }

  /**
   * Returns a registered mesh/texture decoder if available.
   */
  public static getDecoder(type: string): MeshDecoder | undefined {
    return ThreeView.getDecoder(type);
  }

  /**
   * Registers a spatial/AR provider (e.g. from `three-live/xr` or default `three-live`).
   * Automatically updates visibility of AR buttons on active <three-live ar> elements.
   */
  public static registerAR(
    provider:
      | ARProvider
      | ((options: ARLaunchOptions) => Promise<ARLaunchResult>),
  ): void {
    getSharedRegistry().arProvider =
      typeof provider === 'function' ? {activateAR: provider} : provider;
    if (typeof document !== 'undefined') {
      document.querySelectorAll('three-live').forEach((el) => {
        if (el instanceof ThreeLiveElement) {
          el.updateARButtonVisibility();
        }
      });
    }
  }

  /**
   * Returns whether an AR provider is currently registered.
   */
  public static isARSupported(): boolean {
    return !!getSharedRegistry().arProvider;
  }

  public static registerPlugin = ThreeView.registerPlugin;
  public static getRegisteredPlugins = ThreeView.getRegisteredPlugins;

  public viewer: ThreeView | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private posterEl: HTMLImageElement | null = null;
  private arButton: HTMLButtonElement | null = null;
  protected currentModel:
    | GLBData
    | ArrayBuffer
    | ArrayBufferView
    | string
    | null = null;
  protected activeXRSession: any = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Host scene limits to apply when `currentModel` is (re)loaded. */
  private currentModelLimits: HostSceneLimits | undefined = undefined;
  private isModelLoaded = false;

  public getLoadedModel():
    | GLBData
    | ArrayBuffer
    | ArrayBufferView
    | string
    | null {
    return this.currentModel;
  }

  private scriptHandle: ScriptExecutionHandle | null = null;
  private loadController: AbortController | null = null;

  private beginLoad(): AbortController {
    const previous = this.loadController;
    const handle = this.scriptHandle;
    const current = new AbortController();
    this.loadController = current;
    this.scriptHandle = null;
    previous?.abort();
    handle?.terminate();
    return current;
  }
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  connectedCallback(): void {
    if (typeof document === 'undefined') return;
    if (!this.style.display || this.style.display === 'inline') {
      this.style.display = 'block';
    }
    if (getComputedStyle(this).position === 'static') {
      this.style.position = 'relative';
    }
    this.style.overflow = 'hidden';

    this.setupDOM();
    this.initViewer();
    this.setupResizeObserver();

    // Trigger initial load if attributes are set
    const src = this.getAttribute('src');
    const scriptSrc = this.getAttribute('script-src');
    if (src) {
      this.loadModel(src).catch(() => {});
    } else if (scriptSrc) {
      this.loadScriptFromSrc(scriptSrc).catch(() => {});
    } else {
      this.scheduleInlineScript();
    }

    for (const plugin of ThreeView.getRegisteredPlugins()) {
      plugin.onElementConnected?.(this);
    }
  }

  /**
   * Runs the inline `<script type="text/three">` scene once it can actually
   * run. Two common setups used to skip it:
   * - The bundle defines `<three-live>` before it registers its script runner
   *   (the default and full bundles), so elements already in the page (a
   *   `defer` / `type="module"` / end-of-body bundle) upgraded with no runner.
   *   Waiting one microtask lets the bundle finish evaluating first.
   * - A classic `<script>` in `<head>` upgrades the element when its start tag
   *   is parsed, before its children exist. If the document is still loading
   *   and no inline script is there yet, check again on `DOMContentLoaded`.
   * A load started in the meantime (`src`, `executeScript`, ...) wins.
   */
  private scheduleInlineScript(): void {
    const pending = this.loadController;
    const run = () => {
      // `text/three` is the documented form; `text/three-live` is an alias.
      const inline = this.querySelector(
        'script[type="text/three"], script[type="text/three-live"]',
      );
      // Disconnecting or any newer load replaces `loadController`.
      if (this.loadController === pending && inline?.textContent) {
        this.executeScript(inline.textContent).catch(() => {});
        return true;
      }
      return false;
    };
    // If the script is not parsed yet, `DOMContentLoaded` is still to come
    // (a listener added after it is simply never called).
    queueMicrotask(
      () => run() || document.addEventListener('DOMContentLoaded', run),
    );
  }

  disconnectedCallback(): void {
    for (const plugin of ThreeView.getRegisteredPlugins()) {
      plugin.onElementDisconnected?.(this);
    }

    this.beginLoad().abort();
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.activeXRSession?.stop?.().catch?.(() => {});
    this.activeXRSession = null;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.viewer?.destroy();
    this.viewer = null;
    this.isModelLoaded = false;
  }

  attributeChangedCallback(
    name: string,
    oldVal: string | null,
    newVal: string | null,
  ): void {
    if (oldVal === newVal) return;
    const v = this.viewer;

    switch (name) {
      case 'src':
        if (newVal) this.loadModel(newVal).catch(() => {});
        break;

      case 'camera-target': {
        const t = this.parseCameraTarget(newVal);
        if (v && t) v.setTarget(t[0], t[1], t[2]);
        break;
      }

      case 'min-camera-orbit':
      case 'max-camera-orbit':
        if (v) {
          const min = this.parseOrbitLimit(this.getAttr('min-camera-orbit'));
          const max = this.parseOrbitLimit(this.getAttr('max-camera-orbit'));
          v.setOrbitLimits({
            minTheta: min.theta,
            maxTheta: max.theta,
            minPhi: min.phi,
            maxPhi: max.phi,
            minDistance: min.distance,
            maxDistance: max.distance,
          });
        }
        break;

      case 'field-of-view': {
        const fov = this.parseFieldOfView(newVal);
        if (v && fov !== undefined) v.setFieldOfView(fov);
        break;
      }

      case 'script-src':
        if (newVal) this.loadScriptFromSrc(newVal).catch(() => {});
        break;

      case 'poster':
        this.updatePoster(newVal);
        break;

      case 'camera-orbit':
        this.applyCameraOrbit(newVal);
        break;

      case 'selected-mesh':
        // Removing the attribute clears the highlight too.
        v?.setSelectedMesh(newVal ?? '');
        break;

      case 'exposure':
        if (v && newVal !== null) {
          const val = parseFloat(newVal);
          if (!isNaN(val)) v.setExposure(val);
        }
        break;

      case 'shadow-intensity':
      case 'shadow-softness':
        v?.setShadow(this.shadowIntensity, this.shadowSoftness);
        break;

      case 'tone-mapping':
        // Removing the attribute (newVal === null) restores `neutral`.
        v?.setToneMapping(normalizeToneMapping(newVal));
        break;

      case 'environment-image':
        v?.setEnvironmentImage(newVal).catch(() => {});
        break;

      case 'skybox-image':
        v?.setSkyboxImage?.(newVal)?.catch?.(() => {});
        break;

      case 'camera-controls': {
        const interactive = this.cameraControls;
        v?.setInteractive?.(interactive);
        if (this.canvas) {
          this.canvas.style.touchAction = interactive ? 'none' : 'auto';
        }
        break;
      }

      case 'autoplay':
        v?.setAutoplay(newVal !== null && newVal !== 'false');
        break;

      case 'animation-name':
        if (v && newVal !== null) v.setAnimationName(newVal);
        break;

      case 'variant-name':
        if (v) this.selectVariant(newVal);
        break;

      case 'auto-rotate':
        v?.setAutoRotate(newVal !== null && newVal !== 'false');
        break;

      case 'auto-rotate-delay':
        v?.setAutoRotateDelay(this.autoRotateDelay);
        break;

      case 'rotation-per-second':
        v?.setAutoRotateSpeed(this.parseRotationPerSecond(newVal));
        break;

      case 'ar':
        this.updateARButtonVisibility();
        break;

      case 'renderer':
        v?.render();
        break;

      case 'shadow-maps':
        if (v) v.shadowMaps = newVal !== null ? this.shadowMaps : undefined;
        v?.render();
        break;
    }

    for (const plugin of ThreeView.getRegisteredPlugins()) {
      plugin.onAttributeChanged?.(this, name, oldVal, newVal);
    }
  }

  // -------------------------------------------------------------------------
  // Getters and Setters for Properties
  // -------------------------------------------------------------------------

  protected getAttr(name: string): string | null {
    return this.getAttribute(name);
  }
  protected setAttr(name: string, val: string | number | null): void {
    if (val !== null) this.setAttribute(name, String(val));
    else this.removeAttribute(name);
  }
  protected getBoolAttr(name: string): boolean {
    return this.hasAttribute(name) && this.getAttr(name) !== 'false';
  }
  protected setBoolAttr(name: string, val: boolean): void {
    this.setAttr(name, val ? '' : null);
  }
  protected getFloatAttr(name: string, fallback: number): number {
    const val = this.getAttr(name);
    return val !== null ? parseFloat(val) : fallback;
  }

  /**
   * Mandatory sandbox mode for procedural scripts (`'worker'` or `'iframe'`).
   *
   * Defaults to `'iframe'` when `ThreeLiveElement.sandboxIframeSrc` is
   * explicitly configured, or `'worker'` otherwise. The raw attribute value is
   * forwarded to the script runner so disallowed values (`"none"`,
   * `"unsafe-host-realm"`, etc.) are rejected with a SecurityError.
   */
  get sandbox(): SandboxMode | string {
    return (
      this.getAttr('sandbox') ||
      (getSharedRegistry().sandboxIframeSrc ? 'iframe' : 'worker')
    );
  }
  set sandbox(value: SandboxMode | string) {
    this.setAttr('sandbox', value);
  }

  /**
   * Opt-in flag enabling client-modified procedural script strings on this
   * element (`executeScript(code)` and inline `<script type="text/three">`).
   *
   * Returns `true` when either the `allow-client-scripts` attribute is set on
   * this element or `ThreeLiveElement.allowClientScripts` is enabled globally.
   */
  get allowClientScripts(): boolean {
    return (
      this.getBoolAttr('allow-client-scripts') ||
      ThreeLiveElement.allowClientScripts
    );
  }
  set allowClientScripts(value: boolean) {
    this.setBoolAttr('allow-client-scripts', value);
  }

  get turntableRotation(): number {
    return this.viewer ? this.viewer.turntableRotation : 0;
  }

  get ar(): boolean {
    return this.hasAttribute('ar');
  }
  set ar(val: boolean) {
    this.setBoolAttr('ar', val);
  }

  get canActivateAR(): boolean {
    return ThreeLiveElement.isARSupported();
  }

  get toneMapping(): ToneMappingMode {
    return normalizeToneMapping(this.getAttr('tone-mapping'));
  }
  set toneMapping(val: ToneMappingMode) {
    this.setAttr('tone-mapping', val);
  }

  get bloomThreshold(): number {
    return parseNumericAttr(
      this.getAttr('bloom-threshold'),
      HOST_BLOOM_DEFAULT_THRESHOLD,
    );
  }
  set bloomThreshold(val: number) {
    this.setAttr('bloom-threshold', val);
  }

  get bloomRadius(): number {
    return parseNumericAttr(
      this.getAttr('bloom-radius'),
      HOST_BLOOM_DEFAULT_RADIUS,
    );
  }
  set bloomRadius(val: number) {
    this.setAttr('bloom-radius', val);
  }

  get availableAnimations(): string[] {
    return this.viewer ? this.viewer.getAvailableAnimations() : [];
  }

  get variantName(): string | null {
    return this.viewer
      ? this.viewer.getVariantName()
      : this.getAttr('variant-name');
  }
  set variantName(val: string | null) {
    this.setAttr('variant-name', val);
  }

  get availableVariants(): string[] {
    return this.viewer ? this.viewer.getAvailableVariants() : [];
  }

  get renderer(): RendererPreference {
    const r = this.getAttr('renderer')?.trim().toLowerCase();
    return r === 'webgpu' || r === 'webgl2' ? r : 'auto';
  }
  set renderer(val: RendererPreference | null) {
    this.setAttr('renderer', val);
  }

  get shadowMaps(): ShadowMapsMode {
    const r = this.getAttr('shadow-maps')?.trim().toLowerCase();
    return r === 'pcf' || r === 'off' ? r : 'auto';
  }
  set shadowMaps(val: ShadowMapsMode | null) {
    this.setAttr('shadow-maps', val);
  }

  protected fireEvent(type: string, detail?: unknown): void {
    this.dispatchEvent(
      new CustomEvent(type, {bubbles: true, composed: true, detail}),
    );
  }

  private setSlotVisible(slot: string, visible: boolean): void {
    const el =
      typeof this.querySelector === 'function'
        ? this.querySelector<HTMLElement>(`[slot="${slot}"]`)
        : null;
    if (!el) return;
    el.hidden = !visible;
    if (el.style) el.style.display = visible ? '' : 'none';
  }

  protected emitError(error: any, stage = 'script'): void {
    this.setSlotVisible('error', true);
    this.fireEvent('error', {error});
    this.fireEvent('three-error', {
      error,
      message: error?.message || String(error),
      stage,
    });
  }

  selectVariant(name: string | null): boolean {
    if (!this.viewer) return false;
    const applied = this.viewer.selectVariant(name);
    if (applied) {
      this.fireEvent('variant-applied', {
        variantName: this.viewer.getVariantName(),
      });
    }
    return applied;
  }

  get model(): {
    materials: ReturnType<ThreeView['getModelMaterials']>;
    getMaterialByName: (
      name: string,
    ) => ReturnType<ThreeView['getModelMaterials']>[number] | null;
  } {
    const materials = this.viewer ? this.viewer.getModelMaterials() : [];
    return {
      materials,
      getMaterialByName(name: string) {
        return materials.find((m) => m.name === name) ?? null;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Public Imperative API
  // -------------------------------------------------------------------------

  public play(): void {
    this.viewer?.playAnimation(this.animationName || undefined);
  }

  public pause(): void {
    this.viewer?.pauseAnimation();
  }

  public resetCamera(): void {
    this.viewer?.resetCamera();
  }

  public resetTurntableRotation(theta = 0): void {
    this.viewer?.resetTurntableRotation(theta);
  }

  public setCamera(
    theta?: number,
    phi?: number,
    distance?: number,
    zoom?: number,
  ): void {
    this.viewer?.setCamera(theta, phi, distance, zoom);
  }

  public getCameraOrbit(): {
    theta: number;
    phi: number;
    radius: number;
    toString(): string;
  } {
    return (
      this.viewer?.getCameraOrbit() ?? {
        theta: 0,
        phi: 0,
        radius: 3,
        toString: () => '0rad 0rad 3m',
      }
    );
  }

  public getCameraTarget(): {
    x: number;
    y: number;
    z: number;
    toString(): string;
  } {
    return this.viewer ? this.viewer.getCameraTarget() : vec3WithUnits(0, 0, 0);
  }

  public getFieldOfView(): number {
    return this.viewer ? this.viewer.getFieldOfView() : 45;
  }

  public jumpCameraToGoal(): void {
    this.viewer?.jumpCameraToGoal();
  }

  public toDataURL(type?: string, quality?: any): string {
    this.viewer?.render?.();
    return this.canvas ? this.canvas.toDataURL(type, quality) : '';
  }

  public toBlob(options?: {
    mimeType?: string;
    qualityArgument?: number;
  }): Promise<Blob> {
    this.viewer?.render?.();
    return new Promise((resolve, reject) => {
      if (!this.canvas || typeof this.canvas.toBlob !== 'function') {
        reject(
          new Error('Canvas toBlob is not supported in this environment.'),
        );
        return;
      }
      this.canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to capture canvas blob.'));
        },
        options?.mimeType,
        options?.qualityArgument,
      );
    });
  }

  public positionAndNormalFromPoint(
    pixelX: number,
    pixelY: number,
  ): {
    position: {x: number; y: number; z: number; toString(): string};
    normal: {x: number; y: number; z: number; toString(): string};
  } | null {
    const hit = this.viewer?.raycastFromScreenPoint(pixelX, pixelY);
    if (!hit) return null;
    const [px, py, pz] = hit.hitPoint || (hit as any).point;
    const [nx, ny, nz] = hit.normal;
    return {
      position: vec3WithUnits(px, py, pz),
      normal: vec3WithUnits(nx, ny, nz),
    };
  }

  public loadModel(
    model: GLBData | ArrayBuffer | ArrayBufferView | string,
  ): Promise<void> {
    return this.loadModelWithLimits(model);
  }

  /**
   * Shared implementation of `loadModel`. `limits` is set only for models that
   * come back from the untrusted script sandbox.
   */
  private async loadModelWithLimits(
    model: GLBData | ArrayBuffer | ArrayBufferView | string,
    limits?: HostSceneLimits,
    current = this.beginLoad(),
  ): Promise<void> {
    current.signal.throwIfAborted();
    if (!this.viewer) {
      this.currentModel = model;
      this.currentModelLimits = limits;
      return;
    }
    try {
      let resolvedModel: GLBData | ArrayBuffer | ArrayBufferView;
      if (typeof model === 'string') {
        const response = await fetch(model, {signal: current.signal});
        if (!response.ok) {
          throw new Error(`Failed to load "${model}": HTTP ${response.status}`);
        }
        resolvedModel = await response.arrayBuffer();
      } else {
        resolvedModel = model;
      }
      current.signal.throwIfAborted();
      const glbData = toGLBData(resolvedModel);
      this.viewer.loadGLBData(glbData, limits);
      this.currentModel = glbData;
      this.currentModelLimits = limits;
      this.isModelLoaded = true;
      this.hidePoster();
      this.setSlotVisible('error', false);
      this.updateHotspots();

      const selected = this.getAttr('selected-mesh');
      if (selected) {
        this.viewer.setSelectedMesh(selected);
      }
      const initialVariant = this.getAttr('variant-name');
      if (initialVariant) {
        this.selectVariant(initialVariant);
      }

      this.fireEvent('load', {model: glbData});
      this.fireEvent('three-load', {
        model: glbData,
        source: typeof model === 'string' ? 'src' : 'model',
      });
    } catch (err: any) {
      if (!current.signal.aborted) {
        this.emitError(err, 'load');
      }
      throw err;
    }
  }

  public showToast(message: string, durationMs = 4500): void {
    if (typeof document === 'undefined') return;
    let toast = this.querySelector<HTMLDivElement>('.three-live-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'three-live-toast';
      toast.style.cssText =
        'position:absolute;bottom:70px;left:50%;transform:translateX(-50%) translateY(10px);z-index:10;padding:10px 16px;background:rgba(15,23,42,.94);color:#f8fafc;border:1px solid rgba(56,189,248,.45);border-radius:14px;font:500 13px/1.35 system-ui,-apple-system,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.45);backdrop-filter:blur(12px);pointer-events:none;opacity:0;transition:opacity .25s,transform .25s;max-width:88%;text-align:center;white-space:normal;word-break:break-word';
      this.appendChild(toast);
    }
    toast.textContent = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const show = () => {
      if (toast) {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
      }
    };
    if (typeof requestAnimationFrame !== 'undefined')
      requestAnimationFrame(show);
    else show();
    this.toastTimer = setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
      }
      this.toastTimer = null;
    }, durationMs);
  }

  public async activateAR(): Promise<ARLaunchResult> {
    if (this.activeXRSession?.isSessionActive?.()) {
      await this.activeXRSession.stop().catch(() => {});
      this.activeXRSession = null;
    }

    const failAR = (err: Error, msg = err.message): never => {
      this.fireEvent('ar-status', {status: 'failed', error: err});
      this.showToast(msg, 6000);
      throw err;
    };

    if (!this.currentModel) {
      failAR(new Error('No 3D model is loaded in <three-live>.'));
    }

    const arProvider = getSharedRegistry().arProvider;
    if (!arProvider) {
      failAR(
        new Error(
          "AR module not bundled. Use the default 'three-live' bundle or call ThreeLiveElement.registerAR().",
        ),
      );
    }

    const iosSrc = this.getAttr('ios-src');
    const preferredModes = (this.getAttr('ar-modes') || '')
      .split(/\s+/)
      .filter(Boolean) as ARMode[];

    try {
      this.fireEvent('ar-status', {status: 'session-started'});
      const result = await arProvider.activateAR({
        model: (iosSrc || this.currentModel) as any,
        glbUrl:
          typeof this.currentModel === 'string' ? this.currentModel : undefined,
        view: this.viewer || undefined,
        element: this,
        preferredModes: preferredModes.length > 0 ? preferredModes : undefined,
        arScale: this.arScale,
        arPlacement: this.arPlacement,
        webXROptions: {
          onExit: () => {
            this.activeXRSession = null;
            this.fireEvent('ar-status', {status: 'not-presenting'});
          },
          onError: (err) => {
            this.activeXRSession = null;
            this.fireEvent('ar-status', {status: 'failed', error: err});
            this.showToast(`AR error: ${err.message}`, 6000);
          },
        },
      });

      if (!result.success) {
        const fallbackMsg =
          result.error?.message ||
          'AR requires an iOS (Quick Look) or Android (WebXR / Scene Viewer) device.';
        if (
          this.isDesktopMac() &&
          typeof document !== 'undefined' &&
          this.currentModel &&
          arProvider.createUSDZBlob
        ) {
          try {
            const usdzBlob =
              this.currentModel instanceof Blob &&
              this.currentModel.type === 'model/vnd.usdz+zip'
                ? this.currentModel
                : arProvider.createUSDZBlob(this.currentModel);
            const url = URL.createObjectURL(usdzBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'three_live_model.usdz';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 3000);
            this.showToast(
              'Downloaded USDZ preview for macOS Quick Look.',
              5000,
            );
          } catch {
            this.showToast(fallbackMsg, 6000);
          }
        } else {
          this.showToast(fallbackMsg, 6000);
        }

        if (result.error) {
          this.fireEvent('ar-status', {status: 'failed', error: result.error});
        }
      } else {
        if (result.session) {
          this.activeXRSession = result.session;
        }
        const modeMsg =
          (
            {
              'quick-look': 'Opening Apple AR Quick Look...',
              'scene-viewer': 'Opening Google Scene Viewer...',
              webxr: 'WebXR AR session started.',
            } as Record<string, string | undefined>
          )[result.mode || ''] || '';
        if (modeMsg) this.showToast(modeMsg);
      }
      return result;
    } catch (err: any) {
      this.activeXRSession = null;
      return failAR(err, `AR error: ${err.message || String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Internal DOM & Viewer Setup
  // -------------------------------------------------------------------------

  private setupDOM(): void {
    let canvas = this.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.style.cssText = `width:100%;height:100%;display:block;touch-action:${this.cameraControls ? 'none' : 'auto'};outline:none`;
      this.appendChild(canvas);
    }
    this.canvas = canvas;
    if (
      typeof canvas.addEventListener === 'function' &&
      !(canvas as any).__tlCtxBound
    ) {
      (canvas as any).__tlCtxBound = true;
      canvas.addEventListener('webglcontextlost', (e) =>
        this.fireEvent('three-context-lost', {originalEvent: e}),
      );
      canvas.addEventListener('webglcontextrestored', (e) =>
        this.fireEvent('three-context-restored', {originalEvent: e}),
      );
    }

    this.setSlotVisible('error', false);
    if (!this.isModelLoaded) {
      this.setSlotVisible('poster', true);
    }
    const posterSrc = this.getAttr('poster');
    if (posterSrc) {
      this.updatePoster(posterSrc);
    }

    this.createARButton();
    if (typeof MutationObserver !== 'undefined' && !this.mutationObserver) {
      this.mutationObserver = new MutationObserver(() => {
        this.updateARButtonVisibility();
      });
      this.mutationObserver.observe(this, {childList: true});
    }
  }

  private initViewer(): void {
    if (!this.canvas) return;

    this.viewer = new ThreeView(this, this.canvas, {
      autoRotate: this.autoRotate,
      autoRotateDelay: this.autoRotateDelay,
      autoRotateSpeed: this.parseRotationPerSecond(
        this.getAttr('rotation-per-second'),
      ),
      exposure: this.exposure,
      shadowIntensity: this.shadowIntensity,
      shadowSoftness: this.shadowSoftness,
      shadowMaps: this.hasAttribute('shadow-maps')
        ? this.shadowMaps
        : undefined,
      toneMapping: this.toneMapping,
      environmentImage: this.environmentImage,
      autoplay: this.autoplay,
      animationName: this.animationName || undefined,
      variantName: this.getAttr('variant-name') || undefined,
      fieldOfView: this.parseFieldOfView(this.getAttr('field-of-view')),
      cameraTarget: this.parseCameraTarget(this.getAttr('camera-target')),
      minCameraOrbit: this.parseOrbitLimit(this.getAttr('min-camera-orbit')),
      maxCameraOrbit: this.parseOrbitLimit(this.getAttr('max-camera-orbit')),
      onMeshClick: (hit: HitDetail) => {
        this.fireEvent('meshclick', hit);
      },
      onCameraChange: (cam: CameraDetail) => {
        this.updateHotspots();
        for (const plugin of ThreeView.getRegisteredPlugins()) {
          plugin.onCameraChange?.(this.viewer!, this);
        }
        this.fireEvent('camera-change', cam);
      },
    });

    this.viewer.setInteractive(this.cameraControls);

    if (this.skyboxImage) {
      this.viewer.setSkyboxImage(this.skyboxImage).catch(() => {});
    }

    const cameraOrbitStr = this.getAttr('camera-orbit');
    if (cameraOrbitStr) {
      this.applyCameraOrbit(cameraOrbitStr);
    }

    if (this.currentModel) {
      this.loadModelWithLimits(this.currentModel, this.currentModelLimits);
    }
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.viewer) {
        this.viewer.resize();
        this.viewer.render();
        this.updateHotspots();
      }
    });
    this.resizeObserver.observe(this);
  }

  private updatePoster(src: string | null): void {
    if (typeof document === 'undefined') return;
    if (!src) {
      if (this.posterEl) {
        this.posterEl.remove();
        this.posterEl = null;
      }
      return;
    }

    if (!this.posterEl) {
      this.posterEl = document.createElement('img');
      this.posterEl.alt = '3D Scene Preview';
      this.posterEl.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .35s ease-out;pointer-events:none;z-index:1';
      this.appendChild(this.posterEl);
    }

    this.posterEl.src = src;
    if (!this.isModelLoaded) {
      this.posterEl.style.opacity = '1';
    }
  }

  private hidePoster(): void {
    this.setSlotVisible('poster', false);
    if (this.posterEl) {
      this.posterEl.style.opacity = '0';
      setTimeout(() => {
        if (this.isModelLoaded && this.posterEl) {
          this.posterEl.remove();
          this.posterEl = null;
        }
      }, 400);
    }
  }

  private isDesktopMac(): boolean {
    const ua =
      typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    return (
      /Macintosh/i.test(ua) &&
      !(typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) &&
      !/Android|iPhone|iPad|iPod/i.test(ua)
    );
  }

  private syncARButtonLabel(btn: HTMLElement): void {
    const desktopMac = this.isDesktopMac();
    const label = desktopMac ? 'Quick Look (.usdz)' : 'View in AR';
    const ariaAndTitle = desktopMac
      ? 'Download .usdz preview for macOS Quick Look (live camera AR requires iOS or Android)'
      : 'View in Augmented Reality';
    if (typeof btn.setAttribute === 'function') {
      btn.setAttribute('aria-label', ariaAndTitle);
      btn.setAttribute('title', ariaAndTitle);
    }
    const span =
      (btn as any)._labelSpan ||
      (typeof btn.querySelector === 'function'
        ? btn.querySelector('span')
        : null);
    if (span) {
      span.textContent = label;
    }
  }

  private createARButton(): void {
    if (typeof document === 'undefined') return;
    if (!this.arButton) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'three-live-ar-button';
      btn.setAttribute('part', 'default-ar-button');

      // Build SVG icon and label via DOM APIs instead of innerHTML so
      // `require-trusted-types-for 'script'` is never violated.
      const svgNs = 'http://www.w3.org/2000/svg';
      if (typeof document.createElementNS === 'function') {
        const svg = document.createElementNS(svgNs, 'svg');
        for (const [k, v] of Object.entries({
          width: '20',
          height: '20',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })) {
          svg.setAttribute(k, v);
        }
        svg.style.marginRight = '6px';
        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute(
          'd',
          'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12',
        );
        svg.appendChild(path);
        btn.appendChild(svg);
      }
      const span = document.createElement('span');
      (btn as any)._labelSpan = span;
      btn.appendChild(span);
      this.syncARButtonLabel(btn);

      btn.style.cssText =
        'position:absolute;right:16px;bottom:16px;z-index:2;align-items:center;justify-content:center;padding:8px 16px;background-color:rgba(15,23,42,.85);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:9999px;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer;backdrop-filter:blur(8px);box-shadow:0 4px 12px rgba(0,0,0,.25);transition:transform .15s,background-color .15s;display:none';

      for (const [ev, bg, sc] of [
        ['mouseenter', 'rgba(30, 41, 59, 0.95)', 'scale(1.04)'],
        ['mouseleave', 'rgba(15, 23, 42, 0.85)', 'scale(1)'],
      ] as const) {
        btn.addEventListener(ev, () => {
          btn.style.backgroundColor = bg;
          btn.style.transform = sc;
        });
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activateAR();
      });

      this.arButton = btn;
      this.appendChild(btn);
    }
    this.updateARButtonVisibility();
  }

  public updateARButtonVisibility(): void {
    const showAR = this.hasAttribute('ar') && ThreeLiveElement.isARSupported();
    const customBtn =
      typeof this.querySelector === 'function'
        ? this.querySelector<HTMLElement>('[slot="ar-button"]')
        : null;

    if (customBtn) {
      if (this.arButton) {
        this.arButton.style.display = 'none';
      }
      if (!(customBtn as any).__tlARBound) {
        (customBtn as any).__tlARBound = true;
        customBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activateAR();
        });
      }
      if (customBtn.dataset.tlOrigDisplay === undefined) {
        customBtn.dataset.tlOrigDisplay =
          customBtn.style.display === 'none' ? '' : customBtn.style.display;
      }
      customBtn.style.display = showAR
        ? customBtn.dataset.tlOrigDisplay || ''
        : 'none';
    } else if (this.arButton) {
      this.syncARButtonLabel(this.arButton);
      this.arButton.style.display = showAR ? 'flex' : 'none';
    }
  }

  private applyCameraOrbit(cameraOrbitStr: string | null): void {
    if (!cameraOrbitStr || !this.viewer) return;
    try {
      const parsed: CameraState = JSON.parse(cameraOrbitStr);
      this.viewer.setInitialCamera(
        parsed.theta,
        parsed.phi,
        parsed.distance,
        parsed.zoom,
      );
    } catch {
      const o = this.parseOrbitLimit(cameraOrbitStr);
      if (o.theta !== undefined || o.phi !== undefined) {
        this.viewer.setInitialCamera(o.theta, o.phi, o.distance);
      }
    }
  }

  private parseOrbitLimit(str: string | null): {
    theta?: number;
    phi?: number;
    distance?: number;
  } {
    if (!str) return {};
    const [p0, p1, p2] = str.trim().split(/\s+/);
    const dist = p2 && p2 !== 'auto' ? parseFloat(p2) : NaN;
    return {
      theta: p0 && p0 !== 'auto' ? this.parseFieldOfView(p0) : undefined,
      phi: p1 && p1 !== 'auto' ? this.parseFieldOfView(p1) : undefined,
      distance: isNaN(dist) ? undefined : dist,
    };
  }

  private parseCameraTarget(
    targetStr: string | null,
  ): [number, number, number] | undefined {
    if (!targetStr) return undefined;
    const parts = targetStr.trim().split(/\s+/).map(parseFloat);
    return parts.length >= 3 && !parts.some(isNaN)
      ? [parts[0], parts[1], parts[2]]
      : undefined;
  }

  private parseFieldOfView(fovStr: string | null): number | undefined {
    if (!fovStr) return undefined;
    const v = parseFloat(fovStr);
    return isNaN(v)
      ? undefined
      : fovStr.endsWith('rad')
        ? (v * 180) / Math.PI
        : v;
  }

  private parseRotationPerSecond(rpsStr: string | null): number {
    if (!rpsStr) return Math.PI / 6;
    const s = rpsStr.trim();
    const num = parseFloat(s);
    if (isNaN(num)) return Math.PI / 6;
    if (s.endsWith('rad')) return num;
    if (s.endsWith('%')) return (num / 100) * Math.PI * 2;
    return (num * Math.PI) / 180;
  }

  public updateHotspot(config: {
    name: string;
    position?: string;
    normal?: string;
  }): void {
    const el = this.querySelector(`[slot="${config.name}"]`);
    if (el) {
      if (config.position !== undefined) {
        el.setAttribute('data-position', config.position);
      }
      if (config.normal !== undefined) {
        el.setAttribute('data-normal', config.normal);
      }
    }
    this.updateHotspots();
  }

  public updateHotspots(): void {
    for (const plugin of ThreeView.getRegisteredPlugins()) {
      if ((plugin as any).updateHotspotsForElement) {
        (plugin as any).updateHotspotsForElement(this, this.viewer);
        return;
      }
    }
  }

  private runWithScriptRunner(
    invokeRunner: (
      runner: ScriptRunner,
      callbacks: ScriptExecutionCallbacks,
    ) => Promise<ScriptExecutionHandle | void>,
  ): Promise<ArrayBuffer | GLBData | void> {
    const runner = getSharedRegistry().scriptRunner;
    if (!runner) {
      const error = new Error(
        'Script execution requires "three-live/full" or registerScriptRunner().',
      );
      this.showToast(error.message);
      this.emitError(error, 'script');
      return Promise.reject(error);
    }

    const current = this.beginLoad();
    const active = () => !current.signal.aborted;
    return new Promise<ArrayBuffer | GLBData | void>((resolve, reject) => {
      const abort = () => reject(current.signal.reason);
      current.signal.addEventListener('abort', abort, {once: true});
      if (!active()) {
        abort();
        return;
      }
      const callbacks: ScriptExecutionCallbacks = {
        onModelReady: (model) => {
          this.loadModelWithLimits(
            model,
            SANDBOX_HOST_SCENE_LIMITS,
            current,
          ).then(() => resolve(model), reject);
        },
        onUpdateTransforms: (transforms) => {
          if (active()) this.viewer?.updateMeshTransforms(transforms);
        },
        onError: (error) => {
          if (!active()) return;
          this.showToast(error.message);
          this.emitError(error, 'script');
          reject(error);
        },
        onToast: (message) => {
          if (active()) this.showToast(message);
        },
      };
      invokeRunner(runner, callbacks).then(
        (handle) => {
          if (active()) this.scriptHandle = handle || null;
          else handle?.terminate();
        },
        (error) => {
          if (active()) callbacks.onError?.(error);
        },
      );
    });
  }

  /**
   * Loads and compiles a server-generated Three.js scene script URL directly
   * inside the mandatory sandbox (Use Case 2).
   */
  loadScriptFromSrc(src: string): Promise<ArrayBuffer | GLBData | void> {
    return this.runWithScriptRunner((runner, callbacks) => {
      if (typeof runner.executeUrl !== 'function') {
        const error = new Error(
          'Registered ScriptRunner does not support executeUrl() for server-generated scripts.',
        );
        callbacks.onError?.(error);
        return Promise.reject(error);
      }
      return runner.executeUrl(src, this.sandbox, callbacks);
    });
  }

  /**
   * Compiles a client-modified Three.js scene script string inside the
   * mandatory sandbox (Use Case 1). Requires opting in via
   * `ThreeLiveElement.allowClientScripts = true` or `allow-client-scripts`.
   */
  executeScript(script: string): Promise<ArrayBuffer | GLBData | void> {
    if (!getSharedRegistry().scriptRunner) {
      return this.runWithScriptRunner(() => Promise.resolve());
    }
    if (!this.allowClientScripts) {
      const error = new Error(CLIENT_SCRIPTS_DISABLED_ERROR);
      this.showToast(CLIENT_SCRIPTS_DISABLED_TOAST);
      this.emitError(error, 'security');
      return Promise.reject(error);
    }
    return this.runWithScriptRunner((runner, callbacks) =>
      runner.execute(script, this.sandbox, callbacks, {
        allowClientScripts: true,
      }),
    );
  }
}

{
  interface AttrTarget {
    getAttr(name: string): string | null;
    setAttr(name: string, val: unknown): void;
    getBoolAttr(name: string): boolean;
    setBoolAttr(name: string, val: unknown): void;
    getFloatAttr(name: string, fallback: number): number;
  }
  const proto = ThreeLiveElement.prototype as unknown;
  const def = (
    prop: string,
    get: (this: AttrTarget) => unknown,
    set: (this: AttrTarget, v: unknown) => void,
  ) => Object.defineProperty(proto, prop, {get, set, configurable: true});
  const kebab = (s: string) =>
    s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  for (const p of 'src cameraOrbit cameraTarget minCameraOrbit maxCameraOrbit fieldOfView iosSrc scriptSrc poster selectedMesh environmentImage skyboxImage animationName'.split(
    ' ',
  )) {
    const a = kebab(p);
    def(
      p,
      function (this: AttrTarget) {
        return this.getAttr(a);
      },
      function (this: AttrTarget, v: unknown) {
        this.setAttr(a, v);
      },
    );
  }
  for (const p of 'cameraControls autoRotate outlineSelected autoplay'.split(
    ' ',
  )) {
    const a = kebab(p);
    def(
      p,
      function (this: AttrTarget) {
        return this.getBoolAttr(a);
      },
      function (this: AttrTarget, v: unknown) {
        this.setBoolAttr(a, v);
      },
    );
  }
  for (const [p, fb] of [
    ['exposure', 1],
    ['autoRotateDelay', 3000],
    ['shadowIntensity', 0],
    ['shadowSoftness', 0.5],
    ['bloom', 0],
  ] as const) {
    const a = kebab(p);
    def(
      p,
      function (this: AttrTarget) {
        return this.getFloatAttr(a, fb);
      },
      function (this: AttrTarget, v: unknown) {
        this.setAttr(a, v);
      },
    );
  }
  for (const [p, fb] of [
    ['rotationPerSecond', '30deg'],
    ['arScale', 'auto'],
    ['arPlacement', 'floor'],
    ['outlineColor', '#38bdf8'],
  ] as const) {
    const a = kebab(p);
    def(
      p,
      function (this: AttrTarget) {
        return this.getAttr(a) || fb;
      },
      function (this: AttrTarget, v: unknown) {
        this.setAttr(a, v);
      },
    );
  }
}

// Auto-register <three-live> custom element
if (
  typeof customElements !== 'undefined' &&
  !customElements.get('three-live')
) {
  customElements.define('three-live', ThreeLiveElement);
}

/**
 * Registers `ThreeLiveElement` under `<model-viewer>` (or a custom tag name)
 * when that element name is not already registered.
 */
export function defineModelViewer(tagName = 'model-viewer'): boolean {
  return ThreeLiveElement.defineModelViewer(tagName);
}
