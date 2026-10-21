import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Container } from '@esp/core';
import { REDACT_PATHS } from '@esp/core';
import { registerErrorHandling } from './plugins/errors.js';
import { registerAuth } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { aclRoutes } from './routes/acl.js';
import { realtimeRoutes } from './routes/realtime.js';
import { competitionRoutes } from './routes/competition.js';
import { opsRoutes } from './routes/ops.js';
import { fileRoutes } from './routes/files.js';
import { identityRoutes } from './routes/identity.js';
import { profileRoutes } from './routes/profiles.js';
import { socialRoutes } from './routes/social.js';
import { teamsRoutes } from './routes/teams.js';
import { recruitmentRoutes } from './routes/recruitment.js';
import { organizerRoutes } from './routes/organizer.js';
import { catalogRoutes } from './routes/catalog.js';
import { rulesRoutes } from './routes/rules.js';
import { eventsAdminRoutes } from './routes/events-admin.js';
import { registrationRoutes } from './routes/registrations.js';
import { financeRoutes } from './routes/finance.js';
import { operationsRoutes } from './routes/operations.js';
import { integrityRoutes } from './routes/integrity.js';
import { liveRoutes } from './routes/live.js';
import { adminRoutes } from './routes/admin.js';
import { partnerRoutes } from './routes/partner.js';
import { registerAdmissionControl } from './plugins/microcache.js';
import { registerMetrics } from './plugins/metrics.js';

export const API_VERSION = '0.7.0-esp07';

export async function buildApp(container: Container): Promise<FastifyInstance> {
  const { config } = container;
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: config.isProduction, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, { origin: [config.PUBLIC_WEB_ORIGIN], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Approval-Id', 'Authorization', 'Last-Event-ID'] });
  await app.register(cookie, { secret: config.appSecret });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW_MS, allowList: config.isProduction ? [] : ['127.0.0.1', '::1'] });
  await app.register(multipart, { limits: { fileSize: config.UPLOAD_MAX_BYTES_PRIVATE, files: 1 } });
  await app.register(websocket);
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Esports Platform API', version: API_VERSION, description: 'Contract for the Iranian esports platform (ESP-SRS). Errors use the uniform envelope { error: { code, message, requestId, details? } }.' },
      servers: [{ url: `${config.PUBLIC_API_ORIGIN}/api/v1` }],
      components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'esp_session' }, bearerAuth: { type: 'http', scheme: 'bearer' } } },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  if (!config.isProduction) await app.register(swaggerUi, { routePrefix: '/docs' });

  registerAdmissionControl(app, config.MAX_INFLIGHT);
  registerErrorHandling(app);
  registerAuth(app, container);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('X-Frame-Options', 'DENY');
  });

  await app.register(
    async (api) => {
      healthRoutes(api, container, API_VERSION);
      authRoutes(api, container);
      aclRoutes(api, container);
      realtimeRoutes(api, container);
      competitionRoutes(api, container);
      opsRoutes(api, container);
      fileRoutes(api, container);
      identityRoutes(api, container);
      profileRoutes(api, container);
      socialRoutes(api, container);
      teamsRoutes(api, container);
      recruitmentRoutes(api, container);
      organizerRoutes(api, container);
      catalogRoutes(api, container);
      rulesRoutes(api, container);
      eventsAdminRoutes(api, container);
      registrationRoutes(api, container);
      financeRoutes(api, container);
      operationsRoutes(api, container);
      integrityRoutes(api, container);
      liveRoutes(api, container);
      adminRoutes(api, container);
    },
    { prefix: '/api/v1' },
  );

  registerMetrics(app, container);
  await app.register(async (p) => partnerRoutes(p, container), { prefix: '/partner/v1' });

  return app;
}
