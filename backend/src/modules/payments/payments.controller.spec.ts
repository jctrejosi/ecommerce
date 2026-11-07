import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentsController } from './payments.controller';
import { createDbMock } from '../../../test/helpers/db-mock';
import type { WompiService } from './wompi.service';
import type { EpaycoService } from './epayco.service';
import type { DrizzleService } from '../../database/drizzle.service';

const ACCEPTANCE_DATA = {
  publicKey: 'pub_key',
  redirectUrl: 'https://tienda.test/pago',
  acceptanceToken: 'acc-token',
  acceptancePermalink: null,
  personalDataAuthToken: null,
  personalDataAuthPermalink: null,
};

describe('PaymentsController', () => {
  let mock: ReturnType<typeof createDbMock>;
  let wompi: {
    getAcceptanceData: ReturnType<typeof vi.fn>;
    validateConfiguration: ReturnType<typeof vi.fn>;
  };
  let epayco: {
    getPublicConfig: ReturnType<typeof vi.fn>;
    createCardToken: ReturnType<typeof vi.fn>;
  };
  let controller: PaymentsController;

  beforeEach(() => {
    mock = createDbMock();
    wompi = {
      getAcceptanceData: vi.fn().mockResolvedValue(ACCEPTANCE_DATA),
      validateConfiguration: vi.fn().mockResolvedValue(undefined),
    };
    epayco = {
      getPublicConfig: vi.fn().mockReturnValue({
        publicKey: 'epayco_pub',
        checkoutUrl: 'https://checkout.test',
        test: true,
      }),
      createCardToken: vi.fn().mockResolvedValue({ id: 'tok_1' }),
    };
    controller = new PaymentsController(
      wompi as unknown as WompiService,
      epayco as unknown as EpaycoService,
      mock.drizzle as unknown as DrizzleService,
    );
  });

  describe('ePayco', () => {
    it('devuelve la configuración pública del servicio', () => {
      expect(controller.getEpaycoConfig()).toEqual({
        publicKey: 'epayco_pub',
        checkoutUrl: 'https://checkout.test',
        test: true,
      });
      expect(epayco.getPublicConfig).toHaveBeenCalledTimes(1);
    });

    it('delega la tokenización de tarjeta', async () => {
      const body = {
        cardNumber: '4575623182290326',
        expYear: '2030',
        expMonth: '12',
        cvc: '123',
        cardHolder: 'ADA',
      };

      await expect(controller.tokenizeEpaycoCard(body)).resolves.toEqual({
        id: 'tok_1',
      });
      expect(epayco.createCardToken).toHaveBeenCalledWith(body);
    });
  });

  describe('getWompiConfig', () => {
    it('devuelve los datos de aceptación cuando no hay configuración guardada', async () => {
      mock.queueSelect([]);

      await expect(controller.getWompiConfig()).resolves.toEqual(ACCEPTANCE_DATA);
      expect(wompi.getAcceptanceData).toHaveBeenCalledTimes(1);
    });

    it('oculta la configuración si Wompi está deshabilitado en settings', async () => {
      mock.queueSelectOne({ value: { wompi: { enabled: false } } });

      await expect(controller.getWompiConfig()).resolves.toEqual({
        enabled: false,
      });
      expect(wompi.getAcceptanceData).not.toHaveBeenCalled();
    });

    it('devuelve los datos de aceptación si Wompi está habilitado', async () => {
      mock.queueSelectOne({ value: { wompi: { enabled: true } } });

      await expect(controller.getWompiConfig()).resolves.toEqual(ACCEPTANCE_DATA);
    });

    it('oculta la configuración si la consulta a Wompi falla', async () => {
      mock.queueSelect([]);
      wompi.getAcceptanceData.mockRejectedValueOnce(new Error('sin llave'));

      await expect(controller.getWompiConfig()).resolves.toEqual({
        enabled: false,
      });
    });

    it('oculta la configuración si el valor guardado no tiene wompi', async () => {
      mock.queueSelectOne({ value: null });

      await expect(controller.getWompiConfig()).resolves.toEqual(ACCEPTANCE_DATA);
    });
  });

  describe('getPaymentMethods', () => {
    const defaults = {
      efectivo: { enabled: true },
      wompi: {
        enabled: true,
        methods: { card: true, pse: true, nequi: true },
      },
      breb: { enabled: true, key: '@davi3148853458', bank: 'Davivienda' },
    };

    it('devuelve los valores por defecto sin configuración guardada', async () => {
      mock.queueSelect([]);

      await expect(controller.getPaymentMethods()).resolves.toEqual(defaults);
    });

    it('combina la configuración parcial con los valores por defecto', async () => {
      mock.queueSelectOne({
        value: {
          efectivo: { enabled: false },
          wompi: { methods: { pse: false } },
          breb: { key: '@otro', bank: 'Bancolombia' },
        },
      });

      await expect(controller.getPaymentMethods()).resolves.toEqual({
        efectivo: { enabled: false },
        wompi: {
          enabled: true,
          methods: { card: true, pse: false, nequi: true },
        },
        breb: { enabled: true, key: '@otro', bank: 'Bancolombia' },
      });
    });

    it('respeta los valores explícitos de todos los métodos', async () => {
      mock.queueSelectOne({
        value: {
          efectivo: { enabled: false },
          wompi: {
            enabled: false,
            methods: { card: false, pse: false, nequi: false },
          },
          breb: { enabled: false },
        },
      });

      await expect(controller.getPaymentMethods()).resolves.toEqual({
        efectivo: { enabled: false },
        wompi: {
          enabled: false,
          methods: { card: false, pse: false, nequi: false },
        },
        breb: { enabled: false, key: '@davi3148853458', bank: 'Davivienda' },
      });
    });
  });
});
