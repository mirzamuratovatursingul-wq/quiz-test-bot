/**
 * Tahlilchini tez tekshirish: faylni o'qib, natijani chop etadi.
 *   npm run check:parser -w @testrace/server -- ./samples/namuna-test.txt
 *   npm run check:parser -w @testrace/server -- ./test.pdf          (PDF / DOCX ham)
 *   npm run check:parser -w @testrace/server -- ./test.pdf --no-ai  (faqat oddiy tahlilchi)
 * Argument berilmasa, ichki namuna ishlatiladi. GEMINI_API_KEY bo'lsa, bot bilan
 * bir xil oqim ishlaydi: oddiy tahlil ishonchsiz bo'lsa AI ga yuboriladi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assessParseQuality, optionLabel, parseTestText, type ParseResult } from '@testrace/shared';
import { ROOT_DIR } from '../config.js';
import { extractText } from '../services/extract.service.js';
import { importTestFile } from '../services/test-import.service.js';

const args = process.argv.slice(2);
const noAi = args.includes('--no-ai');
const arg = args.find((a) => !a.startsWith('--'));
const file = arg ? path.resolve(process.cwd(), arg) : path.join(ROOT_DIR, 'samples', 'namuna-test.txt');

if (!fs.existsSync(file)) {
  console.error(`Fayl topilmadi: ${file}`);
  process.exit(1);
}

const buffer = fs.readFileSync(file);
let result: ParseResult;
let engine = 'parser';

if (noAi) {
  const extracted = await extractText(buffer, path.basename(file));
  result = parseTestText(extracted.text);
} else {
  const imported = await importTestFile(buffer, path.basename(file));
  result = imported.result;
  engine = imported.engine;
}

const quality = assessParseQuality(result);
console.log(`\nFayl: ${file}`);
console.log(`Tahlilchi: ${engine} | usul: ${result.strategy} | sifat: ${quality.score.toFixed(2)}${quality.good ? '' : ` (${quality.reasons.join('; ')})`}`);
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
