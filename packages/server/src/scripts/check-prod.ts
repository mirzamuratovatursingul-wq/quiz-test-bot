/**
 * Production rejimidagi yo'llarni Telegramsiz tekshirish:
 *   npm run check:prod -w @testrace/server
 *
 * Xotiradagi MongoDB bilan: ulanish, indekslar sinxronizatsiyasi,
 * API ning production sozlamalari va statik fayllar holati.
 */
process.env.NODE_ENV = 'production';
process.env.BOT_TOKEN ??= '0000000000:PROD_CHECK_TOKEN_NOT_REAL_00000000';
process.env.WEBAPP_URL ??= 'https://example.vercel.app';
process.env.SERVE_WEB ??= 'false';

import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('prod_check');

const { connectDb, disconnectDb, mongoose } = await import('../db/index.js');
const { buildApi } = await import('../api/server.js');
const { config } = await import('../config.js');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`, extra ?? '');
  }
}

console.log('\n1) Konfiguratsiya');
check('NODE_ENV = production', config.isProd);
check('statik fayllar oʻchirilgan (SERVE_WEB=false)', config.SERVE_WEB === false);
check('WEBAPP_URL HTTPS', config.WEBAPP_URL.startsWith('https://'), config.WEBAPP_URL);

console.log('\n2) Baza va indekslar');
await connectDb();
check('ulandi', mongoose.connection.readyState === 1);

const indexes = {
  templates: await mongoose.connection.collection('templates').indexes(),
  races: await mongoose.connection.collection('races').indexes(),
  drafts: await mongoose.connection.collection('drafts').indexes(),
  users: await mongoose.connection.collection('users').indexes(),
};
check(
  'shablon indeksi (ownerId) yaratildi',
  indexes.templates.some((i) => i.key?.ownerId === 1),
  indexes.templates.map((i) => i.name),
);
check(
  'musobaqa indeksi (chatId + status) yaratildi',
  indexes.races.some((i) => i.key?.chatId === 1 && i.key?.status === 1),
  indexes.races.map((i) => i.name),
);
check(
  'qoralama TTL indeksi yaratildi (7 kun)',
  indexes.drafts.some((i) => i.expireAfterSeconds === 7 * 24 * 3600),
  indexes.drafts.map((i) => `${i.name}:${i.expireAfterSeconds ?? '-'}`),
);
check(
  'foydalanuvchi unique indeksi',
  indexes.users.some((i) => i.key?.telegramId === 1 && i.unique),
  indexes.users.map((i) => i.name),
);

console.log('\n3) API');
const app = await buildApi();
const health = await app.inject({ method: 'GET', url: '/api/health' });
check('health 200', health.statusCode === 200, health.body);
check(
  'health production’da ichki maʼlumot bermaydi',
  !('webappUrl' in health.json()),
  health.body,
);

const noAuth = await app.inject({ method: 'GET', url: '/api/templates' });
check('avtorizatsiyasiz 401', noAuth.statusCode === 401, noAuth.statusCode);

const devBypass = await app.inject({
  method: 'GET',
  url: '/api/templates',
  headers: { 'x-init-data': 'hash=deadbeef' },
});
check('DEV_USER_ID zayomi production’da ishlamaydi', devBypass.statusCode === 401);

const notFound = await app.inject({ method: 'GET', url: '/api/yoq' });
check('notoʻgʻri endpoint 404', notFound.statusCode === 404, notFound.statusCode);

await app.close();
await disconnectDb();
await mongo.stop();

console.log(`\n${failed === 0 ? '✅' : '❌'} Natija: ${passed} ta oʻtdi, ${failed} ta yiqildi\n`);
process.exit(failed === 0 ? 0 : 1);
