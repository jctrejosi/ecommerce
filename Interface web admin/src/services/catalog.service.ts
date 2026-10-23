import { API_BASE_URL, apiFetch as fetchJson } from "../lib/api";

export type CatalogProduct = {
  id: number;
  externalId?: string | null;
  slug?: string | null;
  name: string;
  description?: string | null;
  price: number;
  originalPrice?: number | null;
  image?: string | null;
  images?: string[];
  category: string;
  categoryId?: number | null;
  brandId?: number | null;
  brandName?: string | null;
  productTypeCode?: string | null;
  productTypeName?: string | null;
  badge?: string | null;
  isFeatured?: boolean;
  isActive?: boolean;
  tags?: string[];
  stock?: number;
};

export type CatalogCategory = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  icon?: any;
  color?: string;
  count: number;
  isActive: boolean;
};

export type Brand = {
  id: number;
  name: string;
  slug: string;
  code?: string | null;
  description: string | null;
  image: string | null;
  website: string | null;
};

export type ProductType = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  count: number;
};

export type ProductsQuery = {
  search?: string;
  categoryIds?: number[];
  productIds?: number[];
  brandId?: number;
  productTypeCode?: string;
  isActive?: boolean;
  priceMin?: number;
  priceMax?: number;
  onSale?: boolean;
  priceRange?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  /** Sucursal con la que se resuelve el precio (no filtra disponibilidad). */
  priceBranchId?: number;
  /** Sucursal: solo productos que la sucursal tiene disponibles. */
  branchId?: number;
  uncategorized?: boolean;
};



export const catalogService = {
  async getProducts(params?: ProductsQuery): Promise<CatalogProduct[]> {
    return fetchJson<CatalogProduct[]>(`${API_BASE_URL}/catalog/products`, {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    });
  },

  async getProductsCount(branchId?: number): Promise<{ total: number }> {
    const query = branchId ? `?branchId=${branchId}` : "";
    return fetchJson<{ total: number }>(
      `${API_BASE_URL}/catalog/products/count${query}`,
    );
  },

  /** Fija el precio del producto en una sucursal (modelo del ERP: INVRVENTA1 por INSUC). */
  async setBranchPrice(
    productId: number,
    body: { branchId: number; price: number; comparePrice?: number | null },
  ): Promise<{ ok: boolean; branchId: number; price: number }> {
    return fetchJson(
      `${API_BASE_URL}/admin/catalog/products/${productId}/branch-price`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  /** Precios vigentes del producto en cada sucursal. */
  async getBranchPrices(productId: number): Promise<
    Array<{ branchId: number; price: number; comparePrice: number | null }>
  > {
    return fetchJson(
      `${API_BASE_URL}/admin/catalog/products/${productId}/branch-prices`,
    );
  },

  async getCategories(): Promise<CatalogCategory[]> {
    return fetchJson<CatalogCategory[]>(`${API_BASE_URL}/catalog/categories`);
  },

  async getBrands(): Promise<Brand[]> {
    return fetchJson<Brand[]>(`${API_BASE_URL}/catalog/brands`);
  },

  async getProductTypes(): Promise<ProductType[]> {
    return fetchJson<ProductType[]>(`${API_BASE_URL}/catalog/product-types`);
  },

  async getBranches(): Promise<
    { id: number; name: string; address: string; code?: string | null }[]
  > {
    return fetchJson<
      { id: number; name: string; address: string; code?: string | null }[]
    >(`${API_BASE_URL}/catalog/branches`);
  },

  // ── Admin Category CRUD ──

  async getCategoriesAdmin(): Promise<
    Array<{
      id: number;
      name: string;
      slug: string;
      code: string | null;
      parentId: number | null;
      displayOrder: number;
      description: string | null;
      metaTitle: string | null;
      metaDescription: string | null;
      isActive: boolean;
      level: number;
      createdAt: string;
      imagePath: string | null;
      productCount: number;
    }>
  > {
    return fetchJson(`${API_BASE_URL}/admin/catalog/categories`);
  },

  async createCategory(data: {
    name: string;
    code?: string;
    parentId?: number;
  }): Promise<{ id: number }> {
    return fetchJson(`${API_BASE_URL}/admin/catalog/categories`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateCategory(
    id: number,
    data: {
      name?: string;
      code?: string | null;
      parentId?: number | null;
      description?: string | null;
      displayOrder?: number;
      metaTitle?: string | null;
      metaDescription?: string | null;
      isActive?: boolean;
      imageUrl?: string;
    },
  ): Promise<{ id: number }> {
    return fetchJson(`${API_BASE_URL}/admin/catalog/categories/${id}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async deleteCategory(id: number): Promise<void> {
    await fetch(`${API_BASE_URL}/admin/catalog/categories/${id}`, {
      method: "DELETE",
    });
  },

  async getUncategorizedProducts(
    offset = 0,
    limit = 20,
    search?: string,
  ): Promise<CatalogProduct[]> {
    return fetchJson<CatalogProduct[]>(
      `${API_BASE_URL}/admin/catalog/products`,
      {
        method: "POST",
        body: JSON.stringify({ uncategorized: true, limit, offset, search }),
      },
    );
  },

  async getCategoryProducts(categoryId: number): Promise<
    Array<{
      id: number;
      name: string;
      slug: string;
      price: number;
      image: string | null;
      productTypeCode: string | null;
    }>
  > {
    return fetchJson(
      `${API_BASE_URL}/admin/catalog/categories/${categoryId}/products`,
    );
  },

  async addProductToCategory(
    categoryId: number,
    productId: number,
  ): Promise<void> {
    await fetch(
      `${API_BASE_URL}/admin/catalog/categories/${categoryId}/products`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      },
    );
  },

  async removeProductFromCategory(
    categoryId: number,
    productId: number,
  ): Promise<void> {
    await fetch(
      `${API_BASE_URL}/admin/catalog/categories/${categoryId}/products/${productId}`,
      {
        method: "DELETE",
      },
    );
  },

  // ── Admin Brand CRUD ──

  async getBrandsAdmin(): Promise<
    Array<{
      id: number;
      name: string;
      slug: string;
      code: string | null;
      description: string | null;
      image: string | null;
      website: string | null;
      country: string | null;
      isFeatured: boolean;
      isActive: boolean;
      createdAt: string;
      productCount: number;
    }>
  > {
    return fetchJson(`${API_BASE_URL}/admin/catalog/brands`);
  },

  async createBrand(data: {
    name: string;
    code?: string;
    website?: string;
    description?: string;
    country?: string;
    isFeatured?: boolean;
    imageUrl?: string;
  }): Promise<{ id: number }> {
    return fetchJson(`${API_BASE_URL}/admin/catalog/brands`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateBrand(
    id: number,
    data: {
      name?: string;
      code?: string;
      website?: string;
      description?: string;
      country?: string;
      isFeatured?: boolean;
      isActive?: boolean;
      imageUrl?: string;
    },
  ): Promise<{ id: number }> {
    return fetchJson(`${API_BASE_URL}/admin/catalog/brands/${id}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async deleteBrand(id: number): Promise<void> {
    await fetch(`${API_BASE_URL}/admin/catalog/brands/${id}`, {
      method: "DELETE",
    });
  },

  async getUnsuppliedCount(): Promise<{ total: number }> {
    return fetchJson<{ total: number }>(
      `${API_BASE_URL}/catalog/products/count?unsupplied=true`,
    );
  },

  async getUnsuppliedProducts(
    offset = 0,
    limit = 20,
    search?: string,
  ): Promise<CatalogProduct[]> {
    return fetchJson<CatalogProduct[]>(
      `${API_BASE_URL}/admin/catalog/products`,
      {
        method: "POST",
        body: JSON.stringify({ unsupplied: true, limit, offset, search }),
      },
    );
  },

  // ── Brand Products ──
  // ── Product Suppliers ──

  async getProductSuppliers(productId: number): Promise<
    Array<{
      supplierId: number;
      supplierName: string;
      supplierCode: string | null;
      supplierSku: string | null;
      purchasePrice: string | null;
      leadTimeDays: number | null;
      isPreferred: boolean;
    }>
  > {
    return fetchJson(
      `${API_BASE_URL}/admin/catalog/products/${productId}/suppliers`,
    );
  },

  async addSupplierToProduct(
    productId: number,
    supplierId: number,
  ): Promise<void> {
    await fetch(
      `${API_BASE_URL}/admin/catalog/products/${productId}/suppliers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId }),
      },
    );
  },

  async removeSupplierFromProduct(
    productId: number,
    supplierId: number,
  ): Promise<void> {
    await fetch(
      `${API_BASE_URL}/admin/catalog/products/${productId}/suppliers/${supplierId}`,
      { method: "DELETE" },
    );
  },

  // ── Brand Products ──

  async getBrandProducts(brandId: number): Promise<
    Array<{
      id: number;
      name: string;
      slug: string;
      price: number;
      image: string | null;
      productTypeCode: string | null;
    }>
  > {
    return fetchJson(
      `${API_BASE_URL}/admin/catalog/brands/${brandId}/products`,
    );
  },

  async addProductToBrand(brandId: number, productId: number): Promise<void> {
    await fetch(`${API_BASE_URL}/admin/catalog/brands/${brandId}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
  },

  async removeProductFromBrand(
    brandId: number,
    productId: number,
  ): Promise<void> {
    await fetch(
      `${API_BASE_URL}/admin/catalog/brands/${brandId}/products/${productId}`,
      { method: "DELETE" },
    );
  },

  async getUnbrandedCount(): Promise<{ total: number }> {
    return fetchJson<{ total: number }>(
      `${API_BASE_URL}/catalog/products/count?unbranded=true`,
    );
  },

  async getUnbrandedProducts(
    offset = 0,
    limit = 20,
    search?: string,
  ): Promise<CatalogProduct[]> {
    return fetchJson<CatalogProduct[]>(
      `${API_BASE_URL}/admin/catalog/products`,
      {
        method: "POST",
        body: JSON.stringify({ unbranded: true, limit, offset, search }),
      },
    );
  },

  // ── Admin Supplier CRUD ──

  async getSuppliersAdmin(params?: {
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<
    Array<{
      id: number;
      code: string | null;
      legalName: string;
      taxId: string | null;
      contactName: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
      country: string | null;
      website: string | null;
      paymentTermsDays: number | null;
      currencyCode: string | null;
      notes: string | null;
      isActive: boolean;
      createdAt: string;
      productCount: number;
    }>
  > {
    const qs = new URLSearchParams();
    if (typeof params?.offset === "number")
      qs.set("offset", String(params.offset));
    if (typeof params?.limit === "number")
      qs.set("limit", String(params.limit));
    if (params?.search?.trim()) qs.set("search", params.search.trim());
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetchJson(`${API_BASE_URL}/admin/catalog/suppliers${suffix}`);
  },

  async createSupplier(data: {
    legalName: string;
    code?: string;
    taxId?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    website?: string;
    paymentTermsDays?: number;
    currencyCode?: string;
    notes?: string;
  }): Promise<{ id: number }> {
    return fetchJson(`${API_BASE_URL}/admin/catalog/suppliers`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateSupplier(
    id: number,
    data: {
      legalName?: string;
      code?: string;
      taxId?: string;
      contactName?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      country?: string;
      website?: string;
      paymentTermsDays?: number | null;
      currencyCode?: string;
      notes?: string;
      isActive?: boolean;
    },
  ): Promise<{ id: number }> {
    return fetchJson(`${API_BASE_URL}/admin/catalog/suppliers/${id}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async deleteSupplier(id: number): Promise<void> {
    await fetch(`${API_BASE_URL}/admin/catalog/suppliers/${id}`, {
      method: "DELETE",
    });
  },

  // ── Supplier Products ──

  async getSupplierProducts(supplierId: number): Promise<
    Array<{
      id: number;
      name: string;
      slug: string;
      price: number;
      image: string | null;
      productTypeCode: string | null;
    }>
  > {
    return fetchJson(
      `${API_BASE_URL}/admin/catalog/suppliers/${supplierId}/products`,
    );
  },

  // ── Admin Supplier CRUD ──
  async replaceProductCategory(
    productId: number,
    categoryId: number,
  ): Promise<void> {
    await fetch(
      `${API_BASE_URL}/admin/catalog/products/${productId}/replace-category`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      },
    );
  },
};
