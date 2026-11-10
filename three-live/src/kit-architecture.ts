/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Architecture / AEC domain kit bundle for `<three-live>`
 * and `<xr-live>` (`three-live-kit-architecture.min.js` / `three-live/kits/architecture`).
 */

import {registerPlugin} from './plugin';
import {
  architectureKitPlugin,
  type ArchwayOptions,
  type ColumnOptions,
  type DoorHandleStyle,
  type DoorOperation,
  type DoorOptions,
  type DoorStyle,
  installArchitectureKit,
  MAX_ARCH_OPENINGS,
  MAX_ARCH_PICKETS,
  MAX_ARCH_SEGMENTS,
  MAX_ARCH_STEPS,
  type RailingOptions,
  type RoofOptions,
  type RoofStyle,
  type SlabOpeningSpec,
  type SlabOptions,
  type StaircaseOptions,
  type StairCodeSpec,
  type WallOpeningSpec,
  type WallOptions,
  type WindowOptions,
  type WindowStyle,
} from './kits/architecture';

registerPlugin(architectureKitPlugin);

export {
  architectureKitPlugin,
  installArchitectureKit,
  MAX_ARCH_OPENINGS,
  MAX_ARCH_PICKETS,
  MAX_ARCH_SEGMENTS,
  MAX_ARCH_STEPS,
  type ArchwayOptions,
  type ColumnOptions,
  type DoorHandleStyle,
  type DoorOperation,
  type DoorOptions,
  type DoorStyle,
  type RailingOptions,
  type RoofOptions,
  type RoofStyle,
  type SlabOpeningSpec,
  type SlabOptions,
  type StaircaseOptions,
  type StairCodeSpec,
  type WallOpeningSpec,
  type WallOptions,
  type WindowOptions,
  type WindowStyle,
};
