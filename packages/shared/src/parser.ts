import type { ParseResult, ParseWarning, Question } from './types.js';

/**
 * Matndan test savollarini ajratib oluvchi tahlilchi.
 *
 * Asosiy g'oya: savol chegarasini "matn uzunligi" kabi taxminlar bilan emas,
 * tuzilma bo'yicha aniqlash:
 *   - savollar raqamlari ketma-ket keladi (1, 2, 3 ...) — shu zanjir topiladi;
 *   - variant harflari ham ketma-ket keladi (A, B, C ...) — ketma-ketlikka
 *     tushmagan "A." kabi qatorlar (masalan, "A. Navoiy") variant hisoblanmaydi;
 *   - variantdan keyingi belgisiz qator — uzun variantning davomi.
 *
 * Qo'llab-quvvatlanadigan ko'rinishlar:
 *   1. Savol?            | 1) Savol | 1-savol. | №1 | Savol 1:
 *   +A) To'g'ri          | A. / A: / A - / (A) / а) б) в) г) (kirill)
 *   B) Noto'g'ri
 *   A) 12  +B) 14  C) 16 — bir qatorda bir nechta variant
 *   +Toshkent / Samarqand — harfsiz variantlar ("+" to'g'risini bildiradi)
 *   ++++ / ==== / #To'g'ri — HEMIS formati
 *   S: / +: / -:  ,  ? / + / -  ,  <question> / <variant> — teg formatlari
 *   Javob: B  — savol ostida;  1-A, 2-C  yoki jadval — oxirida kalit
 */

const OPTION_LETTERS = 'ABCDEFGH';
const CYR_ORDER = 'АБВГДЕЖЗ';
/** Kirill harflari lotin harfiga o'xshab yozilganda (А В С Е) */
const CYR_HOMOGLYPH: Record<string, string> = { А: 'A', В: 'B', С: 'C', Е: 'E' };

type Alphabet = 'latin' | 'cyrillic';

/** Variant harfi: lotin A-H, kirill А-Е (va lotinga o'xshash С) */
const L = '[A-Ha-hА-Еа-еСс]';
/** To'g'ri javob belgisi */
const M = '[+*#✓✔√]';

function letterIndex(ch: string, alphabet: Alphabet): number {
  const up = ch.toUpperCase();
  const lat = OPTION_LETTERS.indexOf(up);
  if (lat >= 0) return lat;
  if (alphabet === 'latin') {
    const h = CYR_HOMOGLYPH[up];
    if (h) return OPTION_LETTERS.indexOf(h);
  }
  return CYR_ORDER.indexOf(up);
}

/** Variantlarda Б yoki Г uchrasa — kirill tartibi (А Б В Г), aks holda lotin */
function detectAlphabet(text: string): Alphabet {
  return new RegExp(`^\\s*${M}?\\s*\\(?[БбГг]\\s*[).:]`, 'mu').test(text) ? 'cyrillic' : 'latin';
}

/* ------------------------------------------------------------------ */
/* Normalizatsiya                                                      */
/* ------------------------------------------------------------------ */

/** Matnni tozalash: satr ajratgichlari, ortiqcha bo'shliqlar, ko'rinmas belgilar */
export function normalizeText(raw: string): string {
  return raw
    .replace(/﻿/g, '')
    .replace(/[\u200B-\u200D\u00AD\u2060]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F\u2000-\u2006\u2008-\u200A]/g, ' ')
    .replace(/[‘’ʼ]/g, 'ʻ')
    .replace(/[“”«»]/g, '"')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Javoblar kaliti                                                     */
/* ------------------------------------------------------------------ */

const RE_KEY_HEADER =
  /^(?:to['ʻ`]?g['ʻ`]?ri\s+javob(?:lar)?|javob(?:lar)?(?:\s+kaliti)?|kalit(?:lar)?|test\s+kaliti|otvety|правильные\s+ответы|ответы|ответ|ключ(?:\s+ответов)?|answers?(?:\s+key)?|key)(?![\p{L}])\s*[:\-–—]?\s*(.*)$/iu;
const RE_KEY_PAIR = new RegExp(`(\\d{1,3})\\s*[-–—.):=|]?\\s*\\(?(${L})(?![\\p{L}])`, 'gu');
const RE_GRID_NUMBERS = /^\d{1,3}(?:[\s|,;.]+\d{1,3})+[\s|,;.]*$/;
const RE_GRID_LETTERS = new RegExp(`^${L}(?:[\\s|,;.]+${L})+[\\s|,;.]*$`, 'u');

function keyPairsOf(line: string, alphabet: Alphabet): [number, number][] {
  const out: [number, number][] = [];
  for (const m of line.matchAll(RE_KEY_PAIR)) {
    const idx = letterIndex(m[2] ?? '', alphabet);
    if (idx >= 0) out.push([Number(m[1]), idx]);
  }
  return out;
}

/** Qator faqat kalitdan iboratmi ("1-A 2-C", "1 2 3", "A C B") */
function isKeyLine(line: string, alphabet: Alphabet): boolean {
  const t = line.trim();
  if (!t) return true;
  if (RE_GRID_NUMBERS.test(t) || RE_GRID_LETTERS.test(t)) return true;
  if (keyPairsOf(t, alphabet).length === 0) return false;
  const rest = t.replace(RE_KEY_PAIR, '').replace(/[\s,;.|:\-–—()]/g, '');
  return rest.length <= 2;
}

/** Kalit qatorlaridan {savolRaqami -> variantIndeksi} */
function collectKey(lines: string[], alphabet: Alphabet): Map<number, number> {
  const key = new Map<number, number>();
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim();
    const next = (lines[i + 1] ?? '').trim();
    // Jadval: bir qatorda raqamlar, keyingisida harflar
    if (RE_GRID_NUMBERS.test(t) && RE_GRID_LETTERS.test(next)) {
      const nums = t.match(/\d{1,3}/g) ?? [];
      const lets = next.match(new RegExp(L, 'gu')) ?? [];
      if (nums.length === lets.length) {
        nums.forEach((n, j) => {
          const idx = letterIndex(lets[j] ?? '', alphabet);
          if (idx >= 0) key.set(Number(n), idx);
        });
        i++;
        continue;
      }
    }
    for (const [n, idx] of keyPairsOf(t, alphabet)) key.set(n, idx);
  }
  return key;
}

/** Oxiridagi javoblar kalitini topib, {savolRaqami -> variantIndeksi} qaytaradi */
export function extractAnswerKey(text: string): { key: Map<number, number>; cleaned: string } {
  const alphabet = detectAlphabet(text);
  const lines = text.split('\n');

  // 1) Sarlavhali kalit ("Javoblar kaliti:") — oxirgisidan boshlab qidiramiz
  for (let i = lines.length - 1; i >= 0; i--) {
    const h = RE_KEY_HEADER.exec((lines[i] ?? '').trim());
    if (!h) continue;
    const tail = [h[1] ?? '', ...lines.slice(i + 1)];
    const nonEmpty = tail.filter((l) => l.trim());
    if (nonEmpty.length === 0) continue;
    const keyLike = nonEmpty.filter((l) => isKeyLine(l, alphabet)).length;
    if (keyLike / nonEmpty.length < 0.6) continue;
    const key = collectKey(tail, alphabet);
    if (key.size >= 1) return { key, cleaned: lines.slice(0, i).join('\n') };
  }

  // 2) Sarlavhasiz: oxiridan boshlab faqat kalitdan iborat qatorlar
  let start = lines.length;
  while (start > 0 && isKeyLine(lines[start - 1] ?? '', alphabet)) start--;
  while (start < lines.length && !(lines[start] ?? '').trim()) start++;
  if (start < lines.length) {
    const key = collectKey(lines.slice(start), alphabet);
    if (key.size >= 3) return { key, cleaned: lines.slice(0, start).join('\n') };
  }

  return { key: new Map(), cleaned: text };
}

/* ------------------------------------------------------------------ */
/* Qatorlarni tasniflash                                               */
/* ------------------------------------------------------------------ */

type LineKind = 'blank' | 'num' | 'opt' | 'mark' | 'dash' | 'answer' | 'text';

interface Line {
  kind: LineKind;
  /** Asl qator (matn sifatida ishlatilsa) */
  raw: string;
  /** Belgilaridan tozalangan matn */
  text: string;
  /** num: savol raqami va ajratgich turi */
  num?: number;
  numKind?: string;
  /** opt/answer: variant indeksi, opt: ajratgich */
  letter?: number;
  delim?: string;
  correct?: boolean;
  /** Yakka son: sahifa raqami yoki harfsiz variant ("48") bo'lishi mumkin */
  pageLike?: boolean;
}

const BLANK: Line = { kind: 'blank', raw: '', text: '' };
const RE_SEPARATOR = /^([=_*~\-+.])\1{2,}$/;
const RE_BARE_NUMBER = /^\d{1,3}$/;
const RE_PAGE_NUMBER = /^[-–—]\s*\d{1,3}\s*[-–—]$|^\d{1,3}\s*\/\s*\d{1,3}$|^(?:sahifa|bet|стр\.?|page)\s*\d{1,3}$|^\d{1,3}\s*-\s*(?:bet|sahifa)$/iu;
const RE_OPT = new RegExp(
  `^(${M}\\s*)?\\(?(${L})\\s*([).:\\]]|[-–—](?=\\s))\\s*(${M}(?=\\s|\\S)\\s*)?(.*)$`,
  'u',
);
const RE_NUM = /^(\d{1,3})\s*(?:(-?\s*(?:savol|вопрос|question))\s*[.:)]?|([.)\]:])(?!\d)|([-–—])(?=\s))\s*(.*)$/iu;
const RE_NUM_PREFIX = /^(?:№|savol|вопрос|question|q)\s*(\d{1,3})\s*[.:)\-–—]?\s*(.*)$/iu;
const RE_MARK = new RegExp(`^${M}\\s*(.+)$`, 'u');
const RE_DASH = /^[-–—•·▪]\s*(\D.*)$/u;
const RE_ANSWER_LINE = new RegExp(
  `^(?:to['ʻ\`]?g['ʻ\`]?ri\\s+javob|javob|ответ|правильный\\s+ответ|answer|kalit)\\s*[:\\-–—]\\s*\\(?(${L})\\s*[).]?\\s*$`,
  'iu',
);
const RE_TRAILING_MARK = /\s*(?:\(\+\)|\[\+\]|✓|✔)\s*$/u;

function classify(rawLine: string, alphabet: Alphabet): Line {
  let t = rawLine.trim();
  if (!t || RE_SEPARATOR.test(t) || RE_PAGE_NUMBER.test(t)) return BLANK;
  if (RE_BARE_NUMBER.test(t)) return { kind: 'text', raw: t, text: t, pageLike: true };

  let trailingCorrect = false;
  if (RE_TRAILING_MARK.test(t)) {
    trailingCorrect = true;
    t = t.replace(RE_TRAILING_MARK, '').trim();
  }

  const ans = RE_ANSWER_LINE.exec(t);
  if (ans) {
    const idx = letterIndex(ans[1] ?? '', alphabet);
    if (idx >= 0) return { kind: 'answer', raw: t, text: '', letter: idx };
  }

  const o = RE_OPT.exec(t);
  if (o) {
    const idx = letterIndex(o[2] ?? '', alphabet);
    if (idx >= 0) {
      return {
        kind: 'opt',
        raw: t,
        text: (o[5] ?? '').trim(),
        letter: idx,
        delim: (o[3] ?? '').replace(/[–—]/, '-'),
        correct: Boolean(o[1] || o[4]) || trailingCorrect,
      };
    }
  }

  const n = RE_NUM.exec(t);
  if (n) {
    const numKind = n[2] ? 'savol' : (n[3] ?? n[4] ?? '.').replace(/[–—]/, '-');
    return { kind: 'num', raw: t, text: (n[5] ?? '').trim(), num: Number(n[1]), numKind, correct: trailingCorrect };
  }
  const np = RE_NUM_PREFIX.exec(t);
  if (np) {
    return { kind: 'num', raw: t, text: (np[2] ?? '').trim(), num: Number(np[1]), numKind: 'prefix' };
  }

  const mk = RE_MARK.exec(t);
  if (mk) {
    const body = (mk[1] ?? '').trim();
    // "+2) Toshkent" — raqamli variant
    const nb = /^(\d{1,2})\s*\)\s*(.*)$/.exec(body);
    if (nb) return { kind: 'num', raw: t, text: (nb[2] ?? '').trim(), num: Number(nb[1]), numKind: ')', correct: true };
    return { kind: 'mark', raw: t, text: body, correct: true };
  }

  const d = RE_DASH.exec(t);
  if (d) return { kind: 'dash', raw: t, text: (d[1] ?? '').trim(), correct: trailingCorrect };

  return { kind: 'text', raw: t, text: t, correct: trailingCorrect };
}

/* ------------------------------------------------------------------ */
/* Bir qatordagi bir nechta variantni ajratish                         */
/* ------------------------------------------------------------------ */

const RE_INLINE_OPT = new RegExp(`(?<![\\p{L}])(${M}\\s*)?\\(?(${L})\\s*([).])(?=\\s|[^\\s.])`, 'gu');

/**
 * "A) 12 +B) 14 C) 16 D) 18" -> 4 qator. Harflar ketma-ket (A, B, C ...) va bir xil
 * ajratgich bilan kelgandagina bo'linadi, shuning uchun oddiy matndagi "B)" tegmaydi.
 * PDF dan "A)12B)14" kabi bo'shliqsiz chiqqan matn ham qo'llab-quvvatlanadi.
 */
function splitInlineOptions(line: string, alphabet: Alphabet): string[] {
  const strict = splitByRegex(line, alphabet, RE_INLINE_OPT, false);
  if (strict) return strict;
  // pdf-parse bo'laklarni bo'shliqsiz yopishtiradi: "+A) H2OB) CO2C) O2D) NaCl".
  // Harfdan keyin kelgan "B)" ham qabul qilinadi, lekin faqat qator variant bilan
  // boshlansa va harflar ketma-ket bo'lsa.
  return splitByRegex(line, alphabet, RE_INLINE_OPT_LOOSE, true) ?? [line];
}

const RE_INLINE_OPT_LOOSE = new RegExp(`(${M}\\s*)?\\(?(${L})\\s*(\\))`, 'gu');

function splitByRegex(line: string, alphabet: Alphabet, re: RegExp, fromStartOnly: boolean): string[] | null {
  const matches = [...line.matchAll(re)]
    .map((m) => ({ pos: m.index ?? 0, idx: letterIndex(m[2] ?? '', alphabet), delim: m[3] ?? '' }))
    .filter((m) => m.idx >= 0);
  if (matches.length < 2) return null;
  if (fromStartOnly && matches[0]!.pos !== 0) return null;

  let best: typeof matches = [];
  for (let s = 0; s < (fromStartOnly ? 1 : matches.length); s++) {
    const first = matches[s]!;
    if (first.idx !== 0 && first.pos !== 0) continue;
    const chain = [first];
    for (let j = s + 1; j < matches.length; j++) {
      const m = matches[j]!;
      const last = chain[chain.length - 1]!;
      if (m.delim === first.delim && m.idx === last.idx + 1) chain.push(m);
    }
    if (chain.length > best.length) best = chain;
  }

  const minLen = best[0]?.delim === '.' ? 3 : 2;
  if (best.length < minLen) return null;

  const pieces: string[] = [];
  const head = line.slice(0, best[0]!.pos).replace(/\(\s*$/, '').trim();
  if (head) pieces.push(head);
  best.forEach((m, i) => {
    const end = best[i + 1]?.pos ?? line.length;
    const piece = line.slice(m.pos, end).replace(/\(\s*$/, '').trim();
    if (piece) pieces.push(piece);
  });
  return pieces;
}

/** Qatorlarni tayyorlash: yolg'iz "+" qatorini keyingisiga qo'shish, bir qatordagi variantlarni ajratish */
function prepareLines(text: string, alphabet: Alphabet): string[] {
  const src = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    let line = src[i] ?? '';
    if (new RegExp(`^${M}$`, 'u').test(line.trim()) && (src[i + 1] ?? '').trim()) {
      line = `${line.trim()}${src[i + 1]!.trim()}`;
      i++;
    }
    out.push(...splitInlineOptions(line, alphabet));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Savol raqamlari zanjiri                                             */
/* ------------------------------------------------------------------ */

/**
 * Qaysi raqamli qatorlar haqiqiy savol boshi ekanini aniqlaydi.
 * Har bir ajratgich turi ("1." / "1)" / "1-savol") uchun eng uzun ketma-ket
 * zanjir quriladi; savol ostida variantlar bo'lgani uchun zanjir a'zolari
 * orasidagi qatorlar soni bo'yicha baholanadi. Shu tufayli "1) 2) 3)"
 * ko'rinishidagi raqamli variantlar savol deb olinmaydi.
 */
function findQuestionStarts(lines: Line[]): Set<number> {
  const byKind = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (l.kind !== 'num' || l.correct) return;
    const list = byKind.get(l.numKind ?? '.') ?? [];
    list.push(i);
    byKind.set(l.numKind ?? '.', list);
  });

  let bestChain: number[] = [];
  let bestScore = 0;

  for (const candidates of byKind.values()) {
    for (let s = 0; s < candidates.length; s++) {
      if (candidates.length - s <= bestChain.length / 2) break;
      const chain = [candidates[s]!];
      let last = lines[candidates[s]!]!.num ?? 0;
      for (let j = s + 1; j < candidates.length; j++) {
        const n = lines[candidates[j]!]!.num ?? 0;
        if ((n > last && n <= last + 3) || (n === 1 && chain.length >= 3)) {
          chain.push(candidates[j]!);
          last = n;
        }
      }

      let score = 0;
      chain.forEach((idx, k) => {
        const end = chain[k + 1] ?? lines.length;
        let size = lines[idx]!.text ? 1 : 0;
        for (let x = idx + 1; x < end && size < 3; x++) if (lines[x]!.kind !== 'blank') size++;
        score += Math.min(size, 3);
      });

      if (score > bestScore) {
        bestScore = score;
        bestChain = chain;
      }
    }
  }

  return bestScore >= 3 ? new Set(bestChain) : new Set();
}

/* ------------------------------------------------------------------ */
/* Bloklarni savolga aylantirish                                       */
/* ------------------------------------------------------------------ */

interface WorkingOption {
  text: string;
  correct: boolean;
  /** Asl qator — variant aslida savol matni bo'lib chiqsa qaytarish uchun */
  raw?: string;
}

interface WorkingQuestion {
  number?: number;
  text: string[];
  options: WorkingOption[];
  /** "Javob: B" qatoridan olingan indeks */
  answer?: number;
}

const startsLower = (s: string) => /^[\p{Ll}]/u.test(s) || /^[,;:)\]]/.test(s);
const endsQuestion = (s: string) => /[?:？]$|\.{3}$|…$|_{2,}$/.test(s);

/**
 * Qator guruhidan savol matnining boshini topish: oxirgi "yangi gap" qatoridan
 * (katta harf bilan boshlangan) boshlab oxirigacha. Oldingi qatorlar sarlavha
 * yoki oldingi variantning davomi hisoblanadi.
 */
function splitTail(lines: Line[]): { before: Line[]; tail: Line[] } {
  const blankAt = lines.map((l) => l.kind === 'blank').lastIndexOf(true);
  if (blankAt >= 0) {
    const tail = lines.slice(blankAt + 1).filter((l) => l.kind !== 'blank');
    if (tail.length > 0) return { before: lines.slice(0, blankAt).filter((l) => l.kind !== 'blank'), tail };
  }
  const content = lines.filter((l) => l.kind !== 'blank');
  let start = content.length - 1;
  while (start > 0 && startsLower(content[start]!.raw)) start--;
  return { before: content.slice(0, Math.max(start, 0)), tail: content.slice(Math.max(start, 0)) };
}

function appendToLastOption(q: WorkingQuestion, text: string) {
  const last = q.options[q.options.length - 1];
  if (last) last.text = `${last.text} ${text}`.trim();
  else q.text.push(text);
}

/** Blokdagi eng ko'p uchragan variant ajratgichi (")" yoki "." ...) */
function dominantDelim(body: Line[]): string | null {
  const counts = new Map<string, number>();
  for (const l of body) if (l.kind === 'opt') counts.set(l.delim!, (counts.get(l.delim!) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [d, c] of counts) {
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return bestCount >= 2 ? best : null;
}

function hasNextLetterAhead(body: Line[], from: number, delim: string): boolean {
  for (let i = from + 1; i < body.length && i <= from + 6; i++) {
    const l = body[i]!;
    if (l.kind === 'opt' && l.delim === delim) return l.letter === 1;
  }
  return false;
}

/** Harfli variantlar bilan yozilgan blok (bitta yoki bir nechta savol) */
function parseLetteredBlock(
  number: number | undefined,
  head: Line | null,
  rawBody: Line[],
  delim: string,
  isPreamble: boolean,
): WorkingQuestion[] {
  // Harfli variantlar orasidagi yakka son — sahifa raqami
  const body = rawBody.map((l) => (l.pageLike ? BLANK : l));
  const out: WorkingQuestion[] = [];
  let cur: WorkingQuestion = { number, text: head?.text ? [head.text] : [], options: [] };
  let expected = 0;
  let pending: Line[] = [];
  let headLines: Line[] = [];

  const startQuestion = (lines: Line[]) => {
    cur.text.push(...lines.map((l) => l.raw));
  };

  for (let i = 0; i < body.length; i++) {
    const l = body[i]!;

    if (l.kind === 'answer') {
      cur.answer = l.letter;
      continue;
    }

    if (l.kind === 'opt' && l.delim === delim) {
      const first = cur.options.length === 0;
      if ((first && l.letter === 0) || (!first && l.letter === expected)) {
        if (first) {
          // Preambula blokida (raqamsiz hujjat) sarlavhalarni savoldan ajratamiz
          if (isPreamble && out.length === 0 && cur.text.length === 0) {
            startQuestion(splitTail(headLines).tail);
          } else {
            startQuestion(headLines.filter((x) => x.kind !== 'blank'));
          }
          headLines = [];
        }
        for (const p of pending) if (p.kind !== 'blank') appendToLastOption(cur, p.raw);
        pending = [];
        cur.options.push({ text: l.text, correct: Boolean(l.correct), raw: l.raw });
        expected = (l.letter ?? 0) + 1;
        continue;
      }
      if (l.letter === 0 && !first && hasNextLetterAhead(body, i, delim)) {
        const option = { text: l.text, correct: Boolean(l.correct), raw: l.raw };
        if (cur.options.length === 1) {
          // Yagona "A." aslida savol matni edi (masalan, "A. Navoiy qaysi asarni yozgan?")
          const only = cur.options[0]!;
          cur.text.push(only.raw ?? only.text, ...pending.filter((p) => p.kind !== 'blank').map((p) => p.raw));
          cur.options = [option];
        } else {
          // Harflar qaytadan A dan boshlandi -> raqamsiz yangi savol
          const { before, tail } = splitTail(pending);
          for (const p of before) appendToLastOption(cur, p.raw);
          out.push(cur);
          cur = { text: tail.map((x) => x.raw), options: [option] };
        }
        pending = [];
        expected = 1;
        continue;
      }
    }

    if (cur.options.length === 0) headLines.push(l);
    else pending.push(l);
  }

  if (cur.options.length === 0) startQuestion(headLines.filter((x) => x.kind !== 'blank'));
  for (const p of pending) if (p.kind !== 'blank' && !isSectionHeading(p.raw)) appendToLastOption(cur, p.raw);
  out.push(cur);
  return out;
}

/** "2-variant", "II BOʻLIM", "Mavzu: ..." — keyingi bo'lim sarlavhasi, variant davomi emas */
function isSectionHeading(s: string): boolean {
  if (/^(?:\d{1,2}\s*[-–—.]?\s*)?(?:variant|вариант|qism|boʻlim|bo'lim|bob|mavzu|тема|раздел|часть|part|section)(?![\p{L}])/iu.test(s)) {
    return true;
  }
  return s.length >= 6 && /\p{L}/u.test(s) && s === s.toUpperCase() && /^[\p{Lu}\d\s.,:;'ʻ-]+$/u.test(s);
}

/** Harfsiz variantlar: "+Toshkent / Samarqand", "- noto'g'ri", "1) 2) 3)" */
function parseLetterlessBlock(number: number | undefined, head: Line | null, body: Line[]): WorkingQuestion {
  const q: WorkingQuestion = { number, text: head?.text ? [head.text] : [], options: [] };
  const lines: Line[] = [];
  for (const l of body) {
    if (l.kind === 'blank') continue;
    if (l.kind === 'answer') q.answer = l.letter;
    else lines.push(l);
  }

  const numItems = lines.filter((l) => l.kind === 'num').length;
  const dashItems = lines.filter((l) => l.kind === 'dash').length;
  const marks = lines.filter((l) => l.kind === 'mark' || (l.kind === 'num' && l.correct)).length;

  // Variantlar alohida belgi bilan ajratilgan: "1) 2) 3)" yoki "+ / -"
  const isOption: ((l: Line) => boolean) | null =
    numItems >= 2
      ? (l) => l.kind === 'num'
      : dashItems >= 1 && (marks >= 1 || dashItems >= 2)
        ? (l) => l.kind === 'mark' || l.kind === 'dash'
        : null;

  if (isOption) {
    for (const l of lines) {
      if (isOption(l)) q.options.push({ text: l.text, correct: Boolean(l.correct) });
      else if (q.options.length === 0) q.text.push(l.raw);
      else if (startsLower(l.raw) || l.kind === 'text') appendToLastOption(q, l.raw);
      else q.options.push({ text: l.text, correct: Boolean(l.correct) });
    }
    return q;
  }

  // Har bir qatorda bitta variant: savol qayerda tugashini aniqlaymiz
  const firstMark = lines.findIndex((l) => l.kind === 'mark');
  const searchUntil = firstMark >= 0 ? firstMark : lines.length;
  let optStart: number;
  if (q.text.length > 0 && endsQuestion(q.text[q.text.length - 1]!)) {
    optStart = 0;
  } else {
    let k = -1;
    for (let i = 0; i < searchUntil; i++) if (endsQuestion(lines[i]!.raw)) k = i;
    if (k >= 0) {
      optStart = k + 1;
    } else {
      optStart = q.text.length > 0 ? 0 : Math.min(1, searchUntil);
      while (optStart < searchUntil && startsLower(lines[optStart]!.raw)) optStart++;
    }
  }

  lines.slice(0, optStart).forEach((l) => q.text.push(l.raw));
  for (const l of lines.slice(optStart)) {
    if (l.kind !== 'mark' && q.options.length > 0 && startsLower(l.raw)) appendToLastOption(q, l.raw);
    else q.options.push({ text: l.kind === 'mark' ? l.text : l.raw, correct: Boolean(l.correct) });
  }
  return q;
}

function parseBlock(number: number | undefined, head: Line | null, body: Line[], isPreamble: boolean): WorkingQuestion[] {
  const delim = dominantDelim(body);
  if (delim) return parseLetteredBlock(number, head, body, delim, isPreamble);
  if (isPreamble && !head) {
    // Raqamsiz va harfsiz preambula: odatda sarlavha. Variantli bo'lsa savol sifatida olinadi.
    const q = parseLetterlessBlock(undefined, null, body);
    return q.options.length >= 2 ? [q] : [{ text: q.text, options: [] }];
  }
  return [parseLetterlessBlock(number, head, body)];
}

/* ------------------------------------------------------------------ */
/* Teg formatlari (HEMIS, S:/+:/-:, ?/+/-, <question>/<variant>)       */
/* ------------------------------------------------------------------ */

const RE_HEMIS_Q = /^\+{3,}$/;
const RE_HEMIS_O = /^={3,}$/;
const RE_TAG_Q = /^(?:\?|S\s*:|Q\s*:|<question\d*>|savol\s*:|вопрос\s*:)\s*(.*)$/iu;
const RE_TAG_PLUS = /^(?:\+\s*:|<variant>\s*\+|\+)\s*(.*)$/iu;
const RE_TAG_MINUS = /^(?:-\s*:|<variant>|[-–—](?![\d]))\s*(.*)$/iu;
const RE_TAG_IGNORE = /^(?:I\s*:|V\d*\s*:|F\s*:|<\/(?:test|topic|question|variant)>\s*$|<(?:test|topic)>\s*$)/iu;

const stripQuestionNumber = (s: string) => s.replace(/^\d{1,3}\s*[.)]\s*/, '').trim();

function parseHemis(lines: string[]): WorkingQuestion[] | null {
  if (lines.filter((l) => RE_HEMIS_Q.test(l)).length < 1) return null;
  if (lines.filter((l) => RE_HEMIS_O.test(l)).length < 2) return null;

  const out: WorkingQuestion[] = [];
  let parts: string[][] = [[]];
  const flush = () => {
    const clean = parts.map((p) => p.join(' ').trim()).filter(Boolean);
    if (clean.length >= 2) {
      out.push({
        text: [stripQuestionNumber(clean[0]!)],
        options: clean.slice(1).map((o) => ({
          text: o.replace(/^#\s*/, ''),
          correct: o.startsWith('#'),
        })),
      });
    }
    parts = [[]];
  };
  for (const line of lines) {
    if (RE_HEMIS_Q.test(line)) flush();
    else if (RE_HEMIS_O.test(line)) parts.push([]);
    else if (line) parts[parts.length - 1]!.push(line);
  }
  flush();
  return out.length > 0 ? out : null;
}

function parseTagged(lines: string[]): WorkingQuestion[] | null {
  const qCount = lines.filter((l) => RE_TAG_Q.test(l)).length;
  const colonOpts = lines.filter((l) => /^[+-]\s*:/.test(l)).length;
  const variantTags = lines.filter((l) => /^<variant>/i.test(l)).length;
  const signOpts = lines.filter((l) => RE_TAG_PLUS.test(l) || RE_TAG_MINUS.test(l)).length;
  if (qCount < 2 && colonOpts < 2 && variantTags < 2) return null;
  if (qCount < 1 || signOpts < qCount * 2) return null;

  const out: WorkingQuestion[] = [];
  let cur: WorkingQuestion | null = null;
  for (const line of lines) {
    if (!line || RE_SEPARATOR.test(line)) continue;
    const q = RE_TAG_Q.exec(line);
    if (q) {
      if (cur) out.push(cur);
      cur = { text: [stripQuestionNumber(q[1] ?? '')].filter(Boolean), options: [] };
      continue;
    }
    if (!cur || RE_TAG_IGNORE.test(line)) continue;
    const plus = RE_TAG_PLUS.exec(line);
    if (plus) {
      cur.options.push({ text: (plus[1] ?? '').trim(), correct: true });
      continue;
    }
    const minus = RE_TAG_MINUS.exec(line);
    if (minus) {
      cur.options.push({ text: (minus[1] ?? '').trim(), correct: false });
      continue;
    }
    appendToLastOption(cur, line);
  }
  if (cur) out.push(cur);
  return out.some((q) => q.options.length >= 2) ? out : null;
}

/* ------------------------------------------------------------------ */
/* Yakuniy natija                                                      */
/* ------------------------------------------------------------------ */

export interface RawQuestion {
  number?: number;
  text: string;
  options: WorkingOption[];
  /** Tashqi manba (masalan, AI) bergan to'g'ri javob indeksi */
  correctIndex?: number;
}

/** Xom savollardan ParseResult: tozalash, kalitni qo'llash, ogohlantirishlar */
export function finalizeQuestions(
  raw: RawQuestion[],
  key: Map<number, number> = new Map(),
  forcedStrategy?: ParseResult['strategy'],
): ParseResult {
  const warnings: ParseWarning[] = [];
  const questions: Question[] = [];
  const seen = new Map<string, number>();
  let plusUsed = 0;
  let keyUsed = 0;

  raw.forEach((rq, i) => {
    const number = i + 1;
    const keyNumber = rq.number ?? number;
    const text = rq.text.replace(/\s+/g, ' ').trim();
    const options = rq.options
      .map((o) => ({ ...o, text: o.text.replace(/\s+/g, ' ').trim() }))
      .filter((o) => o.text.length > 0);

    if (!text && options.length === 0) return;

    if (!text) {
      warnings.push({ questionNumber: number, code: 'empty_question', message: `${number}-savol matni topilmadi, tahrirlash kerak.` });
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

    const trimmed = options.slice(0, 8);
    const flags = trimmed.map((o, idx) => (o.correct ? idx : -1)).filter((idx) => idx >= 0);

    let correctIndex = -1;
    if (rq.correctIndex !== undefined && rq.correctIndex >= 0 && rq.correctIndex < trimmed.length) {
      correctIndex = rq.correctIndex;
      plusUsed++;
    } else if (flags.length >= 1) {
      correctIndex = flags[0] ?? -1;
      plusUsed++;
      if (flags.length > 1) {
        warnings.push({
          questionNumber: number,
          code: 'multiple_correct',
          message: `${number}-savolda bir nechta "+" bor, birinchisi toʻgʻri deb olindi.`,
        });
      }
    } else {
      const idx = key.get(keyNumber);
      if (idx !== undefined && idx < trimmed.length) {
        correctIndex = idx;
        keyUsed++;
      }
    }

    if (correctIndex === -1) {
      warnings.push({
        questionNumber: number,
        code: 'no_correct_answer',
        message: `${number}-savolning toʻgʻri javobi aniqlanmadi, oʻzingiz belgilang.`,
      });
    }

    const fingerprint = `${text.toLowerCase().slice(0, 80)}|${trimmed.map((o) => o.text.toLowerCase()).join('|').slice(0, 80)}`;
    if (text && seen.has(fingerprint)) {
      warnings.push({
        questionNumber: number,
        code: 'duplicate_question',
        message: `${number}-savol ${seen.get(fingerprint)}-savol bilan bir xil koʻrinadi.`,
      });
    } else if (text) {
      seen.set(fingerprint, number);
    }

    questions.push({ text, options: trimmed.map((o) => ({ text: o.text })), correctIndex });
  });

  if (questions.length === 0) {
    warnings.push({
      code: 'no_questions',
      message: 'Faylda test savollari topilmadi. Har bir savol raqam bilan, variantlar A) B) C) koʻrinishida boʻlishi kerak.',
    });
  }

  const withCorrect = questions.filter((q) => q.correctIndex >= 0).length;
  let strategy: ParseResult['strategy'] = 'none';
  if (forcedStrategy) strategy = forcedStrategy;
  else if (plusUsed > 0 && keyUsed > 0) strategy = 'mixed';
  else if (plusUsed > 0) strategy = 'plus';
  else if (keyUsed > 0) strategy = 'answer_key';

  return {
    questions,
    warnings,
    strategy,
    stats: { total: questions.length, withCorrect, needsReview: questions.length - withCorrect },
  };
}

function toRaw(wqs: WorkingQuestion[]): RawQuestion[] {
  // Variantsiz bloklar odatda sarlavha/izoh (fan nomi, sinf, sana)
  const hasReal = wqs.some((wq) => wq.options.length >= 2);
  return (hasReal ? wqs.filter((wq) => wq.options.length > 0) : wqs).map((wq) => ({
    number: wq.number,
    text: wq.text.join(' '),
    options: wq.options,
    correctIndex: wq.options.some((o) => o.correct) ? undefined : wq.answer,
  }));
}

/** Asosiy tahlil funksiyasi */
export function parseTestText(rawText: string): ParseResult {
  const normalized = normalizeText(rawText);
  const alphabet = detectAlphabet(normalized);

  const { key, cleaned } = extractAnswerKey(normalized);

  // Teg formatlari: variantlar harf bilan emas, belgi bilan ajratilgan
  const tagLines = cleaned
    .replace(/(<(?:question|variant)\d*>)/gi, '\n$1')
    .split('\n')
    .map((l) => l.trim());
  const tagged = parseHemis(tagLines) ?? parseTagged(tagLines);
  if (tagged) return finalizeQuestions(toRaw(tagged), key);

  const lines = prepareLines(cleaned, alphabet).map((l) => classify(l, alphabet));
  const starts = findQuestionStarts(lines);

  const working: WorkingQuestion[] = [];
  let head: Line | null = null;
  let number: number | undefined;
  let body: Line[] = [];
  let isPreamble = true;

  const flush = () => {
    if (head || body.some((l) => l.kind !== 'blank')) {
      working.push(...parseBlock(number, head, body, isPreamble));
    }
  };

  lines.forEach((l, i) => {
    if (starts.has(i)) {
      flush();
      head = l;
      number = l.num;
      body = [];
      isPreamble = false;
      return;
    }
    // Zanjirga kirmagan raqamli qator — oddiy matn (yoki harfsiz variant)
    body.push(l);
  });
  flush();

  return finalizeQuestions(toRaw(working), key);
}

/* ------------------------------------------------------------------ */
/* Sifatni baholash                                                    */
/* ------------------------------------------------------------------ */

export interface ParseQuality {
  /** 0..1 — qanchalik ishonchli */
  score: number;
  /** Natija yetarlicha yaxshi (AI kerak emas) */
  good: boolean;
  reasons: string[];
}

/**
 * Tahlil natijasini baholash: tuzilmasi buzilgan savollar (variantlar soni
 * noto'g'ri, matn bo'sh, variantlar soni boshqalardan keskin farq qiladi)
 * va javobi aniqlanmagan savollar ulushi.
 */
export function assessParseQuality(result: ParseResult): ParseQuality {
  const qs = result.questions;
  if (qs.length === 0) return { score: 0, good: false, reasons: ['savollar topilmadi'] };

  const reasons: string[] = [];
  const structural = qs.filter(
    (q) => q.text.length >= 2 && q.options.length >= 2 && q.options.length <= 8 && q.options.every((o) => o.text.length <= 400),
  ).length;
  const structuralRatio = structural / qs.length;
  if (structuralRatio < 0.95) reasons.push(`tuzilmasi buzilgan savollar: ${qs.length - structural}`);

  // Variantlar soni: ko'pchilik savolda 4 ta bo'lsa, 1-2 yoki 7-8 talilari shubhali
  const counts = new Map<number, number>();
  for (const q of qs) counts.set(q.options.length, (counts.get(q.options.length) ?? 0) + 1);
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const outliers = qs.filter((q) => Math.abs(q.options.length - mode) >= 2).length;
  const outlierRatio = qs.length >= 5 ? outliers / qs.length : 0;
  if (outlierRatio > 0.1) reasons.push(`variantlar soni notekis: ${outliers} ta savol`);

  const correctRatio = result.stats.withCorrect / qs.length;
  if (correctRatio < 0.9) reasons.push(`javobi aniqlanmagan: ${result.stats.needsReview} ta`);

  const score = structuralRatio * 0.55 + (1 - outlierRatio) * 0.15 + correctRatio * 0.3;
  return { score, good: structuralRatio >= 0.95 && outlierRatio <= 0.1 && correctRatio >= 0.9, reasons };
}

/* ------------------------------------------------------------------ */
/* Yordamchilar                                                        */
/* ------------------------------------------------------------------ */

/** "Birinchi variant har doim to'g'ri" qoidasini qo'llash */
export function applyFirstIsCorrect(questions: Question[]): Question[] {
  return questions.map((q) => ({ ...q, correctIndex: q.options.length > 0 ? 0 : -1 }));
}

/** Tashqi javoblar kalitini qo'llash: "1-A, 2-B" yoki jadval ko'rinishidagi matn */
export function applyAnswerKeyText(questions: Question[], keyText: string): Question[] {
  const text = normalizeText(keyText);
  const key = collectKey(text.split('\n'), detectAlphabet(text));
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
