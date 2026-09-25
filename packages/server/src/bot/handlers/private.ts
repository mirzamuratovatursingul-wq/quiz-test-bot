import { InputFile, type Bot, type Context } from 'grammy';
import { parseTestText, optionLabel, type Question } from '@testrace/shared';
import { config } from '../../config.js';
import { Draft, Template, User } from '../../db/models.js';
import { logger } from '../../logger.js';
import { ExtractError, extractText } from '../../services/extract.service.js';
import { buildTestPdf } from '../../services/pdf.service.js';
import { downloadTelegramFile, escapeHtml } from '../../services/telegram.service.js';
import {
  MENU,
  draftDeleteConfirmKeyboard,
  draftKeyboard,
  isHttps,
  mainMenuKeyboard,
  openAppKeyboard,
  templateKeyboard,
  templatesListKeyboard,
  webAppUrl,
} from '../keyboards.js';
import { t } from '../texts.js';

const MIN_TEXT_LENGTH = 40;
/** Ro'yxatda bir sahifadagi shablonlar soni */
const TEMPLATES_PER_PAGE = 8;

type PdfMode = 'plain' | 'key' | 'teacher';

const PDF_CAPTIONS: Record<PdfMode, string> = {
  plain: '\u{1F4C4} Test varianti (kalitsiz) — oʻquvchilarga tarqatish uchun',
  key: '\u{1F511} Test + oxirgi sahifada javoblar kaliti',
  teacher: '\u{1F469}‍\u{1F3EB} Oʻqituvchi nusxasi — toʻgʻri javoblar belgilangan',
};
const PDF_SUFFIX: Record<PdfMode, string> = { plain: '', key: '-kalit', teacher: '-oqituvchi' };

function guessTitle(fileName?: string, text?: string): string {
  if (fileName) {
    const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (base.length >= 3) return base.slice(0, 80);
  }
  const firstLine = (text ?? '').split('\n').find((l) => l.trim().length > 5);
  if (firstLine) return firstLine.trim().slice(0, 60);
  return `Test ${new Date().toLocaleDateString('uz-UZ')}`;
}

function draftSummary(params: {
  title: string;
  total: number;
  withCorrect: number;
  needsReview: number;
  strategy: string;
  warnings: { message: string }[];
}): string {
  const strategyText: Record<string, string> = {
    plus: '"+" belgisi boʻyicha',
    answer_key: 'javoblar kaliti boʻyicha',
    mixed: '"+" va kalit boʻyicha',
    none: 'aniqlanmadi',
  };

  const lines = [
    `✅ <b>Tahlil tayyor</b>`,
    ``,
    `\u{1F4DA} Nomi: <b>${escapeHtml(params.title)}</b>`,
    `❓ Topilgan savollar: <b>${params.total}</b> ta`,
    `\u{1F3AF} Toʻgʻri javobi aniqlandi: <b>${params.withCorrect}</b> ta`,
    params.needsReview > 0
      ? `⚠️ Tekshirish kerak: <b>${params.needsReview}</b> ta savol`
      : `\u{1F389} Hamma savolning javobi aniq`,
    `\u{1F50E} Usul: ${strategyText[params.strategy] ?? params.strategy}`,
  ];

  const important = params.warnings.slice(0, 5);
  if (important.length > 0) {
    lines.push('', '<b>Ogohlantirishlar:</b>');
    for (const w of important) lines.push(`• ${escapeHtml(w.message)}`);
    if (params.warnings.length > important.length) {
      lines.push(`<i>...va yana ${params.warnings.length - important.length} ta</i>`);
    }
  }

  lines.push(
    '',
    params.needsReview > 0
      ? '\u{1F447} Javobsiz savollarni panelda bir bosishda belgilang — keyin tasdiqlang.'
      : '\u{1F447} Koʻrib chiqib tasdiqlang yoki darhol saqlang — shablon profilingizga tushadi.',
  );
  return lines.join('\n');
}

/** Shablon kartochkasi matni (ro'yxatdan ochilganda va saqlangach) */
function templateCard(template: {
  title: string;
  questions: unknown;
  racesCount?: number;
  settings?: { timePerQuestion?: number } | null;
}): string {
  const questions = template.questions as Question[];
  const preview = questions
    .slice(0, 3)
    .map(
      (q, i) =>
        `<b>${i + 1}.</b> ${escapeHtml(q.text.length > 90 ? `${q.text.slice(0, 89)}…` : q.text)}\n` +
        `     ✅ ${escapeHtml(q.options[q.correctIndex]?.text ?? '—')}`,
    )
    .join('\n');
  const races = template.racesCount ?? 0;
  return [
    `\u{1F4DA} <b>${escapeHtml(template.title)}</b>`,
    ``,
    `❓ ${questions.length} ta savol · ⏱ savolga ${template.settings?.timePerQuestion ?? 15} s`,
    races > 0 ? `\u{1F3C1} ${races} marta musobaqa oʻtkazilgan` : `\u{1F195} Hali musobaqa oʻtkazilmagan`,
    ``,
    preview,
    questions.length > 3 ? `<i>…va yana ${questions.length - 3} ta savol</i>` : '',
  ]
    .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
    .join('\n')
    .trim();
}

async function handleParsedText(
  ctx: Context,
  params: { text: string; sourceType: 'pdf' | 'docx' | 'text'; fileName?: string },
) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const result = parseTestText(params.text);

  if (result.questions.length === 0) {
    await ctx.reply(
      [
        '❌ <b>Savollar topilmadi</b>',
        '',
        'Test quyidagi koʻrinishda boʻlishi kerak:',
        '<code>1. Savol matni?',
        '+A) Toʻgʻri javob',
        'B) Boshqa variant</code>',
        '',
        'Yoki oxirida javoblar kaliti boʻlsin: <code>1-A, 2-B, 3-C</code>',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
    return;
  }

  const title = guessTitle(params.fileName, params.text);
  const draft = await Draft.create({
    ownerId: userId,
    title,
    questions: result.questions,
    warnings: result.warnings,
    strategy: result.strategy,
    sourceType: params.sourceType,
    sourceFileName: params.fileName ?? '',
    rawText: params.text.slice(0, 200_000),
  });

  const preview = result.questions
    .slice(0, 2)
    .map((q, i) => {
      const opts = q.options
        .map((o, oi) => `  ${oi === q.correctIndex ? '✅' : '▫️'} ${optionLabel(oi)}) ${escapeHtml(o.text)}`)
        .join('\n');
      return `<b>${i + 1}. ${escapeHtml(q.text)}</b>\n${opts}`;
    })
    .join('\n\n');

  await ctx.reply(
    `${draftSummary({
      title,
      total: result.stats.total,
      withCorrect: result.stats.withCorrect,
      needsReview: result.stats.needsReview,
      strategy: result.strategy,
      warnings: result.warnings,
    })}\n\n<b>Namuna:</b>\n${preview}`,
    {
      parse_mode: 'HTML',
      reply_markup: draftKeyboard(String(draft._id), result.stats.withCorrect, result.stats.total),
    },
  );
}

export function registerPrivateHandlers(bot: Bot) {
  bot.chatType('private').command('start', async (ctx) => {
    const hasPanel = isHttps(webAppUrl('/'));
    await ctx.reply(t.start(escapeHtml(ctx.from?.first_name ?? 'doʻst'), hasPanel), {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
    // Guruhdagi "Botni ochish" tugmasidan kelgan bo'lsa — darhol yuklash yo'riqnomasi
    if (ctx.match === 'upload') {
      await ctx.reply(t.uploadHint, { parse_mode: 'HTML' });
      return;
    }
    // HTTPS bo'lsa panel chat pastidagi menyu tugmasida turadi; aks holda (dev) oddiy havola
    if (!hasPanel) {
      await ctx.reply('\u{1F447} Panel (shablonlar, tahrirlash, PDF):', {
        reply_markup: openAppKeyboard('/'),
      });
    }
  });

  bot.chatType('private').command(['help', 'yordam'], async (ctx) => {
    await ctx.reply(t.help, { parse_mode: 'HTML', reply_markup: openAppKeyboard('/new', '\u{1F4E4} Panelda test qoʻshish') });
  });

  /* ---------------- Fayl yuklash ---------------- */

  bot.chatType('private').on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const sizeMb = (doc.file_size ?? 0) / (1024 * 1024);
    if (sizeMb > config.MAX_FILE_MB) {
      await ctx.reply(t.fileTooBig(config.MAX_FILE_MB), { parse_mode: 'HTML' });
      return;
    }

    await ctx.replyWithChatAction('typing').catch(() => undefined);
    const status = await ctx.reply(t.analyzing);
    try {
      const buffer = await downloadTelegramFile(ctx.api, doc.file_id);
      const extracted = await extractText(buffer, doc.file_name ?? 'test.txt', doc.mime_type);
      await ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => undefined);
      await handleParsedText(ctx, {
        text: extracted.text,
        sourceType: extracted.sourceType,
        fileName: doc.file_name,
      });
    } catch (err) {
      await ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => undefined);
      if (err instanceof ExtractError) {
        await ctx.reply(`⚠️ ${err.message}`);
      } else {
        logger.error('Hujjatni qayta ishlashda xato', err);
        await ctx.reply(
          '❌ Faylni qayta ishlab boʻlmadi. Qaytadan yuboring yoki test matnini nusxalab joylang.',
        );
      }
    }
  });

  /* ---------------- Matn ---------------- */

  bot.chatType('private').on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    switch (text) {
      case MENU.templates:
        await sendTemplates(ctx, 0);
        return;
      case MENU.upload:
        await ctx.reply(t.uploadHint, { parse_mode: 'HTML' });
        return;
      case MENU.stats:
        await sendStats(ctx);
        return;
      case MENU.help:
        await ctx.reply(t.help, { parse_mode: 'HTML' });
        return;
      default:
        break;
    }

    if (text.length < MIN_TEXT_LENGTH) {
      await ctx.reply(
        '✍️ Bu test matniga oʻxshamayapti — juda qisqa. Toʻliq testni yuboring yoki PDF/Word fayl yuklang.\n\nℹ️ Format: /yordam',
      );
      return;
    }

    await ctx.replyWithChatAction('typing').catch(() => undefined);
    await handleParsedText(ctx, { text, sourceType: 'text' });
  });

  bot.chatType('private').command(['shablonlarim', 'templates'], async (ctx) => {
    await sendTemplates(ctx, 0);
  });

  bot.chatType('private').command(['statistika', 'stats'], async (ctx) => {
    await sendStats(ctx);
  });

  /* ---------------- Callbacklar ---------------- */

  /* Sahifa raqami kabi bosilmaydigan tugmalar */
  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

  bot.callbackQuery(/^draft:save:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1]!;
    const draft = await Draft.findById(draftId).catch(() => null);
    if (!draft || draft.ownerId !== ctx.from.id) {
      await ctx.answerCallbackQuery({ text: 'Qoralama topilmadi — ehtimol allaqachon saqlangan.', show_alert: true });
      return;
    }

    const questions = draft.questions as unknown as Question[];
    const ready = questions.filter((q) => q.correctIndex >= 0 && q.options.length >= 2);
    if (ready.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'Hech bir savolning toʻgʻri javobi aniqlanmagan. «Koʻrib chiqish» orqali belgilang.',
        show_alert: true,
      });
      return;
    }

    const template = await Template.create({
      ownerId: draft.ownerId,
      title: draft.title,
      questions: ready,
      status: 'ready',
      sourceType: draft.sourceType,
      sourceFileName: draft.sourceFileName,
    });
    await User.updateOne({ telegramId: draft.ownerId }, { $inc: { 'stats.templatesCount': 1 } });
    await Draft.deleteOne({ _id: draft._id });

    const skipped = questions.length - ready.length;
    await ctx.editMessageText(
      [
        `\u{1F4BE} <b>Shablon saqlandi!</b>`,
        ...(skipped > 0 ? [`⚠️ Javobi aniqlanmagan ${skipped} ta savol tashlab ketildi.`] : []),
        '',
        templateCard(template),
        '',
        '\u{1F447} Endi uni guruhga yuborib, musobaqa oʻtkazishingiz mumkin.',
      ].join('\n'),
      { parse_mode: 'HTML', reply_markup: templateKeyboard(String(template._id)) },
    );
    await ctx.answerCallbackQuery({ text: 'Saqlandi ✅' });
  });

  /* O'chirish — avval tasdiq so'raladi */
  bot.callbackQuery(/^draft:del:(.+)$/, async (ctx) => {
    await ctx.editMessageReplyMarkup({ reply_markup: draftDeleteConfirmKeyboard(ctx.match[1]!) });
    await ctx.answerCallbackQuery({ text: 'Rostdan oʻchirilsinmi?' });
  });

  bot.callbackQuery(/^draft:keep:(.+)$/, async (ctx) => {
    const draft = await Draft.findOne({ _id: ctx.match[1]!, ownerId: ctx.from.id }).catch(() => null);
    if (!draft) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      await ctx.answerCallbackQuery({ text: 'Qoralama topilmadi.' });
      return;
    }
    const questions = draft.questions as unknown as Question[];
    const ready = questions.filter((q) => q.correctIndex >= 0 && q.options.length >= 2).length;
    await ctx.editMessageReplyMarkup({
      reply_markup: draftKeyboard(String(draft._id), ready, questions.length),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^draft:delok:(.+)$/, async (ctx) => {
    await Draft.deleteOne({ _id: ctx.match[1]!, ownerId: ctx.from.id }).catch(() => undefined);
    await ctx.editMessageText('\u{1F5D1} Qoralama oʻchirildi.\n\nYangi test uchun fayl yoki matn yuboring.');
    await ctx.answerCallbackQuery({ text: 'Oʻchirildi' });
  });

  /* Ro'yxat sahifasi (xabar joyida tahrirlanadi) */
  bot.callbackQuery(/^tpl:list:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendTemplates(ctx, Number(ctx.match[1]), true);
  });

  /* Shablon kartochkasi. Eski tugmalarda sahifa raqami bo'lmasligi mumkin. */
  bot.callbackQuery(/^tpl:open:([^:]+)(?::(\d+))?$/, async (ctx) => {
    const template = await Template.findOne({ _id: ctx.match[1]!, ownerId: ctx.from.id }).catch(
      () => null,
    );
    if (!template) {
      await ctx.answerCallbackQuery({ text: 'Shablon topilmadi — ehtimol oʻchirilgan.', show_alert: true });
      return;
    }
    const page = ctx.match[2] !== undefined ? Number(ctx.match[2]) : undefined;
    await ctx
      .editMessageText(templateCard(template), {
        parse_mode: 'HTML',
        reply_markup: templateKeyboard(String(template._id), page),
      })
      .catch(async () => {
        // Xabarni tahrirlab bo'lmasa (masalan, juda eski) — yangi xabar
        await ctx.reply(templateCard(template), {
          parse_mode: 'HTML',
          reply_markup: templateKeyboard(String(template._id), page),
        });
      });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^tpl:pdf:([^:]+):(plain|key|teacher)$/, async (ctx) => {
    const [, id, rawMode] = ctx.match;
    const mode = rawMode as PdfMode;
    const template = await Template.findOne({ _id: id!, ownerId: ctx.from.id }).catch(() => null);
    if (!template) {
      await ctx.answerCallbackQuery({ text: 'Shablon topilmadi.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: '⏳ PDF tayyorlanmoqda…' });
    await ctx.replyWithChatAction('upload_document').catch(() => undefined);
    try {
      const pdf = await buildTestPdf(template, {
        withAnswerKey: mode === 'key',
        markCorrectInline: mode === 'teacher',
      });
      const safeName = template.title.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'test';
      await ctx.replyWithDocument(new InputFile(pdf, `${safeName}${PDF_SUFFIX[mode]}.pdf`), {
        caption: `${PDF_CAPTIONS[mode]}\n\u{1F4DA} ${template.title}`,
      });
    } catch (err) {
      logger.error('PDF yaratishda xato', err);
      await ctx.reply('❌ PDF yaratib boʻlmadi. Birozdan soʻng qayta urinib koʻring.');
    }
  });

  bot.callbackQuery(/^tpl:share:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      [
        '\u{1F3C1} <b>Guruhda musobaqa</b>',
        '',
        '1) Botni guruhga qoʻshing',
        '2) Guruhda <code>/boshlash</code> deb yozing',
        '3) Shablonni tanlab, <b>Boshlash</b> tugmasini bosing',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });
}

/* -------------------------------------------------------------- */

/** Shablonlar ro'yxati. `edit` — callbackdan chaqirilganda xabarni joyida yangilash. */
async function sendTemplates(ctx: Context, page: number, edit = false) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const total = await Template.countDocuments({ ownerId: userId });
  if (total === 0) {
    const extra = { parse_mode: 'HTML' as const, reply_markup: openAppKeyboard('/new', '\u{1F4E4} Panelda test qoʻshish') };
    if (edit) await ctx.editMessageText(t.noTemplates, extra).catch(() => undefined);
    else await ctx.reply(t.noTemplates, extra);
    return;
  }

  const pages = Math.ceil(total / TEMPLATES_PER_PAGE);
  const current = Math.min(Math.max(page, 0), pages - 1);
  const offset = current * TEMPLATES_PER_PAGE;
  const templates = await Template.find({ ownerId: userId })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(TEMPLATES_PER_PAGE);

  const text = [
    `\u{1F4DA} <b>Shablonlaringiz</b> · ${total} ta`,
    ``,
    `Kerakli testni tanlang — PDF olasiz yoki guruhga yuborasiz.`,
  ].join('\n');
  const kb = templatesListKeyboard(
    templates.map((tpl) => ({ id: String(tpl._id), title: tpl.title, questions: tpl.questions.length })),
    current,
    pages,
    offset,
  );

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => undefined);
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

async function sendStats(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const [user, templatesCount] = await Promise.all([
    User.findOne({ telegramId: userId }),
    Template.countDocuments({ ownerId: userId }),
  ]);
  const s = user?.stats;
  const accuracy =
    s && s.totalAnswers > 0 ? Math.round((s.totalCorrect / s.totalAnswers) * 100) : 0;

  await ctx.reply(
    [
      '\u{1F4CA} <b>Statistikangiz</b>',
      '',
      '<b>Yaratuvchi sifatida</b>',
      `\u{1F4DA} Shablonlar: <b>${templatesCount}</b>`,
      `\u{1F3C1} Oʻtkazgan musobaqalar: <b>${s?.racesHosted ?? 0}</b>`,
      '',
      '<b>Ishtirokchi sifatida</b>',
      `\u{1F3AE} Qatnashgan: <b>${s?.racesPlayed ?? 0}</b> · \u{1F947} Gʻalaba: <b>${s?.wins ?? 0}</b>`,
      `✅ Toʻgʻri javoblar: <b>${s?.totalCorrect ?? 0}</b> / ${s?.totalAnswers ?? 0} (${accuracy}%)`,
      `⭐ Umumiy ball: <b>${s?.totalScore ?? 0}</b>`,
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: openAppKeyboard('/profile', '\u{1F4C8} Batafsil — panelda').row().text(
        MENU.templates,
        'tpl:list:0',
      ),
    },
  );
}

