import { createContext, useContext, type ReactNode } from "react";
import type { UserProfile } from "../services/auth.service";
import { hasPermission } from "./permissions";

/**
 * Contexto ligero con el perfil autenticado. `App` lo puebla al iniciar sesión
 * y las vistas lo consultan para decidir qué acciones de escritura muestran.
 */
const AuthContext = createContext<UserProfile | null>(null);

export function AuthProvider({
  user,
  children,
}: {
  user: UserProfile | null;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

/** Perfil autenticado actual (o `null` si no hay sesión). */
export function useAuth(): UserProfile | null {
  return useContext(AuthContext);
}

/**
 * Atajo: ¿el usuario actual puede realizar la acción indicada por `code`?
 * Devuelve `true` si `code` es vacío (sin restricción) o si es superusuario.
 */
export function useCan(code?: string | null): boolean {
  const user = useContext(AuthContext);
  return hasPermission(user, code);
}
