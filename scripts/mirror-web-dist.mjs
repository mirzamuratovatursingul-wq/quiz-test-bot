/**
 * Mini App build natijasini repo ildizidagi `dist/` ga ham nusxalaydi.
 *
 * Sababi: Vercel `vercel.json` ni Root Directory ichidan qidiradi. Agar sozlama
 * boshqacha bo'lsa, fayl o'qilmay qoladi va Vercel odatiy `dist` papkasini kutadi.
 * Shu nusxa tufayli qaysi sozlama ishlatilishidan qat'i nazar, `dist/` doimo joyida bo'ladi.
 *
 * Serverga (SERVE_WEB=true) hech qanday ta'siri yo'q — u `packages/web/dist` dan o'qiydi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'packages', 'web', 'dist');
const target = path.join(root, 'dist');

if (!fs.existsSync(source)) {
  console.error(`Mini App build topilmadi: ${source}`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

const files = fs.readdirSync(target);
console.log(`dist/ tayyor (${files.length} element): ${files.join(', ')}`);
