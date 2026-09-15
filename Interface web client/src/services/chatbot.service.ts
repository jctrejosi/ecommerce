const BOT_API_URL = (import.meta.env.VITE_BOT_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000"));

export type BotProduct = {
  product_id: number;
  variant_id: number;
  external_id?: string | null;
  slug: string;
  name: string;
  plu?: string | null;
  description?: string | null;
  price: number;
  compare_price?: number | null;
  category: string;
  brand: string;
  image?: string | null;
  stock?: number | null;
  images?: string[];
};

export type BotCartItem = {
  variant_id: number;
  product_id: number;
  name: string;
  slug: string;
  price: number;
  quantity: number;
  subtotal: number;
  image?: string | null;
};

export type BotCart = {
  session_id: string;
  items: BotCartItem[];
  count: number;
  total: number;
};

export type BotRecipe = {
  nombre: string;
  pasos: string[];
  agregados: (BotProduct & { cantidad?: number })[];
  ya_en_carrito?: string[];
  no_encontrados: string[];
  agotados: string[];
  dudosos: string[];
};

export type BotPayload = {
  products?: BotProduct[];
  cart?: BotCart;
  checkout?: boolean;
  receta?: BotRecipe;
};

export type BotHistoryMessage = { role: "user" | "assistant"; content: string };

export type BotQuickOption = {
  id: string;
  label: string;
  message: string;
};

export const chatbotService = {
  async getOptions(): Promise<BotQuickOption[]> {
    try {
      const res = await fetch(`${BOT_API_URL}/chat/options`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.options ?? [];
    } catch {
      return [];
    }
  },

  async sendMessage(
    message: string,
    sessionId: string,
    history: BotHistoryMessage[],
  ): Promise<{ reply: string; session_id: string; payload: BotPayload }> {
    const res = await fetch(`${BOT_API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId, history }),
    });
    if (!res.ok) {
      throw new Error("No se pudo contactar al asistente");
    }
    return res.json();
  },

  // ── Carrito del bot (modal) ─────────────────────────────────

  async getCart(sessionId: string): Promise<BotCart> {
    const res = await fetch(
      `${BOT_API_URL}/cart?session_id=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) throw new Error("No se pudo obtener el carrito");
    return res.json();
  },

  async addCartItem(
    sessionId: string,
    productId: number,
    quantity = 1,
  ): Promise<BotCart> {
    const res = await fetch(`${BOT_API_URL}/cart/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, product_id: productId, quantity }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || "No se pudo agregar el producto");
    }
    return res.json();
  },

  async setCartItem(
    sessionId: string,
    productId: number,
    quantity: number,
  ): Promise<BotCart> {
    const res = await fetch(`${BOT_API_URL}/cart/items/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, product_id: productId, quantity }),
    });
    if (!res.ok) throw new Error("No se pudo actualizar el carrito");
    return res.json();
  },

  async searchProducts(query: string): Promise<BotProduct[]> {
    const res = await fetch(
      `${BOT_API_URL}/catalog/search?query=${encodeURIComponent(query)}&limite=8`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.products ?? [];
  },

  /** Arma la lista sugerida de base en el carrito del bot (si está vacío). */
  async suggestCart(
    sessionId: string,
    limit = 6,
  ): Promise<{ cart: BotCart; products: BotProduct[] }> {
    const res = await fetch(`${BOT_API_URL}/cart/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, limite: limit }),
    });
    if (!res.ok) throw new Error("No se pudo armar la lista sugerida");
    return res.json();
  },
};
