import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { createDbMock } from '../../../test/helpers/db-mock';
import type { DrizzleService } from '../../database/drizzle.service';

type Tx = Parameters<CouponsService['commitRedemption']>[0];

function makeCouponRow(overrides: Record<string, any> = {}) {
  return {
    id: 5n,
    code: 'CUPO10',
    kind: 'discount',
    status: 'active',
    isActive: true,
    discountType: 'percentage',
    discountValue: '10.00',
    maximumDiscount: null,
    currentBalance: null,
    maxUsesTotal: null,
    maxUsesPerCustomer: null,
    timesUsed: 0,
    startsAt: null,
    expiresAt: null,
    issuedCustomerId: null,
    promotionDiscountType: null,
    promotionDiscountValue: null,
    promotionMaximumDiscount: null,
    promotionIsActive: null,
    promotionDeletedAt: null,
    ...overrides,
  };
}

describe('CouponsService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let service: CouponsService;

  beforeEach(() => {
    mock = createDbMock();
    service = new CouponsService(mock.drizzle as unknown as DrizzleService);
  });

  describe('previewForOrder', () => {
    it('exige un código de cupón', async () => {
      await expect(service.previewForOrder('   ', 1000)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza un cupón inexistente', async () => {
      mock.queueSelect([]);

      await expect(service.previewForOrder('NOEXISTE', 1000)).rejects.toThrow(
        'El cupón no existe',
      );
    });

    it('rechaza un cupón inactivo o bloqueado', async () => {
      mock.queueSelect([makeCouponRow({ isActive: false })]);
      await expect(service.previewForOrder('CUPO10', 1000)).rejects.toThrow(
        'El cupón está bloqueado',
      );

      mock.queueSelect([makeCouponRow({ status: 'blocked' })]);
      await expect(service.previewForOrder('CUPO10', 1000)).rejects.toThrow(
        'El cupón está bloqueado',
      );
    });

    it('marca y rechaza un cupón vencido por fecha', async () => {
      mock.queueSelect([
        makeCouponRow({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ]);

      await expect(service.previewForOrder('CUPO10', 1000)).rejects.toThrow(
        'El cupón está vencido',
      );
      expect(mock.state.updates[0].values).toEqual({
        status: 'expired',
        isActive: false,
      });
    });

    it('rechaza un cupón asignado a otro cliente', async () => {
      mock.queueSelect([makeCouponRow({ issuedCustomerId: 99n })]);

      await expect(service.previewForOrder('CUPO10', 1000, 7)).rejects.toThrow(
        'Este cupón está asignado a otro cliente',
      );
    });

    it('calcula un descuento porcentual', async () => {
      mock.queueSelect([makeCouponRow()]);

      await expect(service.previewForOrder('cupo10', 100_000)).resolves.toEqual(
        { couponId: 5, discountAmount: 10_000, balance: 0, kind: 'discount' },
      );
    });

    it('respeta el descuento máximo', async () => {
      mock.queueSelect([makeCouponRow({ maximumDiscount: '5000.00' })]);

      const preview = await service.previewForOrder('CUPO10', 100_000);
      expect(preview.discountAmount).toBe(5000);
    });

    it('aplica un descuento fijo sin superar el subtotal', async () => {
      mock.queueSelect([
        makeCouponRow({ discountType: 'fixed', discountValue: '20000.00' }),
      ]);

      const preview = await service.previewForOrder('CUPO10', 15_000);
      expect(preview.discountAmount).toBe(15_000);
    });

    it('devuelve el saldo de un cupón de saldo', async () => {
      mock.queueSelect([
        makeCouponRow({
          kind: 'balance',
          discountType: null,
          discountValue: null,
          currentBalance: '30000.00',
        }),
      ]);

      await expect(service.previewForOrder('CUPO10', 100_000)).resolves.toEqual(
        { couponId: 5, discountAmount: 0, balance: 30_000, kind: 'balance' },
      );
    });

    it('hereda el descuento de la promoción asociada', async () => {
      mock.queueSelect([
        makeCouponRow({
          discountType: null,
          discountValue: null,
          promotionDiscountType: 'percent',
          promotionDiscountValue: '15.00',
          promotionIsActive: true,
        }),
      ]);

      const preview = await service.previewForOrder('CUPO10', 20_000);
      expect(preview.discountAmount).toBe(3000);
    });

    it('rechaza si la promoción del cupón está inactiva', async () => {
      mock.queueSelect([makeCouponRow({ promotionIsActive: false })]);

      await expect(service.previewForOrder('CUPO10', 1000)).rejects.toThrow(
        'La promoción del cupón está inactiva',
      );
    });

    it('rechaza si se agotaron los usos totales', async () => {
      mock.queueSelect([makeCouponRow({ maxUsesTotal: 2, timesUsed: 2 })]);

      await expect(service.previewForOrder('CUPO10', 1000)).rejects.toThrow(
        'El cupón alcanzó su límite de usos',
      );
    });

    it('rechaza si el cliente agotó sus usos permitidos', async () => {
      mock.queueSelect([makeCouponRow({ maxUsesPerCustomer: 1 })]);
      mock.queueSelect([{ total: 1 }]);

      await expect(service.previewForOrder('CUPO10', 1000, 7)).rejects.toThrow(
        'Ya usaste este cupón el máximo de veces permitido',
      );
    });

    it('rechaza un cupón de descuento que no genera descuento', async () => {
      mock.queueSelect([
        makeCouponRow({ discountType: 'fixed', discountValue: '0' }),
      ]);

      await expect(service.previewForOrder('CUPO10', 1000)).rejects.toThrow(
        'El cupón no genera descuento para este pedido',
      );
    });

    it('rechaza un cupón de saldo sin saldo', async () => {
      mock.queueSelect([
        makeCouponRow({
          kind: 'balance',
          discountType: null,
          discountValue: null,
          currentBalance: '0',
        }),
      ]);

      await expect(service.previewForOrder('CUPO10', 1000)).rejects.toThrow(
        'El cupón no tiene saldo disponible',
      );
    });
  });

  describe('validate', () => {
    it('devuelve el detalle cuando el cupón es válido', async () => {
      mock.queueSelect([makeCouponRow()]);
      mock.queueSelect([
        {
          kind: 'discount',
          status: 'active',
          expiresAt: null,
          currentBalance: null,
          discountType: 'percentage',
          discountValue: '10.00',
        },
      ]);

      await expect(service.validate('cupo10', 10_000)).resolves.toMatchObject({
        valid: true,
        kind: 'discount',
        discountAmount: 1000,
        balance: 0,
      });
    });

    it('no lanza excepción y explica el motivo', async () => {
      mock.queueSelect([]);

      const result = await service.validate('NOEXISTE', 10_000);
      expect(result.valid).toBe(false);
      expect(result).toMatchObject({ reason: 'El cupón no existe' });
    });
  });

  describe('commitRedemption', () => {
    it('descuenta saldo e incrementa los usos', async () => {
      mock.queueSelect([
        { id: 5n, currentBalance: '10000.00', timesUsed: 1, status: 'active' },
      ]);

      const result = await service.commitRedemption(mock.db as unknown as Tx, {
        couponId: 5,
        orderId: 10,
        customerId: null,
        guestSessionId: 3,
        discountAmount: 0,
        balanceAmount: 3000,
      });

      expect(result).toEqual({ balanceBefore: 10_000, balanceAfter: 7000 });
      expect(mock.state.updates[0].values).toMatchObject({
        currentBalance: '7000',
        timesUsed: 2,
        status: 'active',
        isActive: true,
      });
      expect(mock.state.inserts[0].values).toMatchObject({
        couponId: 5,
        orderId: 10,
        type: 'REDEEM',
        amount: '3000',
        balanceBefore: '10000',
        balanceAfter: '7000',
      });
    });

    it('marca el cupón como agotado cuando el saldo llega a cero', async () => {
      mock.queueSelect([
        { id: 5n, currentBalance: '2000.00', timesUsed: 0, status: 'active' },
      ]);

      const result = await service.commitRedemption(mock.db as unknown as Tx, {
        couponId: 5,
        orderId: 10,
        customerId: 7,
        guestSessionId: null,
        discountAmount: 0,
        balanceAmount: 2000,
      });

      expect(result.balanceAfter).toBe(0);
      expect(mock.state.updates[0].values).toMatchObject({
        currentBalance: '0',
        status: 'exhausted',
        isActive: false,
      });
    });

    it('rechaza si el saldo cambió respecto al preview', async () => {
      mock.queueSelect([
        { id: 5n, currentBalance: '1000.00', timesUsed: 1, status: 'active' },
      ]);

      await expect(
        service.commitRedemption(mock.db as unknown as Tx, {
          couponId: 5,
          orderId: 10,
          customerId: null,
          guestSessionId: null,
          discountAmount: 0,
          balanceAmount: 5000,
        }),
      ).rejects.toThrow('El saldo del cupón cambió, intenta de nuevo');
      expect(mock.state.updates).toHaveLength(0);
    });

    it('rechaza si el cupón ya no existe', async () => {
      mock.queueSelect([]);

      await expect(
        service.commitRedemption(mock.db as unknown as Tx, {
          couponId: 5,
          orderId: 10,
          customerId: null,
          guestSessionId: null,
          discountAmount: 0,
          balanceAmount: 0,
        }),
      ).rejects.toThrow('El cupón ya no existe');
    });
  });

  describe('reverseForOrder', () => {
    it('devuelve el saldo consumido y deja el movimiento de reverso', async () => {
      mock.queueSelect([
        {
          currentBalance: '5000.00',
          status: 'active',
          timesUsed: 1,
          expiresAt: null,
        },
      ]);
      mock.queueSelect([]);
      mock.queueSelectOne({ amount: '3000.00' });

      const result = await service.reverseForOrder({
        couponId: 5,
        orderId: 10,
        customerId: 7,
      });

      expect(result).toEqual({ reversed: 3000, balanceAfter: 8000 });
      expect(mock.state.transactions).toBe(1);
      expect(mock.state.updates[0].values).toMatchObject({
        currentBalance: '8000',
        status: 'active',
        timesUsed: 0,
      });
      expect(mock.state.inserts[0].values).toMatchObject({
        type: 'REVERSAL',
        amount: '3000',
        balanceBefore: '5000',
        balanceAfter: '8000',
      });
    });

    it('no revierte dos veces el mismo pedido', async () => {
      mock.queueSelect([
        {
          currentBalance: '5000.00',
          status: 'active',
          timesUsed: 1,
          expiresAt: null,
        },
      ]);
      mock.queueSelectOne({ id: 1n });

      await expect(
        service.reverseForOrder({ couponId: 5, orderId: 10 }),
      ).resolves.toEqual({ reversed: 0, alreadyReversed: true });
      expect(mock.state.updates).toHaveLength(0);
    });

    it('no hace nada si el pedido no consumió saldo', async () => {
      mock.queueSelect([
        {
          currentBalance: '5000.00',
          status: 'active',
          timesUsed: 1,
          expiresAt: null,
        },
      ]);
      mock.queueSelect([]);
      mock.queueSelectOne({ amount: '0' });

      await expect(
        service.reverseForOrder({ couponId: 5, orderId: 10 }),
      ).resolves.toEqual({ reversed: 0 });
      expect(mock.state.updates).toHaveLength(0);
    });

    it('mantiene bloqueado un cupón bloqueado', async () => {
      mock.queueSelect([
        {
          currentBalance: '0',
          status: 'blocked',
          timesUsed: 1,
          expiresAt: null,
        },
      ]);
      mock.queueSelect([]);
      mock.queueSelectOne({ amount: '1500.00' });

      await service.reverseForOrder({ couponId: 5, orderId: 10 });

      expect(mock.state.updates[0].values).toMatchObject({
        status: 'blocked',
        isActive: false,
      });
    });

    it('rechaza si el cupón no existe', async () => {
      mock.queueSelect([]);

      await expect(
        service.reverseForOrder({ couponId: 5, orderId: 10 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
