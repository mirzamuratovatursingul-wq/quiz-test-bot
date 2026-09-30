/**
 * Backend uchun uchdan-uchgacha (end-to-end) tekshiruv.
 * Xotiradagi MongoDB ishga tushiriladi, Telegram va internet kerak emas.
 *
 *   npm run smoke -w @testrace/server
 *
 * Tekshiriladi: matn tahlili -> qoralama -> tahrirlash -> tasdiqlash ->
 * shablon -> PDF -> musobaqa statistikasi -> profil.
 */
process.env.NODE_ENV ??= 'development';
process.env.BOT_TOKEN ??= '0000000000:SMOKE_TEST_TOKEN_NOT_REAL_000000000';
process.env.DEV_USER_ID ??= '777000';
process.env.SERVE_WEB = 'false';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('testrace_smoke');

const { buildApi } = await import('../api/server.js');
const { Race, Template } = await import('../db/models.js');

await mongoose.connect(process.env.MONGODB_URI);

const app = await buildApi();
const USER_ID = Number(process.env.DEV_USER_ID);

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

const SAMPLE = `1. Oʻzbekiston poytaxti?
+A) Toshkent
B) Samarqand
C) Buxoro

2. 7 × 8 = ?
A) 54
+B) 56
C) 64

3. Eng katta okean?
A) Atlantika
B) Hind
C) Tinch

Javoblar kaliti:
3-C`;

console.log('\n1) Matnni tahlil qilish (/api/parse)');
const parseRes = await app.inject({
  method: 'POST',
  url: '/api/parse',
  payload: { text: SAMPLE, title: 'Smoke test' },
});
check('201 javob', parseRes.statusCode === 201, parseRes.body);
const draft = parseRes.json().draft as { id: string; questions: { correctIndex: number }[] };
check('3 ta savol topildi', draft.questions.length === 3, draft.questions.length);
check(
  'hamma javob aniqlandi ("+" va kalit)',
  draft.questions.every((q) => q.correctIndex >= 0),
  draft.questions.map((q) => q.correctIndex),
);

console.log('\n2) Telegram initData imzosini tekshirish');
{
  const { verifyInitData } = await import('../api/auth.js');
  const crypto = await import('node:crypto');

  const makeInitData = (authDate: number, tamper = false) => {
    const user = JSON.stringify({ id: 555, first_name: 'Sardor', username: 'sardor' });
    const fields: Record<string, string> = { auth_date: String(authDate), query_id: 'AAE', user };
    const dataCheckString = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const secret = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN as string)
      .digest();
    const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    const params = new URLSearchParams(fields);
    params.set('hash', tamper ? hash.replace(/^./, hash[0] === 'a' ? 'b' : 'a') : hash);
    return params.toString();
  };

  const now = Math.floor(Date.now() / 1000);
  const valid = verifyInitData(makeInitData(now));
  check('toʻgʻri imzo qabul qilindi', valid?.id === 555, valid);
  check('buzilgan imzo rad etildi', verifyInitData(makeInitData(now, true)) === null);
  check('eski initData rad etildi', verifyInitData(makeInitData(now - 200_000)) === null);
  check('boʻsh initData rad etildi', verifyInitData('') === null);
}

console.log('\n3) Qoralamani tahrirlash (/api/drafts/:id)');
const patchRes = await app.inject({
  method: 'PATCH',
  url: `/api/drafts/${draft.id}`,
  payload: { title: 'Smoke test v2', answerKeyText: '1-A, 2-B, 3-C' },
});
check('200 javob', patchRes.statusCode === 200, patchRes.body);
check('nom yangilandi', patchRes.json().draft.title === 'Smoke test v2');

console.log('\n4) Tasdiqlash -> shablon (/api/drafts/:id/confirm)');
const confirmRes = await app.inject({
  method: 'POST',
  url: `/api/drafts/${draft.id}/confirm`,
  payload: { title: 'Smoke shablon', subject: 'Aralash', settings: { timePerQuestion: 20 } },
});
check('201 javob', confirmRes.statusCode === 201, confirmRes.body);
const template = confirmRes.json().template as { id: string; questions: unknown[] };
check('3 ta savol saqlandi', template.questions.length === 3);

const draftsAfter = await app.inject({ method: 'GET', url: '/api/drafts' });
check('qoralama oʻchdi', draftsAfter.json().drafts.length === 0);

console.log('\n5) Shablonlar roʻyxati va sozlamalar');
const listRes = await app.inject({ method: 'GET', url: '/api/templates' });
check('roʻyxatda 1 ta shablon', listRes.json().templates.length === 1);
check(
  'vaqt sozlamasi saqlandi (20 s)',
  listRes.json().templates[0].settings.timePerQuestion === 20,
  listRes.json().templates[0].settings,
);

const patchTpl = await app.inject({
  method: 'PATCH',
  url: `/api/templates/${template.id}`,
  payload: { settings: { timePerQuestion: 25, shuffleOptions: false } },
});
check('sozlama yangilandi', patchTpl.json().template.settings.timePerQuestion === 25);
check(
  'boshqa sozlama saqlanib qoldi',
  patchTpl.json().template.settings.shuffleQuestions === true,
);

const untimedPatch = await app.inject({
  method: 'PATCH',
  url: `/api/templates/${template.id}`,
  payload: { settings: { timePerQuestion: 0 } },
});
check('vaqtsiz rejim (0) qabul qilindi', untimedPatch.json().template?.settings.timePerQuestion === 0, untimedPatch.body);
const badTime = await app.inject({
  method: 'PATCH',
  url: `/api/templates/${template.id}`,
  payload: { settings: { timePerQuestion: 3 } },
});
check('3 soniya rad etildi (0 yoki 5–120)', badTime.statusCode === 400, badTime.statusCode);
await app.inject({
  method: 'PATCH',
  url: `/api/templates/${template.id}`,
  payload: { settings: { timePerQuestion: 25 } },
});

console.log('\n6) Begona foydalanuvchi shablonni koʻra olmaydi');
const otherOwner = await Template.create({
  ownerId: 999999,
  title: 'Begona',
  questions: [{ text: 'X', options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0 }],
});
const forbidden = await app.inject({ method: 'GET', url: `/api/templates/${otherOwner._id}` });
check('404 qaytdi', forbidden.statusCode === 404, forbidden.statusCode);

console.log('\n7) PDF yaratish (/api/templates/:id/pdf)');
const pdfRes = await app.inject({ method: 'GET', url: `/api/templates/${template.id}/pdf?mode=key` });
check('200 javob', pdfRes.statusCode === 200, pdfRes.statusCode);
check('PDF sarlavhasi', pdfRes.headers['content-type'] === 'application/pdf');
check('PDF hajmi > 5 KB', pdfRes.rawPayload.length > 5000, pdfRes.rawPayload.length);
check('PDF imzosi %PDF', pdfRes.rawPayload.subarray(0, 4).toString() === '%PDF');

console.log('\n8) Musobaqa natijalari va statistika');
await Race.create({
  templateId: template.id,
  templateTitle: 'Smoke shablon',
  ownerId: USER_ID,
  hostId: USER_ID,
  chatId: -1001234,
  chatTitle: 'Smoke guruh',
  status: 'finished',
  finishedAt: new Date(),
  timePerQuestion: 20,
  questions: [
    {
      text: 'Oʻzbekiston poytaxti?',
      options: [{ text: 'Toshkent' }, { text: 'Samarqand' }],
      correctIndex: 0,
      answeredCount: 2,
      correctCount: 2,
      optionCounts: [2, 0],
    },
  ],
  participants: [
    { userId: 1, firstName: 'Ali', score: 180, correct: 1, wrong: 0, missed: 0, totalTimeMs: 4000, answered: 1, place: 1 },
    { userId: 2, firstName: 'Vali', score: 150, correct: 1, wrong: 0, missed: 0, totalTimeMs: 9000, answered: 1, place: 2 },
  ],
});

const racesRes = await app.inject({ method: 'GET', url: `/api/races?templateId=${template.id}` });
check('musobaqa roʻyxatda', racesRes.json().races.length === 1, racesRes.body);
const race = racesRes.json().races[0];
check('gʻolib aniqlandi', race.participants[0].firstName === 'Ali');
check('oʻrtacha vaqt hisoblandi', race.participants[0].avgTimeMs === 4000);

const reportRes = await app.inject({ method: 'GET', url: `/api/races/${race.id}/pdf` });
check('hisobot PDF 200', reportRes.statusCode === 200, reportRes.statusCode);
check('hisobot PDF imzosi', reportRes.rawPayload.subarray(0, 4).toString() === '%PDF');

console.log('\n9) Profil va umumiy statistika');
const meRes = await app.inject({ method: 'GET', url: '/api/me' });
check('profil 200', meRes.statusCode === 200);
check('shablonlar soni 1', meRes.json().profile.templatesCount === 1, meRes.json().profile);

const statsRes = await app.inject({ method: 'GET', url: '/api/stats' });
check('statistika 200', statsRes.statusCode === 200);
check('oxirgi musobaqalar bor', statsRes.json().recentRaces.length === 1);
check('toʻgʻri javob ulushi 100%', statsRes.json().totals.correctRate === 100, statsRes.json().totals);

console.log('\n10) Shablonni oʻchirish');
const delRes = await app.inject({ method: 'DELETE', url: `/api/templates/${template.id}` });
check('200 javob', delRes.statusCode === 200);
const afterDel = await app.inject({ method: 'GET', url: '/api/templates' });
check('roʻyxat boʻshadi', afterDel.json().templates.length === 0);

console.log('\n11) Ulashish: kod orqali nusxa olish');
{
  const { ensureShareCode } = await import('../services/template-share.service.js');
  const { User } = await import('../db/models.js');
  await User.create({ telegramId: 999999, firstName: 'Ustoz' });
  // Begona foydalanuvchi (999999) o'z shablonini ulashdi
  const sourceCode = await ensureShareCode(otherOwner as never);
  check('kod 6 ta belgi', /^[A-Z2-9]{6}$/.test(sourceCode), sourceCode);
  check('qayta soʻralganda oʻsha kod', (await ensureShareCode((await Template.findById(otherOwner._id)) as never)) === sourceCode);

  const preview = await app.inject({ method: 'GET', url: `/api/templates/shared/${sourceCode.toLowerCase()}` });
  check('kod boʻyicha koʻrinish (kichik harf bilan ham)', preview.json().preview?.title === 'Begona', preview.body);
  check('egasining ismi koʻrinadi', preview.json().preview?.ownerName === 'Ustoz', preview.json().preview);

  const imported = await app.inject({ method: 'POST', url: '/api/templates/import', payload: { code: sourceCode } });
  check('nusxa olindi (201)', imported.statusCode === 201, imported.body);
  const copy = imported.json().template;
  check('nusxa foydalanuvchiniki', copy?.ownerId === USER_ID, copy?.ownerId);
  check('nusxada savollar bor', copy?.questions.length === 1);
  check('nusxada kimdan olingani yozilgan', copy?.copiedFrom?.ownerName === 'Ustoz', copy?.copiedFrom);
  check('nusxaga asl kod koʻchmadi', !copy?.shareCode, copy?.shareCode);

  const again = await app.inject({ method: 'POST', url: '/api/templates/import', payload: { code: sourceCode } });
  check('qayta olinganda yangi nusxa yaratilmadi', again.json().already === true && again.json().template.id === copy.id);

  // Asl shablon o'chirildi — nusxa qolishi kerak
  await Template.deleteOne({ _id: otherOwner._id });
  const copyAfter = await app.inject({ method: 'GET', url: `/api/templates/${copy.id}` });
  check('egasi oʻchirgandan keyin ham nusxa bor', copyAfter.statusCode === 200 && copyAfter.json().template.questions.length === 1);
  const deadCode = await app.inject({ method: 'POST', url: '/api/templates/import', payload: { code: sourceCode } });
  check('oʻchirilgan shablon kodi endi ishlamaydi (404)', deadCode.statusCode === 404, deadCode.statusCode);

  // O'z shablonini ulashish va bekor qilish
  const shareRes = await app.inject({ method: 'POST', url: `/api/templates/${copy.id}/share` });
  const ownCode = shareRes.json().code as string;
  check('oʻz shablonini ulashish kodi', /^[A-Z2-9]{6}$/.test(ownCode ?? ''), shareRes.body);
  check('yangi kod asl koddan farqli', ownCode !== sourceCode);
  const ownImport = await app.inject({ method: 'POST', url: '/api/templates/import', payload: { code: ownCode } });
  check('oʻz shablonini import qilib boʻlmaydi (409)', ownImport.statusCode === 409, ownImport.statusCode);
  await app.inject({ method: 'DELETE', url: `/api/templates/${copy.id}/share` });
  const revoked = await app.inject({ method: 'GET', url: `/api/templates/shared/${ownCode}` });
  check('bekor qilingan kod ishlamaydi', revoked.statusCode === 404, revoked.statusCode);
  const badCode = await app.inject({ method: 'GET', url: '/api/templates/shared/ABC' });
  check('notoʻgʻri formatdagi kod — 400', badCode.statusCode === 400, badCode.statusCode);
}

await app.close();
await mongoose.disconnect();
await mongo.stop();

console.log(`\n${failed === 0 ? '✅' : '❌'} Natija: ${passed} ta oʻtdi, ${failed} ta yiqildi\n`);
process.exit(failed === 0 ? 0 : 1);
