import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { shelves, userBranches, users } from '../../../drizzle/schema';

/**
 * Alcance por sucursal de un administrador del picking.
 *
 * Reglas:
 *  - **Admin global**: superusuario **sin** sucursal → alcance `null` (ve todo).
 *  - **Admin de sucursal**: superusuario **con** sucursal → alcance = su
 *    sucursal (solo ve/gestiona lo suyo).
 *  - Cualquier otro usuario (pickers, sin token, no-superuser) → `null`, para no
 *    romper a los pickers de la app móvil (que siguen operando por el
 *    `branchId` de cada pedido).
 */
@Injectable()
export class BranchScopeService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /**
   * Sucursal que debe forzarse para el usuario, o `null` si no aplica alcance.
   */
  async scopeOf(userId: number | null | undefined): Promise<number | null> {
    if (userId == null || !Number.isInteger(userId) || userId <= 0) return null;

    const [u] = await this.db
      .select({ isSuperuser: users.isSuperuser })
      .from(users)
      .where(and(eq(users.id, BigInt(userId)), isNull(users.deletedAt)))
      .limit(1);
    if (!u?.isSuperuser) return null;

    const [b] = await this.db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(eq(userBranches.userId, userId))
      .limit(1);
    return b ? Number(b.branchId) : null;
  }

  /** Sucursal (branchId) de una estantería, o `null` si no existe. */
  async shelfBranch(shelfId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ branchId: shelves.branchId })
      .from(shelves)
      .where(eq(shelves.id, BigInt(shelfId)))
      .limit(1);
    return row ? Number(row.branchId) : null;
  }

  /** Sucursal (branchId) asignada a un usuario, o `null` si no tiene. */
  async userBranch(userId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(eq(userBranches.userId, userId))
      .limit(1);
    return row ? Number(row.branchId) : null;
  }
}
