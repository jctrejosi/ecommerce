import { vi } from 'vitest';

/**
 * Mock mínimo de la API de consulta de Drizzle (`db.select/update/insert/
 * delete/transaction`) para probar lógica de servicios sin base de datos.
 *
 * Las consultas se resuelven en el orden en que se construyen, consumiendo
 * una cola por operación. Así se puede simular una secuencia concreta de
 * resultados sin acoplar el test a la forma exacta del SQL.
 */
type UnknownRow = Record<string, any>;

export interface DbMockState {
  selects: Array<{ fields: unknown }>;
  updates: Array<{ table: unknown; values: UnknownRow }>;
  inserts: Array<{ table: unknown; values: unknown }>;
  deletes: Array<{ table: unknown }>;
  transactions: number;
}

function awaitable(resolve: () => unknown) {
  const chain: Record<string, any> = {};
  chain.then = (onFulfilled?: any, onRejected?: any) =>
    Promise.resolve().then(resolve).then(onFulfilled, onRejected);
  chain.catch = (onRejected?: any) =>
    Promise.resolve().then(resolve).catch(onRejected);
  chain.finally = (onFinally?: any) =>
    Promise.resolve().then(resolve).finally(onFinally);
  return chain;
}

export function createDbMock() {
  const selectQueue: unknown[][] = [];
  const updateQueue: unknown[][] = [];
  const insertQueue: unknown[][] = [];
  const deleteQueue: unknown[][] = [];

  const state: DbMockState = {
    selects: [],
    updates: [],
    inserts: [],
    deletes: [],
    transactions: 0,
  };

  const take = (queue: unknown[][]) =>
    queue.length > 0 ? queue.shift()! : [];

  const makeSelect = () => {
    let cached: unknown[] | undefined;
    const resolve = () => {
      cached ??= take(selectQueue);
      return cached;
    };
    const chain = awaitable(resolve);
    for (const method of [
      'from',
      'innerJoin',
      'leftJoin',
      'rightJoin',
      'where',
      'orderBy',
      'groupBy',
      'having',
      'offset',
      'for',
    ]) {
      chain[method] = () => chain;
    }
    // `limit`/`returning` se await-ean directamente en el código real.
    chain.limit = () => Promise.resolve(resolve());
    chain.returning = () => Promise.resolve(resolve());
    return chain;
  };

  const makeUpdate = (table: unknown) => {
    let cached: unknown[] | undefined;
    const resolve = () => {
      cached ??= take(updateQueue);
      return cached;
    };
    const chain = awaitable(resolve);
    chain.set = (values: UnknownRow) => {
      state.updates.push({ table, values });
      return chain;
    };
    chain.where = () => chain;
    chain.from = () => chain;
    chain.returning = () => Promise.resolve(resolve());
    return chain;
  };

  const makeInsert = (table: unknown) => {
    let cached: unknown[] | undefined;
    const resolve = () => {
      cached ??= take(insertQueue);
      return cached;
    };
    const chain = awaitable(resolve);
    chain.values = (values: unknown) => {
      state.inserts.push({ table, values });
      return chain;
    };
    chain.onConflictDoUpdate = () => chain;
    chain.onConflictDoNothing = () => chain;
    chain.returning = () => Promise.resolve(resolve());
    return chain;
  };

  const makeDelete = (table: unknown) => {
    let cached: unknown[] | undefined;
    const resolve = () => {
      cached ??= take(deleteQueue);
      return cached;
    };
    const chain = awaitable(resolve);
    chain.where = () => {
      state.deletes.push({ table });
      return chain;
    };
    chain.returning = () => Promise.resolve(resolve());
    return chain;
  };

  const db: Record<string, any> = {
    select: vi.fn((fields?: unknown) => {
      state.selects.push({ fields });
      return makeSelect();
    }),
    update: vi.fn((table: unknown) => makeUpdate(table)),
    insert: vi.fn((table: unknown) => makeInsert(table)),
    delete: vi.fn((table: unknown) => makeDelete(table)),
    execute: vi.fn(async () => []),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(db),
    ),
  };

  const drizzle = {
    db,
    execute: db.execute,
    transaction: async (callback: (tx: unknown) => unknown) => {
      state.transactions += 1;
      return callback(db);
    },
  };

  return {
    db,
    drizzle,
    state,
    /** Encola el resultado de la siguiente consulta `select`. */
    queueSelect: (rows: unknown[]) => selectQueue.push(rows),
    /** Encola el resultado de la siguiente consulta `select` (una fila). */
    queueSelectOne: (row: unknown) => selectQueue.push([row]),
    /** Encola el resultado de la siguiente mutación `update ... returning`. */
    queueUpdate: (rows: unknown[] = []) => updateQueue.push(rows),
    /** Encola el resultado de la siguiente mutación `insert ... returning`. */
    queueInsert: (rows: unknown[] = []) => insertQueue.push(rows),
    /** Encola el resultado de la siguiente mutación `delete ... returning`. */
    queueDelete: (rows: unknown[] = []) => deleteQueue.push(rows),
  };
}

/** `ConfigService.get` básico: devuelve el valor del mapa o el default. */
export function createConfigMock(values: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
    ),
  };
}
