import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Igual que `JwtAuthGuard` pero **no exige** token: si no hay usuario válido deja
 * pasar la petición con `request.user` vacío.
 *
 * Se usa en endpoints que son públicos pero cambian de comportamiento cuando hay
 * un picker autenticado; por ejemplo, `GET /picking/orders` filtra la cola por la
 * sucursal del picker solo si viene el token, y sin token devuelve todo.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context) as boolean | Promise<boolean>;
  }

  handleRequest<TUser = unknown>(_err: unknown, user: TUser | false): TUser | undefined {
    // Token ausente o inválido: se continúa sin usuario (no se lanza 401).
    return user || undefined;
  }
}
