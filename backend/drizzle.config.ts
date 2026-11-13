import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema.ts',
  out: './drizzle/migrate',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    // Proveedores gestionados (Supabase, Neon, Render) exigen SSL.
    // DB_SSL=true activa TLS sin verificación de cadena (certificados propios).
    ...(process.env.DB_SSL === 'true'
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  },
  tablesFilter: ['!spatial_ref_sys', '!geography_columns', '!geometry_columns'],
  // Solo el schema `public`: `tiger` y `topology` son de PostGIS y no forman
  // parte del modelo Drizzle. La clave es `schemaFilter` (singular); sin esto
  // `drizzle-kit push`/`generate` tratan los schemas de PostGIS como un
  // conflicto de schemas/tablas y exigen TTY.
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
});
