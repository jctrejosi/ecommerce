/* eslint-disable @typescript-eslint/no-unsafe-call */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { httpLoggerMiddleware } from './utils/logger';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import {
  createRateLimitMiddleware,
  DEFAULT_RATE_LIMIT_RULES,
  isRateLimitEnabled,
} from './common/middleware/rate-limit.middleware';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { CorsConfig, HelmetConfig } from './config';
import { StatusGateway } from './modules/status/status.gateway';
import { NestExpressApplication } from '@nestjs/platform-express';
import { isLanOrigin } from './utils/origins';
import { MediaUrlInterceptor } from './common/interceptors/media-url.interceptor';
import { createBotProxyMiddleware } from './common/middleware/bot-proxy.middleware';
import { resolveMediaStaticRoot } from './utils/media-static';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Detrás de un proxy (Caddy) hay que confiar en X-Forwarded-For para que
  // `req.ip` sea la IP real del cliente; sin esto, el rate limit sería un único
  // cubo compartido por todos. En el contenedor se define TRUST_PROXY=loopback.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy && trustProxy !== 'false' && trustProxy !== '0') {
    // `set` es de Express (NestExpressApplication), no de INestApplication.
    (app as NestExpressApplication).set(
      'trust proxy',
      trustProxy === 'true' ? true : trustProxy,
    );
  }

  // ✅ 1. CORS PRIMERO (antes que cualquier otro middleware)
  const corsOptions = configService.get<CorsConfig>('cors');

  app.enableCors({
    // Con `allowLan` el origen se resuelve por petición (para poder aceptar la
    // IP del equipo en la red local); sin él se usa la lista configurada.
    origin: corsOptions?.allowLan
      ? (origin, cb) => {
          if (!origin) return cb(null, true);
          const configured = corsOptions?.origin;
          const listed = Array.isArray(configured)
            ? configured.includes(origin)
            : configured === true || configured === origin;
          return cb(null, listed || isLanOrigin(origin));
        }
      : corsOptions?.origin,
    credentials: corsOptions?.credentials ?? true,
    methods: corsOptions?.methods ?? [
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'OPTIONS',
    ],
    allowedHeaders: corsOptions?.allowedHeaders ?? [
      'Content-Type',
      'Authorization',
      'Accept',
    ],
    exposedHeaders: corsOptions?.exposedHeaders ?? [],
    maxAge: corsOptions?.maxAge ?? 86400,
    preflightContinue: corsOptions?.preflightContinue ?? false,
    optionsSuccessStatus: corsOptions?.optionsSuccessStatus ?? 204,
  });

  // ✅ 2. Helmet (después de CORS)
  const helmetConfig = configService.get<HelmetConfig>('helmet');

  app.use(
    helmet({
      crossOriginResourcePolicy: helmetConfig?.crossOriginResourcePolicy ?? {
        policy: 'cross-origin',
      },
      crossOriginOpenerPolicy: helmetConfig?.crossOriginOpenerPolicy ?? {
        policy: 'unsafe-none',
      },
      crossOriginEmbedderPolicy:
        helmetConfig?.crossOriginEmbedderPolicy ?? false,
    }),
  );

  // ✅ 3. Correlation ID
  app.use(
    new CorrelationIdMiddleware().use.bind(new CorrelationIdMiddleware()),
  );

  // ✅ 4. Body parsers y otros middlewares
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(compression());
  app.use(httpLoggerMiddleware());
  app.use(cookieParser());

  // ✅ Proxy interno del bot (`/bot/*` → 127.0.0.1:8001). El bot ya no se
  // publica en Caddy: solo es alcanzable a través del backend, que reenvía
  // por loopback dentro del contenedor. Debe ir después de los body parsers
  // para poder reenviar el JSON tal cual.
  app.use('/bot', createBotProxyMiddleware());

  // ✅ 6. Rate limit (endpoints de autenticación). Opt-in por env para no
  // afectar entornos que no están detrás de proxy.
  if (isRateLimitEnabled()) {
    app.use(createRateLimitMiddleware(DEFAULT_RATE_LIMIT_RULES));
    console.log('🛡️  Rate limit activo en:', DEFAULT_RATE_LIMIT_RULES.map((r) => r.name).join(', '));
  }

  // ✅ 5. Estáticos locales: imágenes de productos (`db/images_products`) y
  // media subida desde disco (`db/images_static`). Las rutas que guarda la BD
  // son relativas (`/static/...`); el interceptor las vuelve absolutas para
  // cada cliente, así funciona igual en local, LAN y móviles.
  const staticRoot = resolveMediaStaticRoot();
  app.use(
    '/static/products',
    express.static(path.join(staticRoot, 'images_products'), {
      index: false,
      maxAge: '7d',
    }),
  );
  app.use(
    '/static/media',
    express.static(path.join(staticRoot, 'images_static'), {
      index: false,
      maxAge: '7d',
    }),
  );
  app.useGlobalInterceptors(new MediaUrlInterceptor());

  // ✅ 6. Swagger (solo en desarrollo)
  if (configService.get('app.nodeEnv') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('HelpDesk API')
      .setDescription('API para el sistema de control de asistencia')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('app.port', 3000);
  await app.listen(port);

  // Aviso explícito al web client/admin: el backend quedó disponible.
  // (Aunque socket.io re-conecta solo, esto cubre a clientes ya conectados
  //  cuando se restaura la BD o se reinicia el servicio.)
  try {
    app.get(StatusGateway).notifyBackendOnline();
  } catch (error) {
    console.warn('⚠️ No se pudo emitir backend:online:', error);
  }

  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
  console.log(
    `✅ CORS configurado con: ${JSON.stringify(corsOptions?.origin)}`,
  );
  console.log('🔍 Variables de entorno cargadas:');
  console.log('CORS_ORIGIN:', process.env.CORS_ORIGIN);
  console.log('NODE_ENV:', process.env.NODE_ENV);
}

bootstrap();
