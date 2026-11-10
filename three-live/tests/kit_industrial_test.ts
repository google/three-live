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
  industrialKitPlugin,
  installIndustrialKit,
  MAX_IND_RUNGS,
  MAX_IND_SEGMENTS,
  MAX_IND_SPANS,
  MAX_IND_WAYPOINTS,
} from '../src/kit-industrial';
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
import {getSharedRegistry} from '../src/plugin';
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
  const minVol = opts.minVolume ?? 1e-6;

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

console.log('=== Running kit_industrial_test.ts (Industrial / Process / Warehouse Kit Audit) ===');

// 1. Plugin registration & namespace attachment
industrialKitPlugin.onRegister?.();
// tslint:disable-next-line:no-any Dynamic kit attachment on THREE proxy prior to Stage 6 d.ts merge.
const Ind = (THREE as any).Industrial;
const regNs = getSharedRegistry().authorNamespace ?? {};
assert(
  Boolean(
    Ind &&
      Ind.PipeRunGeometry &&
      industrialKitPlugin.name === 'kit-industrial' &&
      !('PipeRunGeometry' in regNs),
  ),
  'industrialKitPlugin attaches strictly scoped THREE.Industrial with zero root THREE leaks',
);
assert(
  MAX_IND_WAYPOINTS === 64 &&
    MAX_IND_SEGMENTS === 96 &&
    MAX_IND_SPANS === 64 &&
    MAX_IND_RUNGS === 256,
  'exported quota constants match THREE.Industrial limits',
);
assert(
  Object.isFrozen(Ind) && Object.isFrozen(Ind.PipeRunGeometry.prototype),
  'THREE.Industrial and geometry prototypes are frozen against sandbox mutation',
);

// 2. ASME B36.10M / B16.5 nominal pipe lookup (both DN and NPS inches)
const dn100 = Ind.nominalPipeSpec('DN100');
const nps4 = Ind.nominalPipeSpec('4in');
assert(
  dn100.dn === 100 &&
    Math.abs(dn100.outerDiameter - 0.1143) < 1e-6 &&
    Math.abs(dn100.flangeDiameter - 0.2286) < 1e-6 &&
    dn100.boltCount === 8 &&
    Math.abs(nps4.outerDiameter - dn100.outerDiameter) < 1e-9,
  'nominalPipeSpec("DN100") and nominalPipeSpec("4in") return matching ASME B36.10/B16.5 meter specs',
);

// 3. Audit all 8 industrial geometries & sub-modes
// 3a. PipeRunGeometry (3D multi-bend flanged run + 2-point straight run)
const pipeRun3D = new Ind.PipeRunGeometry({
  size: 'DN100',
  waypoints: [
    [0, 0, 0],
    [1.4, 0, 0],
    [1.4, 1.1, 0],
    [1.4, 1.1, -1.2],
  ],
  flangedEnds: true,
});
auditGeometry(pipeRun3D, 'PipeRunGeometry (DN100 3D multi-elbow + weld-neck flanges)', {
  expectWatertight: true,
});
auditGeometry(
  new Ind.PipeRunGeometry({
    size: '2in',
    waypoints: [
      [0, 0, 0],
      [1.0, 0, 0],
    ],
    flangedEnds: false,
  }),
  'PipeRunGeometry (2in straight run)',
  {expectWatertight: true},
);

// 3b. PipeFittingGeometry (elbow-90, elbow-45, tee, cross, reducer, eccentric-reducer, cap)
for (const kind of [
  'elbow-90',
  'elbow-45',
  'tee',
  'cross',
  'reducer',
  'eccentric-reducer',
  'cap',
] as const) {
  auditGeometry(
    new Ind.PipeFittingGeometry({
      kind,
      size: 'DN80',
      secondarySize: 'DN50',
      flanged: true,
    }),
    `PipeFittingGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 3c. ValveGeometry (gate-handwheel, ball-lever, butterfly, pneumatic-control, check)
for (const kind of [
  'gate-handwheel',
  'ball-lever',
  'butterfly',
  'pneumatic-control',
  'check',
] as const) {
  auditGeometry(
    new Ind.ValveGeometry({
      kind,
      size: 'DN100',
      openFraction: kind === 'ball-lever' ? 0.35 : 0.75,
    }),
    `ValveGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 3c-2. CentrifugalPumpGeometry
auditGeometry(
  new Ind.CentrifugalPumpGeometry({
    suctionSize: 'DN100',
    dischargeSize: 'DN80',
    motorPowerKw: 22,
  }),
  'CentrifugalPumpGeometry (ANSI DN100xDN80 22kW process pump skid)',
  {expectWatertight: true},
);

// 3d. PalletRackGeometry
const rack = new Ind.PalletRackGeometry({
  bays: 2,
  levels: 3,
  bayWidth: 2.7,
  depth: 1.1,
  height: 4.5,
});
auditGeometry(rack, 'PalletRackGeometry (2 bays x 3 levels)', {
  expectWatertight: true,
});

// 3e. ConveyorGeometry (roller, belt, inclined + sideGuides)
for (const kind of ['roller', 'belt'] as const) {
  auditGeometry(
    new Ind.ConveyorGeometry({kind, length: 3.2, width: 0.75, height: 0.85}),
    `ConveyorGeometry (${kind})`,
    {expectWatertight: true},
  );
}
auditGeometry(
  new Ind.ConveyorGeometry({
    kind: 'belt',
    length: 4.0,
    width: 0.8,
    height: 1.2,
    inclineDeg: 18,
    sideGuides: true,
  }),
  'ConveyorGeometry (18° inclined belt conveyor + package side guides)',
  {expectWatertight: true},
);

// 3e-2. CatwalkPlatformGeometry
auditGeometry(
  new Ind.CatwalkPlatformGeometry({
    length: 4.2,
    width: 1.1,
    height: 2.6,
    guardrail: 'both',
  }),
  'CatwalkPlatformGeometry (OSHA grating walkway + dual guardrails)',
  {expectWatertight: true},
);

// 3f. IndustrialLadderGeometry (with & without OSHA safety cage)
auditGeometry(
  new Ind.IndustrialLadderGeometry({height: 5.0, includeCage: true}),
  'IndustrialLadderGeometry (5m with OSHA safety cage)',
  {expectWatertight: true},
);
auditGeometry(
  new Ind.IndustrialLadderGeometry({height: 2.4, includeCage: false}),
  'IndustrialLadderGeometry (2.4m uncaged)',
  {expectWatertight: true},
);

// 3g. SafetyBarrierGeometry (bollard, guardrail-single, guardrail-double, handrail)
const bollard = new Ind.SafetyBarrierGeometry({kind: 'bollard', height: 1.05});
auditGeometry(bollard, 'SafetyBarrierGeometry (bollard)', {
  expectWatertight: true,
});
for (const kind of [
  'guardrail-single',
  'guardrail-double',
  'handrail',
] as const) {
  auditGeometry(
    new Ind.SafetyBarrierGeometry({kind, length: 3.0}),
    `SafetyBarrierGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 3h. StorageTankGeometry (vertical-dished, horizontal-saddle, cone-hopper, flat-api650)
for (const kind of [
  'vertical-dished',
  'horizontal-saddle',
  'cone-hopper',
  'flat-api650',
] as const) {
  auditGeometry(
    new Ind.StorageTankGeometry({kind, radius: 1.1, shellHeight: 2.8, manway: true}),
    `StorageTankGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 4. Adversarial / degenerate parameter fuzzing
for (const [name, fn] of [
  [
    'PipeRun collinear/duplicate/excessive waypoints',
    () =>
      new Ind.PipeRunGeometry({
        size: 'not-a-pipe',
        outerDiameter: NaN,
        bendRadius: 999,
        radialSegments: 99999,
        waypoints: Array.from({length: 200}, (_, i) => [
          i * 0.05,
          i % 2 === 0 ? 0 : 1e-9,
          0,
        ]),
      }),
  ],
  [
    'Conveyor tiny roller pitch',
    () =>
      new Ind.ConveyorGeometry({
        kind: 'roller',
        length: 100,
        rollerPitch: 0.0001,
        height: -5,
      }),
  ],
  [
    'PalletRack extreme bays & levels',
    () =>
      new Ind.PalletRackGeometry({
        bays: 999,
        levels: 999,
        deckBarsPerBay: 999,
      }),
  ],
  [
    'Ladder extreme height & tiny rung spacing',
    () =>
      new Ind.IndustrialLadderGeometry({
        height: 999,
        rungSpacing: 0.0001,
        includeCage: true,
      }),
  ],
  [
    'CentrifugalPump hostile options',
    () =>
      new Ind.CentrifugalPumpGeometry({
        suctionSize: 'INVALID',
        motorPowerKw: 999999,
        casingRadius: -5,
      }),
  ],
  [
    'Catwalk extreme grating bars',
    () =>
      new Ind.CatwalkPlatformGeometry({
        length: 999,
        gratingBars: 99999,
        height: -10,
      }),
  ],
] as const) {
  const g = fn();
  const s = auditGeometry(g, `Adversarial fuzz: ${name}`, {
    expectWatertight: true,
    minVolume: 1e-6,
  });
  assert(
    s.vertexCount < 85000,
    `${name} stays bounded (< 85k verts, got ${s.vertexCount})`,
  );
}

// 5. Worker Function.prototype.toString() isolation + GLB & USDZ export round-trip
{
  const isolatedInstaller = new Function(
    'return (' + installIndustrialKit.toString() + ');',
  )();
  const mockReg: Record<string, unknown> = {};
  const installed = isolatedInstaller(
    {BufferGeometry, BufferAttribute, Vector3},
    mockReg,
  );
  assert(
    Boolean(
      installed?.Industrial?.PipeRunGeometry &&
        // tslint:disable-next-line:no-any Mock registry inspection.
        (mockReg as any).authorNamespace?.Industrial && !((mockReg as any).authorNamespace?.PipeRunGeometry),
    ),
    'installIndustrialKit.toString() executes cleanly in isolated Worker realm with zero outer closures',
  );

  const scene = new Scene();
  const yellowSteel = new MeshStandardMaterial({
    color: 0xeab308,
    metalness: 0.6,
    roughness: 0.35,
  });
  const pipeMesh = new Mesh(pipeRun3D, yellowSteel);
  pipeMesh.name = 'MainProcessHeader';
  scene.add(pipeMesh);

  const bollards = new InstancedMesh(bollard, yellowSteel, 4);
  bollards.name = 'AisleBollards';
  const m = new Matrix4();
  for (let i = 0; i < 4; i++) {
    m.makeTranslation(i * 1.2, 0, 1.0);
    bollards.setMatrixAt(i, m);
  }
  scene.add(bollards);

  const glbBytes = scene.toGLB();
  const parsed = parseGLB(glbBytes);
  assert(
    parsed.gltf.meshes.length === 2 && glbBytes.byteLength > 1000,
    `Industrial assembly exports valid GLB (${glbBytes.byteLength} bytes, 2 meshes incl. InstancedMesh)`,
  );

  const usdzBytes = scene.toUSDZ();
  assert(
    usdzBytes[0] === 0x50 && usdzBytes[1] === 0x4b && usdzBytes.byteLength > 1000,
    `Industrial assembly exports valid Apple USDZ (${usdzBytes.byteLength} bytes)`,
  );
}

console.log(
  `\n🏆 kit-industrial Audit Results: ${passed} Passed, ${failed} Failed.`,
);
if (failed > 0) {
  process.exit(1);
}
