// Verification: run this to see exactly what the page will render, using the
// live manifest. Run with: node site/verify.mjs
//
// MANIFEST_URL may be set to check a different bucket; otherwise the same
// fallback the Pages Function uses is applied.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(here, 'app.js'), 'utf-8');

const MANIFEST_URL =
  process.env.MANIFEST_URL ??
  'https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev/launcher/latest.json';

console.log(`Manifest: ${MANIFEST_URL}\n`);

// Take the two pure helpers straight out of app.js so this checks the real
// grouping and labelling logic rather than a copy that can drift from it.
const body = appSource
  .slice(appSource.indexOf('function downloadsFrom'))
  .replace(/^async function load[\s\S]*$/m, '');

const { downloadsFrom } = await import(
  `data:text/javascript,${encodeURIComponent(`${body}\nexport { downloadsFrom };`)}`
);

const manifest = await fetch(MANIFEST_URL).then((response) => response.json());
const downloads = downloadsFrom(manifest);

console.log(`Version: ${manifest.version}`);
console.log(`Targets in manifest: ${Object.keys(manifest.platforms).length}`);
console.log(`Buttons the page will show: ${downloads.length}\n`);

for (const item of downloads) {
  console.log(`  ${item.platform.padEnd(8)} ${item.kind.padEnd(20)} ${item.file}`);
}

// Every button must point at something that actually downloads.
console.log('');
for (const item of downloads) {
  const head = await fetch(item.url, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length'));
  console.log(`  ${head.ok ? 'OK  ' : 'FAIL'} ${(size / 1048576).toFixed(1)} MB  ${item.file}`);
}
