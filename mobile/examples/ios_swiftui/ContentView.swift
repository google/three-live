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

#if os(iOS)
  import Combine
  import RealityKit
  import SwiftUI
  import ThreeLiveCompiler

  @available(iOS 15.0, *)
  public struct ContentView: View {

    @State private var selectedMode: StudioMode = .threeLive
    @State private var renderedMode: StudioMode = .threeLive
    @State private var selectedPresetIndex = 0
    @State private var selectedAiEditIndex = -1
    @State private var jsScriptText = SampleScenes.threeLivePresets[0].script
    @State private var isCompiling = false
    @State private var compileGeneration: Int = 0
    @State private var compileLatencyMs: Double? = nil
    @State private var usdzSizeBytes: Int? = nil
    @State private var usdzData: Data? = nil
    @State private var extractedXrTraits: [String: XRLiveEntityTraits] = [:]
    @State private var errorMessage: String? = nil
    @State private var lastEventMessage: String? = nil

    @State private var currentEntity: Entity? = nil
    @State private var currentSceneBounds: (center: SIMD3<Double>, radius: Double) = (.zero, 1.48)
    @State private var runtimeSession: XRLiveRealityKitSession? = nil
    @State private var runtimeFeatures: XRSpatialRealityKitFeatures? = nil
    @State private var cameraDistanceMode: String = "auto"
    @State private var cameraResetToken: Int = 0

    // Full-screen in-app AR Surface Placement Preview state (used on the iOS Simulator where
    // ARWorldTrackingConfiguration camera passthrough is unavailable in QLPreviewController).
    @State private var isArPreviewMode: Bool = false
    @State private var arPreviewNote: String? = nil
    @State private var arShowReticle: Bool = true
    @State private var arAutoRotate: Bool = false
    @State private var arScalePreset: Float = 1.0

    // Bring-Your-Own-Account (BYOA) Live AI Editing & Evergreen Model Discovery state
    @State private var aiEditor: AIEditor? = nil
    @State private var aiProviderKind: String =
      UserDefaults.standard.string(forKey: "three_live_byoa_provider") ?? "gemini"
    @State private var aiApiKey: String =
      UserDefaults.standard.string(forKey: "three_live_byoa_key") ?? ""
    @State private var aiModelId: String =
      UserDefaults.standard.string(forKey: "three_live_byoa_model") ?? "gemini-flash-latest"
    @State private var aiCustomBaseUrl: String =
      UserDefaults.standard.string(forKey: "three_live_byoa_base_url")
      ?? "http://localhost:11434/v1"
    @State private var aiRememberKey: Bool =
      UserDefaults.standard.bool(forKey: "three_live_byoa_remember")
    @State private var showAiConnectSheet: Bool = false
    @State private var liveAiPrompt: String = ""
    @State private var isAiEditing: Bool = false
    @State private var canUndoAiEdit: Bool = false
    @State private var selectedTargetMesh: String? = nil
    @State private var aiStatusMessage: String? = nil
    @State private var discoveredModels: [String] = ["gemini-flash-latest", "gemini-pro-latest"]

    private var isAiConnected: Bool {
      aiProviderKind == "custom" || !aiApiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var activePresets: [ScenePreset] {
      SampleScenes.presets(for: selectedMode)
    }

    private var currentCameraOptions: XRCameraOptions {
      let autoRot = isArPreviewMode ? arAutoRotate : (renderedMode == .threeLive)
      let initialOrbit = renderedMode == .threeLive ? "23deg 20deg" : "34deg 20deg"
      return XRCameraOptions(
        cameraOrbit: initialOrbit,
        fieldOfView: "45deg",
        cameraControls: true,
        autoRotate: autoRot,
        autoRotateDelay: 1.5,
        distanceMode: cameraDistanceMode
      )
    }

    public init() {}

    public var body: some View {
      NavigationView {
        GeometryReader { geo in
          VStack(spacing: 0) {
            // Top Section: 3D RealityKit Viewport (42% height in Studio mode, 100% in AR Preview mode)
            ZStack(alignment: .topLeading) {
              Color(red: 0.043, green: 0.071, blue: 0.125)
                .edgesIgnoringSafeArea(.all)

              ModelViewportRepresentable(
                entity: currentEntity,
                sceneBounds: currentSceneBounds,
                cameraOptions: currentCameraOptions,
                modelScale: isArPreviewMode ? arScalePreset : 1.0,
                resetToken: cameraResetToken,
                runtimeSession: runtimeSession,
                runtimeFeatures: runtimeFeatures,
                onTapNode: { nodeLabel in
                  lastEventMessage = "Tapped \(nodeLabel)"
                  selectedTargetMesh = aiEditor?.toggleSelection(nodeLabel) ?? nodeLabel
                }
              )

              if isArPreviewMode {
                let activePresetName =
                  selectedPresetIndex < activePresets.count
                  ? activePresets[selectedPresetIndex].name
                  : "Three-Live Scene"
                VStack(alignment: .leading, spacing: 8) {
                  // Top AR HUD Bar
                  HStack(spacing: 8) {
                    Image(systemName: "arkit")
                      .foregroundColor(.green)
                    VStack(alignment: .leading, spacing: 2) {
                      Text("AR Surface Preview • \(activePresetName)")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                      if let note = arPreviewNote {
                        Text(note)
                          .font(.system(size: 10))
                          .foregroundColor(Color.white.opacity(0.75))
                          .lineLimit(2)
                      }
                    }
                    Spacer()
                    Button(action: {
                      Task { await presentSystemQuickLookSheet() }
                    }) {
                      Text("Quick Look")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.blue.opacity(0.85))
                        .cornerRadius(8)
                    }
                    Button(action: {
                      exitArPreview()
                    }) {
                      HStack(spacing: 4) {
                        Image(systemName: "xmark")
                        Text("Exit AR")
                      }
                      .font(.system(size: 11, weight: .semibold))
                      .foregroundColor(.white)
                      .padding(.horizontal, 10)
                      .padding(.vertical, 6)
                      .background(Color.white.opacity(0.18))
                      .cornerRadius(8)
                    }
                  }
                  .padding(10)
                  .background(Color.black.opacity(0.82))
                  .cornerRadius(12)

                  // Reticle & Auto-Rotate Toggles
                  HStack(spacing: 8) {
                    Button(action: {
                      arShowReticle.toggle()
                      runtimeSession?.setArSurfacePreviewEnabled(arShowReticle, groundY: -0.95)
                    }) {
                      Text("Surface Reticle & Grid")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(arShowReticle ? .black : .white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(arShowReticle ? Color.green : Color.black.opacity(0.75))
                        .cornerRadius(8)
                    }

                    Button(action: {
                      arAutoRotate.toggle()
                    }) {
                      Text("Auto-Rotate")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(arAutoRotate ? .black : .white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(arAutoRotate ? Color.cyan : Color.black.opacity(0.75))
                        .cornerRadius(8)
                    }
                  }

                  Spacer()

                  if let eventMsg = lastEventMessage {
                    Text(eventMsg)
                      .font(.system(.caption2, design: .monospaced))
                      .foregroundColor(.white)
                      .padding(.horizontal, 10)
                      .padding(.vertical, 5)
                      .background(Color.black.opacity(0.75))
                      .cornerRadius(12)
                  }

                  // Bottom AR Placement Controls Bar
                  VStack(alignment: .leading, spacing: 8) {
                    Text("Drag: Orbit • Pinch: Scale • Tap: Interact with 3D Objects")
                      .font(.system(size: 11))
                      .foregroundColor(Color.white.opacity(0.8))

                    HStack(spacing: 8) {
                      Text("AR Scale:")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                      ForEach(
                        [(Float(0.75), "0.75×"), (Float(1.0), "1.0×"), (Float(1.5), "1.5×")],
                        id: \.0
                      ) {
                        (scaleVal, label) in
                        Button(action: {
                          arScalePreset = scaleVal
                        }) {
                          Text(label)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(arScalePreset == scaleVal ? .black : .white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                              arScalePreset == scaleVal ? Color.green : Color.white.opacity(0.15)
                            )
                            .cornerRadius(8)
                        }
                      }
                      Spacer()
                      Button(action: {
                        arScalePreset = 1.0
                        cameraResetToken += 1
                      }) {
                        Text("Reset Pose")
                          .font(.system(size: 11, weight: .semibold))
                          .foregroundColor(.white)
                          .padding(.horizontal, 10)
                          .padding(.vertical, 5)
                          .background(Color.white.opacity(0.18))
                          .cornerRadius(8)
                      }
                    }
                  }
                  .padding(12)
                  .background(Color.black.opacity(0.82))
                  .cornerRadius(12)
                }
                .padding(12)
              } else {
                // Stacked Top-Left Status Pills (never collide on narrow screens)
                VStack(alignment: .leading, spacing: 6) {
                  if selectedMode == .xrLive, !extractedXrTraits.isEmpty, errorMessage == nil {
                    let grabCount = extractedXrTraits.values.filter { $0.grabbable == true }.count
                    let dynCount = extractedXrTraits.values.filter { $0.physics == "dynamic" }.count
                    let bbCount =
                      extractedXrTraits.values.filter { ($0.billboard ?? "").isEmpty == false }
                      .count
                    let orbitCount = extractedXrTraits.values.filter { $0.orbit != nil }.count
                    HStack(spacing: 6) {
                      Image(systemName: "visionpro")
                        .foregroundColor(.purple)
                      Text(
                        "XR-Live: \(extractedXrTraits.count) Nodes (\(grabCount) Grab • \(dynCount) Physics • \(bbCount) Billboard • \(orbitCount) Orbit)"
                      )
                      .font(.system(.caption2, design: .monospaced))
                      .fontWeight(.semibold)
                      .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.ultraThinMaterial)
                    .cornerRadius(12)
                  }

                  if let ms = compileLatencyMs, let bytes = usdzSizeBytes, errorMessage == nil {
                    HStack(spacing: 6) {
                      Image(systemName: "bolt.fill")
                        .foregroundColor(.yellow)
                      Text(
                        "Compiled in \(String(format: "%.2f", locale: .current, ms)) ms • \(bytes) B USDZ"
                      )
                      .font(.system(.caption2, design: .monospaced))
                      .fontWeight(.semibold)
                      .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.ultraThinMaterial)
                    .cornerRadius(12)
                  }
                }
                .padding(10)

                if let eventMsg = lastEventMessage {
                  VStack {
                    Spacer()
                    HStack {
                      Text(eventMsg)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.black.opacity(0.75))
                        .cornerRadius(12)
                      Spacer()
                    }
                    .padding(10)
                  }
                }
              }
            }
            .frame(height: isArPreviewMode ? geo.size.height : geo.size.height * 0.42)

            if !isArPreviewMode {
              // Bottom Section: Editor & Controls
              VStack(alignment: .leading, spacing: 6) {
                // Mode Toggle: Three-Live | XR-Live
                Picker("Mode", selection: $selectedMode) {
                  ForEach(StudioMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                  }
                }
                .pickerStyle(.segmented)
                .onChange(of: selectedMode) { newMode in
                  selectedPresetIndex = 0
                  selectedAiEditIndex = -1
                  let presets = SampleScenes.presets(for: newMode)
                  if let first = presets.first {
                    jsScriptText = first.script
                    Task { await compileAndRender() }
                  }
                }

                // Scrollable Preset Chips Row
                ScrollView(.horizontal, showsIndicators: false) {
                  HStack(spacing: 8) {
                    Text("Presets:")
                      .font(.caption)
                      .fontWeight(.bold)
                    ForEach(0..<activePresets.count, id: \.self) { idx in
                      Button(action: {
                        selectedPresetIndex = idx
                        selectedAiEditIndex = -1
                        jsScriptText = activePresets[idx].script
                        Task { await compileAndRender() }
                      }) {
                        Text(activePresets[idx].name)
                          .font(.system(size: 12, weight: .semibold))
                          .padding(.horizontal, 10)
                          .padding(.vertical, 6)
                          .background(
                            selectedPresetIndex == idx
                              ? Color.accentColor.opacity(0.22)
                              : Color(UIColor.secondarySystemBackground)
                          )
                          .foregroundColor(selectedPresetIndex == idx ? .accentColor : .primary)
                          .cornerRadius(8)
                      }
                    }
                  }
                }

                // Instant Sample AI Edits Row (pre-baked edits; live edits use BYOA bar below)
                if selectedPresetIndex < activePresets.count,
                  !activePresets[selectedPresetIndex].sampleEdits.isEmpty
                {
                  let currentPreset = activePresets[selectedPresetIndex]
                  ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                      Text("✦ AI Edits:")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.purple)
                      ForEach(0..<currentPreset.sampleEdits.count, id: \.self) { editIdx in
                        let edit = currentPreset.sampleEdits[editIdx]
                        Button(action: {
                          selectedAiEditIndex = editIdx
                          jsScriptText = edit.script
                          Task { await compileAndRender() }
                        }) {
                          Text("“\(edit.prompt)”")
                            .font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                              selectedAiEditIndex == editIdx
                                ? Color.purple.opacity(0.22)
                                : Color(UIColor.secondarySystemBackground)
                            )
                            .foregroundColor(selectedAiEditIndex == editIdx ? .purple : .primary)
                            .cornerRadius(8)
                        }
                      }
                      if selectedAiEditIndex >= 0 {
                        Button(action: {
                          selectedAiEditIndex = -1
                          jsScriptText = currentPreset.script
                          Task { await compileAndRender() }
                        }) {
                          Text("↺ Reset")
                            .font(.system(size: 11, weight: .semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color(UIColor.tertiarySystemBackground))
                            .foregroundColor(.secondary)
                            .cornerRadius(8)
                        }
                      }
                    }
                  }
                }

                // Live BYOA AI Prompt Bar (Evergreen Model Aliases + Rust Sandbox Auto-Repair)
                HStack(spacing: 6) {
                  TextField(
                    selectedTargetMesh != nil
                      ? "Edit \(selectedTargetMesh ?? "")…"
                      : "Ask AI to edit scene…",
                    text: $liveAiPrompt
                  )
                  .font(.system(size: 12))
                  .textFieldStyle(.roundedBorder)

                  Button(action: {
                    Task { await runLiveAiEdit() }
                  }) {
                    Text(isAiEditing ? "…" : "Apply")
                      .font(.system(size: 11, weight: .semibold))
                      .padding(.horizontal, 10)
                      .padding(.vertical, 6)
                      .background(Color.purple.opacity(0.2))
                      .foregroundColor(.purple)
                      .cornerRadius(8)
                  }
                  .disabled(isAiEditing || isCompiling)

                  Button(action: {
                    Task {
                      if let editor = aiEditor, (try? await editor.undo()) == true {
                        aiStatusMessage = "Reverted last AI edit"
                      } else {
                        canUndoAiEdit = false
                      }
                    }
                  }) {
                    Text("↶")
                      .font(.system(size: 12, weight: .bold))
                      .padding(.horizontal, 8)
                      .padding(.vertical, 6)
                      .background(Color(UIColor.secondarySystemBackground))
                      .foregroundColor(.primary)
                      .cornerRadius(8)
                  }
                  .disabled(!canUndoAiEdit || isAiEditing)

                  Button(action: {
                    showAiConnectSheet = true
                  }) {
                    Text(isAiConnected ? "🟢 AI" : "🔑 AI")
                      .font(.system(size: 11, weight: .semibold))
                      .padding(.horizontal, 8)
                      .padding(.vertical, 6)
                      .background(Color(UIColor.secondarySystemBackground))
                      .foregroundColor(.primary)
                      .cornerRadius(8)
                  }
                }

                if let statusMsg = aiStatusMessage {
                  Text(statusMsg)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.purple)
                    .lineLimit(1)
                }

                // Three.js Code Editor Header Row + Camera Distance Mode Toggle
                HStack {
                  Text("Three.js Source (Tap/Edit):")
                    .font(.caption)
                    .foregroundColor(.secondary)
                  Spacer()
                  Button(action: {
                    cameraDistanceMode = (cameraDistanceMode == "auto") ? "absolute" : "auto"
                    cameraResetToken += 1
                  }) {
                    Text(
                      cameraDistanceMode == "auto"
                        ? "Camera: Auto (2.5×)" : "Camera: Fixed (3.0m)"
                    )
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(6)
                  }
                }

                // Monospace Code Editor Text Area
                ZStack(alignment: .topLeading) {
                  RoundedRectangle(cornerRadius: 8)
                    .fill(Color(UIColor.secondarySystemBackground))
                    .overlay(
                      RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                    )

                  TextEditor(text: $jsScriptText)
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .padding(6)
                    .background(Color.clear)
                }
                .frame(minHeight: 110, maxHeight: .infinity)

                // Error Banner
                if let err = errorMessage {
                  HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                      .foregroundColor(.red)
                    Text(err)
                      .font(.system(size: 11, design: .monospaced))
                      .foregroundColor(.red)
                  }
                  .padding(8)
                  .background(Color.red.opacity(0.12))
                  .cornerRadius(6)
                }

                // Action Bar: Equal-width View in AR + Compile & Render Buttons
                HStack(spacing: 8) {
                  Button(action: {
                    Task { await launchARQuickLook() }
                  }) {
                    HStack(spacing: 6) {
                      Image(systemName: "arkit")
                      Text("View in AR")
                        .lineLimit(1)
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.green)
                    .cornerRadius(10)
                  }
                  .disabled(isCompiling || usdzData == nil)

                  Button(action: {
                    Task { await compileAndRender() }
                  }) {
                    HStack(spacing: 6) {
                      if isCompiling {
                        ProgressView()
                          .progressViewStyle(CircularProgressViewStyle(tint: .white))
                          .scaleEffect(0.8)
                        Text("Compiling...")
                          .lineLimit(1)
                      } else {
                        Image(systemName: "play.fill")
                        Text("Compile & Render")
                          .lineLimit(1)
                      }
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.blue)
                    .cornerRadius(10)
                  }
                  .disabled(isCompiling)
                }
              }
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .background(Color(UIColor.systemBackground))
            }
          }
        }
        .navigationTitle("Three-Live & XR-Live Studio")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarHidden(isArPreviewMode)
      }
      .navigationViewStyle(.stack)
      .sheet(isPresented: $showAiConnectSheet) {
        NavigationView {
          Form {
            Section(header: Text("AI Provider (Bring Your Own Account)")) {
              Picker("Provider", selection: $aiProviderKind) {
                Text("Gemini").tag("gemini")
                Text("OpenRouter").tag("openrouter")
                Text("Local / Custom").tag("custom")
              }
              .pickerStyle(.segmented)
              .onChange(of: aiProviderKind) { newKind in
                switch newKind {
                case "gemini":
                  aiModelId = "gemini-flash-latest"
                  discoveredModels = ["gemini-flash-latest", "gemini-pro-latest"]
                case "openrouter":
                  aiModelId = "openrouter/auto"
                  discoveredModels = ["openrouter/auto"]
                default:
                  aiModelId = ""
                  discoveredModels = []
                }
              }

              if aiProviderKind == "custom" {
                TextField("Base URL (e.g. http://localhost:11434/v1)", text: $aiCustomBaseUrl)
                  .font(.system(.caption, design: .monospaced))
                  .autocapitalization(.none)
                  .disableAutocorrection(true)
              }

              SecureField(
                aiProviderKind == "custom" ? "API Key (Optional)" : "Bearer API Key",
                text: $aiApiKey
              )
              .font(.system(.caption, design: .monospaced))
              .autocapitalization(.none)
              .disableAutocorrection(true)
            }

            Section(
              header: Text("Model (Evergreen Alias or Live ID)"),
              footer: Text(
                "Gemini defaults to gemini-flash-latest (rolling alias for the newest Gemini Flash, or pick gemini-pro-latest). OpenRouter defaults to openrouter/auto. Local servers use their loaded model when left blank."
              )
            ) {
              HStack {
                TextField("Server default", text: $aiModelId)
                  .font(.system(.caption, design: .monospaced))
                  .autocapitalization(.none)
                  .disableAutocorrection(true)
                Button("↻ Models") {
                  Task { await fetchLiveModels() }
                }
                .font(.system(size: 12, weight: .semibold))
              }

              if !discoveredModels.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                  HStack(spacing: 6) {
                    ForEach(discoveredModels.prefix(12), id: \.self) { m in
                      Button(action: { aiModelId = m }) {
                        Text(m)
                          .font(.system(size: 10, weight: .medium, design: .monospaced))
                          .padding(.horizontal, 8)
                          .padding(.vertical, 4)
                          .background(
                            aiModelId == m
                              ? Color.purple.opacity(0.22)
                              : Color(UIColor.secondarySystemBackground)
                          )
                          .cornerRadius(6)
                      }
                    }
                  }
                }
              }

              Toggle("Remember on this device", isOn: $aiRememberKey)
                .font(.caption)
            }
          }
          .navigationTitle("Connect AI Provider")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("Disconnect") {
                aiApiKey = ""
                persistByoaSettings(clear: true)
                showAiConnectSheet = false
              }
            }
            ToolbarItem(placement: .confirmationAction) {
              Button("Save & Connect") {
                persistByoaSettings(clear: !aiRememberKey)
                showAiConnectSheet = false
              }
            }
          }
        }
      }
      .task {
        // Initial compilation on startup
        await compileAndRender()
      }
    }

    @MainActor
    private func persistByoaSettings(clear: Bool) {
      let defaults = UserDefaults.standard
      if clear {
        defaults.removeObject(forKey: "three_live_byoa_provider")
        defaults.removeObject(forKey: "three_live_byoa_key")
        defaults.removeObject(forKey: "three_live_byoa_model")
        defaults.removeObject(forKey: "three_live_byoa_base_url")
        defaults.removeObject(forKey: "three_live_byoa_remember")
      } else {
        defaults.set(aiProviderKind, forKey: "three_live_byoa_provider")
        defaults.set(aiApiKey, forKey: "three_live_byoa_key")
        defaults.set(aiModelId, forKey: "three_live_byoa_model")
        defaults.set(aiCustomBaseUrl, forKey: "three_live_byoa_base_url")
        defaults.set(aiRememberKey, forKey: "three_live_byoa_remember")
      }
    }

    private func buildActiveAiProvider() -> AIChatProvider? {
      let baseUrl: String
      switch aiProviderKind {
      case "openrouter":
        baseUrl = "https://openrouter.ai/api/v1"
      case "custom":
        baseUrl = aiCustomBaseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
          .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
      default:
        baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai"
      }
      let trimmedKey = aiApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
      if aiProviderKind != "custom" && trimmedKey.isEmpty {
        return nil
      }
      var headers: [String: String] = [:]
      if !trimmedKey.isEmpty {
        headers["Authorization"] = "Bearer \(trimmedKey)"
      }
      let trimmedModel = aiModelId.trimmingCharacters(in: .whitespacesAndNewlines)
      return AIChatProvider(
        endpoint: "\(baseUrl)/chat/completions",
        model: trimmedModel.isEmpty ? nil : trimmedModel,
        headers: headers
      )
    }

    @MainActor
    private func ensureAiEditor(provider: AIProvider) -> AIEditor {
      if let existing = aiEditor {
        existing.provider = provider
        return existing
      }
      let created = AIEditor(
        source: jsScriptText,
        provider: provider,
        applyScene: { code in
          await MainActor.run {
            jsScriptText = code
          }
          await compileAndRender()
        }
      )
      aiEditor = created
      return created
    }

    @MainActor
    private func runLiveAiEdit() async {
      let prompt = liveAiPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !prompt.isEmpty else { return }
      guard let provider = buildActiveAiProvider() else {
        showAiConnectSheet = true
        return
      }
      let editor = ensureAiEditor(provider: provider)
      if editor.source != jsScriptText {
        editor.resetSource(jsScriptText)
      }
      editor.selection = selectedTargetMesh
      isAiEditing = true
      aiStatusMessage = "Generating & validating edit in Rust sandbox…"
      let res = await editor.editScene(prompt)
      if res.applied {
        selectedAiEditIndex = -1
        canUndoAiEdit = true
        liveAiPrompt = ""
        aiStatusMessage =
          res.repairs > 0
          ? "Applied live edit (\(res.repairs) auto-repair)"
          : "Applied live AI edit"
      } else {
        aiStatusMessage = "Sandbox rejected edit: \(res.error ?? "Failed")"
      }
      isAiEditing = false
    }

    @MainActor
    private func fetchLiveModels() async {
      let baseUrl: String
      switch aiProviderKind {
      case "openrouter":
        baseUrl = "https://openrouter.ai/api/v1"
      case "custom":
        baseUrl = aiCustomBaseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
          .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
      default:
        baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai"
      }
      guard let url = URL(string: "\(baseUrl)/models") else { return }
      var req = URLRequest(url: url)
      req.httpMethod = "GET"
      req.timeoutInterval = 10
      let trimmedKey = aiApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmedKey.isEmpty {
        req.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
      }
      do {
        let (data, _) = try await URLSession.shared.data(for: req)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          return
        }
        let items =
          (root["data"] as? [[String: Any]]) ?? (root["models"] as? [[String: Any]]) ?? []
        var out: [String] = []
        if aiProviderKind == "gemini" {
          out.append(contentsOf: ["gemini-flash-latest", "gemini-pro-latest"])
        } else if aiProviderKind == "openrouter" {
          out.append("openrouter/auto")
        }
        let skipPattern = "embedding|imagen|veo|aqa|tts|whisper|moderation|audio|robotics"
        for item in items {
          let raw = (item["id"] as? String) ?? (item["name"] as? String) ?? ""
          let clean = raw.hasPrefix("models/") ? String(raw.dropFirst("models/".count)) : raw
          if !clean.isEmpty,
            clean.range(of: skipPattern, options: [.regularExpression, .caseInsensitive]) == nil,
            !out.contains(clean)
          {
            out.append(clean)
          }
        }
        discoveredModels = out
        aiStatusMessage = "Loaded \(out.count) live models"
      } catch {
        aiStatusMessage = "Models fetch: \(error.localizedDescription)"
      }
    }

    @MainActor
    private func enterArPreview(note: String) {
      arPreviewNote = note
      arScalePreset = 1.0
      arAutoRotate = false
      arShowReticle = true
      isArPreviewMode = true
      cameraResetToken += 1
      runtimeSession?.setArSurfacePreviewEnabled(true, groundY: -0.95)
    }

    @MainActor
    private func exitArPreview() {
      runtimeSession?.setArSurfacePreviewEnabled(false)
      isArPreviewMode = false
      arPreviewNote = nil
      arScalePreset = 1.0
      cameraResetToken += 1
    }

    @MainActor
    private func compileAndRender() async {
      compileGeneration += 1
      let generation = compileGeneration
      let targetMode = selectedMode
      let scriptToCompile = jsScriptText

      isCompiling = true
      errorMessage = nil

      // Immediately blank the 3D viewport before compiling so the previous scene
      // never jumps or resizes when switching presets or modes.
      runtimeFeatures?.dispose()
      runtimeFeatures = nil
      runtimeSession?.stop()
      runtimeSession = nil
      currentEntity = nil

      let startTime = DispatchTime.now()
      do {
        // Compile procedural script to native USDZ Data & extract XR-Live spatial traits from GLB
        let data = try await ThreeCompiler.compileUSDZ(scriptToCompile)
        let endTime = DispatchTime.now()
        let nanos = endTime.uptimeNanoseconds - startTime.uptimeNanoseconds

        let glbData = try await ThreeCompiler.compileGLB(scriptToCompile)
        let traits = RealityKitHelper.extractXRTraits(fromGLB: glbData)
        let entity = try await RealityKitHelper.loadEntity(fromUSDZ: data)
        guard generation == compileGeneration else { return }

        for anim in entity.availableAnimations {
          _ = entity.playAnimation(anim.repeat())
        }

        var newBounds: (center: SIMD3<Double>, radius: Double) = (.zero, 1.48)
        var newSession: XRLiveRealityKitSession? = nil
        var newFeatures: XRSpatialRealityKitFeatures? = nil

        if let live = XRLiveRealityKitSession(glbData: glbData, root: entity) {
          newBounds = live.session.sceneBounds
          live.installStudioLights()
          live.installInputTargets()
          live.headPoseProvider = {
            XRPose(position: SIMD3<Float>(0, 1.2, 3.5))
          }
          live.onInteractivityEvent = { id, payload in
            lastEventMessage = "Event '\(id)' \(payload)"
          }
          live.start()
          if isArPreviewMode && arShowReticle {
            live.setArSurfacePreviewEnabled(true, groundY: -0.95)
          }
          let features = XRSpatialRealityKitFeatures(live: live)
          features.onHandlesChange = { mesh, scale, yawDeg in
            lastEventMessage =
              String(format: "Handles %@: scale %.2f×, yaw %.0f°", mesh, scale, yawDeg)
          }
          newSession = live
          newFeatures = features
        } else {
          let vb = entity.visualBounds(recursive: true, relativeTo: entity)
          if !vb.isEmpty {
            let halfDiag = Double(0.5 * simd_length(vb.max - vb.min))
            let c = vb.center.x.isFinite ? vb.center : .zero
            newBounds = (
              center: SIMD3<Double>(Double(c.x), Double(c.y), Double(c.z)),
              radius: halfDiag.isFinite ? max(halfDiag, 0.5) : 1.48
            )
          }
          if !traits.isEmpty {
            RealityKitHelper.applyXRTraits(traits, to: entity)
          }
        }

        compileLatencyMs = Double(nanos) / 1_000_000.0
        extractedXrTraits = traits
        usdzData = data
        usdzSizeBytes = data.count
        renderedMode = targetMode
        currentSceneBounds = newBounds
        runtimeSession = newSession
        runtimeFeatures = newFeatures
        currentEntity = entity
        cameraResetToken += 1
        errorMessage = nil
      } catch {
        guard generation == compileGeneration else { return }
        errorMessage = error.localizedDescription
      }
      if generation == compileGeneration {
        isCompiling = false
      }
    }

    @MainActor
    private func launchARQuickLook() async {
      guard usdzData != nil else {
        errorMessage = "Compile a scene before viewing it in AR."
        return
      }
      if !QuickLookHelper.isARPlacementSupported {
        enterArPreview(
          note:
            "ARKit camera passthrough is unavailable on iOS Simulator — running built-in AR Surface Preview"
        )
        return
      }
      await presentSystemQuickLookSheet()
    }

    @MainActor
    private func presentSystemQuickLookSheet() async {
      guard let data = usdzData else {
        errorMessage = "Compile a scene before viewing it in AR."
        return
      }
      guard
        let rootVC = UIApplication.shared.connectedScenes
          .compactMap({
            ($0 as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow })?.rootViewController
          })
          .first
      else {
        errorMessage = "Could not find a window to present AR Quick Look from."
        return
      }

      do {
        try await QuickLookHelper.presentAR(from: rootVC, usdzData: data)
        errorMessage = nil
      } catch {
        errorMessage = error.localizedDescription
      }
    }
  }

  /// UIViewRepresentable hosting a RealityKit scene driven by the shared cross-platform
  /// `XROrbitCameraState` and `XRLiveRealityKitSession` studio lighting rig.
  @available(iOS 15.0, *)
  struct ModelViewportRepresentable: UIViewRepresentable {
    let entity: Entity?
    let sceneBounds: (center: SIMD3<Double>, radius: Double)
    let cameraOptions: XRCameraOptions
    let modelScale: Float
    let resetToken: Int
    let runtimeSession: XRLiveRealityKitSession?
    let runtimeFeatures: XRSpatialRealityKitFeatures?
    let onTapNode: ((String) -> Void)?

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
      weak var arView: ARView?
      weak var camera: PerspectiveCamera?
      let pivot = Entity()
      var orbit = XROrbitCameraState()
      var modelScale: Float = 1.0
      var lastCameraOptions: XRCameraOptions?
      var lastResetToken: Int = -1
      var runtimeSession: XRLiveRealityKitSession?
      var runtimeFeatures: XRSpatialRealityKitFeatures?
      var onTapNode: ((String) -> Void)?
      var isDragging: Bool = false
      var isDraggingHandle: Bool = false
      var lastPanLocation: CGPoint = .zero
      var currentHeadPose = XRPose(position: SIMD3<Float>(0, 1.2, 3.5))
      var currentCameraTransform: simd_float4x4 = matrix_identity_float4x4
      var updateCancellable: Cancellable?

      public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
      ) -> Bool {
        gestureRecognizer is UIPinchGestureRecognizer || other is UIPinchGestureRecognizer
      }

      @MainActor
      func applyCameraPose() {
        guard let camera = camera else { return }
        let eye = orbit.eye
        let target = orbit.target
        camera.look(
          at: SIMD3<Float>(Float(target.x), Float(target.y), Float(target.z)),
          from: SIMD3<Float>(Float(eye.x), Float(eye.y), Float(eye.z)),
          relativeTo: nil
        )
        camera.camera.fieldOfViewInDegrees = Float(orbit.fieldOfViewDeg)
        var mat = orbit.turntableMatrix
        let s = (modelScale.isFinite && modelScale > 0) ? modelScale : 1.0
        if abs(s - 1.0) > 1e-4 {
          let scaleMat = simd_float4x4(
            diagonal: SIMD4<Float>(s, s, s, 1.0))
          mat = simd_mul(mat, scaleMat)
        }
        pivot.setTransformMatrix(mat, relativeTo: nil)
        if let arSurface = pivot.findEntity(named: "ThreeLiveArSurfacePreview") {
          arSurface.scale = SIMD3<Float>(repeating: 1.0 / s)
        }
        let worldMat = camera.transformMatrix(relativeTo: nil)
        currentCameraTransform = worldMat
        currentHeadPose = XRPose(matrix: worldMat)
      }

      @MainActor
      @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, let view = arView else { return }
        orbit.touch(now: ProcessInfo.processInfo.systemUptime)
        let location = recognizer.location(in: view)
        if let hit = view.hitTest(location, query: .nearest, mask: .all).first {
          _ = runtimeSession?.handleTap(on: hit.entity, hitPoint: hit.position)
          let label = hit.entity.name.isEmpty ? "mesh" : hit.entity.name
          onTapNode?(label)
        }
      }

      @MainActor
      @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
        guard let view = arView else { return }
        let location = recognizer.location(in: view)
        let now = ProcessInfo.processInfo.systemUptime
        switch recognizer.state {
        case .began:
          isDragging = true
          lastPanLocation = location
          isDraggingHandle = runtimeFeatures?.pointerDown(at: location, in: view) ?? false
        case .changed:
          if isDraggingHandle {
            runtimeFeatures?.pointerMove(at: location, in: view)
          } else {
            let deltaX = Double(location.x - lastPanLocation.x)
            let deltaY = Double(location.y - lastPanLocation.y)
            orbit.drag(dx: deltaX, dy: deltaY, now: now)
          }
          lastPanLocation = location
        case .ended, .cancelled, .failed:
          if isDraggingHandle {
            runtimeFeatures?.pointerUp()
          }
          isDraggingHandle = false
          isDragging = false
          orbit.touch(now: now)
        default:
          break
        }
      }

      @MainActor
      @objc func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
        guard !isDraggingHandle, recognizer.state == .changed else { return }
        orbit.pinch(scale: Double(recognizer.scale), now: ProcessInfo.processInfo.systemUptime)
        recognizer.scale = 1.0
      }
    }

    func makeCoordinator() -> Coordinator {
      Coordinator()
    }

    func makeUIView(context: Context) -> ARView {
      let arView = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
      arView.environment.background = .color(
        UIColor(red: 0.043, green: 0.071, blue: 0.125, alpha: 1.0)
      )
      XRLiveRealityKitSession.configureStudioEnvironment(of: arView)

      let cameraAnchor = AnchorEntity(world: [0, 0, 0])
      let camera = PerspectiveCamera()
      camera.camera.fieldOfViewInDegrees = 45.0
      cameraAnchor.addChild(camera)
      arView.scene.addAnchor(cameraAnchor)
      context.coordinator.camera = camera

      let modelAnchor = AnchorEntity(world: [0, 0, 0])
      modelAnchor.name = "ModelRoot"
      modelAnchor.addChild(context.coordinator.pivot)
      arView.scene.addAnchor(modelAnchor)

      let tap = UITapGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
      let pan = UIPanGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
      let pinch = UIPinchGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handlePinch(_:)))
      pan.maximumNumberOfTouches = 1
      pan.delegate = context.coordinator
      pinch.delegate = context.coordinator
      arView.addGestureRecognizer(tap)
      arView.addGestureRecognizer(pan)
      arView.addGestureRecognizer(pinch)
      context.coordinator.arView = arView

      context.coordinator.updateCancellable = arView.scene.subscribe(
        to: SceneEvents.Update.self
      ) { [weak coordinator = context.coordinator] event in
        guard let coordinator = coordinator else { return }
        let dt = min(max(event.deltaTime, 0), 0.1)
        let now = ProcessInfo.processInfo.systemUptime
        _ = coordinator.orbit.step(dt: dt, now: now, pointerDown: coordinator.isDragging)
        coordinator.applyCameraPose()
        coordinator.runtimeSession?.headPoseProvider = { [weak coordinator] in
          coordinator?.currentHeadPose
        }
        coordinator.runtimeFeatures?.cameraTransformProvider = { [weak coordinator] in
          coordinator?.currentCameraTransform
        }
        coordinator.runtimeSession?.step(dt: dt)
        coordinator.runtimeFeatures?.step(dt: dt)
      }

      return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
      let coordinator = context.coordinator
      coordinator.runtimeSession = runtimeSession
      coordinator.runtimeFeatures = runtimeFeatures
      coordinator.onTapNode = onTapNode

      var shouldSnapBounds = false
      if let currentEntity = entity {
        if coordinator.pivot.children.first !== currentEntity {
          coordinator.pivot.children.removeAll()
          coordinator.pivot.addChild(currentEntity)
          shouldSnapBounds = true
        }
      } else {
        if !coordinator.pivot.children.isEmpty {
          coordinator.pivot.children.removeAll()
        }
        return
      }

      if coordinator.lastResetToken != resetToken {
        coordinator.lastResetToken = resetToken
        shouldSnapBounds = true
      }

      if shouldSnapBounds {
        coordinator.orbit = XROrbitCameraState()
      }

      if coordinator.lastCameraOptions != cameraOptions || shouldSnapBounds {
        var opts = cameraOptions
        if !shouldSnapBounds,
          coordinator.lastCameraOptions?.cameraOrbit == cameraOptions.cameraOrbit
        {
          opts.cameraOrbit = nil
        }
        coordinator.lastCameraOptions = cameraOptions
        coordinator.orbit.apply(opts)
      }

      if shouldSnapBounds {
        coordinator.orbit.setBounds(center: sceneBounds.center, radius: sceneBounds.radius)
      }

      coordinator.modelScale = modelScale
      coordinator.applyCameraPose()
    }
  }
#endif
