/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Science / Chemistry / Math domain kit bundle for
 * `<three-live>` and `<xr-live>` (`three-live-kit-science.min.js` / `three-live/kits/science`).
 */

import {registerPlugin} from './plugin';
import {
  type AtomicOrbitalKind,
  type AtomicOrbitalOptions,
  type Axes3DOptions,
  type CrystalLatticeOptions,
  type DoubleHelixOptions,
  type ElementSpec,
  installScienceKit,
  MAX_SCI_ATOMS,
  MAX_SCI_BASE_PAIRS,
  MAX_SCI_GLYPHS,
  MAX_SCI_GRID,
  MAX_SCI_RIBBON_POINTS,
  type MoleculeAtomSpec,
  type MoleculeOptions,
  type OpticalElementKind,
  type OpticalElementOptions,
  type ParametricSurfaceOptions,
  type RibbonColorMapOptions,
  type RibbonOptions,
  type RibbonSecondaryKind,
  type RibbonSpanSpec,
  scienceKitPlugin,
  type SurfacePlotOptions,
  type VectorFieldOptions,
} from './kits/science';

registerPlugin(scienceKitPlugin);

export {
  installScienceKit,
  MAX_SCI_ATOMS,
  MAX_SCI_BASE_PAIRS,
  MAX_SCI_GLYPHS,
  MAX_SCI_GRID,
  MAX_SCI_RIBBON_POINTS,
  scienceKitPlugin,
  type AtomicOrbitalKind,
  type AtomicOrbitalOptions,
  type Axes3DOptions,
  type CrystalLatticeOptions,
  type DoubleHelixOptions,
  type ElementSpec,
  type MoleculeAtomSpec,
  type MoleculeOptions,
  type OpticalElementKind,
  type OpticalElementOptions,
  type ParametricSurfaceOptions,
  type RibbonColorMapOptions,
  type RibbonOptions,
  type RibbonSecondaryKind,
  type RibbonSpanSpec,
  type SurfacePlotOptions,
  type VectorFieldOptions,
};
