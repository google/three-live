/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

import {extractReleaseNotes} from '../../scripts/extract_release_notes';

function findChangelogPath(): string {
  const roots = [path.dirname(process.argv[1] || ''), __dirname, process.cwd()];
  for (const start of roots) {
    let dir = start;
    for (let depth = 0; depth < 5; depth++) {
      const candidate = path.join(dir, 'CHANGELOG.md');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error('Could not locate CHANGELOG.md');
}

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

console.log('=== Starting Release Notes Extractor & CHANGELOG Tests ===');

const changelogText = fs.readFileSync(findChangelogPath(), 'utf8');

// 1. Exact v1.4.0 extraction returns only [1.4.0], excluding license header and adjacent versions.
{
  const notes140 = extractReleaseNotes(changelogText, 'v1.4.0');
  assert(
    notes140.startsWith('## [1.4.0] - 2026-11-09 (Beta)\n'),
    'Expected [1.4.0] heading at start of v1.4.0 notes',
  );
  assert(
    notes140.includes('Loop-Free Node Materials'),
    'Expected Loop-Free Node Materials in v1.4.0 notes',
  );
  assert(
    notes140.includes('Multi-Light Depth Shadow Maps'),
    'Expected Multi-Light Depth Shadow Maps in v1.4.0 notes',
  );
  assert(
    !notes140.includes('Copyright 2026 Google LLC'),
    'Release notes must not include HTML license comment',
  );
  assert(
    !notes140.includes('## [1.3.2]'),
    'v1.4.0 notes must not leak older [1.3.2] section',
  );
  assert(
    !notes140.includes('## [1.5.0]'),
    'v1.4.0 notes must not leak newer [1.5.0] section',
  );
  assert(
    !notes140.includes('Single-JS-Engine Host Integration'),
    'v1.4.0 notes must not include post-1.4.0 entries',
  );
  console.log('   [PASS] v1.4.0 extracts isolated 1.4.0 section');
}

// 2. Exact v1.5.0 extraction covers 1.5.0 additions without leaking [1.4.0].
{
  const notes150 = extractReleaseNotes(changelogText, 'v1.5.0');
  assert(
    notes150.startsWith('## [1.5.0] - 2026-11-20 (Beta)\n'),
    'Expected [1.5.0] heading at start of v1.5.0 notes',
  );
  for (const expected of [
    'Secure-by-default capability-based security',
    'Single-JS-Engine Host Integration',
    'Five A-la-Carte Parametric Domain Kits',
    'SweepGeometry',
    'LoftGeometry',
    'PatternInstancer',
    'section-plane',
    'COLOR_0',
    'BufferGeometry.groups',
    'three-live/edits',
    'tvOS 26 RealityKit',
    'TL601',
    'XRLiveRealityKitSession',
  ]) {
    assert(
      notes150.includes(expected),
      `Expected "${expected}" in [1.5.0] section`,
    );
  }
  assert(
    !notes150.includes('## [1.4.0]'),
    '[1.5.0] extraction must stop before ## [1.4.0]',
  );
  console.log('   [PASS] v1.5.0 extracts isolated 1.5.0 section cleanly');
}

// 3. Unstamped tag falls back to [Unreleased] with rewritten version heading.
{
  const syntheticChangelog = [
    '## [Unreleased]',
    '',
    '### Added',
    '- Next feature in flight',
    '',
    '---',
    '',
    '## [1.5.0] - 2026-11-20 (Beta)',
    '- Shipped',
    '',
  ].join('\n');
  const fallback = extractReleaseNotes(syntheticChangelog, 'v9.9.9-beta.1');
  assert(
    fallback.startsWith('## [9.9.9-beta.1]\n'),
    'Expected [Unreleased] fallback to stamp target version heading',
  );
  assert(
    fallback.includes('Next feature in flight'),
    'Expected [Unreleased] body in fallback notes',
  );
  assert(
    !fallback.includes('## [1.5.0]'),
    'Fallback must not leak previous release section',
  );
  console.log('   [PASS] Unstamped release tag falls back to [Unreleased]');
}

// 4. Rejects malformed tags and empty sections.
{
  let threwBadTag = false;
  try {
    extractReleaseNotes(changelogText, 'refs/heads/main');
  } catch {
    threwBadTag = true;
  }
  assert(threwBadTag, 'Expected malformed tag to throw');

  let threwEmpty = false;
  try {
    extractReleaseNotes(
      '## [Unreleased]\n\n---\n\n## [1.0.0]\n- Initial\n',
      'v2.0.0',
    );
  } catch {
    threwEmpty = true;
  }
  assert(threwEmpty, 'Expected empty [Unreleased] fallback to throw');
  console.log('   [PASS] Malformed tags and empty sections fail closed');
}

console.log('=== All Release Notes Tests Passed ===');
