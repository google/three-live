/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parametric Science / Chemistry / Math domain kit bundle for
 * `<three-live>` and `<xr-live>` (`three-live-kit-science.min.js` / `three-live/kits/science`).
 */

import {
  type AngleArcOptions,
  type ApplyVertexColormapOptions,
  type AtomicOrbitalKind,
  type AtomicOrbitalOptions,
  type Axes3DOptions,
  type ColormapTextureOptions,
  type CrystalBasisAtomSpec,
  type CrystalLatticeOptions,
  type CrystalMillerPlaneSpec,
  type DashedLineOptions,
  type DoubleHelixOptions,
  type ElementSpec,
  installScienceKit,
  type IsoSurfaceOptions,
  type IsoSurfacePreset,
  MAX_SCI_ATOMS,
  MAX_SCI_BASE_PAIRS,
  MAX_SCI_GLYPHS,
  MAX_SCI_GRID,
  MAX_SCI_ISOSURFACE_RES,
  MAX_SCI_RIBBON_POINTS,
  MAX_SCI_STREAMLINE_STEPS,
  type MoleculeAtomSpec,
  type MoleculeOptions,
  type OpticalElementKind,
  type OpticalElementOptions,
  type ParametricSurfaceOptions,
  type RibbonColorMapOptions,
  type RibbonOptions,
  type RibbonSecondaryKind,
  type RibbonSpanSpec,
  type ScienceColormapName,
  scienceKitPlugin,
  type StreamlineOptions,
  type StreamlinePreset,
  type SurfacePlotOptions,
  type VectorFieldOptions,
} from './kits/science';
import {registerPlugin} from './plugin';

registerPlugin(scienceKitPlugin);

export {
  installScienceKit,
  MAX_SCI_ATOMS,
  MAX_SCI_BASE_PAIRS,
  MAX_SCI_GLYPHS,
  MAX_SCI_GRID,
  MAX_SCI_ISOSURFACE_RES,
  MAX_SCI_RIBBON_POINTS,
  MAX_SCI_STREAMLINE_STEPS,
  scienceKitPlugin,
  type AngleArcOptions,
  type ApplyVertexColormapOptions,
  type AtomicOrbitalKind,
  type AtomicOrbitalOptions,
  type Axes3DOptions,
  type ColormapTextureOptions,
  type CrystalBasisAtomSpec,
  type CrystalLatticeOptions,
  type CrystalMillerPlaneSpec,
  type DashedLineOptions,
  type DoubleHelixOptions,
  type ElementSpec,
  type IsoSurfaceOptions,
  type IsoSurfacePreset,
  type MoleculeAtomSpec,
  type MoleculeOptions,
  type OpticalElementKind,
  type OpticalElementOptions,
  type ParametricSurfaceOptions,
  type RibbonColorMapOptions,
  type RibbonOptions,
  type RibbonSecondaryKind,
  type RibbonSpanSpec,
  type ScienceColormapName,
  type StreamlineOptions,
  type StreamlinePreset,
  type SurfacePlotOptions,
  type VectorFieldOptions,
};
