import { API_BASE_URL, apiFetch as fetchJson } from "../lib/api";

export type FilterConfig = {
  id: number;
  name: string;
  description: string | null;
  categoryIds: number[];
  productIds: number[];
  brandId: number | null;
  productTypeCode: string | null;
  onSale: boolean;
  search: string | null;
  sort: string | null;
  priceMin: number | null;
  priceMax: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateFilterData = {
  name: string;
  description?: string;
  categoryIds?: number[];
  productIds?: number[];
  brandId?: number | null;
  productTypeCode?: string;
  onSale?: boolean;
  search?: string;
  sort?: string;
  priceMin?: number;
  priceMax?: number;
  isActive?: boolean;
};



export const filtersService = {
  async getAll(): Promise<FilterConfig[]> {
    return fetchJson(`${API_BASE_URL}/admin/filters`);
  },

  async getById(id: number): Promise<FilterConfig> {
    return fetchJson(`${API_BASE_URL}/admin/filters/${id}`);
  },

  async create(data: CreateFilterData): Promise<FilterConfig> {
    return fetchJson(`${API_BASE_URL}/admin/filters`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async update(id: number, data: Partial<CreateFilterData>): Promise<FilterConfig> {
    return fetchJson(`${API_BASE_URL}/admin/filters/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async remove(id: number): Promise<{ success: boolean }> {
    return fetchJson(`${API_BASE_URL}/admin/filters/${id}`, { method: "DELETE" });
  },
};
