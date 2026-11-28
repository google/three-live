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
import {sceneToGLB} from '../src/three-convert';
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

// 6. Multi-material `BufferGeometry.groups` (0: frame, 1: glazing, 2: hardware) & GLB/USDZ export
{
  interface GroupedGeo {
    groups?: Array<{count: number; materialIndex?: number}>;
  }
  const sumGroups = (g: GroupedGeo): number =>
    (g.groups ?? []).reduce((acc, gr) => acc + gr.count, 0);
  const groupMats = (g: GroupedGeo): Array<number | undefined> =>
    (g.groups ?? []).map((gr) => gr.materialIndex);

  const frenchDoor = new Arch.DoorGeometry({
    style: 'french',
    operation: 'swing',
    leaves: 2,
    handle: 'lever',
    width: 1.6,
    height: 2.1,
    openFraction: 0.35,
  });
  assert(
    sumGroups(frenchDoor) === frenchDoor.index.count &&
      JSON.stringify(groupMats(frenchDoor)) === '[0,1,2]',
    'DoorGeometry (french + lever) emits contiguous groups [0: frame, 1: glass, 2: hardware] covering 100% of indices',
  );

  const halfLiteBarn = new Arch.DoorGeometry({
    style: 'half-lite',
    operation: 'barn',
    width: 1.0,
    height: 2.1,
  });
  assert(
    sumGroups(halfLiteBarn) === halfLiteBarn.index.count &&
      JSON.stringify(groupMats(halfLiteBarn)) === '[0,1,2]',
    'DoorGeometry (half-lite barn) emits groups [0, 1, 2] including track hardware',
  );

  const unglazedDoor = new Arch.DoorGeometry({
    style: 'vision-lite',
    glazing: false,
    handle: 'push-bar',
  });
  assert(
    sumGroups(unglazedDoor) === unglazedDoor.index.count &&
      JSON.stringify(groupMats(unglazedDoor)) === '[0,2]',
    'DoorGeometry (glazing: false) omits group 1 while preserving frame (0) & hardware (2)',
  );

  for (const wStyle of ['arched', 'double-hung', 'slider', 'casement'] as const) {
    const winGeo = new Arch.WindowGeometry({
      style: wStyle,
      width: 1.3,
      height: 1.5,
      openFraction: 0.4,
    });
    assert(
      sumGroups(winGeo) === winGeo.index.count &&
        JSON.stringify(groupMats(winGeo)) === '[0,1]',
      `WindowGeometry (${wStyle}) emits groups [0: frame, 1: glazing] covering 100% of indices`,
    );
  }
  const unglazedWin = new Arch.WindowGeometry({
    style: 'mullion-grid',
    glazing: false,
  });
  assert(
    JSON.stringify(groupMats(unglazedWin)) === '[0]',
    'WindowGeometry (glazing: false) emits only frame group [0]',
  );

  const panelRail = new Arch.RailingGeometry({
    style: 'panel',
    length: 3.0,
    height: 1.07,
  });
  assert(
    sumGroups(panelRail) === panelRail.index.count &&
      JSON.stringify(groupMats(panelRail)) === '[0,1]',
    'RailingGeometry (style="panel") emits groups [0: posts/rails, 1: infill panels]',
  );

  const frameMat = new MeshStandardMaterial({
    name: 'FrameWood',
    color: 0xf8fafc,
    roughness: 0.6,
  });
  const glassMat = new MeshStandardMaterial({
    name: 'ClearGlass',
    color: 0xbae6fd,
    roughness: 0.08,
    opacity: 0.32,
    transparent: true,
  });
  const hwMat = new MeshStandardMaterial({
    name: 'BrushedBrass',
    color: 0xd97706,
    metalness: 0.88,
    roughness: 0.22,
  });

  const mmScene = new Scene();
  const singleDoorMesh = new Mesh(frenchDoor, frameMat);
  singleDoorMesh.name = 'SingleMatDoor';
  mmScene.add(singleDoorMesh);

  const multiDoorMesh = new Mesh(frenchDoor, [frameMat, glassMat, hwMat]);
  multiDoorMesh.name = 'MultiMatDoor';
  mmScene.add(multiDoorMesh);

  const multiWinMesh = new Mesh(
    new Arch.WindowGeometry({style: 'arched', width: 1.2, height: 1.6}),
    [frameMat, glassMat],
  );
  multiWinMesh.name = 'MultiMatWin';
  mmScene.add(multiWinMesh);

  const multiRailMesh = new Mesh(panelRail, [hwMat, glassMat]);
  multiRailMesh.name = 'MultiMatRail';
  mmScene.add(multiRailMesh);

  const mmGlb = parseGLB(mmScene.toGLB());
  assert(
    mmGlb.gltf.meshes[0].primitives.length === 1 &&
      mmGlb.gltf.meshes[1].primitives.length === 3 &&
      mmGlb.gltf.meshes[2].primitives.length === 2 &&
      mmGlb.gltf.meshes[3].primitives.length === 2,
    'Single-material Mesh stays 1 primitive while [frameMat, glassMat, hwMat] exports 3/2/2 glTF primitives',
  );
  const glassMatIdx = mmGlb.gltf.meshes[1].primitives[1].material;
  assert(
    mmGlb.gltf.materials[glassMatIdx]?.alphaMode === 'BLEND',
    'Group-1 glazing primitive binds transparent BLEND glass material in GLB',
  );
  const mmUsdz = mmScene.toUSDZ();
  const mmUsdaText = new TextDecoder().decode(mmUsdz);
  assert(
    mmUsdaText.includes('FrameWood') &&
      mmUsdaText.includes('ClearGlass') &&
      mmUsdaText.includes('BrushedBrass'),
    'Multi-material Architecture kit assembly exports FrameWood, ClearGlass, and BrushedBrass to USDZ',
  );
}

// 7. One-way interior cutaway on `WallGeometry` (`cutaway: 'front' | 'back'`, `curbHeight`)
{
  for (const side of ['front', 'back'] as const) {
    const cutWall = new Arch.WallGeometry({
      length: 6.0,
      height: 2.8,
      thickness: 0.2,
      cutaway: side,
      curbHeight: 0.22,
      baseboardHeight: 0.1,
      corniceHeight: 0.12,
      openings: [
        {x: -1.8, y: 0.9, width: 1.1, height: 1.2, arch: 'pointed'},
        {x: 0, y: 0, width: 1.0, height: 2.1, arch: 'semicircular'},
        {x: 1.8, y: 0.15, width: 1.0, height: 1.8, arch: 'segmental'},
      ],
    });
    const pos = cutWall.getAttribute('position').array as Float32Array;
    const nrm = cutWall.getAttribute('normal').array as Float32Array;
    const idx = cutWall.index.array as Uint16Array | Uint32Array;
    const expectedInwardZ = side === 'front' ? -1 : 1;
    let upperTris = 0;
    let badUpperNormals = 0;
    let exteriorGhostVerts = 0;
    let curbTris = 0;
    let doorwayCurbViolations = 0;
    const curbHalfEdges = new Map<string, number>();
    const qKey = (vi: number) =>
      `${Math.round(pos[vi * 3] * 1e5)},${Math.round(pos[vi * 3 + 1] * 1e5)},${Math.round(pos[vi * 3 + 2] * 1e5)}`;

    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
      const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
      if (cy > 0.22 + 1e-3) {
        upperTris++;
        for (const vi of [a, b, c]) {
          if (
            Math.abs(nrm[vi * 3]) > 1e-4 ||
            Math.abs(nrm[vi * 3 + 1]) > 1e-4 ||
            nrm[vi * 3 + 2] * expectedInwardZ < 0.99
          ) {
            badUpperNormals++;
          }
          // Every kept upper-band vertex (wall + interior cornice) must sit on the kept interior Z side (`z * expectedInwardZ >= 0.09`).
          if (pos[vi * 3 + 2] * expectedInwardZ < 0.09) {
            exteriorGhostVerts++;
          }
        }
      } else {
        curbTris++;
        if (Math.abs(cx) < 0.48 && cy < 0.21) doorwayCurbViolations++;
        const ka = qKey(a);
        const kb = qKey(b);
        const kc = qKey(c);
        for (const [u, v] of [
          [ka, kb],
          [kb, kc],
          [kc, ka],
        ]) {
          const hk = `${u}->${v}`;
          curbHalfEdges.set(hk, (curbHalfEdges.get(hk) ?? 0) + 1);
        }
      }
    }
    let openCurbEdges = 0;
    for (const [hk, cnt] of curbHalfEdges.entries()) {
      const [u, v] = hk.split('->');
      if ((curbHalfEdges.get(`${v}->${u}`) ?? 0) !== cnt) openCurbEdges++;
    }
    assert(
      upperTris > 20 &&
        badUpperNormals === 0 &&
        exteriorGhostVerts === 0 &&
        curbTris >= 24 &&
        openCurbEdges === 0 &&
        doorwayCurbViolations === 0,
      `WallGeometry (cutaway="${side}", curbHeight=0.22) emits closed 2-manifold floor curb (${curbTris}t) + strictly inward-facing [0,0,${expectedInwardZ}] upper sheet (${upperTris}t, ghostZ=0)`,
      `upper=${upperTris}, badNrm=${badUpperNormals}, ghostZ=${exteriorGhostVerts}, curb=${curbTris}, openCurbHE=${openCurbEdges}, doorViol=${doorwayCurbViolations}`,
    );
  }

  const sheetOnly = new Arch.WallGeometry({
    length: 4,
    height: 2.6,
    cutaway: 'front',
    curbHeight: 0,
  });
  const sheetNrm = sheetOnly.getAttribute('normal').array as Float32Array;
  let allMinusZ = sheetNrm.length > 0;
  for (let i = 0; i < sheetNrm.length; i += 3) {
    if (sheetNrm[i + 2] > -0.99) allMinusZ = false;
  }
  assert(
    allMinusZ,
    'WallGeometry (cutaway="front", curbHeight=0) emits pure single-sided inward sheet with zero curb faces',
  );
}

// Native material groups on WallGeometry / SlabGeometry / RoofGeometry.
{
  console.log('\n--- Wall / slab / roof material groups ---');
  interface GeoGroup {
    start: number;
    count: number;
    materialIndex: number;
  }
  interface Geo {
    groups?: GeoGroup[];
    index: {array: ArrayLike<number>};
    getAttribute(name: string): {array: ArrayLike<number>};
  }
  /**
   * Checks that `geom.groups` tile the index buffer exactly once with distinct
   * material indices in `0..2`, and that `semantic(mat, n, centroid)` holds for
   * every triangle. Returns the materials present.
   */
  const auditGroups = (
    geom: Geo,
    label: string,
    semantic: (mat: number, n: number[], c: number[]) => boolean,
  ): number[] => {
    const pos = geom.getAttribute('position').array as Float32Array;
    const idx = geom.index.array as Uint16Array | Uint32Array;
    const groups = [...(geom.groups || [])].sort(
      (a: GeoGroup, b: GeoGroup) => a.start - b.start,
    );
    let cursor = 0;
    let tiled = groups.length > 0;
    const mats = new Set<number>();
    let badTris = 0;
    for (const g of groups) {
      if (g.start !== cursor || g.count % 3 !== 0 || g.count <= 0) {
        tiled = false;
      }
      if (
        mats.has(g.materialIndex) ||
        g.materialIndex < 0 ||
        g.materialIndex > 2
      ) {
        tiled = false;
      }
      mats.add(g.materialIndex);
      for (let t = g.start; t < g.start + g.count; t += 3) {
        const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
        const u = [0, 1, 2].map((k) => pos[b + k] - pos[a + k]);
        const v = [0, 1, 2].map((k) => pos[c + k] - pos[a + k]);
        const n = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
        const l = Math.hypot(n[0], n[1], n[2]);
        if (l < 1e-12) continue;
        const cen = [0, 1, 2].map(
          (k) => (pos[a + k] + pos[b + k] + pos[c + k]) / 3,
        );
        if (
          !semantic(
            g.materialIndex,
            n.map((x) => x / l),
            cen,
          )
        ) {
          badTris++;
        }
      }
      cursor += g.count;
    }
    assert(
      tiled && cursor === idx.length && badTris === 0,
      `${label}: groups cover every triangle exactly once with consistent normals`,
      `tiled=${tiled}, covered=${cursor}/${idx.length}, bad=${badTris}, groups=${JSON.stringify(groups)}`,
    );
    return [...mats].sort();
  };
  const upDown = (m: number, n: number[]) =>
    m === 0 ? n[1] > 0.02 : m === 1 ? n[1] < -0.02 : Math.abs(n[1]) <= 0.02;

  const wallOpts = {
    length: 5,
    height: 2.8,
    thickness: 0.24,
    baseboardHeight: 0.12,
    corniceHeight: 0.1,
    openings: [
      {x: -1.4, width: 0.9, height: 2.1},
      {x: 0.3, y: 0.9, width: 1.0, height: 1.2, arch: 'semicircular'},
      {x: 1.7, y: 1.0, width: 0.6, height: 1.0, arch: 'pointed'},
    ],
  };
  const semanticFor = (hT: number) => (m: number, n: number[], c: number[]) =>
    m === 0
      ? n[2] > 0.99 && Math.abs(c[2] - hT) < 3e-5
      : m === 1
        ? n[2] < -0.99 && Math.abs(c[2] + hT) < 3e-5
        : !(Math.abs(n[2]) > 0.99 && Math.abs(Math.abs(c[2]) - hT) < 3e-5);
  const wallSemantic = semanticFor(0.12);
  for (const origin of ['floor', 'center']) {
    const wall = new Arch.WallGeometry({...wallOpts, origin});
    const mats = auditGroups(
      wall,
      `WallGeometry (origin=${origin})`,
      wallSemantic,
    );
    assert(
      mats.join() === '0,1,2',
      `WallGeometry (origin=${origin}) emits front (0), back (1), and trim (2) groups`,
    );
    auditGeometry(wall, `WallGeometry grouped (origin=${origin})`, {
      expectWatertight: true,
    });
  }
  for (const side of ['front', 'back']) {
    const cut = new Arch.WallGeometry({...wallOpts, cutaway: side});
    const cutMats = auditGroups(
      cut,
      `WallGeometry (cutaway=${side})`,
      wallSemantic,
    );
    // Above the curb only the kept interior face remains.
    const pos = cut.getAttribute('position').array as Float32Array;
    const idx = cut.index.array as Uint16Array | Uint32Array;
    const removed = side === 'front' ? 0 : 1;
    const g = cut.groups.find((gr: GeoGroup) => gr.materialIndex === removed);
    let removedAboveCurb = 0;
    for (let t = g ? g.start : 0; g && t < g.start + g.count; t += 3) {
      const cy =
        (pos[idx[t] * 3 + 1] +
          pos[idx[t + 1] * 3 + 1] +
          pos[idx[t + 2] * 3 + 1]) /
        3;
      if (cy > 0.22 + 1e-3) removedAboveCurb++;
    }
    assert(
      cutMats.join() === '0,1,2' && removedAboveCurb === 0,
      `WallGeometry (cutaway=${side}) keeps group indices and only the curb on the cut side`,
    );
  }

  const slab = new Arch.SlabGeometry({
    width: 6,
    depth: 5,
    thickness: 0.25,
    openings: [
      {x: -1.2, z: 0.5, width: 1.2, depth: 2.0},
      {x: 1.6, z: -1, radius: 0.5, shape: 'circle'},
    ],
  });
  assert(
    auditGroups(slab, 'SlabGeometry', upDown).join() === '0,1,2',
    'SlabGeometry emits top (0), soffit (1), and rim + shaft (2) groups',
  );

  for (const style of [
    'gable',
    'hip',
    'shed',
    'mansard',
    'gambrel',
    'flat-parapet',
  ]) {
    for (const solid of [true, false]) {
      const roof = new Arch.RoofGeometry({style, width: 6, depth: 8, solid});
      const mats = auditGroups(
        roof,
        `RoofGeometry (${style}, solid=${solid})`,
        upDown,
      );
      assert(
        mats.join() === '0,1,2',
        `RoofGeometry (${style}, solid=${solid}) emits weather (0), soffit (1), and edge (2) groups`,
      );
    }
  }
  const square = new Arch.RoofGeometry({style: 'hip', width: 6, depth: 6});
  auditGroups(square, 'RoofGeometry (square hip)', upDown);

  // Geometric expectations (independent of the classifier predicates).
  const groupArea = (
    geo: Geo,
    mat: number,
    pick?: (n: number[]) => boolean,
  ) => {
    const pos = geo.getAttribute('position').array;
    const idx = geo.index.array;
    const g = (geo.groups || []).find((gr) => gr.materialIndex === mat);
    let area = 0;
    for (let t = g ? g.start : 0; g && t < g.start + g.count; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const u = [0, 1, 2].map((k) => pos[b + k] - pos[a + k]);
      const v = [0, 1, 2].map((k) => pos[c + k] - pos[a + k]);
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (!pick || pick(n.map((x) => x / (l || 1)))) area += l / 2;
    }
    return area;
  };
  const plainWall = new Arch.WallGeometry({
    length: 5,
    height: 2.8,
    thickness: 0.24,
    openings: [
      {x: -1.4, width: 0.9, height: 2.1},
      {x: 1.0, y: 0.9, width: 1.0, height: 1.2},
    ],
  });
  const faceArea = 5 * 2.8 - 0.9 * 2.1 - 1.0 * 1.2;
  assert(
    Math.abs(groupArea(plainWall, 0) - faceArea) < 1e-3 &&
      Math.abs(groupArea(plainWall, 1) - faceArea) < 1e-3,
    'WallGeometry front / back groups each cover length x height minus openings',
  );
  for (const o of [
    {thickness: 0.02, length: 100, baseboardHeight: 0.1},
    {thickness: 0.2, cutaway: 'front', curbHeight: 0, baseboardHeight: 0.1},
  ]) {
    auditGroups(
      new Arch.WallGeometry(o),
      `WallGeometry ${JSON.stringify(o)}`,
      semanticFor(o.thickness / 2),
    );
  }
  for (const origin of ['top', 'bottom', 'center']) {
    const s = new Arch.SlabGeometry({width: 4, depth: 3, origin});
    assert(
      Math.abs(groupArea(s, 0) - 12) < 1e-6 &&
        Math.abs(groupArea(s, 1) - 12) < 1e-6,
      `SlabGeometry (origin=${origin}) top and soffit groups each cover width x depth`,
    );
  }
  const gable = new Arch.RoofGeometry({style: 'gable', width: 6, depth: 8});
  const openGable = new Arch.RoofGeometry({style: 'gable', solid: false});
  const parapet = new Arch.RoofGeometry({
    style: 'flat-parapet',
    width: 6,
    depth: 8,
  });
  const mansard = new Arch.RoofGeometry({style: 'mansard'});
  const isZ = (n: number[]) => Math.abs(n[2]) > 0.99;
  const sloped = (n: number[]) => n[1] > 0.05 && n[1] < 0.99;
  const inner = (6 - 2 * 0.24) * (8 - 2 * 0.24);
  const down = (n: number[]) => n[1] < -0.05 && n[1] > -0.99;
  const roofChecks = [
    groupArea(gable, 2, isZ) > 1,
    groupArea(gable, 0, isZ) === 0,
    groupArea(openGable, 1, down) > 1,
    Math.abs(groupArea(parapet, 0) - (48 + (48 - inner))) < 1e-3,
    groupArea(mansard, 0, sloped) > 1,
    groupArea(
      new Arch.RoofGeometry({origin: 'center', overhang: 0, pitchDeg: 5}),
      0,
    ) > 0,
    groupArea(new Arch.RoofGeometry({pitchDeg: 75}), 0) > 0,
  ];
  assert(
    roofChecks.every(Boolean),
    'RoofGeometry: gable ends are trim, open undersides are soffit, parapet deck + coping and mansard slopes are weather',
    JSON.stringify(roofChecks),
  );

  // Export: Material[] -> one primitive per group; one material -> one
  // primitive with every index (backward compatible).
  const exportPrims = (mat: unknown) => {
    const sc = new Scene();
    sc.add(new Mesh(new Arch.WallGeometry(wallOpts), mat));
    const gltf = parseGLB(sceneToGLB(sc)).gltf;
    return gltf.meshes[0].primitives.map(
      (p: {material: number; indices: number}) =>
        [p.material, gltf.accessors[p.indices].count] as number[],
    );
  };
  const tri = [0x8b5a2b, 0xf4f1ea, 0xffffff].map(
    (c) => new MeshStandardMaterial({color: c}),
  );
  const grouped = exportPrims(tri);
  const single = exportPrims(new MeshStandardMaterial({color: 0x888888}));
  const totalIdx = new Arch.WallGeometry(wallOpts).index.count;
  assert(
    grouped.length === 3 &&
      new Set(grouped.map((p) => p[0])).size === 3 &&
      grouped.reduce((n, p) => n + p[1], 0) === totalIdx &&
      single.length === 1 &&
      single[0][1] === totalIdx,
    'WallGeometry exports 3 primitives with Material[3] and 1 primitive with a single material',
  );
  // Like three.js, groups without a material are skipped: pass all three.
  const two = exportPrims(tri.slice(0, 2));
  assert(
    two.length === 2 && two.reduce((n, p) => n + p[1], 0) < totalIdx,
    'WallGeometry with Material[2] drops the trim group (documented: pass 3 materials)',
  );
}

// Door rigs: `part` / `leafIndex`, leaf hinge metadata, and createDoorGroup.
{
  console.log('\n--- Door rig parts and leaf metadata ---');
  // tslint:disable-next-line:no-any Geometry / glTF / metadata JSON.
  type Json = any;
  const triKeys = (geo: Json): string[] => {
    const pos = geo.getAttribute('position').array as Float32Array;
    const idx = geo.index.array as Uint16Array | Uint32Array;
    const out: string[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      out.push(
        [0, 1, 2]
          .map((k) =>
            [0, 1, 2]
              .map((c) => Math.round(pos[idx[t + k] * 3 + c] * 1e4))
              .join(','),
          )
          .join('|'),
      );
    }
    return out.sort();
  };
  const leafPositions = (o: Json, i: number) =>
    new Arch.DoorGeometry({...o, part: 'leaves', leafIndex: i}).getAttribute(
      'position',
    ).array as Float32Array;
  const configs: Array<[string, Json]> = [
    ['swing left', {style: 'panel-6', hinge: 'left'}],
    [
      'swing right out',
      {style: 'vision-lite', hinge: 'right', swingDirection: 'out'},
    ],
    ['arched double', {style: 'arched', leaves: 2, width: 1.6, height: 2.4}],
    ['french double', {style: 'french', leaves: 2, width: 1.5}],
    ['bifold 4', {operation: 'bifold', leaves: 4, width: 1.8}],
    ['slider XO', {operation: 'slider', trackPattern: 'XO'}],
    ['slider OXXO', {operation: 'slider', trackPattern: 'OXXO', width: 3}],
    [
      'barn bi-parting',
      {operation: 'barn', slideSide: 'bi-parting', width: 1.6},
    ],
    ['pocket', {operation: 'pocket', slideSide: 'left'}],
    ['no frame', {includeFrame: false, origin: 'center'}],
  ];
  for (const [label, o] of configs) {
    const all = new Arch.DoorGeometry(o);
    const allDefault = new Arch.DoorGeometry({...o, part: 'all'});
    const frame = new Arch.DoorGeometry({...o, part: 'frame'});
    const leaves = new Arch.DoorGeometry({...o, part: 'leaves'});
    const info = all.userData.leaves;
    const perLeaf = info.map(
      (lf: Json) =>
        new Arch.DoorGeometry({...o, part: 'leaves', leafIndex: lf.index}),
    );
    const union = [
      ...triKeys(frame),
      ...perLeaf.flatMap((g: Json) => triKeys(g)),
    ].sort();
    assert(
      JSON.stringify(triKeys(allDefault)) === JSON.stringify(triKeys(all)) &&
        JSON.stringify(union) === JSON.stringify(triKeys(all)) &&
        triKeys(leaves).length === union.length - triKeys(frame).length &&
        all.parameters.part === undefined &&
        frame.parameters.part === 'frame',
      `DoorGeometry (${label}): frame + each leaf partition part: 'all' exactly`,
    );
    perLeaf.forEach((g: Json, i: number) =>
      auditGeometry(g, `DoorGeometry (${label}) leaf ${i}`, {
        expectWatertight: true,
      }),
    );
    if (o.includeFrame !== false) {
      auditGeometry(frame, `DoorGeometry (${label}) frame`, {
        expectWatertight: true,
      });
    }
  }
  const neg = new Arch.DoorGeometry({part: 'leaves', leafIndex: -1});
  const nan = new Arch.DoorGeometry({part: 'leaves', leafIndex: NaN});
  assert(
    neg.index.count === 0 && nan.index.count === 0,
    'DoorGeometry leafIndex -1 / NaN emits an empty geometry (not every leaf)',
  );
  const empty = new Arch.DoorGeometry({part: 'leaves', leafIndex: 3});
  assert(
    empty.index.count === 0 && empty.userData.leaves.length === 1,
    'DoorGeometry leafIndex out of range emits an empty geometry',
  );

  // Hinges sit on the jambs; arched double halves meet at the center.
  const left = new Arch.DoorGeometry({width: 0.9, hinge: 'left'}).userData
    .leaves[0];
  const right = new Arch.DoorGeometry({width: 0.9, hinge: 'right'}).userData
    .leaves[0];
  assert(
    left.motion === 'rotate' &&
      Math.abs(left.pivot[0] + 0.45) < 0.01 &&
      Math.abs(right.pivot[0] - 0.45) < 0.01 &&
      left.axis.join() === '0,1,0' &&
      Math.sign(left.openAngleDeg) === -Math.sign(right.openAngleDeg) &&
      Math.abs(left.openAngleDeg) === 85,
    'Swing leaves hinge on the left / right jamb with mirrored 85 deg opening',
  );
  const archOpts = {style: 'arched', leaves: 2, width: 1.6, height: 2.4};
  const archInfo = new Arch.DoorGeometry(archOpts).userData.leaves;
  const xs = [0, 1].map((i) => {
    const p = leafPositions(archOpts, i);
    let lo = Infinity;
    let hi = -Infinity;
    let topAtSeam = 0;
    for (let k = 0; k < p.length; k += 3) {
      lo = Math.min(lo, p[k]);
      hi = Math.max(hi, p[k]);
      if (Math.abs(p[k]) < 0.01) topAtSeam = Math.max(topAtSeam, p[k + 1]);
    }
    return {lo, hi, topAtSeam};
  });
  assert(
    archInfo[0].pivot[0] < -0.75 &&
      archInfo[1].pivot[0] > 0.75 &&
      Math.abs(xs[0].hi + 0.002) < 1e-3 &&
      Math.abs(xs[1].lo - 0.002) < 1e-3 &&
      Math.abs(xs[0].topAtSeam - xs[1].topAtSeam) < 1e-3 &&
      xs[0].topAtSeam > 2.3,
    'Arched double door: half-arch leaves hinge on opposite jambs and meet at the crown',
  );

  // Metadata reproduces the posed geometry: rotate / slide the closed leaf by
  // openAngleDeg / travel about pivot and compare with the open pose.
  const rotY = (p: Float32Array, pv: number[], degs: number) => {
    const a = (degs * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const out = new Float32Array(p.length);
    for (let k = 0; k < p.length; k += 3) {
      const x = p[k] - pv[0];
      const z = p[k + 2] - pv[2];
      out[k] = x * c + z * s + pv[0];
      out[k + 1] = p[k + 1];
      out[k + 2] = -x * s + z * c + pv[2];
    }
    return out;
  };
  const maxDiff = (a: Float32Array, b: Float32Array) =>
    a.length !== b.length
      ? Infinity
      : a.reduce((m, v, k) => Math.max(m, Math.abs(v - b[k])), 0);
  for (const o of [
    {hinge: 'right', swingDirection: 'in'},
    {leaves: 2, style: 'french', openAngleDeg: -60},
  ]) {
    const info = new Arch.DoorGeometry(o).userData.leaves;
    const ok = info.every((lf: Json) => {
      const closedP = leafPositions({...o, openAngleDeg: 0}, lf.index);
      const openP = leafPositions(
        {...o, openAngleDeg: o.openAngleDeg ?? undefined, openFraction: 1},
        lf.index,
      );
      return maxDiff(rotY(closedP, lf.pivot, lf.openAngleDeg), openP) < 1e-4;
    });
    assert(
      ok,
      `Swing pivot + openAngleDeg reproduce the open pose (${JSON.stringify(o)})`,
    );
  }
  for (const o of [
    {operation: 'barn', slideSide: 'bi-parting', width: 1.6},
    {operation: 'pocket'},
    {operation: 'slider', trackPattern: 'XO'},
  ]) {
    const info = new Arch.DoorGeometry(o).userData.leaves;
    const ok = info.every((lf: Json) => {
      const closedP = leafPositions(o, lf.index);
      const openP = leafPositions({...o, openFraction: 1}, lf.index);
      const moved = closedP.map((v, k) =>
        k % 3 === 0 && lf.motion === 'slide' ? v + lf.axis[0] * lf.travel : v,
      );
      return maxDiff(moved, openP) < 1e-4;
    });
    assert(
      ok && info.some((lf: Json) => lf.motion === 'slide'),
      `Slide axis + travel reproduce the open pose (${o.operation})`,
    );
  }
  const xxx = new Arch.DoorGeometry({
    operation: 'slider',
    trackPattern: 'XXX',
    width: 2.4,
  }).userData.leaves;
  assert(
    xxx[0].motion === 'fixed' &&
      xxx[1].motion === 'slide' &&
      xxx[2].motion === 'slide',
    'All-X slider reports its zero-travel anchor panel as fixed',
  );
  // Bifold: rotate the closed lead panel, then fold the follower about its
  // carried knuckle; this reproduces the static open pose.
  for (const o of [
    {operation: 'bifold', leaves: 2, hinge: 'right'},
    {operation: 'bifold', leaves: 4, swingDirection: 'in', thickness: 0.12},
  ]) {
    const info = new Arch.DoorGeometry(o).userData.leaves;
    const ok = info.every((lf: Json) => {
      const closedP = leafPositions(o, lf.index);
      const openP = leafPositions({...o, openFraction: 1}, lf.index);
      if (lf.parent == null) {
        return maxDiff(rotY(closedP, lf.pivot, lf.openAngleDeg), openP) < 1e-4;
      }
      const lead = info[lf.parent];
      const carried = rotY(closedP, lead.pivot, lead.openAngleDeg);
      const pv = rotY(
        new Float32Array(lf.pivot),
        lead.pivot,
        lead.openAngleDeg,
      );
      return (
        maxDiff(rotY(carried, Array.from(pv), lf.openAngleDeg), openP) < 1e-4
      );
    });
    assert(
      ok,
      `Bifold rig kinematics reproduce the open pose (${JSON.stringify(o)})`,
    );
  }
  const xo = new Arch.DoorGeometry({operation: 'slider', trackPattern: 'XO'})
    .userData.leaves;
  const bif = new Arch.DoorGeometry({operation: 'bifold', leaves: 4}).userData
    .leaves;
  assert(
    xo[0].motion === 'slide' &&
      xo[0].axis[0] === 1 &&
      xo[1].motion === 'fixed' &&
      bif.length === 4 &&
      bif[1].parent === 0 &&
      bif[3].parent === 2 &&
      Math.abs(bif[1].openAngleDeg + 2 * bif[0].openAngleDeg) < 1e-6 &&
      Math.sign(bif[0].openAngleDeg) === -Math.sign(bif[2].openAngleDeg),
    'Slider XO marks the O panel fixed; bifold followers fold against their lead panel',
  );

  // createDoorGroup: frame mesh + pivot groups with KHR_interactivity toggles.
  const rig = Arch.createDoorGroup(
    {operation: 'bifold', leaves: 4, width: 1.8, name: 'Closet'},
    [
      new MeshStandardMaterial(),
      new MeshStandardMaterial(),
      new MeshStandardMaterial(),
    ],
  );
  const names: string[] = [];
  rig.traverse((n: Json) => names.push(n.name));
  const rigScene = new Scene();
  rigScene.add(rig);
  const rigGltf = parseGLB(sceneToGLB(rigScene)).gltf;
  const graph =
    rigGltf.extensions?.KHR_interactivity?.graphs?.[0] ??
    rigGltf.extensions?.KHR_interactivity;
  const graphJson = JSON.stringify(graph || {});
  const nodeIdx = (n: string) =>
    rigGltf.nodes.findIndex((nd: Json) => nd.name === n);
  const leaf1 = nodeIdx('Closet_leaf1');
  assert(
    names.includes('Closet_frame') &&
      names.includes('Closet_leaf3_mesh') &&
      rig.children.filter((c: Json) => /_leaf\d$/.test(c.name)).length === 2 &&
      rigGltf.extensionsUsed.includes('KHR_interactivity') &&
      leaf1 >= 0 &&
      graphJson.includes(`/nodes/${leaf1}/rotation`) &&
      rigGltf.nodes.filter((n: Json) => n.extras?.interactivity).length === 2,
    'createDoorGroup (bifold 4) nests follower pivots and toggles them from the lead panel',
  );
  // Two rigs with the same name stay wired to their own follower panels.
  const twinScene = new Scene();
  for (const x of [0, 3]) {
    const r = Arch.createDoorGroup({operation: 'bifold', name: 'Twin'});
    r.position.x = x;
    twinScene.add(r);
  }
  const twinGltf = parseGLB(sceneToGLB(twinScene)).gltf;
  const twinJson = JSON.stringify(twinGltf.extensions?.KHR_interactivity ?? {});
  const followers = twinGltf.nodes
    .map((n: Json, i: number) => (n.name === 'Twin_leaf1' ? i : -1))
    .filter((i: number) => i >= 0);
  assert(
    followers.length === 2 &&
      followers.every((i: number) => twinJson.includes(`/nodes/${i}/rotation`)),
    'Same-named bifold rigs toggle their own follower panels',
  );
  const lost = Arch.createDoorGroup({operation: 'bifold', name: 'Lost'});
  lost.traverse((n: Json) => {
    if (n.name === 'Lost_leaf1') n.name = 'Renamed';
  });
  const lostScene = new Scene();
  lostScene.add(lost);
  const lostGltf = parseGLB(sceneToGLB(lostScene)).gltf;
  const leadIdx = lostGltf.nodes.findIndex(
    (n: Json) => n.name === 'Lost_leaf0',
  );
  const lostJson = JSON.stringify(lostGltf.extensions?.KHR_interactivity ?? {});
  const leadPtrs = lostJson.split(`/nodes/${leadIdx}/rotation`).length - 1;
  assert(
    leadPtrs === 2,
    `An unresolved toggleTransform target is skipped instead of moving the owner (${leadPtrs} lead pointers)`,
  );
  const swingRig = Arch.createDoorGroup({
    leaves: 2,
    style: 'arched',
    width: 1.6,
  });
  const slideRig = Arch.createDoorGroup({operation: 'barn', name: 'Barn'});
  const slideLeaf = slideRig.children.find(
    (c: Json) => c.name === 'Barn_leaf0',
  );
  const slideAct = slideLeaf?.userData.interactivity?.onSelect?.[0];
  const swingActs = swingRig.children
    .filter((c: Json) => /_leaf\d$/.test(c.name))
    .map((c: Json) => c.userData.interactivity?.onSelect?.[0]);
  assert(
    /^Door\d+$/.test(swingRig.name) &&
      swingActs.length === 2 &&
      swingActs.every(
        (a: Json) => a?.property === 'rotation' && Math.abs(a.to[1]) > 0.6,
      ) &&
      slideAct?.property === 'translation' &&
      Math.abs(slideAct.to[0] - slideLeaf.position.x) > 0.5,
    'createDoorGroup emits rotation toggles for swing leaves and translation toggles for barn leaves',
  );

  // WallGeometry baseboardSide & corniceSide (single-sided interior/exterior trim + cutaway interaction).
  {
    const baseOpts = {
      length: 4,
      height: 2.8,
      thickness: 0.2,
      baseboardHeight: 0.14,
      baseboardProjection: 0.02,
      corniceHeight: 0.12,
      corniceProjection: 0.04,
    };
    const bothW = new Arch.WallGeometry(baseOpts);
    const backW = new Arch.WallGeometry({
      ...baseOpts,
      baseboardSide: 'back',
      corniceSide: 'back',
    });
    const frontW = new Arch.WallGeometry({
      ...baseOpts,
      baseboardSide: 'front',
      corniceSide: 'front',
    });
    auditGeometry(backW, 'WallGeometry (baseboardSide=back, corniceSide=back)', {
      expectWatertight: true,
    });
    auditGeometry(
      frontW,
      'WallGeometry (baseboardSide=front, corniceSide=front)',
      {expectWatertight: true},
    );
    const zExtent = (g: Json) => {
      const p = g.getAttribute('position').array as Float32Array;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 2; i < p.length; i += 3) {
        if (p[i] < lo) lo = p[i];
        if (p[i] > hi) hi = p[i];
      }
      return [lo, hi];
    };
    const [bLo, bHi] = zExtent(backW);
    const [fLo, fHi] = zExtent(frontW);
    // Cutaway on front (+Z) with corniceSide='front' must emit zero floating cornice on the cut face.
    const cutFrontTrim = new Arch.WallGeometry({
      ...baseOpts,
      cutaway: 'front',
      curbHeight: 0.2,
      baseboardSide: 'back',
      corniceSide: 'front',
    });
    const cutPos = cutFrontTrim.getAttribute('position').array as Float32Array;
    let maxZAboveCurb = -Infinity;
    for (let i = 0; i < cutPos.length; i += 3) {
      if (cutPos[i + 1] > 0.25 && cutPos[i + 2] > maxZAboveCurb) {
        maxZAboveCurb = cutPos[i + 2];
      }
    }
    assert(
      bLo < -0.13 &&
        Math.abs(bHi - 0.1) < 1e-4 &&
        Math.abs(fLo + 0.1) < 1e-4 &&
        fHi > 0.13 &&
        backW.index.count < bothW.index.count &&
        maxZAboveCurb < 0,
      `WallGeometry baseboardSide/corniceSide place trim on requested face only and omit trim on cutaway face (backZ=[${bLo.toFixed(3)},${bHi.toFixed(3)}], cutAbove=${maxZAboveCurb.toFixed(3)})`,
    );
  }

  // RoofGeometry flat-parapet openSides: all 16 subsets stay watertight 2-manifold with correct side omission.
  {
    const dirs: Array<'n' | 's' | 'e' | 'w'> = ['n', 's', 'e', 'w'];
    const deckOnly = new Arch.RoofGeometry({
      style: 'flat-parapet',
      width: 6,
      depth: 4,
      height: 0.8,
      fasciaHeight: 0.2,
      openSides: ['north', 'south', 'east', 'west'],
    });
    const deckCenter = new Arch.RoofGeometry({
      style: 'flat-parapet',
      width: 6,
      depth: 4,
      height: 0.8,
      fasciaHeight: 0.2,
      openSides: ['n', 's', 'e', 'w'],
      origin: 'center',
    });
    for (let mask = 0; mask < 16; mask++) {
      const openSides = dirs.filter((_, i) => Boolean(mask & (1 << i)));
      const rg = new Arch.RoofGeometry({
        style: 'flat-parapet',
        width: 6,
        depth: 4,
        height: 0.8,
        fasciaHeight: 0.2,
        parapetThickness: 0.24,
        openSides,
      });
      auditGeometry(rg, `RoofGeometry flat-parapet openSides=[${openSides.join(',')}]`, {
        expectWatertight: true,
      });
      // Verify vertices above fasciaH only exist on closed sides.
      const pos = rg.getAttribute('position').array as Float32Array;
      let hasParapet = false;
      let maxParapetY = 0;
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i + 1] > 0.21) {
          hasParapet = true;
          if (pos[i + 1] > maxParapetY) maxParapetY = pos[i + 1];
        }
      }
      const expectParapet = mask !== 15;
      assert(
        hasParapet === expectParapet &&
          (!expectParapet || Math.abs(maxParapetY - 1.0) < 1e-4),
        `flat-parapet mask=${mask} (${openSides.join(',')}) parapet presence=${hasParapet}`,
      );
    }
    // Opening N (-Z) removes parapet at z = -2 while keeping S (+Z) parapet at z = +2;
    // opening E (+X) removes parapet at x = +3 while keeping W (-X) parapet at x = -3.
    const hasParapetAt = (
      geo: Json,
      pred: (cx: number, cz: number) => boolean,
    ): boolean => {
      const p = geo.getAttribute('position').array as Float32Array;
      const idx = geo.index.array as Uint16Array | Uint32Array;
      for (let t = 0; t < idx.length; t += 3) {
        const i0 = idx[t] * 3;
        const i1 = idx[t + 1] * 3;
        const i2 = idx[t + 2] * 3;
        const cy = (p[i0 + 1] + p[i1 + 1] + p[i2 + 1]) / 3;
        if (cy <= 0.4) continue;
        const cx = (p[i0] + p[i1] + p[i2]) / 3;
        const cz = (p[i0 + 2] + p[i1 + 2] + p[i2 + 2]) / 3;
        if (pred(cx, cz)) return true;
      }
      return false;
    };
    const openN = new Arch.RoofGeometry({
      style: 'flat-parapet',
      width: 6,
      depth: 4,
      height: 0.8,
      fasciaHeight: 0.2,
      openSides: ['n'],
    });
    const openE = new Arch.RoofGeometry({
      style: 'flat-parapet',
      width: 6,
      depth: 4,
      height: 0.8,
      fasciaHeight: 0.2,
      openSides: ['e'],
    });
    const hasMidNorthParapet = hasParapetAt(
      openN,
      (cx, cz) => Math.abs(cx) < 1.5 && cz < -1.5,
    );
    const hasMidSouthParapet = hasParapetAt(
      openN,
      (cx, cz) => Math.abs(cx) < 1.5 && cz > 1.5,
    );
    const hasMidEastParapet = hasParapetAt(
      openE,
      (cx, cz) => Math.abs(cz) < 1.0 && cx > 2.5,
    );
    const hasMidWestParapet = hasParapetAt(
      openE,
      (cx, cz) => Math.abs(cz) < 1.0 && cx < -2.5,
    );
    assert(
      !hasMidNorthParapet &&
        hasMidSouthParapet &&
        !hasMidEastParapet &&
        hasMidWestParapet &&
        deckOnly.index.count === 36 &&
        Math.abs(deckCenter.boundingBox.min.y + 0.1) < 1e-4 &&
        Math.abs(deckCenter.boundingBox.max.y - 0.1) < 1e-4,
      'flat-parapet openSides omits exact cardinal edges (N=-Z, S=+Z, E=+X, W=-X) and centers all-open deck cleanly',
    );
  }

  // createDoorGroup: frameMaterial / {frame, leaf}, openFraction ajar pose, and linkedLeaves.
  {
    const frameMat = new MeshStandardMaterial({color: 0xffffff});
    const leafMat = new MeshStandardMaterial({color: 0x6b4423});
    const glassMat = new MeshStandardMaterial({color: 0x88ccff});
    const hwMat = new MeshStandardMaterial({color: 0xd4af37});
    const byMap = Arch.createDoorGroup(
      {style: 'french', leaves: 2, name: 'FrenchMap'},
      {frame: frameMat, leaf: [leafMat, glassMat, hwMat]},
    );
    const byOpt = Arch.createDoorGroup(
      {style: 'panel-4', name: 'OptFrame', frameMaterial: frameMat},
      leafMat,
    );
    const frameMesh1 = byMap.children.find((c: Json) => c.name === 'FrenchMap_frame');
    const leafMesh1 = byMap.children
      .find((c: Json) => c.name === 'FrenchMap_leaf0')
      ?.children?.[0];
    const frameMesh2 = byOpt.children.find((c: Json) => c.name === 'OptFrame_frame');
    const leafMesh2 = byOpt.children
      .find((c: Json) => c.name === 'OptFrame_leaf0')
      ?.children?.[0];
    assert(
      frameMesh1?.material === frameMat &&
        Array.isArray(leafMesh1?.material) &&
        leafMesh1.material[0] === leafMat &&
        frameMesh2?.material === frameMat &&
        leafMesh2?.material === leafMat,
      'createDoorGroup supports separate frame vs leaf materials via {frame, leaf} or options.frameMaterial',
    );

    // Initial ajar pose (`openFraction: 0.35`) and mostly-open pose (`openFraction: 0.85`).
    const ajar = Arch.createDoorGroup({
      width: 0.9,
      hinge: 'left',
      openFraction: 0.35,
      openAngleDeg: 100,
      name: 'AjarDoor',
    });
    const ajarPivot = ajar.children.find((c: Json) => c.name === 'AjarDoor_leaf0');
    const ajarAct = ajarPivot?.userData.interactivity?.onSelect?.[0];
    const expectedAjarSin = Math.sin(((-35 * Math.PI) / 180) * 0.5);
    const mostlyOpen = Arch.createDoorGroup({
      width: 0.9,
      hinge: 'left',
      openFraction: 0.85,
      openAngleDeg: 100,
      name: 'OpenDoor',
    });
    const openPivot = mostlyOpen.children.find(
      (c: Json) => c.name === 'OpenDoor_leaf0',
    );
    const openAct = openPivot?.userData.interactivity?.onSelect?.[0];
    const ajarSlider = Arch.createDoorGroup({
      operation: 'barn',
      width: 1.0,
      openFraction: 0.4,
      name: 'AjarBarn',
    });
    const barnPivot = ajarSlider.children.find(
      (c: Json) => c.name === 'AjarBarn_leaf0',
    );
    const barnAct = barnPivot?.userData.interactivity?.onSelect?.[0];
    assert(
      Math.abs(ajarPivot.quaternion.y - expectedAjarSin) < 1e-4 &&
        Math.abs(ajarAct.to[1] - Math.sin((-50 * Math.PI) / 180)) < 1e-4 &&
        JSON.stringify(ajarAct.from) === JSON.stringify([0, 0, 0, 1]) &&
        JSON.stringify(openAct.to) === JSON.stringify([0, 0, 0, 1]) &&
        Math.abs(openAct.from[1] - Math.sin((-50 * Math.PI) / 180)) < 1e-4 &&
        barnPivot.position.x > 0.3 &&
        Math.abs(barnAct.from[0]) < 1e-5 &&
        barnAct.to[0] > barnPivot.position.x,
      'createDoorGroup honors initial openFraction (ajar opens fully then closes; >=0.5 closes first then opens)',
    );

    // linkedLeaves: double swing & OXXO slider share one toggle variable per leaf across all lead triggers,
    // and two identically-named linked rigs stay isolated.
    const linkedScene = new Scene();
    for (const x of [0, 4]) {
      const dbl = Arch.createDoorGroup({
        style: 'french',
        leaves: 2,
        width: 1.6,
        linkedLeaves: true,
        name: 'LinkedTwin',
      });
      dbl.position.x = x;
      linkedScene.add(dbl);
    }
    const linkedGltf = parseGLB(sceneToGLB(linkedScene)).gltf;
    const lGraph =
      linkedGltf.extensions?.KHR_interactivity?.graphs?.[0] ??
      linkedGltf.extensions?.KHR_interactivity;
    const leafNodes = linkedGltf.nodes
      .map((n: Json, i: number) => ({name: n.name, i}))
      .filter((x: Json) => /^LinkedTwin_leaf[01]$/.test(x.name));
    // 2 doors x 2 leaves = 4 leaf nodes -> 4 shared bool variables (NOT 8!), one per leaf node.
    const toggleVars = (lGraph?.variables ?? []).filter((v: Json) =>
      String(v.id).startsWith('__toggle_'),
    );
    // Every leaf node pointer appears across both triggers of its own rig.
    const lJson = JSON.stringify(lGraph || {});
    const allLeavesWired = leafNodes.every((lf: Json) =>
      lJson.includes(`/nodes/${lf.i}/rotation`),
    );
    // OXXO linked slider only links the 2 operable X leaves (fixed O panels stay non-interactive).
    const oxxo = Arch.createDoorGroup({
      operation: 'slider',
      trackPattern: 'OXXO',
      width: 3.2,
      linkedLeaves: true,
      name: 'Patio',
    });
    const oxxoTriggers = oxxo.children.filter(
      (c: Json) => c.userData?.interactivity?.onSelect,
    );
    assert(
      leafNodes.length === 4 &&
        toggleVars.length === 4 &&
        allLeavesWired &&
        oxxoTriggers.length === 2 &&
        oxxoTriggers.every(
          (c: Json) => c.userData.interactivity.onSelect.length === 2,
        ),
      `createDoorGroup linkedLeaves shares toggle state across sibling leaves, isolates same-named rigs, and skips fixed slider panels (vars=${toggleVars.length})`,
    );
  }
}

console.log(
  `\n🏆 kit-architecture Audit Results: ${passed} Passed, ${failed} Failed.`,
);
if (failed > 0) {
  process.exit(1);
}
