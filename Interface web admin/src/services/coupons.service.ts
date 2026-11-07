import { API_BASE_URL, apiFetch as fetchJson } from "../lib/api";

export type CouponKind = "discount" | "balance" | "mixed";
export type CouponStatus = "active" | "exhausted" | "expired" | "blocked";

export type Coupon = {
  id: number;
  promotionId: number | null;
  code: string;
  kind: CouponKind;
  discountType: "percentage" | "fixed" | null;
  discountValue: string | null;
  maximumDiscount: string | null;
  initialBalance: string | null;
  currentBalance: string | null;
  currency: string;
  status: CouponStatus;
  maxUsesTotal: number | null;
  maxUsesPerCustomer: number | null;
  timesUsed: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  issuedCustomerId: number | null;
  notes: string | null;
  createdAt: string;
};

export type CouponTransaction = {
  id: number;
  couponId: number;
  orderId: number | null;
  customerId: number | null;
  type: "ISSUE" | "REDEEM" | "REVERSAL" | "ADJUSTMENT" | "EXPIRATION";
  discountAmount: string;
  amount: string;
  balanceBefore: string | null;
  balanceAfter: string | null;
  note: string | null;
  createdAt: string;
  orderReference: string | null;
};

export type CouponDetail = Coupon & {
  transactions: CouponTransaction[];
};

export type IssuedCoupon = {
  id: number;
  code: string;
  kind: CouponKind;
  initialBalance: string | null;
  currentBalance: string | null;
  expiresAt: string | null;
};

export type IssueCouponData = {
  code?: string;
  kind?: CouponKind;
  promotionId?: number;
  discountType?: "percentage" | "fixed";
  discountValue?: number;
  maximumDiscount?: number;
  initialBalance?: number;
  startsAt?: string;
  expiresAt?: string;
  maxUsesTotal?: number;
  maxUsesPerCustomer?: number;
  issuedCustomerId?: number;
  notes?: string;
  quantity?: number;
};

export const couponsService = {
  async getAll(params?: {
    status?: string;
    kind?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Coupon[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.kind) searchParams.set("kind", params.kind);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const qs = searchParams.toString();
    return fetchJson(`${API_BASE_URL}/admin/coupons${qs ? `?${qs}` : ""}`);
  },

  async getById(id: number): Promise<CouponDetail> {
    return fetchJson(`${API_BASE_URL}/admin/coupons/${id}`);
  },

  async getTransactions(id: number): Promise<CouponTransaction[]> {
    return fetchJson(`${API_BASE_URL}/admin/coupons/${id}/transactions`);
  },

  async generateCode(): Promise<{ code: string }> {
    return fetchJson(`${API_BASE_URL}/admin/coupons/generate-code`);
  },

  async issue(data: IssueCouponData): Promise<{
    coupons: IssuedCoupon[];
    quantity: number;
  }> {
    return fetchJson(`${API_BASE_URL}/admin/coupons`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async update(
    id: number,
    data: {
      isActive?: boolean;
      status?: string;
      expiresAt?: string;
      notes?: string;
      maxUsesTotal?: number;
      maxUsesPerCustomer?: number;
      issuedCustomerId?: number;
    },
  ): Promise<CouponDetail> {
    return fetchJson(`${API_BASE_URL}/admin/coupons/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
};
