<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Domain Kits Visual Catalog

Browse all **57 watertight 2-manifold parametric geometry constructors** across
the **5 `three-live` Domain Kits**.

> **Interactive 3D Inspector:** Open the
> [**Live Domain Kits Catalog (`examples/kits/`)**](https://google.github.io/three-live/kits/)
> to search across all kits, orbit/zoom every primitive at 60 fps in
> `<three-live>` Studio PBR, switch multi-style variants, copy
> `<script type="text/three">` snippets, and export `.glb` / `.usdz` assets.

## Quick Jump

Domain Kit                                                  | Namespace            | Bundle                               | Gzip Budget  | Primitives
:---------------------------------------------------------- | :------------------- | :----------------------------------- | :----------: | :--------:
[**Mechanical CAD**](#mechanical-cad)                       | `THREE.Mechanical`   | `three-live-kit-mechanical.min.js`   | `< 18 KB gz` | **15**
[**Architecture & AEC**](#architecture-aec)                 | `THREE.Architecture` | `three-live-kit-architecture.min.js` | `< 16 KB gz` | **9**
[**Industrial & Process Plant**](#industrial-process-plant) | `THREE.Industrial`   | `three-live-kit-industrial.min.js`   | `< 14 KB gz` | **10**
[**Science, Biology & Math**](#science-biology-math)        | `THREE.Science`      | `three-live-kit-science.min.js`      | `< 31 KB gz` | **14**
[**Electronics & ECAD**](#electronics-ecad)                 | `THREE.Electronics`  | `three-live-kit-electronics.min.js`  | `< 14 KB gz` | **9**

> Load all 5 domain kits together via `three-live-kits.min.js` (`< 82 KB gz`),
> or load individual `three-live-kit-<domain>.min.js` bundles a la carte.

--------------------------------------------------------------------------------

## Mechanical CAD

**Namespace:** `THREE.Mechanical` · **Bundle:**
`three-live-kit-mechanical.min.js` (`< 18 KB gz`) · **Constructors:** 15

15 watertight 2-manifold machine elements: involute spur, bevel & internal ring
gears, racks, belt/timing pulleys, ISO metric bolts/nuts/washers, stepped
shafts, couplers, ball & pillow-block bearings, helical springs, weld-neck
flanges, and structural extrusions.

**Domain Helpers:**

-   `THREE.Mechanical.metricFastener('M8x25', scale?)` — ISO 4014 / 4762 / 4032
    thread, pitch, head, nut & washer lookup
-   `THREE.Mechanical.gearMeshDistance(gearA, gearB)` — Exact external &
    planetary internal center distance, ratio & phase offset

| Part 1                                                                                                                                               | Part 2                                                                                                                                         | Part 3                                                                                                                                                         |
| :--------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="../examples/kits/thumbs/mechanical-spur-gear.webp" alt="Mechanical.SpurGearGeometry" width="260"><br>**`SpurGearGeometry`** *(2            | <img src="../examples/kits/thumbs/mechanical-bevel-gear.webp" alt="Mechanical.BevelGearGeometry" width="260"><br>**`BevelGearGeometry`** *(2   | <img src="../examples/kits/thumbs/mechanical-internal-ring-gear.webp" alt="Mechanical.InternalRingGearGeometry" width="260"><br>**`InternalRingGearGeometry`** |
: variants)*<br><sub>Involute straight & helical spur gears with bore, keyway, hub & lightening holes.</sub>                                           : variants)*<br><sub>Conical intersecting-axis miter & bevel gears with rear hub collar.</sub>                                                   : *(2 variants)*<br><sub>Annular internal-tooth planetary ring gear with outer mounting bolt circle.</sub>                                                       :
| <img src="../examples/kits/thumbs/mechanical-rack.webp" alt="Mechanical.RackGeometry" width="260"><br>**`RackGeometry`** *(2                         | <img src="../examples/kits/thumbs/mechanical-pulley.webp" alt="Mechanical.PulleyGeometry" width="260"><br>**`PulleyGeometry`** *(3             | <img src="../examples/kits/thumbs/mechanical-bolt.webp" alt="Mechanical.BoltGeometry" width="260"><br>**`BoltGeometry`** *(3 variants)*<br><sub>ISO metric     |
: variants)*<br><sub>Linear involute gear rack bar for rack-and-pinion linear actuators.</sub>                                                         : variants)*<br><sub>Toothed timing, multi-groove V-belt & crowned flat-belt pulleys with flanges.</sub>                                         : hex, socket-cap, countersunk & button-head bolts with helical/annular threads.</sub>                                                                           :
| <img src="../examples/kits/thumbs/mechanical-nut.webp" alt="Mechanical.NutGeometry" width="260"><br>**`NutGeometry`** *(3 variants)*<br><sub>ISO     | <img src="../examples/kits/thumbs/mechanical-washer.webp" alt="Mechanical.WasherGeometry" width="260"><br>**`WasherGeometry`** *(2             | <img src="../examples/kits/thumbs/mechanical-shaft.webp" alt="Mechanical.ShaftGeometry" width="260"><br>**`ShaftGeometry`** *(2                                |
: metric chamfered hex, flanged & nylon-insert lock nuts with internal bore threads.</sub>                                                             : variants)*<br><sub>Chamfered ISO 7089 flat & wide fender load-distributing washers.</sub>                                                      : variants)*<br><sub>Multi-stepped CNC turned drive shafts with end chamfers, D-cut flats & axial bores.</sub>                                                   :
| <img src="../examples/kits/thumbs/mechanical-shaft-coupler.webp" alt="Mechanical.ShaftCouplerGeometry" width="260"><br>**`ShaftCouplerGeometry`**    | <img src="../examples/kits/thumbs/mechanical-bearing.webp" alt="Mechanical.BearingGeometry" width="260"><br>**`BearingGeometry`** *(2          | <img src="../examples/kits/thumbs/mechanical-pillow-block.webp" alt="Mechanical.PillowBlockGeometry" width="260"><br>**`PillowBlockGeometry`**<br><sub>UCP     |
: *(2 variants)*<br><sub>Interlocking jaw-spider & split rigid clamp motor-to-leadscrew shaft couplings.</sub>                                         : variants)*<br><sub>Deep-groove radial ball bearings with inner/outer races, steel balls, shields & flanges.</sub>                              : cast-iron pedestal pillow-block mounted bearing with slotted bolt feet.</sub>                                                                                  :
| <img src="../examples/kits/thumbs/mechanical-helical-spring.webp" alt="Mechanical.HelicalSpringGeometry" width="260"><br>**`HelicalSpringGeometry`** | <img src="../examples/kits/thumbs/mechanical-flange-plate.webp" alt="Mechanical.FlangePlateGeometry" width="260"><br>**`FlangePlateGeometry`** | <img src="../examples/kits/thumbs/mechanical-profile-extrusion.webp" alt="Mechanical.ProfileExtrusionGeometry" width="260"><br>**`ProfileExtrusionGeometry`**  |
: *(2 variants)*<br><sub>Twist-free Bishop-frame compression coil spring with optional flat ground ends.</sub>                                         : *(2 variants)*<br><sub>Circular weld-neck & slip-on mounting flange with center bore & bolt-circle holes.</sub>                                : *(3 variants)*<br><sub>7 structural profiles\: T-slot framing, I-beam, C-channel, L-angle, rectangular/round tubes & hex bar.</sub>                            :

--------------------------------------------------------------------------------

## Architecture & AEC

**Namespace:** `THREE.Architecture` · **Bundle:**
`three-live-kit-architecture.min.js` (`< 16 KB gz`) · **Constructors:** 9

9 watertight 2-manifold building, BIM & interior elements: walls with
Roman/segmental/Gothic openings & moldings, floor slabs with stairwell/skylight
cutouts, IBC stairs, 6 roof styles, 10-style doors across 5 operations, 10-style
windows, guardrails, classical columns, and masonry archways.

**Domain Helpers:**

-   `THREE.Architecture.codeStairSpec(totalRise, opts?)` — IBC 7-11 compliant
    riser count, riser height, tread depth & slope calculator

| Part 1                                                                                                                                | Part 2                                                                                                                                          | Part 3                                                                                                                                      |
| :------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| <img src="../examples/kits/thumbs/architecture-wall.webp" alt="Architecture.WallGeometry" width="260"><br>**`WallGeometry`** *(2      | <img src="../examples/kits/thumbs/architecture-slab.webp" alt="Architecture.SlabGeometry" width="260"><br>**`SlabGeometry`**<br><sub>Horizontal | <img src="../examples/kits/thumbs/architecture-staircase.webp" alt="Architecture.StaircaseGeometry" width="260"><br>**`StaircaseGeometry`** |
: variants)*<br><sub>Walls with rectangular, Roman, segmental & pointed Gothic openings, segmented baseboards & cornices.</sub>         : floor, ceiling & mezzanine slabs with rectangular stairwell & circular skylight cutouts.</sub>                                                  : *(4 variants)*<br><sub>IBC 7-11 compliant straight, L-landing, U-switchback & spiral stairs with solid or open stringers.</sub>             :
| <img src="../examples/kits/thumbs/architecture-roof.webp" alt="Architecture.RoofGeometry" width="260"><br>**`RoofGeometry`** *(4      | <img src="../examples/kits/thumbs/architecture-door.webp" alt="Architecture.DoorGeometry" width="260"><br>**`DoorGeometry`** *(4                | <img src="../examples/kits/thumbs/architecture-window.webp" alt="Architecture.WindowGeometry" width="260"><br>**`WindowGeometry`** *(3      |
: variants)*<br><sub>6 architectural roof silhouettes\: gable, hip, mansard, gambrel, shed & commercial flat-parapet.</sub>             : variants)*<br><sub>10 leaf styles × 5 operations (swing, patio slider, barn, pocket & bifold) with hardware.</sub>                              : variants)*<br><sub>10 window styles\: arched fanlight, double-hung, casement, slider, awning, hopper & mullion grids.</sub>                 :
| <img src="../examples/kits/thumbs/architecture-railing.webp" alt="Architecture.RailingGeometry" width="260"><br>**`RailingGeometry`** | <img src="../examples/kits/thumbs/architecture-column.webp" alt="Architecture.ColumnGeometry" width="260"><br>**`ColumnGeometry`** *(4          | <img src="../examples/kits/thumbs/architecture-archway.webp" alt="Architecture.ArchwayGeometry" width="260"><br>**`ArchwayGeometry`** *(2   |
: *(2 variants)*<br><sub>IBC code-spaced vertical baluster, horizontal-bar & modern infill-panel guardrails.</sub>                      : variants)*<br><sub>Classical fluted, Doric, Tuscan, square-pilaster & structural steel H-columns with entasis.</sub>                            : variants)*<br><sub>Masonry Roman semicircular, segmental & pointed Gothic portals with keystone & imposts.</sub>                            :

--------------------------------------------------------------------------------

## Industrial & Process Plant

**Namespace:** `THREE.Industrial` · **Bundle:**
`three-live-kit-industrial.min.js` (`< 14 KB gz`) · **Constructors:** 10

10 watertight 2-manifold process piping, factory & warehouse digital-twin
assets: 3D Bishop-frame flanged pipe runs, fittings, manual & pneumatic valves,
ANSI centrifugal pump skids, selective pallet racks, conveyors, OSHA catwalks,
caged ladders, safety barriers, and vessels.

**Domain Helpers:**

-   `THREE.Industrial.nominalPipeSpec('DN100' | '4in')` — ASME B36.10M / B16.5
    Class 150 pipe OD, wall & bolt-circle flange dimensions

| Part 1                                                                                                                                                                      | Part 2                                                                                                                                                         | Part 3                                                                                                                                               |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="../examples/kits/thumbs/industrial-pipe-run.webp" alt="Industrial.PipeRunGeometry" width="260"><br>**`PipeRunGeometry`** *(2 variants)*<br><sub>3D multi-waypoint | <img src="../examples/kits/thumbs/industrial-pipe-fitting.webp" alt="Industrial.PipeFittingGeometry" width="260"><br>**`PipeFittingGeometry`** *(3             | <img src="../examples/kits/thumbs/industrial-valve.webp" alt="Industrial.ValveGeometry" width="260"><br>**`ValveGeometry`** *(3                      |
: process pipe routing with smooth bent elbows & ASME weld-neck flanges.</sub>                                                                                                : variants)*<br><sub>ASME flanged 90°/45° elbows, tees, 4-way crosses, concentric/eccentric reducers & end caps.</sub>                                           : variants)*<br><sub>Handwheel gate, quarter-turn ball, wafer butterfly, pneumatic diaphragm control & check valves.</sub>                             :
| <img src="../examples/kits/thumbs/industrial-centrifugal-pump.webp" alt="Industrial.CentrifugalPumpGeometry" width="260"><br>**`CentrifugalPumpGeometry`**<br><sub>ANSI     | <img src="../examples/kits/thumbs/industrial-pallet-rack.webp" alt="Industrial.PalletRackGeometry" width="260"><br>**`PalletRackGeometry`**<br><sub>Multi-bay, | <img src="../examples/kits/thumbs/industrial-conveyor.webp" alt="Industrial.ConveyorGeometry" width="260"><br>**`ConveyorGeometry`** *(2             |
: end-suction volute pump + OSHA coupling guard + finned TEFC motor on structural skid.</sub>                                                                                 : multi-level selective warehouse pallet racking with uprights, beams & deck bars.</sub>                                                                         : variants)*<br><sub>Horizontal & inclined live-roller or belt conveyors with side guides & adjustable support legs.</sub>                             :
| <img src="../examples/kits/thumbs/industrial-catwalk-platform.webp" alt="Industrial.CatwalkPlatformGeometry" width="260"><br>**`CatwalkPlatformGeometry`**<br><sub>Elevated | <img src="../examples/kits/thumbs/industrial-ladder.webp" alt="Industrial.IndustrialLadderGeometry" width="260"><br>**`IndustrialLadderGeometry`** *(2         | <img src="../examples/kits/thumbs/industrial-safety-barrier.webp" alt="Industrial.SafetyBarrierGeometry" width="260"><br>**`SafetyBarrierGeometry`** |
: OSHA steel grating walkway & mezzanine platform with toeboards & guardrails.</sub>                                                                                          : variants)*<br><sub>OSHA fixed vertical access ladder with wall mounting standoffs & hoop safety cage.</sub>                                                    : *(2 variants)*<br><sub>Forklift crash guardrails, tubular safety handrails & heavy baseplate bollards.</sub>                                         :
| <img src="../examples/kits/thumbs/industrial-storage-tank.webp" alt="Industrial.StorageTankGeometry" width="260"><br>**`StorageTankGeometry`** *(3                          |                                                                                                                                                                |                                                                                                                                                      |
: variants)*<br><sub>Vertical dished-head leg vessels, horizontal saddle tanks, cone-hopper silos & API 650 tanks.</sub>                                                      :                                                                                                                                                                :                                                                                                                                                      :

--------------------------------------------------------------------------------

## Science, Biology & Math

**Namespace:** `THREE.Science` · **Bundle:** `three-live-kit-science.min.js`
(`< 31 KB gz`) · **Constructors:** 14

14 watertight 2-manifold chemistry, structural biology, crystallography, optics
& field-visualization primitives with end-to-end COLOR_0 & USDZ displayColor
scientific colormaps (viridis, plasma, turbo, coolwarm, inferno).

**Domain Helpers:**

-   `THREE.Science.elementSpec('Fe')` — 44-element IUPAC covalent/van-der-Waals
    radii & CPK color lookup
-   `THREE.Science.sampleColormap('viridis', t)` — Perceptually uniform RGB
    evaluation + colormapTexture & applyVertexColormap
-   `THREE.Science.ribbonColorMap(opts)` — 1D DataTexture ramp for N→C rainbow
    or secondary-structure polypeptide ribbons

| Part 1                                                                                                                                                     | Part 2                                                                                                                                            | Part 3                                                                                                                                                        |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <img src="../examples/kits/thumbs/science-molecule.webp" alt="Science.MoleculeGeometry" width="260"><br>**`MoleculeGeometry`** *(3                         | <img src="../examples/kits/thumbs/science-ribbon.webp" alt="Science.RibbonGeometry" width="260"><br>**`RibbonGeometry`** *(2                      | <img src="../examples/kits/thumbs/science-crystal-lattice.webp" alt="Science.CrystalLatticeGeometry" width="260"><br>**`CrystalLatticeGeometry`** *(3         |
: variants)*<br><sub>Ball-and-stick & space-filling CPK vertex-colored molecules across 44 IUPAC elements & presets.</sub>                                   : variants)*<br><sub>Continuous polypeptide/biopolymer cartoon lofts across coil, α-helix & arrow-tipped β-sheet spans.</sub>                       : variants)*<br><sub>Bravais & compound lattices (perovskite, diamond, NaCl, HCP, graphene) + vacancies & Miller planes.</sub>                                  :
| <img src="../examples/kits/thumbs/science-atomic-orbital.webp" alt="Science.AtomicOrbitalGeometry" width="260"><br>**`AtomicOrbitalGeometry`** *(3         | <img src="../examples/kits/thumbs/science-optical-element.webp" alt="Science.OpticalElementGeometry" width="260"><br>**`OpticalElementGeometry`** | <img src="../examples/kits/thumbs/science-surface-plot.webp" alt="Science.SurfacePlotGeometry" width="260"><br>**`SurfacePlotGeometry`** *(2                  |
: variants)*<br><sub>Dual-phase (±ψ) hydrogenic 1s, 2p & 3d quantum probability lobes with wavefunction vertex colors.</sub>                                 : *(2 variants)*<br><sub>Spherical biconvex, planoconvex, biconcave & meniscus lenses plus equilateral & right-angle prisms.</sub>                  : variants)*<br><sub>Watertight 3D y = f(x, z) heightfield blocks with custom functions & scientific vertex colormaps.</sub>                                    :
| <img src="../examples/kits/thumbs/science-parametric-surface.webp" alt="Science.ParametricSurfaceGeometry" width="260"><br>**`ParametricSurfaceGeometry`** | <img src="../examples/kits/thumbs/science-vector-field.webp" alt="Science.VectorFieldGeometry" width="260"><br>**`VectorFieldGeometry`** *(2      | <img src="../examples/kits/thumbs/science-isosurface.webp" alt="Science.IsoSurfaceGeometry" width="260"><br>**`IsoSurfaceGeometry`** *(3                      |
: *(2 variants)*<br><sub>Closed 2-manifold spherical harmonics, torus knots, figure-8 immersions & superquadrics.</sub>                                      : variants)*<br><sub>3D arrow glyph lattices visualizing magnetic dipoles, vortices, radial & custom vector fields.</sub>                           : variants)*<br><sub>Watertight Marching Tetrahedra f(x, y, z) = iso scalar-field surfaces (TPMS, orbitals & metaballs).</sub>                                  :
| <img src="../examples/kits/thumbs/science-streamline.webp" alt="Science.StreamlineGeometry" width="260"><br>**`StreamlineGeometry`** *(2                   | <img src="../examples/kits/thumbs/science-axes-3d.webp" alt="Science.Axes3DGeometry" width="260"><br>**`Axes3DGeometry`** *(2                     | <img src="../examples/kits/thumbs/science-double-helix.webp" alt="Science.DoubleHelixGeometry" width="260"><br>**`DoubleHelixGeometry`**<br><sub>Right-handed |
: variants)*<br><sub>RK4 integrated 3D vector-field streamline tubes with directional arrow cones & speed colormaps.</sub>                                   : variants)*<br><sub>RGB-colored XYZ coordinate reference frame with origin hub, conical arrowheads & tick rings.</sub>                             : Watson-Crick B-DNA double helix with major/minor grooves & A-T / G-C base pairs.</sub>                                                                        :
| <img src="../examples/kits/thumbs/science-dashed-line.webp" alt="Science.DashedLineGeometry" width="260"><br>**`DashedLineGeometry`** *(2                  | <img src="../examples/kits/thumbs/science-angle-arc.webp" alt="Science.AngleArcGeometry" width="260"><br>**`AngleArcGeometry`** *(2               |                                                                                                                                                               |
: variants)*<br><sub>AR-safe 3D dashed capsule & cylinder segments for hydrogen bonds, coordination & optical rays.</sub>                                    : variants)*<br><sub>Watertight 3D bond-angle & optical-incidence arcs with arrowheads & automatic 90° square elbows.</sub>                         :                                                                                                                                                               :

--------------------------------------------------------------------------------

## Electronics & ECAD

**Namespace:** `THREE.Electronics` · **Bundle:**
`three-live-kit-electronics.min.js` (`< 14 KB gz`) · **Constructors:** 9

9 watertight 2-manifold PCB & hardware enclosure primitives: rounded FR4 boards
with mounting holes, flanged/vented enclosures with I/O cutouts, tapered-fin
heatsinks, IEC DIN rails, JEDEC IC packages, pin headers, USB-C/RJ45/HDMI/SMA
connectors, standoffs, and discrete passives.

**Domain Helpers:**

-   `THREE.Electronics.jedecPackageSpec('LQFP-64', scale?)` — JEDEC / IPC body,
    pitch & lead-span table for DIP, SOIC, QFP, QFN, BGA, TO-220 & D2PAK

| Part 1                                                                                                                                    | Part 2                                                                                                                                                    | Part 3                                                                                                                                                             |
| :---------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="../examples/kits/thumbs/electronics-pcb-board.webp" alt="Electronics.PcbBoardGeometry" width="260"><br>**`PcbBoardGeometry`**   | <img src="../examples/kits/thumbs/electronics-enclosure.webp" alt="Electronics.EnclosureGeometry" width="260"><br>**`EnclosureGeometry`** *(2             | <img src="../examples/kits/thumbs/electronics-heatsink.webp" alt="Electronics.HeatsinkGeometry" width="260"><br>**`HeatsinkGeometry`** *(2                         |
: *(2 variants)*<br><sub>Rounded FR4 printed circuit boards with M3 corner mounting holes & custom interior cutouts.</sub>                  : variants)*<br><sub>Molded/extruded enclosures (base, lid, closed) with bosses, standoffs, vents, flanges & I/O cutouts.</sub>                             : variants)*<br><sub>Monolithic extruded aluminum thermal heatsinks with tapered vertical cooling fins.</sub>                                                        :
| <img src="../examples/kits/thumbs/electronics-din-rail.webp" alt="Electronics.DinRailGeometry" width="260"><br>**`DinRailGeometry`** *(2  | <img src="../examples/kits/thumbs/electronics-ic-package.webp" alt="Electronics.IcPackageGeometry" width="260"><br>**`IcPackageGeometry`** *(4            | <img src="../examples/kits/thumbs/electronics-pin-header.webp" alt="Electronics.PinHeaderGeometry" width="260"><br>**`PinHeaderGeometry`** *(2                     |
: variants)*<br><sub>IEC 60715 TS35×7.5, TS35×15 & TS15 slotted galvanized steel top-hat DIN mounting rails.</sub>                          : variants)*<br><sub>JEDEC gull-wing QFP/SOIC, through-hole DIP, QFN, BGA ball-grid, SOT-23, TO-220 & D2PAK packages.</sub>                                 : variants)*<br><sub>2.54 mm & 1.27 mm male breakaway, female socket & keyed shrouded IDC box headers.</sub>                                                         :
| <img src="../examples/kits/thumbs/electronics-connector.webp" alt="Electronics.ConnectorGeometry" width="260"><br>**`ConnectorGeometry`** | <img src="../examples/kits/thumbs/electronics-standoff-spacer.webp" alt="Electronics.StandoffSpacerGeometry" width="260"><br>**`StandoffSpacerGeometry`** | <img src="../examples/kits/thumbs/electronics-discrete-component.webp" alt="Electronics.DiscreteComponentGeometry" width="260"><br>**`DiscreteComponentGeometry`** |
: *(4 variants)*<br><sub>9 board-mount I/O ports\: USB-C, USB-A, RJ45, HDMI, barrel jack, SMA coax, terminal block, microSD & JST.</sub>    : *(2 variants)*<br><sub>Hex & cylindrical M2–M5 brass/nylon threaded PCB standoffs with female bore & male stud.</sub>                                     : *(4 variants)*<br><sub>Tactile push switches, radial electrolytic capacitors, domed 5mm LEDs, HC-49 crystals & SMD chips.</sub>                                    :
