import dotenv from 'dotenv';
import fs from 'node:fs';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** packages/server/src (dev) yoki packages/server/dist (prod) -> repo ildizi */
export const ROOT_DIR = path.resolve(here, '../../..');

/**
 * .env ni loyiha ildizidan o'qiymiz.
 * `npm run dev -w @testrace/server` jarayonni packages/server ichida ishga tushiradi,
 * shuning uchun dotenv ning standart (joriy papka) yo'li yetarli emas.
 */
const ENV_CANDIDATES = [
  path.join(ROOT_DIR, '.env'),
  path.join(process.cwd(), '.env'),
  path.join(ROOT_DIR, 'packages', 'server', '.env'),
];

for (const candidate of ENV_CANDIDATES) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate, override: false });
}

const ENV_FILE = ENV_CANDIDATES.find((c) => fs.existsSync(c));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN .env faylda koʻrsatilmagan'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/testrace'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** Mini App ochiladigan HTTPS manzil (ishlab chiqishda ngrok/localtunnel) */
  WEBAPP_URL: z.string().url().default('http://localhost:5173'),
  /** Bot username (deep-link uchun). @ belgisi yozilsa ham o'zi olib tashlanadi */
  BOT_USERNAME: z
    .string()
    .optional()
    .transform((v) => v?.trim().replace(/^@+/, '') || undefined),
  /** Vergul bilan ajratilgan admin Telegram ID lar */
  ADMIN_IDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  MAX_FILE_MB: z.coerce.number().default(20),
  /** Mini App initData ning eskirish muddati (sekund) */
  INITDATA_TTL: z.coerce.number().default(86400),
  /** Web build'ni server orqali tarqatish (bitta deploy) */
  SERVE_WEB: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`❌ Konfiguratsiya xatosi (.env faylni tekshiring):\n${issues}`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  fontsDir: path.join(ROOT_DIR, 'assets', 'fonts'),
  webDistDir: path.join(ROOT_DIR, 'packages', 'web', 'dist'),
};

export function isAdmin(telegramId: number): boolean {
  return config.ADMIN_IDS.includes(telegramId);
}

/**
 * .env faylini kuzatib borish.
 *
 * `npm run tunnel` har safar yangi HTTPS manzil beradi va uni .env ga yozadi.
 * Shu tufayli server qayta ishga tushirilmasa ham, Mini App tugmasi
 * doim eng oxirgi manzilni ko'rsatishi kerak.
 */
export function watchEnvFile(onChange?: (changed: Record<string, string>) => void): void {
  if (!ENV_FILE) return;

  let timer: NodeJS.Timeout | undefined;
  fs.watch(ENV_FILE, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const parsed = dotenv.parse(fs.readFileSync(ENV_FILE, 'utf8'));
        const changed: Record<string, string> = {};

        const nextUrl = parsed.WEBAPP_URL?.trim();
        if (nextUrl && /^https?:\/\//.test(nextUrl) && nextUrl !== config.WEBAPP_URL) {
          config.WEBAPP_URL = nextUrl;
          changed.WEBAPP_URL = nextUrl;
        }

        const nextBot = parsed.BOT_USERNAME?.trim().replace(/^@+/, '');
        if (nextBot && nextBot !== config.BOT_USERNAME) {
          config.BOT_USERNAME = nextBot;
          changed.BOT_USERNAME = nextBot;
        }

        if (Object.keys(changed).length > 0) onChange?.(changed);
      } catch {
        /* fayl yozilayotgan payt bo'lishi mumkin — keyingi o'zgarishda o'qiymiz */
      }
    }, 300);
  });
}

/** Ishga tushishdan oldin ko'p uchraydigan sozlama xatolarini ogohlantirish */
export function warnAboutConfig(): string[] {
  const warnings: string[] = [];

  if (/xxxx|example\.com|localhost|127\.0\.0\.1/i.test(config.WEBAPP_URL)) {
    warnings.push(
      `WEBAPP_URL hali toʻgʻri emas (${config.WEBAPP_URL}). Telegram Mini App faqat HTTPS manzilda ochiladi — ` +
        '"ngrok http 3000" ishga tushiring va olingan manzilni .env dagi WEBAPP_URL ga yozing. ' +
        'Hozircha bot Mini App oʻrniga oddiy havola tugmasini koʻrsatadi.',
    );
  }
  if (!config.BOT_USERNAME) {
    warnings.push(
      'BOT_USERNAME koʻrsatilmagan — bot ishga tushganda Telegram’dan oʻzi aniqlab oladi.',
    );
  }
  return warnings;
}
