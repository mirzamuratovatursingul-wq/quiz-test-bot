/**
 * Tahlilchini tez tekshirish: namuna faylni o'qib, natijani chop etadi.
 *   npm run check:parser -w @testrace/server -- ./samples/namuna-test.txt
 * Argument berilmasa, ichki namuna ishlatiladi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { optionLabel, parseTestText } from '@testrace/shared';
import { ROOT_DIR } from '../config.js';

const arg = process.argv[2];
const file = arg ? path.resolve(process.cwd(), arg) : path.join(ROOT_DIR, 'samples', 'namuna-test.txt');

if (!fs.existsSync(file)) {
  console.error(`Fayl topilmadi: ${file}`);
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
const result = parseTestText(text);

console.log(`\nFayl: ${file}`);
console.log(`Usul: ${result.strategy}`);
console.log(
  `Savollar: ${result.stats.total} | javobi aniq: ${result.stats.withCorrect} | tekshirish kerak: ${result.stats.needsReview}\n`,
);

result.questions.forEach((q, i) => {
  console.log(`${i + 1}. ${q.text}`);
  q.options.forEach((o, oi) => {
    console.log(`   ${oi === q.correctIndex ? '[+]' : '   '} ${optionLabel(oi)}) ${o.text}`);
  });
});

if (result.warnings.length > 0) {
  console.log('\nOgohlantirishlar:');
  for (const w of result.warnings) console.log(` - ${w.message}`);
}
