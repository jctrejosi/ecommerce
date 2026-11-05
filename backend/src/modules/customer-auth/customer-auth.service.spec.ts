import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CustomerAuthService } from './customer-auth.service';
import { createConfigMock, createDbMock } from '../../../test/helpers/db-mock';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';

const PASSWORD = 'cliente123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const BASE_CONFIG: Record<string, unknown> = {
  CUSTOMER_JWT_SECRET: 'customer-secret',
  CUSTOMER_JWT_EXPIRES_IN: '7d',
  CUSTOMER_JWT_REFRESH_EXPIRES_IN: '30d',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  GOOGLE_REDIRECT_URI: 'https://tienda.test/auth/google/callback',
  GOOGLE_REDIRECT_URIS: 'https://staging.test/cb,https://otra.test/cb',
};

function makeCustomer(overrides: Record<string, any> = {}) {
  return {
    id: 42n,
    email: 'cliente@test.local',
    passwordHash: PASSWORD_HASH,
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '3001234567',
    documentNumber: null,
    documentType: null,
    avatarUrl: null,
    provider: 'local',
    providerId: null,
    emailVerified: true,
    isVerified: true,
    isActive: true,
    acceptsMarketing: false,
    customerType: 'registered',
    lastLoginAt: null,
    lastActivityAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) } as any;
}

function futureIso(days = 30) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe('CustomerAuthService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let jwt: { sign: Mock; verify: Mock };
  let config: ReturnType<typeof createConfigMock>;
  let service: CustomerAuthService;
  let fetchMock: Mock;

  function makeService(overrides: Record<string, unknown> = {}) {
    const cfg = createConfigMock({ ...BASE_CONFIG, ...overrides });
    return {
      config: cfg,
      service: new CustomerAuthService(
        mock.drizzle as any,
        jwt as unknown as JwtService,
        cfg as unknown as ConfigService,
      ),
    };
  }

  beforeEach(() => {
    mock = createDbMock();
    jwt = {
      sign: vi.fn((payload: unknown, opts?: unknown) =>
        opts ? 'refresh-token' : 'access-token',
      ),
      verify: vi.fn(),
    };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ({ config, service } = makeService());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Credenciales ──

  describe('validateCustomer', () => {
    it('devuelve el cliente y actualiza las marcas de actividad', async () => {
      const customer = makeCustomer();
      mock.queueSelectOne(customer);

      const result = await service.validateCustomer(
        'cliente@test.local',
        PASSWORD,
      );

      expect(result).toBe(customer);
      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toMatchObject({
        lastLoginAt: expect.any(String),
        lastActivityAt: expect.any(String),
      });
    });

    it('devuelve null si el cliente no existe', async () => {
      mock.queueSelect([]);

      await expect(
        service.validateCustomer('nadie@test.local', PASSWORD),
      ).resolves.toBeNull();
      expect(mock.state.updates).toHaveLength(0);
    });

    it('devuelve null si el cliente está inactivo', async () => {
      mock.queueSelectOne(makeCustomer({ isActive: false }));

      await expect(
        service.validateCustomer('cliente@test.local', PASSWORD),
      ).resolves.toBeNull();
      expect(mock.state.updates).toHaveLength(0);
    });

    it('devuelve null si el cliente no tiene contraseña local', async () => {
      mock.queueSelectOne(makeCustomer({ passwordHash: null }));

      await expect(
        service.validateCustomer('cliente@test.local', PASSWORD),
      ).resolves.toBeNull();
      expect(mock.state.updates).toHaveLength(0);
    });

    it('devuelve null si la contraseña es incorrecta', async () => {
      mock.queueSelectOne(makeCustomer());

      await expect(
        service.validateCustomer('cliente@test.local', 'incorrecta'),
      ).resolves.toBeNull();
      expect(mock.state.updates).toHaveLength(0);
    });
  });

  describe('register', () => {
    const dto = {
      email: 'cliente@test.local',
      password: PASSWORD,
      firstName: 'Ada',
      lastName: 'Lovelace',
      acceptsTerms: true,
      acceptsMarketing: false,
    };

    it('exige aceptar los términos', async () => {
      await expect(
        service.register({ ...dto, acceptsTerms: false } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mock.db.select).not.toHaveBeenCalled();
    });

    it('rechaza un email ya registrado', async () => {
      mock.queueSelectOne({ id: 1n });

      await expect(service.register(dto as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('crea el cliente con hash de contraseña y emite tokens', async () => {
      const customer = makeCustomer();
      mock.queueSelect([]);
      mock.queueInsert([customer]);

      const result = await service.register(dto as any);

      const insert = mock.state.inserts[0].values as any;
      expect(insert.email).toBe('cliente@test.local');
      expect(insert.passwordHash).not.toBe(PASSWORD);
      await expect(
        bcrypt.compare(PASSWORD, insert.passwordHash),
      ).resolves.toBe(true);
      expect(insert).toMatchObject({
        provider: 'local',
        customerType: 'registered',
        isVerified: false,
        isActive: true,
        acceptsMarketing: false,
      });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.expiresIn).toBe(7 * 86400);
      expect(result.customer).toMatchObject({
        id: 42,
        email: 'cliente@test.local',
        fullName: 'Ada Lovelace',
        isVerified: true,
      });
    });

    it('sincroniza el newsletter cuando acepta marketing', async () => {
      const customer = makeCustomer({ acceptsMarketing: true });
      mock.queueSelect([]); // búsqueda por email
      mock.queueInsert([customer]);
      mock.queueSelectOne(customer); // sync: cliente
      mock.queueSelect([]); // sync: suscriptor no existe

      await service.register({ ...dto, acceptsMarketing: true } as any);

      const newsletterInsert = mock.state.inserts[1].values as any;
      expect(newsletterInsert).toEqual({
        email: 'cliente@test.local',
        name: 'Ada Lovelace',
        acceptedTerms: true,
        isActive: true,
      });
    });

    it('no toca el newsletter si no acepta marketing', async () => {
      mock.queueSelect([]);
      mock.queueInsert([makeCustomer()]);

      await service.register(dto as any);

      // customer + refresh token
      expect(mock.state.inserts).toHaveLength(2);
    });
  });

  describe('login', () => {
    it('rechaza credenciales inválidas', async () => {
      vi.spyOn(service, 'validateCustomer').mockResolvedValue(null);

      await expect(
        service.login({ email: 'x@test.local', password: 'mala' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('emite access y refresh token para credenciales válidas', async () => {
      const customer = makeCustomer();
      vi.spyOn(service, 'validateCustomer').mockResolvedValue(customer as any);

      const result = await service.login({
        email: 'cliente@test.local',
        password: PASSWORD,
      } as any);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.expiresIn).toBe(604800);
      expect(jwt.sign).toHaveBeenNthCalledWith(1, {
        sub: 42,
        email: 'cliente@test.local',
        type: 'customer',
      });

      const refreshInsert = mock.state.inserts[0].values as any;
      expect(refreshInsert.customerId).toBe(42);
      expect(refreshInsert.token).toBe('refresh-token');
      const days =
        (new Date(refreshInsert.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThan(31);
    });

    it('firma el refresh con jti, secreto propio y expiración configurada', async () => {
      vi.spyOn(service, 'validateCustomer').mockResolvedValue(
        makeCustomer() as any,
      );

      await service.login({
        email: 'cliente@test.local',
        password: PASSWORD,
      } as any);

      const [payload, options] = jwt.sign.mock.calls[1];
      expect(payload).toMatchObject({
        sub: 42,
        email: 'cliente@test.local',
        type: 'customer',
        jti: expect.any(String),
      });
      expect(options).toEqual({
        secret: 'customer-secret',
        expiresIn: 30 * 86400,
      });
    });

    it('interpreta la expiración del access token en horas', async () => {
      const { service: hourly } = makeService({
        CUSTOMER_JWT_EXPIRES_IN: '2h',
      });
      vi.spyOn(hourly, 'validateCustomer').mockResolvedValue(
        makeCustomer() as any,
      );

      const result = await hourly.login({
        email: 'cliente@test.local',
        password: PASSWORD,
      } as any);

      expect(result.expiresIn).toBe(7200);
    });
  });

  describe('refreshToken', () => {
    it('rechaza un token vacío', async () => {
      await expect(service.refreshToken('')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rechaza un token que no está almacenado', async () => {
      mock.queueSelect([]);

      await expect(service.refreshToken('no-existe')).rejects.toThrow(
        'Refresh token inválido',
      );
    });

    it('rechaza un token revocado', async () => {
      mock.queueSelectOne({
        id: 1n,
        customerId: 42,
        token: 'r',
        expiresAt: futureIso(),
        revoked: true,
      });

      await expect(service.refreshToken('r')).rejects.toThrow(
        'Refresh token revocado',
      );
    });

    it('elimina y rechaza un token expirado', async () => {
      mock.queueSelectOne({
        id: 1n,
        customerId: 42,
        token: 'r',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        revoked: false,
      });

      await expect(service.refreshToken('r')).rejects.toThrow(
        'Refresh token expirado',
      );
      expect(mock.state.deletes).toHaveLength(1);
    });

    it('rechaza un JWT cuyo tipo no es customer', async () => {
      mock.queueSelectOne({
        id: 1n,
        customerId: 42,
        token: 'r',
        expiresAt: futureIso(),
        revoked: false,
      });
      jwt.verify.mockReturnValue({ sub: 42, type: 'admin' });

      await expect(service.refreshToken('r')).rejects.toThrow(
        'Refresh token inválido',
      );
    });

    it('revoca todos los tokens si el cliente ya no es válido', async () => {
      mock.queueSelectOne({
        id: 1n,
        customerId: 42,
        token: 'r',
        expiresAt: futureIso(),
        revoked: false,
      });
      jwt.verify.mockReturnValue({ sub: 42, type: 'customer' });
      mock.queueSelectOne(makeCustomer({ isActive: false }));

      await expect(service.refreshToken('r')).rejects.toThrow(
        'Cliente no válido',
      );
      expect(mock.state.updates[0].values).toEqual({ revoked: true });
    });

    it('emite un nuevo access token para un cliente activo', async () => {
      mock.queueSelectOne({
        id: 1n,
        customerId: 42,
        token: 'r',
        expiresAt: futureIso(),
        revoked: false,
      });
      jwt.verify.mockReturnValue({
        sub: 42,
        email: 'cliente@test.local',
        type: 'customer',
      });
      mock.queueSelectOne(makeCustomer());

      const result = await service.refreshToken('r');

      expect(result).toEqual({ accessToken: 'access-token', expiresIn: 604800 });
      expect(jwt.verify).toHaveBeenCalledWith('r', { secret: 'customer-secret' });
      expect(jwt.sign).toHaveBeenCalledWith({
        sub: 42,
        email: 'cliente@test.local',
        type: 'customer',
      });
    });

    it('rechaza si el JWT no se puede verificar', async () => {
      mock.queueSelectOne({
        id: 1n,
        customerId: 42,
        token: 'r',
        expiresAt: futureIso(),
        revoked: false,
      });
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(service.refreshToken('r')).rejects.toThrow('jwt malformed');
    });
  });

  // ── Google / social ──

  describe('socialLoginWithGoogleCode', () => {
    const authResponse = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 604800,
      customer: { id: 42 },
    };

    function bodyOf(callIndex = 0) {
      const body = fetchMock.mock.calls[callIndex][1].body as URLSearchParams;
      return Object.fromEntries(body.entries());
    }

    it('exige que Google esté configurado en el servidor', async () => {
      const { service: unconfigured } = makeService({
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
      });

      await expect(
        unconfigured.socialLoginWithGoogleCode({ code: 'abc' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('intercambia el code usando el redirect configurado', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at-1' }));
      vi.spyOn(service, 'socialLogin').mockResolvedValue(authResponse as any);

      const result = await service.socialLoginWithGoogleCode({
        code: 'code-1',
      } as any);

      expect(result).toBe(authResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
      expect(bodyOf()).toEqual({
        code: 'code-1',
        client_id: 'google-client-id',
        client_secret: 'google-client-secret',
        redirect_uri: 'https://tienda.test/auth/google/callback',
        grant_type: 'authorization_code',
      });
      expect(service.socialLogin).toHaveBeenCalledWith({
        provider: 'google',
        accessToken: 'at-1',
      });
    });

    it('acepta un redirect_uri de la lista extra', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at-2' }));
      vi.spyOn(service, 'socialLogin').mockResolvedValue(authResponse as any);

      await service.socialLoginWithGoogleCode({
        code: 'code-2',
        redirectUri: 'https://otra.test/cb',
      } as any);

      expect(bodyOf().redirect_uri).toBe('https://otra.test/cb');
    });

    it('acepta el loopback de desarrollo', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at-3' }));
      vi.spyOn(service, 'socialLogin').mockResolvedValue(authResponse as any);

      await service.socialLoginWithGoogleCode({
        code: 'code-3',
        redirectUri: 'http://localhost:4173',
      } as any);

      expect(bodyOf().redirect_uri).toBe('http://localhost:4173');
    });

    it('acepta el origen de la propia petición', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at-4' }));
      vi.spyOn(service, 'socialLogin').mockResolvedValue(authResponse as any);

      await service.socialLoginWithGoogleCode(
        { code: 'code-4', redirectUri: 'https://app.tienda.test' } as any,
        'https://app.tienda.test/checkout',
      );

      expect(bodyOf().redirect_uri).toBe('https://app.tienda.test');
    });

    it('rechaza un redirect_uri arbitrario sin llamar a Google', async () => {
      await expect(
        service.socialLoginWithGoogleCode({
          code: 'code-5',
          redirectUri: 'https://evil.test/steal',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no deja que un origen válido autorice otro candidato', async () => {
      await expect(
        service.socialLoginWithGoogleCode(
          { code: 'code-6', redirectUri: 'https://evil.test/steal' } as any,
          'https://tienda.test',
        ),
      ).rejects.toThrow('redirect_uri no permitido');
    });

    it('rechaza un intercambio fallido', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 400));

      await expect(
        service.socialLoginWithGoogleCode({ code: 'bad' } as any),
      ).rejects.toThrow('Código de Google inválido o expirado');
    });

    it('rechaza una respuesta sin access_token', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));

      await expect(
        service.socialLoginWithGoogleCode({ code: 'code-7' } as any),
      ).rejects.toThrow('Google no devolvió un token de acceso');
    });
  });

  describe('socialLogin (google)', () => {
    function googleTokenInfo(overrides: Record<string, unknown> = {}) {
      return jsonResponse({
        aud: 'google-client-id',
        sub: 'google-sub',
        email: 'google@test.local',
        ...overrides,
      });
    }

    it('rechaza un token de Google inválido', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 401));

      await expect(
        service.socialLogin({
          provider: 'google',
          accessToken: 'bad',
        } as any),
      ).rejects.toThrow('Token de Google inválido');
    });

    it('rechaza un token de otro cliente OAuth', async () => {
      fetchMock.mockResolvedValueOnce(googleTokenInfo({ aud: 'otro-cliente' }));

      await expect(
        service.socialLogin({
          provider: 'google',
          accessToken: 'at',
        } as any),
      ).rejects.toThrow('Token de Google inválido para este cliente');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('acepta azp cuando no hay aud', async () => {
      fetchMock
        .mockResolvedValueOnce(
          googleTokenInfo({ aud: undefined, azp: 'google-client-id' }),
        )
        .mockResolvedValueOnce(jsonResponse({}, false, 500));
      mock.queueSelect([]);
      mock.queueSelect([]);
      mock.queueInsert([makeCustomer({ provider: 'google' })]);

      await expect(
        service.socialLogin({
          provider: 'google',
          accessToken: 'at',
        } as any),
      ).resolves.toMatchObject({ accessToken: 'access-token' });
    });

    it('exige que Google devuelva un email', async () => {
      fetchMock.mockResolvedValueOnce(googleTokenInfo({ email: undefined }));

      await expect(
        service.socialLogin({
          provider: 'google',
          accessToken: 'at',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('registra un cliente nuevo con los datos de Google', async () => {
      fetchMock
        .mockResolvedValueOnce(googleTokenInfo())
        .mockResolvedValueOnce(
          jsonResponse({
            sub: 'google-sub',
            email: 'google@test.local',
            name: 'Ada Lovelace',
            picture: 'https://img.test/ada.png',
          }),
        );
      mock.queueSelect([]); // por provider
      mock.queueSelect([]); // por email
      mock.queueInsert([
        makeCustomer({
          provider: 'google',
          providerId: 'google-sub',
          avatarUrl: 'https://img.test/ada.png',
        }),
      ]);

      const result = await service.socialLogin({
        provider: 'google',
        accessToken: 'at',
      } as any);

      const insert = mock.state.inserts[0].values as any;
      expect(insert).toMatchObject({
        email: 'google@test.local',
        provider: 'google',
        providerId: 'google-sub',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avatarUrl: 'https://img.test/ada.png',
        emailVerified: true,
        isVerified: true,
        isActive: true,
      });
      expect(result.customer.provider).toBe('google');
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://www.googleapis.com/oauth2/v3/userinfo',
      );
      expect(fetchMock.mock.calls[1][1]).toEqual({
        headers: { Authorization: 'Bearer at' },
      });
    });

    it('reutiliza el cliente existente vinculado al provider', async () => {
      fetchMock
        .mockResolvedValueOnce(googleTokenInfo())
        .mockResolvedValueOnce(jsonResponse({}));
      mock.queueSelectOne(
        makeCustomer({ provider: 'google', providerId: 'google-sub' }),
      );

      const result = await service.socialLogin({
        provider: 'google',
        accessToken: 'at',
      } as any);

      expect(result.customer.id).toBe(42);
      expect(mock.state.inserts).toHaveLength(1); // solo el refresh token
      expect(mock.state.updates[0].values).toMatchObject({
        lastLoginAt: expect.any(String),
      });
    });

    it('rechaza un cliente existente inactivo', async () => {
      fetchMock
        .mockResolvedValueOnce(googleTokenInfo())
        .mockResolvedValueOnce(jsonResponse({}));
      mock.queueSelectOne(
        makeCustomer({
          provider: 'google',
          providerId: 'google-sub',
          isActive: false,
        }),
      );

      await expect(
        service.socialLogin({
          provider: 'google',
          accessToken: 'at',
        } as any),
      ).rejects.toThrow('Cliente inactivo');
    });

    it('vincula el provider a un cliente existente por email', async () => {
      fetchMock
        .mockResolvedValueOnce(googleTokenInfo())
        .mockResolvedValueOnce(
          jsonResponse({ name: 'Ada Lovelace', picture: 'https://img.test/a.png' }),
        );
      mock.queueSelect([]); // por provider
      mock.queueSelectOne(makeCustomer()); // por email

      await service.socialLogin({
        provider: 'google',
        accessToken: 'at',
      } as any);

      expect(mock.state.updates[0].values).toMatchObject({
        provider: 'google',
        providerId: 'google-sub',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avatarUrl: 'https://img.test/a.png',
        emailVerified: true,
        isVerified: true,
      });
      expect(mock.state.updates[1].values).toMatchObject({
        lastLoginAt: expect.any(String),
      });
    });
  });

  describe('socialLogin (facebook)', () => {
    it('exige email para registrar un cliente nuevo', async () => {
      await expect(
        service.socialLogin({
          provider: 'facebook',
          accessToken: 'at',
        } as any),
      ).rejects.toThrow(
        'El email es obligatorio para registrar un nuevo cliente social',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('registra un cliente nuevo repartiendo el nombre', async () => {
      mock.queueSelect([]);
      mock.queueInsert([makeCustomer({ provider: 'facebook' })]);

      await service.socialLogin({
        provider: 'facebook',
        accessToken: 'at',
        email: 'fb@test.local',
        name: 'Ana María Pérez',
      } as any);

      expect(mock.state.inserts[0].values).toMatchObject({
        email: 'fb@test.local',
        provider: 'facebook',
        firstName: 'Ana',
        lastName: 'María Pérez',
      });
    });
  });

  // ── Perfil ──

  describe('getProfile', () => {
    it('lanza NotFound si el cliente no existe', async () => {
      mock.queueSelect([]);

      await expect(service.getProfile(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('mapea el perfil y calcula el nombre completo', async () => {
      mock.queueSelectOne(makeCustomer());

      await expect(service.getProfile(42)).resolves.toMatchObject({
        id: 42,
        email: 'cliente@test.local',
        fullName: 'Ada Lovelace',
        phone: '3001234567',
        isVerified: true,
        isActive: true,
        provider: 'local',
      });
    });

    it('usa "Cliente" cuando no hay nombre', async () => {
      mock.queueSelectOne(makeCustomer({ firstName: null, lastName: null }));

      await expect(service.getProfile(42)).resolves.toMatchObject({
        fullName: 'Cliente',
      });
    });
  });

  describe('updateProfile', () => {
    it('actualiza los campos enviados y rehashea la contraseña', async () => {
      mock.queueUpdate();
      mock.queueSelectOne(makeCustomer({ firstName: 'Grace' }));

      const result = await service.updateProfile(42, {
        firstName: 'Grace',
        phone: '3110000000',
        password: 'nueva123',
      });

      const update = mock.state.updates[0].values as any;
      expect(update).toMatchObject({
        firstName: 'Grace',
        phone: '3110000000',
        updatedAt: expect.any(String),
      });
      expect(update.passwordHash).not.toBe('nueva123');
      await expect(
        bcrypt.compare('nueva123', update.passwordHash),
      ).resolves.toBe(true);
      expect(result.fullName).toBe('Grace Lovelace');
    });

    it('no escribe campos no enviados', async () => {
      mock.queueUpdate();
      mock.queueSelectOne(makeCustomer());

      await service.updateProfile(42, { lastName: 'Byron' });

      const update = mock.state.updates[0].values as any;
      expect(update).toEqual({
        lastName: 'Byron',
        updatedAt: expect.any(String),
      });
    });

    it('activa la suscripción al newsletter al aceptar marketing', async () => {
      mock.queueUpdate(); // clientes
      mock.queueSelectOne(makeCustomer()); // sync: cliente
      mock.queueSelect([]); // sync: no suscriptor
      mock.queueSelectOne(makeCustomer()); // getProfile

      await service.updateProfile(42, { acceptsMarketing: true });

      expect(mock.state.inserts[0].values).toMatchObject({
        email: 'cliente@test.local',
        isActive: true,
        acceptedTerms: true,
      });
    });

    it('da de baja el newsletter al desactivar marketing', async () => {
      mock.queueUpdate(); // clientes
      mock.queueSelectOne(makeCustomer()); // sync: cliente
      mock.queueSelectOne({ id: 7n, name: 'Ada', isActive: true }); // suscriptor
      mock.queueUpdate(); // baja
      mock.queueSelectOne(makeCustomer()); // getProfile

      await service.updateProfile(42, { acceptsMarketing: false });

      expect(mock.state.updates[1].values).toMatchObject({ isActive: false });
    });
  });

  describe('setPushToken', () => {
    it('guarda el token recortado', async () => {
      mock.queueUpdate();

      await expect(service.setPushToken(42, '  fcm-token  ')).resolves.toEqual({
        success: true,
      });
      expect(mock.state.updates[0].values).toMatchObject({
        pushToken: 'fcm-token',
      });
    });

    it('limpia el token si viene vacío', async () => {
      mock.queueUpdate();

      await service.setPushToken(42, '   ');

      expect(mock.state.updates[0].values).toMatchObject({ pushToken: null });
    });

    it('limpia el token si es null', async () => {
      mock.queueUpdate();

      await service.setPushToken(42, null);

      expect(mock.state.updates[0].values).toMatchObject({ pushToken: null });
    });
  });

  describe('deleteAccount', () => {
    it('da de baja el newsletter y hace soft delete', async () => {
      mock.queueSelectOne(makeCustomer());
      mock.queueSelectOne({ id: 5n, isActive: true });
      mock.queueUpdate(); // baja newsletter
      mock.queueUpdate(); // soft delete cliente

      const result = await service.deleteAccount(42);

      expect(result).toEqual({
        success: true,
        message: 'Cuenta eliminada exitosamente',
      });
      const customerUpdate = mock.state.updates[1].values as any;
      expect(customerUpdate).toMatchObject({
        isActive: false,
        deletedAt: expect.any(String),
      });
    });
  });

  describe('logout', () => {
    it('revoca solo el refresh token indicado', async () => {
      mock.queueUpdate();

      await expect(service.logout(42, 'refresh-token')).resolves.toEqual({
        success: true,
        message: 'Sesión cerrada exitosamente',
      });
      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toEqual({ revoked: true });
    });

    it('revoca todos los tokens del cliente si no se indica ninguno', async () => {
      mock.queueUpdate();

      await service.logout(42);

      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toEqual({ revoked: true });
    });
  });

  // ── Direcciones ──

  describe('getAddresses', () => {
    it('mapea las direcciones del cliente', async () => {
      mock.queueSelect([
        {
          id: 9n,
          alias: 'Casa',
          addressLine1: 'Calle 1',
          addressLine2: null,
          city: 'Bogotá',
          state: null,
          country: 'CO',
          deliveryInstructions: null,
          reference: null,
          isDefault: true,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]);

      await expect(service.getAddresses(42)).resolves.toEqual([
        {
          id: 9,
          alias: 'Casa',
          addressLine1: 'Calle 1',
          addressLine2: null,
          city: 'Bogotá',
          state: null,
          country: 'CO',
          deliveryInstructions: null,
          reference: null,
          isDefault: true,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('createAddress', () => {
    it('marca la primera dirección como predeterminada', async () => {
      mock.queueSelectOne({ count: 0 });
      mock.queueUpdate();
      mock.queueInsert([{ id: 11n }]);

      await expect(
        service.createAddress(42, {
          addressLine1: 'Calle 1',
          city: 'Bogotá',
        }),
      ).resolves.toEqual({ id: 11 });

      expect(mock.state.updates[0].values).toEqual({ isDefault: false });
      expect(mock.state.inserts[0].values).toMatchObject({
        customerId: 42,
        addressLine1: 'Calle 1',
        city: 'Bogotá',
        isDefault: true,
      });
    });

    it('no desmarca las demás si no es predeterminada', async () => {
      mock.queueSelectOne({ count: 2 });
      mock.queueInsert([{ id: 12n }]);

      await service.createAddress(42, {
        addressLine1: 'Calle 2',
        city: 'Cali',
        isDefault: false,
      });

      expect(mock.state.updates).toHaveLength(0);
      expect(mock.state.inserts[0].values).toMatchObject({
        isDefault: false,
      });
    });
  });

  describe('updateAddress', () => {
    it('lanza NotFound si la dirección no pertenece al cliente', async () => {
      mock.queueSelect([]);

      await expect(
        service.updateAddress(42, 9, { city: 'Cali' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('desmarca las demás y actualiza la predeterminada', async () => {
      mock.queueSelectOne({ id: 9n });
      mock.queueUpdate(); // desmarcar
      mock.queueUpdate(); // actualizar

      await expect(
        service.updateAddress(42, 9, { city: 'Cali', isDefault: true }),
      ).resolves.toEqual({ id: 9 });

      expect(mock.state.updates[0].values).toEqual({ isDefault: false });
      expect(mock.state.updates[1].values).toMatchObject({
        city: 'Cali',
        isDefault: true,
      });
    });
  });

  describe('deleteAddress', () => {
    it('lanza NotFound si no existe', async () => {
      mock.queueSelect([]);

      await expect(service.deleteAddress(42, 9)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('promueve otra dirección cuando se borra la predeterminada', async () => {
      mock.queueSelectOne({ id: 9n, isDefault: true });
      mock.queueUpdate(); // soft delete
      mock.queueSelectOne({ id: 10n }); // siguiente
      mock.queueUpdate(); // promover

      await expect(service.deleteAddress(42, 9)).resolves.toEqual({
        success: true,
      });
      expect(mock.state.updates[0].values).toMatchObject({
        deletedAt: expect.any(String),
      });
      expect(mock.state.updates[1].values).toEqual({ isDefault: true });
    });

    it('no promueve nada si se borra una no predeterminada', async () => {
      mock.queueSelectOne({ id: 9n, isDefault: false });
      mock.queueUpdate();

      await service.deleteAddress(42, 9);

      expect(mock.state.updates).toHaveLength(1);
    });
  });

  describe('setDefaultAddress', () => {
    it('lanza NotFound si la dirección no es del cliente', async () => {
      mock.queueSelect([]);

      await expect(service.setDefaultAddress(42, 9)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('desmarca las demás y marca la indicada', async () => {
      mock.queueSelectOne({ id: 9n });
      mock.queueUpdate();
      mock.queueUpdate();

      await expect(service.setDefaultAddress(42, 9)).resolves.toEqual({
        success: true,
      });
      expect(mock.state.updates[0].values).toEqual({ isDefault: false });
      expect(mock.state.updates[1].values).toEqual({ isDefault: true });
    });
  });

  // ── Métodos de pago guardados ──

  describe('getPaymentMethods', () => {
    it('mapea los métodos guardados', async () => {
      mock.queueSelect([
        {
          id: 3n,
          methodType: 'CARD',
          label: 'Visa',
          brand: 'VISA',
          last4: '0326',
          cardholderName: 'ADA',
          phone: null,
          isDefault: true,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]);

      await expect(service.getPaymentMethods(42)).resolves.toEqual([
        {
          id: 3,
          methodType: 'CARD',
          label: 'Visa',
          brand: 'VISA',
          last4: '0326',
          cardholderName: 'ADA',
          phone: null,
          isDefault: true,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('createPaymentMethod', () => {
    it('rechaza un método deshabilitado por la tienda', async () => {
      mock.queueSelectOne({ value: { wompi: { enabled: false } } });

      await expect(
        service.createPaymentMethod(42, {
          methodType: 'CARD',
          token: 't',
          last4: '0326',
          brand: 'VISA',
        }),
      ).rejects.toThrow('Este medio de pago no está habilitado por la tienda');
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('exige los datos de tarjeta para CARD', async () => {
      mock.queueSelect([]);

      await expect(
        service.createPaymentMethod(42, { methodType: 'CARD', token: 't' }),
      ).rejects.toThrow('Faltan datos de la tarjeta');
    });

    it('exige teléfono para NEQUI', async () => {
      mock.queueSelect([]);

      await expect(
        service.createPaymentMethod(42, { methodType: 'NEQUI' }),
      ).rejects.toThrow('El número de Nequi es obligatorio');
    });

    it('guarda la tarjeta y desmarca la predeterminada anterior', async () => {
      mock.queueSelect([]);
      mock.queueUpdate();
      mock.queueInsert([{ id: 15n }]);

      await expect(
        service.createPaymentMethod(42, {
          methodType: 'CARD',
          token: 'tok',
          last4: '0326',
          brand: 'VISA',
          isDefault: true,
        }),
      ).resolves.toEqual({ id: 15 });

      expect(mock.state.updates[0].values).toEqual({ isDefault: false });
      expect(mock.state.inserts[0].values).toMatchObject({
        customerId: 42,
        methodType: 'CARD',
        token: 'tok',
        last4: '0326',
        brand: 'VISA',
        isDefault: true,
      });
    });

    it('guarda un método no predeterminado sin tocar los demás', async () => {
      mock.queueSelect([]);
      mock.queueInsert([{ id: 16n }]);

      await service.createPaymentMethod(42, {
        methodType: 'NEQUI',
        phone: '3001234567',
      });

      expect(mock.state.updates).toHaveLength(0);
      expect(mock.state.inserts[0].values).toMatchObject({
        methodType: 'NEQUI',
        phone: '3001234567',
        isDefault: false,
      });
    });
  });

  describe('updatePaymentMethod', () => {
    it('lanza NotFound si el método no es del cliente', async () => {
      mock.queueSelect([]);

      await expect(
        service.updatePaymentMethod(42, 3, { label: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('desmarca los demás y actualiza el método', async () => {
      mock.queueSelectOne({ id: 3n });
      mock.queueUpdate();
      mock.queueUpdate();

      await expect(
        service.updatePaymentMethod(42, 3, { label: 'Principal', isDefault: true }),
      ).resolves.toEqual({ id: 3 });
      expect(mock.state.updates[0].values).toEqual({ isDefault: false });
      expect(mock.state.updates[1].values).toMatchObject({
        label: 'Principal',
        isDefault: true,
      });
    });
  });

  describe('deletePaymentMethod', () => {
    it('lanza NotFound si el método no es del cliente', async () => {
      mock.queueSelect([]);

      await expect(service.deletePaymentMethod(42, 3)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hace soft delete del método', async () => {
      mock.queueSelectOne({ id: 3n });
      mock.queueUpdate();

      await expect(service.deletePaymentMethod(42, 3)).resolves.toEqual({
        success: true,
      });
      expect(mock.state.updates[0].values).toMatchObject({
        deletedAt: expect.any(String),
      });
    });
  });

  describe('setDefaultPaymentMethod', () => {
    it('lanza NotFound si el método no es del cliente', async () => {
      mock.queueSelect([]);

      await expect(
        service.setDefaultPaymentMethod(42, 3),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('desmarca los demás y marca el indicado', async () => {
      mock.queueSelectOne({ id: 3n });
      mock.queueUpdate();
      mock.queueUpdate();

      await expect(service.setDefaultPaymentMethod(42, 3)).resolves.toEqual({
        success: true,
      });
      expect(mock.state.updates[0].values).toEqual({ isDefault: false });
      expect(mock.state.updates[1].values).toEqual({ isDefault: true });
    });
  });
});
