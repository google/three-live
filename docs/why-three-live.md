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

# Why Three-Live

Three-Live is a cross-platform 3D and XR toolkit for Android, iOS, and the web
that uses Three.js as a portable intermediate representation (IR). Instead of
treating Three.js as a browser-only rendering API, Three-Live compiles scene
scripts inside a sandbox on the device to Android Filament, Apple RealityKit,
WebGL2, WebGPU, binary glTF 2.0 (`.glb`), and OpenUSD (`.usdz`).

This page explains the rationale for using procedural code as a 3D IR, lists the
toolkit's main capabilities, compares it with other 3D architectures, and
outlines when another tool is a better fit.

---

## Why use procedural code as a 3D intermediate representation {#why-procedural-ir}

Three-dimensional content pipelines usually rely on static binary assets
(`.glb`, `.fbx`, or `.usdz`) exported from desktop modeling tools, or imperative
application code tied to a single rendering engine. When you add LLMs, coding
agents, or runtime parametric customization, both approaches have practical
limits:

*   **Binary 3D formats are difficult for LLMs to generate directly.** LLMs
    can't reliably emit raw binary vertex buffers, quaternions, or byte-aligned
    ZIP archives token by token.
*   **Text-to-mesh diffusion outputs lack scene structure.** Generated triangle
    meshes typically arrive as a single merged surface without part hierarchy,
    named nodes, mechanical joints, exact parametric dimensions, or separate
    physically based rendering (PBR) materials.
*   **LLMs already generate Three.js syntax reliably.** Standard constructors
    such as `THREE.Mesh`, `THREE.Group`, `THREE.BoxGeometry`, and
    `THREE.MeshStandardMaterial` are widely represented in public training data.

By treating Three.js as a compiler input language, Three-Live lets you run the
same human-authored or LLM-generated script inside a sandbox and lower it into
native scene graphs and standard 3D asset files across Android, iOS, visionOS,
web, and command-line environments.

---

## Key technical capabilities {#capabilities}

Three-Live provides the following capabilities across Android, iOS, web, and CLI
targets:

*   **Sandboxed native and web compilation:** Runs scene scripts inside an
    embedded Rust (`Boa`) JavaScript engine on Android (JNI), Apple platforms
    (C FFI), and the CLI, and inside an isolated Web Worker in the browser. Both
    engines enforce execution timeouts, memory limits, and geometry caps, and
    export `.glb` and `.usdz` files on the device.
*   **Runtime voice, text, and image-to-scene editing:** Supports in-app scene
    updates (`editScene`), two-tier natural-language selection (`selectByVoice`,
    using a fast local matcher for names, colors, directions, and sizes with an
    LLM fallback for relational queries), and 2D-to-3D generation
    (`compileFromImage`) grounded on Android ARCore or Apple RoomPlan
    (`CapturedRoom`) surface transforms.
*   **Cross-platform procedural shaders (`THREE.TSL`):** Verifies loop-free
    `THREE.TSL` node graphs and compiles the same material definition to Android
    Filament, Apple `.usdz` MaterialX (`UsdShade`), WebGL2 GLSL, WebGPU WGSL,
    and a CPU software rasterizer.
*   **Consistent procedural and AI PBR textures:** Implements procedural PBR
    presets (`wood`, `marble`, `brick`, `concrete`, `brushedMetal`, `rust`,
    `leather`, `fabric`, `carbonFiber`, `checkerboard`, and `grid`) plus
    on-device normal and occlusion-roughness-metalness (ORM) map generators in
    both TypeScript and Rust, verified by shared pixel-hash tests.
*   **Single-binary CLI and MCP verification (`three-live-cli`):** Packages a
    spatial linter, a headless CPU rasterizer for multi-angle contact sheets and
    reference-image silhouette comparisons, and a rigid-body physics and
    interactivity gym into one native binary without requiring a GPU or an
    external editor process.
*   **Modular web bundles:** Ships a compact static viewer
    (`three-live-viewer.min.js`) and core runtime (`three-live.min.js`), with
    optional plugins for CAD constructive solid geometry (CSG), studio lighting,
    WebGPU, TSL shaders, AI editing, and WebXR.

---

## Architectural comparison {#comparison}

The following table compares four approaches to delivering 3D and XR content
across Android, iOS, and web platforms:

| Dimension | Imperative browser scene graphs (for example, raw Three.js) | Static 3D asset viewers (for example, `<model-viewer>` or Quick Look) | Compiled game engine toolchains (C# or C++ IDE pipelines) | Sandboxed procedural compiler and native runtimes (Three-Live) |
| :--- | :--- | :--- | :--- | :--- |
| **Primary input** | Imperative JS coupled to the browser DOM and WebGL | Pre-baked static `.glb` and `.usdz` files | Engine project files, C# or C++ scripts, and binary assets | Declarative HTML and sandboxed Three.js scripts (plus `.glb`) |
| **LLM and agent workflow** | Familiar syntax, but no built-in spatial linter, headless diff, or sandbox | LLMs can't directly emit binary `.glb` buffers | Requires editor socket plugins and multi-step compilation | Standard Three.js syntax with a spatial linter, silhouette comparison, and automated repair |
| **Untrusted script safety** | Runs on the main thread with full DOM and network access | Safe (parses static asset data only) | Not designed to evaluate untrusted runtime scripts | Isolated Rust Boa or Web Worker sandbox with CPU, memory, vertex, and texture limits |
| **Native Android and iOS** | Browser or WebView only (unless you build custom native bridges) | Web viewer with iOS `.usdz` handoff | Native binaries built offline through an editor toolchain | On-device Rust compiler targeting Android Filament and iOS or visionOS RealityKit |
| **Procedural shaders** | Browser-only GLSL, WGSL, or TSL | Static textures and standard PBR scalar parameters | Engine-specific shader graphs compiled offline | Loop-free `THREE.TSL` graph lowered to Filament, `.usdz` MaterialX, WebGL2, WebGPU, and CPU |
| **Runtime AI editing** | Requires custom prompt, validation, and undo pipelines | Not supported for static assets | Requires a custom runtime scripting and validation layer | Built-in `editScene`, `compileFromImage` (with ARCore and RoomPlan priors), and `selectByVoice` |
| **Web footprint** | Medium to large depending on loaders and post-processing | Small to medium static viewer bundle | Multi-megabyte WebAssembly runtime | Compact viewer and core bundles with optional feature plugins |

---

## Trade-offs and when to use another tool {#trade-offs}

Another tool may be a better fit in the following situations:

*   **You only display static, artist-authored 3D models on the web.** If you
    don't need procedural generation, runtime AI editing, CAD CSG, spatial
    physics, or native Android and iOS SDK parity, a static `.glb` viewer (or
    Three-Live's `three-live-viewer.min.js`) is sufficient.
*   **You're building a large-scale game.** If your project requires gigabytes
    of streamed world assets, custom multi-pass compute shaders with arbitrary
    loops, navmesh pathfinding, or console build pipelines, we recommend a full
    game engine.
*   **Your Three.js scripts depend on browser DOM APIs, network fetches, or
    unbounded loops.** Three-Live's compiler sandbox blocks network and DOM
    access inside scene scripts and enforces execution timeouts, resource caps,
    and loop-free shader graphs so untrusted LLM outputs remain safe to evaluate
    on Android, iOS, and the web.
