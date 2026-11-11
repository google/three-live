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
  architectureKitPlugin,
  installArchitectureKit,
  MAX_ARCH_OPENINGS,
  MAX_ARCH_PICKETS,
  MAX_ARCH_SEGMENTS,
  MAX_ARCH_STEPS,
} from '../src/kit-architecture';
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

/**
 * Audits a generated BufferGeometry for:
 * 1. Finite positions, unit normals, finite UVs, and in-range indices
 * 2. Strictly positive 3D signed volume (Divergence Theorem outward CCW check)
 * 3. Geometric face-normal vs. vertex-normal alignment (`dot(fn, vn) > 0.05`)
 * 4. Watertight 2-manifold half-edge pairing check
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

console.log(
  '=== Running kit_architecture_test.ts (Architecture / AEC Kit Audit) ===',
);

// 1. Plugin registration & namespace attachment
architectureKitPlugin.onRegister?.();
// tslint:disable-next-line:no-any Dynamic kit attachment on THREE proxy prior to Stage 6 d.ts merge.
const Arch = (THREE as any).Architecture;
const regNs = getSharedRegistry().authorNamespace ?? {};
assert(
  Boolean(
    Arch &&
      Arch.WallGeometry &&
      architectureKitPlugin.name === 'kit-architecture' &&
      !('Arch' in regNs) &&
      !('WallGeometry' in regNs),
  ),
  'architectureKitPlugin attaches strictly scoped THREE.Architecture with zero aliases or root THREE leaks',
);
assert(
  MAX_ARCH_STEPS === 128 &&
    MAX_ARCH_OPENINGS === 64 &&
    MAX_ARCH_PICKETS === 256 &&
    MAX_ARCH_SEGMENTS === 128,
  'exported quota constants match THREE.Architecture limits',
);
assert(
  Object.isFrozen(Arch) && Object.isFrozen(Arch.WallGeometry.prototype),
  'THREE.Architecture and geometry prototypes are frozen against sandbox mutation',
);

// 2. IBC stair code calculator
const stairSpec = Arch.codeStairSpec(3.0, 0.178, 0.28);
assert(
  stairSpec.steps === 17 &&
    stairSpec.riserHeight <= 0.178 &&
    Math.abs(stairSpec.totalRise - 3.0) < 1e-9 &&
    Math.abs(stairSpec.totalRun - 16 * 0.28) < 1e-9 &&
    stairSpec.ibcCompliant === true,
  'codeStairSpec(3.0) computes IBC 7-11 compliant 17-riser stair layout',
);

// 3. Audit all 8 architectural geometries & sub-modes
// 3a. WallGeometry (plain, multi-opening with arched door & windows, baseboards & cornices)
const plainWall = new Arch.WallGeometry({
  length: 4.0,
  height: 2.8,
  thickness: 0.2,
});
auditGeometry(plainWall, 'WallGeometry (plain 4x2.8m)', {
  expectWatertight: true,
});

const facadeWall = new Arch.WallGeometry({
  length: 6.0,
  height: 3.2,
  thickness: 0.24,
  baseboardHeight: 0.12,
  corniceHeight: 0.14,
  openings: [
    {x: -1.8, sillHeight: 0.9, width: 1.1, height: 1.4, arch: 'pointed'},
    {x: 0, sillHeight: 0, width: 1.0, height: 2.2, arch: 'semicircular'},
    {x: 1.8, sillHeight: 0.9, width: 1.1, height: 1.4, arch: 'segmental'},
  ],
});
auditGeometry(
  facadeWall,
  'WallGeometry (6m facade + arched door + pointed/segmental windows + segmented baseboard + cornice)',
  {expectWatertight: true},
);

// 3a-2. SlabGeometry (plain + stairwell/skylight cutouts across origins)
auditGeometry(
  new Arch.SlabGeometry({
    width: 8,
    depth: 6,
    thickness: 0.22,
    openings: [
      {shape: 'rect', x: -1.8, z: 0.8, width: 1.2, depth: 2.8},
      {shape: 'circle', x: 2.0, z: -1.0, radius: 0.85},
    ],
  }),
  'SlabGeometry (8x6m floor slab + stairwell & circular skylight cutouts)',
  {expectWatertight: true},
);

// 3b. StaircaseGeometry (straight solid, straight open-stringer, l-shape R/L, u-shape R/L, spiral R/L)
auditGeometry(
  new Arch.StaircaseGeometry({
    mode: 'straight',
    rise: 2.8,
    width: 1.1,
    solid: true,
  }),
  'StaircaseGeometry (straight solid)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.StaircaseGeometry({
    mode: 'straight',
    rise: 2.8,
    width: 1.1,
    solid: false,
  }),
  'StaircaseGeometry (straight open stringers)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.StaircaseGeometry({
    mode: 'l-shape',
    turn: 'left',
    rise: 3.0,
    width: 1.05,
  }),
  'StaircaseGeometry (l-shape left-turn with landing)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.StaircaseGeometry({
    mode: 'u-shape',
    turn: 'left',
    rise: 3.0,
    width: 1.05,
  }),
  'StaircaseGeometry (u-shape left switchback)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.StaircaseGeometry({
    mode: 'spiral',
    turn: 'left',
    rise: 3.0,
    width: 0.9,
    turns: 1.25,
  }),
  'StaircaseGeometry (spiral 1.25 turns left)',
  {expectWatertight: true},
);

// 3c. RoofGeometry (gable solid & vaulted, hip rectangular & square pyramid, shed, mansard, gambrel, flat-parapet)
auditGeometry(
  new Arch.RoofGeometry({
    style: 'gable',
    width: 6,
    depth: 8,
    pitchDeg: 32,
    solid: true,
  }),
  'RoofGeometry (gable solid)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.RoofGeometry({
    style: 'gable',
    width: 6,
    depth: 8,
    pitchDeg: 32,
    solid: false,
  }),
  'RoofGeometry (gable vaulted shell)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.RoofGeometry({style: 'hip', width: 6, depth: 9, pitchDeg: 30}),
  'RoofGeometry (hip rectangular)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.RoofGeometry({style: 'hip', width: 5, depth: 5, pitchDeg: 35}),
  'RoofGeometry (hip square pyramid)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.RoofGeometry({style: 'shed', width: 5, depth: 6, pitchDeg: 18}),
  'RoofGeometry (shed mono-pitch)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.RoofGeometry({style: 'mansard', width: 6, depth: 8, height: 2.4}),
  'RoofGeometry (mansard dual-pitch)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.RoofGeometry({
    style: 'gambrel',
    width: 6,
    depth: 8,
    height: 2.6,
    solid: false,
  }),
  'RoofGeometry (gambrel vaulted barn roof)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.RoofGeometry({
    style: 'flat-parapet',
    width: 7,
    depth: 9,
    height: 0.85,
  }),
  'RoofGeometry (flat-parapet commercial roof)',
  {expectWatertight: true},
);

// 3d. DoorGeometry (all 10 leaf styles + all 5 operations + hardware & handing)
for (const style of [
  'flush',
  'panel-1',
  'panel-2',
  'panel-4',
  'panel-6',
  'vision-lite',
  'half-lite',
  'french',
  'louvered',
  'arched',
] as const) {
  auditGeometry(
    new Arch.DoorGeometry({
      style,
      width: 0.95,
      height: 2.1,
      handle:
        style === 'vision-lite'
          ? 'push-bar'
          : style === 'panel-6'
            ? 'knob'
            : 'lever',
      openAngleDeg: style === 'panel-4' ? 45 : 0,
    }),
    `DoorGeometry (swing ${style})`,
    {expectWatertight: true},
  );
}
auditGeometry(
  new Arch.DoorGeometry({
    style: 'french',
    operation: 'swing',
    leaves: 2,
    width: 1.7,
    openFraction: 0.5,
  }),
  'DoorGeometry (double French swing doors, 50% open)',
  {expectWatertight: true},
);
for (const pat of ['XO', 'OX', 'OXXO', 'XXX'] as const) {
  auditGeometry(
    new Arch.DoorGeometry({
      style: 'french',
      operation: 'slider',
      trackPattern: pat,
      width: pat === 'OXXO' ? 3.2 : 2.0,
      openFraction: 0.65,
    }),
    `DoorGeometry (patio slider ${pat}, 65% open)`,
    {expectWatertight: true},
  );
}
auditGeometry(
  new Arch.DoorGeometry({
    style: 'panel-2',
    operation: 'barn',
    slideSide: 'right',
    openFraction: 0.6,
  }),
  'DoorGeometry (exposed flat-bar rail barn door, 60% open)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.DoorGeometry({
    style: 'panel-1',
    operation: 'pocket',
    slideSide: 'left',
    openFraction: 0.5,
  }),
  'DoorGeometry (split-jamb pocket door, 50% open)',
  {expectWatertight: true},
);
auditGeometry(
  new Arch.DoorGeometry({
    style: 'louvered',
    operation: 'bifold',
    leaves: 4,
    width: 1.6,
    openFraction: 0.55,
  }),
  'DoorGeometry (4-leaf closet bifold louvered door, 55% open)',
  {expectWatertight: true},
);

// 3e. WindowGeometry (all 10 styles + OX/XO/XOX/OXXO/XXX sliders + casing)
for (const style of [
  'fixed',
  'picture',
  'single-hung',
  'double-hung',
  'slider',
  'casement',
  'awning',
  'hopper',
  'mullion-grid',
  'arched',
] as const) {
  auditGeometry(
    new Arch.WindowGeometry({
      style,
      width: 1.2,
      height: 1.5,
      openFraction: 0.5,
      topOpenFraction: style === 'double-hung' ? 0.35 : 0,
      leaves: style === 'casement' ? 2 : 1,
      casing: style === 'double-hung',
      sill: style !== 'fixed',
    }),
    `WindowGeometry (${style}, open=0.5)`,
    {expectWatertight: true},
  );
}
for (const pat of ['OX', 'XOX', 'OXO', 'OXXO', 'XXX'] as const) {
  auditGeometry(
    new Arch.WindowGeometry({
      style: 'slider',
      trackPattern: pat,
      width: 2.2,
      height: 1.3,
      openFraction: 0.7,
    }),
    `WindowGeometry (slider ${pat}, 70% open)`,
    {expectWatertight: true},
  );
}

// 3f. RailingGeometry (baluster, horizontal-bar, panel)
for (const style of ['baluster', 'horizontal-bar', 'panel'] as const) {
  auditGeometry(
    new Arch.RailingGeometry({style, length: 3.2, height: 1.07}),
    `RailingGeometry (${style})`,
    {expectWatertight: true},
  );
}

// 3g. ColumnGeometry (tuscan, doric, fluted, square-pilaster, h-column)
const doricCol = new Arch.ColumnGeometry({
  style: 'doric',
  height: 3.2,
  radius: 0.24,
});
auditGeometry(doricCol, 'ColumnGeometry (doric)', {expectWatertight: true});
for (const style of [
  'tuscan',
  'fluted',
  'square-pilaster',
  'h-column',
] as const) {
  auditGeometry(
    new Arch.ColumnGeometry({style, height: 3.0, radius: 0.22}),
    `ColumnGeometry (${style})`,
    {expectWatertight: true},
  );
}

// 3h. ArchwayGeometry (semicircular, segmental, pointed)
for (const profile of ['semicircular', 'segmental', 'pointed'] as const) {
  auditGeometry(
    new Arch.ArchwayGeometry({
      profile,
      span: 2.0,
      height: 2.8,
      keystone: true,
      impost: true,
    }),
    `ArchwayGeometry (${profile})`,
    {expectWatertight: true},
  );
}

// 4. Adversarial / degenerate parameter fuzzing
for (const [name, fn] of [
  [
    'Wall overlapping/out-of-bounds openings',
    () =>
      new Arch.WallGeometry({
        length: -5,
        height: NaN,
        openings: Array.from({length: 200}, (_, i) => ({
          x: i * 0.01 - 1,
          y: -5,
          width: 99,
          height: 99,
          arch: true,
        })),
      }),
  ],
  [
    'Staircase extreme steps & spiral radius',
    () =>
      new Arch.StaircaseGeometry({
        mode: 'spiral',
        rise: 999,
        maxRiserHeight: 0.0001,
        turns: Infinity,
        innerRadius: -2,
      }),
  ],
  [
    'Railing tiny picket spacing',
    () =>
      new Arch.RailingGeometry({
        length: 50,
        balusterSpacing: 0.0001,
        postSpacing: -1,
      }),
  ],
  [
    'Column extreme flutes & segments',
    () =>
      new Arch.ColumnGeometry({
        style: 'fluted',
        flutes: 99999,
        radialSegments: 99999,
        height: -10,
      }),
  ],
  [
    'Slab overlapping hostile openings',
    () =>
      new Arch.SlabGeometry({
        width: -5,
        depth: NaN,
        openings: Array.from({length: 120}, (_, i) => ({
          shape: i % 2 === 0 ? 'circle' : 'rect',
          x: i * 0.02 - 1,
          z: 0,
          radius: 99,
          width: 99,
          depth: 99,
        })),
      }),
  ],
  [
    'Door & Window hostile track patterns',
    () =>
      new Arch.WindowGeometry({
        style: 'slider',
        trackPattern: 'INVALID_ZZZZ_XXXXXX_OOOOOO',
        openFraction: 99,
        cols: 999,
        rows: 999,
      }),
  ],
  [
    'Wide short arched Door & double split-arch leaves',
    () =>
      new Arch.DoorGeometry({
        style: 'arched',
        operation: 'swing',
        width: 3.0,
        height: 1.2,
        openFraction: 0.35,
      }),
  ],
  [
    'Narrow 6-panel OOOOOO half-lite & louvered slider Door',
    () =>
      new Arch.DoorGeometry({
        style: 'half-lite',
        operation: 'slider',
        trackPattern: 'OOOOOO',
        width: 0.4,
        height: 1.0,
      }),
  ],
  [
    'Compact 0.4x0.4m Window with 16x16 mullion grid (fixed & arched)',
    () =>
      new Arch.WindowGeometry({
        style: 'arched',
        width: 0.4,
        height: 0.4,
        cols: 16,
        rows: 16,
      }),
  ],
  [
    'Short Railing with oversized postSize & railHeight',
    () =>
      new Arch.RailingGeometry({
        style: 'baluster',
        length: 0.3,
        height: 0.4,
        postSize: 0.3,
        railHeight: 0.2,
      }),
  ],
] as const) {
  const g = fn();
  const s = auditGeometry(g, `Adversarial fuzz: ${name}`, {
    expectWatertight: true,
    minVolume: 1e-6,
  });
  assert(
    s.vertexCount < 60000,
    `${name} stays bounded (< 60k verts, got ${s.vertexCount})`,
  );
}

// 4b. Edge-case geometry & symmetry invariants
{
  const dblArchDoor = new Arch.DoorGeometry({
    style: 'arched',
    operation: 'swing',
    leaves: 2,
    width: 1.6,
    height: 2.2,
    openFraction: 0.4,
  });
  auditGeometry(
    dblArchDoor,
    'DoorGeometry (double arched swing doors with split half-arch leaves, 40% open)',
    {expectWatertight: true},
  );

  for (const style of ['gable', 'gambrel'] as const) {
    const gVault = new Arch.RoofGeometry({
      style,
      width: 0.4,
      depth: 1.0,
      height: 1.2,
      thickness: 0.5,
      fasciaHeight: 0.04,
      overhang: 0,
      solid: false,
    });
    auditGeometry(
      gVault,
      `RoofGeometry (${style} vaulted shell with narrow span & thick shell)`,
      {expectWatertight: true},
    );
    const vp = gVault.getAttribute('position').array as Float32Array;
    // Inner left soffit foot (`vp[3]`) must stay strictly negative (< 0) without bowtie crossing.
    assert(
      vp[3] < -0.01 && vp[3] > -0.2,
      `RoofGeometry (${style} solid=false) clamps inner eave foot without self-intersection (x=${vp[3].toFixed(3)})`,
    );
  }

  for (const mode of ['straight', 'l-shape', 'u-shape', 'spiral'] as const) {
    const gStair = new Arch.StaircaseGeometry({
      mode,
      rise: 3.0,
      width: 1.0,
      origin: 'center',
    });
    const bb = gStair.boundingBox!;
    const mx = (bb.min.x + bb.max.x) * 0.5;
    const my = (bb.min.y + bb.max.y) * 0.5;
    const mz = (bb.min.z + bb.max.z) * 0.5;
    assert(
      Math.hypot(mx, my, mz) < 1e-4,
      `StaircaseGeometry (${mode}, origin="center") centers bounding box at origin`,
    );
  }

  const tuscanCol = new Arch.ColumnGeometry({
    style: 'tuscan',
    height: 3.0,
    radius: 0.22,
  });
  const tArr = tuscanCol.getAttribute('position').array as Float32Array;
  const dArr = new Arch.ColumnGeometry({
    style: 'doric',
    height: 3.0,
    radius: 0.22,
  }).getAttribute('position').array as Float32Array;
  let maxColDiff = Math.abs(tArr.length - dArr.length);
  if (maxColDiff === 0) {
    for (let i = 0; i < tArr.length; i++) {
      maxColDiff = Math.max(maxColDiff, Math.abs(tArr[i] - dArr[i]));
    }
  }
  assert(
    maxColDiff > 0.005,
    'ColumnGeometry tuscan and doric produce distinct classical molding profiles',
  );

  const wFalse = new Arch.WallGeometry({
    openings: [{x: 0, y: 0.8, width: 1.0, height: 1.2, arch: false}],
  });
  const wNone = new Arch.WallGeometry({
    openings: [{x: 0, y: 0.8, width: 1.0, height: 1.2, arch: 'none'}],
  });
  assert(
    wFalse.getAttribute('position').count ===
      wNone.getAttribute('position').count,
    'WallGeometry treats arch="none" identically to rectangular arch=false',
  );
}

// 5. Worker Function.prototype.toString() isolation + GLB & USDZ export round-trip
{
  const isolatedInstaller = new Function(
    'return (' + installArchitectureKit.toString() + ');',
  )();
  const mockReg: Record<string, unknown> = {};
  const installed = isolatedInstaller(
    {BufferGeometry, BufferAttribute, Vector3},
    mockReg,
  );
  assert(
    Boolean(
      installed?.Architecture?.WallGeometry &&
        // tslint:disable-next-line:no-any Mock registry inspection.
        (mockReg as any).authorNamespace?.Architecture &&
        !(mockReg as any).authorNamespace?.Arch &&
        !(mockReg as any).authorNamespace?.WallGeometry,
    ),
    'installArchitectureKit.toString() executes cleanly in isolated Worker realm with zero outer closures',
  );

  const scene = new Scene();
  const plaster = new MeshStandardMaterial({color: 0xf1f5f9, roughness: 0.85});
  const facadeMesh = new Mesh(facadeWall, plaster);
  facadeMesh.name = 'FacadeWall';
  scene.add(facadeMesh);

  const cols = new InstancedMesh(doricCol, plaster, 4);
  cols.name = 'Colonnade';
  const m = new Matrix4();
  for (let i = 0; i < 4; i++) {
    m.makeTranslation((i - 1.5) * 2.0, 0, 1.5);
    cols.setMatrixAt(i, m);
  }
  scene.add(cols);

  const glbBytes = scene.toGLB();
  const parsed = parseGLB(glbBytes);
  assert(
    parsed.gltf.meshes.length === 2 && glbBytes.byteLength > 1000,
    `Architectural assembly exports valid GLB (${glbBytes.byteLength} bytes, 2 meshes incl. InstancedMesh)`,
  );

  const usdzBytes = scene.toUSDZ();
  assert(
    usdzBytes[0] === 0x50 &&
      usdzBytes[1] === 0x4b &&
      usdzBytes.byteLength > 1000,
    `Architectural assembly exports valid Apple USDZ (${usdzBytes.byteLength} bytes)`,
  );
}

console.log(
  `\n🏆 kit-architecture Audit Results: ${passed} Passed, ${failed} Failed.`,
);
if (failed > 0) {
  process.exit(1);
}
