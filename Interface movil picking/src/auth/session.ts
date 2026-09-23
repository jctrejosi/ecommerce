import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKENS_KEY = "picking.tokens";
const USER_KEY = "picking.user";
const META_KEY = "picking.sessionMeta";

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
}

/** Metadatos de la sesión para el vencimiento por turno/inactividad. */
export interface SessionMeta {
  loginAt: number;
  lastActivityAt: number;
  /** Fin del turno (epoch ms). null = sin horario configurado. */
  shiftEndAt: number | null;
}

export async function getSessionMeta(): Promise<SessionMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as SessionMeta) : null;
  } catch {
    return null;
  }
}

export async function setSessionMeta(meta: SessionMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* noop */
  }
}

export async function clearSessionMeta(): Promise<void> {
  try {
    await AsyncStorage.removeItem(META_KEY);
  } catch {
    /* noop */
  }
}

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  email: string;
  isSuperuser: boolean;
  /** Foto de perfil (Cloudinary); la misma que muestra el panel de picking. */
  avatarUrl?: string | null;
}

export async function getTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

export async function setTokens(tokens: StoredTokens): Promise<void> {
  try {
    await AsyncStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    /* noop */
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TOKENS_KEY);
  } catch {
    /* noop */
  }
}

export async function getStoredUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export async function setStoredUser(user: AuthUser | null): Promise<void> {
  try {
    if (user) await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    else await AsyncStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
}
