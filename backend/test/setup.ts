/**
 * Variables de entorno mínimas para que `ConfigModule` pueda instanciarse en
 * las pruebas sin depender de `.env.development.local` ni de servicios
 * externos. Las pruebas E2E sobrescriben `DATABASE_URL` cuando el contenedor
 * de PostgreSQL está listo.
 */
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_EXPIRES_IN ??= '7d';
process.env.REFRESH_TOKEN_EXPIRES_IN ??= '30d';
process.env.DB_SSL ??= 'false';
process.env.MEDIA_STORAGE ??= 'local';
