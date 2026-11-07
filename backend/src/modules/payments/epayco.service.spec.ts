import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EpaycoService } from './epayco.service';
import { createConfigMock } from '../../../test/helpers/db-mock';
import type { ConfigService } from '@nestjs/config';

const BASE_CONFIG: Record<string, unknown> = {
  'epayco.publicKey': 'epayco_pub_key',
  'epayco.privateKey': 'epayco_priv_key',
  'epayco.apiUrl': 'https://epayco.test',
  'epayco.checkoutUrl': 'https://checkout.test/checkout.js',
  'epayco.test': true,
};

function makeService(overrides: Record<string, unknown> = {}) {
  const config = createConfigMock({ ...BASE_CONFIG, ...overrides });
  return {
    config,
    service: new EpaycoService(config as unknown as ConfigService),
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

describe('EpaycoService', () => {
  let fetchMock: Mock;
  let service: EpaycoService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ({ service } = makeService());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('getPublicConfig', () => {
    it('devuelve solo la configuración pública', () => {
      expect(service.getPublicConfig()).toEqual({
        publicKey: 'epayco_pub_key',
        checkoutUrl: 'https://checkout.test/checkout.js',
        test: true,
      });
    });

    it('exige la public key', () => {
      const { service: missing } = makeService({ 'epayco.publicKey': '' });

      expect(() => missing.getPublicConfig()).toThrow(
        'ePayco public key no configurada',
      );
    });

    it('usa los valores por defecto de URL', () => {
      const { service: bare } = makeService({
        'epayco.apiUrl': undefined,
        'epayco.checkoutUrl': undefined,
        'epayco.test': undefined,
      });

      expect(bare.config.apiUrl).toBe('https://api-secure.epayco.co');
      expect(bare.config.checkoutUrl).toBe('https://secure.payco.co/checkout.js');
      expect(bare.config.test).toBe(true);
    });
  });

  describe('createCardToken', () => {
    const params = {
      cardNumber: '4575623182290326',
      expYear: '2030',
      expMonth: '12',
      cvc: '123',
      cardHolder: 'ADA LOVELACE',
    };

    it('no llama a ePayco si falta alguna llave', async () => {
      const { service: missing } = makeService({ 'epayco.privateKey': '' });

      await expect(missing.createCardToken(params)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tokeniza la tarjeta y normaliza la respuesta', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: true,
          data: {
            token: 'tok_123',
            mask: '457562******0326',
            franchise: 'VISA',
          },
        }),
      );

      const result = await service.createCardToken(params);

      expect(result).toEqual({
        id: 'tok_123',
        last4: '0326',
        brand: 'VISA',
        raw: {
          token: 'tok_123',
          mask: '457562******0326',
          franchise: 'VISA',
        },
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://epayco.test/v1/tokens');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        public_key: 'epayco_pub_key',
        private_key: 'epayco_priv_key',
      });
      expect(JSON.parse(init.body)).toEqual({
        card: ['4575623182290326', '2030', '12', '123', 'ADA LOVELACE'],
      });
    });

    it('toma los últimos 4 del número si la respuesta no trae máscara', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: true, data: { id: 'tok_456' } }),
      );

      const result = await service.createCardToken(params);

      expect(result).toMatchObject({
        id: 'tok_456',
        last4: '0326',
        brand: 'card',
      });
    });

    it('rechaza la respuesta con status false', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: false, message: 'Tarjeta inválida' }),
      );

      await expect(service.createCardToken(params)).rejects.toThrow(
        'Tarjeta inválida',
      );
    });

    it('rechaza una respuesta HTTP no exitosa', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ message: 'Bad request' }, false, 400),
      );

      await expect(service.createCardToken(params)).rejects.toThrow(
        'Bad request',
      );
    });

    it('usa un mensaje genérico cuando no hay detalle', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));

      await expect(service.createCardToken(params)).rejects.toThrow(
        'No se pudo tokenizar la tarjeta con ePayco',
      );
    });

    it('acepta respuestas planas (sin envoltorio data)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: true,
          token: 'tok_flat',
          card_type: 'MASTERCARD',
        }),
      );

      const result = await service.createCardToken(params);

      expect(result).toMatchObject({
        id: 'tok_flat',
        brand: 'MASTERCARD',
      });
    });
  });

  describe('createCardCharge', () => {
    const params = {
      tokenCard: 'tok_123',
      customerEmail: 'cliente@test.local',
      amount: 100000,
      tax: 19000,
      taxBase: 81000,
      description: 'Pedido MER-1',
      invoice: 'MER-1',
      installments: 3,
      name: 'Ada',
      lastName: 'Lovelace',
      address: 'Calle 1 #2-3',
      phone: '3001234567',
      docType: 'CC',
      docNumber: '1234567890',
      city: 'Bogotá',
    };

    it('no llama a ePayco si falta alguna llave', async () => {
      const { service: missing } = makeService({ 'epayco.publicKey': '' });

      await expect(
        missing.createCardCharge(params),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('crea el cobro con importes formateados y datos del cliente', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, data: { transactionID: 'trx-1' } }),
      );

      const result = await service.createCardCharge(params);

      expect(result).toEqual({ transactionID: 'trx-1' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://epayco.test/payment/v1/charge/create');
      expect(init.headers).toMatchObject({
        public_key: 'epayco_pub_key',
        private_key: 'epayco_priv_key',
      });

      const body = JSON.parse(init.body);
      expect(body).toEqual({
        token_card: 'tok_123',
        customer_email: 'cliente@test.local',
        doc_type: 'CC',
        doc_number: '1234567890',
        name: 'Ada',
        last_name: 'Lovelace',
        phone: '3001234567',
        cell_phone: '3001234567',
        bill: 'MER-1',
        description: 'Pedido MER-1',
        value: '100000.00',
        tax: '19000.00',
        tax_base: '81000.00',
        currency: 'cop',
        dues: '3',
        address: 'Calle 1 #2-3',
        city: 'Bogotá',
        country: 'CO',
        test: true,
      });
    });

    it('aplica los valores por defecto de documento y apellido', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

      await service.createCardCharge({
        tokenCard: 'tok',
        customerEmail: 'a@b.co',
        amount: 1,
        tax: 0,
        taxBase: 1,
        description: 'x',
        invoice: 'INV-1',
        installments: 1,
        name: 'Ana',
        address: 'Calle',
        phone: '300',
        city: 'Cali',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toMatchObject({
        doc_type: 'CC',
        doc_number: '2222222222',
        last_name: '',
      });
    });

    it('rechaza la respuesta con status false', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: false, message: 'Tarjeta rechazada' }),
      );

      await expect(service.createCardCharge(params)).rejects.toThrow(
        'Tarjeta rechazada',
      );
    });

    it('usa data.respuesta cuando no hay message', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: false, data: { respuesta: 'Fondos insuficientes' } }),
      );

      await expect(service.createCardCharge(params)).rejects.toThrow(
        'Fondos insuficientes',
      );
    });

    it('usa un mensaje genérico si no hay detalle', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 502));

      await expect(service.createCardCharge(params)).rejects.toThrow(
        'No se pudo crear el cobro con ePayco',
      );
    });

    it('devuelve la respuesta plana si no viene envuelta en data', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, transactionID: 'trx-plano' }),
      );

      await expect(service.createCardCharge(params)).resolves.toEqual({
        success: true,
        transactionID: 'trx-plano',
      });
    });
  });
});
