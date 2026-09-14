import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKENS_KEY = "picking.tokens";
const USER_KEY = "picking.user";

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  email: string;
  isSuperuser: boolean;
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
