import type { FastifyInstance } from 'fastify';
import { InputFile } from 'grammy';
import type { RaceDTO, UserProfileDTO } from '@testrace/shared';
import { Race, Template, User } from '../../db/models.js';
import { buildRaceReportPdf } from '../../services/pdf.service.js';
import { renderPodium, type PodiumEntry } from '../../services/podium.service.js';
import { fetchUserAvatar } from '../../services/telegram.service.js';
import { getBot } from '../../bot/index.js';
import { currentUser, requireAuth } from '../auth.js';
import { logger } from '../../logger.js';
import { config, isAdmin } from '../../config.js';
import { shouldTouch, touchUser, userUpdate } from '../../services/user-touch.service.js';

/** Ro'yxat uchun savollarning faqat statistikasi kerak — matn va variantlar bazadan olinmaydi */
const RACE_LIST_PROJECTION = {
  'questions.text': 0,
  'questions.options': 0,
  'questions.explanation': 0,
  'questions.optionCounts': 0,
  'questions.pollId': 0,
  'questions.pollMessageId': 0,
} as const;

function toRaceDTO(doc: Record<string, any>, withQuestionStats = true): RaceDTO {
  return {
    id: String(doc._id),
    templateId: String(doc.templateId),
    templateTitle: doc.templateTitle,
    ownerId: doc.ownerId,
    chatId: doc.chatId,
    chatTitle: doc.chatTitle,
    status: doc.status,
    startedAt: doc.startedAt ? new Date(doc.startedAt).toISOString() : undefined,
    finishedAt: doc.finishedAt ? new Date(doc.finishedAt).toISOString() : undefined,
    totalQuestions: doc.questions?.length ?? 0,
    participants: (doc.participants ?? []).map((p: Record<string, any>) => ({
      userId: p.userId,
      firstName: p.firstName,
      username: p.username || undefined,
      score: p.score,
      correct: p.correct,
      wrong: p.wrong,
      missed: p.missed,
      avgTimeMs: p.answered > 0 ? Math.round(p.totalTimeMs / p.answered) : 0,
      place: p.place || undefined,
    })),
    questionStats: (withQuestionStats ? (doc.questions ?? []) : []).map((q: Record<string, any>, index: number) => ({
      index,
      text: q.text,
      correctIndex: q.correctIndex,
      answeredCount: q.answeredCount ?? 0,
      correctCount: q.correctCount ?? 0,
      optionCounts: q.optionCounts ?? [],
    })),
  };
}

export async function raceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /* Mening shablonlarim bo'yicha o'tkazilgan musobaqalar */
  app.get<{ Querystring: { templateId?: string; limit?: string } }>(
    '/api/races',
    async (req) => {
      const user = currentUser(req);
      const filter: Record<string, unknown> = { ownerId: user.id, status: 'finished' };
      if (req.query.templateId) filter.templateId = req.query.templateId;
      const docs = await Race.find(filter, RACE_LIST_PROJECTION)
        .sort({ finishedAt: -1 })
        .limit(Math.min(Number(req.query.limit ?? 50), 200))
        .lean();
      // Ro'yxatda savollar statistikasi kerak emas — to'liq ma'lumot /api/races/:id da
      return { races: docs.map((d) => toRaceDTO(d, false)) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/races/:id', async (req, reply) => {
    const user = currentUser(req);
    const doc = await Race.findById(req.params.id).lean();
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Musobaqa topilmadi' });
    const isParticipant = doc.participants.some((p) => p.userId === user.id);
    if (doc.ownerId !== user.id && doc.hostId !== user.id && !isParticipant) {
      return reply.code(403).send({ error: 'forbidden', message: 'Ruxsat yoʻq' });
    }
    return { race: toRaceDTO(doc) };
  });

  /* Musobaqa hisoboti PDF */
  app.get<{ Params: { id: string } }>('/api/races/:id/pdf', async (req, reply) => {
    const user = currentUser(req);
    const doc = await Race.findById(req.params.id);
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Musobaqa topilmadi' });
    if (doc.ownerId !== user.id && doc.hostId !== user.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Ruxsat yoʻq' });
    }
    const pdf = await buildRaceReportPdf(doc);
    const name = encodeURIComponent(
      `${doc.templateTitle.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'musobaqa'}-natijalar.pdf`,
    );
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${name}`)
      .send(pdf);
  });

  /* Podium rasmi */
  app.get<{ Params: { id: string } }>('/api/races/:id/podium.png', async (req, reply) => {
    const user = currentUser(req);
    const doc = await Race.findById(req.params.id);
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Musobaqa topilmadi' });
    if (doc.ownerId !== user.id && doc.hostId !== user.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Ruxsat yoʻq' });
    }

    const top = [...doc.participants]
      .filter((p) => p.place >= 1 && p.place <= 3)
      .sort((a, b) => a.place - b.place)
      .slice(0, 3);

    const entries: PodiumEntry[] = [];
    for (const p of top) {
      let avatar: Buffer | null = null;
      try {
        avatar = await fetchUserAvatar(getBot().bot.api, p.userId);
      } catch (err) {
        logger.debug('Avatar olinmadi', err);
      }
      entries.push({
        place: p.place as 1 | 2 | 3,
        name: p.firstName,
        username: p.username || undefined,
        score: p.score,
        correct: p.correct,
        total: doc.questions.length,
        avatar,
      });
    }

    const png = await renderPodium(entries, {
      title: doc.templateTitle,
      subtitle: `${doc.chatTitle} • ${doc.questions.length} ta savol • ${doc.participants.length} ishtirokchi`,
    });
    return reply.header('Content-Type', 'image/png').send(png);
  });

  /* Hisobotni bot orqali shaxsiy chatga yuborish */
  app.post<{ Params: { id: string } }>('/api/races/:id/send-pdf', async (req, reply) => {
    const user = currentUser(req);
    const doc = await Race.findById(req.params.id);
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Musobaqa topilmadi' });
    if (doc.ownerId !== user.id && doc.hostId !== user.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Ruxsat yoʻq' });
    }

    const pdf = await buildRaceReportPdf(doc);
    const safe = doc.templateTitle.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'musobaqa';
    try {
      await getBot().bot.api.sendDocument(user.id, new InputFile(pdf, `${safe}-natijalar.pdf`), {
        caption: `\u{1F4CA} ${doc.templateTitle} — musobaqa natijalari`,
      });
    } catch (err) {
      logger.error('Hisobot yuborilmadi', err);
      return reply.code(502).send({
        error: 'send_failed',
        message: 'Hisobot yuborilmadi. Avval botga /start yozing.',
      });
    }
    return { ok: true };
  });
}

export async function profileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /* Mini App sozlamalari — bazaga murojaatsiz (TemplateView faqat bot nomi uchun chaqiradi) */
  app.get('/api/config', async (req) => ({
    botUsername: config.BOT_USERNAME ?? null,
    isAdmin: isAdmin(currentUser(req).id),
  }));

  app.get('/api/me', async (req) => {
    const user = currentUser(req);
    const [found, templatesCount, racesCount] = await Promise.all([
      User.findOne({ telegramId: user.id }).lean(),
      Template.countDocuments({ ownerId: user.id }),
      Race.countDocuments({ ownerId: user.id, status: 'finished' }),
    ]);
    // Yangi foydalanuvchi darhol yaratiladi; qolganlar uchun yozish 10 daqiqada bir marta (fonda)
    let doc = found;
    if (!doc) {
      shouldTouch(user);
      doc = await User.findOneAndUpdate({ telegramId: user.id }, userUpdate(user), { new: true, upsert: true }).lean();
    } else {
      touchUser(user);
    }

    const profile: UserProfileDTO = {
      telegramId: user.id,
      firstName: doc?.firstName || user.first_name,
      lastName: doc?.lastName || user.last_name,
      username: doc?.username || user.username,
      photoUrl: user.photo_url || doc?.photoUrl,
      templatesCount,
      racesCount,
      createdAt: (doc?.createdAt ?? new Date()).toISOString(),
    };

    return { profile, stats: doc?.stats ?? null, botUsername: config.BOT_USERNAME ?? null };
  });

  /* Umumiy statistika: profil sahifasi uchun */
  app.get('/api/stats', async (req) => {
    const user = currentUser(req);

    const [templates, races] = await Promise.all([
      // Savollar o'zi emas, faqat soni kerak
      Template.aggregate<{ _id: unknown; title: string; racesCount: number; questionsCount: number }>([
        { $match: { ownerId: user.id } },
        { $sort: { racesCount: -1 } },
        { $limit: 5 },
        { $project: { title: 1, racesCount: 1, questionsCount: { $size: '$questions' } } },
      ]),
      Race.find({ ownerId: user.id, status: 'finished' }, RACE_LIST_PROJECTION)
        .sort({ finishedAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const totalParticipants = races.reduce((s, r) => s + r.participants.length, 0);
    const totalAnswers = races.reduce(
      (s, r) => s + r.questions.reduce((qs, q) => qs + (q.answeredCount ?? 0), 0),
      0,
    );
    const totalCorrect = races.reduce(
      (s, r) => s + r.questions.reduce((qs, q) => qs + (q.correctCount ?? 0), 0),
      0,
    );

    return {
      topTemplates: templates.map((t) => ({
        id: String(t._id),
        title: t.title,
        questions: t.questionsCount,
        racesCount: t.racesCount,
      })),
      recentRaces: races.map((r) => ({
        id: String(r._id),
        templateTitle: r.templateTitle,
        chatTitle: r.chatTitle,
        finishedAt: r.finishedAt?.toISOString(),
        participants: r.participants.length,
        winner: r.participants.find((p) => p.place === 1)?.firstName ?? null,
      })),
      totals: {
        races: races.length,
        participants: totalParticipants,
        answers: totalAnswers,
        correctRate: totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0,
      },
    };
  });
}
