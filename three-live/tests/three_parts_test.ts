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
  installPartsExtension,
  MAX_PART_COILS,
  MAX_PART_HOLES,
  MAX_PART_RADIAL_SEGMENTS,
  MAX_PART_TEETH,
  partsPlugin,
} from '../src/parts';
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

/**
 * Audits a generated BufferGeometry for:
 * 1. Finite positions, unit normals, finite UVs, and in-range indices
 * 2. Strictly positive 3D signed volume (Divergence Theorem outward CCW check)
 * 3. Geometric face-normal vs. vertex-normal alignment (`dot(fn, vn) > 0.1`)
 * 4. Optional watertight 2-manifold half-edge pairing check
 */
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

  // Quantize spatial positions to 1e-6 m for topological half-edge pairing.
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
    signedVol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);

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
  const minVol = opts.minVolume ?? 1e-11;

  assert(
    allFinite &&
      badNormals === 0 &&
      outOfBoundsIdx === 0 &&
      zeroAreaTris === 0 &&
      flippedNormalTris === 0 &&
      signedVolume > minVol &&
      (!opts.expectWatertight || (unmatchedHalfEdges === 0 && duplicateHalfEdges === 0)),
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

console.log('=== Running three_parts_test.ts (Parametric Mechanical CAD Parts Audit) ===');

// 1. Plugin registration & namespace attachment
partsPlugin.onRegister?.();
const CAD = THREE.CAD;
assert(Boolean(CAD && CAD.SpurGearGeometry), 'partsPlugin attaches THREE.CAD onto THREE proxy');
assert(
  MAX_PART_TEETH === 200 &&
    MAX_PART_RADIAL_SEGMENTS === 128 &&
    MAX_PART_COILS === 64 &&
    MAX_PART_HOLES === 64,
  'exported quota constants match THREE.CAD limits',
);
assert(
  Object.isFrozen(CAD) && Object.isFrozen(CAD.SpurGearGeometry.prototype),
  'THREE.CAD and part prototypes are frozen against sandbox mutation',
);

// 2. ISO metric fastener table & scaling
const m6 = CAD.metricFastener('M6x25');
assert(
  Math.abs(m6.threadDiameter - 0.006) < 1e-9 &&
    Math.abs(m6.pitch - 0.001) < 1e-9 &&
    Math.abs(m6.acrossFlats - 0.01) < 1e-9 &&
    Math.abs((m6.length ?? 0) - 0.025) < 1e-9,
  'metricFastener("M6x25") returns exact ISO 4014/4762/4032 meter dimensions',
);
const m3Scaled = CAD.metricFastener('M3x10', 10);
assert(
  Math.abs(m3Scaled.threadDiameter - 0.03) < 1e-9 &&
    Math.abs((m3Scaled.length ?? 0) - 0.1) < 1e-9,
  'metricFastener("M3x10", 10) applies tabletop display scale factor',
);

// 3. Audit all 12 standard machine parts & sub-configurations
// 3a. SpurGearGeometry (straight, helical, keyway + lightening holes, raised hub)
const sunGear = new CAD.SpurGearGeometry({
  module: 0.005,
  teeth: 16,
  thickness: 0.014,
  bore: 0.016,
});
auditGeometry(sunGear, 'SpurGearGeometry (straight 16T)', {expectWatertight: true});

const planetGear = new CAD.SpurGearGeometry({
  module: 0.005,
  teeth: 13,
  thickness: 0.014,
  bore: 0.012,
  keywayWidth: 0.004,
  keywayDepth: 0.002,
  lighteningHoles: 4,
});
auditGeometry(planetGear, 'SpurGearGeometry (13T + keyway + 4 web holes)', {
  expectWatertight: true,
});

const helicalBossGear = new CAD.SpurGearGeometry({
  module: 0.006,
  teeth: 24,
  thickness: 0.016,
  helixAngleDeg: 18,
  bore: 0.02,
  hubRadius: 0.028,
  hubThickness: 0.028,
});
auditGeometry(helicalBossGear, 'SpurGearGeometry (24T helical 18° + raised hub)');

// 3b. InternalRingGearGeometry + kinematic meshing equations
const ringGear = new CAD.InternalRingGearGeometry({
  module: 0.005,
  teeth: 42,
  thickness: 0.016,
  boltCount: 6,
  boltHoleDiameter: 0.0066,
});
auditGeometry(ringGear, 'InternalRingGearGeometry (42T + 6 flange holes)', {
  expectWatertight: true,
});

const extMesh = CAD.gearMeshDistance(sunGear, planetGear);
const intMesh = CAD.gearMeshDistance(ringGear, planetGear);
assert(
  Math.abs(extMesh.centerDistance - (16 + 13) * 0.5 * 0.005) < 1e-9 &&
    Math.abs(intMesh.centerDistance - (42 - 13) * 0.5 * 0.005) < 1e-9 &&
    Math.abs(extMesh.centerDistance - intMesh.centerDistance) < 1e-9,
  'gearMeshDistance computes exact planetary sun + 2*planet = ring center distances',
);

// 3c. RackGeometry
const rack = new CAD.RackGeometry({
  module: 0.005,
  teeth: 10,
  thickness: 0.014,
  backHeight: 0.012,
});
auditGeometry(rack, 'RackGeometry (10T linear rack)', {expectWatertight: true});

// 3d. PulleyGeometry
const pulley = new CAD.PulleyGeometry({
  pitchRadius: 0.05,
  grooves: 3,
  width: 0.036,
  bore: 0.016,
});
auditGeometry(pulley, 'PulleyGeometry (3-groove V-pulley)', {expectWatertight: true});

// 3e. BoltGeometry (all 4 head types)
const hexBolt = new CAD.BoltGeometry({
  preset: 'M8x30',
  scale: 10,
  headType: 'hex',
});
auditGeometry(hexBolt, 'BoltGeometry (M8x30 hex head)');
assert(
  Math.abs(hexBolt.boundingBox.min.y - -0.3) < 1e-4 &&
    hexBolt.boundingBox.max.y > 0.05,
  'BoltGeometry bearing origin places under-head seat at y = 0 and tip at -length',
);

const sockBolt = new CAD.BoltGeometry({
  preset: 'M6x20',
  scale: 10,
  headType: 'socket',
});
auditGeometry(sockBolt, 'BoltGeometry (M6x20 socket head cap screw)', {
  expectWatertight: true,
});

const btnBolt = new CAD.BoltGeometry({
  preset: 'M5x16',
  scale: 10,
  headType: 'button',
  origin: 'center',
});
auditGeometry(btnBolt, 'BoltGeometry (M5x16 button head, centered)', {
  expectWatertight: true,
});

const cskBolt = new CAD.BoltGeometry({
  preset: 'M6x20',
  scale: 10,
  headType: 'countersunk',
});
auditGeometry(cskBolt, 'BoltGeometry (M6x20 countersunk flat-head)', {
  expectWatertight: true,
});
assert(
  Math.abs(cskBolt.boundingBox.max.y) < 1e-5,
  'Countersunk BoltGeometry places flush top face at y = 0',
);

// 3f. NutGeometry (standard, flanged, nyloc)
auditGeometry(
  new CAD.NutGeometry({preset: 'M8', scale: 10}),
  'NutGeometry (M8 hex nut)',
  {expectWatertight: true},
);
auditGeometry(
  new CAD.NutGeometry({preset: 'M8', scale: 10, flanged: true, nyloc: true}),
  'NutGeometry (M8 flanged nyloc locknut)',
);

// 3g. WasherGeometry
auditGeometry(
  new CAD.WasherGeometry({preset: 'M8', scale: 10}),
  'WasherGeometry (M8 chamfered washer)',
  {expectWatertight: true},
);

// 3h. ShaftGeometry (stepped hollow + D-shaft)
auditGeometry(
  new CAD.ShaftGeometry({
    segments: [
      {diameter: 0.02, length: 0.04, chamfer: 0.0015},
      {diameter: 0.032, length: 0.05},
      {diameter: 0.024, length: 0.03, chamfer: 0.0015},
    ],
    bore: 0.008,
  }),
  'ShaftGeometry (3-stepped hollow CNC shaft)',
  {expectWatertight: true},
);
auditGeometry(
  new CAD.ShaftGeometry({diameter: 0.02, length: 0.08, dCut: 0.003}),
  'ShaftGeometry (D-cut motor shaft)',
  {expectWatertight: true},
);

// 3i. BearingGeometry (open rolling-element + sealed flanged)
auditGeometry(
  new CAD.BearingGeometry({innerDiameter: 0.02, outerDiameter: 0.047, width: 0.014, balls: 9}),
  'BearingGeometry (6204 open 9-ball deep-groove bearing)',
  {expectWatertight: true},
);
auditGeometry(
  new CAD.BearingGeometry({
    innerDiameter: 0.02,
    outerDiameter: 0.047,
    width: 0.014,
    shielded: true,
    flanged: true,
  }),
  'BearingGeometry (sealed flanged bearing)',
  {expectWatertight: true},
);

// 3j. HelicalSpringGeometry
auditGeometry(
  new CAD.HelicalSpringGeometry({
    meanRadius: 0.025,
    wireRadius: 0.004,
    coils: 6.5,
    length: 0.09,
    flatEnds: true,
  }),
  'HelicalSpringGeometry (6.5-coil squared-end compression spring)',
  {expectWatertight: true},
);

// 3k. FlangePlateGeometry
auditGeometry(
  new CAD.FlangePlateGeometry({
    outerRadius: 0.08,
    thickness: 0.014,
    bore: 0.05,
    boltCount: 8,
    boltHoleDiameter: 0.01,
    neckRadius: 0.034,
    neckHeight: 0.022,
  }),
  'FlangePlateGeometry (8-bolt weld-neck pipe flange)',
);

// 3l. ProfileExtrusionGeometry (all 5 structural profiles)
for (const profile of [
  't-slot',
  'i-beam',
  'c-channel',
  'l-angle',
  'rect-tube',
] as const) {
  auditGeometry(
    new CAD.ProfileExtrusionGeometry({
      profile,
      width: 0.04,
      height: 0.04,
      length: 0.2,
    }),
    `ProfileExtrusionGeometry (${profile})`,
    {expectWatertight: true},
  );
}

// 4. Adversarial / degenerate parameter fuzzing
for (const [name, fn] of [
  [
    'SpurGear hostile options',
    () =>
      new CAD.SpurGearGeometry({
        teeth: 999999,
        module: -5,
        bore: 999,
        lighteningHoles: 9999,
        helixAngleDeg: NaN,
      }),
  ],
  [
    'InternalRingGear hostile options',
    () =>
      new CAD.InternalRingGearGeometry({
        teeth: 1,
        outerRadius: -10,
        boltCount: 9999,
      }),
  ],
  [
    'Bolt hostile options',
    () =>
      new CAD.BoltGeometry({
        preset: 'not-a-size',
        threadDiameter: NaN,
        length: -2,
        radialSegments: 99999,
      }),
  ],
  [
    'Spring hostile options',
    () =>
      new CAD.HelicalSpringGeometry({
        coils: Infinity,
        wireRadius: 999,
        meanRadius: 0.002,
      }),
  ],
  [
    'Shaft empty segments',
    () => new CAD.ShaftGeometry({segments: [], bore: 999}),
  ],
] as const) {
  const g = fn();
  const s = auditGeometry(g, `Adversarial fuzz: ${name}`, {minVolume: 1e-13});
  assert(s.vertexCount < 50000, `${name} stays bounded (< 50k verts, got ${s.vertexCount})`);
}

// 5. Worker Function.prototype.toString() isolation + GLB & USDZ export round-trip
{
  const isolatedInstaller = new Function(
    'return (' + installPartsExtension.toString() + ');',
  )();
  const mockReg: Record<string, unknown> = {};
  const installed = isolatedInstaller({BufferGeometry, BufferAttribute, Vector3}, mockReg);
  assert(
    Boolean(installed?.CAD?.SpurGearGeometry && (mockReg as any).authorNamespace?.CAD),
    'installPartsExtension.toString() executes cleanly in isolated Worker realm with zero outer closures',
  );

  // Build an instanced gearbox assembly and export to GLB + USDZ
  const scene = new Scene();
  const steel = new MeshStandardMaterial({color: 0xcbd5e1, metalness: 0.9, roughness: 0.2});
  const gearMesh = new Mesh(sunGear, steel);
  gearMesh.name = 'SunGear';
  scene.add(gearMesh);

  const bolts = new InstancedMesh(sockBolt, steel, 6);
  bolts.name = 'FlangeBolts';
  const m = new Matrix4();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    m.makeTranslation(0.06 * Math.cos(a), 0.01, 0.06 * Math.sin(a));
    bolts.setMatrixAt(i, m);
  }
  scene.add(bolts);

  const glbBytes = scene.toGLB();
  const parsed = parseGLB(glbBytes);
  assert(
    parsed.gltf.meshes.length === 2 && glbBytes.byteLength > 1000,
    `Assembly exports valid GLB (${glbBytes.byteLength} bytes, 2 meshes incl. InstancedMesh)`,
  );

  const usdzBytes = scene.toUSDZ();
  assert(
    usdzBytes[0] === 0x50 && usdzBytes[1] === 0x4b && usdzBytes.byteLength > 1000,
    `Assembly exports valid Apple USDZ (${usdzBytes.byteLength} bytes)`,
  );
}

console.log(`\n🏆 three-parts Audit Results: ${passed} Passed, ${failed} Failed.`);
if (failed > 0) {
  process.exit(1);
}
