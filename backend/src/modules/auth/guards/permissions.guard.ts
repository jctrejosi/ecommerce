import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../../database/drizzle.service';
import {
  permissions,
  rolePermissions,
  userRoles,
} from '../../../../drizzle/schema';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import {
  PERMISSIONS_KEY,
  type PermissionRequirement,
} from '../../../common/decorators/permissions.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Verifica los permisos del usuario autenticado contra el catálogo de
 * `permissions` (roles → permisos). Debe ejecutarse después de `JwtAuthGuard`,
 * que es quien popula `request.user`.
 *
 * - Sin metadata de permisos: no restringe (la ruta solo exige sesión).
 * - `isSuperuser`: acceso total.
 * - `@Public()`: se omite, igual que en `JwtAuthGuard`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly drizzle: DrizzleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Sesión no válida');
    }
    if (user.isSuperuser) return true;

    const userId = Number(user.sub ?? user.id);
    if (!Number.isFinite(userId)) {
      throw new UnauthorizedException('Sesión no válida');
    }

    const isRead = READ_METHODS.has(String(request.method).toUpperCase());
    const required = requirement.module
      ? isRead
        ? [`${requirement.module}:view`, `${requirement.module}:manage`]
        : [`${requirement.module}:manage`]
      : (requirement.any ?? []);

    if (required.length === 0) return true;

    const granted = await this.loadPermissions(userId);
    if (required.some((code) => this.matches(granted, code))) return true;

    throw new ForbiddenException(
      'No tienes permiso para realizar esta acción',
    );
  }

  /**
   * Un permiso requerido se satisface por:
   * - el código exacto;
   * - el permiso grueso del módulo (`<app>:<módulo>:manage`);
   * - si es una lectura, también `<app>:<módulo>:view`.
   *
   * Así `admin:catalog:manage` habilita todo el catálogo y
   * `admin:catalog:view` habilita todas las lecturas del catálogo, mientras
   * que los códigos granulares (`...:products:create`) permiten afinar.
   */
  private matches(granted: Set<string>, required: string): boolean {
    if (granted.has('*') || granted.has(required)) return true;

    const parts = required.split(':');
    if (parts.length < 2) return false;
    const coarse = `${parts[0]}:${parts[1]}`;
    if (granted.has(`${coarse}:manage`)) return true;
    if (parts[parts.length - 1] === 'view' && granted.has(`${coarse}:view`)) {
      return true;
    }
    return false;
  }

  private async loadPermissions(userId: number): Promise<Set<string>> {
    const rows = await this.drizzle.db
      .select({ code: permissions.code })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));

    return new Set(rows.map((row) => row.code));
  }
}
