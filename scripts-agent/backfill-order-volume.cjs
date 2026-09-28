/**
 * Backfill del volumen de carga de los pedidos existentes.
 *
 * Calcula, para cada pedido con envío, el volumen a partir de
 * `order_items` × dimensiones de `product_variants` y lo guarda en
 * `shipments.total_volume_cm3` / `shipments.volume_estimated`.
 *
 * Las variantes sin las 3 dimensiones usan el volumen de respaldo
 * (`DEFAULT_ITEM_VOLUME_CM3`, por defecto 1.000 cm³) y marcan el pedido como
 * estimado. Replica la lógica de `DeliveryLoadService.computeOrderLoad`.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/backfill-order-volume.cjs [--dry-run]
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const FALLBACK = Number(process.env.DEFAULT_ITEM_VOLUME_CM3) || 1000;
// Medidas fuera de este rango se consideran corruptas → volumen de respaldo.
const MIN_ITEM = Number(process.env.MIN_ITEM_VOLUME_CM3) || 1;
const MAX_ITEM = Number(process.env.MAX_ITEM_VOLUME_CM3) || 50_000;
const DRY_RUN = process.argv.includes('--dry-run');

const LOAD_SQL = `
  WITH items AS (
    SELECT
      oi.quantity,
      CASE
        WHEN v.length_mm IS NULL OR v.width_mm IS NULL OR v.height_mm IS NULL
          THEN NULL
        ELSE v.length_mm::numeric * v.width_mm::numeric * v.height_mm::numeric / 1000.0
      END AS unit_cm3
    FROM order_items oi
    LEFT JOIN product_variants v ON v.id = oi.product_variant_id
    WHERE oi.order_id = $1
  )
  SELECT
    COALESCE(SUM(unit_cm3 * quantity)
             FILTER (WHERE unit_cm3 BETWEEN $2 AND $3), 0) AS volume_cm3,
    COUNT(*) FILTER (
      WHERE unit_cm3 IS NULL OR unit_cm3 NOT BETWEEN $2 AND $3
    )                                                    AS items_missing_dims,
    COUNT(*) FILTER (
      WHERE unit_cm3 IS NOT NULL AND unit_cm3 NOT BETWEEN $2 AND $3
    )                                                    AS items_out_of_range,
    COALESCE(SUM(quantity), 0)                           AS units,
    COALESCE(SUM(quantity) FILTER (
      WHERE unit_cm3 IS NULL OR unit_cm3 NOT BETWEEN $2 AND $3
    ), 0)                                                AS units_missing_dims
  FROM items
`;

function toLoad(row) {
  const known = Math.round(Number(row?.volume_cm3 ?? 0));
  const itemsMissingDims = Number(row?.items_missing_dims ?? 0);
  const unitsMissingDims = Number(row?.units_missing_dims ?? 0);
  return {
    volumeCm3: known + unitsMissingDims * FALLBACK,
    estimated: itemsMissingDims > 0,
    itemsMissingDims,
    itemsOutOfRange: Number(row?.items_out_of_range ?? 0),
    units: Number(row?.units ?? 0),
  };
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    console.log(
      `Backfill de volumen · respaldo=${FALLBACK} cm³ · rango unitario ${MIN_ITEM}–${MAX_ITEM} cm³ · ${
        DRY_RUN ? 'DRY RUN' : 'aplicando'
      }`,
    );

    const { rows: shipments } = await db.query(
      `SELECT s.id AS shipment_id, s.order_id, o.reference_code, o.status
         FROM shipments s
         JOIN orders o ON o.id = s.order_id
        ORDER BY s.id`,
    );

    let updated = 0;
    let estimated = 0;
    let empty = 0;
    let totalCm3 = 0;
    let missingItemLines = 0;
    let outOfRangeLines = 0;

    for (const s of shipments) {
      const { rows } = await db.query(LOAD_SQL, [s.order_id, MIN_ITEM, MAX_ITEM]);
      const load = toLoad(rows[0]);
      totalCm3 += load.volumeCm3;
      if (load.estimated) estimated++;
      if (load.volumeCm3 === 0) empty++;
      missingItemLines += load.itemsMissingDims;
      outOfRangeLines += load.itemsOutOfRange;

      if (!DRY_RUN && load.volumeCm3 > 0) {
        await db.query(
          `UPDATE shipments
              SET total_volume_cm3 = $2, volume_estimated = $3, updated_at = now()
            WHERE id = $1`,
          [s.shipment_id, load.volumeCm3, load.estimated],
        );
        updated++;
      }
    }

    // Cobertura del catálogo (contexto de cuánto es dato real y cuánto respaldo).
    const { rows: cov } = await db.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (
                WHERE width_mm IS NOT NULL AND height_mm IS NOT NULL AND length_mm IS NOT NULL
              ) AS completas,
              COUNT(*) FILTER (
                WHERE width_mm IS NOT NULL AND height_mm IS NOT NULL AND length_mm IS NOT NULL
                  AND (length_mm::numeric * width_mm::numeric * height_mm::numeric / 1000.0)
                      NOT BETWEEN $1 AND $2
              ) AS fuera_de_rango
         FROM product_variants`,
      [MIN_ITEM, MAX_ITEM],
    );
    const covRow = cov[0];
    const pct = ((Number(covRow.completas) / Number(covRow.total)) * 100).toFixed(1);

    console.log(`envíos procesados:        ${shipments.length}`);
    console.log(`actualizados:             ${DRY_RUN ? 0 : updated}`);
    console.log(`sin volumen (0 ítems):    ${empty}`);
    console.log(`con volumen estimado:     ${estimated}`);
    console.log(`líneas sin dimensiones:   ${missingItemLines}`);
    console.log(`líneas con medidas locas: ${outOfRangeLines}`);
    console.log(
      `volumen total:            ${totalCm3} cm³ (${(totalCm3 / 1000).toFixed(0)} L)`,
    );
    console.log(
      `catálogo con 3 dims:      ${covRow.completas}/${covRow.total} (${pct}%) · ${covRow.fuera_de_rango} fuera de rango`,
    );

    // Productos con medidas imposibles: hay que corregirlos en el catálogo.
    const { rows: sospechosos } = await db.query(
      `SELECT p.name,
              v.length_mm, v.width_mm, v.height_mm,
              round(v.length_mm::numeric * v.width_mm::numeric * v.height_mm::numeric / 1000.0) AS unit_cm3
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.length_mm IS NOT NULL AND v.width_mm IS NOT NULL AND v.height_mm IS NOT NULL
          AND (v.length_mm::numeric * v.width_mm::numeric * v.height_mm::numeric / 1000.0)
              NOT BETWEEN $1 AND $2
        ORDER BY unit_cm3 DESC
        LIMIT 8`,
      [MIN_ITEM, MAX_ITEM],
    );
    if (sospechosos.length) {
      console.log('\nProductos con medidas fuera de rango (corregir en el catálogo):');
      for (const s of sospechosos) {
        console.log(
          `  ${s.unit_cm3} cm³ · ${s.length_mm}×${s.width_mm}×${s.height_mm} mm · ${s.name}`,
        );
      }
    }

    if (DRY_RUN) console.log('\n(dry run: no se escribió nada)');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
