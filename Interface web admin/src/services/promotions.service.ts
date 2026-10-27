import { API_BASE_URL, apiFetch as fetchJson } from "../lib/api";

export type PromotionStatus = "activo" | "programado" | "expirado" | "inactivo";
export type DiscountType = "porcentaje" | "fijo" | "cupon";
export type PromotionComboMode = "same_discount" | "per_product";

export type PromotionProductRule = {
  productId: number;
  name: string;
  discountValue: string | null;
  isPercentage: boolean;
  maximumDiscount: string | null;
};

export type PromotionComboItem = {
  productId: number;
  name: string;
  discountValue: string;
  isPercentage: boolean;
};

export type PromotionCombo = {
  id: number;
  name: string | null;
  mode: PromotionComboMode;
  quantityRequired: number;
  discountValue: string;
  isPercentage: boolean;
  items: PromotionComboItem[];
};

export type Promotion = {
  id: number;
  name: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: string;
  maximumDiscount: string | null;
  weekdays: number[];
  categoryIds: number[];
  branchIds: number[];
  productIds?: number[];
  comboCount?: number;
  appliesTo?: "all" | "targeted";
  products?: PromotionProductRule[];
  combos?: PromotionCombo[];
  couponCode: string | null;
  couponMaxUsesTotal: number | null;
  couponTimesUsed: number;
  couponMaxUsesPerCustomer: number;
  isAutoApply: boolean;
  requiresCode: boolean;
  priority: number;
  stackable: boolean;
  exclusive: boolean;
  usageLimit: number | null;
  timesUsed: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: PromotionStatus;
  usagesToday: number;
  createdAt: string;
  updatedAt: string;
};

export type PromotionStats = {
  activas: number;
  programadas: number;
  usosHoy: number;
  descuentoAplicado: number;
};

export type PromotionUsage = {
  redemptionId: number;
  discountAmount: string | null;
  usedAt: string;
  couponCode: string;
  order: {
    id: number;
    orderNumber: string;
    total: string;
    status: string;
    createdAt: string;
  } | null;
  customer: {
    id: number;
    name: string;
    email: string;
  } | null;
};

export type CreatePromotionProduct = {
  productId: number;
  discountValue?: number;
  isPercentage?: boolean;
  maximumDiscount?: number;
};

export type CreatePromotionComboItem = {
  productId: number;
  discountValue?: number;
  isPercentage?: boolean;
};

export type CreatePromotionCombo = {
  name?: string;
  mode: PromotionComboMode;
  quantityRequired?: number;
  discountValue?: number;
  isPercentage?: boolean;
  items: CreatePromotionComboItem[];
};

export type CreatePromotionData = {
  name: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maximumDiscount?: number;
  weekdays?: number[];
  categoryIds?: number[];
  branchIds?: number[];
  products?: CreatePromotionProduct[];
  combos?: CreatePromotionCombo[];
  couponCode?: string;
  maxUsesTotal?: number;
  maxUsesPerCustomer?: number;
  usageLimit?: number;
  startDate: string;
  endDate: string;
  isAutoApply?: boolean;
  priority?: number;
  stackable?: boolean;
  exclusive?: boolean;
  isActive?: boolean;
};

export type UpdatePromotionData = Partial<CreatePromotionData>;

export const promotionsService = {
  async getAll(params?: {
    status?: string;
    search?: string;
    usagesToday?: string;
    limit?: number;
    offset?: number;
  }): Promise<Promotion[]> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.usagesToday)
      searchParams.set("usagesToday", params.usagesToday);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const qs = searchParams.toString();
    return fetchJson<Promotion[]>(
      `${API_BASE_URL}/admin/promotions${qs ? `?${qs}` : ""}`,
    );
  },

  async getStats(): Promise<PromotionStats> {
    return fetchJson<PromotionStats>(`${API_BASE_URL}/admin/promotions/stats`);
  },

  async getById(id: number): Promise<Promotion> {
    return fetchJson<Promotion>(`${API_BASE_URL}/admin/promotions/${id}`);
  },

  async getUsages(
    id: number,
    dateFilter?: "today" | "all",
  ): Promise<PromotionUsage[]> {
    const qs = dateFilter ? `?dateFilter=${dateFilter}` : "";
    return fetchJson<PromotionUsage[]>(
      `${API_BASE_URL}/admin/promotions/${id}/usages${qs}`,
    );
  },

  async create(data: CreatePromotionData): Promise<Promotion> {
    return fetchJson<Promotion>(`${API_BASE_URL}/admin/promotions`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async update(id: number, data: UpdatePromotionData): Promise<Promotion> {
    return fetchJson<Promotion>(`${API_BASE_URL}/admin/promotions/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async remove(id: number): Promise<{ success: boolean; message: string }> {
    return fetchJson(`${API_BASE_URL}/admin/promotions/${id}`, {
      method: "DELETE",
    });
  },
};
