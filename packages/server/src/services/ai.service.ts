import { z } from 'zod';
import type { RawQuestion } from '@testrace/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Google Gemini orqali testni ajratib olish.
 *
 * PDF ning o'zi yuboriladi: model sahifani "ko'radi", shuning uchun skaner PDF,
 * ikki ustunli sahifa, qalin/rangli qilib belgilangan to'g'ri javob ham tushuniladi.
 * Javob qat'iy JSON sxemada qaytadi va zod bilan tekshiriladi.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
/** So'rov hajmi chegarasi 20 MB; base64 ~33% kattalashtiradi */
const MAX_INLINE_PDF_BYTES = 14 * 1024 * 1024;
/** Juda uzun matn bo'laklarga bo'linadi (javob tokenlari yetishi uchun) */
const TEXT_CHUNK_CHARS = 40_000;
const REQUEST_TIMEOUT_MS = 120_000;

export class AiError extends Error {
  constructor(
    message: string,
    /** HTTP holati (404 — model eskirgan/topilmadi) */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Sozlangan modellar eskirganda API dan topilgan ishlaydigan model (jarayon davomida eslab qolinadi) */
let discoveredModel: string | null = null;

export function isAiEnabled(): boolean {
  return Boolean(config.GEMINI_API_KEY) && config.AI_MODE !== 'off';
}

const PROMPT = `You extract multiple-choice test questions from the attached document.
The document may be in Uzbek (Latin or Cyrillic), Russian, English, Karakalpak or another language, and may be formatted in any way.

Rules:
1. Return EVERY question in document order. Do not skip, merge, split, reorder or invent questions.
2. Copy question and option text verbatim in the original language and script. Keep formulas, numbers and punctuation.
3. Remove only the numbering ("1.", "1)", "№1", "1-savol"), option letters ("A)", "B.", "а)", "(C)") and correct-answer markers (+, *, #, ✓) from the text.
4. A question may span several lines; a long option may wrap onto the next line — join such lines with a space. A wrapped line is NOT a new question and NOT a new option.
5. Several options may be on one line ("A) 12  B) 14  C) 16"), or on the same line as the question — split them.
6. "c" = 0-based index of the correct option, ONLY if the document marks it:
   - a "+" (or *, #, ✓) before or after the option, or the option written as "#Option" / "+: Option";
   - the option is bold, underlined, highlighted or colored differently from the other options of that question;
   - an answer line under the question ("Javob: B", "Ответ: B");
   - an answer key anywhere in the document ("1-A, 2-C", or a table of numbers and letters).
   If nothing marks the answer, set "c" to -1. NEVER solve the question yourself and never guess.
7. Ignore titles, headers, footers, page numbers, instructions, student name fields and the answer key itself.
8. Each question must have 2 to 8 options.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          q: { type: 'STRING', description: 'Question text' },
          o: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Option texts in order' },
          c: { type: 'INTEGER', description: '0-based index of the marked correct option, or -1' },
        },
        required: ['q', 'o', 'c'],
        propertyOrdering: ['q', 'o', 'c'],
      },
    },
  },
  required: ['questions'],
};

const responseSchema = z.object({
  questions: z.array(
    z.object({
      q: z.string(),
      o: z.array(z.string()),
      c: z.number().int(),
    }),
  ),
});

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Javob token chegarasida uzilib qolsa (finishReason=MAX_TOKENS), JSON oxiri yo'q bo'ladi.
 * Shu holatda oxirgi to'liq savolgacha qirqib, massivni yopamiz.
 */
function parseJsonLenient(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const lastObject = raw.lastIndexOf('}');
    for (let end = lastObject; end > 0; end = raw.lastIndexOf('}', end - 1)) {
      try {
        return JSON.parse(`${raw.slice(0, end + 1)}]}`);
      } catch {
        /* keyingi "}" ni sinaymiz */
      }
    }
    throw new AiError('AI javobi JSON emas');
  }
}

async function callModel(model: string, parts: Part[]): Promise<RawQuestion[]> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY ?? '' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [...parts, { text: PROMPT }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    throw new AiError(`Gemini ${res.status}: ${data.error?.message ?? res.statusText}`, res.status);
  }
  if (data.promptFeedback?.blockReason) {
    throw new AiError(`Gemini soʻrovni rad etdi: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text) throw new AiError(`Gemini boʻsh javob qaytardi (${candidate?.finishReason ?? 'nomaʼlum'})`);
  if (candidate?.finishReason === 'MAX_TOKENS') {
    logger.warn('Gemini javobi token chegarasida uzildi — oxirgi savollar tushib qolishi mumkin');
  }

  const parsed = responseSchema.safeParse(parseJsonLenient(text));
  if (!parsed.success) throw new AiError('AI javobi kutilgan tuzilmada emas');

  return parsed.data.questions.map((item) => {
    const options = item.o.map((o) => o.trim()).filter(Boolean);
    return {
      text: item.q.trim(),
      options: options.map((o) => ({ text: o, correct: false })),
      correctIndex: item.c >= 0 && item.c < options.length ? item.c : undefined,
    };
  });
}

/** Model nomidagi versiya: "gemini-3.8-flash" -> 3.8 */
function modelVersion(name: string): number {
  return Number(/gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);
}

/**
 * API dan generateContent ni qo'llaydigan eng yangi "flash" modelni topish.
 * Barqaror (preview/exp bo'lmagan), to'liq (lite bo'lmagan) modellar afzal.
 */
async function discoverModels(): Promise<string[]> {
  const res = await fetch(`${API_BASE}?pageSize=1000`, {
    headers: { 'x-goog-api-key': config.GEMINI_API_KEY ?? '' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new AiError(`Gemini modellar roʻyxati: ${res.status}`, res.status);
  const data = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };

  const penalty = (n: string) =>
    (/preview|exp/.test(n) ? 2 : 0) + (/lite/.test(n) ? 1 : 0);
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((n) => /^gemini-.*flash/.test(n) && !/image|tts|audio|live|embedding|thinking/.test(n))
    .sort((a, b) => penalty(a) - penalty(b) || modelVersion(b) - modelVersion(a))
    .slice(0, 4);
}

/** Vaqtinchalik xato: server band (503), ichki xato (5xx) yoki tarmoq uzilishi */
function isTransient(err: unknown): boolean {
  if (err instanceof AiError) return err.status !== undefined && err.status >= 500;
  // fetch tarmoq xatosi (TypeError). Timeout (120 s) qayta urinishga arzimaydi.
  return err instanceof TypeError;
}

/** Qayta urinishlar orasidagi kutish (ms): band server odatda bir necha soniyada bo'shaydi */
const RETRY_DELAYS_MS = [2_000, 5_000];

async function tryModel(model: string, parts: Part[]): Promise<RawQuestion[]> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const questions = await callModel(model, parts);
      logger.info(`AI tahlil: ${model}, ${questions.length} ta savol, ${Date.now() - started} ms`);
      return questions;
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransient(err)) throw err;
      logger.warn(
        `AI modeli ${model} vaqtincha javob bermadi (${err instanceof Error ? err.message : String(err)}), ` +
          `${delay / 1000} s dan keyin qayta urinish`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Modellarni navbat bilan sinash.
 *   - 5xx / tarmoq — shu modelning o'zi bir necha marta qayta sinaladi (tryModel);
 *   - sozlanganlar eskirgan (404), band (5xx) yoki limiti tugagan (429) bo'lsa — xato
 *     matnidagi tavsiya ("use models/X") va API dagi boshqa "flash" modellar sinaladi;
 *   - 400/401/403 (kalit yoki so'rov xatosi) — boshqa modelda ham takrorlanadi, sinalmaydi.
 * Eskirgan model o'rniga topilgani eslab qolinadi.
 */
async function callWithFallback(parts: Part[]): Promise<RawQuestion[]> {
  const configured = discoveredModel ? [discoveredModel, ...config.GEMINI_MODEL] : config.GEMINI_MODEL;
  const tried = new Set<string>();
  const suggested: string[] = [];
  let lastError: unknown;
  let allNotFound = true;
  let canSwitch = true;

  const attempt = async (model: string): Promise<RawQuestion[] | null> => {
    if (tried.has(model)) return null;
    tried.add(model);
    try {
      return await tryModel(model, parts);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`AI modeli ${model} ishlamadi: ${message}`);
      if (!(err instanceof AiError && err.status === 404)) allNotFound = false;
      if (err instanceof AiError && (err.status === 400 || err.status === 401 || err.status === 403)) canSwitch = false;
      // "...Please update your code to use models/gemini-3.8-flash for the latest features"
      const hint = /models\/(gemini-[a-z0-9.-]*[a-z0-9])/i.exec(message.split(' use ')[1] ?? '');
      if (hint?.[1]) suggested.push(hint[1]);
      return null;
    }
  };

  for (const model of configured) {
    const result = await attempt(model);
    if (result) return result;
  }

  if (canSwitch) {
    const remember = (model: string, result: RawQuestion[]) => {
      if (allNotFound) {
        discoveredModel = model;
        logger.warn(`Sozlangan Gemini modellari eskirgan — "${model}" ishlatildi. .env dagi GEMINI_MODEL ni yangilang.`);
      } else {
        logger.info(`Asosiy model band edi — bu safar "${model}" ishlatildi`);
      }
      return result;
    };
    // Avval Google xato matnida tavsiya qilgan model, keyin API dagi ro'yxat
    for (const model of [...suggested]) {
      const result = await attempt(model);
      if (result) return remember(model, result);
    }
    let listed: string[] = [];
    try {
      listed = await discoverModels();
    } catch (err) {
      logger.warn(`Mavjud modellarni aniqlab boʻlmadi: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const model of listed) {
      const result = await attempt(model);
      if (result) return remember(model, result);
    }
  }

  throw lastError instanceof Error ? lastError : new AiError('AI tahlil qilib boʻlmadi');
}

/** Uzun matnni savol chegaralari bo'yicha bo'laklash */
function chunkText(text: string): string[] {
  if (text.length <= TEXT_CHUNK_CHARS) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    const isQuestionStart = /^\s*(?:\d{1,3}\s*[.)]|\d{1,3}\s*-\s*savol|\?|S\s*:|\+{3,}|<question)/i.test(line);
    if (size >= TEXT_CHUNK_CHARS && isQuestionStart) {
      chunks.push(current.join('\n'));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

/**
 * Testni AI bilan ajratish.
 * PDF berilsa va hajmi ruxsat etilgan bo'lsa — PDF ning o'zi (formatlash ham ko'rinadi),
 * aks holda ajratib olingan matn yuboriladi.
 */
export async function aiExtractQuestions(input: { pdf?: Buffer; text?: string }): Promise<RawQuestion[]> {
  if (!isAiEnabled()) throw new AiError('AI yoqilmagan (GEMINI_API_KEY yoʻq)');

  const text = input.text?.trim() ?? '';
  const pdfFits = input.pdf && input.pdf.length <= MAX_INLINE_PDF_BYTES;
  // Juda katta matnli PDF da bitta javob tokenlarga sig'masligi mumkin — matnni bo'laklab yuboramiz
  if (input.pdf && pdfFits && text.length <= TEXT_CHUNK_CHARS * 2) {
    return callWithFallback([{ inline_data: { mime_type: 'application/pdf', data: input.pdf.toString('base64') } }]);
  }

  if (!text) {
    throw new AiError(
      input.pdf ? 'PDF juda katta va ichida matn yoʻq (skaner). Faylni boʻlib yuboring.' : 'Tahlil uchun matn yoʻq',
    );
  }

  const results: RawQuestion[] = [];
  for (const chunk of chunkText(text)) {
    results.push(...(await callWithFallback([{ text: `DOCUMENT:\n${chunk}` }])));
  }
  return results;
}
