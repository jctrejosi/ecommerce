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
