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

# Targeted Sub-Node Scene Editing (`three-live/edits`)

`three-live/edits` (`dist/three-live-edits.min.js`) is an optional, a la carte
host add-on (`< 11 KB gz`) for targeted glTF subtree replacement, geometric and
material constraint grading, preview/accept/reject staging, and bounded undo.
Core viewer, author, full, and XR bundles never import it (`0 B` core bundle
overhead).

## Usage

Import `SceneEditor` (or rely on the registered `sceneEditsPlugin` methods
`previewNodeEdit`, `acceptNodeEdit`, `rejectNodeEdit`, `undoNodeEdit`):

```js
import {SceneEditor} from 'three-live/edits';

const el = document.querySelector('three-live');
const editor = new SceneEditor(el);

const receipt = await editor.previewEdit({
  target: 'Tower',
  replacement: replacementGlbBytes,
  copyMaterialFrom: 'Tower',
  constraints: {
    preserveBounds: {tolerance: 0.05},
    matchMaterialOf: 'Tower',
  },
});

if (receipt.status === 'preview') {
  editor.acceptEdit();
  // Later: await editor.undoEdit();
} else {
  // Failed constraints never publish a candidate; the existing scene stays intact.
  console.warn(receipt.constraints, receipt.errors);
}
```

## Constraints & Asset Compaction

- **`preserveBounds`:** Enforces world-space axis-aligned bounding-box placement
  and extent (`min` and `max` on X, Y, and Z within `tolerance * max(size, 1e-6)`,
  default `tolerance = 0.1`), computed strictly from vertices referenced by each
  primitive (`primitive.indices` when indexed, or `0..POSITION.count` when
  unindexed). Equal-size replacements translated away from the original world
  AABB or expanding drawn bounds via index changes are rejected.
- **`preserveFootprint`:** Enforces world-space X/Z AABB `min`/`max` placement
  plus floor contact (`min[1]`, default `tolerance = 0.1`).
- **`preserveHeight`:** Enforces vertical span (`size[1]`, default `tolerance = 0.05`).
- **`maxBounds`:** Enforces maximum world XYZ extents (`size[ax] <= maxBounds[ax]`).
- **`matchMaterialOf`:** Checks PBR base color, metallic/roughness, emissive,
  alpha mode, and double-sidedness against a named reference target.
- **Detached asset reclamation & extension remapping:** Every merge compacts
  unreachable glTF nodes, meshes, materials, textures, samplers, images,
  animations, accessors, and `bufferViews` and repacks `bin` so repeated
  replacements keep active scene memory bounded. Surviving `KHR_interactivity`
  pointers/triggers/animations, `KHR_animation_pointer` targets, `MSFT_lod`
  node lists, `KHR_materials_variants` mappings, `EXT_mesh_gpu_instancing`
  accessors, and `EXT_meshopt_compression` / `KHR_meshopt_compression` byte
  ranges are remapped in place; edits that detach a resource referenced by an
  extension, rely on dynamic interactivity index sockets, or touch documents
  with unsupported extensions fail closed (`status: 'rejected'`).

## Capabilities & Lifecycle

- **Fail-closed capability integration (`ThreeLiveCapabilities`):** In-memory
  `GLBData`, `ArrayBuffer`, or `ArrayBufferView` payloads merge locally without
  evaluating scripts or opening network connections. Passing a remote URL string
  checks `remote_content` (and `network`) via `checkPluginCapability` before
  `fetch`, emitting `three-capability-denied` and returning a `rejected` receipt
  when disabled.
- **Supersession & bounded undo:** External `loadModel`, `executeScript`, or
  `loadScriptFromSrc` calls supersede in-flight async previews and clear stale
  undo snapshots. Undo history is bounded to `maxUndoSteps` (`0..16`, default
  `8`) and `128 MiB` of retained binary data (`64 MiB` binary / `4 MiB` JSON per
  document).
