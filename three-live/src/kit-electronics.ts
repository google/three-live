/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Electronics / ECAD / Hardware domain kit bundle for
 * `<three-live>` and `<xr-live>` (`three-live-kit-electronics.min.js` / `three-live/kits/electronics`).
 */

import {registerPlugin} from './plugin';
import {
  type ConnectorOptions,
  type DinRailOptions,
  type DiscreteComponentOptions,
  electronicsKitPlugin,
  type EnclosureCutoutSpec,
  type EnclosureOptions,
  type HeatsinkOptions,
  type IcPackageOptions,
  installElectronicsKit,
  type JedecPackageSpec,
  MAX_ECAD_FINS,
  MAX_ECAD_HOLES,
  MAX_ECAD_PINS,
  MAX_ECAD_SEGMENTS,
  type PcbBoardOptions,
  type PcbHoleSpec,
  type PinHeaderOptions,
  type StandoffSpacerOptions,
} from './kits/electronics';

registerPlugin(electronicsKitPlugin);

export {
  electronicsKitPlugin,
  installElectronicsKit,
  MAX_ECAD_FINS,
  MAX_ECAD_HOLES,
  MAX_ECAD_PINS,
  MAX_ECAD_SEGMENTS,
  type ConnectorOptions,
  type DinRailOptions,
  type DiscreteComponentOptions,
  type EnclosureCutoutSpec,
  type EnclosureOptions,
  type HeatsinkOptions,
  type IcPackageOptions,
  type JedecPackageSpec,
  type PcbBoardOptions,
  type PcbHoleSpec,
  type PinHeaderOptions,
  type StandoffSpacerOptions,
};
