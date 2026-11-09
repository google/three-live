<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Three-Live Mobile

Native Android and iOS bindings for `three-live-compiler`, enabling client-side procedural Three.js scene compilation directly to binary glTF 2.0 (`.glb`) in native memory.

## Architecture & Zero-Copy Pipeline

On mobile, apps already use high-performance native PBR graphics engines:

- **Android**: [Google Filament](https://github.com/google/filament) (`com.google.android.filament`) or SceneView.
- **iOS & visionOS**: Apple RealityKit (`ModelEntity`) or SceneKit (`SCNScene`).

Both native engines take binary glTF (`.glb`) as input. `three-live` executes procedural JavaScript scene graphs inside an embedded Boa VM and produces wire-ready glTF buffers without spawning WebViews or round-tripping to remote servers.

```
┌─────────────────────────────────────────────────────────────┐
│                    Rust Engine (Boa VM)                     │
│  Compiles procedural Three.js script into in-memory GLB     │
│  Allocates native buffer on heap: (data, len, capacity)     │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
       (Android / JNI)                    (iOS / Swift)
               │                               │
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│    Direct ByteBuffer        │ │     Data(bytesNoCopy:)      │
│  NewDirectByteBuffer()      │ │  Swift takes ownership of   │
│  Zero JVM heap copy         │ │  native pointer; 0 copies   │
└──────────────┬──────────────┘ └──────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│   Google Filament (C++)     │ │   Apple RealityKit (C++)    │
│  Filament reads direct      │ │  Direct GPU buffer upload   │
│  buffer in native memory    │ │  without replication        │
└──────────────┬──────────────┘ └──────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│   JNI Ownership-Checked     │ │   ARC Custom Deallocator    │
│   Cleanup: validated free   │ │  three_live_free_buffer()   │
│   with no buffer copy       │ │  when Data is released      │
└─────────────────────────────┘ └─────────────────────────────┘
```

## Directory Layout

- **`android/`**: Android library package containing:
  - `ThreeCompiler.kt`: Kotlin coroutine wrapper with `GlbBuffer` (`AutoCloseable`).
  - `FilamentHelper.kt`: Zero-copy integration recipe for Google Filament.
  - Gradle build script generating `three-live-compiler-release.aar`.
- **`ios/`**: Swift Package Manager (SPM) manifest and Swift wrappers:
  - `ThreeCompiler.swift`: Swift concurrency wrapper (`async/await`) with `Data(bytesNoCopy:)`.
  - `RealityKitHelper.swift`: Integration recipe for Apple RealityKit / visionOS.
  - C module headers and `Package.swift` declaring `binaryTarget` for `ThreeLiveCompiler.xcframework`.
- **`examples/android_compose/`**: Turnkey Android Studio project with Jetpack Compose code editor, live presets, and interactive Google Filament 3D viewport.
- **`examples/ios_swiftui/`**: Turnkey Xcode project with SwiftUI monospace code editor, live presets, and interactive Apple RealityKit 3D viewport.

## Interactive Live Compiler Apps

Both Android and iOS include complete sample applications featuring an on-device code editor where developers can paste or edit arbitrary Three.js JavaScript scene graphs and compile them live into native 3D viewports:

- **Android (Jetpack Compose + Filament)**: See [`mobile/examples/android_compose`](examples/android_compose/README.md)
- **iOS (SwiftUI + RealityKit)**: See [`mobile/examples/ios_swiftui`](examples/ios_swiftui/README.md)

## AI Scene Editing: Tap & Speak

The same bring-your-own-LLM editing as `el.editScene()` / `el.connectVoice()` on the web, with
the prompt, reply parsing, edit validation, and voice protocols shared through the Rust core
(`three_live_ai_call`), so every platform accepts and rejects the same edits. A text/code model
writes each edit; the voice model only talks and calls the `edit_scene` / `undo_edit` /
`select_meshes` tools.
Keep API keys on your server: point endpoints at your own proxy or a local model.

| | Android (`com.google.threelive.ai`) | iOS / visionOS |
|---|---|---|
| Text edits + undo | `ThreeLiveAIEditor` | `AIEditor` |
| Code model (`ai-chat`) | `AIChatProvider` | `AIChatProvider` |
| Tap to select | `editor.toggleSelection(name, additive)` from `ThreeLiveRendererListener.onPick` | `editor.toggleSelection(entity.name, additive:)` from your tap handler |
| Talk-to-Select | `editor.selectByVoice("the red chairs", mode)`, `editor.selections`, `editor.camera` | `editor.selectByVoice("the red chairs", mode:)`, `editor.selections`, `editor.camera` |
| Push-to-talk | `VoiceEditController` (`SpeechRecognizer` + `TextToSpeech`) | `VoiceEditController` (`SFSpeechRecognizer` + `AVSpeechSynthesizer`) |
| Realtime voice (`ai-realtime` / `gemini-live`) | `AIVoiceSession` + `WebSocketLiveTransport` + `MicrophoneStreamer(rate)` + `AudioTrackPcmSink` | `AIVoiceSession` + `URLSessionLiveTransport` + `MicrophoneStreamer(sampleRate:)` + `AVAudioPcmSink` |

Talk-to-Select uses the same matcher as the web (`select`, `parse_command`, and the other
`select_*` ops in the core). Push-to-talk understands "select … / also select … / deselect … /
clear the selection" and "select X and make it red". The latter edits right away only when the
reference was unambiguous; otherwise it asks which one was meant. Set `editor.camera` to your
camera's eye and target so "left" and "front" match what the user sees. References the matcher
can't resolve go to the editor's code model; set `selectWithModel = false` to turn that off.

```kotlin
val editor = ThreeLiveAIEditor(script, AIChatProvider("https://your-backend.example/chat")) { code ->
  renderer.loadGlb(ThreeCompiler.compileToBytes(code))
}
val session = AIVoiceSession(editor, WebSocketLiveTransport("wss://your-backend.example/realtime"), scope, sink = AudioTrackPcmSink())
val rate = session.start()  // 24000 for ai-realtime, 16000 for gemini-live
MicrophoneStreamer(rate) { session.sendAudio(it) }.start(context)
```

```swift
let editor = AIEditor(source: script, provider: AIChatProvider(endpoint: "https://your-backend.example/chat")!) { code in
  try await reload(try await ThreeCompiler.compile(code))
}
let session = try AIVoiceSession(editor: editor, transport: URLSessionLiveTransport(url: realtimeURL)!, sink: AVAudioPcmSink())
let rate = try await session.start()
try MicrophoneStreamer(sampleRate: rate) { session.sendAudio($0) }.start()
```

## AI Textures

`mesh.userData.xr = { material: { preset: 'brick', prompt: '…' } }` works the
same as on the web: compiles read a **texture pack** (the preset shows until the
pack has the texture), and generation only happens when you ask for it. Key
derivation, image preparation, and pack validation run in the shared Rust core,
so a pack baked on the web or with `three-live-cli textures bake` gives the same
pixels here.

```kotlin
val textures = ThreeLiveAITextures(
  AIImagesProvider("https://your-backend.example/v1/images/generations"),
  cacheDir = File(context.cacheDir, "three-live-textures"),
)
textures.setPack(assets.open("scene.textures.json").reader().readText())  // optional
val result = textures.generateTextures(script)   // pack → cache → provider
renderer.loadGlb(ThreeCompiler.compileToBytes(script))  // recompile to show them
saveForLater(result.packJson)
```

```swift
let textures = AITextures(
  provider: AIImagesProvider(endpoint: "https://your-backend.example/v1/images/generations"),
  cacheDirectory: cachesURL.appendingPathComponent("three-live-textures"))
let result = try await textures.generateTextures(script)
try await reload(try await ThreeCompiler.compile(script))
```

`setPack` installs the pack for every later compile in the process (pass `nil` /
`null` to clear it).

With a provider, `mode` defaults to auto (like `ai-textures` on the web): after
each load, `sceneLoaded(script)` generates missing textures in the background
and calls back so you can recompile. Textures that failed are not retried until
`clearFailures()`. Set `mode` to manual to generate only on request. Give the
editor the textures object and it does this for every edit, undo, and
image-to-scene compile:

```kotlin
editor.textures = textures                      // re-applies when textures arrive
textures.sceneLoaded(script) { reload(script) } // for scenes you load yourself
```

```swift
editor.textures = textures
textures.sceneLoaded(script) { _ in try? await reload(script) }
```

## Building Native Distribution Packages

Run the automated scripts from the root directory:

```bash
# Build Android AAR (requires Android NDK & cargo-ndk)
./scripts/build_android_aar.sh

# Build iOS XCFramework (requires Xcode & cargo)
./scripts/build_ios_xcframework.sh
```

