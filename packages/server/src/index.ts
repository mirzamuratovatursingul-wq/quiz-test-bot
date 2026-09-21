import { startApi } from './api/server.js';
import { createBot, startBot, stopBot } from './bot/index.js';
import { config, warnAboutConfig, watchEnvFile } from './config.js';
import { connectDb, disconnectDb } from './db/index.js';
import { logger } from './logger.js';

async function main() {
  logger.info(`TestRace ishga tushmoqda (${config.NODE_ENV})`);

  for (const warning of warnAboutConfig()) logger.warn(warning);

  // .env o'zgarsa (masalan "npm run tunnel" yangi manzil yozsa), qayta ishga tushirish shart emas
  watchEnvFile((changed) => {
    for (const [key, value] of Object.entries(changed)) {
      logger.info(`${key} yangilandi: ${value}`);
    }
  });

  try {
    await connectDb();
  } catch (err) {
    logger.error(
      [
        'MongoDB ga ulanib boʻlmadi.',
        `  URI: ${config.MONGODB_URI}`,
        '  Tekshiring: MongoDB ishlayaptimi? (lokal uchun: docker compose up -d mongo)',
      ].join('\n'),
    );
    logger.debug(err);
    process.exit(1);
  }

  createBot();

  const app = await startApi();
  await startBot();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} qabul qilindi, toʻxtatilmoqda...`);
    try {
      await stopBot();
      await app.close();
      await disconnectDb();
    } catch (err) {
      logger.error('Toʻxtatishda xato', err);
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => logger.error('Ushlanmagan promise xatosi', reason));
  process.on('uncaughtException', (err) => logger.error('Ushlanmagan xato', err));
}

void main().catch((err) => {
  logger.error('Ishga tushirishda xato', err);
  process.exit(1);
});
