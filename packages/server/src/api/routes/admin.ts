import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isAdmin } from '../../config.js';
import { getOverview, groupDetail, listGroups, listUsers, userDetail } from '../../services/admin.service.js';
import { currentUser, requireAuth } from '../auth.js';

/** Faqat .env dagi ADMIN_IDS ro'yxatidagilar */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!isAdmin(currentUser(req).id)) {
    await reply.code(403).send({ error: 'forbidden', message: 'Bu boʻlim faqat bot adminlari uchun.' });
  }
}

const pageOf = (raw: string | undefined) => Math.min(Math.max(Number.parseInt(raw ?? '0', 10) || 0, 0), 500);

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get<{ Querystring: { fresh?: string } }>('/api/admin/overview', async (req) => ({
    overview: await getOverview(req.query.fresh === '1'),
  }));

  app.get<{ Querystring: { q?: string; page?: string } }>('/api/admin/users', async (req) =>
    listUsers(req.query.q ?? '', pageOf(req.query.page)),
  );

  app.get<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    const detail = await userDetail(Number(req.params.id));
    if (!detail) return reply.code(404).send({ error: 'not_found', message: 'Foydalanuvchi topilmadi' });
    return detail;
  });

  app.get<{ Querystring: { q?: string; page?: string } }>('/api/admin/groups', async (req) =>
    listGroups(req.query.q ?? '', pageOf(req.query.page)),
  );

  app.get<{ Params: { chatId: string } }>('/api/admin/groups/:chatId', async (req, reply) => {
    const detail = await groupDetail(Number(req.params.chatId));
    if (!detail) return reply.code(404).send({ error: 'not_found', message: 'Guruh topilmadi' });
    return detail;
  });
}
