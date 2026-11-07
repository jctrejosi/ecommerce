import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

const POSTGIS_IMAGE = 'postgis/postgis:16-3.4';
const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'Admin123!';

/** Schema tal como lo usa la app real (scripts/install-extensions.js + PostGIS). */
const EXTENSIONS_SQL = `
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS unaccent;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS citext;
  CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $$ SELECT public.unaccent($1) $$;
`;

function runDrizzlePush(databaseUrl: string) {
  const backendRoot = path.resolve(__dirname, '..');
  const binary = path.join(backendRoot, 'node_modules', '.bin', 'drizzle-kit');

  try {
    execFileSync(binary, ['push', '--force'], {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, DB_SSL: 'false' },
      stdio: 'pipe',
      timeout: 300_000,
    });
  } catch (error: any) {
    const stdout = error?.stdout?.toString?.() ?? '';
    const stderr = error?.stderr?.toString?.() ?? '';
    throw new Error(
      `drizzle-kit push falló.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}

describe('Mercaldas backend (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('mercaldas_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    const databaseUrl = container.getConnectionUri();
    process.env.DATABASE_URL = databaseUrl;
    process.env.DB_SSL = 'false';

    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(EXTENSIONS_SQL);

    runDrizzlePush(databaseUrl);

    // Usuario mínimo para probar autenticación (el resto lo siembra la app).
    await client.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active)
       VALUES ($1, $2, $3, 'Admin', 'E2E', true, true)`,
      [ADMIN_EMAIL, 'admin', bcrypt.hashSync(ADMIN_PASSWORD, 4)],
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mismo pipe global que `src/main.ts`.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await client?.end();
    await container?.stop();
  });

  describe('GET /api-status', () => {
    it('reporta la API y la base de datos como disponibles', async () => {
      const response = await request(app.getHttpServer())
        .get('/api-status')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.services.database.status).toBe('connected');
    });
  });

  describe('POST /auth/login', () => {
    it('autentica al usuario sembrado y devuelve tokens', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({
        email: ADMIN_EMAIL,
        isSuperuser: true,
        isActive: true,
      });

      accessToken = response.body.accessToken;
    });

    it('rechaza credenciales inválidas', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: ADMIN_EMAIL, password: 'incorrecta' })
        .expect(401);
    });

    it('valida el cuerpo de entrada', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: 'x' })
        .expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('devuelve el perfil con un bearer token válido', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ email: ADMIN_EMAIL });
    });

    it('rechaza la petición sin token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });
  });

  describe('catálogo público', () => {
    it('lista categorías', async () => {
      const response = await request(app.getHttpServer())
        .get('/catalog/categories')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('consulta productos con filtros vacíos', async () => {
      const response = await request(app.getHttpServer())
        .post('/catalog/products')
        .send({ limit: 5 })
        .expect(201);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /banners', () => {
    it('devuelve la lista pública de banners', async () => {
      const response = await request(app.getHttpServer())
        .get('/banners')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('rutas admin', () => {
    it('devuelve 401 sin token en una ruta protegida', async () => {
      await request(app.getHttpServer()).get('/admin/banners').expect(401);
    });
  });
});
