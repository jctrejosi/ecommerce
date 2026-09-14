import { API_BASE_URL, apiFetch as fetchJson } from "../lib/api";

export type BannerType = "hero" | "promo" | "sidebar" | "footer";
export type BannerStatus = "activo" | "programado" | "inactivo" | "expirado";

export type Banner = {
  id: number;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  image: string | null;
  mobileImage: string | null;
  linkUrl: string | null;
  linkTarget: string;
  ctaText: string | null;
  altText: string | null;
  bgColor: string | null;
  accentColor: string | null;
  bannerType: BannerType;
  position: number;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  filterId: number | null;
  filter: {
    id: number;
    name: string;
    categoryIds: number[];
    productIds: number[];
    brandId: number | null;
    productTypeCode: string | null;
    onSale: boolean;
    search: string | null;
    sort: string | null;
    priceMin: number | null;
    priceMax: number | null;
  } | null;
  clicks: number;
  views: number;
  status: BannerStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateBannerData = {
  title: string;
  subtitle?: string;
  description?: string;
  mediaId: number;
  mobileImageId?: number;
  filterId?: number | null;
  linkUrl?: string;
  linkTarget?: string;
  altText?: string;
  ctaText?: string;
  bgColor?: string;
  accentColor?: string;
  bannerType?: BannerType;
  position?: number;
  isActive?: boolean;
  startDate?: string;
  endDate?: string;
};

export type UpdateBannerData = Partial<CreateBannerData>;



export const bannersService = {
  async getAll(params?: {
    bannerType?: string;
    status?: string;
  }): Promise<Banner[]> {
    const searchParams = new URLSearchParams();
    if (params?.bannerType) searchParams.set("bannerType", params.bannerType);
    if (params?.status) searchParams.set("status", params.status);
    const qs = searchParams.toString();
    return fetchJson<Banner[]>(
      `${API_BASE_URL}/admin/banners${qs ? `?${qs}` : ""}`,
    );
  },

  async getById(id: number): Promise<Banner> {
    return fetchJson<Banner>(`${API_BASE_URL}/admin/banners/${id}`);
  },

  async create(data: CreateBannerData): Promise<Banner> {
    return fetchJson<Banner>(`${API_BASE_URL}/admin/banners`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async update(id: number, data: UpdateBannerData): Promise<Banner> {
    return fetchJson<Banner>(`${API_BASE_URL}/admin/banners/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async remove(id: number): Promise<{ success: boolean }> {
    return fetchJson(`${API_BASE_URL}/admin/banners/${id}`, {
      method: "DELETE",
    });
  },
};
