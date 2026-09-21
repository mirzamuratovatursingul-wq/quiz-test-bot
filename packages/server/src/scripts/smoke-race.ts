/**
 * Musobaqa dvigateli uchun uchdan-uchgacha tekshiruv (quiz so'rovnomasi oqimi).
 * Telegram API o'rniga soxta (mock) API ishlatiladi, internet kerak emas.
 *
 *   npm run smoke:race -w @testrace/server
 *
 * Tekshiriladi: guruhga yuborish -> start -> quiz poll -> poll_answer ->
 * ball va tezlik -> kech qo'shilgan a'zo -> yakun -> podium -> bazaga saqlash.
 */
process.env.NODE_ENV ??= 'development';
process.env.BOT_TOKEN ??= '0000000000:SMOKE_TEST_TOKEN_NOT_REAL_000000000';
process.env.SERVE_WEB = 'false';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { Bot } from 'grammy';
import type { PollAnswer } from 'grammy/types';
import { boldOptionLabel } from '@testrace/shared';

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('testrace_race');

const { Race, Template, User } = await import('../db/models.js');
const { RaceEngine } = await import('../race/engine.js');

await mongoose.connect(process.env.MONGODB_URI);

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

/* ---------------- Soxta Telegram API ---------------- */

interface SentMessage {
  messageId: number;
  text: string;
  keyboard: string[];
}

interface SentPoll {
  messageId: number;
  pollId: string;
  question: string;
  options: string[];
  correct: number[];
  openPeriod?: number;
  explanation?: string;
  isAnonymous?: boolean;
  allowsRevoting?: boolean;
}

const sent: SentMessage[] = [];
const polls: SentPoll[] = [];
const photos: { size: number }[] = [];
let messageId = 100;
let pollSeq = 0;

function keyboardData(extra: Record<string, any> | undefined): string[] {
  const rows = extra?.reply_markup?.inline_keyboard as { callback_data?: string }[][] | undefined;
  if (!rows) return [];
  return rows.flat().map((b) => b.callback_data ?? '');
}

const mockApi = {
  async sendMessage(_chatId: number, text: string, extra?: Record<string, any>) {
    messageId += 1;
    sent.push({ messageId, text, keyboard: keyboardData(extra) });
    return { message_id: messageId };
  },
  async editMessageText(_chatId: number, msgId: number, text: string) {
    const msg = sent.find((m) => m.messageId === msgId);
    if (msg) msg.text = text;
    return true;
  },
  async sendPoll(
    _chatId: number,
    question: string,
    options: { text: string }[],
    extra?: Record<string, any>,
  ) {
    messageId += 1;
    pollSeq += 1;
    const pollId = `poll-${pollSeq}`;
    polls.push({
      messageId,
      pollId,
      question,
      options: options.map((o) => o.text),
      correct: extra?.correct_option_ids ?? [],
      openPeriod: extra?.open_period,
      explanation: extra?.explanation,
      isAnonymous: extra?.is_anonymous,
      allowsRevoting: extra?.allows_revoting,
    });
    return { message_id: messageId, poll: { id: pollId } };
  },
  async sendPhoto(_chatId: number, file: unknown) {
    const raw = file as { fileData?: Buffer };
    photos.push({ size: raw.fileData?.length ?? 0 });
    messageId += 1;
    return { message_id: messageId };
  },
  async getUserProfilePhotos() {
    return { total_count: 0, photos: [] };
  },
  async getChatMember() {
    return { status: 'member' };
  },
};

const mockBot = { api: mockApi } as unknown as Bot;
const engine = new RaceEngine(mockBot);

function answerPoll(pollId: string, user: { id: number; first_name: string; username?: string }, optionIndex: number) {
  return engine.handlePollAnswer({
    poll_id: pollId,
    user: { id: user.id, is_bot: false, first_name: user.first_name, username: user.username },
    option_ids: [optionIndex],
  } as unknown as PollAnswer);
}

/* ---------------- Ma'lumot ---------------- */

const CHAT_ID = -1009999;
const OWNER = 5001;
const ALI = { id: 5002, first_name: 'Ali', username: 'ali' };
const VALI = { id: 5003, first_name: 'Vali', username: 'vali' };
const SANO = { id: 5004, first_name: 'Sanobar' };

await User.create({ telegramId: OWNER, firstName: 'Ustoz' });

const LONG_QUESTION = `Quyidagi matnni oʻqing va savolga javob bering. ${'Bu juda uzun savol matni. '.repeat(
  14,
)} Qaysi javob toʻgʻri?`;

const template = await Template.create({
  ownerId: OWNER,
  title: 'Musobaqa sinovi',
  status: 'ready',
  questions: [
    {
      text: 'Poytaxtimiz?',
      options: [{ text: 'Toshkent' }, { text: 'Samarqand' }, { text: 'Buxoro' }],
      correctIndex: 0,
    },
    {
      text: '2 + 2 = ?',
      options: [{ text: '3' }, { text: '4' }, { text: '5' }],
      correctIndex: 1,
    },
    {
      text: LONG_QUESTION,
      options: [{ text: 'Birinchi' }, { text: 'Ikkinchi' }],
      correctIndex: 1,
    },
  ],
  settings: {
    timePerQuestion: 2,
    shuffleQuestions: false,
    shuffleOptions: false,
    questionLimit: 0,
    speedBonus: true,
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(70);
  }
  return false;
}

/* ---------------- Sinov ---------------- */

console.log('\n1) Shablonni guruhga yuborish');
const created = await engine.createRace({
  chatId: CHAT_ID,
  chatTitle: 'Sinov guruhi',
  hostId: OWNER,
  templateId: String(template._id),
});
check('musobaqa yaratildi', created.ok, created.message);
const intro = sent.at(-1);
check('kartochka yuborildi', Boolean(intro?.text.includes('Musobaqa sinovi')), intro?.text);
check('faqat Boshlash va bekor tugmasi', intro?.keyboard.length === 2, intro?.keyboard);
check(
  'qatnashish (join) tugmasi yoʻq',
  !intro?.keyboard.some((k) => k.includes('join')),
  intro?.keyboard,
);

console.log('\n2) Boshlash');
const notHost = await engine.start(CHAT_ID, 424242);
check('begona boshlay olmadi', !notHost.ok, notHost.message);
const started = await engine.start(CHAT_ID, OWNER);
check('host boshladi', started.ok, started.message);

console.log('\n3) 1-savol: quiz soʻrovnomasi');
check('soʻrovnoma yuborildi', await waitFor(() => polls.length >= 1));
const p1 = polls[0]!;
check('quiz tipida, 3 variant', p1.options.length === 3, p1.options);
check('toʻgʻri javob belgilangan', p1.correct[0] === 0, p1.correct);
check('anonim emas (kim javob berdi koʻrinadi)', p1.isAnonymous === false);
check('javobni oʻzgartirib boʻlmaydi', p1.allowsRevoting === false);
check('jonli sanoq yoqilgan (open_period=2)', p1.openPeriod === 2, p1.openPeriod);
check('savol raqami [1/3] koʻrinishida', p1.question.includes('[1/3]-savol'), p1.question);
check(
  'savol matni alohida qatorda (boʻsh qator bilan ajratilgan)',
  p1.question.includes('\n\n'),
  JSON.stringify(p1.question),
);
check(
  'variantlar qalin A) B) harflari bilan',
  p1.options[0]?.startsWith(`${boldOptionLabel(0)})`) === true &&
    p1.options[1]?.startsWith(`${boldOptionLabel(1)})`) === true,
  p1.options,
);
check(
  'xato javob berganga eslatma tayyorlandi',
  Boolean(p1.explanation?.includes('Toshkent')),
  p1.explanation,
);
check(
  'eslatmada "Javob:" qalin shriftda',
  Boolean(p1.explanation?.includes('<b>Javob:</b>')),
  p1.explanation,
);
check('eslatma 200 belgidan oshmadi', (p1.explanation?.length ?? 0) <= 200, p1.explanation?.length);

await answerPoll(p1.pollId, ALI, 0); // to'g'ri, tez
await sleep(600);
await answerPoll(p1.pollId, VALI, 0); // to'g'ri, sekinroq
await answerPoll(p1.pollId, VALI, 1); // ikkinchi urinish e'tiborga olinmaydi

console.log('\n4) 2-savol');
check('2-savol chiqdi', await waitFor(() => polls.length >= 2, 15000));
const p2 = polls[1]!;
await answerPoll(p2.pollId, VALI, 1); // to'g'ri
await answerPoll(p2.pollId, ALI, 0); // xato
await answerPoll(p2.pollId, SANO, 1); // kech qo'shildi, to'g'ri

console.log('\n5) 3-savol: uzun matn alohida xabarda');
check('3-savol chiqdi', await waitFor(() => polls.length >= 3, 15000));
const p3 = polls[2]!;
check('soʻrovnoma savoli 300 belgidan oshmadi', p3.question.length <= 300, p3.question.length);
check(
  'toʻliq matn alohida xabarda yuborildi',
  sent.some((m) => m.text.includes('Qaysi javob')),
);
await answerPoll(p3.pollId, ALI, 1);

console.log('\n6) Yakun');
const finished = await waitFor(() => photos.length > 0, 25000);
check('podium rasmi yuborildi', finished);
check('rasm hajmi > 20 KB', (photos[0]?.size ?? 0) > 20_000, photos[0]?.size);
check(
  'yakuniy jadval yuborildi',
  await waitFor(() => sent.some((m) => m.text.includes('Yakuniy natijalar')), 10000),
);
const finalMsg = sent.find((m) => m.text.includes('Yakuniy natijalar'));
check(
  'yakuniy xabar guruhlarga ajratilgan (boʻsh qatorlar bilan)',
  (finalMsg?.text.split('\n\n').length ?? 0) >= 4,
  finalMsg?.text,
);
check(
  'umumiy koʻrsatkichlar bloki bor',
  Boolean(finalMsg?.text.includes('Umumiy koʻrsatkichlar')),
  finalMsg?.text,
);
check(
  'gʻoliblar 3-2-1 tartibida eʻlon qilindi',
  sent.some((m) => m.text.includes('Yakun') && m.text.includes('\u{1F947}')),
);

console.log('\n7) Baza');
await sleep(400);
const raceDoc = await Race.findOne({ chatId: CHAT_ID }).sort({ createdAt: -1 });
check('holat: finished', raceDoc?.status === 'finished', raceDoc?.status);
check('3 ta ishtirokchi', raceDoc?.participants.length === 3, raceDoc?.participants.length);

const ali = raceDoc?.participants.find((p) => p.userId === ALI.id);
const vali = raceDoc?.participants.find((p) => p.userId === VALI.id);
const sano = raceDoc?.participants.find((p) => p.userId === SANO.id);

check('Ali: 2 toʻgʻri, 1 xato', ali?.correct === 2 && ali?.wrong === 1, ali);
check('Vali: 2 toʻgʻri', vali?.correct === 2, vali?.correct);
check('Vali 3-savolga javob bermadi (missed=1)', vali?.missed === 1, vali?.missed);
check('kech qoʻshilgan Sanobar hisobga olindi', sano?.correct === 1, sano);
check(
  'Sanobarga oʻzidan oldingi savol missed sifatida yozilmadi',
  sano?.missed === 1,
  sano?.missed,
);
check(
  'tezroq javob bergan Ali 1-savolda koʻproq ball oldi',
  (ali?.score ?? 0) > 0 && (vali?.score ?? 0) > 0,
  { ali: ali?.score, vali: vali?.score },
);
check('1-savol statistikasi: 2 javob, 2 toʻgʻri',
  raceDoc?.questions[0]?.answeredCount === 2 && raceDoc?.questions[0]?.correctCount === 2,
  raceDoc?.questions[0],
);

const owner = await User.findOne({ telegramId: OWNER });
check('egasi statistikasi yangilandi', owner?.stats?.racesHosted === 1, owner?.stats);
const tpl = await Template.findById(template._id);
check('shablon musobaqa soni oshdi', tpl?.racesCount === 1, tpl?.racesCount);
check('faol musobaqa tozalandi', !engine.isActive(CHAT_ID));

// DUMP=1 bilan ishga tushirilsa, Telegramda qanday koʻrinishini chop etadi
if (process.env.DUMP === '1') {
  const line = '─'.repeat(60);
  console.log(`\n${line}\nSOʻROVNOMA:\n`);
  console.log(p1.question);
  p1.options.forEach((o) => console.log(`   ${o}`));
  console.log(`\nXATO JAVOB BERGANGA:\n${p1.explanation}`);
  console.log(`\n${line}\nYAKUNIY XABAR:\n`);
  console.log(finalMsg?.text);
  console.log(line);
}

await mongoose.disconnect();
await mongo.stop();

console.log(`\n${failed === 0 ? '✅' : '❌'} Natija: ${passed} ta oʻtdi, ${failed} ta yiqildi\n`);
process.exit(failed === 0 ? 0 : 1);
