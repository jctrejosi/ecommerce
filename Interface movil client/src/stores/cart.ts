import { create } from "zustand";
import type { CartItem, Product } from "../api/types";

interface CartState {
  items: CartItem[];
  add: (p: Product, quantity?: number) => void;
  remove: (id: number) => void;
  setQuantity: (id: number, quantity: number) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

  add: (p, quantity = 1) =>
    set((state) => {
      const existing = state.items.find((i) => i.id === p.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.id === p.id ? { ...i, quantity: i.quantity + quantity } : i,
          ),
        };
      }
      return { items: [...state.items, { ...p, quantity }] };
    }),

  remove: (id) =>
    set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

  setQuantity: (id, quantity) =>
    set((state) => ({
      items:
        quantity <= 0
          ? state.items.filter((i) => i.id !== id)
          : state.items.map((i) => (i.id === id ? { ...i, quantity } : i)),
    })),

  clear: () => set({ items: [] }),

  count: () => get().items.reduce((acc, i) => acc + i.quantity, 0),

  subtotal: () =>
    get().items.reduce((acc, i) => acc + i.price * i.quantity, 0),
}));
