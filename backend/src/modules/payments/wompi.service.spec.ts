import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { WompiService } from './wompi.service';
import { createConfigMock } from '../../../test/helpers/db-mock';
import type { ConfigService } from '@nestjs/config';

const BASE_CONFIG: Record<string, unknown> = {
  'wompi.publicKey': 'pub_test_key',
  'wompi.privateKey': 'priv_test_key',
  'wompi.integrityKey': 'integrity_test_key',
  'wompi.apiUrl': 'https://wompi.test/v1',
  'wompi.redirectUrl': 'https://tienda.test/pago',
};

function makeService(overrides: Record<string, unknown> = {}) {
  const config = createConfigMock({ ...BASE_CONFIG, ...overrides });
  return {
    config,
    service: new WompiService(config as unknown as ConfigService),
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

function expectedSignature(reference: string, amount: number, key = 'integrity_test_key') {
  return createHash('sha256')
    .update(`${reference}${amount}COP${key}`)
    .digest('hex');
}

describe('WompiService', () => {
  let fetchMock: Mock;
  let service: WompiService;
  let config: ReturnType<typeof createConfigMock>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ({ service, config } = makeService());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('config', () => {
    it('usa valores por defecto para la URL de la API y la redirección', () => {
      const { service: bare } = makeService({
        'wompi.apiUrl': undefined,
        'wompi.redirectUrl': undefined,
      });

      expect(bare.config.apiUrl).toBe('https://sandbox.wompi.co/v1');
      expect(bare.config.redirectUrl).toBe('');
      expect(bare.config.publicKey).toBe('pub_test_key');
    });
  });

  describe('getAcceptanceData', () => {
    it('consulta el comercio y mapea los tokens de aceptación', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: {
            presigned_acceptance: {
              acceptance_token: 'acc-token',
              permalink: 'https://wompi.test/acc',
            },
            presigned_personal_data_auth: {
              acceptance_token: 'personal-token',
              permalink: 'https://wompi.test/personal',
            },
          },
        }),
      );

      const result = await service.getAcceptanceData();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://wompi.test/v1/merchants/pub_test_key',
      );
      expect(result).toEqual({
        publicKey: 'pub_test_key',
        redirectUrl: 'https://tienda.test/pago',
        acceptanceToken: 'acc-token',
        acceptancePermalink: 'https://wompi.test/acc',
        personalDataAuthToken: 'personal-token',
        personalDataAuthPermalink: 'https://wompi.test/personal',
      });
    });

    it('devuelve null cuando Wompi no envía los tokens', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));

      await expect(service.getAcceptanceData()).resolves.toMatchObject({
        acceptanceToken: null,
        acceptancePermalink: null,
        personalDataAuthToken: null,
        personalDataAuthPermalink: null,
      });
    });

    it('no llama a Wompi si falta la public key', async () => {
      const { service: unconfigured } = makeService({
        'wompi.publicKey': '',
      });

      await expect(unconfigured.getAcceptanceData()).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(unconfigured.getAcceptanceData()).rejects.toThrow(
        'Wompi public key no configurada',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falla si Wompi responde con un error HTTP', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 401));

      await expect(service.getAcceptanceData()).rejects.toThrow(
        'No se pudo obtener la configuracion de Wompi',
      );
    });

    it('propaga los errores de red', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(service.getAcceptanceData()).rejects.toThrow('ECONNRESET');
    });
  });

  describe('validateConfiguration', () => {
    it('exige la public key', async () => {
      const { service: missing } = makeService({ 'wompi.publicKey': '' });

      await expect(missing.validateConfiguration()).rejects.toThrow(
        'falta la public key',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('exige la private key', async () => {
      const { service: missing } = makeService({ 'wompi.privateKey': '' });

      await expect(missing.validateConfiguration()).rejects.toThrow(
        'falta la private key',
      );
    });

    it('exige la integrity key', async () => {
      const { service: missing } = makeService({ 'wompi.integrityKey': '' });

      await expect(missing.validateConfiguration()).rejects.toThrow(
        'falta la integrity key',
      );
    });

    it('envuelve los errores inesperados de red', async () => {
      fetchMock.mockRejectedValueOnce(new Error('boom'));

      await expect(service.validateConfiguration()).rejects.toThrow(
        'No se pudo validar Wompi: boom',
      );
    });

    it('propaga el BadRequestException de getAcceptanceData', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 403));

      await expect(service.validateConfiguration()).rejects.toThrow(
        'No se pudo obtener la configuracion de Wompi',
      );
    });

    it('rechaza la configuración si no llega el token de aceptación', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));

      await expect(service.validateConfiguration()).rejects.toThrow(
        'Wompi rechazó la public key o no devolvió el token de aceptación.',
      );
    });

    it('acepta la configuración cuando Wompi devuelve el token', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: {
            presigned_acceptance: { acceptance_token: 'acc-token' },
          },
        }),
      );

      await expect(service.validateConfiguration()).resolves.toBeUndefined();
    });
  });

  describe('generateIntegritySignature', () => {
    it('calcula sha256(reference + amount + currency + integrityKey)', () => {
      const signature = service.generateIntegritySignature('REF-1', 10000, 'COP');

      expect(signature).toBe(expectedSignature('REF-1', 10000));
    });

    it('exige la integrity key', async () => {
      const { service: missing } = makeService({ 'wompi.integrityKey': '' });

      expect(() => missing.generateIntegritySignature('REF', 1, 'COP')).toThrow(
        'Wompi integrity key no configurada',
      );
    });
  });

  describe('createCardTransaction', () => {
    const params = {
      amountInCents: 2500000,
      customerEmail: 'cliente@test.local',
      reference: 'MER-9001',
      acceptanceToken: 'acc-token',
      acceptPersonalAuth: 'personal-token',
      cardToken: 'card-token',
      installments: 3,
      customerData: { phone_number: '3001234567', full_name: 'Ada Lovelace' },
    };

    it('exige la private key antes de llamar a Wompi', async () => {
      const { service: missing } = makeService({ 'wompi.privateKey': '' });

      await expect(
        missing.createCardTransaction(params),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('envía la transacción con autorización Bearer, firma y payload completo', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { id: 'tx-1', status: 'PENDING' } }),
      );

      const result = await service.createCardTransaction(params);

      expect(result).toEqual({ id: 'tx-1', status: 'PENDING' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://wompi.test/v1/transactions');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        Authorization: 'Bearer priv_test_key',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        acceptance_token: 'acc-token',
        accept_personal_auth: 'personal-token',
        amount_in_cents: 2500000,
        currency: 'COP',
        customer_email: 'cliente@test.local',
        payment_method_type: 'CARD',
        payment_method: {
          type: 'CARD',
          token: 'card-token',
          installments: 3,
        },
        reference: 'MER-9001',
        signature: expectedSignature('MER-9001', 2500000),
        redirect_url: 'https://tienda.test/pago',
        customer_data: {
          phone_number: '3001234567',
          full_name: 'Ada Lovelace',
        },
      });
    });

    it('respeta el redirectUrl explícito del pago', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'tx-2' } }));

      await service.createCardTransaction({
        ...params,
        redirectUrl: 'https://otra.test/retorno',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.redirect_url).toBe('https://otra.test/retorno');
    });

    it('usa el motivo de error que devuelve Wompi', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { error: { reason: 'Fondos insuficientes' } },
          false,
          422,
        ),
      );

      await expect(service.createCardTransaction(params)).rejects.toThrow(
        'Fondos insuficientes',
      );
    });

    it('usa los mensajes de error de Wompi cuando no hay reason', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { error: { messages: ['card declined', 'retry later'] } },
          false,
          422,
        ),
      );

      const error = await service
        .createCardTransaction(params)
        .catch((err) => err);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({
        message: ['card declined', 'retry later'],
      });
    });

    it('usa un mensaje genérico si Wompi no detalla el error', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));

      await expect(service.createCardTransaction(params)).rejects.toThrow(
        'No se pudo crear la transaccion con Wompi',
      );
    });
  });

  describe('getTransaction', () => {
    it('usa la llave privada cuando está configurada', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { id: 'tx-1', status: 'APPROVED' } }),
      );

      const result = await service.getTransaction('tx-1');

      expect(result).toEqual({ data: { id: 'tx-1', status: 'APPROVED' } });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://wompi.test/v1/transactions/tx-1',
        { headers: { Authorization: 'Bearer priv_test_key' } },
      );
    });

    it('cae a la llave pública cuando no hay llave privada', async () => {
      const { service: publicOnly } = makeService({
        'wompi.privateKey': '',
        'wompi.publicKey': 'pub_only_key',
      });
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'tx-2' } }));

      await publicOnly.getTransaction('tx-2');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://wompi.test/v1/transactions/tx-2',
        { headers: { Authorization: 'Bearer pub_only_key' } },
      );
    });

    it('lanza si no hay ninguna llave configurada', async () => {
      const { service: unconfigured } = makeService({
        'wompi.privateKey': '',
        'wompi.publicKey': '',
      });

      await expect(unconfigured.getTransaction('tx-3')).rejects.toThrow(
        'Wompi no está configurado (falta llave privada y pública)',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('createBreBTransaction', () => {
    const params = {
      amountInCents: 150000,
      customerEmail: 'cliente@test.local',
      reference: 'BREB-1',
      customerData: { phone_number: '3001234567' },
    };

    it('exige la private key', async () => {
      const { service: missing } = makeService({ 'wompi.privateKey': '' });

      await expect(
        missing.createBreBTransaction(params),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('crea la transacción PSE con firma y redirect por defecto', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { id: 'breb-1', status: 'PENDING' } }),
      );

      const result = await service.createBreBTransaction(params);

      expect(result).toEqual({ id: 'breb-1', status: 'PENDING' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://wompi.test/v1/transactions');
      expect(init.headers.Authorization).toBe('Bearer priv_test_key');

      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        amount_in_cents: 150000,
        currency: 'COP',
        customer_email: 'cliente@test.local',
        payment_method_type: 'PSE',
        payment_method: { type: 'PSE' },
        reference: 'BREB-1',
        signature: expectedSignature('BREB-1', 150000),
        redirect_url: 'https://tienda.test/pago',
        customer_data: { phone_number: '3001234567' },
      });
    });

    it('omite customer_data cuando no se envía', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'breb-2' } }));

      await service.createBreBTransaction({
        amountInCents: 1000,
        customerEmail: 'a@b.co',
        reference: 'BREB-2',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.customer_data).toBeUndefined();
    });

    it('respeta el redirectUrl explícito', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'breb-3' } }));

      await service.createBreBTransaction({
        ...params,
        redirectUrl: 'https://otra.test/breb',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.redirect_url).toBe('https://otra.test/breb');
    });

    it('propaga el reason de error de Wompi', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { reason: 'Referencia duplicada' } }, false, 409),
      );

      await expect(
        service.createBreBTransaction(params),
      ).rejects.toThrow('Referencia duplicada');
    });

    it('usa un mensaje genérico si no hay detalle del error', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));

      await expect(
        service.createBreBTransaction(params),
      ).rejects.toThrow('No se pudo crear la transacción Bre-B con Wompi');
    });
  });
});
