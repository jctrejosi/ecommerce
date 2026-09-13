import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PICKER_KEY = "picking.pickerId";

interface PickerState {
  pickerId: number | null;
  pickerName: string | null;
  hydrated: boolean;
  restore: () => Promise<void>;
  select: (id: number, name: string) => Promise<void>;
  clear: () => Promise<void>;
}

/** Picker activo: se elige de `/picking-admin/pickers` y se persiste localmente. */
export const usePickerStore = create<PickerState>((set) => ({
  pickerId: null,
  pickerName: null,
  hydrated: false,

  restore: async () => {
    try {
      const raw = await AsyncStorage.getItem(PICKER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { id?: number; name?: string };
        if (parsed?.id) {
          set({ pickerId: parsed.id, pickerName: parsed.name ?? null });
        }
      }
    } catch {
      /* sin sesión previa */
    } finally {
      set({ hydrated: true });
    }
  },

  select: async (id, name) => {
    set({ pickerId: id, pickerName: name });
    await AsyncStorage.setItem(PICKER_KEY, JSON.stringify({ id, name }));
  },

  clear: async () => {
    set({ pickerId: null, pickerName: null });
    await AsyncStorage.removeItem(PICKER_KEY);
  },
}));
