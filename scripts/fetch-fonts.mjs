/**
 * PDF va podium rasmlarida kirill hamda o'zbek lotin belgilari (o', g')
 * to'g'ri chiqishi uchun DejaVu shriftlarini yuklab oladi.
 *
 *   npm run fonts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets', 'fonts');
fs.mkdirSync(dir, { recursive: true });

const FILES = [
  {
    name: 'DejaVuSans.ttf',
    url: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf',
  },
  {
    name: 'DejaVuSans-Bold.ttf',
    url: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf',
  },
];

for (const file of FILES) {
  const target = path.join(dir, file.name);
  if (fs.existsSync(target)) {
    console.log(`= ${file.name} allaqachon bor`);
    continue;
  }
  process.stdout.write(`> ${file.name} yuklanmoqda... `);
  try {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log('OK');
  } catch (err) {
    console.log('XATO');
    console.error(
      `  ${file.name} yuklanmadi (${err.message}).\n` +
        `  Qo'lda yuklab, ${dir} papkasiga joylang: https://dejavu-fonts.github.io/`,
    );
  }
}
