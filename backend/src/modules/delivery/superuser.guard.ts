import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: { isSuperuser?: boolean };
}

/**
 * Restringe una ruta a usuarios administradores (users.isSuperuser = true).
 * Se usa junto a JwtAuthGuard, que ya puebla request.user desde la BD.
 */
@Injectable()
export class SuperuserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.isSuperuser) {
      throw new ForbiddenException('Se requiere un usuario administrador.');
    }
    return true;
  }
}
