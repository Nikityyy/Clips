import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Clapperboard } from 'lucide-react';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lucideMarkup = renderToStaticMarkup(createElement(Clapperboard, {
  size: 640,
  color: '#F1EFE9',
  strokeWidth: 2.4,
}));
const icon = await sharp(Buffer.from(lucideMarkup)).png().toBuffer();
const render = async (size) => sharp({
  create: { width: size, height: size, channels: 4, background: '#171716' },
})
  .composite([{ input: await sharp(icon).resize(Math.round(size * 0.7)).png().toBuffer(), gravity: 'center' }])
  .png().toBuffer();
const full = await render(1024);
await writeFile(path.join(root, 'assets', 'clips.png'), full);
await writeFile(path.join(root, 'public', 'clips.png'), full);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = await Promise.all(icoSizes.map(render));
const icoHeader = Buffer.alloc(6 + 16 * icoImages.length);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoImages.length, 4);
let icoOffset = icoHeader.length;
icoImages.forEach((image, index) => {
  const entry = 6 + index * 16;
  const size = icoSizes[index];
  icoHeader[entry] = size === 256 ? 0 : size;
  icoHeader[entry + 1] = size === 256 ? 0 : size;
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(image.length, entry + 8);
  icoHeader.writeUInt32LE(icoOffset, entry + 12);
  icoOffset += image.length;
});
await writeFile(path.join(root, 'assets', 'clips.ico'), Buffer.concat([icoHeader, ...icoImages]));

const icnsFormats = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
const icnsParts = await Promise.all(icnsFormats.map(async ([type, size]) => {
  const image = await render(size);
  const part = Buffer.alloc(8 + image.length);
  part.write(type, 0, 4, 'ascii');
  part.writeUInt32BE(part.length, 4);
  image.copy(part, 8);
  return part;
}));
const icns = Buffer.alloc(8);
icns.write('icns', 0, 4, 'ascii');
icns.writeUInt32BE(8 + icnsParts.reduce((total, part) => total + part.length, 0), 4);
await writeFile(path.join(root, 'assets', 'clips.icns'), Buffer.concat([icns, ...icnsParts]));
console.log('Generated app icon assets from Lucide’s Clapperboard icon.');
