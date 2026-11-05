import { describe, it, expect } from 'vitest';
import {
  calculateOrderTotals,
  itemsSubtotal,
  shippingCostFor,
  EXPRESS_SHIPPING_COST,
  STANDARD_SHIPPING_COST,
} from './order-pricing';

describe('order-pricing', () => {
  it('calcula el subtotal con redondeo a dos decimales', () => {
    expect(itemsSubtotal([{ unitPrice: 19.99, quantity: 3 }])).toBe(59.97);
    expect(
      itemsSubtotal([
        { unitPrice: 2500, quantity: 2 },
        { unitPrice: 1000, quantity: 1 },
      ]),
    ).toBe(6000);
    expect(itemsSubtotal([])).toBe(0);
  });

  it('usa la tarifa de envío según el tipo', () => {
    expect(shippingCostFor('standard')).toBe(STANDARD_SHIPPING_COST);
    expect(shippingCostFor('express')).toBe(EXPRESS_SHIPPING_COST);
    expect(shippingCostFor('standard')).toBe(4900);
    expect(shippingCostFor('express')).toBe(9900);
  });

  it('aplica descuento de promoción y suma envío estándar', () => {
    const totals = calculateOrderTotals({
      itemsSubtotal: 100_000,
      promotionDiscount: 10_000,
      couponDiscount: 0,
      couponBalance: 0,
      shippingType: 'standard',
    });

    expect(totals).toMatchObject({
      shippingCost: 4900,
      discountTotal: 10_000,
      totalBeforeCouponBalance: 94_900,
      grandTotal: 94_900,
      couponBalanceApplied: 0,
      amountToCharge: 94_900,
      fullyPaidByCoupon: false,
      amountInCents: 9_490_000,
    });
  });

  it('suma descuento de promoción y de cupón sin pasar del subtotal', () => {
    const totals = calculateOrderTotals({
      itemsSubtotal: 5000,
      promotionDiscount: 4000,
      couponDiscount: 3000,
      couponBalance: 0,
      shippingType: 'express',
    });

    expect(totals.discountTotal).toBe(5000);
    expect(totals.totalBeforeCouponBalance).toBe(9900);
    expect(totals.amountToCharge).toBe(9900);
  });

  it('usa el saldo del cupón para reducir el monto a cobrar', () => {
    const totals = calculateOrderTotals({
      itemsSubtotal: 100_000,
      promotionDiscount: 10_000,
      couponDiscount: 0,
      couponBalance: 5000,
      shippingType: 'standard',
    });

    expect(totals.couponBalanceApplied).toBe(5000);
    expect(totals.amountToCharge).toBe(89_900);
    expect(totals.fullyPaidByCoupon).toBe(false);
    expect(totals.amountInCents).toBe(8_990_000);
  });

  it('marca el pedido como pagado por cupón cuando el saldo cubre todo', () => {
    const totals = calculateOrderTotals({
      itemsSubtotal: 10_000,
      promotionDiscount: 0,
      couponDiscount: 0,
      couponBalance: 20_000,
      shippingType: 'standard',
    });

    expect(totals.couponBalanceApplied).toBe(14_900);
    expect(totals.amountToCharge).toBe(0);
    expect(totals.fullyPaidByCoupon).toBe(true);
    expect(totals.grandTotal).toBe(14_900);
    expect(totals.amountInCents).toBe(0);
  });

  it('no permite saldo negativo ni totales negativos', () => {
    const totals = calculateOrderTotals({
      itemsSubtotal: 1000,
      promotionDiscount: 5000,
      couponDiscount: 0,
      couponBalance: -500,
      shippingType: 'standard',
    });

    expect(totals.discountTotal).toBe(1000);
    expect(totals.totalBeforeCouponBalance).toBe(4900);
    expect(totals.couponBalanceApplied).toBe(0);
    expect(totals.amountToCharge).toBe(4900);
  });

  it('cobra el envío aunque no haya productos', () => {
    const totals = calculateOrderTotals({
      itemsSubtotal: 0,
      promotionDiscount: 0,
      couponDiscount: 0,
      couponBalance: 0,
      shippingType: 'standard',
    });

    expect(totals.totalBeforeCouponBalance).toBe(4900);
    expect(totals.amountToCharge).toBe(4900);
    expect(totals.fullyPaidByCoupon).toBe(false);
  });
});
