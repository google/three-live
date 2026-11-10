/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Industrial / Process / Warehouse domain kit bundle for
 * `<three-live>` and `<xr-live>` (`three-live-kit-industrial.min.js` / `three-live/kits/industrial`).
 */

import {registerPlugin} from './plugin';
import {
  type CatwalkPlatformOptions,
  type CentrifugalPumpOptions,
  type ConveyorOptions,
  type IndustrialLadderOptions,
  industrialKitPlugin,
  installIndustrialKit,
  MAX_IND_RUNGS,
  MAX_IND_SEGMENTS,
  MAX_IND_SPANS,
  MAX_IND_WAYPOINTS,
  type NominalPipeSpec,
  type PalletRackOptions,
  type PipeFittingOptions,
  type PipeRunOptions,
  type SafetyBarrierOptions,
  type StorageTankOptions,
  type ValveOptions,
} from './kits/industrial';

registerPlugin(industrialKitPlugin);

export {
  industrialKitPlugin,
  installIndustrialKit,
  MAX_IND_RUNGS,
  MAX_IND_SEGMENTS,
  MAX_IND_SPANS,
  MAX_IND_WAYPOINTS,
  type CatwalkPlatformOptions,
  type CentrifugalPumpOptions,
  type ConveyorOptions,
  type IndustrialLadderOptions,
  type NominalPipeSpec,
  type PalletRackOptions,
  type PipeFittingOptions,
  type PipeRunOptions,
  type SafetyBarrierOptions,
  type StorageTankOptions,
  type ValveOptions,
};
