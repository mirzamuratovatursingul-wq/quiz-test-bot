import { GrammyError, InputFile, type Bot } from 'grammy';
import type { PollAnswer } from 'grammy/types';
import {
  assignPlaces,
  computeScore,
  boldOptionLabel,
  isUntimed,
  medal,
  optionLabel,
  shuffle,
  type Question,
} from '@testrace/shared';
import { Group, Race, Template, User } from '../db/models.js';
import { logger } from '../logger.js';
import { renderPodium, type PodiumEntry } from '../services/podium.service.js';
import { escapeHtml, fetchUserAvatar } from '../services/telegram.service.js';
import { raceIntroKeyboard, untimedControlKeyboard } from '../bot/keyboards.js';
import { t } from '../bot/texts.js';

/** Telegram so'rovnoma cheklovlari */
const POLL_QUESTION_MAX = 300;
const POLL_OPTION_MAX = 100;
const POLL_EXPLANATION_MAX = 200;
/** Savol yopilgandan keyin keyingisigacha tanaffus */
const NEXT_QUESTION_PAUSE_MS = 1800;
/**
 * Vaqtsiz rejimda so'rovnomalar orasidagi tanaffus. Telegram guruhga daqiqasiga
 * ~20 ta xabar ruxsat beradi; oshib ketsa 429 (retry_after) qaytadi va kutamiz.
 */
const UNTIMED_SEND_PAUSE_MS = 1100;
/** Vaqtsiz rejimda javoblar bazaga shuncha kechikish bilan yoziladi */
const UNTIMED_PERSIST_DELAY_MS = 2000;

export interface RaceQuestionRuntime {
  text: string;
  options: { text: string }[];
  correctIndex: number;
  /** Ixtiyoriy izoh — xato javob berganga koʻrsatiladi */
  explanation?: string;
  answeredCount: number;
  correctCount: number;
  optionCounts: number[];
  /** Vaqtsiz rejim: shu savolning so'rovnomasi */
  pollId?: string;
  pollMessageId?: number;
}

export interface ParticipantRuntime {
  userId: number;
  firstName: string;
  username: string;
  score: number;
  correct: number;
  wrong: number;
  missed: number;
  totalTimeMs: number;
  answered: number;
  /** Nechanchi savoldan qo'shilgani (kechikkanlar uchun) */
  joinedAt: number;
}

export interface RaceRuntime {
  raceId: string;
  chatId: number;
  chatTitle: string;
  hostId: number;
  ownerId: number;
  templateId: string;
  title: string;
  questions: RaceQuestionRuntime[];
  timePerQuestion: number;
  speedBonus: boolean;
  index: number;
  status: 'waiting' | 'running' | 'finished';
  participants: Map<number, ParticipantRuntime>;
  answeredThisQuestion: Set<number>;
  introMessageId?: number;
  pollId?: string;
  pollMessageId?: number;
  questionStartedAt: number;
  timer?: NodeJS.Timeout;
  stopping: boolean;
  /** Vaqtsiz rejim: hamma savol birdaniga, vaqt chegarasi yo'q, admin yakunlaydi */
  untimed: boolean;
  /** Vaqtsiz rejim: har bir savolga kim javob bergani */
  answeredBy: Set<number>[];
  /** Vaqtsiz rejim: nechta so'rovnoma yuborildi */
  sentCount: number;
  controlMessageId?: number;
  persistTimer?: NodeJS.Timeout;
}

/**
 * Matnni cheklovga moslash.
 * `keepLines` — savol matnida bo'sh qatorni saqlab qolish uchun
 * (so'rovnomada savol raqami va matn ajralib turadi).
 */
function truncate(text: string, max: number, keepLines = false): string {
  const clean = keepLines
    ? text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Xato javob berganga Telegram ko'rsatadigan eslatma.
 * Bu maydonda HTML ishlaydi, shuning uchun "Javob:" qalin chiqadi.
 * Telegram 200 belgigacha ruxsat beradi (teglarsiz hisoblanadi).
 */
function buildExplanation(q: RaceQuestionRuntime): string {
  const label = optionLabel(q.correctIndex);
  const answerText = truncate(q.options[q.correctIndex]?.text ?? '', 120);
  const answerPlain = `✅ Javob: ${label}) ${answerText}`;
  const answerHtml = `✅ <b>Javob:</b> ${label}) ${escapeHtml(answerText)}`;

  const note = q.explanation?.trim();
  if (!note) return answerHtml;

  // "\n\n💡 " uchun ~5 belgi zaxira
  const room = POLL_EXPLANATION_MAX - answerPlain.length - 5;
  if (room < 20) return answerHtml;

  const trimmed = note.length <= room ? note : `${note.slice(0, room - 1).trimEnd()}…`;
  return `${answerHtml}\n\n\u{1F4A1} ${escapeHtml(trimmed)}`;
}

export class RaceEngine {
  private runtimes = new Map<number, RaceRuntime>();
  /** poll_id -> qaysi chat va qaysi savol */
  private polls = new Map<string, { chatId: number; index: number }>();

  constructor(private bot: Bot) {}

  isActive(chatId: number): boolean {
    return this.runtimes.has(chatId);
  }

  getRuntime(chatId: number): RaceRuntime | undefined {
    return this.runtimes.get(chatId);
  }

  /* ---------------------------------------------------------------- */
  /* Musobaqani guruhga yuborish                                          */
  /* ---------------------------------------------------------------- */

  async createRace(params: {
    chatId: number;
    chatTitle: string;
    hostId: number;
    templateId: string;
  }): Promise<{ ok: boolean; message: string }> {
    if (this.runtimes.has(params.chatId)) {
      return { ok: false, message: 'Bu guruhda musobaqa ketmoqda. /toxtat' };
    }

    const template = await Template.findById(params.templateId).catch(() => null);
    if (!template) return { ok: false, message: 'Shablon topilmadi.' };

    const ready = (template.questions as unknown as Question[]).filter(
      (q) => q.correctIndex >= 0 && q.options.length >= 2,
    );
    if (ready.length === 0) {
      return { ok: false, message: 'Shablonda tayyor savol yoʻq.' };
    }

    const settings = template.settings;
    let questions = settings?.shuffleQuestions ? shuffle(ready) : ready;
    const limit = settings?.questionLimit ?? 0;
    if (limit > 0 && limit < questions.length) questions = questions.slice(0, limit);

    const runtimeQuestions: RaceQuestionRuntime[] = questions.map((q) => {
      const options = settings?.shuffleOptions ? shuffle(q.options) : q.options;
      const correctText = q.options[q.correctIndex]?.text ?? '';
      const correctIndex = settings?.shuffleOptions
        ? Math.max(0, options.findIndex((o) => o.text === correctText))
        : q.correctIndex;
      return {
        text: q.text,
        options: options.map((o) => ({ text: o.text })),
        correctIndex,
        explanation: q.explanation,
        answeredCount: 0,
        correctCount: 0,
        optionCounts: new Array(options.length).fill(0),
      };
    });

    const untimed = isUntimed(settings?.timePerQuestion);
    const race = await Race.create({
      templateId: template._id,
      templateTitle: template.title,
      ownerId: template.ownerId,
      hostId: params.hostId,
      chatId: params.chatId,
      chatTitle: params.chatTitle,
      status: 'waiting',
      questions: runtimeQuestions,
      participants: [],
      timePerQuestion: settings?.timePerQuestion ?? 15,
      // Vaqtsiz rejimda tezlik ma'nosiz — har bir to'g'ri javob 100 ball
      speedBonus: untimed ? false : (settings?.speedBonus ?? true),
      untimed,
    });

    const runtime: RaceRuntime = {
      raceId: String(race._id),
      chatId: params.chatId,
      chatTitle: params.chatTitle,
      hostId: params.hostId,
      ownerId: template.ownerId,
      templateId: String(template._id),
      title: template.title,
      questions: runtimeQuestions,
      timePerQuestion: race.timePerQuestion,
      speedBonus: race.speedBonus,
      index: 0,
      status: 'waiting',
      participants: new Map(),
      answeredThisQuestion: new Set(),
      questionStartedAt: 0,
      stopping: false,
      untimed,
      answeredBy: runtimeQuestions.map(() => new Set<number>()),
      sentCount: 0,
    };
    this.runtimes.set(params.chatId, runtime);

    const introLines = untimed
      ? [
          `\u{1F4DD} <b>Test</b> · vaqtsiz`,
          '',
          `\u{1F4DA} <b>${escapeHtml(runtime.title)}</b>`,
          `❓ Savollar: <b>${runtime.questions.length}</b> ta`,
          `✅ Ball: har bir toʻgʻri javob <b>100</b>`,
          '',
          `<b>Qoidalar</b>`,
          `\u{1F4DD} Hamma savol birdaniga soʻrovnoma boʻlib chiqadi`,
          `⏳ Vaqt chegarasi yoʻq — <b>istalgan paytda</b> javob bering`,
          `\u{1F512} Har kim <b>bir marta</b> javob beradi, oʻzgartirib boʻlmaydi`,
          `\u{1F3C1} Natijalarni testni yuborgan odam <b>Yakunlash</b> bilan eʼlon qiladi`,
          '',
          `\u{1F447} Guruh admini <b>Savollarni yuborish</b>ni bosadi.`,
        ]
      : [
          `\u{1F3C1} <b>Test musobaqasi</b>`,
          '',
          `\u{1F4DA} <b>${escapeHtml(runtime.title)}</b>`,
          `❓ Savollar: <b>${runtime.questions.length}</b> ta`,
          `⏱ Har bir savolga: <b>${runtime.timePerQuestion}</b> soniya`,
          runtime.speedBonus
            ? `⚡ Ball: toʻgʻri javob <b>100</b> + tezlik uchun <b>100</b> gacha bonus`
            : `✅ Ball: har bir toʻgʻri javob <b>100</b>`,
          '',
          `<b>Qoidalar</b>`,
          `\u{1F4DD} Savollar soʻrovnoma boʻlib chiqadi — variantni bosasiz`,
          `\u{1F512} Har kim <b>bir marta</b> javob beradi, oʻzgartirib boʻlmaydi`,
          `\u{1F465} Roʻyxatdan oʻtish shart emas — <b>istalgan savoldan</b> qoʻshiling`,
          '',
          `\u{1F447} Guruh admini <b>Boshlash</b>ni bosadi — savollarga hamma javob beradi.`,
        ];

    const msg = await this.bot.api.sendMessage(params.chatId, introLines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: raceIntroKeyboard(runtime.raceId, untimed),
    });
    runtime.introMessageId = msg.message_id;

    await Group.updateOne(
      { chatId: params.chatId },
      { $set: { title: params.chatTitle, isActive: true }, $inc: { racesCount: 1 } },
      { upsert: true },
    );

    return { ok: true, message: untimed ? 'Test guruhga yuborildi.' : 'Musobaqa guruhga yuborildi.' };
  }

  /* ---------------------------------------------------------------- */
  /* Start                                                             */
  /* ---------------------------------------------------------------- */

  async start(
    chatId: number,
    userId: number,
    raceId?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const r = this.runtimes.get(chatId);
    // Eski kartochkadagi tugma yangi musobaqani boshlab yubormasligi uchun id tekshiriladi
    if (!r || (raceId && r.raceId !== raceId)) {
      return { ok: false, message: 'Bu musobaqa endi faol emas. Yangisi: /boshlash' };
    }
    if (r.status !== 'waiting') return { ok: false, message: 'Musobaqa allaqachon ketmoqda.' };
    if (!(await this.isChatAdmin(chatId, userId))) {
      return { ok: false, message: t.adminOnly };
    }

    r.status = 'running';
    await Race.updateOne({ _id: r.raceId }, { $set: { status: 'running', startedAt: new Date() } });

    if (r.untimed) {
      if (r.introMessageId) {
        await this.safeEdit(
          chatId,
          r.introMessageId,
          [
            `\u{1F4DD} <b>${escapeHtml(r.title)}</b>`,
            `❓ ${r.questions.length} savol · ⏳ vaqtsiz`,
            '',
            `\u{1F4E8} Savollar yuborilmoqda — istalgan paytda javob bering.`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        );
      }
      void this.sendAllPolls(chatId);
      return { ok: true, message: 'Savollar yuborilmoqda \u{1F4E8}' };
    }

    if (r.introMessageId) {
      await this.safeEdit(
        chatId,
        r.introMessageId,
        [
          `\u{1F3C1} <b>${escapeHtml(r.title)}</b>`,
          `❓ ${r.questions.length} savol · ⏱ ${r.timePerQuestion} s`,
          '',
          `\u{1F3AE} Musobaqa boshlandi — omad!`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    }

    const countdown = await this.bot.api.sendMessage(
      chatId,
      '\u{1F6A6} <b>Tayyormisiz?</b>\n\n3️⃣',
      { parse_mode: 'HTML' },
    );
    for (const step of ['2️⃣', '1️⃣']) {
      await sleep(1000);
      await this.safeEdit(chatId, countdown.message_id, `\u{1F6A6} <b>Tayyormisiz?</b>\n\n${step}`, {
        parse_mode: 'HTML',
      });
    }
    await sleep(900);
    await this.safeEdit(chatId, countdown.message_id, '\u{1F3C1} <b>Start!</b>', {
      parse_mode: 'HTML',
    });

    void this.sendQuestion(chatId);
    return { ok: true, message: 'Boshlandi — omad! \u{1F340}' };
  }

  /* ---------------------------------------------------------------- */
  /* Savol: Telegram quiz so'rovnomasi                                 */
  /* ---------------------------------------------------------------- */

  private async sendQuestion(chatId: number) {
    const r = this.runtimes.get(chatId);
    if (!r || r.stopping) return;

    const q = r.questions[r.index];
    if (!q) {
      await this.finish(chatId);
      return;
    }

    r.answeredThisQuestion = new Set();

    try {
      const msg = await this.postQuestion(chatId, r, r.index);
      r.pollMessageId = msg.message_id;
      r.questionStartedAt = Date.now();
      if (msg.poll) {
        r.pollId = msg.poll.id;
        this.polls.set(msg.poll.id, { chatId, index: r.index });
      }
    } catch (err) {
      logger.error('Soʻrovnoma yuborilmadi', err);
      await this.finish(chatId);
      return;
    }

    r.timer = setTimeout(() => void this.closeQuestion(chatId), (r.timePerQuestion + 1) * 1000);
  }

  /**
   * Bitta savolni quiz so'rovnomasi qilib yuborish (ikkala rejim uchun).
   * Vaqtli rejimda open_period — Telegram jonli sanoqni o'zi ko'rsatadi;
   * vaqtsiz rejimda so'rovnoma admin yakunlaguncha ochiq turadi.
   */
  private async postQuestion(chatId: number, r: RaceRuntime, index: number) {
    const q = r.questions[index]!;
    const total = r.questions.length;

    // So'rovnoma savoli: raqam alohida qatorda, matn ostida — o'qishga qulay.
    // Eslatma: Telegram so'rovnoma savoli va variantlarida qalin shrift ishlamaydi
    // (faqat custom emoji), shuning uchun tuzilma bo'sh qator va harflar bilan beriladi.
    const header = `[${index + 1}/${total}]-savol`;
    const fullQuestion = `${header}\n\n${q.text}`;
    // Harf qalin (Unicode), matn oddiy — kirill matnlar ham buzilmaydi.
    // Harf, qavs va ikki bo'shliq uchun 5 belgi zaxira qoldiriladi.
    const labeled = q.options.map(
      (o, i) => `${boldOptionLabel(i)})  ${truncate(o.text, POLL_OPTION_MAX - 5)}`,
    );

    const needsLongForm =
      fullQuestion.length > POLL_QUESTION_MAX || labeled.some((o) => o.length > POLL_OPTION_MAX);

    // Uzun savol/variantlar so'rovnomaga sig'masa, to'liq matn alohida xabarda chiqadi
    if (needsLongForm) {
      const optionsText = q.options
        .map((o, i) => `<b>${optionLabel(i)})</b>  ${escapeHtml(o.text)}`)
        .join('\n\n');
      await this.withRetry(() =>
        this.bot.api.sendMessage(
          chatId,
          [
            `<b>${header}</b>`,
            '',
            `<b>${escapeHtml(q.text)}</b>`,
            '',
            optionsText,
            '',
            `\u{1F447} Javobni quyidagi soʻrovnomada belgilang${r.untimed ? '' : ` · ⏱ ${r.timePerQuestion} s`}`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        ),
      ).catch((err) => logger.debug('Uzun savol matni yuborilmadi', err));
    }

    return this.withRetry(() =>
      this.bot.api.sendPoll(
        chatId,
        truncate(fullQuestion, POLL_QUESTION_MAX, true),
        labeled.map((text) => ({ text })),
        {
          type: 'quiz',
          correct_option_ids: [q.correctIndex],
          is_anonymous: false, // poll_answer yangilanishlari faqat shunda keladi
          allows_revoting: false, // javobni o'zgartirib bo'lmaydi
          ...(r.untimed ? {} : { open_period: r.timePerQuestion }),
          explanation: buildExplanation(q),
          explanation_parse_mode: 'HTML',
        },
      ),
    );
  }

  /**
   * Telegram cheklovi (429 "Too Many Requests") bo'lsa, aytilgan vaqtcha kutib qayta urinish.
   * Guruhga ko'p so'rovnoma ketma-ket yuborilganda kerak bo'ladi.
   */
  private async withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (err) {
        const retryAfter = err instanceof GrammyError ? err.parameters?.retry_after : undefined;
        if (retryAfter === undefined || i >= attempts - 1) throw err;
        logger.debug(`Telegram cheklovi: ${retryAfter} s kutilmoqda`);
        await sleep((retryAfter + 1) * 1000);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Vaqtsiz rejim: hamma savol birdaniga, admin yakunlaydi            */
  /* ---------------------------------------------------------------- */

  private async sendAllPolls(chatId: number) {
    const r = this.runtimes.get(chatId);
    if (!r) return;

    for (let i = r.sentCount; i < r.questions.length; i++) {
      if (r.stopping || r.status !== 'running') return;
      try {
        const msg = await this.postQuestion(chatId, r, i);
        const q = r.questions[i]!;
        q.pollMessageId = msg.message_id;
        if (msg.poll) {
          q.pollId = msg.poll.id;
          this.polls.set(msg.poll.id, { chatId, index: i });
        }
        r.sentCount = i + 1;
      } catch (err) {
        logger.error(`Vaqtsiz test: ${i + 1}-savol yuborilmadi`, err);
        break;
      }
      await this.persist(r);
      if (i < r.questions.length - 1) await sleep(UNTIMED_SEND_PAUSE_MS);
    }
    if (r.stopping || r.status !== 'running') return;

    // Yuborilmay qolganlari (xato) natijaga kirmaydi
    if (r.sentCount === 0) {
      await this.bot.api.sendMessage(chatId, '❌ Savollarni yuborib boʻlmadi. Botga soʻrovnoma yuborish huquqini bering.').catch(() => undefined);
      await this.finish(chatId);
      return;
    }
    await this.sendUntimedControls(chatId, r);
  }

  /** "Yakunlash" tugmali xabar */
  private async sendUntimedControls(chatId: number, r: RaceRuntime) {
    const skipped = r.questions.length - r.sentCount;
    const msg = await this.withRetry(() =>
      this.bot.api.sendMessage(
        chatId,
        [
          `✅ <b>${r.sentCount} ta savol yuborildi</b>`,
          skipped > 0 ? `⚠️ ${skipped} ta savol yuborilmadi (Telegram xatosi)` : '',
          '',
          `⏳ Javob berish ochiq — vaqt chegarasi yoʻq.`,
          `\u{1F3C1} Testni yuborgan odam <b>Yakunlash</b>ni bosganda natijalar eʼlon qilinadi va soʻrovnomalar yopiladi.`,
        ]
          .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
          .join('\n'),
        { parse_mode: 'HTML', reply_markup: untimedControlKeyboard(r.raceId) },
      ),
    ).catch((err) => {
      logger.error('Yakunlash tugmasi yuborilmadi', err);
      return null;
    });
    r.controlMessageId = msg?.message_id;
    await Race.updateOne({ _id: r.raceId }, { $set: { controlMessageId: r.controlMessageId } });
  }

  /**
   * Vaqtsiz testni yakunlash — faqat testni guruhga yuborgan odam (host).
   *
   * Natijalar DARHOL hisoblanib e'lon qilinadi, so'rovnomalar esa keyin fonda yopiladi.
   * Avval har bir so'rovnoma birma-bir yopilardi: Telegram guruhda bunday amallarni
   * daqiqasiga ~20 ta bilan cheklaydi, 20+ savolda bot daqiqalab kutib qolardi va
   * "natijalar hisoblanmoqda…" xabari qotib turardi. Yakunlash boshlangach kelgan
   * javoblar hisobga olinmaydi (r.stopping), shuning uchun natija o'zgarmaydi.
   */
  async finishUntimed(
    chatId: number,
    userId: number,
    raceId?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const r = this.runtimes.get(chatId);
    if (!r || !r.untimed || (raceId && r.raceId !== raceId)) {
      return { ok: false, message: 'Bu test endi faol emas.' };
    }
    if (r.status !== 'running') return { ok: false, message: 'Test hali boshlanmagan.' };
    if (userId !== r.hostId) {
      return { ok: false, message: '\u{1F512} Natijalarni faqat testni guruhga yuborgan odam hisoblay oladi.' };
    }
    if (r.stopping) return { ok: false, message: 'Natijalar allaqachon hisoblanmoqda…' };

    // Yangi javoblarni qabul qilmaymiz, yuborish davom etayotgan bo'lsa to'xtaydi
    r.stopping = true;
    if (r.persistTimer) clearTimeout(r.persistTimer);
    if (r.controlMessageId) {
      await this.safeEdit(chatId, r.controlMessageId, '\u{1F3C1} <b>Test yakunlandi</b> — natijalar hisoblanmoqda…', {
        parse_mode: 'HTML',
      });
    }

    // Yuborilmagan savollar natijaga kirmaydi
    r.questions = r.questions.slice(0, r.sentCount);
    const total = r.questions.length;
    for (const p of r.participants.values()) p.missed = Math.max(0, total - p.answered);

    const pollMessageIds = this.detachUntimedPolls(r);
    void this.finish(chatId).finally(() => void this.closePollsInBackground(chatId, pollMessageIds));
    return { ok: true, message: 'Yakunlandi — natijalar eʼlon qilinmoqda' };
  }

  /** So'rovnomalarni javob qabul qilishdan uzish; yopish uchun xabar id larini qaytaradi */
  private detachUntimedPolls(r: RaceRuntime): number[] {
    const ids: number[] = [];
    for (const q of r.questions) {
      if (q.pollId) this.polls.delete(q.pollId);
      if (q.pollMessageId) ids.push(q.pollMessageId);
    }
    return ids;
  }

  /**
   * So'rovnomalarni sekin-asta yopish (Telegram cheklovidan oshmaslik uchun).
   * Hech narsani kutdirmaydi; yopilmay qolganlari baribir javob qabul qilmaydi.
   */
  private async closePollsInBackground(chatId: number, messageIds: number[]) {
    for (const id of messageIds) {
      await this.withRetry(() => this.bot.api.stopPoll(chatId, id), 3).catch(() => undefined);
      await sleep(UNTIMED_SEND_PAUSE_MS);
    }
  }

  /** Vaqtsiz rejimda javoblar ko'p bo'lishi mumkin — bazaga yig'ib yozamiz */
  private schedulePersist(r: RaceRuntime) {
    if (r.persistTimer) return;
    r.persistTimer = setTimeout(() => {
      r.persistTimer = undefined;
      void this.persist(r);
    }, UNTIMED_PERSIST_DELAY_MS);
  }

  /** poll_answer yangilanishi */
  async handlePollAnswer(answer: PollAnswer): Promise<void> {
    const loc = this.polls.get(answer.poll_id);
    if (!loc) return;
    const r = this.runtimes.get(loc.chatId);
    if (!r || r.status !== 'running' || r.stopping) return;
    // Vaqtli rejimda faqat hozirgi savolga; vaqtsizda istalgan ochiq savolga
    if (!r.untimed && r.index !== loc.index) return;

    const user = answer.user;
    if (!user || user.is_bot) return;
    const optionIndex = answer.option_ids[0];
    if (optionIndex === undefined) return; // ovoz qaytarib olindi (quizda bo'lmaydi)
    const answered = r.untimed ? r.answeredBy[loc.index] : r.answeredThisQuestion;
    if (!answered || answered.has(user.id)) return;

    const q = r.questions[loc.index];
    if (!q) return;

    answered.add(user.id);

    let participant = r.participants.get(user.id);
    if (!participant) {
      participant = {
        userId: user.id,
        firstName: user.first_name,
        username: user.username ?? '',
        score: 0,
        correct: 0,
        wrong: 0,
        missed: 0,
        totalTimeMs: 0,
        answered: 0,
        joinedAt: r.index,
      };
      r.participants.set(user.id, participant);
    }

    // Vaqtsiz rejimda tezlik hisoblanmaydi
    const elapsedMs = r.untimed ? 0 : Date.now() - r.questionStartedAt;
    const correct = optionIndex === q.correctIndex;
    participant.score += computeScore({
      correct,
      elapsedMs,
      limitMs: r.timePerQuestion * 1000,
      speedBonus: r.speedBonus,
    });
    participant.answered += 1;
    participant.totalTimeMs += elapsedMs;
    if (correct) participant.correct += 1;
    else participant.wrong += 1;

    q.answeredCount += 1;
    if (correct) q.correctCount += 1;
    if (optionIndex >= 0 && optionIndex < q.optionCounts.length) {
      q.optionCounts[optionIndex] = (q.optionCounts[optionIndex] ?? 0) + 1;
    }
    if (r.untimed) this.schedulePersist(r);
  }

  /** Vaqt tugadi: javob bermaganlarni belgilab, keyingi savolga o'tamiz */
  private async closeQuestion(chatId: number) {
    const r = this.runtimes.get(chatId);
    if (!r || r.stopping) return;

    for (const p of r.participants.values()) {
      if (p.joinedAt <= r.index && !r.answeredThisQuestion.has(p.userId)) p.missed += 1;
    }

    if (r.pollId) this.polls.delete(r.pollId);
    r.pollId = undefined;

    await this.persist(r);

    r.index += 1;
    if (r.index >= r.questions.length) {
      await sleep(NEXT_QUESTION_PAUSE_MS);
      await this.finish(chatId);
      return;
    }

    await sleep(NEXT_QUESTION_PAUSE_MS);
    void this.sendQuestion(chatId);
  }

  /* ---------------------------------------------------------------- */
  /* Yakun                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Yakun: natijalarni hisoblash va e'lon qilish.
   * Har qanday holatda (xato, Telegram cheklovi, hech kim javob bermagan) musobaqa
   * "finished" bo'ladi va runtime tozalanadi — guruh qotib qolmaydi.
   */
  private async finish(chatId: number) {
    const r = this.runtimes.get(chatId);
    if (!r || r.status === 'finished') return;
    r.status = 'finished';
    if (r.timer) clearTimeout(r.timer);
    if (r.persistTimer) clearTimeout(r.persistTimer);
    if (r.pollId) this.polls.delete(r.pollId);

    try {
      await this.announceResults(r);
    } catch (err) {
      logger.error('Natijalarni eʼlon qilishda xato', err);
      await Race.updateOne({ _id: r.raceId }, { $set: { status: 'finished', finishedAt: new Date() } }).catch(
        () => undefined,
      );
      await this.withRetry(() =>
        this.bot.api.sendMessage(
          chatId,
          '⚠️ Natijalarni toʻliq eʼlon qilib boʻlmadi. Natijalar shablon egasining panelida saqlandi.',
        ),
      ).catch(() => undefined);
    } finally {
      if (this.runtimes.get(chatId) === r) this.runtimes.delete(chatId);
    }
  }

  /** Telegram'ga yuborish: 429 bo'lsa kutib qayta urinadi, boshqa xatoda null (keyingi qadam davom etadi) */
  private async trySend<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await this.withRetry(fn);
    } catch (err) {
      logger.error(`${label} yuborilmadi`, err);
      return null;
    }
  }

  private async announceResults(r: RaceRuntime) {
    const chatId = r.chatId;
    const ranked = assignPlaces(
      [...r.participants.values()].map((p) => ({
        ...p,
        avgTimeMs: p.answered > 0 ? p.totalTimeMs / p.answered : Number.MAX_SAFE_INTEGER,
      })),
    );

    await this.persist(r, ranked);
    await Race.updateOne({ _id: r.raceId }, { $set: { status: 'finished', finishedAt: new Date() } });

    const total = r.questions.length;
    const kind = r.untimed ? 'Test' : 'Musobaqa';
    const closeControls = (text: string) =>
      r.controlMessageId ? this.safeEdit(chatId, r.controlMessageId, text, { parse_mode: 'HTML' }) : Promise.resolve();

    if (ranked.length === 0) {
      await closeControls(`\u{1F3C1} <b>${kind} yakunlandi</b> — hech kim javob bermadi.`);
      await this.trySend('Yakuniy xabar', () =>
        this.bot.api.sendMessage(chatId, `\u{1F3C1} ${kind} tugadi — hech kim javob bermadi.`),
      );
      await Template.updateOne({ _id: r.templateId }, { $inc: { racesCount: 1 } }).catch(() => undefined);
      return;
    }

    // Podium faqat ball olganlar uchun; teng ballda bir o'rinda bir nechta kishi bo'lishi
    // mumkin — rasm va e'londa har o'rinning birinchisi ko'rsatiladi (to'liq ro'yxat jadvalda)
    const podium = ranked
      .filter((p) => p.score > 0 && p.place <= 3)
      .filter((p, i, arr) => arr.findIndex((x) => x.place === p.place) === i);

    // 3 → 2 → 1
    if (podium.length > 0) {
      const announce = await this.trySend('Yakun eʼloni', () =>
        this.bot.api.sendMessage(chatId, '\u{1F3C1} <b>Yakun</b>', { parse_mode: 'HTML' }),
      );
      if (announce) {
        for (const place of [3, 2, 1] as const) {
          if (!podium.some((p) => p.place === place)) continue;
          await sleep(1200);
          await this.safeEdit(
            chatId,
            announce.message_id,
            [
              '\u{1F3C1} <b>Yakun</b>',
              '',
              ...[3, 2, 1]
                .filter((pl) => pl >= place)
                .sort((a, b) => b - a)
                .map((pl) => {
                  const w = podium.find((p) => p.place === pl);
                  return w ? `${medal(pl)} ${escapeHtml(w.firstName)} — <b>${w.score}</b>` : null;
                })
                .filter(Boolean),
            ].join('\n'),
            { parse_mode: 'HTML' },
          );
        }
      }

      // Podium rasmi
      try {
        const entries: PodiumEntry[] = [];
        for (const p of podium) {
          entries.push({
            place: p.place as 1 | 2 | 3,
            name: p.firstName,
            username: p.username || undefined,
            score: p.score,
            correct: p.correct,
            total,
            avatar: await fetchUserAvatar(this.bot.api, p.userId).catch(() => null),
          });
        }
        const image = await renderPodium(entries, {
          title: r.title,
          subtitle: `${total} savol · ${r.participants.size} ishtirokchi`,
        });
        await this.trySend('Podium rasmi', () => this.bot.api.sendPhoto(chatId, new InputFile(image, 'natijalar.png')));
      } catch (err) {
        logger.error('Podium rasmi yaratilmadi', err);
      }
    }

    // To'liq jadval
    const table = ranked
      .slice(0, 15)
      .map((p) => {
        // 0 ball olganlarga medal berilmaydi (hamma 0 bo'lsa hamma "1-o'rin" bo'lib qolardi)
        const mark = p.score > 0 ? medal(p.place) : '▫️';
        const line = `${mark} ${escapeHtml(p.firstName)} — <b>${p.score}</b> ball · ✅ ${p.correct}/${total}`;
        if (r.untimed) return line;
        const avg = p.answered > 0 ? `${(p.totalTimeMs / p.answered / 1000).toFixed(1)}s` : '—';
        return `${line} · ⚡ ${avg}`;
      })
      .join('\n');

    const avgCorrect =
      Math.round((ranked.reduce((s, p) => s + p.correct, 0) / ranked.length) * 10) / 10;
    const hardest = r.questions
      .map((q, i) => ({ i, rate: q.answeredCount ? q.correctCount / q.answeredCount : 1 }))
      .sort((a, b) => a.rate - b.rate)[0];

    const totalAnswers = r.questions.reduce((s, q) => s + q.answeredCount, 0);
    const totalCorrect = r.questions.reduce((s, q) => s + q.correctCount, 0);
    const accuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;
    const best = ranked[0];
    const unanswered = r.questions.filter((q) => q.answeredCount === 0).length;

    // Xabar mazmunli guruhlarga bo'linadi: har guruh orasida bo'sh qator
    const sections: string[][] = [
      [`\u{1F4CA} <b>Yakuniy natijalar</b>`, `\u{1F4DA} ${escapeHtml(r.title)}`],
      [
        `\u{1F3C6} <b>Reyting</b>`,
        table,
        ranked.length > 15 ? `<i>...va yana ${ranked.length - 15} kishi</i>` : '',
      ],
      [
        `\u{1F4C8} <b>Umumiy koʻrsatkichlar</b>`,
        `\u{1F465} Ishtirokchilar: <b>${ranked.length}</b>`,
        `❓ Savollar: <b>${total}</b>`,
        `✅ Toʻgʻri javoblar ulushi: <b>${accuracy}%</b>`,
        `\u{1F4CB} Oʻrtacha natija: <b>${avgCorrect}</b>/${total}`,
      ],
      [
        `\u{1F50D} <b>Eʼtiborga loyiq</b>`,
        best && best.score > 0
          ? `\u{1F947} Eng yuqori ball: <b>${escapeHtml(best.firstName)}</b> — ${best.score}`
          : '\u{1F914} Hech kim toʻgʻri javob bermadi',
        hardest && hardest.rate < 1
          ? `\u{1F525} Eng qiyin savol: <b>${hardest.i + 1}-savol</b> — ${Math.round(hardest.rate * 100)}% toʻgʻri`
          : '',
        unanswered > 0 ? `\u{1F4ED} Hech kim javob bermagan savollar: <b>${unanswered}</b> ta` : '',
      ],
      [`\u{1F4BE} Natijalar shablon egasining panelida saqlandi.`],
    ];

    const text = sections
      .map((lines) => lines.filter(Boolean).join('\n'))
      .filter((block) => block.trim().length > 0)
      .join('\n\n');

    await this.trySend('Yakuniy natijalar', () => this.bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' }));
    await closeControls(`\u{1F3C1} <b>${kind} yakunlandi</b> — natijalar pastda \u{1F447}`);

    try {
      await this.updateUserStats(ranked, r);
      await Template.updateOne({ _id: r.templateId }, { $inc: { racesCount: 1 } });
    } catch (err) {
      logger.error('Statistikani yangilab boʻlmadi', err);
    }
  }

  private async updateUserStats(
    ranked: (ParticipantRuntime & { place: number })[],
    r: RaceRuntime,
  ) {
    await User.updateOne({ telegramId: r.ownerId }, { $inc: { 'stats.racesHosted': 1 } });
    for (const p of ranked) {
      await User.updateOne(
        { telegramId: p.userId },
        {
          $setOnInsert: { telegramId: p.userId, firstName: p.firstName, username: p.username },
          $inc: {
            'stats.racesPlayed': 1,
            // Hamma 0 ball olsa hamma "1-o'rin" bo'ladi — bu g'alaba emas
            'stats.wins': p.place === 1 && p.score > 0 ? 1 : 0,
            'stats.totalScore': p.score,
            'stats.totalCorrect': p.correct,
            'stats.totalAnswers': p.answered,
          },
        },
        { upsert: true },
      );
    }
  }

  /* ---------------------------------------------------------------- */

  async cancel(
    chatId: number,
    userId: number,
    raceId?: string,
  ): Promise<{ ok: boolean; message: string; wasRunning?: boolean; asked?: number; untimed?: boolean }> {
    const r = this.runtimes.get(chatId);
    if (!r || (raceId && r.raceId !== raceId)) {
      return { ok: false, message: 'Faol musobaqa yoʻq.' };
    }
    if (!(await this.isChatAdmin(chatId, userId))) {
      return { ok: false, message: t.adminOnly };
    }
    r.stopping = true;
    if (r.timer) clearTimeout(r.timer);
    if (r.persistTimer) clearTimeout(r.persistTimer);
    if (r.pollId) this.polls.delete(r.pollId);
    // Ochiq turgan so'rovnomani yopamiz — javob berib bo'lmasligi aniq ko'rinsin
    if (r.status === 'running' && r.untimed) {
      void this.closePollsInBackground(chatId, this.detachUntimedPolls(r));
      if (r.controlMessageId) {
        await this.safeEdit(chatId, r.controlMessageId, '⏹ Test toʻxtatildi — natijalar hisoblanmadi.');
      }
    } else if (r.status === 'running' && r.pollMessageId) {
      try {
        await this.bot.api.stopPoll(chatId, r.pollMessageId);
      } catch {
        /* allaqachon yopilgan */
      }
    }
    await Race.updateOne({ _id: r.raceId }, { $set: { status: 'cancelled' } });
    this.runtimes.delete(chatId);
    return {
      ok: true,
      message: 'Toʻxtatildi.',
      wasRunning: r.status === 'running',
      asked: r.untimed ? r.sentCount : r.index,
      untimed: r.untimed,
    };
  }

  /**
   * Bot qayta ishga tushganda ochiq turgan vaqtsiz testlarni tiklash.
   * Ular soatlab/kunlab ochiq turishi mumkin — deploy natijalarni yo'qotmasligi kerak.
   * (Oxirgi ~2 soniyadagi javoblar bazaga yozilmay qolgan bo'lishi mumkin.)
   */
  async restoreUntimed(): Promise<number> {
    const docs = await Race.find({ status: 'running', untimed: true });
    let restored = 0;
    for (const doc of docs) {
      if (this.runtimes.has(doc.chatId)) continue;
      const questions: RaceQuestionRuntime[] = doc.questions
        .filter((q) => q.pollId)
        .map((q) => ({
          text: q.text,
          options: q.options.map((o) => ({ text: o.text })),
          correctIndex: q.correctIndex,
          explanation: q.explanation ?? undefined,
          answeredCount: q.answeredCount,
          correctCount: q.correctCount,
          optionCounts: [...q.optionCounts],
          pollId: q.pollId ?? undefined,
          pollMessageId: q.pollMessageId ?? undefined,
        }));
      if (questions.length === 0) {
        await Race.updateOne({ _id: doc._id }, { $set: { status: 'cancelled' } });
        continue;
      }

      const runtime: RaceRuntime = {
        raceId: String(doc._id),
        chatId: doc.chatId,
        chatTitle: doc.chatTitle,
        hostId: doc.hostId,
        ownerId: doc.ownerId,
        templateId: String(doc.templateId),
        title: doc.templateTitle,
        questions,
        timePerQuestion: doc.timePerQuestion,
        speedBonus: false,
        index: 0,
        status: 'running',
        participants: new Map(
          doc.participants.map((p) => [
            p.userId,
            {
              userId: p.userId,
              firstName: p.firstName,
              username: p.username,
              score: p.score,
              correct: p.correct,
              wrong: p.wrong,
              missed: p.missed,
              totalTimeMs: p.totalTimeMs,
              answered: p.answered,
              joinedAt: 0,
            },
          ]),
        ),
        answeredThisQuestion: new Set(),
        questionStartedAt: 0,
        stopping: false,
        untimed: true,
        // Telegram quiz'da qayta ovoz berib bo'lmaydi, shuning uchun bo'sh to'plam xavfsiz
        answeredBy: questions.map(() => new Set<number>()),
        sentCount: questions.length,
        controlMessageId: doc.controlMessageId ?? undefined,
      };
      this.runtimes.set(doc.chatId, runtime);
      questions.forEach((q, index) => {
        if (q.pollId) this.polls.set(q.pollId, { chatId: doc.chatId, index });
      });
      // Yuborish yarim qolgan bo'lsa — yakunlash tugmasi hali chiqmagan
      if (!runtime.controlMessageId) await this.sendUntimedControls(doc.chatId, runtime);
      restored++;
    }
    return restored;
  }


  private participantDocs(r: RaceRuntime, ranked?: (ParticipantRuntime & { place: number })[]) {
    const source = ranked ?? [...r.participants.values()].map((p) => ({ ...p, place: 0 }));
    return source.map((p) => ({
      userId: p.userId,
      firstName: p.firstName,
      username: p.username,
      score: p.score,
      correct: p.correct,
      wrong: p.wrong,
      missed: p.missed,
      totalTimeMs: p.totalTimeMs,
      answered: p.answered,
      place: p.place,
    }));
  }

  private async persist(r: RaceRuntime, ranked?: (ParticipantRuntime & { place: number })[]) {
    try {
      await Race.updateOne(
        { _id: r.raceId },
        {
          $set: {
            currentIndex: r.index,
            participants: this.participantDocs(r, ranked),
            questions: r.questions,
          },
        },
      );
    } catch (err) {
      logger.error('Musobaqa holatini saqlab boʻlmadi', err);
    }
  }

  /** Musobaqani faqat guruh adminlari (egasi ham) boshqaradi; javob berish — hammaga ochiq */
  async isChatAdmin(chatId: number, userId: number): Promise<boolean> {
    try {
      const member = await this.bot.api.getChatMember(chatId, userId);
      return member.status === 'administrator' || member.status === 'creator';
    } catch {
      return false;
    }
  }

  private async safeEdit(
    chatId: number,
    messageId: number,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    try {
      await this.bot.api.editMessageText(chatId, messageId, text, extra);
    } catch (err) {
      logger.debug('Xabarni tahrirlab boʻlmadi', err);
    }
  }

  /**
   * Bot qayta ishga tushganda yarim qolgan musobaqalarni yopish.
   * Ketayotgan vaqtsiz testlar tegilmaydi — ular restoreUntimed() bilan tiklanadi.
   */
  static async cleanupStale(): Promise<number> {
    const res = await Race.updateMany(
      {
        $or: [
          { status: 'waiting' },
          { status: 'running', untimed: { $ne: true } },
        ],
      },
      { $set: { status: 'cancelled' } },
    );
    return res.modifiedCount ?? 0;
  }
}
