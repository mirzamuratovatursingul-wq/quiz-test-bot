import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from '../config.js';
import { User } from '../db/models.js';
import { logger } from '../logger.js';
import { RaceEngine } from '../race/engine.js';
import { registerGroupHandlers } from './handlers/group.js';
import { registerPrivateHandlers } from './handlers/private.js';

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

  /* Foydalanuvchini bazada yangilab turish */
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (from && !from.is_bot) {
      void User.updateOne(
        { telegramId: from.id },
        {
          $set: {
            firstName: from.first_name,
            lastName: from.last_name ?? '',
            username: from.username ?? '',
            languageCode: from.language_code ?? 'uz',
            lastSeenAt: new Date(),
          },
          $setOnInsert: { telegramId: from.id },
        },
        { upsert: true },
      ).catch((err) => logger.error('Foydalanuvchini saqlashda xato', err));
    }
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

  await b.bot.api.setMyCommands(
    [
      { command: 'start', description: 'Botni ishga tushirish' },
      { command: 'shablonlarim', description: 'Saqlangan test shablonlari' },
      { command: 'statistika', description: 'Shaxsiy statistika' },
      { command: 'yordam', description: "Qoʻllanma" },
    ],
    { scope: { type: 'all_private_chats' } },
  );
  await b.bot.api.setMyCommands(
    [
      { command: 'boshlash', description: 'Musobaqani boshlash' },
      { command: 'toxtat', description: "Musobaqani toʻxtatish" },
      { command: 'holat', description: 'Joriy musobaqa holati' },
    ],
    { scope: { type: 'all_group_chats' } },
  );

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

export async function stopBot(): Promise<void> {
  if (bundle) await bundle.bot.stop();
}
