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
      await ctx.reply('\u{1F3C1} Musobaqani boshlash: /boshlash');
      return;
    }

    const userId = ctx.from?.id;
    const template = await Template.findById(templateId).catch(() => null);
    if (!template || !userId) {
      await ctx.reply('Shablon topilmadi.');
      return;
    }
    if (template.ownerId !== userId) {
      await ctx.reply('Bu shablon sizga tegishli emas.');
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
      await ctx.reply('Musobaqa ketmoqda. /toxtat');
      return;
    }

    const templates = await Template.find({ ownerId: userId, status: 'ready' })
      .sort({ createdAt: -1 })
      .limit(10);

    if (templates.length === 0) {
      await ctx.reply(t.needTemplatesForRace(config.BOT_USERNAME), {
        reply_markup: config.BOT_USERNAME
          ? new InlineKeyboard().url(
              'Botni ochish',
              `https://t.me/${config.BOT_USERNAME}?start=upload`,
            )
          : undefined,
      });
      return;
    }

    const kb = new InlineKeyboard();
    templates.forEach((tpl) => {
      kb.text(
        `${tpl.title.slice(0, 32)} · ${tpl.questions.length}`,
        `race:pick:${String(tpl._id)}:${userId}`,
      ).row();
    });

    await ctx.reply('Shablonni tanlang:', { reply_markup: kb });
  });

  /* Shablon tanlandi */
  bot.callbackQuery(/^race:pick:([^:]+):(\d+)$/, async (ctx) => {
    const templateId = ctx.match[1]!;
    const starterId = Number(ctx.match[2]);
    if (ctx.from.id !== starterId) {
      await ctx.answerCallbackQuery({ text: 'Bu tanlov sizniki emas.', show_alert: true });
      return;
    }
    const chat = ctx.chat;
    if (!chat || !GROUP_TYPES.includes(chat.type)) {
      await ctx.answerCallbackQuery({ text: t.groupOnly, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const res = await engine.createRace({
      chatId: chat.id,
      chatTitle: 'title' in chat ? (chat.title ?? '') : '',
      hostId: ctx.from.id,
      templateId,
    });
    if (!res.ok) {
      await ctx.reply(res.message);
      return;
    }
    await ctx.deleteMessage().catch(() => undefined);
  });

  /* Boshlash */
  bot.callbackQuery(/^race:start:(.+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const res = await engine.start(ctx.chat.id, ctx.from.id);
    await ctx.answerCallbackQuery({ text: res.message, show_alert: !res.ok });
  });

  /* Bekor qilish */
  bot.callbackQuery(/^race:cancel:(.+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const res = await engine.cancel(ctx.chat.id, ctx.from.id);
    await ctx.answerCallbackQuery({ text: res.message, show_alert: !res.ok });
    if (res.ok) await ctx.deleteMessage().catch(() => undefined);
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
    await ctx.reply(res.message);
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
          ? `Faol musobaqa yoʻq. Oxirgisi: <b>${escapeHtml(last.templateTitle)}</b> · ${last.participants.length} kishi`
          : 'Faol musobaqa yoʻq. /boshlash',
        { parse_mode: 'HTML' },
      );
      return;
    }
    await ctx.reply(
      [
        `<b>${escapeHtml(runtime.title)}</b>`,
        `${Math.min(runtime.index + 1, runtime.questions.length)}/${runtime.questions.length} savol · ${runtime.participants.size} kishi`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });
}
