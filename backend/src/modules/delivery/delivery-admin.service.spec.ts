import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DeliveryAdminService } from './delivery-admin.service';
import { createDbMock } from '../../../test/helpers/db-mock';

function driverAdminRow(overrides: Record<string, any> = {}) {
  return {
    id: '5',
    full_name: 'Ana Repartidora',
    phone: '3001234567',
    email: 'ana@example.com',
    vehicle_type: 'MOTO',
    vehicle_plate: 'ABC123',
    vehicle_brand: 'Honda',
    vehicle_model: 'XR',
    vehicle_color: 'Rojo',
    route_color: '#2563EB',
    cargo_volume_cm3: 50_000,
    is_available: true,
    is_active: true,
    current_location: 'POINT(-75.5 5.1)',
    last_location_at: '2024-01-01T09:00:00.000Z',
    last_seen_at: null,
    avatar_url: null,
    created_at: '2023-01-01T00:00:00.000Z',
    auth_user_id: '9',
    username: 'ana',
    first_name: 'Ana',
    last_name: 'Gómez',
    driver_branch_id: '3',
    driver_branch_name: 'Centro',
    assignment_id: '11',
    assignment_status: 'IN_DELIVERY',
    assigned_at: '2024-01-01T10:00:00.000Z',
    accepted_at: '2024-01-01T10:05:00.000Z',
    picked_up_at: '2024-01-01T10:10:00.000Z',
    in_delivery_at: '2024-01-01T10:10:00.000Z',
    order_id: '31',
    reference_code: 'MER-1',
    customer_name: 'Lu Pérez',
    customer_phone: '3000000000',
    destination: 'POINT(-75.4 5.2)',
    address_line1: 'Calle 1',
    city: 'Medellín',
    branch_name: 'Centro',
    branch_location: 'POINT(-75.6 5.0)',
    ...overrides,
  };
}

function adminOrderRow(overrides: Record<string, any> = {}) {
  return {
    assignment_id: '11',
    driver_id: '5',
    driver_name: 'Ana Repartidora',
    driver_plate: 'ABC123',
    driver_available: true,
    status: 'IN_DELIVERY',
    assigned_at: '2024-01-01T10:00:00.000Z',
    accepted_at: null,
    ready_for_pickup_at: null,
    picked_up_at: null,
    in_delivery_at: null,
    completed_at: null,
    order_id: '31',
    reference_code: 'MER-1',
    customer_name: 'Lu Pérez',
    customer_phone: '3000000000',
    grand_total: '25000.00',
    currency_code: 'COP',
    notes: null,
    address_line1: 'Calle 1',
    city: 'Medellín',
    destination: 'POINT(-75.4 5.2)',
    branch_name: 'Centro',
    branch_address: 'Calle 2',
    branch_location: 'POINT(-75.6 5.0)',
    payment_method: 'CASH',
    total_volume_cm3: 12_000,
    volume_estimated: false,
    ...overrides,
  };
}

const EMPTY_LOAD = {
  driverId: 5,
  capacityCm3: null,
  usedCm3: 0,
  orders: 0,
  estimated: false,
  fill: null,
  overloaded: false,
};

describe('DeliveryAdminService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let delivery: { getOrderRoute: ReturnType<typeof vi.fn> };
  let loadService: {
    getFleetLoad: ReturnType<typeof vi.fn>;
    getDriverLoad: ReturnType<typeof vi.fn>;
  };
  let service: DeliveryAdminService;

  beforeEach(() => {
    mock = createDbMock();
    delivery = { getOrderRoute: vi.fn().mockResolvedValue({ polyline: 'g' }) };
    loadService = {
      getFleetLoad: vi.fn().mockResolvedValue([]),
      getDriverLoad: vi.fn().mockResolvedValue(EMPTY_LOAD),
    };
    service = new DeliveryAdminService(
      mock.drizzle as any,
      delivery as any,
      loadService as any,
    );
  });

  describe('listDrivers', () => {
    it('mapea la flota y le adjunta el cupo', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([driverAdminRow()]);
      loadService.getFleetLoad.mockResolvedValue([
        { ...EMPTY_LOAD, usedCm3: 1000, orders: 1, fill: 0.02 },
      ]);

      const drivers = await service.listDrivers();

      expect(drivers).toHaveLength(1);
      expect(drivers[0]).toMatchObject({
        id: 5,
        fullName: 'Ana Repartidora',
        username: 'ana',
        location: { lng: -75.5, lat: 5.1 },
        lastSeenAt: '2024-01-01T09:00:00.000Z',
        branchId: 3,
        branchName: 'Centro',
        activeAssignment: {
          assignmentId: 11,
          orderId: 31,
          referenceCode: 'MER-1',
          status: 'IN_DELIVERY',
          destination: { lng: -75.4, lat: 5.2 },
          branchLocation: { lng: -75.6, lat: 5 },
        },
        load: { driverId: 5, usedCm3: 1000, orders: 1 },
      });
    });

    it('deja load en null si el repartidor no aparece en el cupo', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([driverAdminRow({ id: '8' })]);

      const [driver] = await service.listDrivers();

      expect(driver.load).toBeNull();
    });

    it('filtra por sucursal cuando se indica', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await service.listDrivers(3);

      expect(mock.drizzle.execute.mock.calls[0][1]).toEqual([3]);
      expect(mock.drizzle.execute.mock.calls[0][0]).toContain(
        'ub.branch_id = $1',
      );
    });

    it('devuelve activeAssignment null si no hay asignación activa', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        driverAdminRow({ assignment_id: null, destination: null }),
      ]);

      const [driver] = await service.listDrivers();

      expect(driver.activeAssignment).toBeNull();
    });
  });

  describe('getDriver', () => {
    it('devuelve el repartidor con su cupo', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([driverAdminRow()]);
      loadService.getDriverLoad.mockResolvedValue({
        ...EMPTY_LOAD,
        capacityCm3: 50_000,
        usedCm3: 20_000,
        fill: 0.4,
      });

      await expect(service.getDriver(5)).resolves.toMatchObject({
        id: 5,
        load: { capacityCm3: 50_000, usedCm3: 20_000, fill: 0.4 },
      });
      expect(loadService.getDriverLoad).toHaveBeenCalledWith(5);
    });

    it('lanza 404 si no existe', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await expect(service.getDriver(5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getOrderRoute', () => {
    it('delega con el origen explícito sin buscar repartidor', async () => {
      await service.getOrderRoute(31, 'store', '-75.6,5.0');

      expect(mock.db.select).not.toHaveBeenCalled();
      expect(delivery.getOrderRoute).toHaveBeenCalledWith(
        null,
        31,
        '-75.6,5.0',
        'store',
      );
    });

    it('usa el repartidor asignado cuando no hay origen', async () => {
      mock.queueSelectOne({ driverId: 5n });
      mock.queueSelectOne({ id: 5n, currentLocation: 'POINT(-75.5 5.1)' });

      await service.getOrderRoute(31);

      expect(mock.db.select).toHaveBeenCalledTimes(2);
      expect(delivery.getOrderRoute).toHaveBeenCalledWith(
        { id: 5n, currentLocation: 'POINT(-75.5 5.1)' },
        31,
        undefined,
        'customer',
      );
    });

    it('lanza 422 si el pedido no tiene repartidor asignado', async () => {
      mock.queueSelect([]);

      await expect(service.getOrderRoute(31)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(delivery.getOrderRoute).not.toHaveBeenCalled();
    });

    it('lanza 404 si el repartidor asignado fue eliminado', async () => {
      mock.queueSelectOne({ driverId: 5n });
      mock.queueSelect([]);

      await expect(service.getOrderRoute(31)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('driverBranch', () => {
    it('devuelve la sucursal del repartidor', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([{ branch_id: '3' }]);

      await expect(service.driverBranch(5)).resolves.toBe(3);
    });

    it('devuelve null si no tiene sucursal', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([{ branch_id: null }]);

      await expect(service.driverBranch(5)).resolves.toBeNull();
    });

    it('devuelve null si el repartidor no existe', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await expect(service.driverBranch(5)).resolves.toBeNull();
    });
  });

  describe('branches', () => {
    it('mapea las sucursales activas', async () => {
      mock.queueSelect([
        { id: 3n, code: 'CEN', name: 'Centro', city: 'Medellín' },
      ]);

      await expect(service.branches()).resolves.toEqual([
        { id: 3, code: 'CEN', name: 'Centro', city: 'Medellín' },
      ]);
    });
  });

  describe('listOrders', () => {
    it('pagina y mapea los pedidos de la flota', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([{ total: 25 }])
        .mockResolvedValueOnce([adminOrderRow()]);

      const result = await service.listOrders();

      expect(result).toMatchObject({ total: 25, limit: 20, offset: 0 });
      expect(result.hasMore).toBe(true);
      expect(result.items[0]).toMatchObject({
        assignmentId: 11,
        driverId: 5,
        orderId: 31,
        status: 'IN_DELIVERY',
        destination: { lng: -75.4, lat: 5.2 },
        branchLocation: { lng: -75.6, lat: 5 },
        volume: { cm3: 12_000, estimated: false },
        totals: { value: 25_000, currency: 'COP' },
        payment: { method: 'CASH', label: 'Contraentrega' },
      });
      expect(result.hasMore).toBe(true);
    });

    it('acota el límite a 200 y el desplazamiento a 0', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([adminOrderRow()]);

      const result = await service.listOrders({ limit: 500, offset: -10 });

      expect(result.limit).toBe(200);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(mock.drizzle.execute.mock.calls[1][1]).toEqual([200, 0]);
    });

    it('aplica los filtros de sucursal, estado y búsqueda escapada', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listOrders({
        branchId: 3,
        status: 'delivered',
        q: 'MER%_1',
      });

      const params = mock.drizzle.execute.mock.calls[1][1];
      expect(params).toEqual([3, 'DELIVERED', '%MER\\%\\_1%', 20, 0]);
    });

    it('ignora el estado ALL y la búsqueda vacía', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listOrders({ status: 'all', q: '   ' });

      expect(mock.drizzle.execute.mock.calls[1][1]).toEqual([20, 0]);
    });

    it('marca pago distinto de efectivo como "Pagado"', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          adminOrderRow({ payment_method: 'CARD', volume_estimated: true }),
        ]);

      const [item] = (await service.listOrders()).items;

      expect(item.payment).toEqual({ method: 'CARD', label: 'Pagado' });
      expect(item.volume.estimated).toBe(true);
    });
  });

  describe('listDriverHistory', () => {
    it('devuelve las asignaciones cerradas del repartidor', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        adminOrderRow({ status: 'DELIVERED', completed_at: '2024-01-02' }),
      ]);

      const history = await service.listDriverHistory(5, 10);

      expect(history[0]).toMatchObject({
        status: 'DELIVERED',
        completedAt: '2024-01-02',
      });
      expect(mock.drizzle.execute.mock.calls[0][1]).toEqual([5, 10]);
    });
  });

  describe('createDriver', () => {
    const dto = {
      fullName: 'Ana Repartidora',
      username: 'ana',
      email: 'ANA@Example.com',
      phone: '3001234567',
      password: 'secreto123',
    };

    it('rechaza usuarios duplicados', async () => {
      mock.queueSelectOne({ id: 1n });

      await expect(service.createDriver(dto as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mock.state.transactions).toBe(0);
    });

    it('crea la cuenta y el perfil, y elige un color libre', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      mock.queueSelect([]); // sin usuarios duplicados
      mock.queueSelect([{ routeColor: '#2563EB' }]); // color ya usado
      mock.queueInsert([{ id: 9n }]); // users
      mock.queueInsert([{ id: 5n }]); // delivery_drivers
      mock.drizzle.execute.mockResolvedValueOnce([driverAdminRow()]);

      const result = await service.createDriver(dto as any);

      expect(result).toMatchObject({ id: 5, load: EMPTY_LOAD });
      expect(mock.state.transactions).toBe(1);

      const userValues = mock.state.inserts[0].values as Record<string, any>;
      expect(userValues).toMatchObject({
        email: 'ana@example.com',
        username: 'ana',
        firstName: 'Ana',
        lastName: 'Repartidora',
        phone: '3001234567',
        isSuperuser: false,
        isActive: true,
      });
      expect(userValues.passwordHash).not.toBe('secreto123');
      expect(await bcrypt.compare('secreto123', userValues.passwordHash)).toBe(
        true,
      );

      const driverValues = mock.state.inserts[1].values as Record<string, any>;
      expect(driverValues).toMatchObject({
        fullName: 'Ana Repartidora',
        email: 'ana@example.com',
        authUserId: 9,
        routeColor: '#DC2626',
        isAvailable: true,
        isActive: true,
      });
      expect(mock.state.deletes).toHaveLength(1);
    });

    it('valida la sucursal al asignarla', async () => {
      mock.queueSelect([]); // sin duplicados
      mock.queueSelect([]); // sin colores usados
      mock.queueInsert([{ id: 9n }]);
      mock.queueInsert([{ id: 5n }]);
      mock.queueSelect([]); // sucursal inexistente
      mock.drizzle.execute.mockResolvedValueOnce([driverAdminRow()]);

      await expect(
        service.createDriver({ ...dto, branchId: 99 } as any),
      ).rejects.toThrow('La sucursal no existe.');
      expect(mock.state.inserts).toHaveLength(2);
    });
  });

  describe('updateDriver', () => {
    it('rechaza un username usado por otra cuenta', async () => {
      mock.queueSelectOne({ id: 5n, authUserId: '9' });
      mock.queueSelectOne({ id: 7n });

      await expect(
        service.updateDriver(5, { username: 'otro' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mock.state.updates).toHaveLength(0);
    });

    it('normaliza los campos y omite la cuenta si no hay nada que sincronizar', async () => {
      mock.queueSelectOne({ id: 5n, authUserId: '9' });
      mock.drizzle.execute.mockResolvedValueOnce([driverAdminRow()]);

      await service.updateDriver(5, {
        fullName: '  Ana Nueva  ',
        email: '  ANA@X.COM ',
        vehiclePlate: '   ',
        cargoVolumeCm3: null,
        isAvailable: false,
      } as any);

      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toMatchObject({
        fullName: 'Ana Nueva',
        email: 'ana@x.com',
        vehiclePlate: null,
        cargoVolumeCm3: null,
        isAvailable: false,
        updatedAt: expect.any(String),
      });
    });

    it('sincroniza username y nombres de la cuenta de acceso', async () => {
      mock.queueSelectOne({ id: 5n, authUserId: '9' });
      mock.queueSelectOne({ id: 9n }); // el username lo usa la misma cuenta
      mock.drizzle.execute.mockResolvedValueOnce([driverAdminRow()]);

      await service.updateDriver(5, {
        username: 'ana2',
        firstName: 'Ana',
        lastName: 'Nueva',
      } as any);

      expect(mock.state.updates).toHaveLength(2);
      expect(mock.state.updates[1].values).toMatchObject({
        username: 'ana2',
        firstName: 'Ana',
        lastName: 'Nueva',
      });
    });

    it('lanza 404 si el repartidor no existe', async () => {
      mock.queueSelect([]);

      await expect(
        service.updateDriver(5, { fullName: 'X' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resetPassword', () => {
    it('rechaza repartidores sin cuenta de acceso', async () => {
      mock.queueSelectOne({ id: 5n, authUserId: null });

      await expect(
        service.resetPassword(5, 'nuevaClave'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mock.state.updates).toHaveLength(0);
    });

    it('guarda el hash y limpia los bloqueos de la cuenta', async () => {
      mock.queueSelectOne({ id: 5n, authUserId: '9' });

      await expect(service.resetPassword(5, 'nuevaClave')).resolves.toEqual({
        success: true,
      });

      const values = mock.state.updates[0].values as Record<string, any>;
      expect(values.lockedUntil).toBeNull();
      expect(values.failedAttempts).toBe(0);
      expect(values.passwordHash).not.toBe('nuevaClave');
      expect(await bcrypt.compare('nuevaClave', values.passwordHash)).toBe(
        true,
      );
    });
  });
});
