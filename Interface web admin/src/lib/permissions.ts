import type { UserProfile } from "../services/auth.service";

/**
 * ¿El usuario tiene el permiso indicado?
 *
 * - `undefined`/vacío: no restringe.
 * - Superusuario: siempre.
 * - Tener `<módulo>:manage` implica `<módulo>:view`.
 */
export function hasPermission(
  user: UserProfile | null | undefined,
  code?: string | null,
): boolean {
  if (!code) return true;
  if (!user) return false;
  if (user.isSuperuser) return true;

  const granted = new Set(user.permissions ?? []);
  if (granted.has("*") || granted.has(code)) return true;

  // Igual que el guard del backend: un permiso grueso del módulo
  // (`<app>:<módulo>:manage`) habilita todo el submódulo, y un `:view` grueso
  // habilita las lecturas. Permite chequear códigos finos contra roles que
  // tengan el comodín grueso.
  const parts = code.split(":");
  if (parts.length >= 2) {
    const coarse = `${parts[0]}:${parts[1]}`;
    if (granted.has(`${coarse}:manage`)) return true;
    if (parts[parts.length - 1] === "view" && granted.has(`${coarse}:view`)) {
      return true;
    }
  }

  return false;
}
