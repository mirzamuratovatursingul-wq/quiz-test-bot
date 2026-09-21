import type { ParseResult, ParseWarning, Question } from './types.js';

/**
 * Matndan test savollarini ajratib oluvchi tahlilchi.
 *
 * Qo'llab-quvvatlanadigan ko'rinishlar:
 *   1. Savol matni?
 *   +A) To'g'ri javob        <- "+" to'g'ri variantni bildiradi
 *   B) Noto'g'ri
 *   C. Noto'g'ri
 *   D - Noto'g'ri
 *
 * Yoki oxirida javoblar kaliti bo'lsa:
 *   1-A, 2-C, 3-B ...
 *
 * Variantlar harfsiz ham bo'lishi mumkin (har bir qatorda bitta variant,
 * to'g'risi "+" bilan boshlanadi).
 */

const OPTION_LETTERS = 'ABCDEFGH';

type LineKind = 'question' | 'option' | 'separator' | 'blank' | 'text';

interface ClassifiedLine {
  kind: LineKind;
  /** savol raqami (question uchun) */
  number?: number;
  /** variant harfi (option uchun) */
  letter?: string;
  /** "+" belgisi bormi */
  correct?: boolean;
  /** tozalangan matn */
  text: string;
}

const RE_QUESTION = /^\s*(\d{1,3})\s*[.)\]:]\s*(.*)$/;
const RE_OPTION_LETTER = /^\s*(\+\s*)?([A-Ha-hА-Га-г])\s*[).:\]]\s*(\+\s*)?(.*)$/;
const RE_OPTION_DASH = /^\s*(\+\s*)?([A-Ha-hА-Га-г])\s*[-–—]\s+(.*)$/;
const RE_OPTION_PLUS = /^\s*\+\s*(.+)$/;
const RE_SEPARATOR = /^\s*([=_*~-])\1{2,}\s*$/;
const RE_ANSWER_KEY_PAIR = /(\d{1,3})\s*[-–—.):]\s*([A-Ha-hА-Га-г])\b/g;
const RE_PAGE_NUMBER = /^\s*\d{1,3}\s*$/;

/** Matnni tozalash: satr ajratgichlari, ortiqcha bo'shliqlar, sahifa raqamlari */
export function normalizeText(raw: string): string {
  return raw
    .replace(/﻿/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’ʼ]/g, 'ʻ')
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Oxiridagi javoblar kalitini topib, {savolRaqami -> variantIndeksi} qaytaradi */
export function extractAnswerKey(text: string): { key: Map<number, number>; cleaned: string } {
  const empty = new Map<number, number>();
  const lines = text.split('\n');

  let startIdx = lines.findIndex((l) =>
    /^(javob(lar)?( kaliti)?|kalit|javoblar kaliti|otvety|ответы|ключ|answers?( key)?)\s*[:\-]?\s*$/i.test(
      l.trim(),
    ),
  );
  const explicit = startIdx !== -1;
  if (!explicit) startIdx = Math.max(0, Math.floor(lines.length * 0.75));

  // "Javoblar kaliti" sarlavhasi bo'lsa bitta juftlik ham yetarli,
  // aks holda tasodifiy mosliklardan saqlanish uchun kamida 3 ta kerak.
  const minPairs = explicit ? 1 : 3;

  const tail = lines.slice(startIdx).join('\n');
  const matches = [...tail.matchAll(RE_ANSWER_KEY_PAIR)];
  if (matches.length < minPairs) return { key: empty, cleaned: text };

  const key = new Map<number, number>();
  for (const m of matches) {
    const num = Number(m[1]);
    const idx = OPTION_LETTERS.indexOf((m[2] ?? '').toUpperCase());
    if (idx >= 0) key.set(num, idx);
  }
  if (key.size < minPairs) return { key: empty, cleaned: text };

  return { key, cleaned: lines.slice(0, startIdx).join('\n') };
}

function classify(line: string): ClassifiedLine {
  const trimmed = line.trim();

  if (!trimmed) return { kind: 'blank', text: '' };
  if (RE_SEPARATOR.test(trimmed)) return { kind: 'separator', text: '' };
  if (RE_PAGE_NUMBER.test(trimmed)) return { kind: 'blank', text: '' };

  for (const re of [RE_OPTION_LETTER, RE_OPTION_DASH]) {
    const m = re.exec(trimmed);
    if (!m) continue;
    const body = (re === RE_OPTION_LETTER ? m[4] : m[3])?.trim() ?? '';
    if (body.length === 0) continue;
    const plus = Boolean(m[1] || (re === RE_OPTION_LETTER && m[3]));
    return { kind: 'option', letter: (m[2] ?? '').toUpperCase(), correct: plus, text: body };
  }

  const q = RE_QUESTION.exec(trimmed);
  if (q) return { kind: 'question', number: Number(q[1]), text: (q[2] ?? '').trim() };

  const plus = RE_OPTION_PLUS.exec(trimmed);
  if (plus) return { kind: 'option', correct: true, text: (plus[1] ?? '').trim() };

  return { kind: 'text', text: trimmed };
}

interface WorkingQuestion {
  number?: number;
  text: string;
  options: { text: string; correct: boolean }[];
}

function pushLineToQuestion(q: WorkingQuestion, text: string) {
  if (q.options.length > 0) {
    const last = q.options[q.options.length - 1];
    if (last) last.text = `${last.text} ${text}`.trim();
  } else {
    q.text = `${q.text} ${text}`.trim();
  }
}

/** Variantlari bor blokdan keyin kelgan matn yangi savolga o'xshaydimi */
function looksLikeNewQuestion(text: string): boolean {
  return text.length > 12 || text.endsWith('?');
}

/** Asosiy tahlil funksiyasi */
export function parseTestText(raw: string): ParseResult {
  const normalized = normalizeText(raw);
  const { key, cleaned } = extractAnswerKey(normalized);
  const lines = cleaned.split('\n').map(classify);

  const working: WorkingQuestion[] = [];
  let current: WorkingQuestion | null = null;

  const flush = () => {
    if (current) {
      working.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line.kind === 'separator') {
      if (current && current.options.length > 0) flush();
      continue;
    }
    if (line.kind === 'blank') {
      if (current && current.options.length > 0) flush();
      continue;
    }
    if (line.kind === 'question') {
      flush();
      current = { number: line.number, text: line.text, options: [] };
      continue;
    }
    if (line.kind === 'option') {
      if (!current) current = { text: '', options: [] };
      current.options.push({ text: line.text, correct: Boolean(line.correct) });
      continue;
    }
    // 'text'
    if (!current) {
      current = { text: line.text, options: [] };
    } else if (current.options.length > 0 && looksLikeNewQuestion(line.text)) {
      flush();
      current = { text: line.text, options: [] };
    } else {
      pushLineToQuestion(current, line.text);
    }
  }
  flush();

  const warnings: ParseWarning[] = [];
  const questions: Question[] = [];
  const seen = new Map<string, number>();

  let plusUsed = 0;
  let keyUsed = 0;

  // Variantsiz bloklar odatda sarlavha/izoh bo'ladi (fan nomi, sinf, sana).
  // Agar variantli savollar mavjud bo'lsa, ularni tashlab yuboramiz.
  const hasRealQuestions = working.some((wq) => wq.options.length >= 2);
  const blocks = hasRealQuestions ? working.filter((wq) => wq.options.length > 0) : working;

  blocks.forEach((wq, i) => {
    const number = wq.number ?? i + 1;
    const text = wq.text.replace(/\s+/g, ' ').trim();
    const options = wq.options
      .map((o) => ({ ...o, text: o.text.replace(/\s+/g, ' ').trim() }))
      .filter((o) => o.text.length > 0);

    if (!text && options.length === 0) return;

    if (!text) {
      warnings.push({
        questionNumber: number,
        code: 'empty_question',
        message: `${number}-savol matni topilmadi, tahrirlash kerak.`,
      });
    }
    if (options.length < 2) {
      warnings.push({
        questionNumber: number,
        code: 'too_few_options',
        message: `${number}-savolda ${options.length} ta variant topildi (kamida 2 ta kerak).`,
      });
    }
    if (options.length > 8) {
      warnings.push({
        questionNumber: number,
        code: 'too_many_options',
        message: `${number}-savolda ${options.length} ta variant bor, faqat birinchi 8 tasi olindi.`,
      });
    }

    const trimmedOptions = options.slice(0, 8);
    const correctFlags = trimmedOptions
      .map((o, idx) => (o.correct ? idx : -1))
      .filter((idx) => idx >= 0);

    let correctIndex = -1;
    if (correctFlags.length >= 1) {
      correctIndex = correctFlags[0] ?? -1;
      plusUsed++;
      if (correctFlags.length > 1) {
        warnings.push({
          questionNumber: number,
          code: 'multiple_correct',
          message: `${number}-savolda bir nechta "+" bor, birinchisi to'g'ri deb olindi.`,
        });
      }
    } else {
      const idx = key.get(number);
      if (idx !== undefined && idx < trimmedOptions.length) {
        correctIndex = idx;
        keyUsed++;
      }
    }

    if (correctIndex === -1) {
      warnings.push({
        questionNumber: number,
        code: 'no_correct_answer',
        message: `${number}-savolning to'g'ri javobi aniqlanmadi, o'zingiz belgilang.`,
      });
    }

    const fingerprint = text.toLowerCase().slice(0, 80);
    if (fingerprint && seen.has(fingerprint)) {
      warnings.push({
        questionNumber: number,
        code: 'duplicate_question',
        message: `${number}-savol ${seen.get(fingerprint)}-savol bilan bir xil ko'rinadi.`,
      });
    } else if (fingerprint) {
      seen.set(fingerprint, number);
    }

    questions.push({
      text,
      options: trimmedOptions.map((o) => ({ text: o.text })),
      correctIndex,
    });
  });

  if (questions.length === 0) {
    warnings.push({
      code: 'no_questions',
      message:
        'Faylda test savollari topilmadi. Har bir savol raqam bilan, variantlar A) B) C) koʻrinishida boʻlishi kerak.',
    });
  }

  const withCorrect = questions.filter((q) => q.correctIndex >= 0).length;
  let strategy: ParseResult['strategy'] = 'none';
  if (plusUsed > 0 && keyUsed > 0) strategy = 'mixed';
  else if (plusUsed > 0) strategy = 'plus';
  else if (keyUsed > 0) strategy = 'answer_key';

  return {
    questions,
    warnings,
    strategy,
    stats: {
      total: questions.length,
      withCorrect,
      needsReview: questions.length - withCorrect,
    },
  };
}

/** "Birinchi variant har doim to'g'ri" qoidasini qo'llash */
export function applyFirstIsCorrect(questions: Question[]): Question[] {
  return questions.map((q) => ({ ...q, correctIndex: q.options.length > 0 ? 0 : -1 }));
}

/** Tashqi javoblar kalitini qo'llash: "1-A, 2-B" ko'rinishidagi matn */
export function applyAnswerKeyText(questions: Question[], keyText: string): Question[] {
  const key = new Map<number, number>();
  for (const m of keyText.matchAll(RE_ANSWER_KEY_PAIR)) {
    const idx = OPTION_LETTERS.indexOf((m[2] ?? '').toUpperCase());
    if (idx >= 0) key.set(Number(m[1]), idx);
  }
  return questions.map((q, i) => {
    const idx = key.get(i + 1);
    if (idx === undefined || idx >= q.options.length) return q;
    return { ...q, correctIndex: idx };
  });
}

export function optionLabel(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}

/**
 * Variant harfini qalin ko'rinishda qaytaradi (Unicode matematik sans-serif bold).
 * Telegram so'rovnomasi variant matnida haqiqiy qalin shriftni qo'llab-quvvatlamaydi,
 * shuning uchun harf shu belgilar bilan ajratib ko'rsatiladi.
 * Faqat lotin harflariga qo'llanadi — matnning o'zi o'zgarishsiz qoladi.
 */
export function boldOptionLabel(index: number): string {
  const letter = OPTION_LETTERS[index];
  if (!letter) return String(index + 1);
  const BOLD_A = 0x1d5d4; // 𝗔
  return String.fromCodePoint(BOLD_A + (letter.charCodeAt(0) - 65));
}

export { OPTION_LETTERS };
