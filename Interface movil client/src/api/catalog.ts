import { apiFetch } from "./client";
import type {
  Brand,
  CatalogCategory,
  Product,
  ProductType,
} from "./types";

export interface CatalogProductsQuery {
  categoryIds?: number[];
  productIds?: number[];
  brandId?: number;
  productTypeCode?: string;
  onSale?: boolean;
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

function buildPayload(params?: CatalogProductsQuery) {
  return {
    categoryIds: params?.categoryIds?.length ? params.categoryIds : undefined,
    productIds: params?.productIds?.length ? params.productIds : undefined,
    brandId: params?.brandId || undefined,
    productTypeCode: params?.productTypeCode || undefined,
    onSale: params?.onSale || undefined,
    sort: params?.sort || undefined,
    search: params?.search?.trim() ? params.search.trim() : undefined,
    limit: params?.limit || undefined,
    offset: params?.offset || undefined,
  };
}

export const catalogApi = {
  getCategories(): Promise<CatalogCategory[]> {
    return apiFetch<CatalogCategory[]>("/catalog/categories");
  },

  getProductTypes(): Promise<ProductType[]> {
    return apiFetch<ProductType[]>("/catalog/product-types");
  },

  /** Tipos configurados para la home (landing). */
  getLandingProductTypes(): Promise<ProductType[]> {
    return apiFetch<ProductType[]>("/landing/product-types");
  },

  getBrands(): Promise<(Brand & { count: number })[]> {
    return apiFetch<(Brand & { count: number })[]>("/catalog/brands");
  },

  getFeaturedBrands(): Promise<Brand[]> {
    return apiFetch<Brand[]>("/catalog/brands/featured");
  },

  getProducts(params?: CatalogProductsQuery): Promise<Product[]> {
    return apiFetch<Product[]>("/catalog/products", {
      method: "POST",
      body: buildPayload(params),
    });
  },

  async getProductById(id: number): Promise<Product | undefined> {
    const products = await this.getProducts({ productIds: [id], limit: 1 });
    return products[0];
  },

  getRelatedProducts(id: number): Promise<Product[]> {
    return apiFetch<Product[]>(`/catalog/products/${id}/related`);
  },

  // ── Favoritos ──
  getFavorites(): Promise<Product[]> {
    return apiFetch<Product[]>("/catalog/favorites", { auth: true });
  },
  addFavorite(productId: number): Promise<void> {
    return apiFetch<void>(`/catalog/favorites/${productId}`, {
      method: "POST",
      auth: true,
    });
  },
  removeFavorite(productId: number): Promise<void> {
    return apiFetch<void>(`/catalog/favorites/${productId}`, {
      method: "DELETE",
      auth: true,
    });
  },
};

export interface HeroBanner {
  id: number;
  title: string;
  subtitle?: string;
  description?: string;
  ctaText?: string;
  linkUrl?: string;
  image?: string;
  mobileImage?: string;
  bgColor?: string;
  accentColor?: string;
  filter?: Record<string, unknown> | null;
}

export const bannersApi = {
  getHero(): Promise<HeroBanner[]> {
    return apiFetch<HeroBanner[]>("/banners?bannerType=hero");
  },
};
