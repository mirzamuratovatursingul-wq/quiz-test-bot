import type { Api } from 'grammy';
import { config } from '../config.js';
import { logger } from '../logger.js';

const FILE_BASE = `https://api.telegram.org/file/bot${config.BOT_TOKEN}`;

/** Telegram serveridan faylni buffer sifatida yuklab olish */
export async function downloadTelegramFile(api: Api, fileId: string): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error('Fayl yoʻli topilmadi');
  const res = await fetch(`${FILE_BASE}/${file.file_path}`);
  if (!res.ok) throw new Error(`Faylni yuklab boʻlmadi: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface CachedAvatar {
  buffer: Buffer | null;
  at: number;
}

const avatarCache = new Map<number, CachedAvatar>();
const AVATAR_TTL = 6 * 3600 * 1000;

/** Foydalanuvchining profil rasmini olish (yo'q bo'lsa null) */
export async function fetchUserAvatar(api: Api, userId: number): Promise<Buffer | null> {
  const cached = avatarCache.get(userId);
  if (cached && Date.now() - cached.at < AVATAR_TTL) return cached.buffer;

  try {
    const photos = await api.getUserProfilePhotos(userId, { limit: 1 });
    const set = photos.photos[0];
    if (!set || set.length === 0) {
      avatarCache.set(userId, { buffer: null, at: Date.now() });
      return null;
    }
    // Eng sifatli (oxirgi) o'lchamni olamiz, lekin 640px dan katta emas
    const photo = set[set.length - 1]!;
    const buffer = await downloadTelegramFile(api, photo.file_id);
    avatarCache.set(userId, { buffer, at: Date.now() });
    return buffer;
  } catch (err) {
    logger.debug(`Avatar olinmadi (${userId})`, err);
    avatarCache.set(userId, { buffer: null, at: Date.now() });
    return null;
  }
}

/** Foydalanuvchining ko'rinadigan ismi */
export function displayName(user: { first_name?: string; last_name?: string; username?: string }): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || 'Foydalanuvchi';
}

/** HTML uchun xavfsiz matn */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
