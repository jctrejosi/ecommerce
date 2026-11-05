import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DeliveryLoadService,
  LOAD_STATUSES,
  fallbackVolumeCm3,
  itemVolumeRange,
} from './delivery-load.service';
import { createDbMock } from '../../../test/helpers/db-mock';

describe('DeliveryLoadService — helpers de configuración', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DEFAULT_ITEM_VOLUME_CM3;
    delete process.env.MIN_ITEM_VOLUME_CM3;
    delete process.env.MAX_ITEM_VOLUME_CM3;
  });

  describe('fallbackVolumeCm3', () => {
    it('usa 1.000 cm³ por defecto', () => {
      delete process.env.DEFAULT_ITEM_VOLUME_CM3;
      expect(fallbackVolumeCm3()).toBe(1000);
    });

    it('respeta el valor configurado por entorno', () => {
      vi.stubEnv('DEFAULT_ITEM_VOLUME_CM3', '2500');
      expect(fallbackVolumeCm3()).toBe(2500);
    });

    it('ignora valores inválidos o no positivos', () => {
      vi.stubEnv('DEFAULT_ITEM_VOLUME_CM3', '-10');
      expect(fallbackVolumeCm3()).toBe(1000);

      vi.stubEnv('DEFAULT_ITEM_VOLUME_CM3', 'mucho');
      expect(fallbackVolumeCm3()).toBe(1000);
    });
  });

  describe('itemVolumeRange', () => {
    it('usa el rango por defecto 1..50.000 cm³', () => {
      delete process.env.MIN_ITEM_VOLUME_CM3;
      delete process.env.MAX_ITEM_VOLUME_CM3;
      expect(itemVolumeRange()).toEqual({ min: 1, max: 50_000 });
    });

    it('respeta los límites configurados', () => {
      vi.stubEnv('MIN_ITEM_VOLUME_CM3', '100');
      vi.stubEnv('MAX_ITEM_VOLUME_CM3', '25000');
      expect(itemVolumeRange()).toEqual({ min: 100, max: 25_000 });
    });

    it('corrige límites inválidos', () => {
      vi.stubEnv('MIN_ITEM_VOLUME_CM3', '-5');
      vi.stubEnv('MAX_ITEM_VOLUME_CM3', '0');
      expect(itemVolumeRange()).toEqual({ min: 1, max: 50_000 });
    });

    it('admite un mínimo de 0', () => {
      vi.stubEnv('MIN_ITEM_VOLUME_CM3', '0');
      expect(itemVolumeRange().min).toBe(0);
    });
  });

  it('los estados de carga excluyen ASSIGNED (solo es una oferta)', () => {
    expect(LOAD_STATUSES).toEqual([
      'ACCEPTED',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'IN_DELIVERY',
    ]);
  });
});

describe('DeliveryLoadService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let service: DeliveryLoadService;

  beforeEach(() => {
    mock = createDbMock();
    service = new DeliveryLoadService(mock.drizzle as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DEFAULT_ITEM_VOLUME_CM3;
    delete process.env.MIN_ITEM_VOLUME_CM3;
    delete process.env.MAX_ITEM_VOLUME_CM3;
  });

  describe('computeOrderLoad', () => {
    it('suma el volumen conocido y el respaldo de las unidades sin medidas', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          volume_cm3: '5000.4',
          items_missing_dims: '1',
          items_out_of_range: '0',
          units: '3',
          units_missing_dims: '2',
        },
      ]);

      const load = await service.computeOrderLoad(7);

      expect(load).toEqual({
        volumeCm3: 7000, // 5000 redondeado + 2 × 1.000
        estimated: true,
        itemsMissingDims: 1,
        itemsOutOfRange: 0,
        units: 3,
      });
      expect(mock.drizzle.execute).toHaveBeenCalledWith(
        expect.stringContaining('FROM order_items'),
        [7, 1, 50_000],
      );
    });

    it('marca estimated=false cuando todas las medidas son válidas', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          volume_cm3: 1234.6,
          items_missing_dims: 0,
          items_out_of_range: 0,
          units: 4,
          units_missing_dims: 0,
        },
      ]);

      const load = await service.computeOrderLoad(1);

      expect(load.volumeCm3).toBe(1235);
      expect(load.estimated).toBe(false);
      expect(load.itemsMissingDims).toBe(0);
    });

    it('cuenta las líneas descartadas por medidas fuera de rango', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          volume_cm3: null,
          items_missing_dims: 2,
          items_out_of_range: 1,
          units: 2,
          units_missing_dims: 1,
        },
      ]);

      const load = await service.computeOrderLoad(1);

      expect(load.itemsOutOfRange).toBe(1);
      expect(load.volumeCm3).toBe(1000);
      expect(load.estimated).toBe(true);
    });

    it('devuelve ceros si el pedido no tiene líneas', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await expect(service.computeOrderLoad(9)).resolves.toEqual({
        volumeCm3: 0,
        estimated: false,
        itemsMissingDims: 0,
        itemsOutOfRange: 0,
        units: 0,
      });
    });

    it('usa el volumen de respaldo configurado por entorno', async () => {
      vi.stubEnv('DEFAULT_ITEM_VOLUME_CM3', '500');
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          volume_cm3: 0,
          items_missing_dims: 1,
          items_out_of_range: 0,
          units: 3,
          units_missing_dims: 3,
        },
      ]);

      const load = await service.computeOrderLoad(1);

      expect(load.volumeCm3).toBe(1500);
    });

    it('pasa al SQL los límites de volumen configurados', async () => {
      vi.stubEnv('MIN_ITEM_VOLUME_CM3', '10');
      vi.stubEnv('MAX_ITEM_VOLUME_CM3', '9000');
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await service.computeOrderLoad(3);

      expect(mock.drizzle.execute).toHaveBeenCalledWith(
        expect.any(String),
        [3, 10, 9000],
      );
    });
  });

  describe('snapshotOrderLoad', () => {
    it('calcula el volumen y lo persiste en el envío', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([
          {
            volume_cm3: '2000',
            items_missing_dims: 0,
            items_out_of_range: 0,
            units: 2,
            units_missing_dims: 0,
          },
        ])
        .mockResolvedValueOnce([]);

      const load = await service.snapshotOrderLoad(12);

      expect(load.volumeCm3).toBe(2000);
      expect(mock.drizzle.execute).toHaveBeenCalledTimes(2);
      const [sql, params] = mock.drizzle.execute.mock.calls[1];
      expect(sql).toContain('UPDATE shipments');
      expect(params).toEqual([12, 2000, false]);
    });

    it('persiste la marca de estimado para pedidos incompletos', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([
          {
            volume_cm3: 0,
            items_missing_dims: 1,
            items_out_of_range: 0,
            units: 1,
            units_missing_dims: 1,
          },
        ])
        .mockResolvedValueOnce([]);

      await service.snapshotOrderLoad(5);

      expect(mock.drizzle.execute.mock.calls[1][1]).toEqual([5, 1000, true]);
    });
  });

  describe('getDriverLoad', () => {
    it('calcula ocupación y sobrecarga del repartidor', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          driver_id: '7',
          capacity_cm3: 10_000,
          used_cm3: '5000',
          orders: '2',
          estimated_count: '1',
        },
      ]);

      await expect(service.getDriverLoad(7)).resolves.toEqual({
        driverId: 7,
        capacityCm3: 10_000,
        usedCm3: 5000,
        orders: 2,
        estimated: true,
        fill: 0.5,
        overloaded: false,
      });
    });

    it('marca overloaded cuando la carga supera la capacidad', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          driver_id: '8',
          capacity_cm3: 10_000,
          used_cm3: 12_500,
          orders: 3,
          estimated_count: 0,
        },
      ]);

      const load = await service.getDriverLoad(8);

      expect(load.overloaded).toBe(true);
      expect(load.fill).toBe(1.25);
    });

    it('deja fill en null si el vehículo no declara capacidad', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          driver_id: '9',
          capacity_cm3: null,
          used_cm3: 3000,
          orders: 1,
          estimated_count: 0,
        },
      ]);

      const load = await service.getDriverLoad(9);

      expect(load.capacityCm3).toBeNull();
      expect(load.fill).toBeNull();
      expect(load.overloaded).toBe(false);
      expect(load.usedCm3).toBe(3000);
    });

    it('filtra por repartidor en el SQL', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await service.getDriverLoad(7);

      expect(mock.drizzle.execute).toHaveBeenCalledWith(
        expect.stringContaining('d.id = $2'),
        [[...LOAD_STATUSES], 7],
      );
    });

    it('devuelve un objeto neutro si no encuentra al repartidor', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await expect(service.getDriverLoad(42)).resolves.toEqual({
        driverId: 42,
        capacityCm3: null,
        usedCm3: 0,
        orders: 0,
        estimated: false,
        fill: null,
        overloaded: false,
      });
    });
  });

  describe('getFleetLoad', () => {
    it('mapea toda la flota en una sola consulta', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        {
          driver_id: '1',
          capacity_cm3: 5000,
          used_cm3: 1000,
          orders: 1,
          estimated_count: 0,
        },
        {
          driver_id: '2',
          capacity_cm3: null,
          used_cm3: 0,
          orders: 0,
          estimated_count: 0,
        },
      ]);

      const loads = await service.getFleetLoad();

      expect(loads).toEqual([
        {
          driverId: 1,
          capacityCm3: 5000,
          usedCm3: 1000,
          orders: 1,
          estimated: false,
          fill: 0.2,
          overloaded: false,
        },
        {
          driverId: 2,
          capacityCm3: null,
          usedCm3: 0,
          orders: 0,
          estimated: false,
          fill: null,
          overloaded: false,
        },
      ]);
      expect(mock.drizzle.execute).toHaveBeenCalledTimes(1);
    });

    it('no filtra por repartidor cuando se pide la flota completa', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await service.getFleetLoad();

      const [sql, params] = mock.drizzle.execute.mock.calls[0];
      expect(sql).not.toContain('d.id = $2');
      expect(params).toEqual([[...LOAD_STATUSES]]);
    });
  });
});
