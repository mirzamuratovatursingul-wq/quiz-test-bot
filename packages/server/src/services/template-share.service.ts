import { randomInt } from 'node:crypto';
import {
  normalizeShareCode,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
  type SharedTemplatePreviewDTO,
} from '@testrace/shared';
import { config } from '../config.js';
import { Template, User, type TemplateDoc } from '../db/models.js';

/**
 * Shablonni ulashish: egasi noyob kod oladi, boshqa foydalanuvchi shu kod bilan
 * shablonning MUSTAQIL nusxasini o'z ro'yxatiga qo'shadi. Nusxada savollar to'liq
 * saqlanadi — asl shablon o'zgarsa yoki o'chirilsa ham nusxa ishlayveradi.
 * Nusxa egasi uni o'zi admin bo'lgan guruhlarda odatdagidek ishlatadi.
 */

export class ShareError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid_code' | 'own_template',
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) code += SHARE_CODE_ALPHABET[randomInt(SHARE_CODE_ALPHABET.length)];
  return code;
}

/** Bot orqali nusxa olish havolasi (bot username ma'lum bo'lsa) */
export function shareLink(code: string): string | null {
  return config.BOT_USERNAME ? `https://t.me/${config.BOT_USERNAME}?start=copy_${code}` : null;
}

/** Shablonning ulashish kodi: bor bo'lsa o'sha, yo'q bo'lsa yangisi (to'qnashuvda qayta urinadi) */
export async function ensureShareCode(template: TemplateDoc): Promise<string> {
  if (template.shareCode) return template.shareCode;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      const updated = await Template.findOneAndUpdate(
        { _id: template._id, shareCode: { $exists: false } },
        { $set: { shareCode: code } },
        { new: true },
      );
      // Parallel so'rov kodni allaqachon yozgan bo'lsa — o'shani qaytaramiz
      if (!updated) {
        const fresh = await Template.findById(template._id);
        if (fresh?.shareCode) return fresh.shareCode;
        throw new ShareError('Shablon topilmadi', 'not_found');
      }
      return code;
    } catch (err) {
      // 11000 — kod boshqa shablonda band (sparse unique indeks), boshqasini sinaymiz
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  throw new Error('Noyob kod yaratib boʻlmadi');
}

export async function revokeShareCode(templateId: unknown, ownerId: number): Promise<boolean> {
  const res = await Template.updateOne({ _id: templateId, ownerId }, { $unset: { shareCode: 1 } });
  return res.matchedCount > 0;
}

async function findByCode(rawCode: string): Promise<{ code: string; template: TemplateDoc }> {
  const code = normalizeShareCode(rawCode);
  if (!code) throw new ShareError(`Kod ${SHARE_CODE_LENGTH} ta harf/raqamdan iborat boʻladi, masalan: K7M2QX`, 'invalid_code');
  const template = await Template.findOne({ shareCode: code });
  if (!template) {
    throw new ShareError('Bu kod boʻyicha shablon topilmadi. Ehtimol, egasi uni oʻchirgan yoki kodni bekor qilgan.', 'not_found');
  }
  return { code, template };
}

async function ownerName(ownerId: number): Promise<string> {
  const owner = await User.findOne({ telegramId: ownerId }).select('firstName username');
  return owner?.firstName || (owner?.username ? `@${owner.username}` : 'Foydalanuvchi');
}

/** Nusxa olishdan oldin ko'rsatish uchun */
export async function previewByCode(rawCode: string, userId: number): Promise<SharedTemplatePreviewDTO> {
  const { code, template } = await findByCode(rawCode);
  const existing = await Template.findOne({ ownerId: userId, 'copiedFrom.templateId': template._id }).select('_id');
  return {
    code,
    title: template.title,
    questions: template.questions.length,
    ownerName: await ownerName(template.ownerId),
    timePerQuestion: template.settings?.timePerQuestion ?? 15,
    isOwn: template.ownerId === userId,
    alreadyCopiedId: existing ? String(existing._id) : null,
  };
}

/**
 * Kod bo'yicha nusxa olish. Bir shablonni ikki marta olsa — yangi nusxa yaratilmaydi,
 * mavjudi qaytariladi (`already: true`).
 */
export async function copyByCode(
  rawCode: string,
  userId: number,
): Promise<{ template: TemplateDoc; already: boolean }> {
  const { code, template: source } = await findByCode(rawCode);
  if (source.ownerId === userId) {
    throw new ShareError('Bu oʻzingizning shablongiz — u roʻyxatingizda bor.', 'own_template');
  }

  const existing = await Template.findOne({ ownerId: userId, 'copiedFrom.templateId': source._id });
  if (existing) return { template: existing, already: true };

  const copy = await Template.create({
    ownerId: userId,
    title: source.title,
    description: source.description,
    subject: source.subject,
    status: 'ready',
    // Savollar va sozlamalar to'liq ko'chiriladi — asl shablonga bog'liqlik yo'q
    questions: source.questions.map((q) => ({
      text: q.text,
      options: q.options.map((o) => ({ text: o.text })),
      correctIndex: q.correctIndex,
      explanation: q.explanation ?? undefined,
    })),
    settings: source.settings,
    sourceType: source.sourceType,
    sourceFileName: source.sourceFileName,
    copiedFrom: {
      templateId: source._id,
      ownerId: source.ownerId,
      ownerName: await ownerName(source.ownerId),
      code,
      at: new Date(),
    },
  });
  await User.updateOne({ telegramId: userId }, { $inc: { 'stats.templatesCount': 1 } });
  return { template: copy, already: false };
}
