/**
 * Cálculo de los importes de un pedido. Vive aparte del servicio para poder
 * probarlo de forma pura (sin BD, pagos ni transacciones).
 */

export const STANDARD_SHIPPING_COST = 4900;
export const EXPRESS_SHIPPING_COST = 9900;

export type ShippingType = 'standard' | 'express';

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface OrderTotalsInput {
  /** Suma de `unitPrice * quantity`, ya calculada por el motor de promociones. */
  itemsSubtotal: number;
  /** Descuento de promociones automáticas (no de cupón). */
  promotionDiscount: number;
  /** Descuento monetario del cupón. */
  couponDiscount: number;
  /** Saldo del cupón disponible para cubrir el resto del pedido. */
  couponBalance: number;
  shippingType: ShippingType;
}

export interface OrderTotals {
  shippingCost: number;
  discountTotal: number;
  totalBeforeCouponBalance: number;
  grandTotal: number;
  couponBalanceApplied: number;
  amountToCharge: number;
  fullyPaidByCoupon: boolean;
  amountInCents: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function shippingCostFor(shippingType: ShippingType): number {
  return shippingType === 'express'
    ? EXPRESS_SHIPPING_COST
    : STANDARD_SHIPPING_COST;
}

export function itemsSubtotal(items: PricedLine[]): number {
  return round2(
    items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  );
}

export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  const shippingCost = shippingCostFor(input.shippingType);

  // Los descuentos (promoción + cupón) nunca superan el subtotal de productos.
  const discountTotal = Math.min(
    input.promotionDiscount + input.couponDiscount,
    input.itemsSubtotal,
  );

  // El envío no es descontable con el cupón de descuento; el saldo del cupón sí
  // puede cubrir el total con envío incluido.
  const totalBeforeCouponBalance =
    Math.max(0, input.itemsSubtotal - discountTotal) + shippingCost;

  const couponBalanceApplied = Math.min(
    Math.max(input.couponBalance, 0),
    totalBeforeCouponBalance,
  );

  const amountToCharge = Math.max(
    0,
    totalBeforeCouponBalance - couponBalanceApplied,
  );

  return {
    shippingCost,
    discountTotal,
    totalBeforeCouponBalance,
    grandTotal: totalBeforeCouponBalance,
    couponBalanceApplied,
    amountToCharge,
    fullyPaidByCoupon: amountToCharge <= 0 && couponBalanceApplied > 0,
    amountInCents: amountToCharge * 100,
  };
}
