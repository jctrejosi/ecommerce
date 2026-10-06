/**
 * Auditoría de datos para el planificador de rutas del delivery.
 *
 * 1. ¿Existe alguna columna de PESO/masa en TODO el esquema? (information_schema)
 * 2. Cobertura de DIMENSIONES/volumen del catálogo (product_variants).
 * 3. Cobertura del snapshot de volumen en shipments + capacidades declaradas.
 * 4. Distribución de volumen de pedidos activos (para validar el cálculo).
 *
 * Solo devuelve agregados y muestras cortas.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', {
  paths: [path.join(ROOT, 'backend/node_modules')],
}));

const DB =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

function pct(n, d) {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
}

(async () => {
  const db = new Client(DB);
  await db.connect();

  console.log('\n=== 1) Columnas tipo peso/masa en todo el esquema ===');
  const weightCols = await db.query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ~* 'weight|peso|gram|_kg|kilogram|mass|net_w|gross_w')
      ORDER BY table_name, column_name`,
  );
  if (!weightCols.rows.length) {
    console.log('  (ninguna) → NO hay campo de peso en la base de datos');
  } else {
    for (const c of weightCols.rows) {
      console.log(`  ${c.table_name}.${c.column_name} (${c.data_type})`);
    }
  }

  console.log('\n=== 2) Catálogo: dimensiones (volumen) ===');
  const v = (
    await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE deleted_at IS NULL)                              AS total,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active)                AS activos,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND length_mm IS NOT NULL
                                AND width_mm IS NOT NULL AND height_mm IS NOT NULL) AS con_dims,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND length_mm IS NOT NULL
                                AND width_mm IS NOT NULL AND height_mm IS NOT NULL
                                AND (length_mm::numeric*width_mm::numeric*height_mm::numeric/1000.0)
                                    BETWEEN 1 AND 50000)                        AS dims_plausibles
       FROM product_variants`,
    )
  ).rows[0];
  console.log(
    `  variantes totales: ${v.total} (activas ${v.activos}) · con 3 dimensiones: ${v.con_dims} (${pct(v.con_dims, v.total)}) · plausibles: ${v.dims_plausibles} (${pct(v.dims_plausibles, v.total)})`,
  );

  console.log('\n=== 2b) Peso SOLO como texto en nombre/descripción ===');
  const wt = (
    await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE p.name ~* '\\m[0-9]+([.,][0-9]+)?\\s*(kg|g|gr|grs|gms|gramos|kilos)\\M'
                             OR p.description ~* '\\m[0-9]+([.,][0-9]+)?\\s*(kg|g|gr|grs|gms|gramos|kilos)\\M') AS con_peso_texto,
         COUNT(*) FILTER (WHERE p.name ~* 'peso variable' OR p.description ~* 'peso variable')  AS peso_variable
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.deleted_at IS NULL`,
    )
  ).rows[0];
  console.log(
    `  variantes con un peso parseable en el texto: ${wt.con_peso_texto} (${pct(wt.con_peso_texto, v.total)}) · con "PESO VARIABLE": ${wt.peso_variable} (${pct(wt.peso_variable, v.total)})`,
  );

  console.log('\n=== 2c) ¿Se complementan dimensiones y peso-texto? ===');
  const ov = (
    await db.query(
      `WITH x AS (
         SELECT
           (v.length_mm IS NOT NULL AND v.width_mm IS NOT NULL AND v.height_mm IS NOT NULL
             AND (v.length_mm::numeric*v.width_mm::numeric*v.height_mm::numeric/1000.0) BETWEEN 1 AND 50000) AS dims_ok,
           (p.name ~* '\\m[0-9]+([.,][0-9]+)?\\s*(kg|g|gr|grs|gms|gramos|kilos)\\M'
             OR p.description ~* '\\m[0-9]+([.,][0-9]+)?\\s*(kg|g|gr|grs|gms|gramos|kilos)\\M') AS peso_texto
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.deleted_at IS NULL
       )
       SELECT
         COUNT(*) FILTER (WHERE dims_ok AND peso_texto)     AS ambos,
         COUNT(*) FILTER (WHERE dims_ok AND NOT peso_texto) AS solo_dims,
         COUNT(*) FILTER (WHERE NOT dims_ok AND peso_texto) AS solo_peso,
         COUNT(*) FILTER (WHERE NOT dims_ok AND NOT peso_texto) AS ninguno
       FROM x`,
    )
  ).rows[0];
  console.log(
    `  ambos: ${ov.ambos} · solo dimensiones: ${ov.solo_dims} · solo peso-texto: ${ov.solo_peso} · ninguno: ${ov.ninguno}`,
  );

  console.log('\n=== 3) Snapshot de volumen y capacidades ===');
  const s = (
    await db.query(
      `SELECT
         COUNT(*)                                   AS total_shipments,
         COUNT(*) FILTER (WHERE total_volume_cm3 IS NOT NULL) AS con_volumen,
         COUNT(*) FILTER (WHERE volume_estimated)   AS estimados
       FROM shipments`,
    )
  ).rows[0];
  console.log(
    `  shipments: ${s.total_shipments} · con volumen: ${s.con_volumen} (${pct(s.con_volumen, s.total_shipments)}) · estimados: ${s.estimados}`,
  );
  const d = (
    await db.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE cargo_volume_cm3 IS NOT NULL) AS con_capacidad
         FROM delivery_drivers WHERE deleted_at IS NULL`,
    )
  ).rows[0];
  console.log(
    `  repartidores: ${d.total} · con capacidad declarada: ${d.con_capacidad} (${pct(d.con_capacidad, d.total)})`,
  );

  console.log('\n=== 4) Volumen de pedidos activos (snapshot) ===');
  const a = (
    await db.query(
      `SELECT
         COUNT(*)                                    AS pedidos_activos,
         COUNT(s.total_volume_cm3)                   AS con_volumen,
         MIN(s.total_volume_cm3)                     AS min_cm3,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY s.total_volume_cm3) AS mediana_cm3,
         MAX(s.total_volume_cm3)                     AS max_cm3,
         COUNT(*) FILTER (WHERE s.volume_estimated)  AS estimados
       FROM delivery_assignments da
       JOIN shipments s ON s.id = da.shipment_id
      WHERE da.status::text IN ('ASSIGNED','ACCEPTED','READY_FOR_PICKUP','PICKED_UP','IN_DELIVERY')`,
    )
  ).rows[0];
  console.log(
    `  asignaciones activas: ${a.pedidos_activos} · con volumen: ${a.con_volumen} · estimados: ${a.estimados}`,
  );
  console.log(
    `  volumen cm³ → min ${a.min_cm3 ?? '—'} · mediana ${a.mediana_cm3 ?? '—'} · max ${a.max_cm3 ?? '—'}`,
  );

  console.log('\n=== 5) Validación del cupo por repartidor con pedido activo ===');
  const loads = await db.query(
    `SELECT
       d.full_name,
       d.cargo_volume_cm3 AS capacidad,
       COALESCE(SUM(s.total_volume_cm3), 0) AS usado,
       COUNT(a.id) AS pedidos,
       COUNT(*) FILTER (WHERE s.volume_estimated) AS estimados
     FROM delivery_drivers d
     JOIN delivery_assignments a
       ON a.driver_id = d.id
      AND a.status::text IN ('ACCEPTED','READY_FOR_PICKUP','PICKED_UP','IN_DELIVERY')
     JOIN shipments s ON s.id = a.shipment_id
     WHERE d.deleted_at IS NULL
     GROUP BY d.id, d.full_name, d.cargo_volume_cm3
     ORDER BY d.id`,
  );
  if (!loads.rows.length) {
    console.log('  (sin repartidores con pedidos en estados que ocupan cupo)');
  }
  for (const r of loads.rows) {
    const usado = Number(r.usado);
    const cap = r.capacidad == null ? null : Number(r.capacidad);
    const fill = cap ? `${((usado / cap) * 100).toFixed(0)}%` : 's/cap';
    const over = cap != null && usado > cap ? '  ⚠️ SOBRE CAPACIDAD' : '';
    console.log(
      `  ${String(r.full_name).padEnd(20)} usado ${usado} cm³ / cap ${cap ?? '—'} (${fill}) · ${r.pedidos} pedido(s) · ${r.estimados} estimado(s)${over}`,
    );
  }

  await db.end();
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
