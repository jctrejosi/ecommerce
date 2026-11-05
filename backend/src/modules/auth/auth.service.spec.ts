import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { createConfigMock, createDbMock } from '../../../test/helpers/db-mock';

const PASSWORD = 'secret123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 7n,
    email: 'admin@test.local',
    username: 'admin',
    passwordHash: PASSWORD_HASH,
    firstName: 'Ada',
    lastName: 'Admin',
    phone: null,
    avatarUrl: null,
    isSuperuser: true,
    isActive: true,
    lockedUntil: null,
    failedAttempts: 0,
    lastLoginAt: null,
    ...overrides,
  };
}

function makeRefreshTokenRow(overrides: Record<string, any> = {}) {
  return {
    id: 1n,
    userId: 7,
    token: 'refresh-token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revoked: false,
    ...overrides,
  };
}

describe('AuthService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let jwt: { sign: Mock; verify: Mock };
  let config: ReturnType<typeof createConfigMock>;
  let service: AuthService;

  beforeEach(() => {
    mock = createDbMock();
    jwt = {
      sign: vi.fn().mockReturnValue('signed-token'),
      verify: vi.fn(),
    };
    config = createConfigMock({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '7d',
      JWT_REFRESH_EXPIRES_IN: '30d',
    });
    service = new AuthService(
      mock.drizzle as any,
      jwt as any,
      config as any,
    );
  });

  describe('validateUser', () => {
    it('devuelve el usuario y resetea intentos cuando la contraseña es correcta', async () => {
      const user = makeUser({ failedAttempts: 2 });
      mock.queueSelect([user]);

      const result = await service.validateUser('admin@test.local', PASSWORD);

      expect(result).toBe(user);
      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toMatchObject({
        failedAttempts: 0,
        lockedUntil: null,
      });
      expect(mock.state.updates[0].values.lastLoginAt).toEqual(expect.any(String));
    });

    it('devuelve null si el usuario no existe', async () => {
      mock.queueSelect([]);

      await expect(
        service.validateUser('nadie@test.local', PASSWORD),
      ).resolves.toBeNull();
      expect(mock.state.updates).toHaveLength(0);
    });

    it('devuelve null si el usuario está inactivo', async () => {
      mock.queueSelect([makeUser({ isActive: false })]);

      await expect(
        service.validateUser('admin@test.local', PASSWORD),
      ).resolves.toBeNull();
      expect(mock.state.updates).toHaveLength(0);
    });

    it('devuelve null si el usuario no tiene hash de contraseña', async () => {
      mock.queueSelect([makeUser({ passwordHash: null })]);

      await expect(
        service.validateUser('admin@test.local', PASSWORD),
      ).resolves.toBeNull();
    });

    it('incrementa los intentos fallidos cuando la contraseña es incorrecta', async () => {
      mock.queueSelect([makeUser({ failedAttempts: 2 })]);

      await expect(
        service.validateUser('admin@test.local', 'incorrecta'),
      ).resolves.toBeNull();

      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toEqual({ failedAttempts: 3 });
    });

    it('bloquea la cuenta al alcanzar el máximo de intentos', async () => {
      mock.queueSelect([makeUser({ failedAttempts: 4 })]);

      await expect(
        service.validateUser('admin@test.local', 'incorrecta'),
      ).rejects.toThrow(/Demasiados intentos fallidos/);

      // El bloqueo se lanza antes de persistir: no debe escribir nada.
      expect(mock.state.updates).toHaveLength(0);
    });

    it('rechaza el login si la cuenta está bloqueada temporalmente', async () => {
      mock.queueSelect([
        makeUser({
          lockedUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      ]);

      await expect(
        service.validateUser('admin@test.local', PASSWORD),
      ).rejects.toThrow(/Cuenta bloqueada temporalmente/);
      expect(mock.state.updates).toHaveLength(0);
    });
  });

  describe('login', () => {
    it('firma tokens, guarda el refresh y devuelve datos de acceso', async () => {
      const user = makeUser();
      vi.spyOn(service, 'validateUser').mockResolvedValue(user as any);
      mock.queueSelectOne({ id: 3n, name: 'Sucursal Centro' });
      mock.queueSelect([
        { roleName: 'Administrador', code: 'catalog:read' },
        { roleName: 'Administrador', code: 'orders:read' },
      ]);
      mock.queueInsert();

      const result = await service.login({
        identifier: 'admin@test.local',
        password: PASSWORD,
      } as any);

      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(result.expiresIn).toBe(7 * 24 * 60 * 60);
      expect(result.user).toMatchObject({
        id: 7,
        email: 'admin@test.local',
        fullName: 'Ada Admin',
        branchId: 3,
        branchName: 'Sucursal Centro',
        roles: ['Administrador'],
        permissions: ['*'],
      });

      expect(jwt.sign).toHaveBeenCalledTimes(2);
      const inserted = mock.state.inserts[0].values as any;
      expect(inserted.userId).toBe(7);
      expect(inserted.token).toBe('signed-token');
      const days =
        (new Date(inserted.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThan(31);
    });

    it('rechaza credenciales inválidas', async () => {
      vi.spyOn(service, 'validateUser').mockResolvedValue(null);

      await expect(
        service.login({ identifier: 'admin', password: 'mala' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    it('rechaza un refresh token ausente', async () => {
      await expect(
        service.refreshToken({ refreshToken: '' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza un token que no está en la base de datos', async () => {
      mock.queueSelect([]);

      await expect(
        service.refreshToken({ refreshToken: 'no-existe' } as any),
      ).rejects.toThrow(/Refresh token inválido o expirado/);
    });

    it('rechaza un token revocado', async () => {
      mock.queueSelect([makeRefreshTokenRow({ revoked: true })]);

      await expect(
        service.refreshToken({ refreshToken: 'refresh-token' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('elimina y rechaza un token expirado', async () => {
      mock.queueSelect([
        makeRefreshTokenRow({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ]);

      await expect(
        service.refreshToken({ refreshToken: 'refresh-token' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mock.state.deletes).toHaveLength(1);
    });

    it('emite un nuevo access token si el token y el usuario son válidos', async () => {
      mock.queueSelect([makeRefreshTokenRow()]);
      jwt.verify.mockReturnValue({
        sub: 7,
        email: 'admin@test.local',
        username: 'admin',
        isSuperuser: true,
      });
      mock.queueSelect([makeUser()]);

      const result = await service.refreshToken({
        refreshToken: 'refresh-token',
      } as any);

      expect(result.accessToken).toBe('signed-token');
      expect(result.expiresIn).toBe(7 * 24 * 60 * 60);
      expect(jwt.verify).toHaveBeenCalledWith('refresh-token', {
        secret: 'test-secret',
      });
    });

    it('revoca todos los tokens si el usuario ya no es válido', async () => {
      mock.queueSelect([makeRefreshTokenRow()]);
      jwt.verify.mockReturnValue({ sub: 7 });
      mock.queueSelect([makeUser({ isActive: false })]);
      mock.queueUpdate();

      await expect(
        service.refreshToken({ refreshToken: 'refresh-token' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toEqual({ revoked: true });
    });

    it('rechaza si el JWT no se puede verificar', async () => {
      mock.queueSelect([makeRefreshTokenRow()]);
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(
        service.refreshToken({ refreshToken: 'refresh-token' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
