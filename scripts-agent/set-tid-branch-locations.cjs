/**
 * Asigna coordenadas provisionales (Manizales) a las sucursales TID que hoy
 * tienen `location = '0,0'` (placeholder "PENDIENTE (dato ficticio)").
 *
 * Sin coordenadas, el endpoint de ruta a tienda responde 422 y el mapa de flota
 * no puede dibujar la ruta del repartidor hacia la sucursal (p. ej. un pedido
 * en estado ACCEPTED). Reemplazar por las coordenadas reales cuando existan.
 *
 * Solo toca filas cuyo `location` sea '0,0' o NULL (idempotente).
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', {
  paths: [path.join(ROOT, 'backend/node_modules')],
}));

const DB =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

// branch id → [lng, lat] (puntos dentro del grafo de Manizales).
const PROVISIONAL = {
  9: [-75.4946, 5.0504], // TID Sucursal 1  (zona Palogrande)
  10: [-75.5172, 5.0658], // TID Sucursal 2  (Centro)
  11: [-75.5197, 5.0646], // TID Sucursal 11 (Milán)
};

(async () => {
  const db = new Client(DB);
  await db.connect();

  for (const [id, [lng, lat]] of Object.entries(PROVISIONAL)) {
    const { rowCount } = await db.query(
      `UPDATE branches
          SET location = $2, updated_at = now()
        WHERE id = $1
          AND (location IS NULL OR location = '0,0' OR location = '')`,
      [id, `POINT(${lng} ${lat})`],
    );
    console.log(
      rowCount
        ? `  sucursal #${id} → POINT(${lng} ${lat})`
        : `  sucursal #${id} ya tenía coordenadas (sin cambios)`,
    );
  }

  const rows = await db.query(
    `SELECT id, name, location FROM branches WHERE id IN (9,10,11) ORDER BY id`,
  );
  console.log('\nEstado:');
  for (const r of rows.rows) console.log(`  #${r.id} ${r.name} → ${r.location}`);

  await db.end();
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
