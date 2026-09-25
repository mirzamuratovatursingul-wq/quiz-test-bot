import { InputFile, type Bot } from 'grammy';
import type { PollAnswer } from 'grammy/types';
import {
  assignPlaces,
  computeScore,
  boldOptionLabel,
  medal,
  optionLabel,
  shuffle,
  type Question,
} from '@testrace/shared';
import { Group, Race, Template, User } from '../db/models.js';
import { logger } from '../logger.js';
import { renderPodium, type PodiumEntry } from '../services/podium.service.js';
import { escapeHtml, fetchUserAvatar } from '../services/telegram.service.js';
import { raceFinishedKeyboard, raceIntroKeyboard } from '../bot/keyboards.js';

/** Telegram so'rovnoma cheklovlari */
const POLL_QUESTION_MAX = 300;
const POLL_OPTION_MAX = 100;
const POLL_EXPLANATION_MAX = 200;
/** Savol yopilgandan keyin keyingisigacha tanaffus */
const NEXT_QUESTION_PAUSE_MS = 1800;
/** Nechta savoldan keyin oraliq reyting chiqsin */
const LEADERBOARD_EVERY = 5;

export interface RaceQuestionRuntime {
  text: string;
  options: { text: string }[];
  correctIndex: number;
  /** Ixtiyoriy izoh — xato javob berganga koʻrsatiladi */
  explanation?: string;
  answeredCount: number;
  correctCount: number;
  optionCounts: number[];
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
      speedBonus: settings?.speedBonus ?? true,
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
    };
    this.runtimes.set(params.chatId, runtime);

    const msg = await this.bot.api.sendMessage(
      params.chatId,
      [
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
        `\u{1F447} Boshlovchi yoki guruh admini <b>Boshlash</b>ni bosadi.`,
      ].join('\n'),
      { parse_mode: 'HTML', reply_markup: raceIntroKeyboard(runtime.raceId) },
    );
    runtime.introMessageId = msg.message_id;

    await Group.updateOne(
      { chatId: params.chatId },
      { $set: { title: params.chatTitle, isActive: true }, $inc: { racesCount: 1 } },
      { upsert: true },
    );

    return { ok: true, message: 'Musobaqa guruhga yuborildi.' };
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
    if (!(await this.canManage(chatId, userId, r.hostId))) {
      return { ok: false, message: 'Faqat musobaqani yuborgan kishi yoki guruh admini boshlaydi.' };
    }

    r.status = 'running';
    await Race.updateOne({ _id: r.raceId }, { $set: { status: 'running', startedAt: new Date() } });

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

    // So'rovnoma savoli: raqam alohida qatorda, matn ostida — o'qishga qulay.
    // Eslatma: Telegram so'rovnoma savoli va variantlarida qalin shrift ishlamaydi
    // (faqat custom emoji), shuning uchun tuzilma bo'sh qator va harflar bilan beriladi.
    const header = `[${r.index + 1}/${r.questions.length}]-savol`;
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
      await this.bot.api
        .sendMessage(
          chatId,
          [
            `<b>[${r.index + 1}/${r.questions.length}]-savol</b>`,
            '',
            `<b>${escapeHtml(q.text)}</b>`,
            '',
            optionsText,
            '',
            `\u{1F447} Javobni quyidagi soʻrovnomada belgilang · ⏱ ${r.timePerQuestion} s`,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        .catch((err) => logger.debug('Uzun savol matni yuborilmadi', err));
    }

    const explanation = buildExplanation(q);

    try {
      const msg = await this.bot.api.sendPoll(
        chatId,
        truncate(fullQuestion, POLL_QUESTION_MAX, true),
        labeled.map((text) => ({ text })),
        {
          type: 'quiz',
          correct_option_ids: [q.correctIndex],
          is_anonymous: false, // poll_answer yangilanishlari faqat shunda keladi
          allows_revoting: false, // javobni o'zgartirib bo'lmaydi
          open_period: r.timePerQuestion, // Telegram jonli sanoqni o'zi ko'rsatadi
          explanation,
          explanation_parse_mode: 'HTML',
        },
      );
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

  /** poll_answer yangilanishi */
  async handlePollAnswer(answer: PollAnswer): Promise<void> {
    const loc = this.polls.get(answer.poll_id);
    if (!loc) return;
    const r = this.runtimes.get(loc.chatId);
    if (!r || r.status !== 'running' || r.index !== loc.index) return;

    const user = answer.user;
    if (!user || user.is_bot) return;
    const optionIndex = answer.option_ids[0];
    if (optionIndex === undefined) return; // ovoz qaytarib olindi (quizda bo'lmaydi)
    if (r.answeredThisQuestion.has(user.id)) return;

    const q = r.questions[r.index];
    if (!q) return;

    r.answeredThisQuestion.add(user.id);

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

    const elapsedMs = Date.now() - r.questionStartedAt;
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

    // Har 5 savolda oraliq reyting — musobaqa hissini kuchaytiradi
    if (r.index % LEADERBOARD_EVERY === 0 && r.participants.size > 0) {
      await this.sendLeaderboard(chatId, r);
    }

    await sleep(NEXT_QUESTION_PAUSE_MS);
    void this.sendQuestion(chatId);
  }

  /** Musobaqa davomidagi qisqa reyting */
  private async sendLeaderboard(chatId: number, r: RaceRuntime) {
    const ranked = assignPlaces(
      [...r.participants.values()].map((p) => ({
        ...p,
        avgTimeMs: p.answered > 0 ? p.totalTimeMs / p.answered : Number.MAX_SAFE_INTEGER,
      })),
    ).slice(0, 5);

    const rows = ranked
      .map(
        (p) =>
          `${medal(p.place)} ${escapeHtml(p.firstName)} — <b>${p.score}</b> ball · ${p.correct} toʻgʻri`,
      )
      .join('\n');

    await this.bot.api
      .sendMessage(
        chatId,
        [
          `\u{1F4CA} <b>Oraliq reyting</b> · ${r.index}/${r.questions.length} savol`,
          '',
          rows,
          '',
          `\u{1F525} Yana <b>${r.questions.length - r.index}</b> ta savol qoldi!`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
      .catch((err) => logger.debug('Reyting yuborilmadi', err));
  }

  /* ---------------------------------------------------------------- */
  /* Yakun                                                             */
  /* ---------------------------------------------------------------- */

  private async finish(chatId: number) {
    const r = this.runtimes.get(chatId);
    if (!r) return;
    r.status = 'finished';
    if (r.timer) clearTimeout(r.timer);
    if (r.pollId) this.polls.delete(r.pollId);

    const ranked = assignPlaces(
      [...r.participants.values()].map((p) => ({
        ...p,
        avgTimeMs: p.answered > 0 ? p.totalTimeMs / p.answered : Number.MAX_SAFE_INTEGER,
      })),
    );

    await this.persist(r, ranked);
    await Race.updateOne({ _id: r.raceId }, { $set: { status: 'finished', finishedAt: new Date() } });

    const total = r.questions.length;

    if (ranked.length === 0) {
      await this.bot.api.sendMessage(
        chatId,
        '\u{1F3C1} Musobaqa tugadi — hech kim javob bermadi.\n\nYana bir urinib koʻramizmi?',
        { reply_markup: raceFinishedKeyboard(r.templateId, r.hostId) },
      );
      this.runtimes.delete(chatId);
      return;
    }

    // 3 → 2 → 1
    const podium = ranked.filter((p) => p.place <= 3).slice(0, 3);
    const announce = await this.bot.api.sendMessage(chatId, '\u{1F3C1} <b>Yakun</b>', {
      parse_mode: 'HTML',
    });
    for (const place of [3, 2, 1] as const) {
      const winner = podium.find((p) => p.place === place);
      if (!winner) continue;
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
              return w
                ? `${medal(pl)} ${escapeHtml(w.firstName)} — <b>${w.score}</b>`
                : null;
            })
            .filter(Boolean),
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
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
          avatar: await fetchUserAvatar(this.bot.api, p.userId),
        });
      }
      if (entries.length > 0) {
        const image = await renderPodium(entries, {
          title: r.title,
          subtitle: `${total} savol · ${r.participants.size} ishtirokchi`,
        });
        await this.bot.api.sendPhoto(chatId, new InputFile(image, 'natijalar.png'));
      }
    } catch (err) {
      logger.error('Podium rasmi yaratilmadi', err);
    }

    // To'liq jadval
    const table = ranked
      .slice(0, 15)
      .map((p) => {
        const avg = p.answered > 0 ? `${(p.totalTimeMs / p.answered / 1000).toFixed(1)}s` : '—';
        return `${medal(p.place)} ${escapeHtml(p.firstName)} — <b>${p.score}</b> ball · ✅ ${p.correct}/${total} · ⚡ ${avg}`;
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
        best ? `\u{1F947} Eng yuqori ball: <b>${escapeHtml(best.firstName)}</b> — ${best.score}` : '',
        hardest && hardest.rate < 1
          ? `\u{1F525} Eng qiyin savol: <b>${hardest.i + 1}-savol</b> — ${Math.round(hardest.rate * 100)}% toʻgʻri`
          : '',
      ],
      [`\u{1F4BE} Natijalar shablon egasining panelida saqlandi.`],
    ];

    const text = sections
      .map((lines) => lines.filter(Boolean).join('\n'))
      .filter((block) => block.trim().length > 0)
      .join('\n\n');

    await this.bot.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: raceFinishedKeyboard(r.templateId, r.hostId),
    });

    await this.updateUserStats(ranked, r);
    await Template.updateOne({ _id: r.templateId }, { $inc: { racesCount: 1 } });
    this.runtimes.delete(chatId);
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
            'stats.wins': p.place === 1 ? 1 : 0,
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
  ): Promise<{ ok: boolean; message: string; wasRunning?: boolean; asked?: number }> {
    const r = this.runtimes.get(chatId);
    if (!r || (raceId && r.raceId !== raceId)) {
      return { ok: false, message: 'Faol musobaqa yoʻq.' };
    }
    if (!(await this.canManage(chatId, userId, r.hostId))) {
      return { ok: false, message: 'Faqat boshlovchi yoki guruh admini toʻxtata oladi.' };
    }
    r.stopping = true;
    if (r.timer) clearTimeout(r.timer);
    if (r.pollId) this.polls.delete(r.pollId);
    // Ochiq turgan so'rovnomani yopamiz — javob berib bo'lmasligi aniq ko'rinsin
    if (r.status === 'running' && r.pollMessageId) {
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
      asked: r.index,
    };
  }

  /** Boshlovchi yoki guruh admini boshqara oladi */
  async canManage(chatId: number, userId: number, hostId: number): Promise<boolean> {
    return userId === hostId || this.isChatAdmin(chatId, userId);
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

  private async isChatAdmin(chatId: number, userId: number): Promise<boolean> {
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

  /** Bot qayta ishga tushganda yarim qolgan musobaqalarni yopish */
  static async cleanupStale(): Promise<number> {
    const res = await Race.updateMany(
      { status: { $in: ['waiting', 'running'] } },
      { $set: { status: 'cancelled' } },
    );
    return res.modifiedCount ?? 0;
  }
}
