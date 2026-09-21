import type { FastifyInstance } from 'fastify';
import { InputFile } from 'grammy';
import { z } from 'zod';
import type { Question, TemplateDTO } from '@testrace/shared';
import { Template, User } from '../../db/models.js';
import { buildTestPdf } from '../../services/pdf.service.js';
import { currentUser, requireAuth } from '../auth.js';
import { getBot } from '../../bot/index.js';
import { logger } from '../../logger.js';

const questionSchema = z.object({
  text: z.string().min(1).max(2000),
  options: z.array(z.object({ text: z.string().min(1).max(500) })).min(2).max(8),
  correctIndex: z.number().int().min(-1).max(7),
  explanation: z.string().max(1000).optional(),
});

const settingsSchema = z.object({
  timePerQuestion: z.number().int().min(5).max(120),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  questionLimit: z.number().int().min(0).max(500),
  speedBonus: z.boolean(),
});

const createSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  subject: z.string().max(100).optional(),
  questions: z.array(questionSchema).default([]),
  settings: settingsSchema.partial().optional(),
});

const updateSchema = createSchema.partial();

export function toTemplateDTO(doc: {
  _id: unknown;
  ownerId: number;
  title: string;
  description?: string | null;
  subject?: string | null;
  status: string;
  questions: unknown;
  settings?: unknown;
  sourceType: string;
  sourceFileName?: string | null;
  racesCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}): TemplateDTO {
  return {
    id: String(doc._id),
    ownerId: doc.ownerId,
    title: doc.title,
    description: doc.description ?? '',
    subject: doc.subject ?? '',
    status: doc.status as TemplateDTO['status'],
    questions: doc.questions as Question[],
    settings: doc.settings as TemplateDTO['settings'],
    sourceType: doc.sourceType as TemplateDTO['sourceType'],
    sourceFileName: doc.sourceFileName ?? '',
    racesCount: doc.racesCount,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
  };
}

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /* Ro'yxat */
  app.get('/api/templates', async (req) => {
    const user = currentUser(req);
    const docs = await Template.find({ ownerId: user.id }).sort({ createdAt: -1 }).limit(200);
    return { templates: docs.map((d) => toTemplateDTO(d as never)) };
  });

  /* Bitta shablon */
  app.get<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const user = currentUser(req);
    const doc = await Template.findOne({ _id: req.params.id, ownerId: user.id });
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Shablon topilmadi' });
    return { template: toTemplateDTO(doc as never) };
  });

  /* Yaratish */
  app.post('/api/templates', async (req, reply) => {
    const user = currentUser(req);
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message });
    }
    const doc = await Template.create({ ...body.data, ownerId: user.id, status: 'ready' });
    await User.updateOne({ telegramId: user.id }, { $inc: { 'stats.templatesCount': 1 } });
    return reply.code(201).send({ template: toTemplateDTO(doc as never) });
  });

  /* Tahrirlash */
  app.patch<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const user = currentUser(req);
    const body = updateSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message });
    }
    const update: Record<string, unknown> = { ...body.data };
    if (body.data.settings) {
      delete update.settings;
      for (const [k, v] of Object.entries(body.data.settings)) update[`settings.${k}`] = v;
    }
    const doc = await Template.findOneAndUpdate(
      { _id: req.params.id, ownerId: user.id },
      { $set: update },
      { new: true },
    );
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Shablon topilmadi' });
    return { template: toTemplateDTO(doc as never) };
  });

  /* O'chirish */
  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const user = currentUser(req);
    const res = await Template.deleteOne({ _id: req.params.id, ownerId: user.id });
    if (res.deletedCount === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'Shablon topilmadi' });
    }
    await User.updateOne({ telegramId: user.id }, { $inc: { 'stats.templatesCount': -1 } });
    return { ok: true };
  });

  /* Nusxa olish */
  app.post<{ Params: { id: string } }>('/api/templates/:id/duplicate', async (req, reply) => {
    const user = currentUser(req);
    const doc = await Template.findOne({ _id: req.params.id, ownerId: user.id });
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Shablon topilmadi' });
    const copy = await Template.create({
      ownerId: user.id,
      title: `${doc.title} (nusxa)`,
      description: doc.description,
      subject: doc.subject,
      questions: doc.questions,
      settings: doc.settings,
      sourceType: doc.sourceType,
      sourceFileName: doc.sourceFileName,
      status: doc.status,
    });
    return reply.code(201).send({ template: toTemplateDTO(copy as never) });
  });

  /* PDF: mode=plain (kalitsiz) | key (kalit bilan) | teacher (javoblar belgilangan) */
  app.get<{ Params: { id: string }; Querystring: { mode?: string; shuffle?: string } }>(
    '/api/templates/:id/pdf',
    async (req, reply) => {
      const user = currentUser(req);
      const doc = await Template.findOne({ _id: req.params.id, ownerId: user.id });
      if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Shablon topilmadi' });

      const mode = req.query.mode ?? 'key';
      const pdf = await buildTestPdf(doc, {
        withAnswerKey: mode === 'key',
        markCorrectInline: mode === 'teacher',
        shuffleQuestions: req.query.shuffle === '1',
        variantLabel: req.query.shuffle === '1' ? 'Aralash variant' : undefined,
      });

      const fileName = encodeURIComponent(
        `${doc.title.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'test'}.pdf`,
      );
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`)
        .send(pdf);
    },
  );

  /* PDF ni bot orqali shaxsiy chatga yuborish (Mini App uchun eng ishonchli yo'l) */
  app.post<{ Params: { id: string }; Querystring: { mode?: string } }>(
    '/api/templates/:id/send-pdf',
    async (req, reply) => {
      const user = currentUser(req);
      const doc = await Template.findOne({ _id: req.params.id, ownerId: user.id });
      if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Shablon topilmadi' });

      const mode = req.query.mode ?? 'key';
      const pdf = await buildTestPdf(doc, {
        withAnswerKey: mode === 'key',
        markCorrectInline: mode === 'teacher',
      });
      const safe = doc.title.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'test';
      const suffix = mode === 'key' ? '-kalit' : mode === 'teacher' ? '-oqituvchi' : '';

      try {
        await getBot().bot.api.sendDocument(
          user.id,
          new InputFile(pdf, `${safe}${suffix}.pdf`),
          { caption: `\u{1F4C4} ${doc.title}` },
        );
      } catch (err) {
        logger.error('PDF yuborilmadi', err);
        return reply.code(502).send({
          error: 'send_failed',
          message: 'PDF yuborilmadi. Avval botga /start yozing.',
        });
      }
      return { ok: true };
    },
  );
}
