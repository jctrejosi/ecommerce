import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

export interface PermissionRequirement {
  /** Prefijo de módulo, p. ej. `admin:catalog` → `<módulo>:view|manage`. */
  module?: string;
  /** Códigos exactos aceptados (cualquiera de ellos). */
  any?: string[];
}

/**
 * Exige permisos concretos (cualquiera de los códigos indicados).
 * El superusuario siempre pasa.
 */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, { any: codes } as PermissionRequirement);

/**
 * Exige permisos por módulo: `<module>:view` para lecturas y
 * `<module>:manage` para escrituras. Tener `manage` también permite leer.
 */
export const RequireModule = (module: string) =>
  SetMetadata(PERMISSIONS_KEY, { module } as PermissionRequirement);
