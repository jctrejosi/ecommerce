/**
 * Ruta de alistamiento: heurística del vecino más cercano sobre las estanterías
 * del pedido. No hay punto de inicio fijo: se parte de la primera estantería y
 * se va a la más cercana sin visitar, lo que minimiza el recorrido total.
 */

export interface ShelfPoint {
  shelfId: number;
  x: number;
  y: number;
}

/** Parámetros de estimación de tiempo (constantes razonables para la bodega). */
export const PICK_SECONDS_PER_ITEM = 30; // manipular/unidad
export const PICK_SECONDS_PER_CELL = 5; // caminar una celda de la rejilla

/** Distancia Manhattan entre dos estanterías. */
export function manhattan(a: ShelfPoint, b: ShelfPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Ordena las estanterías con vecino más cercano: parte de la primera y visita
 * siempre la más cercana entre las que faltan.
 */
export function nearestNeighborShelfOrder(shelves: ShelfPoint[]): ShelfPoint[] {
  const remaining = [...shelves];
  const ordered: ShelfPoint[] = [];
  let current: ShelfPoint | null = null;

  while (remaining.length > 0) {
    let idx = 0;
    if (current) {
      let best = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = manhattan(current, remaining[i]);
        if (d < best) {
          best = d;
          idx = i;
        }
      }
    }
    current = remaining.splice(idx, 1)[0];
    ordered.push(current);
  }

  return ordered;
}

/** Distancia total (en celdas) de un recorrido ya ordenado. */
export function routeDistance(shelves: ShelfPoint[]): number {
  let total = 0;
  for (let i = 1; i < shelves.length; i++) {
    total += manhattan(shelves[i - 1], shelves[i]);
  }
  return total;
}

/** Estimación en segundos de alistar un pedido (unidades + desplazamiento). */
export function estimatePickSeconds(items: number, cells: number): number {
  return items * PICK_SECONDS_PER_ITEM + cells * PICK_SECONDS_PER_CELL;
}

/**
 * ETA en segundos de una lista de estanterías y un número de unidades restantes.
 * Ordena con vecino más cercano y suma desplazamiento + manipulación.
 */
export function estimateEtaSeconds(
  remainingPieces: number,
  shelfPoints: ShelfPoint[],
): number {
  const ordered = nearestNeighborShelfOrder([...shelfPoints]);
  return estimatePickSeconds(remainingPieces, routeDistance(ordered));
}
