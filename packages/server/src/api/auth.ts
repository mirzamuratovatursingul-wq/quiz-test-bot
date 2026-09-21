import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    tgUser?: TelegramWebAppUser;
  }
}

/**
 * Telegram Mini App initData ni tekshirish.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData: string): TelegramWebAppUser | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.BOT_TOKEN).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > config.INITDATA_TTL) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  try {
    const user = JSON.parse(userRaw) as TelegramWebAppUser;
    return typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

/** Ishlab chiqish rejimida initData bo'lmasa, DEV_USER_ID orqali kirish */
function devUser(): TelegramWebAppUser | null {
  if (config.isProd) return null;
  const id = Number(process.env.DEV_USER_ID ?? 0);
  if (!id) return null;
  return { id, first_name: 'Dev', username: 'dev_user' };
}

/** Himoyalangan yo'llar uchun preHandler */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = req.query as { initData?: string } | undefined;
  const header =
    (req.headers['x-init-data'] as string | undefined) ??
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('tma ')
      ? req.headers.authorization.slice(4)
      : undefined) ??
    // <img src> kabi so'rovlar sarlavha yubora olmaydi
    query?.initData;

  const user = (header ? verifyInitData(header) : null) ?? devUser();

  if (!user) {
    await reply.code(401).send({
      error: 'unauthorized',
      message:
        'Telegram autentifikatsiyasi amalga oshmadi. Mini App’ni Telegram ichidan oching.',
    });
    return;
  }
  req.tgUser = user;
}

export function currentUser(req: FastifyRequest): TelegramWebAppUser {
  if (!req.tgUser) throw new Error('Foydalanuvchi aniqlanmagan');
  return req.tgUser;
}
