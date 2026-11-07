import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerAuthController } from './customer-auth.controller';
import type { CustomerAuthService } from './customer-auth.service';

const AUTH_RESPONSE = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 604800,
  customer: {
    id: 42,
    email: 'cliente@test.local',
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    phone: null,
    isVerified: true,
    isActive: true,
    provider: 'local',
    avatarUrl: null,
    acceptsMarketing: false,
  },
};

function makeResponse() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as any;
}

describe('CustomerAuthController', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let controller: CustomerAuthController;
  let response: ReturnType<typeof makeResponse>;

  const user = { sub: 42, email: 'cliente@test.local', type: 'customer' as const };

  beforeEach(() => {
    service = {
      register: vi.fn().mockResolvedValue(AUTH_RESPONSE),
      login: vi.fn().mockResolvedValue(AUTH_RESPONSE),
      socialLogin: vi.fn().mockResolvedValue(AUTH_RESPONSE),
      socialLoginWithGoogleCode: vi.fn().mockResolvedValue(AUTH_RESPONSE),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'a', expiresIn: 1 }),
      getProfile: vi.fn().mockResolvedValue({ id: 42 }),
      updateProfile: vi.fn().mockResolvedValue({ id: 42 }),
      setPushToken: vi.fn().mockResolvedValue({ success: true }),
      deleteAccount: vi.fn().mockResolvedValue({ success: true }),
      logout: vi.fn().mockResolvedValue({ success: true }),
      getAddresses: vi.fn().mockResolvedValue([]),
      createAddress: vi.fn().mockResolvedValue({ id: 1 }),
      updateAddress: vi.fn().mockResolvedValue({ id: 1 }),
      deleteAddress: vi.fn().mockResolvedValue({ success: true }),
      setDefaultAddress: vi.fn().mockResolvedValue({ success: true }),
      getPaymentMethods: vi.fn().mockResolvedValue([]),
      createPaymentMethod: vi.fn().mockResolvedValue({ id: 1 }),
      updatePaymentMethod: vi.fn().mockResolvedValue({ id: 1 }),
      deletePaymentMethod: vi.fn().mockResolvedValue({ success: true }),
      setDefaultPaymentMethod: vi.fn().mockResolvedValue({ success: true }),
    };
    controller = new CustomerAuthController(
      service as unknown as CustomerAuthService,
    );
    response = makeResponse();
  });

  describe('autenticación', () => {
    it('registra y fija las cookies de acceso y refresco', async () => {
      const dto = {
        email: 'cliente@test.local',
        password: 'cliente123',
        firstName: 'Ada',
        lastName: 'Lovelace',
        acceptsTerms: true,
      };

      await expect(controller.register(dto as any, response)).resolves.toBe(
        AUTH_RESPONSE,
      );
      expect(service.register).toHaveBeenCalledWith(dto);
      expect(response.cookie).toHaveBeenCalledTimes(2);
      expect(response.cookie).toHaveBeenNthCalledWith(
        1,
        'customer_access_token',
        'access-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        }),
      );
      expect(response.cookie).toHaveBeenNthCalledWith(
        2,
        'customer_refresh_token',
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        }),
      );
    });

    it('inicia sesión y fija las cookies', async () => {
      const dto = { email: 'cliente@test.local', password: 'cliente123' };

      await expect(controller.login(dto as any, response)).resolves.toBe(
        AUTH_RESPONSE,
      );
      expect(service.login).toHaveBeenCalledWith(dto);
      expect(response.cookie).toHaveBeenCalledTimes(2);
    });

    it('delega el login social y fija las cookies', async () => {
      const dto = { provider: 'google', accessToken: 'at' };

      await controller.socialLogin(dto as any, response);

      expect(service.socialLogin).toHaveBeenCalledWith(dto);
      expect(response.cookie).toHaveBeenCalledTimes(2);
    });

    it('pasa el code y el origin al flujo de Google', async () => {
      const dto = { code: 'code-1', redirectUri: 'https://tienda.test' };

      await controller.socialLoginGoogleCode(
        dto as any,
        { headers: { origin: 'https://tienda.test' } } as any,
        response,
      );

      expect(service.socialLoginWithGoogleCode).toHaveBeenCalledWith(
        dto,
        'https://tienda.test',
      );
      expect(response.cookie).toHaveBeenCalledTimes(2);
    });

    it('refresca con el token recibido', async () => {
      await expect(
        controller.refreshToken({ refreshToken: 'r' }),
      ).resolves.toEqual({ accessToken: 'a', expiresIn: 1 });

      expect(service.refreshToken).toHaveBeenCalledWith('r');
    });

    it('refresca con cadena vacía si no se envía token', async () => {
      await controller.refreshToken({});

      expect(service.refreshToken).toHaveBeenCalledWith('');
    });

    it('no fija cookie de refresco si el servicio no la devuelve', async () => {
      service.login.mockResolvedValueOnce({
        ...AUTH_RESPONSE,
        refreshToken: undefined,
      });

      await controller.login({} as any, response);

      expect(response.cookie).toHaveBeenCalledTimes(1);
      expect(response.cookie).toHaveBeenCalledWith(
        'customer_access_token',
        'access-token',
        expect.any(Object),
      );
    });
  });

  describe('perfil', () => {
    it('obtiene el perfil del cliente autenticado', async () => {
      await expect(controller.getProfile(user)).resolves.toEqual({ id: 42 });
      expect(service.getProfile).toHaveBeenCalledWith(42);
    });

    it('actualiza el perfil del cliente autenticado', async () => {
      const body = { firstName: 'Grace', acceptsMarketing: true };

      await controller.updateProfile(user, body);

      expect(service.updateProfile).toHaveBeenCalledWith(42, body);
    });

    it('registra el token push', async () => {
      await expect(
        controller.setPushToken(user, { token: 'fcm' }),
      ).resolves.toEqual({ success: true });
      expect(service.setPushToken).toHaveBeenCalledWith(42, 'fcm');
    });

    it('limpia el token push si no se envía', async () => {
      await controller.setPushToken(user, undefined as any);

      expect(service.setPushToken).toHaveBeenCalledWith(42, null);
    });

    it('elimina la cuenta del cliente autenticado', async () => {
      await controller.deleteAccount(user);

      expect(service.deleteAccount).toHaveBeenCalledWith(42);
    });

    it('cierra sesión, limpia cookies y revoca el refresh indicado', async () => {
      await expect(
        controller.logout(user, { refreshToken: 'r' }, response),
      ).resolves.toEqual({ success: true });

      expect(response.clearCookie).toHaveBeenCalledWith(
        'customer_access_token',
        { path: '/' },
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        'customer_refresh_token',
        { path: '/' },
      );
      expect(service.logout).toHaveBeenCalledWith(42, 'r');
    });

    it('cierra sesión sin cuerpo', async () => {
      await controller.logout(user);

      expect(service.logout).toHaveBeenCalledWith(42, undefined);
    });
  });

  describe('direcciones', () => {
    it('lista direcciones', async () => {
      await controller.getAddresses(user);

      expect(service.getAddresses).toHaveBeenCalledWith(42);
    });

    it('crea una dirección', async () => {
      const dto = { addressLine1: 'Calle 1', city: 'Bogotá' };

      await controller.createAddress(user, dto);

      expect(service.createAddress).toHaveBeenCalledWith(42, dto);
    });

    it('actualiza una dirección convirtiendo el id a número', async () => {
      await controller.updateAddress(user, '9', { city: 'Cali' });

      expect(service.updateAddress).toHaveBeenCalledWith(42, 9, {
        city: 'Cali',
      });
    });

    it('elimina una dirección convirtiendo el id a número', async () => {
      await controller.deleteAddress(user, '9');

      expect(service.deleteAddress).toHaveBeenCalledWith(42, 9);
    });

    it('marca una dirección como predeterminada', async () => {
      await controller.setDefaultAddress(user, '9');

      expect(service.setDefaultAddress).toHaveBeenCalledWith(42, 9);
    });
  });

  describe('métodos de pago', () => {
    it('lista los métodos guardados', async () => {
      await controller.getPaymentMethods(user);

      expect(service.getPaymentMethods).toHaveBeenCalledWith(42);
    });

    it('crea un método de pago', async () => {
      const dto = { methodType: 'CARD' as const, token: 't' };

      await controller.createPaymentMethod(user, dto);

      expect(service.createPaymentMethod).toHaveBeenCalledWith(42, dto);
    });

    it('actualiza un método de pago convirtiendo el id', async () => {
      await controller.updatePaymentMethod(user, '3', { label: 'Visa' });

      expect(service.updatePaymentMethod).toHaveBeenCalledWith(42, 3, {
        label: 'Visa',
      });
    });

    it('elimina un método de pago convirtiendo el id', async () => {
      await controller.deletePaymentMethod(user, '3');

      expect(service.deletePaymentMethod).toHaveBeenCalledWith(42, 3);
    });

    it('marca un método de pago como predeterminado', async () => {
      await controller.setDefaultPaymentMethod(user, '3');

      expect(service.setDefaultPaymentMethod).toHaveBeenCalledWith(42, 3);
    });
  });
});
