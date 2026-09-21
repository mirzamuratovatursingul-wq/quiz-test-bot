import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { logger } from '../logger.js';

export type SourceType = 'pdf' | 'docx' | 'text';

export interface ExtractResult {
  text: string;
  sourceType: SourceType;
  pages?: number;
}

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

/** Fayl nomidan turini aniqlash */
export function detectSourceType(fileName: string, mimeType?: string): SourceType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  if (
    lower.endsWith('.docx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) return 'text';
  if (lower.endsWith('.doc')) {
    throw new ExtractError(
      'Eski .doc format qoʻllab-quvvatlanmaydi. Faylni .docx yoki PDF koʻrinishida saqlab yuboring.',
    );
  }
  throw new ExtractError(
    'Faqat PDF, DOCX va TXT fayllar qabul qilinadi. Yoki testni oddiy matn qilib yuboring.',
  );
}

/** Word (.docx) dan matn: "+" belgisi bo'lmasa, qalin (bold) variantni "+" bilan belgilaydi */
async function extractDocx(buffer: Buffer): Promise<string> {
  const html = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: ['b => strong', 'i => em'],
    },
  );
  const raw = await mammoth.extractRawText({ buffer });
  const plain = raw.value ?? '';

  if (plain.includes('+')) return plain;

  // "+" yo'q -> bold matnlarni to'g'ri javob deb belgilashga urinamiz
  const boldTexts = new Set<string>();
  for (const m of (html.value ?? '').matchAll(/<strong>(.*?)<\/strong>/gs)) {
    const t = (m[1] ?? '').replace(/<[^>]+>/g, '').trim();
    if (t.length > 1) boldTexts.add(t);
  }
  if (boldTexts.size === 0) return plain;

  return plain
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      for (const bold of boldTexts) {
        if (trimmed.endsWith(bold) && /^[A-Ha-h]\s*[).:\]]/.test(trimmed)) return `+${trimmed}`;
      }
      return line;
    })
    .join('\n');
}

/** PDF/DOCX/TXT bufferdan toza matn ajratib olish */
export async function extractText(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<ExtractResult> {
  const sourceType = detectSourceType(fileName, mimeType);

  try {
    if (sourceType === 'pdf') {
      const res = await pdfParse(buffer);
      const text = (res.text ?? '').trim();
      if (!text) {
        throw new ExtractError(
          'PDF ichidan matn topilmadi. Ehtimol u skaner (rasm) koʻrinishida. Matnli PDF yoki Word yuboring.',
        );
      }
      return { text, sourceType, pages: res.numpages };
    }

    if (sourceType === 'docx') {
      const text = (await extractDocx(buffer)).trim();
      if (!text) throw new ExtractError('Word faylidan matn topilmadi.');
      return { text, sourceType };
    }

    return { text: buffer.toString('utf8').trim(), sourceType };
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    logger.error('extractText xatosi', err);
    throw new ExtractError(
      'Faylni oʻqib boʻlmadi. Fayl buzilmaganini tekshirib, qayta yuboring.',
    );
  }
}
