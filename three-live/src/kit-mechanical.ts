/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Mechanical domain kit bundle for `<three-live>`
 * and `<xr-live>` (`three-live-kit-mechanical.min.js` / `three-live/kits/mechanical`).
 */

import {registerPlugin} from './plugin';
import {
  type BearingOptions,
  type BevelGearOptions,
  type BoltOptions,
  type FlangePlateOptions,
  type GearMeshInfo,
  type HelicalSpringOptions,
  installMechanicalKit,
  type InternalRingGearOptions,
  MAX_PART_COILS,
  MAX_PART_HOLES,
  MAX_PART_RADIAL_SEGMENTS,
  MAX_PART_TEETH,
  mechanicalKitPlugin,
  type MetricFastenerSpec,
  type NutOptions,
  type PillowBlockOptions,
  type ProfileExtrusionOptions,
  type PulleyOptions,
  type PulleyProfileKind,
  type RackOptions,
  type ShaftCouplerOptions,
  type ShaftCouplerStyle,
  type ShaftOptions,
  type ShaftSegmentSpec,
  type SpurGearOptions,
  type StructuralProfileKind,
  type WasherOptions,
} from './kits/mechanical';

registerPlugin(mechanicalKitPlugin);

export {
  installMechanicalKit,
  MAX_PART_COILS,
  MAX_PART_HOLES,
  MAX_PART_RADIAL_SEGMENTS,
  MAX_PART_TEETH,
  mechanicalKitPlugin,
  type BearingOptions,
  type BevelGearOptions,
  type BoltOptions,
  type FlangePlateOptions,
  type GearMeshInfo,
  type HelicalSpringOptions,
  type InternalRingGearOptions,
  type MetricFastenerSpec,
  type NutOptions,
  type PillowBlockOptions,
  type ProfileExtrusionOptions,
  type PulleyOptions,
  type PulleyProfileKind,
  type RackOptions,
  type ShaftCouplerOptions,
  type ShaftCouplerStyle,
  type ShaftOptions,
  type ShaftSegmentSpec,
  type SpurGearOptions,
  type StructuralProfileKind,
  type WasherOptions,
};
