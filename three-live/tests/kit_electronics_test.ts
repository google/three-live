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
  electronicsKitPlugin,
  installElectronicsKit,
  MAX_ECAD_FINS,
  MAX_ECAD_HOLES,
  MAX_ECAD_PINS,
  MAX_ECAD_SEGMENTS,
} from '../src/kit-electronics';
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

  // Micron (`1e-6 m`) spatial quantization for sub-millimeter JEDEC leads.
  const keyOf = (vi: number): string => {
    const q = 1e6;
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
    if (area2 <= 1e-16) {
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
  const minVol = opts.minVolume ?? 1e-12;

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

console.log('=== Running kit_electronics_test.ts (Electronics / ECAD Kit Audit) ===');

// 1. Plugin registration & namespace attachment
electronicsKitPlugin.onRegister?.();
// tslint:disable-next-line:no-any Dynamic kit attachment on THREE proxy prior to Stage 6 d.ts merge.
const Ecad = (THREE as any).Electronics;
const regNs = getSharedRegistry().authorNamespace ?? {};
assert(
  Boolean(
    Ecad &&
      Ecad.PcbBoardGeometry &&
      electronicsKitPlugin.name === 'kit-electronics' &&
      !('ECAD' in regNs) &&
      !('PcbBoardGeometry' in regNs),
  ),
  'electronicsKitPlugin attaches strictly scoped THREE.Electronics with zero aliases or root THREE leaks',
);
assert(
  MAX_ECAD_PINS === 256 &&
    MAX_ECAD_FINS === 96 &&
    MAX_ECAD_HOLES === 64 &&
    MAX_ECAD_SEGMENTS === 96,
  'exported quota constants match THREE.Electronics limits',
);
assert(
  Object.isFrozen(Ecad) && Object.isFrozen(Ecad.PcbBoardGeometry.prototype),
  'THREE.Electronics and geometry prototypes are frozen against sandbox mutation',
);

// 2. JEDEC package table & tabletop scaling
const dip8 = Ecad.jedecPackageSpec('DIP-8');
const sot23Spec = Ecad.jedecPackageSpec('SOT-23');
const d2pakSpec = Ecad.jedecPackageSpec('D2PAK');
const tqfpScaled = Ecad.jedecPackageSpec('TQFP-32', 10);
assert(
  dip8.kind === 'dip' &&
    dip8.pinCount === 8 &&
    Math.abs(dip8.pitch - 0.00254) < 1e-9 &&
    sot23Spec.kind === 'sot23' &&
    sot23Spec.pinCount === 3 &&
    d2pakSpec.kind === 'd2pak' &&
    d2pakSpec.pinCount === 3 &&
    tqfpScaled.kind === 'qfp' &&
    Math.abs(tqfpScaled.bodyWidth - 0.07) < 1e-9,
  'jedecPackageSpec("DIP-8", "SOT-23", "D2PAK", "TQFP-32") return exact JEDEC meter dimensions',
);

// 3. Audit all 9 electronics / ECAD geometries & sub-modes
// 3a. PcbBoardGeometry (corner M3 holes + custom center mounting holes)
const pcb = new Ecad.PcbBoardGeometry({
  width: 0.085,
  length: 0.056,
  cornerHoles: true,
  holes: [{x: 0, z: 0, diameter: 0.004}],
  scale: 10,
});
auditGeometry(pcb, 'PcbBoardGeometry (85x56mm FR4 board + 5 holes)', {
  expectWatertight: true,
});

// 3b. EnclosureGeometry (base, vented base, lid, closed, flanged + I/O panel cutouts)
for (const part of ['base', 'lid', 'closed'] as const) {
  auditGeometry(
    new Ecad.EnclosureGeometry({
      part,
      scale: 10,
      ventSlots: part === 'base' ? 5 : 0,
    }),
    `EnclosureGeometry (${part}${part === 'base' ? ', 5 vent slots' : ''})`,
    {expectWatertight: true},
  );
}
auditGeometry(
  new Ecad.EnclosureGeometry({
    part: 'closed',
    flanges: true,
    panelCutouts: [
      {face: 'front', x: -0.18, y: 0.14, width: 0.12, height: 0.06},
      {face: 'front', x: 0.18, y: 0.16, width: 0.17, height: 0.14},
      {face: 'back', x: 0, y: 0.15, width: 0.1, height: 0.11},
      {face: 'left', x: 0, y: 0.12, width: 0.15, height: 0.05},
      {face: 'right', x: 0.05, y: 0.14, width: 0.12, height: 0.07},
    ],
    scale: 10,
  }),
  'EnclosureGeometry (closed + wall-mount flanges + 5 I/O panel cutouts)',
  {expectWatertight: true},
);

// 3c. HeatsinkGeometry
auditGeometry(
  new Ecad.HeatsinkGeometry({finCount: 13, taperRatio: 0.65, scale: 10}),
  'HeatsinkGeometry (13 tapered fins)',
  {expectWatertight: true},
);

// 3d. DinRailGeometry (ts35x7.5 slotted, ts35x15 slotted, ts15 solid)
for (const profile of ['ts35x7.5', 'ts35x15', 'ts15'] as const) {
  auditGeometry(
    new Ecad.DinRailGeometry({
      profile,
      slotted: profile !== 'ts15',
      scale: 10,
    }),
    `DinRailGeometry (${profile}${profile === 'ts15' ? ', solid' : ', slotted'})`,
    {expectWatertight: true},
  );
}

// 3e. IcPackageGeometry (dip, soic, qfp, qfn, bga, to220, sot23, d2pak)
const tqfp = new Ecad.IcPackageGeometry({preset: 'TQFP-32', scale: 10});
auditGeometry(tqfp, 'IcPackageGeometry (TQFP-32 gull-wing)', {
  expectWatertight: true,
});
for (const preset of [
  'DIP-16',
  'SOIC-8',
  'SOT-23',
  'SOT-23-6',
  'QFN-24',
  'BGA-64',
  'TO-220',
  'D2PAK',
] as const) {
  auditGeometry(
    new Ecad.IcPackageGeometry({preset, scale: 10}),
    `IcPackageGeometry (${preset})`,
    {expectWatertight: true},
  );
}
// Also verify unscaled 1:1 SI millimeter precision on SOIC-8 & SOT-23!
auditGeometry(
  new Ecad.IcPackageGeometry({preset: 'SOIC-8', scale: 1}),
  'IcPackageGeometry (SOIC-8 at true 1:1 SI millimeter scale)',
  {expectWatertight: true, minVolume: 1e-11},
);
auditGeometry(
  new Ecad.IcPackageGeometry({preset: 'SOT-23', scale: 1}),
  'IcPackageGeometry (SOT-23 3-pin at true 1:1 SI millimeter scale)',
  {expectWatertight: true, minVolume: 1e-12},
);

// 3f. PinHeaderGeometry (male straight, male right-angle, female, shrouded IDC)
auditGeometry(
  new Ecad.PinHeaderGeometry({gender: 'male', rows: 2, cols: 6, scale: 10}),
  'PinHeaderGeometry (2x6 male straight)',
  {expectWatertight: true},
);
auditGeometry(
  new Ecad.PinHeaderGeometry({
    gender: 'male',
    rows: 2,
    cols: 5,
    rightAngle: true,
    scale: 10,
  }),
  'PinHeaderGeometry (2x5 male right-angle)',
  {expectWatertight: true},
);
auditGeometry(
  new Ecad.PinHeaderGeometry({gender: 'female', rows: 1, cols: 8, scale: 10}),
  'PinHeaderGeometry (1x8 female socket)',
  {expectWatertight: true},
);
auditGeometry(
  new Ecad.PinHeaderGeometry({gender: 'shrouded', rows: 2, cols: 5, scale: 10}),
  'PinHeaderGeometry (2x5 shrouded IDC box)',
  {expectWatertight: true},
);

// 3g. ConnectorGeometry (usb-c, usb-a, rj45, barrel-jack, sma, terminal-block, hdmi, microsd, jst-xh)
for (const kind of [
  'usb-c',
  'usb-a',
  'rj45',
  'barrel-jack',
  'sma',
  'terminal-block',
  'hdmi',
  'microsd',
  'jst-xh',
] as const) {
  auditGeometry(
    new Ecad.ConnectorGeometry({kind, scale: 10}),
    `ConnectorGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 3h. StandoffSpacerGeometry (hex female-female, hex male-female, round)
const hexStandoff = new Ecad.StandoffSpacerGeometry({
  shape: 'hex',
  thread: 'M3',
  length: 0.012,
  maleStudLength: 0.005,
  scale: 10,
});
auditGeometry(hexStandoff, 'StandoffSpacerGeometry (M3 hex male-female)', {
  expectWatertight: true,
});
auditGeometry(
  new Ecad.StandoffSpacerGeometry({
    shape: 'round',
    thread: 'M4',
    length: 0.015,
    scale: 10,
  }),
  'StandoffSpacerGeometry (M4 round female-female)',
  {expectWatertight: true},
);

// 3i. DiscreteComponentGeometry (smd-chip 0402..2512, electrolytic-cap, tactile-switch, led-domed, crystal-hc49)
for (const pkg of ['0402', '0603', '0805', '1206', '2512'] as const) {
  auditGeometry(
    new Ecad.DiscreteComponentGeometry({
      kind: 'smd-chip',
      package: pkg,
      scale: 10,
    }),
    `DiscreteComponentGeometry (smd-chip ${pkg})`,
    {expectWatertight: true, minVolume: 1e-11},
  );
}
auditGeometry(
  new Ecad.DiscreteComponentGeometry({
    kind: 'smd-chip',
    package: '0402',
    scale: 1,
  }),
  'DiscreteComponentGeometry (0402 at true 1:1 SI millimeter scale)',
  {expectWatertight: true, minVolume: 1e-11},
);
for (const kind of [
  'electrolytic-cap',
  'tactile-switch',
  'led-domed',
  'crystal-hc49',
] as const) {
  auditGeometry(
    new Ecad.DiscreteComponentGeometry({kind, scale: 10}),
    `DiscreteComponentGeometry (${kind})`,
    {expectWatertight: true},
  );
}

// 4. Adversarial / degenerate parameter fuzzing
for (const [name, fn] of [
  [
    'PCB overlapping/out-of-bounds holes',
    () =>
      new Ecad.PcbBoardGeometry({
        width: -5,
        length: NaN,
        holes: Array.from({length: 200}, (_, i) => ({
          x: i * 0.0001,
          z: 0,
          diameter: 999,
        })),
      }),
  ],
  [
    'Enclosure overlapping/huge cutouts + flanges',
    () =>
      new Ecad.EnclosureGeometry({
        part: 'base',
        flanges: true,
        panelCutouts: Array.from({length: 120}, (_, i) => ({
          face: (['front', 'back', 'left', 'right'] as const)[i % 4],
          x: (i - 60) * 0.001,
          y: -99,
          width: 999,
          height: 999,
        })),
      }),
  ],
  [
    'Heatsink excessive fins',
    () =>
      new Ecad.HeatsinkGeometry({
        finCount: 99999,
        finThickness: 999,
        taperRatio: -2,
      }),
  ],
  [
    'IC BGA excessive pins',
    () =>
      new Ecad.IcPackageGeometry({
        kind: 'bga',
        pinCount: 99999,
        pitch: -1,
      }),
  ],
  [
    'PinHeader excessive cols',
    () =>
      new Ecad.PinHeaderGeometry({
        gender: 'female',
        rows: 99,
        cols: 9999,
      }),
  ],
] as const) {
  const g = fn();
  const s = auditGeometry(g, `Adversarial fuzz: ${name}`, {
    expectWatertight: true,
    minVolume: 1e-12,
  });
  assert(
    s.vertexCount < 60000,
    `${name} stays bounded (< 60k verts, got ${s.vertexCount})`,
  );
}

// 5. Worker Function.prototype.toString() isolation + GLB & USDZ export round-trip
{
  const isolatedInstaller = new Function(
    'return (' + installElectronicsKit.toString() + ');',
  )();
  const mockReg: Record<string, unknown> = {};
  const installed = isolatedInstaller(
    {BufferGeometry, BufferAttribute, Vector3},
    mockReg,
  );
  assert(
    Boolean(
      installed?.Electronics?.PcbBoardGeometry &&
        // tslint:disable-next-line:no-any Mock registry inspection.
        (mockReg as any).authorNamespace?.Electronics && !((mockReg as any).authorNamespace?.ECAD) && !((mockReg as any).authorNamespace?.PcbBoardGeometry),
    ),
    'installElectronicsKit.toString() executes cleanly in isolated Worker realm with zero outer closures',
  );

  const scene = new Scene();
  const fr4 = new MeshStandardMaterial({color: 0x15803d, roughness: 0.45});
  const boardMesh = new Mesh(pcb, fr4);
  boardMesh.name = 'MainControllerPcb';
  scene.add(boardMesh);

  const standoffs = new InstancedMesh(hexStandoff, fr4, 4);
  standoffs.name = 'CornerStandoffs';
  const m = new Matrix4();
  for (let i = 0; i < 4; i++) {
    m.makeTranslation(i < 2 ? -0.35 : 0.35, -0.12, i % 2 === 0 ? -0.22 : 0.22);
    standoffs.setMatrixAt(i, m);
  }
  scene.add(standoffs);

  const glbBytes = scene.toGLB();
  const parsed = parseGLB(glbBytes);
  assert(
    parsed.gltf.meshes.length === 2 && glbBytes.byteLength > 1000,
    `Electronics assembly exports valid GLB (${glbBytes.byteLength} bytes, 2 meshes incl. InstancedMesh)`,
  );

  const usdzBytes = scene.toUSDZ();
  assert(
    usdzBytes[0] === 0x50 && usdzBytes[1] === 0x4b && usdzBytes.byteLength > 1000,
    `Electronics assembly exports valid Apple USDZ (${usdzBytes.byteLength} bytes)`,
  );
}

console.log(
  `\n🏆 kit-electronics Audit Results: ${passed} Passed, ${failed} Failed.`,
);
if (failed > 0) {
  process.exit(1);
}
