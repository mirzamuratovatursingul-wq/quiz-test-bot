import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { draftRoutes } from './routes/drafts.js';
import { profileRoutes, raceRoutes } from './routes/races.js';
import { templateRoutes } from './routes/templates.js';

export async function buildApi(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Init-Data'],
  });

  await app.register(multipart, {
    limits: { fileSize: config.MAX_FILE_MB * 1024 * 1024, files: 1 },
  });

  app.get('/api/health', async () => ({
    ok: true,
    env: config.NODE_ENV,
    time: new Date().toISOString(),
    // Ishlab chiqishda: bot hozir qaysi Mini App manzilini ishlatayotganini tekshirish uchun
    ...(config.isProd ? {} : { webappUrl: config.WEBAPP_URL, bot: config.BOT_USERNAME ?? null }),
  }));

  await app.register(templateRoutes);
  await app.register(draftRoutes);
  await app.register(raceRoutes);
  await app.register(profileRoutes);

  /* Mini App statik fayllari (bitta deploy: back + front) */
  if (config.SERVE_WEB && fs.existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, { root: config.webDistDir, prefix: '/' });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'not_found', message: 'Bunday endpoint yoʻq' });
      }
      return reply.sendFile('index.html');
    });
    logger.info(`Mini App statik fayllari: ${config.webDistDir}`);
  } else {
    app.setNotFoundHandler(async (req, reply) =>
      reply.code(404).send({ error: 'not_found', message: 'Topilmadi' }),
    );
    if (config.SERVE_WEB) {
      logger.warn(
        'Web build topilmadi (packages/web/dist). Dev rejimida Vite alohida ishlaydi — bu normal.',
      );
    }
  }

  app.setErrorHandler((err: FastifyError, req, reply) => {
    logger.error(`API xatosi ${req.method} ${req.url}`, err);
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    void reply.code(status).send({
      error: status === 500 ? 'server_error' : 'request_error',
      message: status === 500 ? 'Serverda xatolik yuz berdi' : err.message,
    });
  });

  return app;
}

export async function startApi(): Promise<FastifyInstance> {
  const app = await buildApi();
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logger.error(
        `${config.PORT}-port band. Boshqa "npm run dev" oynasi ochiq boʻlishi mumkin — ` +
          `uni yoping yoki .env dagi PORT ni oʻzgartiring.`,
      );
      process.exit(1);
    }
    throw err;
  }
  logger.info(`API tinglamoqda: http://${config.HOST}:${config.PORT}`);
  return app;
}
