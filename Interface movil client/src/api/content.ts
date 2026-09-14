import { apiFetch } from "./client";
import type {
  BenefitItem,
  Branch,
  DailyDealsConfig,
  FeaturedTab,
  FooterConfig,
  LandingBrand,
  Popup,
  Product,
  StoreGeneral,
} from "./types";

/** Bloques de contenido de la landing (mismos endpoints que el web client). */
export const landingApi = {
  /** Logo y nombre de la tienda configurados en el admin. */
  getGeneral(): Promise<StoreGeneral> {
    return apiFetch<StoreGeneral>("/landing/general");
  },

  /** Config de "Ofertas del día" (destacadas + carrusel). */
  getDailyDeals(): Promise<DailyDealsConfig> {
    return apiFetch<DailyDealsConfig>("/landing/daily-deals");
  },

  /** Marcas de la landing configuradas en el admin. */
  getBrands(): Promise<LandingBrand[]> {
    return apiFetch<LandingBrand[]>("/landing/brands");
  },

  /** Beneficios/ventajas de la landing. */
  getBenefits(): Promise<BenefitItem[]> {
    return apiFetch<BenefitItem[]>("/landing/benefits");
  },

  /** Config del footer (contacto, links, redes). */
  getFooter(): Promise<FooterConfig> {
    return apiFetch<FooterConfig>("/landing/footer");
  },
};

export const branchesApi = {
  getBranches(): Promise<Branch[]> {
    return apiFetch<Branch[]>("/catalog/branches");
  },
};

export const featuredApi = {
  /** Pestañas de "Productos destacados". */
  getTabs(): Promise<FeaturedTab[]> {
    return apiFetch<FeaturedTab[]>("/featured/tabs");
  },

  /** Productos de una pestaña (por slug). */
  getTabProducts(slug: string, limit = 8): Promise<Product[]> {
    return apiFetch<Product[]>(
      `/featured/tabs/${encodeURIComponent(slug)}/products?limit=${limit}`,
    );
  },
};

export const popupsApi = {
  getActive(): Promise<Popup[]> {
    return apiFetch<Popup[]>("/popups/active");
  },
};

export const newsletterApi = {
  subscribe(data: {
    email: string;
    name?: string;
    acceptedTerms: boolean;
  }): Promise<unknown> {
    return apiFetch("/newsletter/subscribe", { method: "POST", body: data });
  },
};
