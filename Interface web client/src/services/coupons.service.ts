const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3000")
);

export type CouponValidation = {
  valid: boolean;
  kind?: "discount" | "balance" | "mixed";
  /** Descuento que aplicaría el cupón sobre el subtotal. */
  discountAmount?: number;
  /** Saldo disponible que se puede usar para pagar. */
  balance?: number;
  expiresAt?: string | null;
  /** Motivo del rechazo cuando `valid` es false. */
  reason?: string;
};

/**
 * Valida un cupón contra el backend y devuelve la estimación de descuento y
 * saldo. El cálculo definitivo siempre lo hace el servidor al crear el pedido.
 */
export async function validateCoupon(
  code: string,
  subtotal = 0,
): Promise<CouponValidation> {
  const response = await fetch(`${API_BASE_URL}/coupons/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, subtotal }),
  });

  const json = (await response.json().catch(() => null)) as
    | CouponValidation
    | null;

  if (!response.ok) {
    return {
      valid: false,
      reason: json?.reason || "No se pudo validar el cupón",
      discountAmount: 0,
      balance: 0,
    };
  }

  return (
    json ?? {
      valid: false,
      reason: "No se pudo validar el cupón",
      discountAmount: 0,
      balance: 0,
    }
  );
}
