import { User } from '../db/models.js';
import { logger } from '../logger.js';

/**
 * Foydalanuvchi ma'lumotini (ism, username, lastSeenAt) bazaga yozishni cheklash.
 *
 * Avval bot HAR BIR yangilanishda (musobaqadagi har bir javob ham) va Mini App har
 * ochilganda bazaga yozardi: 30 kishilik guruhda 20 savol = 600 ta keraksiz yozish.
 * Endi bir foydalanuvchi uchun ko'pi bilan TOUCH_INTERVAL_MS da bir marta yoziladi,
 * ism yoki username o'zgarsa — darhol.
 */

const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
/** Xotira cheksiz o'smasligi uchun */
const MAX_TRACKED = 50_000;

const lastTouch = new Map<number, { at: number; signature: string }>();

export interface TouchUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

function signature(u: TouchUser): string {
  return [u.first_name, u.last_name ?? '', u.username ?? '', u.photo_url ?? ''].join('\u0000');
}

/** Shu foydalanuvchini hozir bazaga yozish kerakmi (va kerak bo'lsa, belgilab qo'yadi) */
export function shouldTouch(u: TouchUser): boolean {
  const now = Date.now();
  const sig = signature(u);
  const prev = lastTouch.get(u.id);
  if (prev && prev.signature === sig && now - prev.at < TOUCH_INTERVAL_MS) return false;
  if (lastTouch.size >= MAX_TRACKED) lastTouch.clear();
  lastTouch.set(u.id, { at: now, signature: sig });
  return true;
}

export function userUpdate(u: TouchUser) {
  return {
    $set: {
      firstName: u.first_name,
      lastName: u.last_name ?? '',
      username: u.username ?? '',
      ...(u.language_code ? { languageCode: u.language_code } : {}),
      ...(u.photo_url ? { photoUrl: u.photo_url } : {}),
      lastSeenAt: new Date(),
    },
    $setOnInsert: { telegramId: u.id },
  };
}

/** Kerak bo'lsa fonda yozish (javobni kutdirmaydi) */
export function touchUser(u: TouchUser): void {
  if (!shouldTouch(u)) return;
  User.updateOne({ telegramId: u.id }, userUpdate(u), { upsert: true }).catch((err) => {
    lastTouch.delete(u.id); // keyingi safar qayta urinadi
    logger.error('Foydalanuvchini saqlashda xato', err);
  });
}
