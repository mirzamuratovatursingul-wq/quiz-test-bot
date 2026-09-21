import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { optionLabel, shuffle, type Question } from '@testrace/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { RaceDoc, TemplateDoc } from '../db/models.js';

const A4_MARGIN = 45;

type Fonts = { regular: string; bold: string };

let cachedFonts: Fonts | null = null;

/**
 * Kirill va o'zbek lotin belgilari (o', g') to'g'ri chiqishi uchun TTF shrift kerak.
 * `npm run fonts` buyrug'i assets/fonts ichiga DejaVu shriftlarini yuklaydi.
 */
function resolveFonts(): Fonts {
  if (cachedFonts) return cachedFonts;
  const regular = path.join(config.fontsDir, 'DejaVuSans.ttf');
  const bold = path.join(config.fontsDir, 'DejaVuSans-Bold.ttf');
  if (fs.existsSync(regular) && fs.existsSync(bold)) {
    cachedFonts = { regular, bold };
  } else {
    logger.warn(
      'DejaVu shriftlari topilmadi (assets/fonts). "npm run fonts" ni ishga tushiring, aks holda PDF da kirill/oʻ belgilari buzilishi mumkin.',
    );
    cachedFonts = { regular: 'Helvetica', bold: 'Helvetica-Bold' };
  }
  return cachedFonts;
}

function createDoc(title: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: A4_MARGIN, bottom: A4_MARGIN, left: A4_MARGIN, right: A4_MARGIN },
    info: { Title: title, Producer: 'TestRace Bot', Creator: 'TestRace Bot' },
    autoFirstPage: true,
  });
  const fonts = resolveFonts();
  doc.registerFont('body', fonts.regular);
  doc.registerFont('head', fonts.bold);
  doc.font('body');
  return doc;
}

function finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function formatDate(d: Date = new Date()): string {
  return d.toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.font('head').fontSize(17).fillColor('#111111').text(title, { align: 'center' });
  if (subtitle) {
    doc.moveDown(0.2);
    doc.font('body').fontSize(10).fillColor('#555555').text(subtitle, { align: 'center' });
  }
  doc.moveDown(0.6);
  const y = doc.y;
  doc
    .moveTo(A4_MARGIN, y)
    .lineTo(doc.page.width - A4_MARGIN, y)
    .strokeColor('#cccccc')
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.8);
  doc.fillColor('#111111');
}

function footerNote(doc: PDFKit.PDFDocument, note: string) {
  // Pastki chegaradan pastga yozganda PDFKit yangi sahifa ochib yubormasligi uchun
  // margin vaqtincha nolga tushiriladi.
  const saved = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .font('body')
    .fontSize(8)
    .fillColor('#999999')
    .text(note, A4_MARGIN, doc.page.height - A4_MARGIN + 12, {
      width: doc.page.width - A4_MARGIN * 2,
      align: 'center',
      lineBreak: false,
    });
  doc.page.margins.bottom = saved;
  doc.fillColor('#111111');
}

export interface TestPdfOptions {
  /** Oxirida javoblar kaliti bo'lsinmi */
  withAnswerKey: boolean;
  /** To'g'ri javoblarni savol ichida belgilash (o'qituvchi nusxasi) */
  markCorrectInline?: boolean;
  /** Variant nomi, masalan "1-variant" */
  variantLabel?: string;
  /** Savollarni aralashtirish (turli variantlar uchun) */
  shuffleQuestions?: boolean;
}

/** Shablondan test PDF si (o'quvchi varianti yoki kalitli nusxa) */
export async function buildTestPdf(
  template: Pick<TemplateDoc, 'title' | 'subject' | 'questions'>,
  options: TestPdfOptions,
): Promise<Buffer> {
  const doc = createDoc(template.title);
  const questions: Question[] = (
    options.shuffleQuestions ? shuffle(template.questions as unknown as Question[]) : (template.questions as unknown as Question[])
  ).map((q) => ({
    text: q.text,
    options: q.options.map((o) => ({ text: o.text })),
    correctIndex: q.correctIndex,
  }));

  const parts = [
    template.subject ? `Fan: ${template.subject}` : null,
    options.variantLabel ?? null,
    `Savollar: ${questions.length} ta`,
    formatDate(),
  ].filter(Boolean) as string[];

  header(doc, template.title, parts.join('  •  '));

  doc.font('body').fontSize(10).fillColor('#444444');
  doc.text('F.I.Sh: ____________________________        Guruh: ______________        Ball: ______');
  doc.moveDown(1);
  doc.fillColor('#111111');

  questions.forEach((q, i) => {
    const blockHeight = estimateBlockHeight(doc, q);
    if (doc.y + blockHeight > doc.page.height - A4_MARGIN - 20) doc.addPage();

    doc.font('head').fontSize(11).text(`${i + 1}. ${q.text}`, { align: 'left' });
    doc.moveDown(0.25);
    doc.font('body').fontSize(10.5);

    q.options.forEach((opt, oi) => {
      const isCorrect = options.markCorrectInline && oi === q.correctIndex;
      if (isCorrect) doc.font('head').fillColor('#0a7d2c');
      doc.text(`   ${optionLabel(oi)}) ${opt.text}`, { indent: 6 });
      if (isCorrect) doc.font('body').fillColor('#111111');
    });
    doc.moveDown(0.6);
  });

  if (options.withAnswerKey) {
    doc.addPage();
    header(doc, 'Javoblar kaliti', template.title);
    doc.font('body').fontSize(11);

    const perRow = 5;
    const colWidth = (doc.page.width - A4_MARGIN * 2) / perRow;
    let startY = doc.y;

    questions.forEach((q, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = A4_MARGIN + col * colWidth;
      const y = startY + row * 20;
      if (y > doc.page.height - A4_MARGIN - 20) {
        doc.addPage();
        startY = A4_MARGIN;
      }
      const answer = q.correctIndex >= 0 ? optionLabel(q.correctIndex) : '—';
      doc.text(`${i + 1} — ${answer}`, x, startY + row * 20, { width: colWidth });
    });
  }

  footerNote(doc, 'TestRace bot orqali tayyorlandi');
  return finish(doc);
}

function estimateBlockHeight(doc: PDFKit.PDFDocument, q: Question): number {
  const width = doc.page.width - A4_MARGIN * 2;
  const qh = doc.font('head').fontSize(11).heightOfString(q.text, { width });
  const oh = q.options.reduce(
    (sum, o) => sum + doc.font('body').fontSize(10.5).heightOfString(o.text, { width: width - 6 }),
    0,
  );
  return qh + oh + 24;
}

/** Musobaqa yakuniy hisoboti PDF si */
export async function buildRaceReportPdf(race: RaceDoc): Promise<Buffer> {
  const doc = createDoc(`${race.templateTitle} — natijalar`);
  const participants = [...race.participants].sort(
    (a, b) => (a.place || 99) - (b.place || 99) || b.score - a.score,
  );

  header(
    doc,
    'Musobaqa natijalari',
    [
      race.templateTitle,
      race.chatTitle || `chat ${race.chatId}`,
      formatDate(race.finishedAt ?? new Date()),
    ].join('  •  '),
  );

  doc.font('head').fontSize(12).text('Umumiy maʻlumot');
  doc.moveDown(0.3);
  doc.font('body').fontSize(10);
  doc.text(`Savollar soni: ${race.questions.length}`);
  doc.text(`Ishtirokchilar: ${participants.length}`);
  doc.text(`Har bir savolga vaqt: ${race.timePerQuestion} sekund`);
  doc.moveDown(0.8);

  // Natijalar jadvali
  doc.font('head').fontSize(12).text('Natijalar jadvali');
  doc.moveDown(0.4);

  const cols = [
    { title: '#', width: 28 },
    { title: 'Ishtirokchi', width: 170 },
    { title: 'Ball', width: 55 },
    { title: "Toʻgʻri", width: 55 },
    { title: 'Xato', width: 45 },
    { title: "Oʻtkazib yub.", width: 75 },
    { title: "Oʻrt. vaqt", width: 70 },
  ];

  const drawRow = (values: string[], bold = false, fill?: string) => {
    if (doc.y > doc.page.height - A4_MARGIN - 30) doc.addPage();
    const y = doc.y;
    let x = A4_MARGIN;
    if (fill) {
      const total = cols.reduce((s, c) => s + c.width, 0);
      doc.rect(A4_MARGIN - 3, y - 3, total + 6, 17).fillColor(fill).fill();
      doc.fillColor('#111111');
    }
    doc.font(bold ? 'head' : 'body').fontSize(9.5);
    cols.forEach((c, i) => {
      doc.text(values[i] ?? '', x, y, { width: c.width, lineBreak: false, ellipsis: true });
      x += c.width;
    });
    doc.y = y + 16;
  };

  drawRow(cols.map((c) => c.title), true, '#eef2ff');

  participants.forEach((p, i) => {
    const avg = p.answered > 0 ? (p.totalTimeMs / p.answered / 1000).toFixed(1) : '—';
    drawRow(
      [
        String(p.place || i + 1),
        `${p.firstName}${p.username ? ` (@${p.username})` : ''}`,
        String(p.score),
        String(p.correct),
        String(p.wrong),
        String(p.missed),
        `${avg} s`,
      ],
      false,
      i % 2 === 1 ? '#fafafa' : undefined,
    );
  });

  // Savollar tahlili
  doc.addPage();
  header(doc, 'Savollar tahlili', race.templateTitle);
  doc.font('body').fontSize(10);

  race.questions.forEach((q, i) => {
    if (doc.y > doc.page.height - A4_MARGIN - 70) doc.addPage();
    const rate = q.answeredCount > 0 ? Math.round((q.correctCount / q.answeredCount) * 100) : 0;
    doc.font('head').fontSize(10.5).text(`${i + 1}. ${q.text}`);
    doc.font('body').fontSize(9.5).fillColor('#444444');
    const correctText = q.options[q.correctIndex]?.text ?? '—';
    doc.text(
      `Toʻgʻri javob: ${optionLabel(q.correctIndex)}) ${correctText}   |   Javob berganlar: ${q.answeredCount}   |   Toʻgʻri: ${q.correctCount} (${rate}%)`,
    );
    doc.fillColor('#111111');
    doc.moveDown(0.5);
  });

  footerNote(doc, 'TestRace bot orqali tayyorlandi');
  return finish(doc);
}
