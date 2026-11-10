/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview All-in-one Domain Kits bundle for `<three-live>` and `<xr-live>`
 * (`three-live-kits.min.js` / `three-live/kits`).
 *
 * Domain kits are intentionally a la carte (NOT bundled in `three-live-full.min.js`
 * or `xr-live-full.min.js`) so general 3D viewers do not pay for industry-specific
 * parametric geometry libraries unless opted in via `three-live-kits.min.js` or
 * an individual `three-live-kit-<domain>.min.js` bundle.
 */

export * from './kit-mechanical';
