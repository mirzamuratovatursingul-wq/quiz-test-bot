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

  if (config.isProd) await syncIndexes();
  return mongoose;
}

/** Production'da indekslarni bir marta tekshirib chiqish (autoIndex o'chirilgani uchun) */
async function syncIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);
  try {
    await Promise.all(names.map((name) => mongoose.models[name]?.syncIndexes()));
    logger.info(`Indekslar sinxronlandi: ${names.join(', ')}`);
  } catch (err) {
    // Indeks muammosi ilovani to'xtatmasligi kerak
    logger.warn('Indekslarni sinxronlashda muammo', err);
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export { mongoose };
