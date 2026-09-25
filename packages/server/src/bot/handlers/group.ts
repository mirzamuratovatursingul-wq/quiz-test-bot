import { InlineKeyboard, type Bot } from 'grammy';
import { Group, Race, Template } from '../../db/models.js';
import { config } from '../../config.js';
import { escapeHtml } from '../../services/telegram.service.js';
import type { RaceEngine } from '../../race/engine.js';
import { t } from '../texts.js';

const GROUP_TYPES = ['group', 'supergroup'];

/** "tpl_<id>" ko'rinishidagi deep-link yukidan shablon id sini olish */
function templateIdFromPayload(payload: string | undefined): string | null {
  if (!payload) return null;
  const m = /^tpl[_-]([a-f0-9]{24})$/i.exec(payload.trim());
  return m?.[1] ?? null;
}

/** Matnli progress chizig'i: ▰▰▰▱▱▱ */
function progressBar(done: number, total: number, width = 10): string {
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export function registerGroupHandlers(bot: Bot, engine: RaceEngine) {
  /* Bot guruhga qo'shilganda */
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (!GROUP_TYPES.includes(chat.type)) return;
    const status = ctx.myChatMember.new_chat_member.status;

    if (status === 'member' || status === 'administrator') {
      await Group.updateOne(
        { chatId: chat.id },
        {
          $set: {
            title: 'title' in chat ? chat.title : '',
            type: chat.type,
            addedBy: ctx.from?.id,
            isActive: true,
          },
        },
        { upsert: true },
      );
    } else if (status === 'left' || status === 'kicked') {
      await Group.updateOne({ chatId: chat.id }, { $set: { isActive: false } });
    }
  });

  /* Mini App'dan "Guruhga yuborish": t.me/bot?startgroup=tpl_<id> */
  bot.command('start', async (ctx) => {
    if (!ctx.chat || !GROUP_TYPES.includes(ctx.chat.type)) return;

    const templateId = templateIdFromPayload(ctx.match);
    if (!templateId) {
      await ctx.reply('\u{1F3C1} Musobaqani boshlash uchun: /boshlash');
      return;
    }

    const userId = ctx.from?.id;
    const template = await Template.findById(templateId).catch(() => null);
    if (!template || !userId) {
      await ctx.reply('⚠️ Shablon topilmadi — ehtimol oʻchirilgan.');
      return;
    }
    if (template.ownerId !== userId) {
      await ctx.reply('\u{1F512} Bu shablon sizga tegishli emas. Oʻz shablonlaringiz: /boshlash');
      return;
    }

    const res = await engine.createRace({
      chatId: ctx.chat.id,
      chatTitle: 'title' in ctx.chat ? (ctx.chat.title ?? '') : '',
      hostId: userId,
      templateId,
    });
    if (!res.ok) await ctx.reply(res.message);
  });

  /* /boshlash — guruhda shablon tanlash */
  bot.command(['boshlash', 'musobaqa'], async (ctx) => {
    if (!ctx.chat || !GROUP_TYPES.includes(ctx.chat.type)) {
      await ctx.reply(t.groupOnly);
      return;
    }
    const userId = ctx.from?.id;
    if (!userId) return;

    if (engine.isActive(ctx.chat.id)) {
      await ctx.reply('⏳ Bu guruhda musobaqa ketmoqda. Holat: /holat · Toʻxtatish: /toxtat');
      return;
    }

    const templates = await Template.find({ ownerId: userId, status: 'ready' })
      .sort({ createdAt: -1 })
      .limit(10);

    if (templates.length === 0) {
      await ctx.reply(t.needTemplatesForRace(config.BOT_USERNAME), {
        reply_markup: config.BOT_USERNAME
          ? new InlineKeyboard().url(
              '\u{1F4E4} Botda test yuklash',
              `https://t.me/${config.BOT_USERNAME}?start=upload`,
            )
          : undefined,
      });
      return;
    }

    const kb = new InlineKeyboard();
    templates.forEach((tpl) => {
      const title = tpl.title.length > 30 ? `${tpl.title.slice(0, 29)}…` : tpl.title;
      kb.text(
        `\u{1F4D8} ${title} · ${tpl.questions.length} savol`,
        `race:pick:${String(tpl._id)}:${userId}`,
      ).row();
    });
    kb.text('✕ Bekor qilish', `race:pickcancel:${userId}`);

    await ctx.reply(
      `\u{1F3C1} <b>Qaysi test bilan musobaqa oʻtkazamiz?</b>\n\n${escapeHtml(ctx.from?.first_name ?? '')}, shablonni tanlang:`,
      { parse_mode: 'HTML', reply_markup: kb },
    );
  });

  /* Shablon tanlandi */
  bot.callbackQuery(/^race:pick:([^:]+):(\d+)$/, async (ctx) => {
    const templateId = ctx.match[1]!;
    const starterId = Number(ctx.match[2]);
    if (ctx.from.id !== starterId) {
      await ctx.answerCallbackQuery({
        text: 'Bu roʻyxat /boshlash yozgan kishi uchun. Oʻzingiz ham /boshlash yozing.',
        show_alert: true,
      });
      return;
    }
    const chat = ctx.chat;
    if (!chat || !GROUP_TYPES.includes(chat.type)) {
      await ctx.answerCallbackQuery({ text: t.groupOnly, show_alert: true });
      return;
    }

    const res = await engine.createRace({
      chatId: chat.id,
      chatTitle: 'title' in chat ? (chat.title ?? '') : '',
      hostId: ctx.from.id,
      templateId,
    });
    if (!res.ok) {
      await ctx.answerCallbackQuery({ text: res.message, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });

  bot.callbackQuery(/^race:pickcancel:(\d+)$/, async (ctx) => {
    if (ctx.from.id !== Number(ctx.match[1])) {
      await ctx.answerCallbackQuery({ text: 'Bu roʻyxat sizniki emas.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });

  /* Boshlash */
  bot.callbackQuery(/^race:start:(.+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const res = await engine.start(ctx.chat.id, ctx.from.id, ctx.match[1]);
    await ctx.answerCallbackQuery({ text: res.message, show_alert: !res.ok });
  });

  /* Bekor qilish (kartochkadagi tugma) */
  bot.callbackQuery(/^race:cancel:(.+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const res = await engine.cancel(ctx.chat.id, ctx.from.id, ctx.match[1]);
    await ctx.answerCallbackQuery({ text: res.ok ? 'Bekor qilindi' : res.message, show_alert: !res.ok });
    if (res.ok) {
      await ctx
        .editMessageText(`✕ Musobaqa bekor qilindi · ${escapeHtml(ctx.from.first_name)}`, {
          reply_markup: undefined,
        })
        .catch(() => ctx.deleteMessage().catch(() => undefined));
    }
  });

  /* Yakundan keyin "Yana bir marta" — shu shablon bilan yangi kartochka */
  bot.callbackQuery(/^race:again:([a-f0-9]{24}):(\d+)$/, async (ctx) => {
    const chat = ctx.chat;
    if (!chat || !GROUP_TYPES.includes(chat.type)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, templateId, hostId] = ctx.match;
    if (!(await engine.canManage(chat.id, ctx.from.id, Number(hostId)))) {
      await ctx.answerCallbackQuery({
        text: 'Qayta boshlashni oldingi boshlovchi yoki guruh admini qila oladi.',
        show_alert: true,
      });
      return;
    }
    const res = await engine.createRace({
      chatId: chat.id,
      chatTitle: 'title' in chat ? (chat.title ?? '') : '',
      hostId: ctx.from.id,
      templateId: templateId!,
    });
    await ctx.answerCallbackQuery({ text: res.ok ? 'Yangi musobaqa tayyor \u{1F447}' : res.message, show_alert: !res.ok });
    // Tugma qayta bosilmasligi uchun olib tashlanadi
    if (res.ok) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  });

  /* Quiz so'rovnomasidagi javoblar */
  bot.on('poll_answer', async (ctx) => {
    await engine.handlePollAnswer(ctx.pollAnswer);
  });

  /* /toxtat */
  bot.command(['toxtat', 'stop'], async (ctx) => {
    if (!ctx.chat || !GROUP_TYPES.includes(ctx.chat.type)) {
      await ctx.reply(t.groupOnly);
      return;
    }
    const res = await engine.cancel(ctx.chat.id, ctx.from?.id ?? 0);
    if (!res.ok) {
      await ctx.reply(res.message);
      return;
    }
    await ctx.reply(
      res.wasRunning
        ? `⏹ <b>Musobaqa toʻxtatildi</b> (${res.asked ?? 0}-savolda).\nNatijalar hisoblanmadi. Yangisi: /boshlash`
        : '✕ Musobaqa bekor qilindi. Yangisi: /boshlash',
      { parse_mode: 'HTML' },
    );
  });

  /* /holat */
  bot.command(['holat', 'status'], async (ctx) => {
    if (!ctx.chat) return;
    const runtime = engine.getRuntime(ctx.chat.id);
    if (!runtime) {
      const last = await Race.findOne({ chatId: ctx.chat.id, status: 'finished' }).sort({
        finishedAt: -1,
      });
      await ctx.reply(
        last
          ? `\u{1F4A4} Hozir musobaqa yoʻq.\nOxirgisi: <b>${escapeHtml(last.templateTitle)}</b> · \u{1F465} ${last.participants.length} kishi\n\nYangisi: /boshlash`
          : '\u{1F4A4} Hozir musobaqa yoʻq. Boshlash: /boshlash',
        { parse_mode: 'HTML' },
      );
      return;
    }
    const total = runtime.questions.length;
    const current = Math.min(runtime.index + 1, total);
    await ctx.reply(
      [
        `\u{1F3C1} <b>${escapeHtml(runtime.title)}</b>`,
        runtime.status === 'waiting'
          ? '⏳ Boshlanishini kutmoqda'
          : `${progressBar(runtime.index, total)} ${current}/${total}-savol`,
        `\u{1F465} Qatnashayotganlar: <b>${runtime.participants.size}</b>`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });
}
