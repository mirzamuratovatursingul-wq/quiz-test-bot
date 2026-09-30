import mongoose from 'mongoose';
import { config } from '../config.js';
import { logger } from '../logger.js';

export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB uzildi'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB qayta ulandi'));

  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    // Production'da indekslar har so'rovda emas, bir marta ishga tushishda sinxronlanadi
    autoIndex: !config.isProd,
    maxPoolSize: config.isProd ? 20 : 5,
  });
  logger.info(`MongoDB ulandi: ${mongoose.connection.name}`);

  // Production'da indekslar fonda yaratiladi — server ularni kutmasdan so'rov qabul qiladi
  if (config.isProd) void ensureIndexes();
  return mongoose;
}

/**
 * Production'da yetishmayotgan indekslarni yaratish (autoIndex o'chirilgani uchun).
 * createIndexes mavjud indekslarni o'chirmaydi (syncIndexes'dan farqli) va bor
 * indekslarni tez o'tkazib yuboradi.
 */
async function ensureIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);
  const started = Date.now();
  try {
    await Promise.all(names.map((name) => mongoose.models[name]?.createIndexes()));
    logger.info(`Indekslar tayyor (${Date.now() - started} ms): ${names.join(', ')}`);
  } catch (err) {
    // Indeks muammosi ilovani to'xtatmasligi kerak
    logger.warn('Indekslarni yaratishda muammo', err);
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export { mongoose };
