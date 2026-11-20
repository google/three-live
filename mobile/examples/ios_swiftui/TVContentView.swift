/*
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

#if os(tvOS)
  import Combine
  import RealityKit
  import SwiftUI
  import ThreeLiveCompiler
  import UIKit

  /// Apple TV demo: compiles the shared preset scenes on device and explores them with the Siri
  /// Remote. Choose **Explore**, then swipe to orbit, click the clickpad ring (or press an arrow
  /// key or D-pad) to step the camera, click to select what is under the center reticle,
  /// Play/Pause to reset the view, and Menu to return to the scene list.
  struct TVContentView: View {
    private static let presets = SampleScenes.threeLivePresets + SampleScenes.xrLivePresets

    @State private var selectedIndex = 0
    @State private var scene: TVLoadedScene?
    @State private var isExploring = false
    @State private var statusMessage = ""
    @State private var errorMessage: String?
    @State private var compileGeneration = 0
    @FocusState private var isExploreFocused: Bool

    var body: some View {
      ZStack {
        TVViewport(
          scene: scene,
          isExploring: isExploring,
          onSelect: { name in
            statusMessage = name.map { "Selected \($0)" } ?? "Nothing selectable under the reticle"
            UIAccessibility.post(notification: .announcement, argument: statusMessage)
          },
          onExit: {
            isExploring = false
            // The scene list returns without a focused item unless one is requested.
            isExploreFocused = true
          }
        )
        .ignoresSafeArea()
        .accessibilityLabel(Text("3D view of \(Self.presets[selectedIndex].name)"))

        if isExploring {
          // A dark outline keeps the white ring visible over bright geometry.
          Circle()
            .stroke(Color.black.opacity(0.6), lineWidth: 6)
            .overlay(Circle().stroke(Color.white, lineWidth: 3))
            .frame(width: 28, height: 28)
            .accessibilityHidden(true)
        }

        VStack(alignment: .leading, spacing: 24) {
          hud
          Spacer()
          if isExploring {
            Text("Swipe to orbit · Click to select · Play/Pause to reset · Menu for scenes")
              .font(.callout)
              .foregroundColor(.white)
              .padding(.horizontal, 24)
              .padding(.vertical, 12)
              .background(.ultraThinMaterial, in: Capsule())
              .frame(maxWidth: .infinity)
              .accessibilityIdentifier("exploreHint")
          } else {
            sceneList
          }
        }
        .padding(60)
      }
      .task { await load(0) }
    }

    private var hud: some View {
      VStack(alignment: .leading, spacing: 8) {
        Text(Self.presets[selectedIndex].name)
          .font(.title2.bold())
          .accessibilityIdentifier("sceneTitle")
        Text(errorMessage ?? (scene == nil ? "Compiling…" : statusMessage))
          .font(.callout)
          .foregroundColor(errorMessage == nil ? .white.opacity(0.8) : .red)
          .accessibilityIdentifier("status")
      }
      .foregroundColor(.white)
      .padding(24)
      .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }

    private var sceneList: some View {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 32) {
          Button {
            isExploring = true
          } label: {
            Label("Explore", systemImage: "rotate.3d")
          }
          .disabled(scene == nil)
          .focused($isExploreFocused)
          .accessibilityIdentifier("explore")

          ForEach(Self.presets.indices, id: \.self) { index in
            Button {
              Task { await load(index) }
            } label: {
              VStack(spacing: 4) {
                Text(Self.presets[index].name)
                Text(Self.presets[index].mode.rawValue)
                  .font(.caption)
                  .foregroundColor(.secondary)
              }
            }
            .accessibilityIdentifier("preset-\(Self.presets[index].name)")
          }
        }
        .padding(.vertical, 40)
      }
    }

    @MainActor
    private func load(_ index: Int) async {
      compileGeneration += 1
      let generation = compileGeneration
      let preset = Self.presets[index]
      selectedIndex = index
      errorMessage = nil
      scene?.stop()
      scene = nil

      let start = DispatchTime.now()
      do {
        let glb = try await ThreeCompiler.compileGLB(preset.script)
        // A newer preset was chosen while compiling; skip the transcode and load.
        guard generation == compileGeneration else { return }
        let entity = try await RealityKitHelper.loadEntity(fromGLB: glb)
        guard generation == compileGeneration else { return }
        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e6
        guard
          let loaded = TVLoadedScene(
            glb: glb, entity: entity, mode: preset.mode,
            onEvent: { id in statusMessage = "Event '\(id)'" })
        else {
          errorMessage = "Could not bind the compiled scene to RealityKit."
          return
        }
        scene = loaded
        statusMessage = String(format: "Compiled and loaded in %.0f ms", elapsedMs)
      } catch {
        guard generation == compileGeneration else { return }
        errorMessage = error.localizedDescription
      }
    }
  }

  /// A compiled preset bound to the RealityKit runtime (behaviors, spatial traits, features).
  @MainActor
  final class TVLoadedScene {
    let entity: Entity
    let live: XRLiveRealityKitSession
    let features: XRSpatialRealityKitFeatures
    let cameraOptions: XRCameraOptions

    /// Returns `nil` when the session cannot read the GLB's glTF JSON.
    init?(glb: Data, entity: Entity, mode: StudioMode, onEvent: @escaping (String) -> Void) {
      guard let live = XRLiveRealityKitSession(glbData: glb, root: entity) else { return nil }
      self.entity = entity
      self.live = live
      for animation in entity.availableAnimations {
        _ = entity.playAnimation(animation.repeat())
      }
      cameraOptions = XRCameraOptions(
        cameraOrbit: mode == .threeLive ? "23deg 20deg" : "34deg 20deg",
        fieldOfView: "45deg",
        autoRotate: mode == .threeLive,
        autoRotateDelay: 1.5
      )
      live.installStudioLights()
      live.installInputTargets()
      live.onInteractivityEvent = { id, _ in onEvent(id) }
      live.start()
      features = XRSpatialRealityKitFeatures(live: live)
    }

    func step(dt: TimeInterval) {
      live.step(dt: dt)
      features.step(dt: dt)
    }

    func stop() {
      features.dispose()
      live.stop()
    }
  }

  /// Hosts `TVOrbitView` in SwiftUI.
  struct TVViewport: UIViewRepresentable {
    let scene: TVLoadedScene?
    let isExploring: Bool
    /// Called with the selected node's name, or `nil` when the reticle hits nothing selectable.
    let onSelect: (String?) -> Void
    let onExit: () -> Void

    func makeUIView(context: Context) -> TVOrbitView {
      TVOrbitView(frame: .zero)
    }

    func updateUIView(_ view: TVOrbitView, context: Context) {
      view.onSelect = onSelect
      view.onExit = onExit
      view.show(scene)
      view.isExploring = isExploring
    }
  }

  /// A focusable `ARView` driven by the Siri Remote, a game controller, or a keyboard.
  ///
  /// Focus is only accepted while exploring, so the view never takes focus from the scene list.
  /// When exploring ends nothing is focused, so the host must move focus back to its own UI
  /// (`TVContentView` focuses Explore). The camera works as in the iOS demo
  /// (`XROrbitCameraState`), and selection calls
  /// `XRLiveRealityKitSession.handleTap(at:in:)` at a fixed center reticle in place of a touch
  /// point. Remote buttons are tap recognizers, so a handled Menu press never
  /// reaches the system (which would leave the app); outside Explore the view has no focus and
  /// Menu behaves normally.
  final class TVOrbitView: ARView {
    /// One clickpad / arrow press orbits by this many drag points (about 15°).
    private static let orbitStepPoints = 32.0

    var isExploring = false {
      didSet {
        guard isExploring != oldValue else { return }
        setNeedsFocusUpdate()
        updateFocusIfNeeded()
      }
    }
    var onSelect: ((String?) -> Void)?
    var onExit: (() -> Void)?

    override var canBecomeFocused: Bool { isExploring }

    private let camera = PerspectiveCamera()
    private let pivot = Entity()
    private var orbit = XROrbitCameraState()
    private var loaded: TVLoadedScene?
    private var isPanning = false
    private var lastPanTranslation: CGPoint = .zero
    private var orbitCameraTransform = matrix_identity_float4x4
    private var updateSubscription: Cancellable?

    required init(frame frameRect: CGRect) {
      super.init(frame: frameRect)
      environment.background = .color(UIColor(red: 0.043, green: 0.071, blue: 0.125, alpha: 1))
      XRLiveRealityKitSession.configureStudioEnvironment(of: self)

      let cameraAnchor = AnchorEntity(world: .zero)
      cameraAnchor.addChild(camera)
      scene.addAnchor(cameraAnchor)
      let modelAnchor = AnchorEntity(world: .zero)
      modelAnchor.addChild(pivot)
      scene.addAnchor(modelAnchor)

      let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
      pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirect.rawValue)]
      addGestureRecognizer(pan)
      addPressRecognizer(.select, #selector(handleSelect))
      addPressRecognizer(.playPause, #selector(resetCamera))
      addPressRecognizer(.menu, #selector(handleMenu))
      addPressRecognizer(.leftArrow, #selector(orbitLeft))
      addPressRecognizer(.rightArrow, #selector(orbitRight))
      addPressRecognizer(.upArrow, #selector(orbitUp))
      addPressRecognizer(.downArrow, #selector(orbitDown))

      updateSubscription = scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
        self?.update(dt: min(max(event.deltaTime, 0), 0.1))
      }
    }

    @available(*, unavailable)
    required init?(coder decoder: NSCoder) {
      fatalError("init(coder:) is not supported")
    }

    /// Shows `newScene` (or nothing) and frames the camera on it.
    func show(_ newScene: TVLoadedScene?) {
      guard newScene !== loaded else { return }
      loaded = newScene
      pivot.children.removeAll()
      if let newScene = newScene {
        pivot.addChild(newScene.entity)
        newScene.live.headPoseProvider = { [weak self] in
          self.map { XRPose(matrix: $0.orbitCameraTransform) }
        }
        newScene.features.cameraTransformProvider = { [weak self] in self?.orbitCameraTransform }
      }
      resetCamera()
    }

    @objc private func resetCamera() {
      orbit = XROrbitCameraState()
      if let loaded = loaded {
        let bounds = loaded.live.session.sceneBounds
        orbit.apply(loaded.cameraOptions)
        orbit.setBounds(center: bounds.center, radius: bounds.radius)
      }
      camera.camera.fieldOfViewInDegrees = Float(orbit.fieldOfViewDeg)
    }

    private func update(dt: TimeInterval) {
      // Auto-rotate pauses while exploring, so the model holds still under the reticle.
      _ = orbit.step(
        dt: dt, now: ProcessInfo.processInfo.systemUptime, pointerDown: isPanning || isExploring)
      let eye = SIMD3<Float>(orbit.eye)
      camera.look(at: SIMD3<Float>(orbit.target), from: eye, relativeTo: nil)
      pivot.setTransformMatrix(orbit.turntableMatrix, relativeTo: nil)
      orbitCameraTransform = camera.transformMatrix(relativeTo: nil)
      loaded?.step(dt: dt)
    }

    // MARK: Input

    private func addPressRecognizer(_ type: UIPress.PressType, _ action: Selector) {
      let tap = UITapGestureRecognizer(target: self, action: action)
      tap.allowedPressTypes = [NSNumber(value: type.rawValue)]
      addGestureRecognizer(tap)
    }

    /// Orbits by the touch-surface swipe since the last update.
    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
      let translation = recognizer.translation(in: self)
      let now = ProcessInfo.processInfo.systemUptime
      switch recognizer.state {
      case .began:
        isPanning = true
        lastPanTranslation = translation
      case .changed:
        orbit.drag(
          dx: Double(translation.x - lastPanTranslation.x),
          dy: Double(translation.y - lastPanTranslation.y), now: now)
        lastPanTranslation = translation
      default:
        isPanning = false
        orbit.touch(now: now)
      }
    }

    /// One clickpad-ring or arrow press orbits one step in that direction.
    private func orbitStep(dx: Double, dy: Double) {
      let step = Self.orbitStepPoints
      orbit.drag(dx: dx * step, dy: dy * step, now: ProcessInfo.processInfo.systemUptime)
    }

    @objc private func orbitLeft() { orbitStep(dx: -1, dy: 0) }
    @objc private func orbitRight() { orbitStep(dx: 1, dy: 0) }
    @objc private func orbitUp() { orbitStep(dx: 0, dy: -1) }
    @objc private func orbitDown() { orbitStep(dx: 0, dy: 1) }

    @objc private func handleSelect() {
      let center = CGPoint(x: bounds.midX, y: bounds.midY)
      // Name the entity before the session dispatches the select: an `onSelect` behavior can
      // hide or move it, and a later hit test would then miss it or find what is behind it.
      guard let hit = hitTest(center, query: .nearest, mask: .all).first,
        loaded?.live.handleTap(at: center, in: self) == true
      else {
        onSelect?(nil)
        return
      }
      onSelect?(hit.entity.name.isEmpty ? "mesh" : hit.entity.name)
    }

    @objc private func handleMenu() {
      onExit?()
    }
  }
#endif
