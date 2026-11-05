import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PickerQueueService } from './picker-queue.service';
import {
  estimateEtaSeconds,
  estimatePickSeconds,
  manhattan,
  nearestNeighborShelfOrder,
  routeDistance,
  PICK_SECONDS_PER_CELL,
  PICK_SECONDS_PER_ITEM,
} from './picker-routing';
import { createDbMock } from '../../../test/helpers/db-mock';

describe('picker-routing', () => {
  it('calcula la distancia Manhattan', () => {
    expect(manhattan({ shelfId: 1, x: 0, y: 0 }, { shelfId: 2, x: 3, y: 4 })).toBe(7);
    expect(manhattan({ shelfId: 1, x: -2, y: 5 }, { shelfId: 2, x: 1, y: 1 })).toBe(7);
  });

  it('ordena las estanterías por vecino más cercano', () => {
    const shelves = [
      { shelfId: 1, x: 0, y: 0 },
      { shelfId: 2, x: 10, y: 0 },
      { shelfId: 3, x: 1, y: 0 },
      { shelfId: 4, x: 9, y: 0 },
    ];

    expect(nearestNeighborShelfOrder(shelves).map((s) => s.shelfId)).toEqual([
      1, 3, 4, 2,
    ]);
  });

  it('no muta la lista original', () => {
    const shelves = [
      { shelfId: 1, x: 0, y: 0 },
      { shelfId: 2, x: 5, y: 5 },
    ];
    nearestNeighborShelfOrder(shelves);
    expect(shelves.map((s) => s.shelfId)).toEqual([1, 2]);
  });

  it('calcula la distancia total del recorrido', () => {
    expect(
      routeDistance([
        { shelfId: 1, x: 0, y: 0 },
        { shelfId: 2, x: 3, y: 0 },
        { shelfId: 3, x: 3, y: 4 },
      ]),
    ).toBe(7);
    expect(routeDistance([])).toBe(0);
  });

  it('estima el tiempo de picking por unidades y celdas', () => {
    expect(estimatePickSeconds(2, 3)).toBe(
      2 * PICK_SECONDS_PER_ITEM + 3 * PICK_SECONDS_PER_CELL,
    );
  });

  it('estima el ETA reordenando las estanterías', () => {
    const eta = estimateEtaSeconds(2, [
      { shelfId: 1, x: 10, y: 0 },
      { shelfId: 2, x: 0, y: 0 },
    ]);
    // Recorrido 2→1 = 10 celdas, 2 unidades.
    expect(eta).toBe(2 * PICK_SECONDS_PER_ITEM + 10 * PICK_SECONDS_PER_CELL);
  });
});

describe('PickerQueueService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let push: { sendToUser: ReturnType<typeof vi.fn> };
  let service: PickerQueueService;

  const orderRow = {
    id: 1n,
    branchId: 1n,
    status: 'paid',
    referenceCode: 'MER-1',
    pickerId: null,
  };

  beforeEach(() => {
    mock = createDbMock();
    push = { sendToUser: vi.fn().mockResolvedValue(undefined) };
    service = new PickerQueueService(mock.drizzle as any, push as any);
  });

  it('despacha al picker que terminará antes', async () => {
    mock.queueSelectOne(orderRow); // pedido
    mock.queueSelect([{ id: 10n }, { id: 20n }]); // candidatos
    // Picker 10: un pedido pendiente con 2 unidades restantes → 60 s.
    mock.queueSelectOne({ id: 100n });
    mock.queueSelectOne({ branchId: 1n });
    mock.queueSelect([
      { quantity: 3, pickedQty: 1, shelfId: 1n, shelfX: 10, shelfY: 10 },
    ]);
    // Picker 20: sin pedidos pendientes → 0 s.
    mock.queueSelect([]);
    mock.queueUpdate([{ id: 1n }]);

    const result = await service.dispatchNewOrder(1);

    expect(result.assigned).toBe(true);
    expect(result.pickerId).toBe(20);
    expect(mock.state.updates[0].values).toEqual({ pickerId: 20 });
    expect(push.sendToUser).toHaveBeenCalledWith(
      20,
      expect.objectContaining({
        title: expect.stringContaining('Pedido asignado'),
        data: expect.objectContaining({ orderId: '1', referenceCode: 'MER-1' }),
      }),
    );
  });

  it('es idempotente si el pedido ya tiene picker', async () => {
    mock.queueSelectOne({ ...orderRow, pickerId: 3n });

    await expect(service.dispatchNewOrder(1)).resolves.toEqual({
      assigned: true,
      pickerId: 3,
    });
    expect(mock.state.updates).toHaveLength(0);
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('no despacha pedidos en estados no despachables', async () => {
    mock.queueSelectOne({ ...orderRow, status: 'preparing' });

    await expect(service.dispatchNewOrder(1)).resolves.toEqual({
      assigned: false,
      pickerId: null,
    });
  });

  it('no despacha si el pedido no existe', async () => {
    mock.queueSelect([]);

    await expect(service.dispatchNewOrder(1)).resolves.toEqual({
      assigned: false,
      pickerId: null,
    });
  });

  it('deja el pedido sin asignar si no hay pickers disponibles', async () => {
    mock.queueSelectOne(orderRow);
    mock.queueSelect([]);

    await expect(service.dispatchNewOrder(1)).resolves.toEqual({
      assigned: false,
      pickerId: null,
    });
    expect(mock.state.updates).toHaveLength(0);
  });

  it('no asigna si otro proceso tomó el pedido antes (update atómico vacío)', async () => {
    mock.queueSelectOne(orderRow);
    mock.queueSelectOne({ id: 10n });
    mock.queueSelect([]);
    mock.queueUpdate([]);

    await expect(service.dispatchNewOrder(1)).resolves.toEqual({
      assigned: false,
      pickerId: null,
    });
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('calcula el ETA de lo que falta de un pedido', async () => {
    mock.queueSelectOne({ branchId: 1n });
    mock.queueSelect([
      { quantity: 5, pickedQty: 2, shelfId: 1n, shelfX: 0, shelfY: 0 },
      { quantity: 4, pickedQty: 4, shelfId: 1n, shelfX: 0, shelfY: 0 },
      { quantity: 1, pickedQty: 0, shelfId: 2n, shelfX: 3, shelfY: 3 },
    ]);

    const result = await service.orderEtaSeconds(1);

    // 3 + 1 = 4 unidades restantes; recorrido 1→2 = 6 celdas.
    expect(result.remainingPieces).toBe(4);
    expect(result.etaSeconds).toBe(
      4 * PICK_SECONDS_PER_ITEM + 6 * PICK_SECONDS_PER_CELL,
    );
  });

  it('suma el ETA de todos los pedidos pendientes de un picker', async () => {
    mock.queueSelect([{ id: 10n }, { id: 20n }]);
    // Pedido 10: 1 unidad, sin estanterías → 30 s.
    mock.queueSelectOne({ branchId: 1n });
    mock.queueSelect([
      { quantity: 1, pickedQty: 0, shelfId: null, shelfX: null, shelfY: null },
    ]);
    // Pedido 20: 2 unidades, sin estanterías → 60 s.
    mock.queueSelectOne({ branchId: 1n });
    mock.queueSelect([
      { quantity: 2, pickedQty: 0, shelfId: null, shelfX: null, shelfY: null },
    ]);

    const result = await service.computePickerFreeAt(5);

    expect(result.etaSeconds).toBe(90);
    expect(result.queuedOrders).toBe(2);
  });

  it('al volver a estar disponible refresca la señal y redespacha', async () => {
    mock.queueSelect([]); // sin sucursal asignada: no hay nada que redespachar

    await expect(service.setAvailability(5, true)).resolves.toEqual({
      ok: true,
      pickerId: 5,
      available: true,
    });
    expect(mock.state.updates[0].values).toMatchObject({
      isAvailable: true,
      lastSeenAt: expect.any(String),
    });
  });

  it('heartbeat solo refresca lastSeenAt', async () => {
    await expect(service.heartbeat(5)).resolves.toEqual({ ok: true });
    expect(mock.state.updates[0].values).toEqual({
      lastSeenAt: expect.any(String),
    });
  });
});
