/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function(root, factory) {
if (typeof module === 'object' && module.exports) {
  module.exports = factory();
} else {
  root.THREE_LIVE_KITS_CATALOG = factory();
}
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
const STUDIO_RIG = [
  'const key = new THREE.DirectionalLight(0xfff7ed, 2.25);',
  'key.position.set(3.5, 5.2, 4.0);',
  'key.castShadow = true;',
  'scene.add(key);',
  'const fill = new THREE.DirectionalLight(0xbae6fd, 1.18);',
  'fill.position.set(-4.0, 2.5, 2.8);',
  'scene.add(fill);',
  'scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x64748b, 0.9));',
].join('\n');

function wrapScene(bodyLines) {
  return STUDIO_RIG + '\n\n' + bodyLines.join('\n');
}

const DOMAINS = [
  {
    id: 'mechanical',
    namespace: 'Mechanical',
    title: 'Mechanical CAD',
    icon: '⚙️',
    accent: '#38bdf8',
    bundle: 'three-live-kit-mechanical.min.js',
    budgetLabel: '< 18 KB gz',
    description:
        '15 watertight 2-manifold machine elements: involute spur, bevel & internal ring gears, racks, belt/timing pulleys, ISO metric bolts/nuts/washers, stepped shafts, couplers, ball & pillow-block bearings, helical springs, weld-neck flanges, and structural extrusions.',
    helpers: [
      {
        call: 'THREE.Mechanical.metricFastener(\'M8x25\', scale?)',
        summary:
            'ISO 4014 / 4762 / 4032 thread, pitch, head, nut & washer lookup',
      },
      {
        call: 'THREE.Mechanical.gearMeshDistance(gearA, gearB)',
        summary:
            'Exact external & planetary internal center distance, ratio & phase offset',
      },
    ],
  },
  {
    id: 'architecture',
    namespace: 'Architecture',
    title: 'Architecture & AEC',
    icon: '🏛️',
    accent: '#a78bfa',
    bundle: 'three-live-kit-architecture.min.js',
    budgetLabel: '< 16 KB gz',
    description:
        '9 watertight 2-manifold building, BIM & interior elements: walls with Roman/segmental/Gothic openings & moldings, floor slabs with stairwell/skylight cutouts, IBC stairs, 6 roof styles, 10-style doors across 5 operations, 10-style windows, guardrails, classical columns, and masonry archways.',
    helpers: [
      {
        call: 'THREE.Architecture.codeStairSpec(totalRise, opts?)',
        summary:
            'IBC 7-11 compliant riser count, riser height, tread depth & slope calculator',
      },
    ],
  },
  {
    id: 'industrial',
    namespace: 'Industrial',
    title: 'Industrial & Process Plant',
    icon: '🏭',
    accent: '#f59e0b',
    bundle: 'three-live-kit-industrial.min.js',
    budgetLabel: '< 14 KB gz',
    description:
        '10 watertight 2-manifold process piping, factory & warehouse digital-twin assets: 3D Bishop-frame flanged pipe runs, fittings, manual & pneumatic valves, ANSI centrifugal pump skids, selective pallet racks, conveyors, OSHA catwalks, caged ladders, safety barriers, and vessels.',
    helpers: [
      {
        call: 'THREE.Industrial.nominalPipeSpec(\'DN100\' | \'4in\')',
        summary:
            'ASME B36.10M / B16.5 Class 150 pipe OD, wall & bolt-circle flange dimensions',
      },
    ],
  },
  {
    id: 'science',
    namespace: 'Science',
    title: 'Science, Biology & Math',
    icon: '🧬',
    accent: '#34d399',
    bundle: 'three-live-kit-science.min.js',
    budgetLabel: '< 31 KB gz',
    description:
        '14 watertight 2-manifold chemistry, structural biology, crystallography, optics & field-visualization primitives with end-to-end COLOR_0 & USDZ displayColor scientific colormaps (viridis, plasma, turbo, coolwarm, inferno).',
    helpers: [
      {
        call: 'THREE.Science.elementSpec(\'Fe\')',
        summary:
            '44-element IUPAC covalent/van-der-Waals radii & CPK color lookup',
      },
      {
        call: 'THREE.Science.sampleColormap(\'viridis\', t)',
        summary:
            'Perceptually uniform RGB evaluation + colormapTexture & applyVertexColormap',
      },
      {
        call: 'THREE.Science.ribbonColorMap(opts)',
        summary:
            '1D DataTexture ramp for N→C rainbow or secondary-structure polypeptide ribbons',
      },
    ],
  },
  {
    id: 'electronics',
    namespace: 'Electronics',
    title: 'Electronics & ECAD',
    icon: '🔌',
    accent: '#f43f5e',
    bundle: 'three-live-kit-electronics.min.js',
    budgetLabel: '< 14 KB gz',
    description:
        '9 watertight 2-manifold PCB & hardware enclosure primitives: rounded FR4 boards with mounting holes, flanged/vented enclosures with I/O cutouts, tapered-fin heatsinks, IEC DIN rails, JEDEC IC packages, pin headers, USB-C/RJ45/HDMI/SMA connectors, standoffs, and discrete passives.',
    helpers: [
      {
        call: 'THREE.Electronics.jedecPackageSpec(\'LQFP-64\', scale?)',
        summary:
            'JEDEC / IPC body, pitch & lead-span table for DIP, SOIC, QFP, QFN, BGA, TO-220 & D2PAK',
      },
    ],
  },
];

const
    ITEMS =
        [
          // =========================================================================
          // 1. MECHANICAL CAD (15)
          // =========================================================================
          {
            slug: 'mechanical-spur-gear',
            domain: 'mechanical',
            ctor: 'SpurGearGeometry',
            summary:
                'Involute straight & helical spur gears with bore, keyway, hub & lightening holes.',
            tags: [
              'gear', 'helical', 'pinion', 'involute', 'keyway', 'powertrain'
            ],
            orbit: {theta: 28, phi: 26, zoom: 1.22},
            variants: [
              {
                label: '24T Helical + Hub',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.24 });',
                  'const gear = new THREE.Mesh(',
                  '  new THREE.Mechanical.SpurGearGeometry({',
                  '    module: 0.04, teeth: 24, thickness: 0.14,',
                  '    helixAngleDeg: 18, bore: 0.18, keywayWidth: 0.05, keywayDepth: 0.025,',
                  '    hubRadius: 0.22, hubThickness: 0.22, lighteningHoles: 6',
                  '  }),',
                  '  mat',
                  ');',
                  'gear.rotation.x = -0.35;',
                  'scene.add(gear);',
                ]),
              },
              {
                label: '16T Straight Pinion',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.53, roughness: 0.26 });',
                  'const gear = new THREE.Mesh(',
                  '  new THREE.Mechanical.SpurGearGeometry({',
                  '    module: 0.05, teeth: 16, thickness: 0.18, bore: 0.16, keywayWidth: 0.04, keywayDepth: 0.02',
                  '  }),',
                  '  mat',
                  ');',
                  'gear.rotation.x = -0.35;',
                  'scene.add(gear);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-bevel-gear',
            domain: 'mechanical',
            ctor: 'BevelGearGeometry',
            summary:
                'Conical intersecting-axis miter & bevel gears with rear hub collar.',
            tags: ['bevel', 'miter', 'conical', 'gear', '90-degree'],
            orbit: {theta: 32, phi: 28, zoom: 1.22},
            variants: [
              {
                label: '20T Miter Gear',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.53, roughness: 0.25 });',
                  'const bevel = new THREE.Mesh(',
                  '  new THREE.Mechanical.BevelGearGeometry({',
                  '    module: 0.045, teeth: 20, mateTeeth: 20, faceWidth: 0.16,',
                  '    bore: 0.18, hubRadius: 0.22, hubLength: 0.12',
                  '  }),',
                  '  mat',
                  ');',
                  'bevel.rotation.x = 0.35;',
                  'scene.add(bevel);',
                ]),
              },
              {
                label: '14T:28T Pinion',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.24 });',
                  'const bevel = new THREE.Mesh(',
                  '  new THREE.Mechanical.BevelGearGeometry({',
                  '    module: 0.05, teeth: 14, mateTeeth: 28, bore: 0.14, hubRadius: 0.2, hubLength: 0.14',
                  '  }),',
                  '  mat',
                  ');',
                  'bevel.rotation.x = 0.35;',
                  'scene.add(bevel);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-internal-ring-gear',
            domain: 'mechanical',
            ctor: 'InternalRingGearGeometry',
            summary:
                'Annular internal-tooth planetary ring gear with outer mounting bolt circle.',
            tags: ['planetary', 'ring', 'annulus', 'gear', 'epicyclic'],
            orbit: {theta: 26, phi: 30, zoom: 1.2},
            variants: [
              {
                label: '42T Planetary Ring',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.28 });',
                  'const ring = new THREE.Mesh(',
                  '  new THREE.Mechanical.InternalRingGearGeometry({',
                  '    module: 0.035, teeth: 42, thickness: 0.16, boltCount: 8, boltHoleDiameter: 0.075',
                  '  }),',
                  '  mat',
                  ');',
                  'ring.rotation.x = -0.45;',
                  'scene.add(ring);',
                ]),
              },
              {
                label: '32T Compact Housing',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.5, roughness: 0.28 });',
                  'const ring = new THREE.Mesh(',
                  '  new THREE.Mechanical.InternalRingGearGeometry({',
                  '    module: 0.04, teeth: 32, thickness: 0.18, boltCount: 6, boltHoleDiameter: 0.08',
                  '  }),',
                  '  mat',
                  ');',
                  'ring.rotation.x = -0.45;',
                  'scene.add(ring);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-rack',
            domain: 'mechanical',
            ctor: 'RackGeometry',
            summary:
                'Linear involute gear rack bar for rack-and-pinion linear actuators.',
            tags: ['rack', 'linear', 'actuator', 'cnc', 'tooth'],
            orbit: {theta: 32, phi: 24, zoom: 1.24},
            variants: [
              {
                label: '12-Tooth Linear Rack',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.26 });',
                  'const rack = new THREE.Mesh(',
                  '  new THREE.Mechanical.RackGeometry({',
                  '    module: 0.05, teeth: 12, thickness: 0.18, backHeight: 0.14',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rack);',
                ]),
              },
              {
                label: '18-Tooth Fine Pitch',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.54, roughness: 0.24 });',
                  'const rack = new THREE.Mesh(',
                  '  new THREE.Mechanical.RackGeometry({',
                  '    module: 0.035, teeth: 18, thickness: 0.14, backHeight: 0.11',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rack);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-pulley',
            domain: 'mechanical',
            ctor: 'PulleyGeometry',
            summary:
                'Toothed timing, multi-groove V-belt & crowned flat-belt pulleys with flanges.',
            tags: ['pulley', 'sheave', 'v-belt', 'timing', 'gt2', 'belt'],
            orbit: {theta: 30, phi: 26, zoom: 1.22},
            variants: [
              {
                label: 'Toothed Timing Pulley',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.54, roughness: 0.22 });',
                  'const pulley = new THREE.Mesh(',
                  '  new THREE.Mechanical.PulleyGeometry({',
                  '    profile: "timing", pitchRadius: 0.42, width: 0.22, teeth: 28,',
                  '    flangeHeight: 0.05, bore: 0.16, hubRadius: 0.2, hubWidth: 0.3',
                  '  }),',
                  '  mat',
                  ');',
                  'pulley.rotation.x = 0.4;',
                  'scene.add(pulley);',
                ]),
              },
              {
                label: 'Dual-Groove V-Belt',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.3 });',
                  'const pulley = new THREE.Mesh(',
                  '  new THREE.Mechanical.PulleyGeometry({',
                  '    profile: "v-belt", pitchRadius: 0.48, width: 0.3, grooves: 2, bore: 0.18, hubRadius: 0.22',
                  '  }),',
                  '  mat',
                  ');',
                  'pulley.rotation.x = 0.4;',
                  'scene.add(pulley);',
                ]),
              },
              {
                label: 'Flat Crowned Drum',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.52, roughness: 0.28 });',
                  'const pulley = new THREE.Mesh(',
                  '  new THREE.Mechanical.PulleyGeometry({',
                  '    profile: "flat", pitchRadius: 0.44, width: 0.32, bore: 0.16',
                  '  }),',
                  '  mat',
                  ');',
                  'pulley.rotation.x = 0.4;',
                  'scene.add(pulley);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-bolt',
            domain: 'mechanical',
            ctor: 'BoltGeometry',
            summary:
                'ISO metric hex, socket-cap, countersunk & button-head bolts with helical/annular threads.',
            tags:
                ['bolt', 'screw', 'fastener', 'hex', 'socket', 'metric', 'iso'],
            orbit: {theta: 32, phi: 24, zoom: 1.24},
            variants: [
              {
                label: 'Socket Cap M10×35',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.26 });',
                  'const bolt = new THREE.Mesh(',
                  '  new THREE.Mechanical.BoltGeometry({',
                  '    preset: "M10x35", headType: "socket", cosmeticThreads: true, scale: 15, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'bolt.rotation.z = -0.45;',
                  'scene.add(bolt);',
                ]),
              },
              {
                label: 'Hex Bolt M12×40',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.54, roughness: 0.22 });',
                  'const bolt = new THREE.Mesh(',
                  '  new THREE.Mechanical.BoltGeometry({',
                  '    preset: "M12x40", headType: "hex", cosmeticThreads: true, scale: 14, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'bolt.rotation.z = -0.45;',
                  'scene.add(bolt);',
                ]),
              },
              {
                label: 'Countersunk M8×25',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.53, roughness: 0.25 });',
                  'const bolt = new THREE.Mesh(',
                  '  new THREE.Mechanical.BoltGeometry({',
                  '    preset: "M8x25", headType: "countersunk", cosmeticThreads: true, scale: 18, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'bolt.rotation.z = -0.45;',
                  'scene.add(bolt);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-nut',
            domain: 'mechanical',
            ctor: 'NutGeometry',
            summary:
                'ISO metric chamfered hex, flanged & nylon-insert lock nuts with internal bore threads.',
            tags: ['nut', 'nyloc', 'flange', 'hex', 'fastener', 'metric'],
            orbit: {theta: 28, phi: 30, zoom: 1.24},
            variants: [
              {
                label: 'Nyloc Lock Nut M12',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.54, roughness: 0.22 });',
                  'const nut = new THREE.Mesh(',
                  '  new THREE.Mechanical.NutGeometry({ preset: "M12", nutType: "nyloc", cosmeticThreads: true, scale: 25 }),',
                  '  mat',
                  ');',
                  'nut.rotation.x = 0.35;',
                  'scene.add(nut);',
                ]),
              },
              {
                label: 'Flange Nut M10',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.53, roughness: 0.24 });',
                  'const nut = new THREE.Mesh(',
                  '  new THREE.Mechanical.NutGeometry({ preset: "M10", nutType: "flange", cosmeticThreads: true, scale: 28 }),',
                  '  mat',
                  ');',
                  'nut.rotation.x = 0.35;',
                  'scene.add(nut);',
                ]),
              },
              {
                label: 'Standard Hex M12',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.24 });',
                  'const nut = new THREE.Mesh(',
                  '  new THREE.Mechanical.NutGeometry({ preset: "M12", nutType: "hex", cosmeticThreads: true, scale: 25 }),',
                  '  mat',
                  ');',
                  'nut.rotation.x = 0.35;',
                  'scene.add(nut);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-washer',
            domain: 'mechanical',
            ctor: 'WasherGeometry',
            summary:
                'Chamfered ISO 7089 flat & wide fender load-distributing washers.',
            tags: ['washer', 'spacer', 'shim', 'fastener', 'iso'],
            orbit: {theta: 28, phi: 32, zoom: 1.22},
            variants: [
              {
                label: 'Chamfered ISO M12',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.54, roughness: 0.2 });',
                  'const washer = new THREE.Mesh(',
                  '  new THREE.Mechanical.WasherGeometry({ preset: "M12", chamfer: 0.0005, scale: 24 }),',
                  '  mat',
                  ');',
                  'washer.rotation.x = 0.45;',
                  'scene.add(washer);',
                ]),
              },
              {
                label: 'Wide Fender Washer',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.53, roughness: 0.24 });',
                  'const washer = new THREE.Mesh(',
                  '  new THREE.Mechanical.WasherGeometry({ innerDiameter: 0.18, outerDiameter: 0.68, thickness: 0.055, chamfer: 0.01 }),',
                  '  mat',
                  ');',
                  'washer.rotation.x = 0.45;',
                  'scene.add(washer);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-shaft',
            domain: 'mechanical',
            ctor: 'ShaftGeometry',
            summary:
                'Multi-stepped CNC turned drive shafts with end chamfers, D-cut flats & axial bores.',
            tags: ['shaft', 'spindle', 'axle', 'stepped', 'd-cut', 'cnc'],
            orbit: {theta: 36, phi: 24, zoom: 1.24},
            variants: [
              {
                label: '3-Step CNC Drive Shaft',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.54, roughness: 0.18 });',
                  'const shaft = new THREE.Mesh(',
                  '  new THREE.Mechanical.ShaftGeometry({',
                  '    steps: [',
                  '      { diameter: 0.22, length: 0.35, chamfer: 0.02 },',
                  '      { diameter: 0.34, length: 0.5, chamfer: 0.02 },',
                  '      { diameter: 0.26, length: 0.4, chamfer: 0.02 }',
                  '    ]',
                  '  }),',
                  '  mat',
                  ');',
                  'shaft.rotation.z = Math.PI * 0.42;',
                  'scene.add(shaft);',
                ]),
              },
              {
                label: 'D-Cut Motor Shaft',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.54, roughness: 0.22 });',
                  'const shaft = new THREE.Mesh(',
                  '  new THREE.Mechanical.ShaftGeometry({ diameter: 0.28, length: 1.1, dCut: 0.045, chamfer: 0.02 }),',
                  '  mat',
                  ');',
                  'shaft.rotation.z = Math.PI * 0.42;',
                  'scene.add(shaft);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-shaft-coupler',
            domain: 'mechanical',
            ctor: 'ShaftCouplerGeometry',
            summary:
                'Interlocking jaw-spider & split rigid clamp motor-to-leadscrew shaft couplings.',
            tags: ['coupler', 'coupling', 'jaw', 'lovejoy', 'clamp', 'motor'],
            orbit: {theta: 32, phi: 26, zoom: 1.22},
            variants: [
              {
                label: 'Jaw-Spider Coupling',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.51, roughness: 0.26 });',
                  'const coupler = new THREE.Mesh(',
                  '  new THREE.Mechanical.ShaftCouplerGeometry({',
                  '    style: "jaw-spider", outerDiameter: 0.55, length: 0.75, bore1: 0.16, bore2: 0.2, jaws: 3',
                  '  }),',
                  '  mat',
                  ');',
                  'coupler.rotation.z = 0.45;',
                  'scene.add(coupler);',
                ]),
              },
              {
                label: 'Rigid Split-Clamp',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.22 });',
                  'const coupler = new THREE.Mesh(',
                  '  new THREE.Mechanical.ShaftCouplerGeometry({',
                  '    style: "rigid-clamp", outerDiameter: 0.52, length: 0.78, bore1: 0.18, bore2: 0.18, clampScrews: true',
                  '  }),',
                  '  mat',
                  ');',
                  'coupler.rotation.z = 0.45;',
                  'scene.add(coupler);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-bearing',
            domain: 'mechanical',
            ctor: 'BearingGeometry',
            summary:
                'Deep-groove radial ball bearings with inner/outer races, steel balls, shields & flanges.',
            tags: ['bearing', 'ball-bearing', '608', 'race', 'flanged'],
            orbit: {theta: 28, phi: 28, zoom: 1.22},
            variants: [
              {
                label: 'Open Deep-Groove Bearing',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.55, roughness: 0.16 });',
                  'const brg = new THREE.Mesh(',
                  '  new THREE.Mechanical.BearingGeometry({',
                  '    innerDiameter: 0.36, outerDiameter: 0.88, width: 0.24, balls: 9, shielded: false',
                  '  }),',
                  '  mat',
                  ');',
                  'brg.rotation.x = 0.42;',
                  'scene.add(brg);',
                ]),
              },
              {
                label: 'Flanged Shielded Bearing',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.54, roughness: 0.22 });',
                  'const brg = new THREE.Mesh(',
                  '  new THREE.Mechanical.BearingGeometry({',
                  '    innerDiameter: 0.34, outerDiameter: 0.82, width: 0.24, shielded: true, flanged: true, flangeDiameter: 0.94',
                  '  }),',
                  '  mat',
                  ');',
                  'brg.rotation.x = 0.42;',
                  'scene.add(brg);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-pillow-block',
            domain: 'mechanical',
            ctor: 'PillowBlockGeometry',
            summary:
                'UCP cast-iron pedestal pillow-block mounted bearing with slotted bolt feet.',
            tags: ['pillow-block', 'ucp', 'pedestal', 'bearing', 'housing'],
            orbit: {theta: 32, phi: 24, zoom: 1.22},
            variants: [
              {
                label: 'UCP Pedestal Bearing',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.55, roughness: 0.42 });',
                  'const block = new THREE.Mesh(',
                  '  new THREE.Mechanical.PillowBlockGeometry({',
                  '    bore: 0.28, centerHeight: 0.48, baseLength: 1.35, baseWidth: 0.38, housingRadius: 0.42',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(block);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-helical-spring',
            domain: 'mechanical',
            ctor: 'HelicalSpringGeometry',
            summary:
                'Twist-free Bishop-frame compression coil spring with optional flat ground ends.',
            tags: ['spring', 'coil', 'helix', 'suspension', 'damper'],
            orbit: {theta: 28, phi: 22, zoom: 1.22},
            variants: [
              {
                label: '7-Coil Compression Spring',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.54, roughness: 0.2 });',
                  'const spring = new THREE.Mesh(',
                  '  new THREE.Mechanical.HelicalSpringGeometry({',
                  '    meanRadius: 0.32, wireRadius: 0.055, coils: 7, length: 1.15, flatEnds: true',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(spring);',
                ]),
              },
              {
                label: 'Heavy 4.5-Coil Die Spring',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf87171, metalness: 0.45, roughness: 0.38 });',
                  'const spring = new THREE.Mesh(',
                  '  new THREE.Mechanical.HelicalSpringGeometry({',
                  '    meanRadius: 0.34, wireRadius: 0.075, coils: 4.5, length: 1.0, flatEnds: true',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(spring);',
                ]),
              },
            ],
          },
          {
            slug: 'mechanical-flange-plate',
            domain: 'mechanical',
            ctor: 'FlangePlateGeometry',
            summary:
                'Circular weld-neck & slip-on mounting flange with center bore & bolt-circle holes.',
            tags: ['flange', 'plate', 'weld-neck', 'bolt-circle', 'mount'],
            orbit: {theta: 28, phi: 30, zoom: 1.22},
            variants:
                [
                  {
                    label: '8-Bolt Weld-Neck Flange',
                    code: wrapScene([
                      'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.25 });',
                      'const flange = new THREE.Mesh(',
                      '  new THREE.Mechanical.FlangePlateGeometry({',
                      '    outerRadius: 0.62, thickness: 0.12, bore: 0.42,',
                      '    boltCount: 8, boltCircleRadius: 0.48, boltHoleDiameter: 0.085,',
                      '    neckRadius: 0.28, neckHeight: 0.22',
                      '  }),',
                      '  mat',
                      ');',
                      'flange.rotation.x = -0.25;',
                      'scene.add(flange);',
                    ]),
                  },
                  {
                    label: '4-Bolt Flat Plate',
                    code:
                        wrapScene(
                            [
                              'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.52, roughness: 0.28 });',
                              'const flange = new THREE.Mesh(',
                              '  new THREE.Mechanical.FlangePlateGeometry({',
                              '    outerRadius: 0.55, thickness: 0.1, bore: 0.3, boltCount: 4, boltCircleRadius: 0.4, boltHoleDiameter: 0.09',
                              '  }),',
                              '  mat',
                              ');',
                              'flange.rotation.x = -0.25;',
                              'scene.add(flange);',
                            ]),
                  },
                ],
          },
          {
            slug: 'mechanical-profile-extrusion',
            domain: 'mechanical',
            ctor: 'ProfileExtrusionGeometry',
            summary:
                '7 structural profiles: T-slot framing, I-beam, C-channel, L-angle, rectangular/round tubes & hex bar.',
            tags: [
              't-slot', '8020', 'i-beam', 'c-channel', 'extrusion', 'structural'
            ],
            orbit: {theta: 34, phi: 26, zoom: 1.22},
            variants: [
              {
                label: 'T-Slot Aluminum Extrusion',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.24 });',
                  'const beam = new THREE.Mesh(',
                  '  new THREE.Mechanical.ProfileExtrusionGeometry({',
                  '    profile: "t-slot", width: 0.45, height: 0.45, length: 1.25',
                  '  }),',
                  '  mat',
                  ');',
                  'beam.rotation.x = 0.35;',
                  'scene.add(beam);',
                ]),
              },
              {
                label: 'Wide-Flange Steel I-Beam',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.32, roughness: 0.28 });',
                  'const beam = new THREE.Mesh(',
                  '  new THREE.Mechanical.ProfileExtrusionGeometry({',
                  '    profile: "i-beam", width: 0.48, height: 0.58, length: 1.35, wallThickness: 0.055',
                  '  }),',
                  '  mat',
                  ');',
                  'beam.rotation.x = 0.3;',
                  'scene.add(beam);',
                ]),
              },
              {
                label: 'Structural C-Channel',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.28, roughness: 0.32 });',
                  'const beam = new THREE.Mesh(',
                  '  new THREE.Mechanical.ProfileExtrusionGeometry({',
                  '    profile: "c-channel", width: 0.36, height: 0.54, length: 1.3, wallThickness: 0.055',
                  '  }),',
                  '  mat',
                  ');',
                  'beam.rotation.x = 0.3;',
                  'scene.add(beam);',
                ]),
              },
              {
                label: 'L-Angle Steel Bracket',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.32, roughness: 0.26 });',
                  'const beam = new THREE.Mesh(',
                  '  new THREE.Mechanical.ProfileExtrusionGeometry({',
                  '    profile: "l-angle", width: 0.46, height: 0.46, length: 1.3, wallThickness: 0.06',
                  '  }),',
                  '  mat',
                  ');',
                  'beam.rotation.x = 0.32;',
                  'scene.add(beam);',
                ]),
              },
              {
                label: 'Hollow Rectangular Tube',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, metalness: 0.3, roughness: 0.25 });',
                  'const beam = new THREE.Mesh(',
                  '  new THREE.Mechanical.ProfileExtrusionGeometry({',
                  '    profile: "rect-tube", width: 0.52, height: 0.36, length: 1.35, wallThickness: 0.05',
                  '  }),',
                  '  mat',
                  ');',
                  'beam.rotation.x = 0.32;',
                  'scene.add(beam);',
                ]),
              },
            ],
          },

          // =========================================================================
          // 2. ARCHITECTURE & AEC (9)
          // =========================================================================
          {
            slug: 'architecture-wall',
            domain: 'architecture',
            ctor: 'WallGeometry',
            summary:
                'Walls with rectangular, Roman, segmental & pointed Gothic openings, segmented baseboards & cornices.',
            tags: ['wall', 'facade', 'opening', 'baseboard', 'cornice', 'room'],
            orbit: {theta: 24, phi: 18, zoom: 1.2},
            variants: [
              {
                label: 'Arched Facade + Moldings',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.78, metalness: 0.04 });',
                  'const wall = new THREE.Mesh(',
                  '  new THREE.Architecture.WallGeometry({',
                  '    length: 5.4, height: 3.1, thickness: 0.26,',
                  '    baseboardHeight: 0.14, corniceHeight: 0.16, origin: "center",',
                  '    openings: [',
                  '      { x: -1.65, sillHeight: 0.85, width: 1.0, height: 1.45, arch: "pointed" },',
                  '      { x: 0, sillHeight: 0, width: 1.05, height: 2.25, arch: "semicircular" },',
                  '      { x: 1.65, sillHeight: 0.85, width: 1.0, height: 1.45, arch: "segmental" }',
                  '    ]',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(wall);',
                ]),
              },
              {
                label: 'Interior Partition Wall',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.82 });',
                  'const wall = new THREE.Mesh(',
                  '  new THREE.Architecture.WallGeometry({',
                  '    length: 4.4, height: 2.8, thickness: 0.18, baseboardHeight: 0.12, origin: "center",',
                  '    openings: [',
                  '      { x: -0.95, y: 0, width: 0.95, height: 2.1 },',
                  '      { x: 1.0, y: 0.9, width: 1.3, height: 1.2 }',
                  '    ]',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(wall);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-slab',
            domain: 'architecture',
            ctor: 'SlabGeometry',
            summary:
                'Horizontal floor, ceiling & mezzanine slabs with rectangular stairwell & circular skylight cutouts.',
            tags: [
              'slab', 'floor', 'ceiling', 'mezzanine', 'skylight', 'stairwell'
            ],
            orbit: {theta: 32, phi: 34, zoom: 1.2},
            variants: [
              {
                label: 'Stairwell + Skylight Cutouts',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.75, metalness: 0.08 });',
                  'const slab = new THREE.Mesh(',
                  '  new THREE.Architecture.SlabGeometry({',
                  '    width: 6.0, depth: 4.6, thickness: 0.28, origin: "center",',
                  '    openings: [',
                  '      { shape: "rect", x: -1.35, z: 0.3, width: 1.3, depth: 2.6 },',
                  '      { shape: "circle", x: 1.45, z: -0.4, radius: 0.9 }',
                  '    ]',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(slab);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-staircase',
            domain: 'architecture',
            ctor: 'StaircaseGeometry',
            summary:
                'IBC 7-11 compliant straight, L-landing, U-switchback & spiral stairs with solid or open stringers.',
            tags: [
              'staircase', 'stairs', 'spiral', 'switchback', 'landing', 'ibc'
            ],
            orbit: {theta: 34, phi: 24, zoom: 1.18},
            variants: [
              {
                label: 'Spiral Staircase',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.42, metalness: 0.35 });',
                  'const stair = new THREE.Mesh(',
                  '  new THREE.Architecture.StaircaseGeometry({',
                  '    mode: "spiral", rise: 2.9, width: 0.95, turns: 1.15, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(stair);',
                ]),
              },
              {
                label: 'U-Shape Switchback',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.72 });',
                  'const stair = new THREE.Mesh(',
                  '  new THREE.Architecture.StaircaseGeometry({',
                  '    mode: "u-shape", turn: "right", rise: 2.8, width: 1.0, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(stair);',
                ]),
              },
              {
                label: 'L-Shape Landing',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7 });',
                  'const stair = new THREE.Mesh(',
                  '  new THREE.Architecture.StaircaseGeometry({',
                  '    mode: "l-shape", turn: "left", rise: 2.8, width: 1.05, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(stair);',
                ]),
              },
              {
                label: 'Open-Stringer Straight',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.35, roughness: 0.32 });',
                  'const stair = new THREE.Mesh(',
                  '  new THREE.Architecture.StaircaseGeometry({',
                  '    mode: "straight", rise: 2.6, width: 1.1, solid: false, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(stair);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-roof',
            domain: 'architecture',
            ctor: 'RoofGeometry',
            summary:
                '6 architectural roof silhouettes: gable, hip, mansard, gambrel, shed & commercial flat-parapet.',
            tags: ['roof', 'gable', 'hip', 'mansard', 'gambrel', 'parapet'],
            orbit: {theta: 32, phi: 24, zoom: 1.2},
            variants: [
              {
                label: 'Gambrel Vaulted Shell',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.55, metalness: 0.15 });',
                  'const roof = new THREE.Mesh(',
                  '  new THREE.Architecture.RoofGeometry({',
                  '    style: "gambrel", width: 5.2, depth: 6.4, height: 2.3, solid: false, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(roof);',
                ]),
              },
              {
                label: 'Hip Roof',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.6, metalness: 0.25 });',
                  'const roof = new THREE.Mesh(',
                  '  new THREE.Architecture.RoofGeometry({',
                  '    style: "hip", width: 5.5, depth: 7.5, pitchDeg: 32, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(roof);',
                ]),
              },
              {
                label: 'Mansard Dual-Pitch',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.3 });',
                  'const roof = new THREE.Mesh(',
                  '  new THREE.Architecture.RoofGeometry({',
                  '    style: "mansard", width: 5.6, depth: 7.0, height: 2.2, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(roof);',
                ]),
              },
              {
                label: 'Flat-Parapet Commercial',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.78 });',
                  'const roof = new THREE.Mesh(',
                  '  new THREE.Architecture.RoofGeometry({',
                  '    style: "flat-parapet", width: 6.0, depth: 7.2, height: 0.85, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(roof);',
                ]),
              },
              {
                label: 'Classic Gable Roof',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.58, metalness: 0.12 });',
                  'const roof = new THREE.Mesh(',
                  '  new THREE.Architecture.RoofGeometry({',
                  '    style: "gable", width: 5.4, depth: 7.0, pitchDeg: 34, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(roof);',
                ]),
              },
              {
                label: 'Mono-Pitch Shed Roof',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.45, metalness: 0.35 });',
                  'const roof = new THREE.Mesh(',
                  '  new THREE.Architecture.RoofGeometry({',
                  '    style: "shed", width: 5.4, depth: 6.6, pitchDeg: 18, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(roof);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-door',
            domain: 'architecture',
            ctor: 'DoorGeometry',
            summary:
                '10 leaf styles × 5 operations (swing, patio slider, barn, pocket & bifold) with hardware.',
            tags: [
              'door', 'swing', 'barn', 'bifold', 'pocket', 'french', 'arched'
            ],
            orbit: {theta: 26, phi: 18, zoom: 1.2},
            variants: [
              {
                label: 'Double Arched Swing (40% Open)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xfb923c, roughness: 0.45, metalness: 0.12 });',
                  'const door = new THREE.Mesh(',
                  '  new THREE.Architecture.DoorGeometry({',
                  '    style: "arched", operation: "swing", leaves: 2, width: 1.65, height: 2.25,',
                  '    openFraction: 0.4, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(door);',
                ]),
              },
              {
                label: 'Exposed-Rail Barn Door',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.48, metalness: 0.2 });',
                  'const door = new THREE.Mesh(',
                  '  new THREE.Architecture.DoorGeometry({',
                  '    style: "panel-2", operation: "barn", width: 1.05, height: 2.15, openFraction: 0.55, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(door);',
                ]),
              },
              {
                label: '4-Leaf Louvered Bifold',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.65 });',
                  'const door = new THREE.Mesh(',
                  '  new THREE.Architecture.DoorGeometry({',
                  '    style: "louvered", operation: "bifold", leaves: 4, width: 1.65, height: 2.1, openFraction: 0.55, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(door);',
                ]),
              },
              {
                label: '4-Panel Hinged Swing',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });',
                  'const door = new THREE.Mesh(',
                  '  new THREE.Architecture.DoorGeometry({',
                  '    style: "panel-4", operation: "swing", width: 0.95, height: 2.1, openAngleDeg: 38, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(door);',
                ]),
              },
              {
                label: 'OXO Sliding Patio Door',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.38, metalness: 0.45 });',
                  'const door = new THREE.Mesh(',
                  '  new THREE.Architecture.DoorGeometry({',
                  '    style: "french", operation: "slider", trackPattern: "OXO", width: 2.4, height: 2.15, openFraction: 0.6, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(door);',
                ]),
              },
              {
                label: 'Recessed Pocket Door',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.55 });',
                  'const door = new THREE.Mesh(',
                  '  new THREE.Architecture.DoorGeometry({',
                  '    style: "vision-lite", operation: "pocket", width: 1.0, height: 2.1, openFraction: 0.5, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(door);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-window',
            domain: 'architecture',
            ctor: 'WindowGeometry',
            summary:
                '10 window styles: arched fanlight, double-hung, casement, slider, awning, hopper & mullion grids.',
            tags: [
              'window', 'casement', 'double-hung', 'sash', 'mullion', 'arched'
            ],
            orbit: {theta: 26, phi: 18, zoom: 1.22},
            variants: [
              {
                label: 'Arched Fanlight Window',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.52, metalness: 0.15 });',
                  'const win = new THREE.Mesh(',
                  '  new THREE.Architecture.WindowGeometry({',
                  '    style: "arched", width: 1.3, height: 1.75, cols: 2, rows: 2, sill: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(win);',
                ]),
              },
              {
                label: 'Double Casement (Open)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4, metalness: 0.45 });',
                  'const win = new THREE.Mesh(',
                  '  new THREE.Architecture.WindowGeometry({',
                  '    style: "casement", leaves: 2, width: 1.4, height: 1.35, openFraction: 0.55, casing: true, sill: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(win);',
                ]),
              },
              {
                label: 'Double-Hung Sash',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.58 });',
                  'const win = new THREE.Mesh(',
                  '  new THREE.Architecture.WindowGeometry({',
                  '    style: "double-hung", width: 1.15, height: 1.55, cols: 2, rows: 2, openFraction: 0.45, topOpenFraction: 0.3, casing: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(win);',
                ]),
              },
              {
                label: 'Top-Hinged Awning Window',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.42, metalness: 0.35 });',
                  'const win = new THREE.Mesh(',
                  '  new THREE.Architecture.WindowGeometry({',
                  '    style: "awning", width: 1.35, height: 0.95, openFraction: 0.65, casing: true, sill: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(win);',
                ]),
              },
              {
                label: '3-Track Sliding Window',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.45, metalness: 0.4 });',
                  'const win = new THREE.Mesh(',
                  '  new THREE.Architecture.WindowGeometry({',
                  '    style: "slider", trackPattern: "XOX", width: 1.85, height: 1.2, openFraction: 0.55, sill: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(win);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-railing',
            domain: 'architecture',
            ctor: 'RailingGeometry',
            summary:
                'IBC code-spaced vertical baluster, horizontal-bar & modern infill-panel guardrails.',
            tags: ['railing', 'balustrade', 'guardrail', 'handrail', 'balcony'],
            orbit: {theta: 28, phi: 20, zoom: 1.22},
            variants: [
              {
                label: 'IBC Baluster Guardrail',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.51, roughness: 0.28 });',
                  'const rail = new THREE.Mesh(',
                  '  new THREE.Architecture.RailingGeometry({',
                  '    style: "baluster", length: 2.8, height: 1.07, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rail);',
                ]),
              },
              {
                label: 'Horizontal-Bar Cable Rail',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.22 });',
                  'const rail = new THREE.Mesh(',
                  '  new THREE.Architecture.RailingGeometry({',
                  '    style: "horizontal-bar", length: 2.8, height: 1.07, horizontalBars: 6, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rail);',
                ]),
              },
              {
                label: 'Modern Infill-Panel Guardrail',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, metalness: 0.45, roughness: 0.22 });',
                  'const rail = new THREE.Mesh(',
                  '  new THREE.Architecture.RailingGeometry({',
                  '    style: "panel", length: 2.8, height: 1.07, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rail);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-column',
            domain: 'architecture',
            ctor: 'ColumnGeometry',
            summary:
                'Classical fluted, Doric, Tuscan, square-pilaster & structural steel H-columns with entasis.',
            tags: ['column', 'pillar', 'doric', 'tuscan', 'fluted', 'pilaster'],
            orbit: {theta: 28, phi: 18, zoom: 1.2},
            variants: [
              {
                label: 'Fluted Classical Column',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.68, metalness: 0.05 });',
                  'const col = new THREE.Mesh(',
                  '  new THREE.Architecture.ColumnGeometry({',
                  '    style: "fluted", height: 2.8, radius: 0.26, flutes: 20, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(col);',
                ]),
              },
              {
                label: 'Doric Order',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.72 });',
                  'const col = new THREE.Mesh(',
                  '  new THREE.Architecture.ColumnGeometry({',
                  '    style: "doric", height: 2.8, radius: 0.26, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(col);',
                ]),
              },
              {
                label: 'Tuscan Order',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.74 });',
                  'const col = new THREE.Mesh(',
                  '  new THREE.Architecture.ColumnGeometry({',
                  '    style: "tuscan", height: 2.8, radius: 0.26, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(col);',
                ]),
              },
              {
                label: 'Structural Steel H-Column',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.52, roughness: 0.3 });',
                  'const col = new THREE.Mesh(',
                  '  new THREE.Architecture.ColumnGeometry({',
                  '    style: "h-column", height: 2.8, radius: 0.24, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(col);',
                ]),
              },
            ],
          },
          {
            slug: 'architecture-archway',
            domain: 'architecture',
            ctor: 'ArchwayGeometry',
            summary:
                'Masonry Roman semicircular, segmental & pointed Gothic portals with keystone & imposts.',
            tags:
                ['archway', 'portal', 'roman', 'gothic', 'keystone', 'masonry'],
            orbit: {theta: 26, phi: 18, zoom: 1.2},
            variants: [
              {
                label: 'Pointed Gothic Portal',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.78, metalness: 0.05 });',
                  'const arch = new THREE.Mesh(',
                  '  new THREE.Architecture.ArchwayGeometry({',
                  '    profile: "pointed", span: 1.8, height: 2.6, pierWidth: 0.45, depth: 0.45,',
                  '    keystone: true, impost: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(arch);',
                ]),
              },
              {
                label: 'Roman Semicircular Arch',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.75 });',
                  'const arch = new THREE.Mesh(',
                  '  new THREE.Architecture.ArchwayGeometry({',
                  '    profile: "semicircular", span: 1.9, height: 2.5, keystone: true, impost: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(arch);',
                ]),
              },
            ],
          },

          // =========================================================================
          // 3. INDUSTRIAL & PROCESS PLANT (10)
          // =========================================================================
          {
            slug: 'industrial-pipe-run',
            domain: 'industrial',
            ctor: 'PipeRunGeometry',
            summary:
                '3D multi-waypoint process pipe routing with smooth bent elbows & ASME weld-neck flanges.',
            tags: ['pipe', 'piping', 'manifold', 'flange', 'elbow', 'plumbing'],
            orbit: {theta: 34, phi: 24, zoom: 1.22},
            variants: [
              {
                label: '3D Z-Bend DN100 Run',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.49, roughness: 0.28 });',
                  'const pipe = new THREE.Mesh(',
                  '  new THREE.Industrial.PipeRunGeometry({',
                  '    size: "DN100", flangedEnds: true,',
                  '    waypoints: [[-0.8, -0.45, 0.4], [0.2, -0.45, 0.4], [0.2, 0.45, 0.4], [0.2, 0.45, -0.55]]',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(pipe);',
                ]),
              },
              {
                label: 'U-Loop Manifold DN80',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.22 });',
                  'const pipe = new THREE.Mesh(',
                  '  new THREE.Industrial.PipeRunGeometry({',
                  '    size: "DN80", flangedEnds: true,',
                  '    waypoints: [[-0.6, -0.4, 0], [-0.6, 0.45, 0], [0.6, 0.45, 0], [0.6, -0.4, 0]]',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(pipe);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-pipe-fitting',
            domain: 'industrial',
            ctor: 'PipeFittingGeometry',
            summary:
                'ASME flanged 90°/45° elbows, tees, 4-way crosses, concentric/eccentric reducers & end caps.',
            tags: ['fitting', 'tee', 'elbow', 'cross', 'reducer', 'flanged'],
            orbit: {theta: 32, phi: 26, zoom: 1.24},
            variants: [
              {
                label: 'Flanged Reducing Tee',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.26 });',
                  'const tee = new THREE.Mesh(',
                  '  new THREE.Industrial.PipeFittingGeometry({',
                  '    kind: "tee", size: "DN125", secondarySize: "DN80", flanged: true',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(tee);',
                ]),
              },
              {
                label: 'Flanged 90° Elbow',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.24 });',
                  'const elbow = new THREE.Mesh(',
                  '  new THREE.Industrial.PipeFittingGeometry({ kind: "elbow-90", size: "DN125", flanged: true }),',
                  '  mat',
                  ');',
                  'scene.add(elbow);',
                ]),
              },
              {
                label: '4-Way Flanged Cross',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.49, roughness: 0.3 });',
                  'const cross = new THREE.Mesh(',
                  '  new THREE.Industrial.PipeFittingGeometry({ kind: "cross", size: "DN100", flanged: true }),',
                  '  mat',
                  ');',
                  'scene.add(cross);',
                ]),
              },
              {
                label: 'Concentric Flanged Reducer',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.51, roughness: 0.25 });',
                  'const red = new THREE.Mesh(',
                  '  new THREE.Industrial.PipeFittingGeometry({ kind: "reducer", size: "DN150", secondarySize: "DN80", flanged: true }),',
                  '  mat',
                  ');',
                  'scene.add(red);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-valve',
            domain: 'industrial',
            ctor: 'ValveGeometry',
            summary:
                'Handwheel gate, quarter-turn ball, wafer butterfly, pneumatic diaphragm control & check valves.',
            tags: [
              'valve', 'gate', 'ball-valve', 'butterfly', 'pneumatic',
              'actuator'
            ],
            orbit: {theta: 32, phi: 22, zoom: 1.22},
            variants: [
              {
                label: 'Rising-Stem Gate Valve',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xfca5a5, metalness: 0.28, roughness: 0.32 });',
                  'const valve = new THREE.Mesh(',
                  '  new THREE.Industrial.ValveGeometry({ kind: "gate-handwheel", size: "DN125", openFraction: 0.75 }),',
                  '  mat',
                  ');',
                  'scene.add(valve);',
                ]),
              },
              {
                label: 'Pneumatic Control Valve',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x22c55e, metalness: 0.55, roughness: 0.35 });',
                  'const valve = new THREE.Mesh(',
                  '  new THREE.Industrial.ValveGeometry({ kind: "pneumatic-control", size: "DN100", openFraction: 0.5 }),',
                  '  mat',
                  ');',
                  'scene.add(valve);',
                ]),
              },
              {
                label: 'Quarter-Turn Ball Valve',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.52, roughness: 0.26 });',
                  'const valve = new THREE.Mesh(',
                  '  new THREE.Industrial.ValveGeometry({ kind: "ball-lever", size: "DN100", openFraction: 0.35 }),',
                  '  mat',
                  ');',
                  'scene.add(valve);',
                ]),
              },
              {
                label: 'Wafer Butterfly Valve',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.47, roughness: 0.3 });',
                  'const valve = new THREE.Mesh(',
                  '  new THREE.Industrial.ValveGeometry({ kind: "butterfly", size: "DN150", openFraction: 0.45 }),',
                  '  mat',
                  ');',
                  'scene.add(valve);',
                ]),
              },
              {
                label: 'Swing Check Valve',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.53, roughness: 0.24 });',
                  'const valve = new THREE.Mesh(',
                  '  new THREE.Industrial.ValveGeometry({ kind: "check", size: "DN125" }),',
                  '  mat',
                  ');',
                  'scene.add(valve);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-centrifugal-pump',
            domain: 'industrial',
            ctor: 'CentrifugalPumpGeometry',
            summary:
                'ANSI end-suction volute pump + OSHA coupling guard + finned TEFC motor on structural skid.',
            tags: ['pump', 'centrifugal', 'motor', 'skid', 'volute', 'process'],
            orbit: {theta: 34, phi: 22, zoom: 1.22},
            variants: [
              {
                label: '22 kW Process Pump Skid',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.47, roughness: 0.34 });',
                  'const pump = new THREE.Mesh(',
                  '  new THREE.Industrial.CentrifugalPumpGeometry({',
                  '    suctionSize: "DN100", dischargeSize: "DN80", motorPowerKw: 22, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(pump);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-pallet-rack',
            domain: 'industrial',
            ctor: 'PalletRackGeometry',
            summary:
                'Multi-bay, multi-level selective warehouse pallet racking with uprights, beams & deck bars.',
            tags: ['rack', 'pallet', 'warehouse', 'shelving', 'logistics'],
            orbit: {theta: 28, phi: 20, zoom: 1.18},
            variants: [
              {
                label: '2-Bay × 3-Level Rack',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xfb923c, metalness: 0.52, roughness: 0.4 });',
                  'const rack = new THREE.Mesh(',
                  '  new THREE.Industrial.PalletRackGeometry({',
                  '    bays: 2, levels: 3, bayWidth: 2.3, depth: 1.05, height: 3.8, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rack);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-conveyor',
            domain: 'industrial',
            ctor: 'ConveyorGeometry',
            summary:
                'Horizontal & inclined live-roller or belt conveyors with side guides & adjustable support legs.',
            tags:
                ['conveyor', 'roller', 'belt', 'factory', 'material-handling'],
            orbit: {theta: 32, phi: 24, zoom: 1.2},
            variants: [
              {
                label: 'Live-Roller Conveyor',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.51, roughness: 0.28 });',
                  'const conv = new THREE.Mesh(',
                  '  new THREE.Industrial.ConveyorGeometry({',
                  '    kind: "roller", length: 2.8, width: 0.75, height: 0.85, sideGuides: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(conv);',
                ]),
              },
              {
                label: 'Inclined Belt Conveyor',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.48, roughness: 0.36 });',
                  'const conv = new THREE.Mesh(',
                  '  new THREE.Industrial.ConveyorGeometry({',
                  '    kind: "belt", length: 3.0, width: 0.75, height: 0.8, inclineDeg: 14, sideGuides: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(conv);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-catwalk-platform',
            domain: 'industrial',
            ctor: 'CatwalkPlatformGeometry',
            summary:
                'Elevated OSHA steel grating walkway & mezzanine platform with toeboards & guardrails.',
            tags: [
              'catwalk', 'platform', 'mezzanine', 'walkway', 'grating', 'osha'
            ],
            orbit: {theta: 30, phi: 22, zoom: 1.2},
            variants: [
              {
                label: 'Dual-Guardrail Catwalk',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.46, roughness: 0.36 });',
                  'const catwalk = new THREE.Mesh(',
                  '  new THREE.Industrial.CatwalkPlatformGeometry({',
                  '    length: 3.2, width: 1.1, height: 1.6, guardrail: "both", origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(catwalk);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-ladder',
            domain: 'industrial',
            ctor: 'IndustrialLadderGeometry',
            summary:
                'OSHA fixed vertical access ladder with wall mounting standoffs & hoop safety cage.',
            tags: ['ladder', 'cage', 'osha', 'access', 'climb'],
            orbit: {theta: 34, phi: 18, zoom: 1.18},
            variants: [
              {
                label: 'Caged Access Ladder',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.55, roughness: 0.36 });',
                  'const ladder = new THREE.Mesh(',
                  '  new THREE.Industrial.IndustrialLadderGeometry({',
                  '    height: 4.2, width: 0.52, includeCage: true, cageStartHeight: 1.6, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(ladder);',
                ]),
              },
              {
                label: 'Uncaged Wall Ladder',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.52, roughness: 0.26 });',
                  'const ladder = new THREE.Mesh(',
                  '  new THREE.Industrial.IndustrialLadderGeometry({',
                  '    height: 3.2, width: 0.5, includeCage: false, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(ladder);',
                ]),
              },
            ],
          },
          {
            slug: 'industrial-safety-barrier',
            domain: 'industrial',
            ctor: 'SafetyBarrierGeometry',
            summary:
                'Forklift crash guardrails, tubular safety handrails & heavy baseplate bollards.',
            tags: ['barrier', 'bollard', 'guardrail', 'forklift', 'safety'],
            orbit: {theta: 28, phi: 22, zoom: 1.22},
            variants:
                [
                  {
                    label: 'Double Crash Guardrail',
                    code: wrapScene([
                      'const mat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.48, roughness: 0.38 });',
                      'const barrier = new THREE.Mesh(',
                      '  new THREE.Industrial.SafetyBarrierGeometry({',
                      '    kind: "guardrail-double", length: 2.6, height: 0.95, origin: "center"',
                      '  }),',
                      '  mat',
                      ');',
                      'scene.add(barrier);',
                    ]),
                  },
                  {
                    label: 'Heavy Steel Bollard',
                    code: wrapScene([
                      'const mat = new THREE.MeshStandardMaterial({ color: 0xfb923c, metalness: 0.45, roughness: 0.4 });',
                      'const barrier = new THREE.Mesh(',
                      '  new THREE.Industrial.SafetyBarrierGeometry({',
                      '    kind: "bollard", height: 1.05, postRadius: 0.085, origin: "center"',
                      '  }),',
                      '  mat',
                      ');',
                      'scene.add(barrier);',
                    ]),
                  },
                ],
          },
          {
            slug: 'industrial-storage-tank',
            domain: 'industrial',
            ctor: 'StorageTankGeometry',
            summary:
                'Vertical dished-head leg vessels, horizontal saddle tanks, cone-hopper silos & API 650 tanks.',
            tags: ['tank', 'vessel', 'silo', 'hopper', 'reactor', 'api650'],
            orbit: {theta: 30, phi: 20, zoom: 1.2},
            variants: [
              {
                label: 'Vertical Dished on Legs',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.22 });',
                  'const tank = new THREE.Mesh(',
                  '  new THREE.Industrial.StorageTankGeometry({',
                  '    kind: "vertical-dished", radius: 0.75, shellHeight: 1.6, legHeight: 0.7, manway: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(tank);',
                ]),
              },
              {
                label: 'Horizontal Saddle Vessel',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.52, roughness: 0.26 });',
                  'const tank = new THREE.Mesh(',
                  '  new THREE.Industrial.StorageTankGeometry({',
                  '    kind: "horizontal-saddle", radius: 0.65, length: 2.4, manway: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(tank);',
                ]),
              },
              {
                label: 'Cone-Hopper Silo',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.5, roughness: 0.3 });',
                  'const tank = new THREE.Mesh(',
                  '  new THREE.Industrial.StorageTankGeometry({',
                  '    kind: "cone-hopper", radius: 0.8, shellHeight: 1.4, hopperHeight: 0.85, legHeight: 0.9, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(tank);',
                ]),
              },
              {
                label: 'API 650 Flat-Bottom Tank',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.47, roughness: 0.34 });',
                  'const tank = new THREE.Mesh(',
                  '  new THREE.Industrial.StorageTankGeometry({',
                  '    kind: "flat-api650", radius: 1.15, shellHeight: 1.5, manway: true, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(tank);',
                ]),
              },
            ],
          },

          // =========================================================================
          // 4. SCIENCE, BIOLOGY & MATH (14)
          // =========================================================================
          {
            slug: 'science-molecule',
            domain: 'science',
            ctor: 'MoleculeGeometry',
            summary:
                'Ball-and-stick & space-filling CPK vertex-colored molecules across 44 IUPAC elements & presets.',
            tags: [
              'molecule', 'chemistry', 'caffeine', 'benzene', 'cpk', 'atoms',
              'bonds'
            ],
            orbit: {theta: 24, phi: 26, zoom: 1.24},
            variants: [
              {
                label: 'Caffeine (Ball & Stick CPK)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.08 });',
                  'const mol = new THREE.Mesh(',
                  '  new THREE.Science.MoleculeGeometry({ preset: "caffeine", style: "ball-and-stick" }),',
                  '  mat',
                  ');',
                  'mol.rotation.x = 0.4;',
                  'scene.add(mol);',
                ]),
              },
              {
                label: 'Benzene Aromatic Ring',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.08 });',
                  'const mol = new THREE.Mesh(',
                  '  new THREE.Science.MoleculeGeometry({ preset: "benzene", style: "ball-and-stick" }),',
                  '  mat',
                  ');',
                  'mol.rotation.x = 0.5;',
                  'scene.add(mol);',
                ]),
              },
              {
                label: 'Ethanol (Space-Filling VdW)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 });',
                  'const mol = new THREE.Mesh(',
                  '  new THREE.Science.MoleculeGeometry({ preset: "ethanol", style: "space-filling" }),',
                  '  mat',
                  ');',
                  'scene.add(mol);',
                ]),
              },
            ],
          },
          {
            slug: 'science-ribbon',
            domain: 'science',
            ctor: 'RibbonGeometry',
            summary:
                'Continuous polypeptide/biopolymer cartoon lofts across coil, α-helix & arrow-tipped β-sheet spans.',
            tags: [
              'protein', 'ribbon', 'polypeptide', 'beta-sheet', 'alpha-helix',
              'biology'
            ],
            orbit: {theta: 20, phi: 16, zoom: 1.22},
            variants: [
              {
                label: 'β-Hairpin + α-Helix (Spectrum)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.08 });',
                  'const rib = new THREE.Mesh(',
                  '  new THREE.Science.RibbonGeometry({ colorScheme: "spectrum" }),',
                  '  mat',
                  ');',
                  'scene.add(rib);',
                ]),
              },
              {
                label: 'Secondary-Structure Palette',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.08 });',
                  'const rib = new THREE.Mesh(',
                  '  new THREE.Science.RibbonGeometry({ colorScheme: "secondary" }),',
                  '  mat',
                  ');',
                  'scene.add(rib);',
                ]),
              },
            ],
          },
          {
            slug: 'science-crystal-lattice',
            domain: 'science',
            ctor: 'CrystalLatticeGeometry',
            summary:
                'Bravais & compound lattices (perovskite, diamond, NaCl, HCP, graphene) + vacancies & Miller planes.',
            tags: [
              'crystal', 'lattice', 'perovskite', 'diamond', 'graphene',
              'miller-plane'
            ],
            orbit: {theta: 32, phi: 24, zoom: 1.2},
            variants: [
              {
                label: 'Perovskite + (111) Miller Plane',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.12 });',
                  'const crystal = new THREE.Mesh(',
                  '  new THREE.Science.CrystalLatticeGeometry({',
                  '    lattice: "perovskite", cells: [2, 2, 2], showUnitCell: true,',
                  '    millerPlanes: [{ hkl: [1, 1, 1], color: 0x38bdf8 }]',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(crystal);',
                ]),
              },
              {
                label: 'Diamond Cubic (2×2×2)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.15 });',
                  'const crystal = new THREE.Mesh(',
                  '  new THREE.Science.CrystalLatticeGeometry({ lattice: "diamond", cells: [2, 2, 2], showUnitCell: true }),',
                  '  mat',
                  ');',
                  'scene.add(crystal);',
                ]),
              },
              {
                label: 'Bilayer Graphene Sheet',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.2 });',
                  'const crystal = new THREE.Mesh(',
                  '  new THREE.Science.CrystalLatticeGeometry({ lattice: "graphene", cells: [4, 2, 4] }),',
                  '  mat',
                  ');',
                  'scene.add(crystal);',
                ]),
              },
              {
                label: 'Rock-Salt NaCl Lattice',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.1 });',
                  'const crystal = new THREE.Mesh(',
                  '  new THREE.Science.CrystalLatticeGeometry({ lattice: "nacl", cells: [2, 2, 2], showUnitCell: true }),',
                  '  mat',
                  ');',
                  'scene.add(crystal);',
                ]),
              },
            ],
          },
          {
            slug: 'science-atomic-orbital',
            domain: 'science',
            ctor: 'AtomicOrbitalGeometry',
            summary:
                'Dual-phase (±ψ) hydrogenic 1s, 2p & 3d quantum probability lobes with wavefunction vertex colors.',
            tags: [
              'orbital', 'quantum', '3dz2', '2pz', 'cloverleaf', 'chemistry',
              'physics'
            ],
            orbit: {theta: 28, phi: 22, zoom: 1.22},
            variants: [
              {
                label: '3dz² Lobes + Nodal Torus',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.08 });',
                  'const orb = new THREE.Mesh(',
                  '  new THREE.Science.AtomicOrbitalGeometry({ orbital: "3dz2", scale: 1.0 }),',
                  '  mat',
                  ');',
                  'scene.add(orb);',
                ]),
              },
              {
                label: '3dx²−y² Cloverleaf',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.08 });',
                  'const orb = new THREE.Mesh(',
                  '  new THREE.Science.AtomicOrbitalGeometry({ orbital: "3dx2-y2", scale: 1.0 }),',
                  '  mat',
                  ');',
                  'orb.rotation.x = 0.45;',
                  'scene.add(orb);',
                ]),
              },
              {
                label: '2pz Dumbbell',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.08 });',
                  'const orb = new THREE.Mesh(',
                  '  new THREE.Science.AtomicOrbitalGeometry({ orbital: "2py", scale: 1.0 }),',
                  '  mat',
                  ');',
                  'scene.add(orb);',
                ]),
              },
            ],
          },
          {
            slug: 'science-optical-element',
            domain: 'science',
            ctor: 'OpticalElementGeometry',
            summary:
                'Spherical biconvex, planoconvex, biconcave & meniscus lenses plus equilateral & right-angle prisms.',
            tags: [
              'optics', 'lens', 'prism', 'biconvex', 'meniscus', 'refraction'
            ],
            orbit: {theta: 34, phi: 22, zoom: 1.24},
            variants: [
              {
                label: 'Biconvex Optical Lens',
                code: wrapScene([
                  'const mat = new THREE.MeshPhysicalMaterial({',
                  '  color: 0x7dd3fc, roughness: 0.06, metalness: 0.05, clearcoat: 1.0, clearcoatRoughness: 0.05',
                  '});',
                  'const lens = new THREE.Mesh(',
                  '  new THREE.Science.OpticalElementGeometry({',
                  '    kind: "biconvex", diameter: 1.0, thickness: 0.28, curvatureRadius1: 0.95, curvatureRadius2: 0.95',
                  '  }),',
                  '  mat',
                  ');',
                  'lens.rotation.y = 0.55;',
                  'scene.add(lens);',
                ]),
              },
              {
                label: 'Dispersive Equilateral Prism',
                code: wrapScene([
                  'const mat = new THREE.MeshPhysicalMaterial({',
                  '  color: 0xa5f3fc, roughness: 0.08, metalness: 0.05, clearcoat: 1.0',
                  '});',
                  'const prism = new THREE.Mesh(',
                  '  new THREE.Science.OpticalElementGeometry({ kind: "prism-equilateral", diameter: 0.85, length: 1.0 }),',
                  '  mat',
                  ');',
                  'prism.rotation.y = 0.45;',
                  'scene.add(prism);',
                ]),
              },
            ],
          },
          {
            slug: 'science-surface-plot',
            domain: 'science',
            ctor: 'SurfacePlotGeometry',
            summary:
                'Watertight 3D y = f(x, z) heightfield blocks with custom functions & scientific vertex colormaps.',
            tags: [
              'surface', 'plot', 'heightfield', 'sinc', 'saddle', 'viridis',
              'math'
            ],
            orbit: {theta: 34, phi: 28, zoom: 1.2},
            variants: [
              {
                label: 'Sinc Wave (Viridis)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.06 });',
                  'const plot = new THREE.Mesh(',
                  '  new THREE.Science.SurfacePlotGeometry({',
                  '    preset: "sinc", segmentsX: 48, segmentsZ: 48, heightScale: 0.65, colormap: "viridis"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(plot);',
                ]),
              },
              {
                label: 'Monkey Saddle (Coolwarm)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.06 });',
                  'const plot = new THREE.Mesh(',
                  '  new THREE.Science.SurfacePlotGeometry({',
                  '    preset: "monkey-saddle", segmentsX: 44, segmentsZ: 44, heightScale: 0.55, colormap: "coolwarm"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(plot);',
                ]),
              },
            ],
          },
          {
            slug: 'science-parametric-surface',
            domain: 'science',
            ctor: 'ParametricSurfaceGeometry',
            summary:
                'Closed 2-manifold spherical harmonics, torus knots, figure-8 immersions & superquadrics.',
            tags: [
              'parametric', 'spherical-harmonic', 'torus-knot', 'klein', 'math'
            ],
            orbit: {theta: 30, phi: 24, zoom: 1.22},
            variants: [
              {
                label: 'Spherical Harmonic (Turbo)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.1 });',
                  'const surf = new THREE.Mesh(',
                  '  new THREE.Science.ParametricSurfaceGeometry({',
                  '    kind: "spherical-harmonic", l: 3, m: 2, amplitude: 0.34, colormap: "turbo"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(surf);',
                ]),
              },
              {
                label: '(2, 3) Torus Knot (Plasma)',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.18 });',
                  'const surf = new THREE.Mesh(',
                  '  new THREE.Science.ParametricSurfaceGeometry({',
                  '    kind: "torus-knot", p: 2, q: 3, colormap: "plasma"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(surf);',
                ]),
              },
            ],
          },
          {
            slug: 'science-vector-field',
            domain: 'science',
            ctor: 'VectorFieldGeometry',
            summary:
                '3D arrow glyph lattices visualizing magnetic dipoles, vortices, radial & custom vector fields.',
            tags: [
              'vector-field', 'dipole', 'vortex', 'arrows', 'electromagnetism'
            ],
            orbit: {theta: 28, phi: 22, zoom: 1.18},
            variants: [
              {
                label: 'Magnetic Dipole Glyph Grid',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.3, metalness: 0.25 });',
                  'const vf = new THREE.Mesh(',
                  '  new THREE.Science.VectorFieldGeometry({ preset: "dipole", grid: [5, 5, 5], span: 2.0 }),',
                  '  mat',
                  ');',
                  'scene.add(vf);',
                ]),
              },
              {
                label: 'Swirling Helical Field',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.3, metalness: 0.25 });',
                  'const vf = new THREE.Mesh(',
                  '  new THREE.Science.VectorFieldGeometry({ preset: "helical", grid: [5, 4, 5], span: 2.0 }),',
                  '  mat',
                  ');',
                  'scene.add(vf);',
                ]),
              },
            ],
          },
          {
            slug: 'science-isosurface',
            domain: 'science',
            ctor: 'IsoSurfaceGeometry',
            summary:
                'Watertight Marching Tetrahedra f(x, y, z) = iso scalar-field surfaces (TPMS, orbitals & metaballs).',
            tags: [
              'isosurface', 'marching-tetrahedra', 'gyroid', 'schwarz', 'tpms',
              'metaballs'
            ],
            orbit: {theta: 32, phi: 24, zoom: 1.2},
            variants:
                [
                  {
                    label: 'Gyroid TPMS (Viridis)',
                    code: wrapScene([
                      'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.12 });',
                      'const iso = new THREE.Mesh(',
                      '  new THREE.Science.IsoSurfaceGeometry({ preset: "gyroid", resolution: 28, colormap: "viridis" }),',
                      '  mat',
                      ');',
                      'scene.add(iso);',
                    ]),
                  },
                  {
                    label: 'Schwarz-P Minimal Surface',
                    code:
                        wrapScene(
                            [
                              'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.12 });',
                              'const iso = new THREE.Mesh(',
                              '  new THREE.Science.IsoSurfaceGeometry({ preset: "schwarz-p", resolution: 28, colormap: "plasma" }),',
                              '  mat',
                              ');',
                              'scene.add(iso);',
                            ]),
                  },
                  {
                    label: 'Metaball Cluster',
                    code: wrapScene([
                      'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.15 });',
                      'const iso = new THREE.Mesh(',
                      '  new THREE.Science.IsoSurfaceGeometry({ preset: "metaballs", resolution: 28, colormap: "turbo" }),',
                      '  mat',
                      ');',
                      'scene.add(iso);',
                    ]),
                  },
                ],
          },
          {
            slug: 'science-streamline',
            domain: 'science',
            ctor: 'StreamlineGeometry',
            summary:
                'RK4 integrated 3D vector-field streamline tubes with directional arrow cones & speed colormaps.',
            tags: [
              'streamline', 'rk4', 'dipole', 'lorenz', 'magnetic-field', 'fluid'
            ],
            orbit: {theta: 28, phi: 20, zoom: 1.2},
            variants: [
              {
                label: 'Magnetic Dipole Streamlines',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.12 });',
                  'const lines = new THREE.Mesh(',
                  '  new THREE.Science.StreamlineGeometry({',
                  '    preset: "dipole", tubeRadius: 0.024, arrowsPerLine: 2, colormap: "turbo"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(lines);',
                ]),
              },
              {
                label: 'Lorenz Strange Attractor',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.12 });',
                  'const lines = new THREE.Mesh(',
                  '  new THREE.Science.StreamlineGeometry({',
                  '    preset: "lorenz", steps: 180, tubeRadius: 0.02, arrowsPerLine: 2, colormap: "plasma"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(lines);',
                ]),
              },
            ],
          },
          {
            slug: 'science-axes-3d',
            domain: 'science',
            ctor: 'Axes3DGeometry',
            summary:
                'RGB-colored XYZ coordinate reference frame with origin hub, conical arrowheads & tick rings.',
            tags: ['axes', 'xyz', 'coordinate', 'frame', 'ticks'],
            orbit: {theta: 34, phi: 24, zoom: 1.2},
            variants: [
              {
                label: 'Symmetric ±XYZ Frame + Ticks',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1 });',
                  'const axes = new THREE.Mesh(',
                  '  new THREE.Science.Axes3DGeometry({ length: 1.15, symmetric: true, ticks: 4 }),',
                  '  mat',
                  ');',
                  'scene.add(axes);',
                ]),
              },
              {
                label: 'Positive Octant XYZ',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1 });',
                  'const axes = new THREE.Mesh(',
                  '  new THREE.Science.Axes3DGeometry({ length: 1.25, symmetric: false, ticks: 5 }),',
                  '  mat',
                  ');',
                  'axes.position.set(-0.4, -0.4, -0.4);',
                  'scene.add(axes);',
                ]),
              },
            ],
          },
          {
            slug: 'science-double-helix',
            domain: 'science',
            ctor: 'DoubleHelixGeometry',
            summary:
                'Right-handed Watson-Crick B-DNA double helix with major/minor grooves & A-T / G-C base pairs.',
            tags: ['dna', 'double-helix', 'genetics', 'base-pairs', 'biology'],
            orbit: {theta: 24, phi: 16, zoom: 1.2},
            variants: [
              {
                label: '2.4-Turn B-DNA Double Helix',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.08 });',
                  'const dna = new THREE.Mesh(',
                  '  new THREE.Science.DoubleHelixGeometry({ turns: 2.4, radius: 0.38, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(dna);',
                ]),
              },
            ],
          },
          {
            slug: 'science-dashed-line',
            domain: 'science',
            ctor: 'DashedLineGeometry',
            summary:
                'AR-safe 3D dashed capsule & cylinder segments for hydrogen bonds, coordination & optical rays.',
            tags: ['dashed', 'ray', 'hydrogen-bond', 'callout', 'annotation'],
            orbit: {theta: 26, phi: 22, zoom: 1.22},
            variants: [
              {
                label: '3D Optical Ray-Trace Path',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 });',
                  'const rays = new THREE.Mesh(',
                  '  new THREE.Science.DashedLineGeometry({',
                  '    points: [[-0.9, -0.35, 0.2], [0, 0.42, 0], [0.9, -0.25, -0.25], [0, -0.55, 0.35], [-0.9, -0.35, 0.2]],',
                  '    dashLength: 0.09, gapLength: 0.05, radius: 0.022, capStyle: "capsule", color: 0x38bdf8',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rays);',
                ]),
              },
              {
                label: 'Flat-Cap H-Bond Triad',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 });',
                  'const rays = new THREE.Mesh(',
                  '  new THREE.Science.DashedLineGeometry({',
                  '    segments: [[[0, 0, 0], [0.85, 0.5, 0]], [[0, 0, 0], [-0.75, 0.55, 0.35]], [[0, 0, 0], [0.1, -0.8, -0.35]]],',
                  '    dashLength: 0.075, gapLength: 0.045, radius: 0.024, capStyle: "flat", color: 0xfacc15',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(rays);',
                ]),
              },
            ],
          },
          {
            slug: 'science-angle-arc',
            domain: 'science',
            ctor: 'AngleArcGeometry',
            summary:
                'Watertight 3D bond-angle & optical-incidence arcs with arrowheads & automatic 90° square elbows.',
            tags: [
              'angle', 'arc', 'bond-angle', 'right-angle', 'callout', 'geometry'
            ],
            orbit: {theta: 22, phi: 20, zoom: 1.22},
            variants: [
              {
                label: '104.5° H–O–H Bond Angle Arc',
                code: wrapScene([
                  'const group = new THREE.Group();',
                  'const armMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.3 });',
                  'const arms = new THREE.Mesh(',
                  '  new THREE.Science.DashedLineGeometry({',
                  '    segments: [[[0, 0, 0], [0.95, 0, 0]], [[0, 0, 0], [-0.24, 0.92, 0]]],',
                  '    dashLength: 0.95, gapLength: 0.02, radius: 0.022, capStyle: "capsule"',
                  '  }),',
                  '  armMat',
                  ');',
                  'const arcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.15 });',
                  'const arc = new THREE.Mesh(',
                  '  new THREE.Science.AngleArcGeometry({',
                  '    vertex: [0, 0, 0], armA: [1, 0, 0], armB: [-0.2504, 0.9681, 0],',
                  '    radius: 0.58, tubeRadius: 0.026, arrowEnds: true, color: 0xfacc15',
                  '  }),',
                  '  arcMat',
                  ');',
                  'group.add(arms, arc);',
                  'group.position.set(-0.2, -0.32, 0);',
                  'scene.add(group);',
                ]),
              },
              {
                label: '90° Perpendicular Square Elbow',
                code: wrapScene([
                  'const group = new THREE.Group();',
                  'const armMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.3 });',
                  'const arms = new THREE.Mesh(',
                  '  new THREE.Science.DashedLineGeometry({',
                  '    segments: [[[0, 0, 0], [0.9, 0, 0]], [[0, 0, 0], [0, 0.9, 0]]],',
                  '    dashLength: 0.9, gapLength: 0.02, radius: 0.022',
                  '  }),',
                  '  armMat',
                  ');',
                  'const elbow = new THREE.Mesh(',
                  '  new THREE.Science.AngleArcGeometry({',
                  '    vertex: [0, 0, 0], armA: [1, 0, 0], armB: [0, 1, 0],',
                  '    radius: 0.48, tubeRadius: 0.024, color: 0x38bdf8',
                  '  }),',
                  '  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25 })',
                  ');',
                  'group.add(arms, elbow);',
                  'group.position.set(-0.3, -0.3, 0);',
                  'scene.add(group);',
                ]),
              },
            ],
          },

          // =========================================================================
          // 5. ELECTRONICS & ECAD (9)
          // =========================================================================
          {
            slug: 'electronics-pcb-board',
            domain: 'electronics',
            ctor: 'PcbBoardGeometry',
            summary:
                'Rounded FR4 printed circuit boards with M3 corner mounting holes & custom interior cutouts.',
            tags: ['pcb', 'fr4', 'circuit-board', 'mounting-holes', 'ecad'],
            orbit: {theta: 30, phi: 34, zoom: 1.28},
            variants: [
              {
                label: '85×56 mm SBC Carrier Board',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.38, metalness: 0.12 });',
                  'const pcb = new THREE.Mesh(',
                  '  new THREE.Electronics.PcbBoardGeometry({',
                  '    width: 0.085, length: 0.056, thickness: 0.0024, cornerRadius: 0.004, cornerHoles: true,',
                  '    holes: [{ x: -0.018, z: 0, diameter: 0.008 }, { x: 0.018, z: 0, diameter: 0.008 }]',
                  '  }),',
                  '  mat',
                  ');',
                  'pcb.scale.setScalar(14);',
                  'scene.add(pcb);',
                ]),
              },
              {
                label: 'Circular Sensor Daughterboard',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.36, metalness: 0.16 });',
                  'const pcb = new THREE.Mesh(',
                  '  new THREE.Electronics.PcbBoardGeometry({',
                  '    width: 0.06, length: 0.06, thickness: 0.002, cornerRadius: 0.026, cornerHoles: false,',
                  '    holes: [{ x: 0, z: 0, diameter: 0.012 }, { x: 0, z: 0.02, diameter: 0.0035 }, { x: 0, z: -0.02, diameter: 0.0035 }]',
                  '  }),',
                  '  mat',
                  ');',
                  'pcb.scale.setScalar(18);',
                  'scene.add(pcb);',
                ]),
              },
            ],
          },
          {
            slug: 'electronics-enclosure',
            domain: 'electronics',
            ctor: 'EnclosureGeometry',
            summary:
                'Molded/extruded enclosures (base, lid, closed) with bosses, standoffs, vents, flanges & I/O cutouts.',
            tags:
                ['enclosure', 'case', 'housing', 'chassis', 'vents', 'flanged'],
            orbit: {theta: 32, phi: 28, zoom: 1.25},
            variants: [
              {
                label: 'Vented Base + Bosses & Cutouts',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.42, metalness: 0.25 });',
                  'const box = new THREE.Mesh(',
                  '  new THREE.Electronics.EnclosureGeometry({',
                  '    part: "base", width: 0.11, length: 0.08, height: 0.042,',
                  '    cornerBosses: true, pcbStandoffs: true, ventSlots: 5, flanges: true,',
                  '    panelCutouts: [{ face: "front", x: 0, y: 0.018, width: 0.028, height: 0.012 }],',
                  '    origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'box.scale.setScalar(10);',
                  'scene.add(box);',
                ]),
              },
              {
                label: 'Closed Flanged Wall Box',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.38, metalness: 0.35 });',
                  'const box = new THREE.Mesh(',
                  '  new THREE.Electronics.EnclosureGeometry({',
                  '    part: "closed", flanges: true, ventSlots: 6, scale: 10, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'scene.add(box);',
                ]),
              },
            ],
          },
          {
            slug: 'electronics-heatsink',
            domain: 'electronics',
            ctor: 'HeatsinkGeometry',
            summary:
                'Monolithic extruded aluminum thermal heatsinks with tapered vertical cooling fins.',
            tags: ['heatsink', 'thermal', 'cooling', 'fins', 'aluminum'],
            orbit: {theta: 34, phi: 26, zoom: 1.25},
            variants: [
              {
                label: '13-Fin Anodized Heatsink',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.52, roughness: 0.24 });',
                  'const sink = new THREE.Mesh(',
                  '  new THREE.Electronics.HeatsinkGeometry({',
                  '    width: 0.065, length: 0.065, height: 0.032, finCount: 13, taperRatio: 0.65, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'sink.scale.setScalar(15);',
                  'scene.add(sink);',
                ]),
              },
              {
                label: 'Silver Extruded Heatsink',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.54, roughness: 0.22 });',
                  'const sink = new THREE.Mesh(',
                  '  new THREE.Electronics.HeatsinkGeometry({',
                  '    width: 0.075, length: 0.05, height: 0.024, finCount: 15, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'sink.scale.setScalar(15);',
                  'scene.add(sink);',
                ]),
              },
            ],
          },
          {
            slug: 'electronics-din-rail',
            domain: 'electronics',
            ctor: 'DinRailGeometry',
            summary:
                'IEC 60715 TS35×7.5, TS35×15 & TS15 slotted galvanized steel top-hat DIN mounting rails.',
            tags: ['din-rail', 'ts35', 'plc', 'cabinet', 'industrial-control'],
            orbit: {theta: 34, phi: 26, zoom: 1.28},
            variants: [
              {
                label: 'Slotted TS35×7.5 Rail',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.54, roughness: 0.24 });',
                  'const rail = new THREE.Mesh(',
                  '  new THREE.Electronics.DinRailGeometry({ profile: "ts35x7.5", length: 0.14, slotted: true }),',
                  '  mat',
                  ');',
                  'rail.scale.setScalar(10);',
                  'scene.add(rail);',
                ]),
              },
              {
                label: 'Deep TS35×15 Top-Hat Rail',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.52, roughness: 0.26 });',
                  'const rail = new THREE.Mesh(',
                  '  new THREE.Electronics.DinRailGeometry({ profile: "ts35x15", length: 0.14, slotted: true }),',
                  '  mat',
                  ');',
                  'rail.scale.setScalar(10);',
                  'scene.add(rail);',
                ]),
              },
            ],
          },
          {
            slug: 'electronics-ic-package',
            domain: 'electronics',
            ctor: 'IcPackageGeometry',
            summary:
                'JEDEC gull-wing QFP/SOIC, through-hole DIP, QFN, BGA ball-grid, SOT-23, TO-220 & D2PAK packages.',
            tags: ['ic', 'chip', 'qfp', 'dip', 'soic', 'bga', 'to220', 'jedec'],
            orbit: {theta: 32, phi: 30, zoom: 1.22},
            variants: [
              {
                label: 'LQFP-64 Microcontroller',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.42, metalness: 0.28 });',
                  'const ic = new THREE.Mesh(',
                  '  new THREE.Electronics.IcPackageGeometry({ preset: "LQFP-64", scale: 65, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(ic);',
                ]),
              },
              {
                label: 'DIP-16 Through-Hole IC',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.45, metalness: 0.25 });',
                  'const ic = new THREE.Mesh(',
                  '  new THREE.Electronics.IcPackageGeometry({ preset: "DIP-16", scale: 45, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(ic);',
                ]),
              },
              {
                label: 'TO-220 Power MOSFET',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.38, metalness: 0.45 });',
                  'const ic = new THREE.Mesh(',
                  '  new THREE.Electronics.IcPackageGeometry({ preset: "TO-220", scale: 55, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(ic);',
                ]),
              },
              {
                label: 'BGA-64 Ball-Grid Package',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.4, metalness: 0.3 });',
                  'const ic = new THREE.Mesh(',
                  '  new THREE.Electronics.IcPackageGeometry({ preset: "BGA-64", scale: 80, origin: "center" }),',
                  '  mat',
                  ');',
                  'ic.rotation.x = Math.PI * 0.72;',
                  'scene.add(ic);',
                ]),
              },
              {
                label: 'SOIC-8 Gull-Wing IC',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.32 });',
                  'const ic = new THREE.Mesh(',
                  '  new THREE.Electronics.IcPackageGeometry({ preset: "SOIC-8", scale: 110, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(ic);',
                ]),
              },
              {
                label: 'D2PAK Surface-Mount Power',
                code:
                    wrapScene(
                        [
                          'const mat = new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.35, metalness: 0.55 });',
                          'const ic = new THREE.Mesh(',
                          '  new THREE.Electronics.IcPackageGeometry({ preset: "D2PAK", scale: 55, origin: "center" }),',
                          '  mat',
                          ');',
                          'scene.add(ic);',
                        ]),
              },
            ],
          },
          {
            slug: 'electronics-pin-header',
            domain: 'electronics',
            ctor: 'PinHeaderGeometry',
            summary:
                '2.54 mm & 1.27 mm male breakaway, female socket & keyed shrouded IDC box headers.',
            tags: ['header', 'idc', 'gpio', 'pins', 'jumper', 'shrouded'],
            orbit: {theta: 32, phi: 26, zoom: 1.22},
            variants: [
              {
                label: '2×8 Shrouded IDC Box Header',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.45, metalness: 0.25 });',
                  'const hdr = new THREE.Mesh(',
                  '  new THREE.Electronics.PinHeaderGeometry({ gender: "shrouded", rows: 2, cols: 8, scale: 35 }),',
                  '  mat',
                  ');',
                  'scene.add(hdr);',
                ]),
              },
              {
                label: '1×8 Right-Angle Male GPIO',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.51, roughness: 0.26 });',
                  'const hdr = new THREE.Mesh(',
                  '  new THREE.Electronics.PinHeaderGeometry({ gender: "male", rows: 1, cols: 8, rightAngle: true, scale: 40 }),',
                  '  mat',
                  ');',
                  'scene.add(hdr);',
                ]),
              },
            ],
          },
          {
            slug: 'electronics-connector',
            domain: 'electronics',
            ctor: 'ConnectorGeometry',
            summary:
                '9 board-mount I/O ports: USB-C, USB-A, RJ45, HDMI, barrel jack, SMA coax, terminal block, microSD & JST.',
            tags: [
              'connector', 'usb-c', 'rj45', 'hdmi', 'sma', 'terminal-block',
              'port'
            ],
            orbit: {theta: 28, phi: 24, zoom: 1.22},
            variants: [
              {
                label: 'USB-C Receptacle',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.22 });',
                  'const conn = new THREE.Mesh(',
                  '  new THREE.Electronics.ConnectorGeometry({ kind: "usb-c", scale: 80, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(conn);',
                ]),
              },
              {
                label: 'RJ45 Ethernet Jack',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.5, roughness: 0.28 });',
                  'const conn = new THREE.Mesh(',
                  '  new THREE.Electronics.ConnectorGeometry({ kind: "rj45", scale: 45, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(conn);',
                ]),
              },
              {
                label: '4-Pole Screw Terminal Block',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.42, metalness: 0.15 });',
                  'const conn = new THREE.Mesh(',
                  '  new THREE.Electronics.ConnectorGeometry({ kind: "terminal-block", poles: 4, scale: 42, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(conn);',
                ]),
              },
              {
                label: 'SMA RF Coax Bulkhead',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.53, roughness: 0.2 });',
                  'const conn = new THREE.Mesh(',
                  '  new THREE.Electronics.ConnectorGeometry({ kind: "sma", scale: 65, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(conn);',
                ]),
              },
              {
                label: 'HDMI Type-A Receptacle',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.22 });',
                  'const conn = new THREE.Mesh(',
                  '  new THREE.Electronics.ConnectorGeometry({ kind: "hdmi", scale: 55, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(conn);',
                ]),
              },
              {
                label: 'DC Barrel Power Jack',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.42, metalness: 0.28 });',
                  'const conn = new THREE.Mesh(',
                  '  new THREE.Electronics.ConnectorGeometry({ kind: "barrel-jack", scale: 55, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(conn);',
                ]),
              },
            ],
          },
          {
            slug: 'electronics-standoff-spacer',
            domain: 'electronics',
            ctor: 'StandoffSpacerGeometry',
            summary:
                'Hex & cylindrical M2–M5 brass/nylon threaded PCB standoffs with female bore & male stud.',
            tags: ['standoff', 'spacer', 'brass', 'hex', 'm3', 'pcb'],
            orbit: {theta: 30, phi: 24, zoom: 1.28},
            variants: [
              {
                label: 'M3 Brass Male-Female Hex',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.53, roughness: 0.22 });',
                  'const spacer = new THREE.Mesh(',
                  '  new THREE.Electronics.StandoffSpacerGeometry({',
                  '    shape: "hex", thread: "M3", length: 0.012, maleStudLength: 0.005, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'spacer.scale.setScalar(65);',
                  'spacer.rotation.z = -0.35;',
                  'scene.add(spacer);',
                ]),
              },
              {
                label: 'M4 Cylindrical Spacer',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.53, roughness: 0.24 });',
                  'const spacer = new THREE.Mesh(',
                  '  new THREE.Electronics.StandoffSpacerGeometry({',
                  '    shape: "round", thread: "M4", length: 0.015, origin: "center"',
                  '  }),',
                  '  mat',
                  ');',
                  'spacer.scale.setScalar(55);',
                  'spacer.rotation.z = -0.35;',
                  'scene.add(spacer);',
                ]),
              },
            ],
          },
          {
            slug: 'electronics-discrete-component',
            domain: 'electronics',
            ctor: 'DiscreteComponentGeometry',
            summary:
                'Tactile push switches, radial electrolytic capacitors, domed 5mm LEDs, HC-49 crystals & SMD chips.',
            tags: [
              'capacitor', 'led', 'switch', 'crystal', 'smd', '0805', 'passive'
            ],
            orbit: {theta: 30, phi: 24, zoom: 1.22},
            variants: [
              {
                label: '6×6 mm Tactile Push Switch',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4, metalness: 0.35 });',
                  'const part = new THREE.Mesh(',
                  '  new THREE.Electronics.DiscreteComponentGeometry({ kind: "tactile-switch", scale: 95, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(part);',
                ]),
              },
              {
                label: 'Radial Electrolytic Capacitor',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.32, metalness: 0.45 });',
                  'const part = new THREE.Mesh(',
                  '  new THREE.Electronics.DiscreteComponentGeometry({ kind: "electrolytic-cap", scale: 55, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(part);',
                ]),
              },
              {
                label: '5 mm Domed Indicator LED',
                code: wrapScene([
                  'const mat = new THREE.MeshPhysicalMaterial({ color: 0xf87171, roughness: 0.12, metalness: 0.05, clearcoat: 1.0 });',
                  'const part = new THREE.Mesh(',
                  '  new THREE.Electronics.DiscreteComponentGeometry({ kind: "led-domed", scale: 65, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(part);',
                ]),
              },
              {
                label: 'HC-49U Quartz Crystal',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.54, roughness: 0.18 });',
                  'const part = new THREE.Mesh(',
                  '  new THREE.Electronics.DiscreteComponentGeometry({ kind: "crystal-hc49", scale: 55, origin: "center" }),',
                  '  mat',
                  ');',
                  'scene.add(part);',
                ]),
              },
              {
                label: '0805 SMD Chip Passive',
                code: wrapScene([
                  'const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.47, roughness: 0.3 });',
                  'const part = new THREE.Mesh(',
                  '  new THREE.Electronics.DiscreteComponentGeometry({ kind: "smd-chip", package: "0805", scale: 180, origin: "center" }),',
                  '  mat',
                  ');',
                  'part.scale.setScalar(2.2);',
                  'scene.add(part);',
                ]),
              },
            ],
          },
        ];

function thumbFile(slug, variantIdx) {
  return (!variantIdx || variantIdx === 0 ? slug : slug + '-v' + variantIdx) +
      '.webp';
}

return {
  DOMAINS,
  ITEMS,
  thumbFile,
};
});
