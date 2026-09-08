import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { AuthTokens } from "@/api/types";

const ACCESS_KEY = "dsi_delivery_access_token";
const REFRESH_KEY = "dsi_delivery_refresh_token";
const USER_KEY = "dsi_delivery_user";

/**
 * SecureStore no existe en web: se usa localStorage (solo para previsualizar
 * en navegador; en dispositivo siempre SecureStore/Keychain).
 */
const isWeb = Platform.OS === "web";

const webStorage = {
  get(key: string): string | null {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {
      /* noop */
    }
  },
  remove(key: string): void {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};

async function getItem(key: string): Promise<string | null> {
  if (isWeb) return webStorage.get(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) return webStorage.set(key, value);
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* noop */
  }
}

async function removeItem(key: string): Promise<void> {
  if (isWeb) return webStorage.remove(key);
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* noop */
  }
}

export async function getTokens(): Promise<AuthTokens | null> {
  const accessToken = await getItem(ACCESS_KEY);
  const refreshToken = await getItem(REFRESH_KEY);
  if (!accessToken) return null;
  return { accessToken, refreshToken: refreshToken ?? undefined, expiresIn: 3600 };
}

export async function setTokens(tokens: AuthTokens): Promise<void> {
  await setItem(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) await setItem(REFRESH_KEY, tokens.refreshToken);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    removeItem(ACCESS_KEY),
    removeItem(REFRESH_KEY),
    removeItem(USER_KEY),
  ]);
}

export async function saveCachedUser(userJson: string): Promise<void> {
  await setItem(USER_KEY, userJson);
}

export async function getCachedUser(): Promise<string | null> {
  return getItem(USER_KEY);
}

export async function clearCachedUser(): Promise<void> {
  await removeItem(USER_KEY);
}
