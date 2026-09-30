import {
  assessParseQuality,
  extractAnswerKey,
  finalizeQuestions,
  normalizeText,
  parseTestText,
  type ParseResult,
} from '@testrace/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { aiExtractQuestions, isAiEnabled } from './ai.service.js';
import { ExtractError, extractText, type SourceType } from './extract.service.js';

/**
 * Testni import qilish: fayl/matn -> savollar.
 *
 *   1. Oddiy (qoidaga asoslangan) tahlilchi — tez va bepul.
 *   2. Natija ishonchsiz bo'lsa (yoki AI_MODE=always) — Gemini.
 *   3. Ikkala natijadan sifat bahosi yuqorisi olinadi; AI ishlamasa oddiy natija qoladi.
 */

export interface ImportResult {
  result: ParseResult;
  engine: 'parser' | 'ai';
  text: string;
  sourceType: SourceType;
}

export interface ImportHooks {
  /** AI ishga tushishidan oldin (bot "AI tahlil qilmoqda…" deb yozishi uchun) */
  onAiStart?: () => void | Promise<void>;
}

/** Sahifaga to'g'ri keladigan matn juda kam bo'lsa — PDF skaner qilingan */
function looksScanned(text: string, pages?: number): boolean {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters < 30 || (pages !== undefined && pages > 0 && letters / pages < 40);
}

function aiResultFrom(questions: Awaited<ReturnType<typeof aiExtractQuestions>>, text: string): ParseResult {
  // AI kalitni o'tkazib yuborgan bo'lsa, matndagi kalitni savol tartibi bo'yicha qo'llaymiz
  const { key } = text ? extractAnswerKey(normalizeText(text)) : { key: new Map<number, number>() };
  return finalizeQuestions(questions, key, 'ai');
}

async function analyze(
  text: string,
  pdf: Buffer | undefined,
  forceAi: boolean,
  hooks: ImportHooks,
): Promise<{ result: ParseResult; engine: 'parser' | 'ai' }> {
  const parsed = text ? parseTestText(text) : finalizeQuestions([]);
  const quality = assessParseQuality(parsed);

  const wantAi = forceAi || config.AI_MODE === 'always' || !quality.good;
  if (!wantAi || !isAiEnabled()) return { result: parsed, engine: 'parser' };

  logger.info(
    `AI tahlilga yuborilmoqda (${forceAi ? 'majburiy' : quality.reasons.join('; ') || config.AI_MODE}), ` +
      `oddiy tahlil: ${parsed.stats.total} ta savol, baho ${quality.score.toFixed(2)}`,
  );

  try {
    await hooks.onAiStart?.();
    const aiResult = aiResultFrom(await aiExtractQuestions({ pdf, text }), text);
    const aiQuality = assessParseQuality(aiResult);

    // AI deyarli bo'sh qaytargan bo'lsa (masalan, javob uzilgan) — oddiy natija qoladi
    const aiComplete = aiResult.stats.total >= parsed.stats.total * 0.8;
    if (aiResult.stats.total > 0 && (aiComplete || aiQuality.score > quality.score)) {
      logger.info(
        `AI natijasi olindi: ${aiResult.stats.total} ta savol, javobi aniq ${aiResult.stats.withCorrect} ta ` +
          `(oddiy tahlilda ${parsed.stats.withCorrect} ta), baho ${aiQuality.score.toFixed(2)}`,
      );
      return { result: aiResult, engine: 'ai' };
    }
    logger.warn(`AI natijasi oddiy tahlildan yaxshi emas (${aiResult.stats.total} ta savol) — oddiy natija olindi`);
  } catch (err) {
    logger.error('AI tahlil xatosi', err instanceof Error ? err.message : err);
  }
  return { result: parsed, engine: 'parser' };
}

/** Fayldan import (PDF / DOCX / TXT) */
export async function importTestFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
  hooks: ImportHooks = {},
): Promise<ImportResult> {
  const aiReady = isAiEnabled();
  const extracted = await extractText(buffer, fileName, mimeType, { allowEmptyPdf: aiReady });
  const pdf = extracted.sourceType === 'pdf' ? buffer : undefined;
  const scanned = extracted.sourceType === 'pdf' && looksScanned(extracted.text, extracted.pages);

  if (scanned && !aiReady) {
    throw new ExtractError(
      'PDF ichidan matn topilmadi. Ehtimol u skaner (rasm) koʻrinishida. Matnli PDF yoki Word yuboring.',
    );
  }

  const { result, engine } = await analyze(scanned ? '' : extracted.text, pdf, scanned, hooks);
  if (scanned && result.questions.length === 0) {
    throw new ExtractError(
      'Skaner (rasmli) PDF ni oʻqib boʻlmadi. Sifatliroq skaner, matnli PDF yoki Word yuboring.',
    );
  }
  return { result, engine, text: extracted.text, sourceType: extracted.sourceType };
}

/** Matndan import (bot xabari yoki Mini App dagi nusxa-joylashtirish) */
export async function importTestText(text: string, hooks: ImportHooks = {}): Promise<ImportResult> {
  const { result, engine } = await analyze(text, undefined, false, hooks);
  return { result, engine, text, sourceType: 'text' };
}
