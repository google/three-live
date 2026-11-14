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
 * @fileoverview Deterministically generates:
 *   1. `examples/kits/thumbs/<thumbFile>` (all constructor & style variant
 *      480×360 Retina Studio PBR WebP thumbnails rendered via `<three-live>`
 *      WebGL2 in headless Chromium).
 *   2. `docs/kits-gallery.md` (GitHub-browsable Markdown visual catalog).
 *
 * Usage:
 *   node scripts/generate_kits_gallery.js
 *   node scripts/generate_kits_gallery.js --docs-only
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT_DIR, 'examples/kits/catalog-data.js');
const THUMBS_DIR = path.join(ROOT_DIR, 'examples/kits/thumbs');
const DOCS_MD_PATH = path.join(ROOT_DIR, 'docs/kits-gallery.md');

const catalog = require(CATALOG_PATH);

function thumbFileFor(slug, vIdx) {
  if (typeof catalog.thumbFile === 'function') {
    return catalog.thumbFile(slug, vIdx);
  }
  return (!vIdx || vIdx === 0 ? slug : `${slug}-v${vIdx}`) + '.webp';
}

function generateMarkdownDoc() {
  const totalStyles = catalog.ITEMS.reduce(
      (sum, it) => sum + it.variants.length,
      0,
  );
  const lines = [
    '<!--',
    'Copyright 2026 Google LLC',
    '',
    'Licensed under the Apache License, Version 2.0 (the "License");',
    'you may not use this file except in compliance with the License.',
    'You may obtain a copy of the License at',
    '',
    '    http://www.apache.org/licenses/LICENSE-2.0',
    '',
    'Unless required by applicable law or agreed to in writing, software',
    'distributed under the License is distributed on an "AS IS" BASIS,',
    'WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
    'See the License for the specific language governing permissions and',
    'limitations under the License.',
    '-->',
    '',
    '# Domain Kits Visual Catalog',
    '',
    `Browse all **${totalStyles} curated styles & variants** across **${
        catalog.ITEMS
            .length} watertight 2-manifold parametric geometry constructors** in the **${
        catalog.DOMAINS.length} \`three-live\` Domain Kits**.`,
    '',
    '> **Interactive 3D Inspector:** Open the [**Live Domain Kits Catalog (`examples/kits/`)**](https://google.github.io/three-live/kits/) to toggle between **All Styles** and **Constructors (57)**, search across all kits, orbit/zoom every primitive at 60 fps in `<three-live>` Studio PBR, edit `<script type="text/three">` live, and export `.glb` / `.usdz` assets.',
    '',
    '## Quick Jump',
    '',
    '| Domain Kit | Namespace | Bundle | Gzip Budget | Constructors | Visual Styles |',
    '| :--- | :--- | :--- | :---: | :---: | :---: |',
  ];

  for (const dom of catalog.DOMAINS) {
    const domItems = catalog.ITEMS.filter((it) => it.domain === dom.id);
    const styleCount = domItems.reduce((s, it) => s + it.variants.length, 0);
    const anchor = `${
        dom.title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}`;
    lines.push(
        `| [**${dom.title}**](#${anchor}) | \`THREE.${dom.namespace}\` | \`${
            dom.bundle}\` | \`${dom.budgetLabel}\` | **${
            domItems.length}** | **${styleCount}** |`,
    );
  }

  lines.push(
      '',
      '> Load all 5 domain kits together via `three-live-kits.min.js` (`< 82 KB gz`), or load individual `three-live-kit-<domain>.min.js` bundles a la carte.',
  );

  for (const dom of catalog.DOMAINS) {
    const domItems = catalog.ITEMS.filter((it) => it.domain === dom.id);
    const flatStyles = [];
    for (const item of domItems) {
      item.variants.forEach((v, vIdx) => {
        flatStyles.push({item, variant: v, vIdx});
      });
    }

    lines.push(
        '',
        '---',
        '',
        `## ${dom.title}`,
        '',
        `**Namespace:** \`THREE.${dom.namespace}\` · **Bundle:** \`${
            dom.bundle}\` (\`${dom.budgetLabel}\`) · **Constructors:** ${
            domItems.length} · **Styles:** ${flatStyles.length}`,
        '',
        dom.description,
        '',
    );

    if (dom.helpers && dom.helpers.length > 0) {
      lines.push('**Domain Helpers:**');
      for (const h of dom.helpers) {
        lines.push(`- \`${h.call}\` — ${h.summary}`);
      }
      lines.push('');
    }

    const cols = 4;
    for (let i = 0; i < flatStyles.length; i += cols) {
      const row = flatStyles.slice(i, i + cols);
      while (row.length < cols) row.push(null);

      if (i === 0) {
        lines.push(
            '| ' + row.map((_, idx) => `Style ${idx + 1}`).join(' | ') + ' |',
        );
        lines.push('| ' + row.map(() => ':---').join(' | ') + ' |');
      }

      const cells = row.map((entry) => {
        if (!entry) return ' ';
        const {item, variant, vIdx} = entry;
        const file = thumbFileFor(item.slug, vIdx);
        const cleanLabel = variant.label.replace(/\|/g, '\\|');
        return `<img src="../examples/kits/thumbs/${file}" alt="${
            dom.namespace}.${item.ctor} — ${cleanLabel}" width="210"><br>**\`${
            item.ctor}\`**<br><sub>${cleanLabel}</sub>`;
      });
      lines.push('| ' + cells.join(' | ') + ' |');
    }
  }

  lines.push('');
  fs.mkdirSync(path.dirname(DOCS_MD_PATH), {recursive: true});
  fs.writeFileSync(DOCS_MD_PATH, lines.join('\n'), 'utf8');
  console.log(
      `--> Generated ${path.relative(ROOT_DIR, DOCS_MD_PATH)} (${
          catalog.ITEMS.length} constructors, ${totalStyles} styles)`,
  );
}

function resolveChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error(
      'Could not find Chrome/Chromium binary. Set CHROME_BIN=/path/to/chrome.',
  );
}

function runChromeShard(chromeBin, tmpDir, shardIdx, shardSpecs) {
  return new Promise((resolve, reject) => {
    const harnessHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; background: #000; overflow: hidden; }
    three-live { width: 240px; height: 180px; display: block; background: transparent; }
  </style>
  <script src="./three-live.min.js"></script>
  <script src="./three-live-studio.min.js"></script>
</head>
<body>
  <three-live
    id="viewer"
    tone-mapping="aces"
    shadow-maps="pcf"
    shadow-intensity="0.48"
    shadow-softness="0.65"
    exposure="1.06"
  ></three-live>
  <script id="gallery-report" type="application/json"></script>
  <script>
  (() => {
    const specs = ${JSON.stringify(shardSpecs)};
    const el = document.getElementById('viewer');
    const W = 480;
    const H = 360;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = W;
    outCanvas.height = H;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });

    const fgCanvas = document.createElement('canvas');
    fgCanvas.width = W;
    fgCanvas.height = H;
    const fgCtx = fgCanvas.getContext('2d', { willReadFrequently: true });

    function hexToRgb(hex) {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    const srgbLut = new Float32Array(256);
    for (let c = 0; c < 256; c++) {
      const s = c / 255;
      srgbLut[c] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    function pixelLum(r, g, b) {
      return 0.2126 * srgbLut[r] + 0.7152 * srgbLut[g] + 0.0722 * srgbLut[b];
    }

    const report = [];
    for (const spec of specs) {
      try {
        const bin = atob(spec.glbB64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

        el.loadModel(u8);
        if (el.viewer) {
          el.viewer.autoRotate = false;
          el.viewer.setInitialCamera(
            spec.orbit.theta,
            spec.orbit.phi,
            undefined,
            spec.orbit.zoom
          );
          el.jumpCameraToGoal();
          for (let f = 0; f < 5; f++) {
            el.viewer.update?.(0.016);
            el.viewer.render?.();
          }
        }

        fgCtx.clearRect(0, 0, W, H);
        el.viewer?.render?.();
        fgCtx.drawImage(el.canvas, 0, 0, W, H);
        const fgData = fgCtx.getImageData(0, 0, W, H).data;
        let fgPixels = 0;
        for (let i = 3; i < fgData.length; i += 4) {
          if (fgData[i] > 12) fgPixels++;
        }

        const [ar, ag, ab] = hexToRgb(spec.accent);
        const bgGrad = outCtx.createRadialGradient(
          W * 0.5, H * 0.44, 18,
          W * 0.5, H * 0.52, W * 0.68
        );
        bgGrad.addColorStop(0, '#172542');
        bgGrad.addColorStop(0.58, '#0d1629');
        bgGrad.addColorStop(1, '#070b14');
        outCtx.fillStyle = bgGrad;
        outCtx.fillRect(0, 0, W, H);

        const accentGrad = outCtx.createRadialGradient(
          W * 0.5, H * 0.42, 8,
          W * 0.5, H * 0.42, W * 0.46
        );
        accentGrad.addColorStop(0, 'rgba(' + ar + ',' + ag + ',' + ab + ',0.13)');
        accentGrad.addColorStop(1, 'rgba(' + ar + ',' + ag + ',' + ab + ',0)');
        outCtx.fillStyle = accentGrad;
        outCtx.fillRect(0, 0, W, H);

        const bgData = outCtx.getImageData(0, 0, W, H).data;

        el.viewer?.render?.();
        outCtx.drawImage(el.canvas, 0, 0, W, H);
        const compData = outCtx.getImageData(0, 0, W, H).data;

        let fgLumSum = 0;
        let bgLumSum = 0;
        let opaqueCount = 0;
        const fgLums = [];
        for (let i = 0; i < fgData.length; i += 4) {
          if (fgData[i + 3] > 160) {
            const fl = pixelLum(compData[i], compData[i + 1], compData[i + 2]);
            const bl = pixelLum(bgData[i], bgData[i + 1], bgData[i + 2]);
            fgLumSum += fl;
            bgLumSum += bl;
            fgLums.push(fl);
            opaqueCount++;
          }
        }
        fgLums.sort((a, b) => a - b);
        const meanFgLum = opaqueCount > 0 ? fgLumSum / opaqueCount : 0;
        const meanBgLum = opaqueCount > 0 ? bgLumSum / opaqueCount : 0.012;
        const p75FgLum = fgLums.length > 0 ? fgLums[Math.floor(fgLums.length * 0.75)] : 0;
        const contrastRatio = +(
          (Math.max(meanFgLum, meanBgLum) + 0.05) /
          (Math.min(meanFgLum, meanBgLum) + 0.05)
        ).toFixed(2);
        const litContrastRatio = +(
          (Math.max(p75FgLum, meanBgLum) + 0.05) /
          (Math.min(p75FgLum, meanBgLum) + 0.05)
        ).toFixed(2);

        const dataUrl = outCanvas.toDataURL('image/webp', 0.85);
        report.push({
          file: spec.file,
          fgCoverage: +((fgPixels / (W * H)) * 100).toFixed(1),
          contrastRatio,
          litContrastRatio,
          webpB64: dataUrl.split(',')[1],
        });
      } catch (err) {
        report.push({
          file: spec.file,
          error: String((err && err.message) || err),
        });
      }
    }

    document.getElementById('gallery-report').textContent = JSON.stringify(report);
  })();
  </script>
</body>
</html>`;

    const htmlPath = path.join(tmpDir, `harness-${shardIdx}.html`);
    fs.writeFileSync(htmlPath, harnessHtml, 'utf8');

    const child = spawn(
        chromeBin,
        [
          '--headless=new',
          '--no-sandbox',
          '--no-first-run',
          '--disable-extensions',
          '--disable-component-extensions-with-background-pages',
          '--disable-background-networking',
          '--allow-file-access-from-files',
          '--use-gl=angle',
          '--use-angle=swiftshader-webgl',
          '--enable-unsafe-swiftshader',
          '--enable-webgl',
          '--ignore-gpu-blocklist',
          '--force-device-scale-factor=2',
          '--window-size=600,500',
          '--dump-dom',
          `file://${htmlPath}`,
        ],
        {stdio: ['ignore', 'pipe', 'ignore']},
    );

    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Chrome shard ${shardIdx} exited with code ${code}`));
        return;
      }
      const domOut = Buffer.concat(chunks).toString('utf8');
      const match = domOut.match(
          /<script id="gallery-report" type="application\/json">([\s\S]*?)<\/script>/,
      );
      if (!match || !match[1]) {
        reject(
            new Error(
                `Failed to extract gallery-report JSON from Chrome shard ${
                    shardIdx}`,
                ),
        );
        return;
      }
      resolve(JSON.parse(match[1]));
    });
  });
}

async function renderThumbnails() {
  const author =
      require(path.join(ROOT_DIR, 'three-live/dist/three-author.cjs'));
  const kits =
      require(path.join(ROOT_DIR, 'three-live/dist/three-live-kits.cjs'));
  kits.installMechanicalKit(author.THREE);
  kits.installArchitectureKit(author.THREE);
  kits.installIndustrialKit(author.THREE);
  kits.installScienceKit(author.THREE);
  kits.installElectronicsKit(author.THREE);

  const domainAccents = Object.fromEntries(
      catalog.DOMAINS.map((d) => [d.id, d.accent]),
  );

  const renderSpecs = [];
  for (const item of catalog.ITEMS) {
    for (let vIdx = 0; vIdx < item.variants.length; vIdx++) {
      const variant = item.variants[vIdx];
      const scene = new author.THREE.Scene();
      const runner = new Function('THREE', 'scene', variant.code);
      runner(author.THREE, scene);
      const glb = await author.exportSceneToGLB(scene);
      const glbB64 = Buffer
                         .from(
                             glb.buffer,
                             glb.byteOffset,
                             glb.byteLength,
                             )
                         .toString('base64');
      renderSpecs.push({
        file: thumbFileFor(item.slug, vIdx),
        slug: item.slug,
        vIdx,
        label: variant.label,
        accent: domainAccents[item.domain] || '#38bdf8',
        orbit: variant.orbit || item.orbit,
        glbB64,
      });
    }
  }

  console.log(
      `--> Pre-compiled ${renderSpecs.length} scenes across ${
          catalog.ITEMS.length} constructors to GLB.`,
  );

  fs.mkdirSync(THUMBS_DIR, {recursive: true});
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-kits-gallery-'));

  try {
    fs.copyFileSync(
        path.join(ROOT_DIR, 'three-live/dist/three-live.min.js'),
        path.join(tmpDir, 'three-live.min.js'),
    );
    fs.copyFileSync(
        path.join(ROOT_DIR, 'three-live/dist/three-live-studio.min.js'),
        path.join(tmpDir, 'three-live-studio.min.js'),
    );

    const shardCount = 4;
    const shardSize = Math.ceil(renderSpecs.length / shardCount);
    const shards = [];
    for (let s = 0; s < shardCount; s++) {
      const slice = renderSpecs.slice(s * shardSize, (s + 1) * shardSize);
      if (slice.length > 0) shards.push(slice);
    }

    const chromeBin = resolveChromeBinary();
    console.log(
        `--> Rendering ${
            renderSpecs.length} Studio PBR 480×360 WebP thumbnails across ${
            shards.length} parallel Chrome shards...`,
    );
    const t0 = Date.now();
    const shardReports = await Promise.all(
        shards.map(
            (slice, idx) => runChromeShard(chromeBin, tmpDir, idx, slice)),
    );
    const report = shardReports.flat();

    let totalBytes = 0;
    let minContrast = Infinity;
    let minContrastFile = '';
    const problems = [];
    for (const entry of report) {
      if (entry.error) {
        problems.push(`${entry.file}: ${entry.error}`);
        continue;
      }
      const webpBuf = Buffer.from(entry.webpB64, 'base64');
      fs.writeFileSync(path.join(THUMBS_DIR, entry.file), webpBuf);
      totalBytes += webpBuf.length;
      if (entry.fgCoverage < 0.8) {
        problems.push(
            `${entry.file}: low foreground pixel coverage (${
                entry.fgCoverage}%)`,
        );
      }
      if (entry.contrastRatio < minContrast) {
        minContrast = entry.contrastRatio;
        minContrastFile = entry.file;
      }
      if (entry.contrastRatio < 3.0) {
        problems.push(
            `${entry.file}: WCAG 2.1 AA non-text contrast failure (${
                entry.contrastRatio}:1 mean, ${
                entry.litContrastRatio}:1 p75 < 3.0:1)`,
        );
      }
    }

    console.log(
        `--> Rendered ${report.length} Retina WebP thumbnails in ${
            ((Date.now() - t0) / 1000).toFixed(1)}s — total ${
            (totalBytes / 1024).toFixed(1)} KB (avg ${
            (totalBytes / 1024 / report.length)
                .toFixed(1)} KB), min WCAG contrast ${minContrast}:1 (${
            minContrastFile})`,
    );

    if (problems.length > 0) {
      console.error('Thumbnail verification issues:');
      for (const p of problems) console.error('  -', p);
      process.exit(1);
    }
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
}

async function main() {
  generateMarkdownDoc();
  if (!process.argv.includes('--docs-only')) {
    await renderThumbnails();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
