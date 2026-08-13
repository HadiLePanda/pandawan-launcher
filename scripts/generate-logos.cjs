#!/usr/bin/env node
/** Generate all logo assets from the Pandawan SVG source files. */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'src-tauri', 'icons');
const AVATARS_DIR = path.join(ROOT, 'public', 'avatars');

async function svgToPng(svgPath, pngPath, size = 512) {
  await sharp(svgPath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(pngPath);
  console.log(`  ${path.relative(ROOT, pngPath)} (${size}x${size})`);
}

async function pngToIco(pngPath, icoPath) {
  // sharp doesn't write ICO; use png-to-ico style manual assembly via PIL later
  // For now, just copy the 256px PNG as the ICO source and note it needs conversion
  const img = sharp(pngPath);
  const sizes = [16, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map(async (s) => ({
      size: s,
      buffer: await img.clone().resize(s, s).png().toBuffer(),
    }))
  );

  // ICO file format: ICONDIR + ICONDIRENTRY[] + image data
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(buffers.length, 4); // count

  const entries = [];
  let offset = 6 + buffers.length * 16;

  for (const { size, buffer } of buffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // data size
    entry.writeUInt32LE(offset, 12); // data offset
    entries.push(entry);
    offset += buffer.length;
  }

  const icoData = Buffer.concat([header, ...entries, ...buffers.map((b) => b.buffer)]);
  fs.writeFileSync(icoPath, icoData);
  console.log(`  ${path.relative(ROOT, icoPath)}`);
}

async function createIcns(pngPath, icnsPath) {
  // Minimal ICNS writer: embed PNG data at standard sizes
  const sizes = [
    { type: 'ic07', size: 128 },
    { type: 'ic08', size: 256 },
    { type: 'ic09', size: 512 },
    { type: 'ic10', size: 1024 },
    { type: 'ic11', size: 32 },
    { type: 'ic12', size: 64 },
    { type: 'ic13', size: 256 },
    { type: 'ic14', size: 512 },
  ];

  const blocks = [];
  let totalSize = 8;

  for (const { type, size } of sizes) {
    const buffer = await sharp(pngPath)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const blockSize = 8 + buffer.length;
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(blockSize, 4);
    blocks.push(header, buffer);
    totalSize += blockSize;
  }

  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(totalSize, 4);

  fs.writeFileSync(icnsPath, Buffer.concat([header, ...blocks]));
  console.log(`  ${path.relative(ROOT, icnsPath)}`);
}

async function main() {
  const circlePSvg = path.join(ICONS_DIR, 'logo-pandawan-circle-p.svg');
  const pandaSvg = path.join(ICONS_DIR, 'logo-pandawan-panda.svg');

  if (!fs.existsSync(circlePSvg)) {
    console.error(`Error: ${circlePSvg} not found`);
    process.exit(1);
  }
  if (!fs.existsSync(pandaSvg)) {
    console.error(`Error: ${pandaSvg} not found`);
    process.exit(1);
  }

  console.log('Generating Circle P assets...');
  const circlePng = path.join(ICONS_DIR, 'icon.png');
  await svgToPng(circlePSvg, circlePng, 512);

  // ICO
  await pngToIco(circlePng, path.join(ICONS_DIR, 'icon.ico'));

  // ICNS
  await createIcns(circlePng, path.join(ICONS_DIR, 'icon.icns'));

  // Replace master icon.svg with Circle P
  fs.copyFileSync(circlePSvg, path.join(ICONS_DIR, 'icon.svg'));
  console.log(
    `  ${path.relative(ROOT, path.join(ICONS_DIR, 'icon.svg'))} (replaced with Circle P)`
  );

  console.log('\nGenerating Panda mascot assets...');
  const pandaPng = path.join(AVATARS_DIR, 'panda-mascot.png');
  await svgToPng(pandaSvg, pandaPng, 512);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
