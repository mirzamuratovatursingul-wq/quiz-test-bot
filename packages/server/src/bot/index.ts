import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { touchUser } from '../services/user-touch.service.js';
import { RaceEngine } from '../race/engine.js';
import { registerGroupHandlers } from './handlers/group.js';
import { registerPrivateHandlers } from './handlers/private.js';
import { isHttps, webAppUrl } from './keyboards.js';

export interface BotBundle {
  bot: Bot;
  engine: RaceEngine;
}

let bundle: BotBundle | null = null;

export function getBot(): BotBundle {
  if (!bundle) throw new Error('Bot hali ishga tushmagan');
  return bundle;
}

export function createBot(): BotBundle {
  const bot = new Bot(config.BOT_TOKEN);
  const engine = new RaceEngine(bot);

  /* Foydalanuvchini bazada yangilab turish (ko'pi bilan 10 daqiqada bir marta) */
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (from && !from.is_bot) touchUser(from);
    await next();
  });

  registerPrivateHandlers(bot);
  registerGroupHandlers(bot, engine);

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) logger.error(`Telegram API xatosi: ${e.description}`);
    else if (e instanceof HttpError) logger.error('Telegram bilan aloqa xatosi', e);
    else logger.error('Botda kutilmagan xato', e);
  });

  bundle = { bot, engine };
  return bundle;
}

export async function startBot(): Promise<BotBundle> {
  const b = bundle ?? createBot();

  const stale = await RaceEngine.cleanupStale();
  if (stale > 0) logger.info(`${stale} ta tugallanmagan musobaqa yopildi`);
  const restored = await b.engine.restoreUntimed().catch((err: unknown) => {
    logger.error('Vaqtsiz testlarni tiklab boʻlmadi', err);
    return 0;
  });
  if (restored > 0) logger.info(`${restored} ta ochiq vaqtsiz test tiklandi`);

  // Token to'g'riligini eng avval tekshiramiz — xato bo'lsa tushunarli xabar chiqadi
  const me = await b.bot.api.getMe().catch((err: unknown) => {
    if (err instanceof GrammyError && err.error_code === 401) {
      logger.error(
        'BOT_TOKEN notoʻgʻri yoki eskirgan. @BotFather dan yangi token oling va .env ni yangilang.',
      );
      process.exit(1);
    }
    throw err;
  });

  const privateCommands = [
    { command: 'start', description: 'Botni ishga tushirish' },
    { command: 'shablonlarim', description: 'Saqlangan test shablonlari' },
    { command: 'statistika', description: 'Shaxsiy statistika' },
    { command: 'nusxa', description: 'Kod orqali shablon nusxasini olish' },
    { command: 'yordam', description: "Qoʻllanma" },
  ];
  await b.bot.api.setMyCommands(privateCommands, { scope: { type: 'all_private_chats' } });
  // /admin faqat adminlarning menyusida (admin botga hali yozmagan bo'lsa Telegram rad etadi — e'tiborsiz)
  for (const adminId of config.ADMIN_IDS) {
    await b.bot.api
      .setMyCommands([...privateCommands, { command: 'admin', description: 'Bot statistikasi (admin)' }], {
        scope: { type: 'chat', chat_id: adminId },
      })
      .catch(() => undefined);
  }
  await b.bot.api.setMyCommands(
    [
      { command: 'boshlash', description: 'Musobaqani boshlash' },
      { command: 'toxtat', description: "Musobaqani toʻxtatish" },
      { command: 'yakunlash', description: 'Vaqtsiz testni yakunlash va natijalar' },
      { command: 'holat', description: 'Joriy musobaqa holati' },
    ],
    { scope: { type: 'all_group_chats' } },
  );

  await syncMenuButton(b);

  if (!config.BOT_USERNAME) config.BOT_USERNAME = me.username;
  logger.info(`Bot ishga tushdi: @${me.username}`);

  // long polling (webhook kerak bo'lsa alohida yoqiladi).
  // poll_answer — quiz so'rovnomasidagi javoblar uchun majburiy.
  void b.bot.start({
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query', 'poll_answer', 'my_chat_member'],
    onStart: () => logger.info('Long polling boshlandi'),
  });

  return b;
}

/**
 * Shaxsiy chatdagi menyu tugmasi: HTTPS bo'lsa "Panel" (Mini App) doim yozish maydoni yonida turadi.
 * WEBAPP_URL o'zgarganda qayta chaqiriladi.
 */
export async function syncMenuButton(b: BotBundle | null = bundle): Promise<void> {
  if (!b) return;
  const url = webAppUrl('/');
  try {
    await b.bot.api.setChatMenuButton({
      menu_button: isHttps(url)
        ? { type: 'web_app', text: 'Panel', web_app: { url } }
        : { type: 'commands' },
    });
  } catch (err) {
    logger.warn('Menyu tugmasini oʻrnatib boʻlmadi', err);
  }
}

export async function stopBot(): Promise<void> {
  if (bundle) await bundle.bot.stop();
}
