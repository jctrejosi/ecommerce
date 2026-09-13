import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "picking.session";

export interface PickingSession {
  orderId: number;
  productId: string | null;
}

/**
 * Guarda la sesión de trabajo (pedido + producto) para restaurarla si el
 * sistema operativo mata la app con el escáner abierto — equivalente a la
 * `sessionStorage['picking.session']` de la web.
 */
export async function saveSession(session: PickingSession): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* noop */
  }
}

export async function loadSession(): Promise<PickingSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PickingSession;
    return parsed?.orderId ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}
