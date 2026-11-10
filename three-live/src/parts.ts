/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Mechanical CAD Parts plugin bundle for `<three-live>`
 * and `<xr-live>` (`three-live-parts.min.js`).
 */

import {registerPlugin} from './plugin';
import {
  type BearingOptions,
  type BoltOptions,
  type FlangePlateOptions,
  type GearMeshInfo,
  type HelicalSpringOptions,
  installPartsExtension,
  type InternalRingGearOptions,
  MAX_PART_COILS,
  MAX_PART_HOLES,
  MAX_PART_RADIAL_SEGMENTS,
  MAX_PART_TEETH,
  type MetricFastenerSpec,
  type NutOptions,
  partsPlugin,
  type ProfileExtrusionOptions,
  type PulleyOptions,
  type RackOptions,
  type ShaftOptions,
  type ShaftSegmentSpec,
  type SpurGearOptions,
  type StructuralProfileKind,
  type WasherOptions,
} from './plugins/parts';

// Auto-register Mechanical Parts plugin
registerPlugin(partsPlugin);

export {
  installPartsExtension,
  MAX_PART_COILS,
  MAX_PART_HOLES,
  MAX_PART_RADIAL_SEGMENTS,
  MAX_PART_TEETH,
  partsPlugin,
  type BearingOptions,
  type BoltOptions,
  type FlangePlateOptions,
  type GearMeshInfo,
  type HelicalSpringOptions,
  type InternalRingGearOptions,
  type MetricFastenerSpec,
  type NutOptions,
  type ProfileExtrusionOptions,
  type PulleyOptions,
  type RackOptions,
  type ShaftOptions,
  type ShaftSegmentSpec,
  type SpurGearOptions,
  type StructuralProfileKind,
  type WasherOptions,
};
