import { create } from "zustand";

interface GateState {
  /** Si ya se confirmó el ingreso en este arranque de la app. */
  confirmed: boolean;
  /** Confirma el ingreso (continuar con la sesión guardada / login OK). */
  confirm: () => void;
  /** Pide el login de nuevo (cambio de usuario). */
  request: () => void;
}

/** Controla la pantalla de login global (se muestra sobre cualquier pantalla). */
export const useGateStore = create<GateState>((set) => ({
  confirmed: false,
  confirm: () => set({ confirmed: true }),
  request: () => set({ confirmed: false }),
}));
