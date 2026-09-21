import { InlineKeyboard, InputFile, type Bot, type Context } from 'grammy';
import { parseTestText, optionLabel, type Question } from '@testrace/shared';
import { config } from '../../config.js';
import { Draft, Template, User } from '../../db/models.js';
import { logger } from '../../logger.js';
import { ExtractError, extractText } from '../../services/extract.service.js';
import { buildTestPdf } from '../../services/pdf.service.js';
import { downloadTelegramFile, escapeHtml } from '../../services/telegram.service.js';
import { draftKeyboard, mainMenuKeyboard, openAppKeyboard, templateKeyboard } from '../keyboards.js';
import { t } from '../texts.js';

const MIN_TEXT_LENGTH = 40;

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
    '\u{1F447} Savollarni koʻrib chiqing va tasdiqlang — shundan keyin shablon profilingizga saqlanadi.',
  );
  return lines.join('\n');
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
        '❌ Savollar topilmadi.',
        '',
        'Test quyidagi koʻrinishda boʻlishi kerak:',
        '<code>1. Savol matni?</code>',
        '<code>+A) Toʻgʻri javob</code>',
        '<code>B) Boshqa variant</code>',
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
        .map((o, oi) => `  ${oi === q.correctIndex ? '✅' : '➖'} ${optionLabel(oi)}) ${escapeHtml(o.text)}`)
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
    { parse_mode: 'HTML', reply_markup: draftKeyboard(String(draft._id)) },
  );
}

export function registerPrivateHandlers(bot: Bot) {
  bot.chatType('private').command('start', async (ctx) => {
    await ctx.reply(t.start(escapeHtml(ctx.from?.first_name ?? 'doʻst')), {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
    await ctx.reply('\u{1F447} Yaratuvchi paneli (shablonlar, tahrirlash, PDF, statistika):', {
      reply_markup: openAppKeyboard('/'),
    });
  });

  bot.chatType('private').command(['help', 'yordam'], async (ctx) => {
    await ctx.reply(t.help, { parse_mode: 'HTML' });
  });

  /* ---------------- Fayl yuklash ---------------- */

  bot.chatType('private').on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const sizeMb = (doc.file_size ?? 0) / (1024 * 1024);
    if (sizeMb > config.MAX_FILE_MB) {
      await ctx.reply(t.fileTooBig(config.MAX_FILE_MB));
      return;
    }

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
        await ctx.reply('❌ Faylni qayta ishlab boʻlmadi. Qaytadan urinib koʻring.');
      }
    }
  });

  /* ---------------- Matn ---------------- */

  bot.chatType('private').on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    switch (text) {
      case '\u{1F4DA} Shablonlarim':
        await sendTemplates(ctx);
        return;
      case '\u{1F4E4} Test yuklash':
        await ctx.reply(
          [
            '\u{1F4E4} Menga PDF, Word (.docx) fayl yoki test matnini yuboring.',
            '',
            'Toʻgʻri javobni <b>+</b> bilan belgilang:',
            '<code>1. 2+2=?</code>',
            '<code>A) 3</code>',
            '<code>+B) 4</code>',
            '<code>C) 5</code>',
          ].join('\n'),
          { parse_mode: 'HTML' },
        );
        return;
      case '\u{1F4CA} Statistikam':
        await sendStats(ctx);
        return;
      case 'ℹ️ Yordam':
        await ctx.reply(t.help, { parse_mode: 'HTML' });
        return;
      default:
        break;
    }

    if (text.length < MIN_TEXT_LENGTH) {
      await ctx.reply(
        'Test matni juda qisqa. Toʻliq testni yuboring yoki PDF/Word fayl yuklang. ℹ️ /yordam',
      );
      return;
    }

    await handleParsedText(ctx, { text, sourceType: 'text' });
  });

  bot.chatType('private').command(['shablonlarim', 'templates'], async (ctx) => {
    await sendTemplates(ctx);
  });

  bot.chatType('private').command(['statistika', 'stats'], async (ctx) => {
    await sendStats(ctx);
  });

  /* ---------------- Callbacklar ---------------- */

  bot.callbackQuery(/^draft:save:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1]!;
    const draft = await Draft.findById(draftId);
    if (!draft || draft.ownerId !== ctx.from.id) {
      await ctx.answerCallbackQuery({ text: 'Qoralama topilmadi.', show_alert: true });
      return;
    }

    const questions = draft.questions as unknown as Question[];
    const ready = questions.filter((q) => q.correctIndex >= 0 && q.options.length >= 2);
    if (ready.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'Hech bir savolning toʻgʻri javobi aniqlanmagan. Mini App orqali belgilang.',
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
        ``,
        `\u{1F4DA} <b>${escapeHtml(template.title)}</b>`,
        `❓ Savollar: <b>${ready.length}</b> ta`,
        skipped > 0 ? `⚠️ Javobi aniqlanmagan ${skipped} ta savol tashlab ketildi.` : '',
        ``,
        `Endi uni guruhda <code>/boshlash</code> orqali ishlatishingiz mumkin.`,
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'HTML', reply_markup: templateKeyboard(String(template._id)) },
    );
    await ctx.answerCallbackQuery({ text: 'Saqlandi ✅' });
  });

  bot.callbackQuery(/^draft:del:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1]!;
    await Draft.deleteOne({ _id: draftId, ownerId: ctx.from.id });
    await ctx.editMessageText('\u{1F5D1} Qoralama oʻchirildi.');
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^tpl:open:(.+)$/, async (ctx) => {
    const template = await Template.findOne({ _id: ctx.match[1]!, ownerId: ctx.from.id });
    if (!template) {
      await ctx.answerCallbackQuery({ text: 'Shablon topilmadi.', show_alert: true });
      return;
    }
    const questions = template.questions as unknown as Question[];
    const preview = questions
      .slice(0, 3)
      .map((q, i) => `${i + 1}. ${escapeHtml(q.text)}\n   ✅ ${escapeHtml(q.options[q.correctIndex]?.text ?? '—')}`)
      .join('\n');
    await ctx.reply(
      [
        `\u{1F4DA} <b>${escapeHtml(template.title)}</b>`,
        `❓ ${questions.length} ta savol • \u{1F3C1} ${template.racesCount} marta musobaqa`,
        `⏱ Savolga ${template.settings?.timePerQuestion ?? 15} soniya`,
        ``,
        preview,
      ].join('\n'),
      { parse_mode: 'HTML', reply_markup: templateKeyboard(String(template._id)) },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^tpl:pdf:([^:]+):(plain|key)$/, async (ctx) => {
    const [, id, mode] = ctx.match;
    const template = await Template.findOne({ _id: id!, ownerId: ctx.from.id });
    if (!template) {
      await ctx.answerCallbackQuery({ text: 'Shablon topilmadi.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: 'PDF tayyorlanmoqda...' });
    try {
      const pdf = await buildTestPdf(template, {
        withAnswerKey: mode === 'key',
        markCorrectInline: false,
      });
      const safeName = template.title.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'test';
      await ctx.replyWithDocument(
        new InputFile(pdf, `${safeName}${mode === 'key' ? '-kalit' : ''}.pdf`),
        {
          caption:
            mode === 'key'
              ? '\u{1F511} Test + javoblar kaliti'
              : '\u{1F4C4} Test varianti (kalitsiz)',
        },
      );
    } catch (err) {
      logger.error('PDF yaratishda xato', err);
      await ctx.reply('❌ PDF yaratib boʻlmadi.');
    }
  });

  bot.callbackQuery(/^tpl:share:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      [
        'Botni guruhga qoʻshing va u yerda <code>/boshlash</code> deb yozing.',
        'Soʻng shablonni tanlab, <b>Boshlash</b> tugmasini bosasiz.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });
}

/* -------------------------------------------------------------- */

async function sendTemplates(ctx: Context) {
  const c = ctx;
  const userId = c.from?.id;
  if (!userId) return;

  const templates = await Template.find({ ownerId: userId }).sort({ createdAt: -1 }).limit(20);
  if (templates.length === 0) {
    await c.reply(t.noTemplates, { reply_markup: openAppKeyboard('/') });
    return;
  }

  const kb = new InlineKeyboard();
  templates.forEach((tpl, i) => {
    kb.text(
      `${i + 1}. ${tpl.title.slice(0, 28)} (${tpl.questions.length})`,
      `tpl:open:${String(tpl._id)}`,
    ).row();
  });

  await c.reply(
    `\u{1F4DA} <b>Shablonlaringiz</b> (${templates.length} ta)\n\nBatafsil koʻrish uchun tanlang:`,
    { parse_mode: 'HTML', reply_markup: kb },
  );
}

async function sendStats(ctx: Context) {
  const c = ctx;
  const userId = c.from?.id;
  if (!userId) return;

  const [user, templatesCount] = await Promise.all([
    User.findOne({ telegramId: userId }),
    Template.countDocuments({ ownerId: userId }),
  ]);
  const s = user?.stats;
  const accuracy =
    s && s.totalAnswers > 0 ? Math.round((s.totalCorrect / s.totalAnswers) * 100) : 0;

  await c.reply(
    [
      '\u{1F4CA} <b>Statistikangiz</b>',
      '',
      `\u{1F4DA} Shablonlar: <b>${templatesCount}</b>`,
      `\u{1F3C1} Oʻtkazgan musobaqalar: <b>${s?.racesHosted ?? 0}</b>`,
      `\u{1F3AE} Qatnashgan musobaqalar: <b>${s?.racesPlayed ?? 0}</b>`,
      `\u{1F947} Gʻalabalar: <b>${s?.wins ?? 0}</b>`,
      `✅ Toʻgʻri javoblar: <b>${s?.totalCorrect ?? 0}</b> / ${s?.totalAnswers ?? 0} (${accuracy}%)`,
      `⭐ Umumiy ball: <b>${s?.totalScore ?? 0}</b>`,
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: openAppKeyboard('/profile') },
  );
}
