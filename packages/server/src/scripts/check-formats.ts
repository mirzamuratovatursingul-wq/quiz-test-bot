/**
 * Tahlilchini turli test formatlarida tekshirish (regressiya testi).
 *   npm run check:formats -w @testrace/server
 * Har bir namunada savol matni, variantlar va to'g'ri javob aniq solishtiriladi.
 */
import { assessParseQuality, parseTestText, type Question } from '@testrace/shared';

type Expected = [text: string, options: string[], correct: number];

interface Case {
  name: string;
  input: string;
  expected: Expected[];
}

const CASES: Case[] = [
  {
    name: 'Oddiy: raqam + harf + "+"',
    input: `Matematika testi
7-sinf

1. Poytaxt qaysi shahar?
+A) Toshkent
B) Samarqand
C) Buxoro
D) Xiva
2. 7 × 8 = ?
A) 54
B) 48
+C) 56
D) 64`,
    expected: [
      ['Poytaxt qaysi shahar?', ['Toshkent', 'Samarqand', 'Buxoro', 'Xiva'], 0],
      ['7 × 8 = ?', ['54', '48', '56', '64'], 2],
    ],
  },
  {
    name: 'PDF: uzun variant keyingi qatorga oʻtib ketgan (asosiy xato)',
    input: `1. Eng katta okean qaysi?
A) Atlantika okeani va unga tutash
boʻlgan barcha dengizlar hududi
+B) Tinch okeani
C) Hind okeani
D) Shimoliy Muz okeani
2. Suvning formulasi?
+A) H2O
B) CO2
C) O2
D) NaCl`,
    expected: [
      [
        'Eng katta okean qaysi?',
        ['Atlantika okeani va unga tutash boʻlgan barcha dengizlar hududi', 'Tinch okeani', 'Hind okeani', 'Shimoliy Muz okeani'],
        1,
      ],
      ['Suvning formulasi?', ['H2O', 'CO2', 'O2', 'NaCl'], 0],
    ],
  },
  {
    name: 'PDF: uzun savol bir necha qatorda, katta harf bilan davom etadi',
    input: `1. Quyidagi shaharlardan qaysi biri
Oʻzbekiston Respublikasining
Poytaxti hisoblanadi
+A) Toshkent
B) Samarqand
2. Qaysi biri sut emizuvchi?
A) Timsoh
+B) Delfin`,
    expected: [
      ['Quyidagi shaharlardan qaysi biri Oʻzbekiston Respublikasining Poytaxti hisoblanadi', ['Toshkent', 'Samarqand'], 0],
      ['Qaysi biri sut emizuvchi?', ['Timsoh', 'Delfin'], 1],
    ],
  },
  {
    name: 'Bir qatorda bir nechta variant',
    input: `1. 5 + 7 = ?
A) 10   +B) 12   C) 14   D) 16
2. 3 × 3 = ?
A) 6 B) 8 +C) 9 D) 12`,
    expected: [
      ['5 + 7 = ?', ['10', '12', '14', '16'], 1],
      ['3 × 3 = ?', ['6', '8', '9', '12'], 2],
    ],
  },
  {
    name: 'PDF: variantlar bo\'shliqsiz yopishib chiqqan, ikki qatorga bo\'lingan',
    input: `1. 2 + 2 = ?
A)3 +B)4
C)5 D)6
2. 10 - 3 = ?
+A)7B)8C)9D)6`,
    expected: [
      ['2 + 2 = ?', ['3', '4', '5', '6'], 1],
      ['10 - 3 = ?', ['7', '8', '9', '6'], 0],
    ],
  },
  {
    name: 'Savol va variantlar bitta qatorda',
    input: `1. Oy nima? A) Sayyora +B) Yoʻldosh C) Yulduz
2. Quyosh nima? +A) Yulduz B) Sayyora C) Kometa`,
    expected: [
      ['Oy nima?', ['Sayyora', 'Yoʻldosh', 'Yulduz'], 1],
      ['Quyosh nima?', ['Yulduz', 'Sayyora', 'Kometa'], 0],
    ],
  },
  {
    name: 'Harfsiz variantlar ("+" toʻgʻrisini bildiradi)',
    input: `1. Poytaxt qaysi?
+Toshkent
Samarqand shahri tarixiy markaz
Buxoro
2. Eng uzun daryo qaysi?
Amudaryo
+Nil daryosi Afrikada
Volga`,
    expected: [
      ['Poytaxt qaysi?', ['Toshkent', 'Samarqand shahri tarixiy markaz', 'Buxoro'], 0],
      ['Eng uzun daryo qaysi?', ['Amudaryo', 'Nil daryosi Afrikada', 'Volga'], 1],
    ],
  },
  {
    name: 'Raqamsiz savollar, qisqa savol matni',
    input: `Poytaxt nima
+A) Toshkent
B) Samarqand
Yil fasli
A) Dushanba
+B) Bahor
Rang
+A) Qizil
B) Olma`,
    expected: [
      ['Poytaxt nima', ['Toshkent', 'Samarqand'], 0],
      ['Yil fasli', ['Dushanba', 'Bahor'], 1],
      ['Rang', ['Qizil', 'Olma'], 0],
    ],
  },
  {
    name: 'Raqamli variantlar 1) 2) 3) savollar 1. 2.',
    input: `1. Poytaxt?
1) Samarqand
+2) Toshkent
3) Buxoro
2. Daryo?
+1) Amudaryo
2) Tinch
3) Everest`,
    expected: [
      ['Poytaxt?', ['Samarqand', 'Toshkent', 'Buxoro'], 1],
      ['Daryo?', ['Amudaryo', 'Tinch', 'Everest'], 0],
    ],
  },
  {
    name: '"A. Navoiy" bilan boshlangan savol (variant emas)',
    input: `1. A. Navoiy qaysi asar muallifi?
+A. Xamsa
B. Oʻtkan kunlar
C. Kecha va kunduz
2. A. Qodiriy qaysi asar muallifi?
A. Xamsa
+B. Oʻtkan kunlar
C. Boburnoma`,
    expected: [
      ['A. Navoiy qaysi asar muallifi?', ['Xamsa', 'Oʻtkan kunlar', 'Kecha va kunduz'], 0],
      ['A. Qodiriy qaysi asar muallifi?', ['Xamsa', 'Oʻtkan kunlar', 'Boburnoma'], 1],
    ],
  },
  {
    name: '"1-savol." raqamlash va "Javob: B" savol ostida',
    input: `1-savol. Eng baland togʻ?
A) Everest
B) Elbrus
Javob: A
2-savol. Eng katta materik?
A) Afrika
B) Yevroosiyo
Javob: B`,
    expected: [
      ['Eng baland togʻ?', ['Everest', 'Elbrus'], 0],
      ['Eng katta materik?', ['Afrika', 'Yevroosiyo'], 1],
    ],
  },
  {
    name: 'Oxirida kalit — sarlavhasiz',
    input: `1. Bir?
A) a1
B) b1
2. Ikki?
A) a2
B) b2
3. Uch?
A) a3
B) b3

1-B 2-A 3-B`,
    expected: [
      ['Bir?', ['a1', 'b1'], 1],
      ['Ikki?', ['a2', 'b2'], 0],
      ['Uch?', ['a3', 'b3'], 1],
    ],
  },
  {
    name: 'Oxirida kalit — jadval koʻrinishida',
    input: `1. Bir?
A) x
B) y
2. Ikki?
A) x
B) y
3. Uch?
A) x
B) y
Javoblar kaliti
1 2 3
B A B`,
    expected: [
      ['Bir?', ['x', 'y'], 1],
      ['Ikki?', ['x', 'y'], 0],
      ['Uch?', ['x', 'y'], 1],
    ],
  },
  {
    name: 'Kirill: А) Б) В) Г) va kalit "2-В"',
    input: `1. Столица России?
+А) Москва
Б) Казань
В) Сочи
2. Сколько будет 2+2?
А) 3
Б) 5
В) 4
Ответы:
2-В`,
    expected: [
      ['Столица России?', ['Москва', 'Казань', 'Сочи'], 0],
      ['Сколько будет 2+2?', ['3', '5', '4'], 2],
    ],
  },
  {
    name: 'HEMIS formati (++++ / ==== / #)',
    input: `++++
Poytaxt qaysi?
====
#Toshkent
====
Samarqand
====
Buxoro
++++
Eng katta okean?
====
Hind
====
#Tinch
====
Atlantika
++++`,
    expected: [
      ['Poytaxt qaysi?', ['Toshkent', 'Samarqand', 'Buxoro'], 0],
      ['Eng katta okean?', ['Hind', 'Tinch', 'Atlantika'], 1],
    ],
  },
  {
    name: 'S: / +: / -: formati',
    input: `S: Poytaxt qaysi?
+: Toshkent
-: Samarqand
-: Buxoro
S: Eng katta okean?
-: Hind
+: Tinch`,
    expected: [
      ['Poytaxt qaysi?', ['Toshkent', 'Samarqand', 'Buxoro'], 0],
      ['Eng katta okean?', ['Hind', 'Tinch'], 1],
    ],
  },
  {
    name: '? / + / - formati',
    input: `? Poytaxt qaysi?
+ Toshkent
- Samarqand
? Eng katta okean?
- Hind
+ Tinch
- Atlantika`,
    expected: [
      ['Poytaxt qaysi?', ['Toshkent', 'Samarqand'], 0],
      ['Eng katta okean?', ['Hind', 'Tinch', 'Atlantika'], 1],
    ],
  },
  {
    name: 'Raqamli savol, variantlar "+" va "-" bilan',
    input: `1. Poytaxt qaysi?
+ Toshkent
- Samarqand
- Buxoro
2. Eng katta okean?
- Hind
+ Tinch okeani, dunyodagi eng
chuqur okean`,
    expected: [
      ['Poytaxt qaysi?', ['Toshkent', 'Samarqand', 'Buxoro'], 0],
      ['Eng katta okean?', ['Hind', 'Tinch okeani, dunyodagi eng chuqur okean'], 1],
    ],
  },
  {
    name: '<question> / <variant> formati',
    input: `<question>Poytaxt qaysi?
<variant>+Toshkent
<variant>Samarqand
<question>Eng katta okean?
<variant>Hind
<variant>+Tinch`,
    expected: [
      ['Poytaxt qaysi?', ['Toshkent', 'Samarqand'], 0],
      ['Eng katta okean?', ['Hind', 'Tinch'], 1],
    ],
  },
  {
    name: '"+" alohida qatorda (PDF)',
    input: `1. Poytaxt?
+
A) Toshkent
B) Samarqand
2. Okean?
A) Hind
+
B) Tinch`,
    expected: [
      ['Poytaxt?', ['Toshkent', 'Samarqand'], 0],
      ['Okean?', ['Hind', 'Tinch'], 1],
    ],
  },
  {
    name: 'Ikki boʻlim, raqamlash qaytadan boshlanadi; sahifa raqami orada',
    input: `1-variant
1. Bir?
+A) a
B) b
2. Ikki?
A) a
+B) b
3. Uch?
+A) a
B) b
12
2-variant
1. Toʻrt?
A) a
+B) b
2. Besh?
+A) a
B) b`,
    expected: [
      ['Bir?', ['a', 'b'], 0],
      ['Ikki?', ['a', 'b'], 1],
      ['Uch?', ['a', 'b'], 0],
      ['Toʻrt?', ['a', 'b'], 1],
      ['Besh?', ['a', 'b'], 0],
    ],
  },
  {
    name: 'Harfsiz raqamli variantlar (matematika)',
    input: `1. 6 × 8 = ?
+48
54
56
2. 9 × 9 = ?
72
+81
90`,
    expected: [
      ['6 × 8 = ?', ['48', '54', '56'], 0],
      ['9 × 9 = ?', ['72', '81', '90'], 1],
    ],
  },
];

let failed = 0;

function same(q: Question | undefined, e: Expected): string | null {
  if (!q) return 'savol topilmadi';
  if (q.text !== e[0]) return `matn: "${q.text}" ≠ "${e[0]}"`;
  const opts = q.options.map((o) => o.text);
  if (JSON.stringify(opts) !== JSON.stringify(e[1])) return `variantlar: ${JSON.stringify(opts)} ≠ ${JSON.stringify(e[1])}`;
  if (q.correctIndex !== e[2]) return `toʻgʻri javob: ${q.correctIndex} ≠ ${e[2]}`;
  return null;
}

for (const c of CASES) {
  const r = parseTestText(c.input);
  const errors: string[] = [];
  if (r.questions.length !== c.expected.length) {
    errors.push(`savollar soni: ${r.questions.length} ≠ ${c.expected.length}`);
  }
  c.expected.forEach((e, i) => {
    const err = same(r.questions[i], e);
    if (err) errors.push(`${i + 1}-savol: ${err}`);
  });
  if (errors.length === 0 && !assessParseQuality(r).good) errors.push('sifat bahosi "yaxshi" emas');

  if (errors.length === 0) {
    console.log(`  ✓ ${c.name}`);
  } else {
    failed++;
    console.log(`  ✗ ${c.name}`);
    for (const e of errors) console.log(`      ${e}`);
  }
}

/* ---------------- Haqiqiy PDF: yaratish -> pdf-parse -> tahlil ---------------- */

console.log('\nPDF orqali (pdf-parse chiqishi bilan):');

const PDF_EXPECTED: Expected[] = [
  [
    'Oʻzbekiston Respublikasining birinchi Konstitutsiyasi qaysi yilda qabul qilingan va u nechta moddadan iborat boʻlgan?',
    [
      '1991-yil, 120 ta modda',
      '1992-yil 8-dekabrda qabul qilingan, dastlab 128 ta moddadan iborat boʻlgan',
      '1993-yil, 100 ta modda',
      '1995-yil, 150 ta modda',
    ],
    1,
  ],
  ['5 + 7 = ?', ['10', '12', '14', '16'], 1],
  ['Suvning kimyoviy formulasi?', ['H2O', 'CO2', 'O2', 'NaCl'], 0],
];

async function buildTrickyPdf(): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { config } = await import('../config.js');
  const doc = new PDFDocument({ size: 'A5', margin: 40 });
  const font = path.join(config.fontsDir, 'DejaVuSans.ttf');
  if (fs.existsSync(font)) doc.font(font);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const width = 260; // tor ustun: uzun savol va variantlar bir necha qatorga bo'linadi
  doc.fontSize(14).text('Huquq asoslari — yakuniy test', { width });
  doc.fontSize(10).moveDown();
  doc.text(PDF_EXPECTED[0]![0].replace(/^/, '1. '), { width });
  doc.text(`A) ${PDF_EXPECTED[0]![1][0]}`, { width });
  doc.text(`+B) ${PDF_EXPECTED[0]![1][1]}`, { width });
  doc.text(`C) ${PDF_EXPECTED[0]![1][2]}`, { width });
  doc.text(`D) ${PDF_EXPECTED[0]![1][3]}`, { width });
  doc.moveDown(0.5);
  doc.text('2. 5 + 7 = ?', { width });
  doc.text('A) 10      +B) 12      C) 14      D) 16', { width });
  doc.moveDown(0.5);
  doc.text('3. Suvning kimyoviy formulasi?', { width });
  // Har bir variant alohida matn bo'lagi, bir qatorda (pdf-parse bo'shliqsiz yopishtirishi mumkin)
  const y = doc.y;
  ['+A) H2O', 'B) CO2', 'C) O2', 'D) NaCl'].forEach((t, i) => doc.text(t, 40 + i * 65, y, { lineBreak: false }));
  doc.text('', 40, y + 16);
  doc.text('12', { width, align: 'center' });
  doc.end();
  return done;
}

try {
  const { extractText } = await import('../services/extract.service.js');
  const pdf = await buildTrickyPdf();
  const extracted = await extractText(pdf, 'test.pdf');
  const r = parseTestText(extracted.text);
  const errors: string[] = [];
  if (r.questions.length !== PDF_EXPECTED.length) errors.push(`savollar soni: ${r.questions.length} ≠ ${PDF_EXPECTED.length}`);
  PDF_EXPECTED.forEach((e, i) => {
    const err = same(r.questions[i], e);
    if (err) errors.push(`${i + 1}-savol: ${err}`);
  });
  if (errors.length === 0) {
    console.log('  ✓ Tor ustunli PDF (boʻlingan qatorlar, bir qatordagi variantlar)');
  } else {
    failed++;
    console.log('  ✗ Tor ustunli PDF');
    for (const e of errors) console.log(`      ${e}`);
    console.log('    pdf-parse matni:\n' + extracted.text.split('\n').map((l) => `      | ${l}`).join('\n'));
  }
} catch (err) {
  failed++;
  console.log('  ✗ PDF sinovi ishlamadi:', err);
}

console.log(`\n${CASES.length + 1 - failed}/${CASES.length + 1} ta namuna oʻtdi`);
if (failed > 0) process.exit(1);
