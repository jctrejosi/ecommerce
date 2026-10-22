import { sql, type SQL } from 'drizzle-orm';
import { productVariants } from '../../../drizzle/schema';

/**
 * Referencia a una sucursal: id numérico, expresión SQL (p. ej. `${branches.id}`)
 * o nulo para usar el precio primario de la variante.
 */
export type BranchRef = number | SQL | null | undefined;

/**
 * Precio de venta vigente de la variante en la sucursal indicada.
 *
 * El ERP (TIDSAL) guarda un precio por (INSUC, INARTIC); aquí viven en
 * `prices(product_variant_id, branch_id)`. Si la sucursal no tiene precio
 * propio, se usa `product_variants.current_price` (precio primario, que
 * corresponde a la sucursal de código más bajo).
 */
export function branchPriceSql(branchRef: BranchRef) {
  if (branchRef == null) return sql<string>`${productVariants.currentPrice}`;
  return sql<string>`COALESCE(
    (SELECT pr.price FROM prices pr
      WHERE pr.product_variant_id = ${productVariants.id}
        AND pr.branch_id = ${branchRef}
        AND pr.end_date IS NULL
      ORDER BY pr.start_date DESC
      LIMIT 1),
    ${productVariants.currentPrice})`;
}

/** Igual que `branchPriceSql`, para el precio comparativo ("antes"). */
export function branchComparePriceSql(branchRef: BranchRef) {
  if (branchRef == null) {
    return sql<string | null>`${productVariants.currentComparePrice}`;
  }
  return sql<string | null>`COALESCE(
    (SELECT pr.compare_price FROM prices pr
      WHERE pr.product_variant_id = ${productVariants.id}
        AND pr.branch_id = ${branchRef}
        AND pr.end_date IS NULL
      ORDER BY pr.start_date DESC
      LIMIT 1),
    ${productVariants.currentComparePrice})`;
}
