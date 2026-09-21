import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  applyAnswerKeyText,
  applyFirstIsCorrect,
  parseTestText,
  type DraftDTO,
  type Question,
} from '@testrace/shared';
import { Draft, Template, User } from '../../db/models.js';
import { ExtractError, extractText } from '../../services/extract.service.js';
import { currentUser, requireAuth } from '../auth.js';
import { toTemplateDTO } from './templates.js';
import { logger } from '../../logger.js';
import { config } from '../../config.js';

const questionSchema = z.object({
  text: z.string().min(1).max(2000),
  options: z.array(z.object({ text: z.string().min(1).max(500) })).min(1).max(8),
  correctIndex: z.number().int().min(-1).max(7),
  explanation: z.string().max(1000).optional(),
});

function toDraftDTO(doc: {
  _id: unknown;
  ownerId: number;
  title: string;
  questions: unknown;
  warnings: unknown;
  strategy: string;
  sourceType: string;
  sourceFileName?: string | null;
  createdAt?: Date;
}): DraftDTO {
  return {
    id: String(doc._id),
    ownerId: doc.ownerId,
    title: doc.title,
    questions: doc.questions as Question[],
    warnings: doc.warnings as DraftDTO['warnings'],
    strategy: doc.strategy as DraftDTO['strategy'],
    sourceType: doc.sourceType as DraftDTO['sourceType'],
    sourceFileName: doc.sourceFileName ?? '',
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
  };
}

export async function draftRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /* Ro'yxat */
  app.get('/api/drafts', async (req) => {
    const user = currentUser(req);
    const docs = await Draft.find({ ownerId: user.id }).sort({ createdAt: -1 }).limit(50);
    return { drafts: docs.map((d) => toDraftDTO(d as never)) };
  });

  app.get<{ Params: { id: string } }>('/api/drafts/:id', async (req, reply) => {
    const user = currentUser(req);
    const doc = await Draft.findOne({ _id: req.params.id, ownerId: user.id });
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Qoralama topilmadi' });
    return { draft: toDraftDTO(doc as never) };
  });

  /* Matnni tahlil qilish (Mini App: nusxa-joylashtirish) */
  app.post('/api/parse', async (req, reply) => {
    const user = currentUser(req);
    const body = z
      .object({ text: z.string().min(10).max(500_000), title: z.string().max(120).optional() })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'Matn juda qisqa yoki katta' });
    }

    const result = parseTestText(body.data.text);
    if (result.questions.length === 0) {
      return reply.code(422).send({
        error: 'no_questions',
        message: 'Savollar topilmadi. Format: "1. Savol" + "+A) Javob"',
        warnings: result.warnings,
      });
    }

    const draft = await Draft.create({
      ownerId: user.id,
      title: body.data.title?.trim() || `Test ${new Date().toLocaleDateString('uz-UZ')}`,
      questions: result.questions,
      warnings: result.warnings,
      strategy: result.strategy,
      sourceType: 'text',
      rawText: body.data.text.slice(0, 200_000),
    });

    return reply.code(201).send({ draft: toDraftDTO(draft as never), stats: result.stats });
  });

  /* Fayl yuklash (Mini App) */
  app.post('/api/upload', async (req, reply) => {
    const user = currentUser(req);
    const file = await req.file({ limits: { fileSize: config.MAX_FILE_MB * 1024 * 1024 } });
    if (!file) {
      return reply.code(400).send({ error: 'bad_request', message: 'Fayl yuborilmadi' });
    }

    try {
      const buffer = await file.toBuffer();
      const extracted = await extractText(buffer, file.filename, file.mimetype);
      const result = parseTestText(extracted.text);

      if (result.questions.length === 0) {
        return reply.code(422).send({
          error: 'no_questions',
          message: 'Fayldan savollar topilmadi.',
          warnings: result.warnings,
        });
      }

      const draft = await Draft.create({
        ownerId: user.id,
        title: file.filename.replace(/\.[^.]+$/, '').slice(0, 80) || 'Nomsiz test',
        questions: result.questions,
        warnings: result.warnings,
        strategy: result.strategy,
        sourceType: extracted.sourceType,
        sourceFileName: file.filename,
        rawText: extracted.text.slice(0, 200_000),
      });

      return reply.code(201).send({ draft: toDraftDTO(draft as never), stats: result.stats });
    } catch (err) {
      if (err instanceof ExtractError) {
        return reply.code(422).send({ error: 'extract_failed', message: err.message });
      }
      logger.error('Yuklangan faylni qayta ishlashda xato', err);
      return reply.code(500).send({ error: 'server_error', message: 'Faylni oʻqib boʻlmadi' });
    }
  });

  /* Qoralamani tahrirlash */
  app.patch<{ Params: { id: string } }>('/api/drafts/:id', async (req, reply) => {
    const user = currentUser(req);
    const body = z
      .object({
        title: z.string().min(2).max(120).optional(),
        questions: z.array(questionSchema).optional(),
        /** "1-A, 2-B" ko'rinishidagi kalitni qo'llash */
        answerKeyText: z.string().max(5000).optional(),
        /** birinchi variantni to'g'ri deb belgilash */
        firstIsCorrect: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message });
    }

    const doc = await Draft.findOne({ _id: req.params.id, ownerId: user.id });
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Qoralama topilmadi' });

    if (body.data.title) doc.title = body.data.title;
    if (body.data.questions) doc.set('questions', body.data.questions);

    let questions = doc.questions as unknown as Question[];
    if (body.data.firstIsCorrect) questions = applyFirstIsCorrect(questions);
    if (body.data.answerKeyText) questions = applyAnswerKeyText(questions, body.data.answerKeyText);
    if (body.data.firstIsCorrect || body.data.answerKeyText) doc.set('questions', questions);

    await doc.save();
    return { draft: toDraftDTO(doc as never) };
  });

  /* Tasdiqlash -> shablon */
  app.post<{ Params: { id: string } }>('/api/drafts/:id/confirm', async (req, reply) => {
    const user = currentUser(req);
    const body = z
      .object({
        title: z.string().min(2).max(120).optional(),
        subject: z.string().max(100).optional(),
        description: z.string().max(500).optional(),
        settings: z
          .object({
            timePerQuestion: z.number().int().min(5).max(120).optional(),
            shuffleQuestions: z.boolean().optional(),
            shuffleOptions: z.boolean().optional(),
            questionLimit: z.number().int().min(0).max(500).optional(),
            speedBonus: z.boolean().optional(),
          })
          .optional(),
        /** javobi aniqlanmagan savollarni tashlab ketish */
        skipIncomplete: z.boolean().default(true),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message });
    }

    const doc = await Draft.findOne({ _id: req.params.id, ownerId: user.id });
    if (!doc) return reply.code(404).send({ error: 'not_found', message: 'Qoralama topilmadi' });

    const all = doc.questions as unknown as Question[];
    const ready = all.filter((q) => q.correctIndex >= 0 && q.options.length >= 2);
    const incomplete = all.length - ready.length;

    if (!body.data.skipIncomplete && incomplete > 0) {
      return reply.code(422).send({
        error: 'incomplete',
        message: `${incomplete} ta savolning toʻgʻri javobi belgilanmagan.`,
      });
    }
    if (ready.length === 0) {
      return reply.code(422).send({
        error: 'empty',
        message: 'Tasdiqlash uchun kamida bitta toʻliq savol kerak.',
      });
    }

    const template = await Template.create({
      ownerId: user.id,
      title: body.data.title ?? doc.title,
      subject: body.data.subject ?? '',
      description: body.data.description ?? '',
      questions: ready,
      settings: body.data.settings ?? undefined,
      sourceType: doc.sourceType,
      sourceFileName: doc.sourceFileName,
      status: 'ready',
    });
    await User.updateOne({ telegramId: user.id }, { $inc: { 'stats.templatesCount': 1 } });
    await Draft.deleteOne({ _id: doc._id });

    return reply.code(201).send({
      template: toTemplateDTO(template as never),
      skipped: incomplete,
    });
  });

  app.delete<{ Params: { id: string } }>('/api/drafts/:id', async (req, reply) => {
    const user = currentUser(req);
    const res = await Draft.deleteOne({ _id: req.params.id, ownerId: user.id });
    if (res.deletedCount === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'Qoralama topilmadi' });
    }
    return { ok: true };
  });
}
