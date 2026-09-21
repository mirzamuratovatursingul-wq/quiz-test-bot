/**
 * Mini App UI sini Telegramsiz ko'rish uchun namunali server.
 *   npm run preview:ui -w @testrace/server
 * Xotiradagi MongoDB + namuna shablon, qoralama va musobaqa yaratadi va
 * http://localhost:3100 da web build ni ochadi (DEV_USER_ID orqali kiriladi).
 */
process.env.NODE_ENV = 'development';
process.env.BOT_TOKEN = '0000000000:PREVIEW_TOKEN_NOT_REAL_00000000000';
process.env.DEV_USER_ID = '777000';
process.env.SERVE_WEB = 'true';
process.env.PORT = '3100';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('preview');

const { startApi } = await import('../api/server.js');
const { createBot } = await import('../bot/index.js');
const { Draft, Race, Template, User } = await import(
  '../db/models.js'
);
const { parseTestText } = await import('@testrace/shared');
const fs = await import('node:fs');
const path = await import('node:path');
const { ROOT_DIR } = await import('../config.js');

await mongoose.connect(process.env.MONGODB_URI);
createBot();

const USER = 777000;
await User.create({
  telegramId: USER,
  firstName: 'Aydos',
  username: 'aydos',
  stats: {
    templatesCount: 2,
    racesHosted: 4,
    racesPlayed: 6,
    wins: 2,
    totalScore: 4820,
    totalCorrect: 41,
    totalAnswers: 52,
  },
});

const sample = fs.readFileSync(path.join(ROOT_DIR, 'samples', 'namuna-test.txt'), 'utf8');
const parsed = parseTestText(sample);

// Cheksiz skrollni koʻrish uchun savollar koʻpaytiriladi
const manyQuestions = Array.from({ length: 5 }, (_, round) =>
  parsed.questions.map((q, i) => ({ ...q, text: `${round * parsed.questions.length + i + 1}) ${q.text}` })),
).flat();

const template = await Template.create({
  ownerId: USER,
  title: 'Matematika va tarix testi',
  subject: 'Aralash',
  status: 'ready',
  questions: manyQuestions,
  settings: { timePerQuestion: 20, shuffleQuestions: true, shuffleOptions: true, questionLimit: 0, speedBonus: true },
  racesCount: 3,
});

await Template.create({
  ownerId: USER,
  title: 'Ona tili · 8-sinf',
  status: 'ready',
  questions: parsed.questions.slice(0, 4),
});

const draftQuestions = parsed.questions.map((q, i) => ({
  ...q,
  correctIndex: i % 3 === 0 ? -1 : q.correctIndex,
}));
const draft = await Draft.create({
  ownerId: USER,
  title: 'Biologiya 9-sinf',
  questions: draftQuestions,
  warnings: [{ code: 'no_correct_answer', message: '1-savolning javobi aniqlanmadi' }],
  strategy: 'plus',
  sourceType: 'pdf',
  sourceFileName: 'biologiya.pdf',
});

const race = await Race.create({
  templateId: template._id,
  templateTitle: template.title,
  ownerId: USER,
  hostId: USER,
  chatId: -1001234,
  chatTitle: '7-A sinf',
  status: 'finished',
  finishedAt: new Date(),
  timePerQuestion: 20,
  questions: parsed.questions.map((q, i) => ({
    text: q.text,
    options: q.options,
    correctIndex: q.correctIndex,
    answeredCount: 5,
    correctCount: 5 - (i % 4),
    optionCounts: q.options.map((_, oi) => (oi === q.correctIndex ? 3 : 1)),
  })),
  participants: [
    { userId: 1, firstName: 'Ozodbek', username: 'ozod', score: 1260, correct: 7, wrong: 0, missed: 0, totalTimeMs: 21000, answered: 7, place: 1 },
    { userId: 2, firstName: 'Gulnoza', username: 'gulnoza', score: 1100, correct: 6, wrong: 1, missed: 0, totalTimeMs: 28000, answered: 7, place: 2 },
    { userId: 3, firstName: 'Shohrux', score: 860, correct: 5, wrong: 2, missed: 0, totalTimeMs: 35000, answered: 7, place: 3 },
    { userId: 4, firstName: 'Malika', username: 'malika', score: 540, correct: 3, wrong: 3, missed: 1, totalTimeMs: 30000, answered: 6, place: 4 },
  ],
});

await startApi();

console.log('PREVIEW_READY');
console.log(`template=${String(template._id)}`);
console.log(`draft=${String(draft._id)}`);
console.log(`race=${String(race._id)}`);
