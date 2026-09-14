/** Tipos compartidos (espejo de `Interface web client/src/app/types.ts`). */

export type OrderStatus =
  | "pendiente"
  | "preparando"
  | "en camino"
  | "entregado"
  | "cancelado";

export interface Product {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  price: number;
  originalPrice?: number;
  image?: string;
  images?: string[];
  category?: string;
  categoryId?: number;
  brandId?: number | null;
  brandName?: string | null;
  plu?: string | null;
  barcode?: string | null;
  productTypeCode?: string | null;
  productTypeName?: string | null;
  isActive?: boolean;
  isFeatured?: boolean;
  isPublic?: boolean;
  stock?: number;
  badge?: string | null;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface CatalogCategory {
  id: number;
  code: string;
  name: string;
  parentId?: number | null;
  icon?: string | null;
  bg?: string | null;
  color?: string | null;
  productCount?: number;
  children?: CatalogCategory[];
}

export interface Brand {
  id: number;
  name: string;
  slug?: string;
  image?: string | null;
  count?: number;
}

export interface ProductType {
  id: number;
  code: string;
  name: string;
  count: number;
}

export interface Order {
  id: string;
  date: string;
  items: CartItem[];
  total: number;
  shipping: number;
  address: string;
  paymentMethod: string;
  status: OrderStatus;
}

export interface Customer {
  id?: number;
  firstName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  acceptsMarketing?: boolean;
}

export interface CustomerAddress {
  id: number;
  alias?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  reference?: string | null;
  deliveryInstructions?: string | null;
  isDefault?: boolean;
}

// ── Landing / contenido ──

export interface Branch {
  id: number;
  name: string;
  address: string;
  city: string;
  phone?: string | null;
  email?: string | null;
  schedule?: Record<string, string> | null;
  /** WKT: `POINT(lng lat)`. */
  location?: string | null;
  isActive?: boolean;
  priority?: number;
  image?: string | null;
}

/** Marca tal como la devuelve `/landing/brands` (ids como string). */
export interface LandingBrand {
  id?: number | string;
  code?: string;
  name: string;
  slug?: string;
  description?: string;
  image?: string | null;
}

export interface BenefitItem {
  id: number;
  /** Nombre del ícono Lucide del web ("Truck", "MapPin", …). */
  icon: string;
  title: string;
  desc: string;
}

export interface FooterLink {
  label: string;
  url: string;
}

export interface FooterConfig {
  hours?: string;
  contact?: {
    email?: string;
    phone?: string;
    address?: string;
    whatsapp?: string;
  };
  helpLinks?: FooterLink[];
  description?: string;
  socialLinks?: { label?: string; url: string }[];
  categoryCodes?: string[];
  resolvedCategories?: { id: number; code: string; name: string }[];
}

/** Oferta destacada (tarjeta grande con degradado). */
export interface DealFeaturedItem {
  id: number;
  title: string;
  subtitle?: string;
  image?: string;
  price: number;
  originalPrice?: number;
  discount?: string;
  unit?: string;
  bgFrom?: string;
  bgTo?: string;
  endsAt?: string;
  productIds?: number[];
  startAt?: string | null;
  endAt?: string | null;
}

export interface DailyDealsConfig {
  featuredItems: DealFeaturedItem[];
  carousel: Product[];
}

export interface FeaturedTab {
  id: number;
  name: string;
  slug: string;
  position: number;
}

/** Config general de la tienda (`/landing/general`): logo y nombre. */
export interface StoreGeneral {
  url?: string;
  title?: string;
}

export type PopupPosition = "left" | "right" | "top" | "bottom";

export interface Popup {
  id: number;
  title?: string;
  image?: string;
  position?: PopupPosition | string;
  filterConfig?: Record<string, unknown> | null;
  durationMs?: number | null;
  delayMs?: number | null;
  maxHeight?: number | null;
  isActive?: boolean;
}
