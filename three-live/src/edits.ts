/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Optional sub-node scene editing & constraint validation add-on
 * (`three-live/edits`, `dist/three-live-edits.min.js`).
 */

import {registerPlugin} from './plugin';
import {
  computeSubtreeBounds,
  computeSubtreeBoundsSize,
  prepareSceneEdit,
  SceneEditor,
  sceneEditsPlugin,
} from './plugins/edits';

export type {
  SceneEditableElement,
  SceneEditConstraints,
  SceneEditHost,
  SceneEditOptions,
  SceneEditPayload,
  SceneEditReceipt,
  SubtreeBounds,
} from './plugins/edits';

registerPlugin(sceneEditsPlugin);

export {
  computeSubtreeBounds,
  computeSubtreeBoundsSize,
  prepareSceneEdit,
  SceneEditor,
  sceneEditsPlugin,
};
