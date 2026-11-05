import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { DeliveryAuthService } from './delivery-auth.service';
import { createDbMock } from '../../../test/helpers/db-mock';

function driverRow(overrides: Record<string, any> = {}) {
  return {
    id: 5n,
    authUserId: 9n,
    fullName: 'Ana Repartidora',
    phone: '3001234567',
    email: null,
    vehicleType: 'MOTO',
    vehiclePlate: 'ABC123',
    vehicleBrand: 'Honda',
    vehicleModel: 'XR',
    isAvailable: true,
    isActive: true,
    avatarUrl: null,
    deletedAt: null,
    ...overrides,
  };
}

function userRow(overrides: Record<string, any> = {}) {
  return {
    id: 9n,
    username: 'ana',
    firstName: 'Ana',
    lastName: 'Gómez',
    phone: '3010000000',
    email: 'ana@example.com',
    ...overrides,
  };
}

describe('DeliveryAuthService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let authService: {
    login: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
  };
  let service: DeliveryAuthService;

  beforeEach(() => {
    mock = createDbMock();
    authService = {
      login: vi.fn(),
      refreshToken: vi.fn(),
    };
    service = new DeliveryAuthService(mock.drizzle as any, authService as any);
  });

  describe('login', () => {
    it('devuelve los tokens y el perfil del repartidor', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 9 },
      });
      mock.queueSelectOne(driverRow());
      mock.queueSelectOne(userRow());

      const result = await service.login({
        username: 'ana',
        password: 'secreta',
      });

      expect(authService.login).toHaveBeenCalledWith({
        identifier: 'ana',
        password: 'secreta',
      });
      expect(result.accessToken).toBe('access');
      expect(result.user).toEqual({
        id: 5,
        username: 'ana',
        fullName: 'Ana Repartidora',
        phone: '3001234567',
        email: 'ana@example.com',
        role: 'driver',
        vehicleType: 'MOTO',
        vehiclePlate: 'ABC123',
        vehicleBrand: 'Honda',
        vehicleModel: 'XR',
        isAvailable: true,
        isActive: true,
        avatarUrl: null,
      });
    });

    it('usa los datos de la cuenta cuando el perfil no los tiene', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 9 },
      });
      mock.queueSelectOne(
        driverRow({ fullName: '', phone: null, email: null, avatarUrl: null }),
      );
      mock.queueSelectOne(userRow());

      const result = await service.login({
        username: 'ana',
        password: 'secreta',
      });

      expect(result.user.fullName).toBe('Ana Gómez');
      expect(result.user.phone).toBe('3010000000');
      expect(result.user.email).toBe('ana@example.com');
    });

    it('usa "Repartidor" cuando no hay ningún nombre', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 9 },
      });
      mock.queueSelectOne(driverRow({ fullName: '' }));
      mock.queueSelectOne(userRow({ firstName: '', lastName: '' }));

      const result = await service.login({
        username: 'ana',
        password: 'secreta',
      });

      expect(result.user.fullName).toBe('Repartidor');
    });

    it('rechaza cuentas sin perfil de repartidor', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 9 },
      });
      mock.queueSelect([]);

      await expect(
        service.login({ username: 'ana', password: 'secreta' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza repartidores inactivos', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 9 },
      });
      mock.queueSelectOne(driverRow({ isActive: false }));

      await expect(
        service.login({ username: 'ana', password: 'secreta' }),
      ).rejects.toThrow('La cuenta no corresponde a un repartidor activo.');
    });
  });

  describe('me', () => {
    it('devuelve el perfil del repartidor autenticado', async () => {
      mock.queueSelectOne(driverRow());
      mock.queueSelectOne(userRow());

      await expect(service.me(9)).resolves.toMatchObject({
        id: 5,
        username: 'ana',
        role: 'driver',
      });
    });

    it('lanza 401 si la cuenta no tiene repartidor', async () => {
      mock.queueSelect([]);

      await expect(service.me(9)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lanza 401 si el usuario no existe', async () => {
      mock.queueSelectOne(driverRow());
      mock.queueSelect([]);

      await expect(service.me(9)).rejects.toThrow('Usuario no encontrado.');
    });
  });

  describe('refresh', () => {
    it('delega en AuthService', async () => {
      authService.refreshToken.mockResolvedValue({ accessToken: 'nuevo' });

      await expect(
        service.refresh({ refreshToken: 'viejo' } as any),
      ).resolves.toEqual({ accessToken: 'nuevo' });
      expect(authService.refreshToken).toHaveBeenCalledWith({
        refreshToken: 'viejo',
      });
    });
  });
});
