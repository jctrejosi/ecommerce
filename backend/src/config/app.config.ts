import { registerAs } from '@nestjs/config';
import { AppConfig } from './types';

export default registerAs('app', (): AppConfig => {
  // BACKEND_PORT es el puerto interno DEDICADO (lo fija docker-entrypoint.sh
  // a 3100). NUNCA se debe leer PORT aquí en producción: Render inyecta PORT
  // (10000 por defecto) para el proxy público (Caddy), y leerlo causaría
  // EADDRINUSE. En local (sin BACKEND_PORT) se usa PORT=3000 del .env.
  const port = parseInt(
    process.env.BACKEND_PORT ?? process.env.PORT ?? '3000',
    10,
  );
  return {
    port,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
});
