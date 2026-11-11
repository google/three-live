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

import * as assert from 'assert';
import {
  installArchitectureKit,
  installElectronicsKit,
  installIndustrialKit,
  installMechanicalKit,
  installScienceKit,
} from '../src/kits';
import {
  clearAuthorWarnings,
  exportSceneToGLB,
  getAuthorWarnings,
  THREE,
} from '../src/three-author';

installMechanicalKit(THREE);
installArchitectureKit(THREE);
installIndustrialKit(THREE);
installScienceKit(THREE);
installElectronicsKit(THREE);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const catalog = require('../../examples/kits/catalog-data.js') as {
  DOMAINS: Array<{
    id: string;
    namespace: string;
    title: string;
    bundle: string;
  }>;
  ITEMS: Array<{
    slug: string;
    domain: string;
    ctor: string;
    summary: string;
    orbit: {theta: number; phi: number; zoom: number};
    variants: Array<{label: string; code: string}>;
  }>;
};

async function runTests() {
  let passed = 0;
  function check(cond: unknown, msg: string) {
    assert.ok(cond, msg);
    passed++;
  }

  const expectedNamespaces = [
    'Mechanical',
    'Architecture',
    'Industrial',
    'Science',
    'Electronics',
  ] as const;

  check(
    catalog.DOMAINS.length === expectedNamespaces.length,
    `Expected ${expectedNamespaces.length} catalog domains, got ${catalog.DOMAINS.length}`,
  );

  const exportedCtors: string[] = [];
  const threeRecord = THREE as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >;
  for (const ns of expectedNamespaces) {
    const kitMod = threeRecord[ns];
    check(Boolean(kitMod), `Missing THREE.${ns} namespace`);
    for (const [key, val] of Object.entries(kitMod!)) {
      if (key.endsWith('Geometry') && typeof val === 'function') {
        exportedCtors.push(`${ns}.${key}`);
      }
    }
  }

  const domainById = new Map(catalog.DOMAINS.map((d) => [d.id, d]));
  const seenSlugs = new Set<string>();
  const catalogCtors: string[] = [];

  for (const item of catalog.ITEMS) {
    check(!seenSlugs.has(item.slug), `Duplicate catalog slug: ${item.slug}`);
    seenSlugs.add(item.slug);
    const dom = domainById.get(item.domain);
    check(Boolean(dom), `Unknown domain "${item.domain}" on ${item.slug}`);
    catalogCtors.push(`${dom!.namespace}.${item.ctor}`);
    check(item.summary.trim().length > 10, `Summary too short on ${item.slug}`);
    check(
      Number.isFinite(item.orbit?.theta) &&
        Number.isFinite(item.orbit?.phi) &&
        Number.isFinite(item.orbit?.zoom),
      `Invalid camera orbit on ${item.slug}`,
    );
    check(
      Array.isArray(item.variants) && item.variants.length >= 1,
      `No variants defined on ${item.slug}`,
    );
  }

  const missing = exportedCtors.filter((c) => !catalogCtors.includes(c));
  const extra = catalogCtors.filter((c) => !exportedCtors.includes(c));
  check(
    missing.length === 0,
    `Constructors missing from examples/kits/catalog-data.js: ${missing.join(', ')}`,
  );
  check(
    extra.length === 0,
    `Unknown constructors in examples/kits/catalog-data.js: ${extra.join(', ')}`,
  );
  check(
    exportedCtors.length === 57,
    `Expected at least 57 domain kit constructors, got ${exportedCtors.length}`,
  );

  // Compile all default snippets + at least every variant across all 57 items
  for (const item of catalog.ITEMS) {
    for (const variant of item.variants) {
      clearAuthorWarnings();
      const scene = new THREE.Scene();
      const runner = new Function('THREE', 'scene', variant.code);
      runner(THREE, scene);
      const warnings = getAuthorWarnings();
      check(
        warnings.length === 0,
        `Author warnings in ${item.slug} (${variant.label}): ${warnings.join('; ')}`,
      );
      const glb = await exportSceneToGLB(scene);
      check(
        glb instanceof Uint8Array && glb.byteLength > 200,
        `Invalid GLB output for ${item.slug} (${variant.label})`,
      );
    }
  }

  console.log(`kits_catalog_test: ${passed} assertions passed.`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
