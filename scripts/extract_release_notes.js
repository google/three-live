#!/usr/bin/env node
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

/**
 * Extracts the release notes section for a single version from a
 * Keep-a-Changelog `CHANGELOG.md` file (falling back to `[Unreleased]` if the
 * exact version heading has not been stamped yet).
 *
 * Usage:
 *   node scripts/extract_release_notes.js CHANGELOG.md v1.5.0
 * [release-notes.md]
 */

const fs = require('fs');

const VERSION_TAG_RE = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

/**
 * Extracts the Markdown release notes section for `rawTag` from
 * `changelogText`.
 * @param {string} changelogText Full contents of `CHANGELOG.md`.
 * @param {string} rawTag Tag or version string (e.g. `"v1.5.0"`, `"1.5.0"`, or
 *     `"Unreleased"`).
 * @return {string} Trimmed Markdown section starting with `## [...]`.
 */
function extractReleaseNotes(changelogText, rawTag) {
  const trimmedTag = String(rawTag || '').trim();
  let targetVersion;
  if (/^unreleased$/i.test(trimmedTag)) {
    targetVersion = 'Unreleased';
  } else {
    const match = VERSION_TAG_RE.exec(trimmedTag);
    if (!match) {
      throw new Error(`Invalid release tag "${
          trimmedTag}"; expected vX.Y.Z or Unreleased.`);
    }
    targetVersion = match[1];
  }

  const lines = changelogText.replace(/\r\n/g, '\n').split('\n');
  /**
   * @type {!Array<{version: string, heading: string, bodyLines:
   *     !Array<string>}>}
   */
  const sections = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = /^## \[([^\]]+)\](.*)$/.exec(line);
    if (headingMatch) {
      current = {
        version: headingMatch[1].trim(),
        heading: line.trim(),
        bodyLines: [],
      };
      sections.push(current);
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
    }
  }

  const formatSection = (sec, overrideVersion) => {
    const cleaned = sec.bodyLines.slice();
    // Trim leading/trailing blank lines and horizontal rule dividers (`----`).
    while (cleaned.length > 0 &&
           (cleaned[0].trim() === '' || /^-{3,}$/.test(cleaned[0].trim()))) {
      cleaned.shift();
    }
    while (cleaned.length > 0 &&
           (cleaned[cleaned.length - 1].trim() === '' ||
            /^-{3,}$/.test(cleaned[cleaned.length - 1].trim()))) {
      cleaned.pop();
    }
    if (cleaned.length === 0) {
      return '';
    }
    const heading =
        overrideVersion && sec.version.toLowerCase() === 'unreleased' ?
        `## [${overrideVersion}]` :
        sec.heading;
    return `${heading}\n\n${cleaned.join('\n')}\n`;
  };

  const exact = sections.find(
      (s) => s.version.toLowerCase() === targetVersion.toLowerCase());
  if (exact) {
    const rendered = formatSection(exact, '');
    if (!rendered) {
      throw new Error(`Section [${exact.version}] in CHANGELOG.md is empty.`);
    }
    return rendered;
  }

  if (targetVersion !== 'Unreleased') {
    const unreleased =
        sections.find((s) => s.version.toLowerCase() === 'unreleased');
    if (unreleased) {
      const rendered = formatSection(unreleased, targetVersion);
      if (rendered) {
        return rendered;
      }
    }
  }

  throw new Error(`Could not find non-empty section [${
      targetVersion}] (or [Unreleased]) in CHANGELOG.md.`);
}

module.exports = {extractReleaseNotes};

if (require.main === module) {
  const [changelogPath, rawTag, outputPath] = process.argv.slice(2);
  if (!changelogPath || !rawTag) {
    console.error(
        'Usage: node scripts/extract_release_notes.js <CHANGELOG.md> <tag> [output.md]');
    process.exit(1);
  }
  const changelogText = fs.readFileSync(changelogPath, 'utf8');
  const notes = extractReleaseNotes(changelogText, rawTag);
  if (outputPath) {
    fs.writeFileSync(outputPath, notes, 'utf8');
  } else {
    process.stdout.write(notes);
  }
}
