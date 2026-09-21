/**
 * PDF va podium rasmini brauzersiz tekshirish:
 *   npm run check:output -w @testrace/server -- ./out
 * Natijalar ko'rsatilgan papkaga yoziladi (standart: ./out).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTestText } from '@testrace/shared';
import { ROOT_DIR } from '../config.js';
import { buildRaceReportPdf, buildTestPdf } from '../services/pdf.service.js';
import { renderPodium } from '../services/podium.service.js';

const outDir = path.resolve(process.cwd(), process.argv[2] ?? 'out');
fs.mkdirSync(outDir, { recursive: true });

const sample = fs.readFileSync(path.join(ROOT_DIR, 'samples', 'namuna-test.txt'), 'utf8');
const parsed = parseTestText(sample);

const template = {
  title: 'Matematika va tarix testi',
  subject: 'Aralash',
  questions: parsed.questions,
} as never;

const write = (name: string, data: Buffer) => {
  fs.writeFileSync(path.join(outDir, name), data);
  console.log(`${name.padEnd(24)} ${(data.length / 1024).toFixed(1)} KB`);
};

write('1-test-kalitli.pdf', await buildTestPdf(template, { withAnswerKey: true }));
write(
  '2-test-oqituvchi.pdf',
  await buildTestPdf(template, { withAnswerKey: false, markCorrectInline: true }),
);

const race = {
  templateTitle: 'Matematika va tarix testi',
  chatTitle: '7-A sinf guruhi',
  chatId: -100123,
  finishedAt: new Date(),
  timePerQuestion: 15,
  questions: parsed.questions.map((q, i) => ({
    text: q.text,
    options: q.options,
    correctIndex: q.correctIndex,
    answeredCount: 4,
    correctCount: 4 - (i % 3),
    optionCounts: q.options.map((_, oi) => (oi === q.correctIndex ? 2 : 1)),
  })),
  participants: [
    { userId: 1, firstName: 'Ozodbek', username: 'ozod', score: 1260, correct: 7, wrong: 0, missed: 0, totalTimeMs: 21000, answered: 7, place: 1 },
    { userId: 2, firstName: 'Gulnoza', username: 'gulnoza', score: 1100, correct: 6, wrong: 1, missed: 0, totalTimeMs: 28000, answered: 7, place: 2 },
    { userId: 3, firstName: 'Shohrux', username: '', score: 860, correct: 5, wrong: 2, missed: 0, totalTimeMs: 35000, answered: 7, place: 3 },
    { userId: 4, firstName: 'Malika', username: 'malika', score: 540, correct: 3, wrong: 3, missed: 1, totalTimeMs: 30000, answered: 6, place: 4 },
  ],
} as never;

write('3-musobaqa-natijalari.pdf', await buildRaceReportPdf(race));

write(
  '4-podium.png',
  await renderPodium(
    [
      { place: 1, name: 'Ozodbek', username: 'ozod', score: 1260, correct: 7, total: 7 },
      { place: 2, name: 'Gulnoza', username: 'gulnoza', score: 1100, correct: 6, total: 7 },
      { place: 3, name: 'Shohrux', score: 860, correct: 5, total: 7 },
    ],
    {
      title: 'Matematika va tarix testi',
      subtitle: '7-A sinf guruhi • 7 ta savol • 4 ishtirokchi',
    },
  ),
);

console.log(`\nNatijalar: ${outDir}`);
