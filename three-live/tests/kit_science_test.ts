// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  installScienceKit,
  MAX_SCI_ATOMS,
  MAX_SCI_BASE_PAIRS,
  MAX_SCI_GLYPHS,
  MAX_SCI_GRID,
  MAX_SCI_ISOSURFACE_RES,
  MAX_SCI_RIBBON_POINTS,
  MAX_SCI_STREAMLINE_STEPS,
  scienceKitPlugin,
} from '../src/kit-science';
import {getSharedRegistry} from '../src/plugin';
import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  THREE,
  Vector3,
} from '../src/three-author';
import {parseGLB} from '../src/three-view';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail = ''): void {
  if (cond) {
    console.log(`   ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

interface MeshAuditStats {
  vertexCount: number;
  triangleCount: number;
  signedVolume: number;
  unmatchedHalfEdges: number;
  duplicateHalfEdges: number;
  flippedNormalTris: number;
}

function auditGeometry(
  geom: any,
  label: string,
  opts: {expectWatertight?: boolean; minVolume?: number} = {},
): MeshAuditStats {
  const posAttr = geom?.getAttribute?.('position');
  const nrmAttr = geom?.getAttribute?.('normal');
  const uvAttr = geom?.getAttribute?.('uv');
  const idxAttr = geom?.index;

  if (!posAttr || !nrmAttr || !uvAttr || !idxAttr) {
    assert(false, `${label}: missing position/normal/uv/index attribute`);
    return {
      vertexCount: 0,
      triangleCount: 0,
      signedVolume: 0,
      unmatchedHalfEdges: -1,
      duplicateHalfEdges: -1,
      flippedNormalTris: -1,
    };
  }

  const pos = posAttr.array as Float32Array;
  const nrm = nrmAttr.array as Float32Array;
  const uv = uvAttr.array as Float32Array;
  const idx = idxAttr.array as Uint16Array | Uint32Array;

  const vCount = pos.length / 3;
  const triCount = idx.length / 3;

  let allFinite = vCount > 0 && triCount > 0 && idx.length % 3 === 0;
  for (let i = 0; i < pos.length && allFinite; i++) {
    if (!Number.isFinite(pos[i])) allFinite = false;
  }
  for (let i = 0; i < uv.length && allFinite; i++) {
    if (!Number.isFinite(uv[i])) allFinite = false;
  }

  let badNormals = 0;
  for (let i = 0; i < vCount; i++) {
    const nx = nrm[i * 3];
    const ny = nrm[i * 3 + 1];
    const nz = nrm[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(len) || Math.abs(len - 1) > 2e-2) {
      badNormals++;
    }
  }

  let outOfBoundsIdx = 0;
  let zeroAreaTris = 0;
  let flippedNormalTris = 0;
  let signedVol6 = 0;

  const keyOf = (vi: number): string => {
    const q = 1e5;
    const x = Math.round(pos[vi * 3] * q);
    const y = Math.round(pos[vi * 3 + 1] * q);
    const z = Math.round(pos[vi * 3 + 2] * q);
    return `${x},${y},${z}`;
  };
  const halfEdges = new Map<string, number>();

  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (a >= vCount || b >= vCount || c >= vCount) {
      outOfBoundsIdx++;
      continue;
    }
    const ax = pos[a * 3],
      ay = pos[a * 3 + 1],
      az = pos[a * 3 + 2];
    const bx = pos[b * 3],
      by = pos[b * 3 + 1],
      bz = pos[b * 3 + 2];
    const cx = pos[c * 3],
      cy = pos[c * 3 + 1],
      cz = pos[c * 3 + 2];

    const abx = bx - ax,
      aby = by - ay,
      abz = bz - az;
    const acx = cx - ax,
      acy = cy - ay,
      acz = cz - az;
    const fnx = aby * acz - abz * acy;
    const fny = abz * acx - abx * acz;
    const fnz = abx * acy - aby * acx;
    const area2 = Math.hypot(fnx, fny, fnz);
    if (area2 <= 1e-13) {
      zeroAreaTris++;
      continue;
    }
    signedVol6 +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);

    const vnx = (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) / 3;
    const vny = (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) / 3;
    const vnz = (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]) / 3;
    const dot = (fnx * vnx + fny * vny + fnz * vnz) / area2;
    if (dot < 0.05) {
      flippedNormalTris++;
    }

    if (opts.expectWatertight) {
      const ka = keyOf(a);
      const kb = keyOf(b);
      const kc = keyOf(c);
      if (ka !== kb && kb !== kc && kc !== ka) {
        for (const [u, v] of [
          [ka, kb],
          [kb, kc],
          [kc, ka],
        ]) {
          const hk = `${u}->${v}`;
          halfEdges.set(hk, (halfEdges.get(hk) ?? 0) + 1);
        }
      }
    }
  }

  let unmatchedHalfEdges = 0;
  let duplicateHalfEdges = 0;
  if (opts.expectWatertight) {
    for (const [hk, count] of halfEdges.entries()) {
      if (count > 1) duplicateHalfEdges += count - 1;
      const [u, v] = hk.split('->');
      const rev = halfEdges.get(`${v}->${u}`) ?? 0;
      if (rev !== count) unmatchedHalfEdges += Math.abs(count - rev);
    }
  }

  const signedVolume = signedVol6 / 6;
  const minVol = opts.minVolume ?? 1e-7;

  assert(
    allFinite &&
      badNormals === 0 &&
      outOfBoundsIdx === 0 &&
      zeroAreaTris === 0 &&
      flippedNormalTris === 0 &&
      signedVolume > minVol &&
      (!opts.expectWatertight ||
        (unmatchedHalfEdges === 0 && duplicateHalfEdges === 0)),
    `${label} (${vCount}v, ${triCount}t, vol=${signedVolume.toExponential(2)})`,
    `finite=${allFinite}, badNrm=${badNormals}, oob=${outOfBoundsIdx}, zeroTri=${zeroAreaTris}, flipNrm=${flippedNormalTris}, vol=${signedVolume}, openHE=${unmatchedHalfEdges}, dupHE=${duplicateHalfEdges}`,
  );

  return {
    vertexCount: vCount,
    triangleCount: triCount,
    signedVolume,
    unmatchedHalfEdges,
    duplicateHalfEdges,
    flippedNormalTris,
  };
}

console.log(
  '=== Running kit_science_test.ts (Science / Chemistry / Math Kit Audit) ===',
);

// 1. Plugin registration & namespace attachment
scienceKitPlugin.onRegister?.();
// tslint:disable-next-line:no-any Dynamic kit attachment on THREE proxy prior to Stage 6 d.ts merge.
const Sci = (THREE as any).Science;
const regNs = getSharedRegistry().authorNamespace ?? {};
assert(
  Boolean(
    Sci &&
      Sci.MoleculeGeometry &&
      scienceKitPlugin.name === 'kit-science' &&
      !('MoleculeGeometry' in regNs),
  ),
  'scienceKitPlugin attaches strictly scoped THREE.Science with zero root THREE leaks',
);
assert(
  MAX_SCI_ATOMS === 512 &&
    MAX_SCI_GRID === 128 &&
    MAX_SCI_GLYPHS === 1000 &&
    MAX_SCI_BASE_PAIRS === 256 &&
    MAX_SCI_RIBBON_POINTS === 512 &&
    MAX_SCI_ISOSURFACE_RES === 48 &&
    MAX_SCI_STREAMLINE_STEPS === 240 &&
    Sci.MAX_SCI_RIBBON_POINTS === 512 &&
    Sci.MAX_SCI_ISOSURFACE_RES === 48 &&
    Sci.MAX_SCI_STREAMLINE_STEPS === 240,
  'exported quota constants match THREE.Science limits',
);
assert(
  Object.isFrozen(Sci) &&
    Object.isFrozen(Sci.MoleculeGeometry.prototype) &&
    Object.isFrozen(Sci.RibbonGeometry.prototype) &&
    Object.isFrozen(Sci.IsoSurfaceGeometry.prototype) &&
    Object.isFrozen(Sci.StreamlineGeometry.prototype),
  'THREE.Science and geometry prototypes are frozen against sandbox mutation',
);

// 2. IUPAC elementSpec lookup (by symbol and atomic number Z across expanded 41-element table)
const carbon = Sci.elementSpec('C');
const gold = Sci.elementSpec(79);
const titanium = Sci.elementSpec('Ti');
const uranium = Sci.elementSpec(92);
assert(
  carbon.atomicNumber === 6 &&
    Math.abs(carbon.covalentRadius - 0.76) < 1e-6 &&
    gold.symbol === 'Au' &&
    gold.cpkColor === 0xfbbf24 &&
    titanium.atomicNumber === 22 &&
    uranium.symbol === 'U',
  'elementSpec("C"), elementSpec(79), elementSpec("Ti"), and elementSpec(92) return IUPAC radii and CPK hex colors',
);

// 3. Audit all 9 scientific geometries & sub-modes
// 3a. MoleculeGeometry (all presets, styles, custom auto-bonded & triple-bonded)
const benzene = new Sci.MoleculeGeometry({
  preset: 'benzene',
  style: 'ball-and-stick',
});
auditGeometry(benzene, 'MoleculeGeometry (benzene Kekulé ball-and-stick)', {
  expectWatertight: true,
});
assert(
  Boolean(benzene.getAttribute('color')),
  'MoleculeGeometry populates CPK RGB vertex color attribute by default',
);

for (const preset of [
  'water',
  'methane',
  'ammonia',
  'co2',
  'ethene',
  'ethanol',
  'cyclohexane',
  'caffeine',
] as const) {
  auditGeometry(
    new Sci.MoleculeGeometry({
      preset,
      style:
        preset === 'water'
          ? 'space-filling'
          : preset === 'ethanol'
            ? 'licorice'
            : 'ball-and-stick',
    }),
    `MoleculeGeometry (${preset})`,
    {expectWatertight: true},
  );
}

// Custom acetylene HC≡CH with triple bond + auto-bond fallback test
auditGeometry(
  new Sci.MoleculeGeometry({
    atoms: [
      {element: 'C', position: [-0.6, 0, 0]},
      {element: 'C', position: [0.6, 0, 0]},
      {element: 'H', position: [-1.66, 0, 0]},
      {element: 'H', position: [1.66, 0, 0]},
    ],
    bonds: [
      [0, 1, 3],
      [0, 2, 1],
      [1, 3, 1],
    ],
  }),
  'MoleculeGeometry (custom HC≡CH triple bond)',
  {expectWatertight: true},
);

// 3b. CrystalLatticeGeometry (sc, bcc, fcc, hcp, diamond, nacl, graphene, perovskite + unit-cell frame)
const diamond = new Sci.CrystalLatticeGeometry({
  lattice: 'diamond',
  cells: [2, 2, 2],
  showUnitCell: true,
});
auditGeometry(diamond, 'CrystalLatticeGeometry (diamond 2x2x2 + unit cell)', {
  expectWatertight: true,
});
for (const lattice of [
  'sc',
  'bcc',
  'fcc',
  'hcp',
  'nacl',
  'graphene',
  'perovskite',
] as const) {
  auditGeometry(
    new Sci.CrystalLatticeGeometry({
      lattice,
      cells: lattice === 'graphene' ? [3, 1, 3] : [2, 2, 1],
    }),
    `CrystalLatticeGeometry (${lattice})`,
    {expectWatertight: true},
  );
}

// 3b-2. AtomicOrbitalGeometry (all 7 hydrogenic s, p, d wavefunctions)
for (const orbital of [
  '1s',
  '2px',
  '2py',
  '2pz',
  '3dz2',
  '3dx2-y2',
  '3dxz',
] as const) {
  const orb = new Sci.AtomicOrbitalGeometry({orbital, scale: 0.75});
  auditGeometry(orb, `AtomicOrbitalGeometry (${orbital})`, {
    expectWatertight: true,
  });
  assert(
    Boolean(orb.getAttribute('color')),
    `AtomicOrbitalGeometry (${orbital}) carries dual-phase RGB vertex colors`,
  );
}

// 3b-3. OpticalElementGeometry (all 5 lenses + 2 prisms)
for (const kind of [
  'biconvex',
  'planoconvex',
  'biconcave',
  'planoconcave',
  'meniscus',
  'prism-equilateral',
  'prism-right-angle',
] as const) {
  auditGeometry(
    new Sci.OpticalElementGeometry({kind, diameter: 0.5}),
    `OpticalElementGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 3c. SurfacePlotGeometry (presets + custom fn + solid plinth & shell)
for (const preset of [
  'sinc',
  'saddle',
  'gaussian',
  'ripple',
  'monkey-saddle',
] as const) {
  auditGeometry(
    new Sci.SurfacePlotGeometry({
      preset,
      segmentsX: 28,
      segmentsZ: 28,
      solid: preset !== 'saddle',
    }),
    `SurfacePlotGeometry (${preset}${preset === 'saddle' ? ', shell' : ', plinth'})`,
    {expectWatertight: true},
  );
}
auditGeometry(
  new Sci.SurfacePlotGeometry({
    fn: (x: number, z: number) => Math.sin(x * 1.5) * Math.cos(z * 1.5),
    segmentsX: 24,
    segmentsZ: 24,
  }),
  'SurfacePlotGeometry (custom sin*cos callback)',
  {expectWatertight: true},
);

// 3d. ParametricSurfaceGeometry (torus-knot, dupin-cyclide, spherical-harmonic, twisted-torus)
for (const kind of [
  'torus-knot',
  'dupin-cyclide',
  'spherical-harmonic',
  'twisted-torus',
] as const) {
  auditGeometry(
    new Sci.ParametricSurfaceGeometry({kind}),
    `ParametricSurfaceGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 3e. VectorFieldGeometry (dipole, vortex, saddle, radial, helical + custom fn)
for (const preset of [
  'dipole',
  'vortex',
  'saddle',
  'radial',
  'helical',
] as const) {
  auditGeometry(
    new Sci.VectorFieldGeometry({preset, grid: [4, 4, 4]}),
    `VectorFieldGeometry (${preset})`,
    {expectWatertight: true},
  );
}

// 3f. Axes3DGeometry (standard + symmetric)
auditGeometry(
  new Sci.Axes3DGeometry({length: 1.5, ticks: 5}),
  'Axes3DGeometry (positive triad + 5 ticks)',
  {expectWatertight: true},
);
auditGeometry(
  new Sci.Axes3DGeometry({length: 1.2, symmetric: true, ticks: 3}),
  'Axes3DGeometry (symmetric ±XYZ triad)',
  {expectWatertight: true},
);

// 3g. DoubleHelixGeometry
const dna = new Sci.DoubleHelixGeometry({turns: 2.0, basePairsPerTurn: 10.5});
auditGeometry(dna, 'DoubleHelixGeometry (2-turn B-DNA double helix)', {
  expectWatertight: true,
});

// 3h. RibbonGeometry (default fold, custom barrel sheet+coil+helix, closed cyclic peptide) + ribbonColorMap
const defaultRibbon = new Sci.RibbonGeometry();
auditGeometry(
  defaultRibbon,
  'RibbonGeometry (default beta-hairpin + alpha-helix fold)',
  {expectWatertight: true},
);
assert(
  Boolean(defaultRibbon.getAttribute('color')),
  'RibbonGeometry populates N->C RGB vertex colors alongside uChain UV mapping',
);

{
  const barrelPts: Array<[number, number, number]> = [];
  for (let s = 0; s < 3; s++) {
    const up = s % 2 === 0;
    const ang = (s * Math.PI) / 4;
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      const y = up ? -0.8 + 1.6 * u : 0.8 - 1.6 * u;
      barrelPts.push([
        0.9 * Math.cos(ang + u * 0.2),
        y,
        0.9 * Math.sin(ang + u * 0.2),
      ]);
    }
    const nextAng = ((s + 1) * Math.PI) / 4;
    const capY = up ? 0.96 : -0.96;
    const midAng = (ang + 0.2 + nextAng) * 0.5;
    barrelPts.push([0.65 * Math.cos(midAng), capY, 0.65 * Math.sin(midAng)]);
  }
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const a = u * Math.PI * 4;
    barrelPts.push([0.18 * Math.cos(a), 0.75 - 1.5 * u, 0.18 * Math.sin(a)]);
  }
  const barrelRibbon = new Sci.RibbonGeometry({
    points: barrelPts,
    spans: [
      {from: 0, to: 5, kind: 'sheet'},
      {from: 7, to: 12, kind: 'sheet'},
      {from: 14, to: 19, kind: 'sheet'},
      {from: 21, to: 29, kind: 'helix'},
    ],
    faceCenter: [0, 0, 0],
    colorScheme: 'secondary',
  });
  auditGeometry(
    barrelRibbon,
    'RibbonGeometry (barrel staves + hairpin turns + central helix)',
    {expectWatertight: true},
  );
}

{
  const cycPts: Array<[number, number, number]> = [];
  const cycKinds: Array<'coil' | 'sheet'> = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI * 2) / 16;
    cycPts.push([
      0.75 * Math.cos(a),
      0.16 * Math.sin(a * 2),
      0.75 * Math.sin(a),
    ]);
    cycKinds.push(
      i >= 2 && i <= 6 ? 'sheet' : i >= 10 && i <= 14 ? 'sheet' : 'coil',
    );
  }
  auditGeometry(
    new Sci.RibbonGeometry({
      points: cycPts,
      kinds: cycKinds,
      closed: true,
      faceCenter: [0, 0, 0],
    }),
    'RibbonGeometry (closed cyclic beta-macrocycle)',
    {expectWatertight: true},
  );
}

for (const scheme of [
  'spectrum',
  'secondary',
  'plddt',
  'viridis',
  'plasma',
  'turbo',
  'coolwarm',
] as const) {
  const tex = Sci.ribbonColorMap({
    scheme,
    kinds: ['coil', 'sheet', 'sheet', 'coil', 'helix', 'helix', 'coil'],
  });
  assert(
    Boolean(
      tex &&
        tex.isDataTexture === true &&
        tex.image?.width === 256 &&
        tex.image?.height === 4 &&
        tex.image?.data?.length === 256 * 4 * 4,
    ),
    `ribbonColorMap("${scheme}") builds 256x4 sRGB DataTexture`,
  );
}

// 3b. Stage 2: Quantitative Colormaps (`sampleColormap`, `colormapTexture`, `applyVertexColormap`), `IsoSurfaceGeometry` & `StreamlineGeometry`
{
  for (const cmap of [
    'viridis',
    'plasma',
    'turbo',
    'coolwarm',
    'plddt',
    'spectrum',
  ] as const) {
    const c0 = Sci.sampleColormap(cmap, 0);
    const cMid = Sci.sampleColormap(cmap, 0.5);
    const c1 = Sci.sampleColormap(cmap, 1);
    assert(
      c0.length === 3 &&
        cMid.length === 3 &&
        c1.length === 3 &&
        c0.every((v: number) => v >= 0 && v <= 1) &&
        c1.every((v: number) => v >= 0 && v <= 1) &&
        Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) > 0.1,
      `sampleColormap("${cmap}") returns valid distinct RGB stops in [0, 1]`,
    );
    const tex = Sci.colormapTexture({
      colormap: cmap,
      scalars: [10, 25, 60, 95],
      domain: [0, 100],
      width: 64,
    });
    assert(
      Boolean(tex && tex.isDataTexture === true && tex.image?.width === 64),
      `colormapTexture("${cmap}") builds 64x4 sRGB DataTexture from scalar array`,
    );
  }

  // Scalar-mapped RibbonGeometry (e.g., AlphaFold pLDDT confidence scores 0..100)
  const plddtRibbon = new Sci.RibbonGeometry({
    scalars: [42, 58, 76, 94, 96, 82, 48],
    colormap: 'plddt',
  });
  auditGeometry(plddtRibbon, 'RibbonGeometry (scalar pLDDT colormapped)', {
    expectWatertight: true,
  });
  assert(
    Boolean(plddtRibbon.getAttribute('color')?.count > 50),
    'RibbonGeometry with scalars populates per-vertex color attribute',
  );

  // Colormapped SurfacePlotGeometry + applyVertexColormap
  const colSurf = new Sci.SurfacePlotGeometry({
    preset: 'sinc',
    segmentsX: 20,
    segmentsZ: 20,
    colormap: 'plasma',
  });
  auditGeometry(colSurf, 'SurfacePlotGeometry (colormap="plasma")', {
    expectWatertight: true,
  });
  assert(
    colSurf.getAttribute('color')?.count ===
      colSurf.getAttribute('position')?.count,
    'SurfacePlotGeometry with colormap attaches matching color attribute',
  );

  // IsoSurfaceGeometry across all 6 built-in presets + shellThickness + custom field
  for (const preset of [
    'gyroid',
    'schwarz-p',
    'schwarz-d',
    'pi-orbital',
    'sp3-hybrid',
    'dipole-potential',
  ] as const) {
    const isoGeo = new Sci.IsoSurfaceGeometry({
      preset,
      resolution: 18,
      colormap: preset === 'gyroid' ? 'viridis' : undefined,
    });
    const st = auditGeometry(
      isoGeo,
      `IsoSurfaceGeometry("${preset}", res=18)`,
      {expectWatertight: true},
    );
    assert(
      st.triangleCount >= 40,
      `IsoSurfaceGeometry("${preset}") extracts non-trivial manifold (${st.triangleCount} tris)`,
    );
  }

  const gyroidShell = new Sci.IsoSurfaceGeometry({
    preset: 'gyroid',
    resolution: 16,
    shellThickness: 0.35,
    colormap: 'turbo',
  });
  auditGeometry(
    gyroidShell,
    'IsoSurfaceGeometry("gyroid", shellThickness=0.35)',
    {expectWatertight: true},
  );
  assert(
    gyroidShell.getAttribute('color')?.count ===
      gyroidShell.getAttribute('position')?.count,
    'IsoSurfaceGeometry("gyroid", colormap="turbo") populates vertex colors',
  );

  const customIso = new Sci.IsoSurfaceGeometry({
    field: (x: number, y: number, z: number) =>
      1.0 - (x * x * 1.4 + y * y + z * z * 1.8),
    isoLevel: 0.25,
    resolution: 16,
    colorField: (x: number, _y: number, z: number) => x - z,
    colormap: 'coolwarm',
  });
  auditGeometry(customIso, 'IsoSurfaceGeometry (custom ellipsoid field)', {
    expectWatertight: true,
  });

  // StreamlineGeometry across all 5 built-in presets + custom field
  for (const preset of [
    'dipole',
    'helmholtz',
    'vortex',
    'lorenz',
    'rossler',
  ] as const) {
    const streamGeo = new Sci.StreamlineGeometry({
      preset,
      seedCount: 6,
      steps: 48,
      arrowsPerLine: 2,
      colormap: 'plasma',
    });
    const st = auditGeometry(streamGeo, `StreamlineGeometry("${preset}")`, {
      expectWatertight: true,
    });
    assert(
      st.triangleCount >= 80 &&
        streamGeo.getAttribute('color')?.count === st.vertexCount,
      `StreamlineGeometry("${preset}") produces speed-colored watertight tubes (${st.triangleCount} tris)`,
    );
  }

  const customStream = new Sci.StreamlineGeometry({
    field: (x: number, _y: number, z: number) => [-z, 0.35, x] as const,
    seeds: [
      [0.5, -0.5, 0],
      [-0.5, -0.5, 0],
    ],
    steps: 40,
    arrowsPerLine: 1,
  });
  auditGeometry(customStream, 'StreamlineGeometry (custom helical field)', {
    expectWatertight: true,
  });
}

// 4. Adversarial / degenerate parameter fuzzing
for (const [name, fn] of [
  [
    'SurfacePlot throwing/NaN/spiky callback',
    () =>
      new Sci.SurfacePlotGeometry({
        fn: (x: number, z: number) =>
          Math.abs(x) < 0.2
            ? NaN
            : ((Math.round(x * 10) + Math.round(z * 10)) % 2) * 50,
        segmentsX: 9999,
        segmentsZ: 12,
        thickness: -5,
      }),
  ],
  [
    'VectorField zero/NaN vectors & excessive grid',
    () =>
      new Sci.VectorFieldGeometry({
        fn: () => [0, NaN, 0] as const,
        grid: [999, 999, 999],
      }),
  ],
  [
    'CrystalLattice excessive cells',
    () =>
      new Sci.CrystalLatticeGeometry({
        lattice: 'nacl',
        cells: [999, 999, 999],
        includeBonds: false,
      }),
  ],
  [
    'DoubleHelix extreme turns',
    () =>
      new Sci.DoubleHelixGeometry({
        turns: 9999,
        basePairsPerTurn: 999,
      }),
  ],
  [
    'AtomicOrbital & OpticalElement hostile options',
    () =>
      new Sci.OpticalElementGeometry({
        kind: 'meniscus',
        diameter: -5,
        curvatureRadius1: 0.0001,
        curvatureRadius2: NaN,
        radialSegments: 99999,
      }),
  ],
  [
    'RibbonGeometry 9999 NaN/duplicate points & extreme widths',
    () => {
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i < 9999; i++) {
        if (i % 5 === 0) {
          pts.push([NaN, 0, Infinity]);
        } else if (i % 7 === 0 && pts.length > 0) {
          pts.push([...pts[pts.length - 1]] as [number, number, number]);
        } else {
          const t = i * 0.17;
          pts.push([Math.cos(t) * 0.8, i * 0.015, Math.sin(t) * 0.8]);
        }
      }
      return new Sci.RibbonGeometry({
        points: pts,
        spans: [
          {from: -50, to: 40, kind: 'sheet'},
          {from: 90, to: 99999, kind: 'helix'},
        ],
        subdivisions: 999,
        profileSegments: 999,
        coilRadius: -5,
        sheetWidth: -10,
        arrowHeadWidth: 999,
      });
    },
  ],
  [
    'IsoSurfaceGeometry checkerboard/NaN/throwing callback & extreme resolution',
    () =>
      new Sci.IsoSurfaceGeometry({
        field: (x: number, y: number, z: number) => {
          if (x > 0.8) throw new Error('boom');
          if (y < -0.8) return NaN;
          const ix = Math.round(x * 7);
          const iy = Math.round(y * 7);
          const iz = Math.round(z * 7);
          return (ix + iy + iz) % 2 === 0 ? 1 : -1;
        },
        resolution: 99999,
        shellThickness: -5,
      }),
  ],
  [
    'StreamlineGeometry zero/NaN field & 999 seeds',
    () => {
      const seeds: Array<[number, number, number]> = [];
      for (let i = 0; i < 200; i++) {
        seeds.push([i % 2 === 0 ? NaN : 0.2, 0, 0.2]);
      }
      return new Sci.StreamlineGeometry({
        field: () => [0, NaN, Infinity] as const,
        seeds,
        steps: 99999,
        arrowsPerLine: 99,
      });
    },
  ],
] as const) {
  const g = fn();
  const s = auditGeometry(g, `Adversarial fuzz: ${name}`, {
    expectWatertight: true,
    minVolume: 1e-8,
  });
  assert(
    s.vertexCount < 90000,
    `${name} stays bounded (< 90k verts, got ${s.vertexCount})`,
  );
}

// 5. Worker Function.prototype.toString() isolation + GLB & USDZ export round-trip
{
  const isolatedInstaller = new Function(
    'return (' + installScienceKit.toString() + ');',
  )();
  const mockReg: Record<string, unknown> = {};
  const installed = isolatedInstaller(
    {BufferGeometry, BufferAttribute, Vector3},
    mockReg,
  );
  assert(
    Boolean(
      installed?.Science?.MoleculeGeometry &&
        // tslint:disable-next-line:no-any Mock registry inspection.
        (mockReg as any).authorNamespace?.Science &&
        !(mockReg as any).authorNamespace?.MoleculeGeometry,
    ),
    'installScienceKit.toString() executes cleanly in isolated Worker realm with zero outer closures',
  );

  const scene = new Scene();
  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.1,
  });
  const dnaMesh = new Mesh(dna, mat);
  dnaMesh.name = 'BDnaSegment';
  scene.add(dnaMesh);

  const molecules = new InstancedMesh(benzene, mat, 3);
  molecules.name = 'BenzeneRingCluster';
  const m = new Matrix4();
  for (let i = 0; i < 3; i++) {
    m.makeTranslation((i - 1) * 1.4, 0, 1.2);
    molecules.setMatrixAt(i, m);
  }
  scene.add(molecules);

  const ribbonMat = new MeshStandardMaterial({
    color: 0xffffff,
    map: Sci.ribbonColorMap({scheme: 'spectrum'}),
    roughness: 0.3,
    metalness: 0.08,
  });
  const ribbonMesh = new Mesh(defaultRibbon, ribbonMat);
  ribbonMesh.name = 'PolypeptideRibbon';
  scene.add(ribbonMesh);

  const glbBytes = scene.toGLB();
  const parsed = parseGLB(glbBytes);
  assert(
    parsed.gltf.meshes.length === 3 && glbBytes.byteLength > 1000,
    `Scientific assembly exports valid GLB (${glbBytes.byteLength} bytes, 3 meshes incl. RibbonGeometry + InstancedMesh)`,
  );

  const usdzBytes = scene.toUSDZ();
  assert(
    usdzBytes[0] === 0x50 &&
      usdzBytes[1] === 0x4b &&
      usdzBytes.byteLength > 1000,
    `Scientific assembly exports valid Apple USDZ (${usdzBytes.byteLength} bytes)`,
  );

  // Stage 1: Verify MoleculeGeometry (CPK colors) and AtomicOrbitalGeometry (phase-lobe colors) export COLOR_0 in GLB and primvars:displayColor in USDZ
  const cpkScene = new Scene();
  const cpkMol = new Mesh(
    new Sci.MoleculeGeometry({preset: 'caffeine'}),
    new MeshStandardMaterial({roughness: 0.3, metalness: 0.1}),
  );
  cpkMol.name = 'CaffeineCPK';
  cpkScene.add(cpkMol);
  const orbMesh = new Mesh(
    new Sci.AtomicOrbitalGeometry({orbital: '2pz'}),
    new MeshStandardMaterial({vertexColors: true, roughness: 0.35}),
  );
  orbMesh.name = 'Orbital2pz';
  orbMesh.position.set(1.5, 0, 0);
  cpkScene.add(orbMesh);

  const cpkGlb = parseGLB(cpkScene.toGLB());
  const molColorAccIdx =
    cpkGlb.gltf.meshes[0]?.primitives?.[0]?.attributes?.COLOR_0;
  const orbColorAccIdx =
    cpkGlb.gltf.meshes[1]?.primitives?.[0]?.attributes?.COLOR_0;
  assert(
    typeof molColorAccIdx === 'number' && typeof orbColorAccIdx === 'number',
    'MoleculeGeometry and AtomicOrbitalGeometry export COLOR_0 accessors in GLB',
  );
  const molAcc = cpkGlb.gltf.accessors[molColorAccIdx];
  const molBv = cpkGlb.gltf.bufferViews[molAcc.bufferView];
  const molColors = new Float32Array(
    cpkGlb.bin,
    (molBv.byteOffset || 0) + (molAcc.byteOffset || 0),
    molAcc.count * 3,
  );
  const distinctRgb = new Set<string>();
  for (let i = 0; i < molAcc.count; i++) {
    distinctRgb.add(
      `${molColors[i * 3].toFixed(2)},${molColors[i * 3 + 1].toFixed(2)},${molColors[i * 3 + 2].toFixed(2)}`,
    );
  }
  assert(
    distinctRgb.size >= 4,
    `Caffeine MoleculeGeometry COLOR_0 contains >= 4 distinct CPK element/bond colors (got ${distinctRgb.size})`,
  );

  const cpkUsdzText = new TextDecoder().decode(cpkScene.toUSDZ());
  assert(
    cpkUsdzText.includes('color3f[] primvars:displayColor = [') &&
      cpkUsdzText.includes('UsdPrimvarReader_float3') &&
      cpkUsdzText.includes('DisplayColorReader'),
    'MoleculeGeometry and AtomicOrbitalGeometry export primvars:displayColor and UsdPrimvarReader_float3 in USDZ',
  );
}

console.log(
  `\n🏆 kit-science Audit Results: ${passed} Passed, ${failed} Failed.`,
);
if (failed > 0) {
  process.exit(1);
}
