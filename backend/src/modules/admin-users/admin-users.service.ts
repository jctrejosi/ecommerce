import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DrizzleService } from '../../database/drizzle.service';
import {
  deliveryDrivers,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../../../drizzle/schema';

/** Interfaces de usuario que conviven en la tabla `users`. */
export type UserKind = 'admin' | 'picking' | 'delivery';

interface UserRow {
  id: bigint;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isSuperuser: boolean;
  isActive: boolean;
  isPicker: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  driverId: bigint | null;
}

interface RoleRow {
  id: bigint;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Catálogo de permisos agrupado por interface (módulo). */
const PERMISSION_CATALOG: {
  code: string;
  module: string;
  description: string;
}[] = [
  // ── Web admin (esta interface) ───────────────────────────────────────────
  {
    code: 'admin:dashboard:view',
    module: 'admin',
    description: 'Ver dashboard',
  },
  {
    code: 'admin:catalog:view',
    module: 'admin',
    description: 'Ver catálogo (productos, categorías, marcas, tipos)',
  },
  {
    code: 'admin:catalog:manage',
    module: 'admin',
    description: 'Crear/editar/eliminar catálogo',
  },
  { code: 'admin:orders:view', module: 'admin', description: 'Ver pedidos' },
  {
    code: 'admin:orders:manage',
    module: 'admin',
    description: 'Gestionar pedidos',
  },
  {
    code: 'admin:customers:view',
    module: 'admin',
    description: 'Ver clientes',
  },
  {
    code: 'admin:customers:manage',
    module: 'admin',
    description: 'Gestionar clientes',
  },
  {
    code: 'admin:promotions:manage',
    module: 'admin',
    description: 'Gestionar promociones',
  },
  {
    code: 'admin:content:manage',
    module: 'admin',
    description: 'Gestionar contenido (banners, homepage)',
  },
  {
    code: 'admin:settings:manage',
    module: 'admin',
    description: 'Gestionar configuración',
  },
  {
    code: 'admin:users:view',
    module: 'admin',
    description: 'Ver usuarios y permisos',
  },
  {
    code: 'admin:users:manage',
    module: 'admin',
    description: 'Gestionar usuarios, roles y permisos',
  },
  // ── Delivery admin ──────────────────────────────────────────────────────
  {
    code: 'delivery:dashboard:view',
    module: 'delivery',
    description: 'Ver panel de flota',
  },
  {
    code: 'delivery:drivers:view',
    module: 'delivery',
    description: 'Ver repartidores',
  },
  {
    code: 'delivery:drivers:manage',
    module: 'delivery',
    description: 'Crear/editar repartidores',
  },
  {
    code: 'delivery:orders:view',
    module: 'delivery',
    description: 'Ver pedidos de reparto',
  },
  {
    code: 'delivery:orders:assign',
    module: 'delivery',
    description: 'Asignar pedidos a repartidores',
  },
  // ── Picking admin ───────────────────────────────────────────────────────
  {
    code: 'picking:dashboard:view',
    module: 'picking',
    description: 'Ver panel de picking',
  },
  {
    code: 'picking:users:view',
    module: 'picking',
    description: 'Ver usuarios de picking',
  },
  {
    code: 'picking:users:manage',
    module: 'picking',
    description: 'Crear/editar usuarios de picking',
  },
  {
    code: 'picking:orders:view',
    module: 'picking',
    description: 'Ver pedidos de alistamiento',
  },
  {
    code: 'picking:metrics:view',
    module: 'picking',
    description: 'Ver métricas de picking',
  },
];

/** Roles por defecto que se crean la primera vez (idempotente). */
const DEFAULT_ROLES: {
  name: string;
  description: string;
  permissionCodes: string[];
}[] = [
  {
    name: 'Administrador',
    description:
      'Acceso total a las interfaces de administración, delivery y picking.',
    permissionCodes: PERMISSION_CATALOG.map((p) => p.code),
  },
  {
    name: 'Supervisor',
    description:
      'Operación diaria: catálogo, pedidos, clientes y vista de flota/picking.',
    permissionCodes: [
      'admin:dashboard:view',
      'admin:catalog:view',
      'admin:catalog:manage',
      'admin:orders:view',
      'admin:orders:manage',
      'admin:customers:view',
      'admin:customers:manage',
      'admin:promotions:manage',
      'admin:content:manage',
      'admin:users:view',
      'delivery:dashboard:view',
      'delivery:drivers:view',
      'delivery:orders:view',
      'delivery:orders:assign',
      'picking:dashboard:view',
      'picking:users:view',
      'picking:orders:view',
      'picking:metrics:view',
    ],
  },
  {
    name: 'Consulta',
    description: 'Solo lectura de las tres interfaces (usuario de consulta).',
    permissionCodes: PERMISSION_CATALOG.filter((p) =>
      p.code.endsWith(':view'),
    ).map((p) => p.code),
  },
];

@Injectable()
export class AdminUsersService implements OnModuleInit {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async onModuleInit() {
    await this.seedDefaults().catch((error) => {
      this.logger.error(
        `No se pudieron sembrar roles/permisos: ${String(error)}`,
      );
    });
  }

  /** Siembra permisos, roles por defecto y sus permisos (idempotente). */
  private async seedDefaults() {
    const [anyPermission] = await this.db
      .select({ id: permissions.id })
      .from(permissions)
      .limit(1);

    if (!anyPermission) {
      await this.db.insert(permissions).values(PERMISSION_CATALOG);
    }

    const existingRoles = await this.db.select({ id: roles.id }).from(roles);
    if (existingRoles.length > 0) return;

    for (const def of DEFAULT_ROLES) {
      const [role] = await this.db
        .insert(roles)
        .values({
          name: def.name,
          description: def.description,
          isSystem: true,
        })
        .returning({ id: roles.id });

      const permRows = await this.db
        .select({ id: permissions.id, code: permissions.code })
        .from(permissions)
        .where(inArray(permissions.code, def.permissionCodes));

      if (permRows.length) {
        await this.db
          .insert(rolePermissions)
          .values(
            permRows.map((p) => ({
              roleId: Number(role.id),
              permissionId: Number(p.id),
            })),
          )
          .onConflictDoNothing();
      }
    }

    this.logger.log('Roles y permisos por defecto sembrados correctamente.');
  }

  // ─── Usuarios ────────────────────────────────────────────────────────────

  private nameOf(u: { firstName: string; lastName: string }): string {
    return `${u.firstName} ${u.lastName}`.trim();
  }

  private toUser(
    row: UserRow,
    roleMap: Map<number, { id: number; name: string }[]>,
  ) {
    const kinds: UserKind[] = [];
    if (row.isPicker) kinds.push('picking');
    if (row.driverId != null) kinds.push('delivery');
    if (kinds.length === 0) kinds.push('admin');
    return {
      id: Number(row.id),
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: this.nameOf(row),
      email: row.email,
      username: row.username,
      phone: row.phone,
      isSuperuser: row.isSuperuser,
      isActive: row.isActive,
      isPicker: row.isPicker,
      kinds,
      driverId: row.driverId != null ? Number(row.driverId) : null,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      roles: roleMap.get(Number(row.id)) ?? [],
    };
  }

  private async loadRoleMap() {
    const [allRoles, allUserRoles] = await Promise.all([
      this.db
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .orderBy(asc(roles.name)),
      this.db
        .select({ userId: userRoles.userId, roleId: userRoles.roleId })
        .from(userRoles),
    ]);

    const map = new Map<number, { id: number; name: string }[]>();
    for (const ur of allUserRoles) {
      const role = allRoles.find((r) => Number(r.id) === ur.roleId);
      if (!role) continue;
      const list = map.get(ur.userId) ?? [];
      list.push({ id: Number(role.id), name: role.name });
      map.set(ur.userId, list);
    }
    return map;
  }

  /** Lista unificada de usuarios de panel (admin + picking + delivery). */
  async listUsers(kind?: UserKind) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        isSuperuser: users.isSuperuser,
        isActive: users.isActive,
        isPicker: users.isPicker,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        driverId: deliveryDrivers.id,
      })
      .from(users)
      .leftJoin(
        deliveryDrivers,
        and(
          eq(deliveryDrivers.authUserId, users.id),
          isNull(deliveryDrivers.deletedAt),
        ),
      )
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.firstName), asc(users.lastName));

    const roleMap = await this.loadRoleMap();

    return rows
      .map((r) => this.toUser(r, roleMap))
      .filter((u) => !kind || u.kinds.includes(kind));
  }

  private async findUserRow(id: number) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        isSuperuser: users.isSuperuser,
        isActive: users.isActive,
        isPicker: users.isPicker,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(and(eq(users.id, BigInt(id)), isNull(users.deletedAt)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('Usuario no encontrado');
    return rows[0];
  }

  private async assertUniqueEmailUsername(
    email: string,
    username: string,
    excludeId?: number,
  ) {
    const emailNorm = email.trim().toLowerCase();
    const usernameNorm = username.trim();
    const conflicts: SQL[] = [];
    conflicts.push(eq(users.email, emailNorm));
    conflicts.push(eq(users.username, usernameNorm));
    const conditions = excludeId
      ? and(or(...conflicts), ne(users.id, BigInt(excludeId)))
      : or(...conflicts);
    const dup = await this.db
      .select({ id: users.id })
      .from(users)
      .where(conditions)
      .limit(1);
    if (dup.length) {
      throw new ConflictException(
        'Ya existe un usuario con ese email o nombre de usuario.',
      );
    }
  }

  private async replaceUserRoles(userId: number, roleIds: number[]) {
    await this.db.delete(userRoles).where(eq(userRoles.userId, userId));
    if (roleIds.length) {
      await this.db
        .insert(userRoles)
        .values(roleIds.map((roleId) => ({ userId, roleId })))
        .onConflictDoNothing();
    }
  }

  private async createDriverRow(
    userId: number,
    data: {
      fullName: string;
      phone: string | null;
      email: string;
      vehicleType?: string;
    },
  ) {
    await this.db.insert(deliveryDrivers).values({
      fullName: data.fullName,
      phone: data.phone || '',
      email: data.email,
      authUserId: userId,
      vehicleType: data.vehicleType?.trim() || 'MOTO',
      isAvailable: true,
      isActive: true,
    });
  }

  /** Crea un usuario de panel (web admin / picking / delivery). */
  async createUser(dto: {
    fullName: string;
    username: string;
    email: string;
    phone?: string;
    password: string;
    isSuperuser?: boolean;
    isActive?: boolean;
    isPicker?: boolean;
    isDelivery?: boolean;
    vehicleType?: string;
    roleIds?: number[];
  }) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();
    await this.assertUniqueEmailUsername(email, username);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const parts = dto.fullName.trim().split(/\s+/);
    const [row] = await this.db
      .insert(users)
      .values({
        email,
        username,
        passwordHash,
        firstName: parts[0] || dto.fullName.trim(),
        lastName: parts.slice(1).join(' '),
        phone: dto.phone?.trim() || null,
        isSuperuser: dto.isSuperuser ?? false,
        isActive: dto.isActive ?? true,
        isPicker: dto.isPicker ?? false,
      })
      .returning({ id: users.id });

    await this.replaceUserRoles(Number(row.id), dto.roleIds ?? []);

    if (dto.isDelivery) {
      await this.createDriverRow(Number(row.id), {
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        email,
        vehicleType: dto.vehicleType,
      });
    }

    this.logger.log(`Usuario de panel creado: ${username}`);
    return this.getUser(Number(row.id));
  }

  async getUser(id: number) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        isSuperuser: users.isSuperuser,
        isActive: users.isActive,
        isPicker: users.isPicker,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        driverId: deliveryDrivers.id,
      })
      .from(users)
      .leftJoin(
        deliveryDrivers,
        and(
          eq(deliveryDrivers.authUserId, users.id),
          isNull(deliveryDrivers.deletedAt),
        ),
      )
      .where(and(eq(users.id, BigInt(id)), isNull(users.deletedAt)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('Usuario no encontrado');
    const roleMap = await this.loadRoleMap();
    return this.toUser(rows[0], roleMap);
  }

  async updateUser(
    id: number,
    dto: {
      fullName?: string;
      username?: string;
      email?: string;
      phone?: string;
      isSuperuser?: boolean;
      isActive?: boolean;
      isPicker?: boolean;
      isDelivery?: boolean;
      vehicleType?: string;
      roleIds?: number[];
    },
  ) {
    const current = await this.findUserRow(id);

    if (dto.email !== undefined || dto.username !== undefined) {
      await this.assertUniqueEmailUsername(
        dto.email ?? current.email,
        dto.username ?? current.username,
        id,
      );
    }

    const patch: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (dto.fullName !== undefined) {
      const parts = dto.fullName.trim().split(/\s+/);
      patch.firstName = parts[0] || dto.fullName.trim();
      patch.lastName = parts.slice(1).join(' ');
    }
    if (dto.username !== undefined) patch.username = dto.username.trim();
    if (dto.email !== undefined) patch.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) patch.phone = dto.phone.trim() || null;
    if (dto.isSuperuser !== undefined) patch.isSuperuser = dto.isSuperuser;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.isPicker !== undefined) patch.isPicker = dto.isPicker;

    await this.db
      .update(users)
      .set(patch)
      .where(eq(users.id, BigInt(id)));

    if (dto.roleIds !== undefined) {
      await this.replaceUserRoles(id, dto.roleIds);
    }

    await this.syncDriver(id, dto, patch, current);

    return this.getUser(id);
  }

  private async syncDriver(
    userId: number,
    dto: {
      isDelivery?: boolean;
      vehicleType?: string;
    },
    patch: Partial<typeof users.$inferInsert>,
    current: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
    },
  ) {
    if (dto.isDelivery === undefined && dto.vehicleType === undefined) return;

    const existing = await this.db
      .select({ id: deliveryDrivers.id })
      .from(deliveryDrivers)
      .where(
        and(
          eq(deliveryDrivers.authUserId, userId),
          isNull(deliveryDrivers.deletedAt),
        ),
      )
      .limit(1);

    if (dto.isDelivery === false) {
      if (existing.length) {
        await this.db
          .update(deliveryDrivers)
          .set({
            deletedAt: new Date().toISOString(),
            isActive: false,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(deliveryDrivers.id, existing[0].id));
      }
      return;
    }

    if (dto.isDelivery === true) {
      if (existing.length) {
        await this.db
          .update(deliveryDrivers)
          .set({ isActive: true, updatedAt: new Date().toISOString() })
          .where(eq(deliveryDrivers.id, existing[0].id));
        if (dto.vehicleType !== undefined) {
          await this.db
            .update(deliveryDrivers)
            .set({
              vehicleType: dto.vehicleType.trim() || null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(deliveryDrivers.id, existing[0].id));
        }
      } else {
        const fullName = [
          patch.firstName ?? current.firstName,
          patch.lastName ?? current.lastName,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
        await this.createDriverRow(userId, {
          fullName,
          phone: (patch.phone ?? current.phone) || null,
          email: patch.email ?? current.email,
          vehicleType: dto.vehicleType,
        });
      }
      return;
    }

    if (dto.vehicleType !== undefined && existing.length) {
      await this.db
        .update(deliveryDrivers)
        .set({
          vehicleType: dto.vehicleType.trim() || null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(deliveryDrivers.id, existing[0].id));
    }
  }

  async resetPassword(id: number, password: string) {
    await this.findUserRow(id);
    const passwordHash = await bcrypt.hash(password, 10);
    await this.db
      .update(users)
      .set({
        passwordHash,
        lockedUntil: null,
        failedAttempts: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, BigInt(id)));
    return { success: true };
  }

  // ─── Roles ───────────────────────────────────────────────────────────────

  private async roleCounts() {
    const [userRows, permRows] = await Promise.all([
      this.db
        .select({ roleId: userRoles.roleId, n: userRoles.userId })
        .from(userRoles),
      this.db
        .select({
          roleId: rolePermissions.roleId,
          n: rolePermissions.permissionId,
        })
        .from(rolePermissions),
    ]);

    const userCount = new Map<number, number>();
    for (const r of userRows)
      userCount.set(r.roleId, (userCount.get(r.roleId) ?? 0) + 1);

    const permCount = new Map<number, number>();
    for (const r of permRows)
      permCount.set(r.roleId, (permCount.get(r.roleId) ?? 0) + 1);

    return { userCount, permCount };
  }

  private toRole(row: RoleRow, userCount: number, permCount: number) {
    return {
      id: Number(row.id),
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userCount,
      permissionCount: permCount,
    };
  }

  async listRoles() {
    const [rows, counts] = await Promise.all([
      this.db.select().from(roles).orderBy(asc(roles.name)),
      this.roleCounts(),
    ]);
    return rows.map((r) =>
      this.toRole(
        r,
        counts.userCount.get(Number(r.id)) ?? 0,
        counts.permCount.get(Number(r.id)) ?? 0,
      ),
    );
  }

  private async findRoleRow(id: number) {
    const rows = await this.db
      .select()
      .from(roles)
      .where(eq(roles.id, BigInt(id)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('Rol no encontrado');
    return rows[0];
  }

  async createRole(dto: { name: string; description?: string }) {
    const name = dto.name.trim();
    const existing = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, name))
      .limit(1);
    if (existing.length) {
      throw new ConflictException('Ya existe un rol con ese nombre.');
    }
    const [row] = await this.db
      .insert(roles)
      .values({
        name,
        description: dto.description?.trim() || null,
        isSystem: false,
      })
      .returning();
    return this.toRole(row, 0, 0);
  }

  async updateRole(id: number, dto: { name?: string; description?: string }) {
    await this.findRoleRow(id);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const dup = await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.name, name), ne(roles.id, BigInt(id))))
        .limit(1);
      if (dup.length)
        throw new ConflictException('Ya existe un rol con ese nombre.');
    }

    const patch: Partial<typeof roles.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined)
      patch.description = dto.description.trim() || null;

    await this.db
      .update(roles)
      .set(patch)
      .where(eq(roles.id, BigInt(id)));
    const counts = await this.roleCounts();
    const [updated] = await this.db
      .select()
      .from(roles)
      .where(eq(roles.id, BigInt(id)))
      .limit(1);
    return this.toRole(
      updated,
      counts.userCount.get(id) ?? 0,
      counts.permCount.get(id) ?? 0,
    );
  }

  async deleteRole(id: number) {
    const role = await this.findRoleRow(id);
    if (role.isSystem) {
      throw new ConflictException('No se puede eliminar un rol del sistema.');
    }
    await this.db.delete(roles).where(eq(roles.id, BigInt(id)));
    return { success: true };
  }

  // ─── Permisos ────────────────────────────────────────────────────────────

  async listPermissions() {
    const rows = await this.db
      .select({
        id: permissions.id,
        code: permissions.code,
        module: permissions.module,
        description: permissions.description,
      })
      .from(permissions)
      .orderBy(asc(permissions.module), asc(permissions.code));

    const grouped: Record<
      string,
      { id: number; code: string; description: string | null }[]
    > = {};
    for (const p of rows) {
      (grouped[p.module] ??= []).push({
        id: Number(p.id),
        code: p.code,
        description: p.description,
      });
    }
    return Object.entries(grouped).map(([module, perms]) => ({
      module,
      permissions: perms,
    }));
  }

  async getRolePermissions(id: number) {
    await this.findRoleRow(id);
    const rows = await this.db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, id));
    return {
      roleId: id,
      permissionCodes: rows.map((r) => r.code),
    };
  }

  async setRolePermissions(id: number, codes: string[]) {
    await this.findRoleRow(id);

    const permRows = await this.db
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(inArray(permissions.code, codes));

    const found = new Set(permRows.map((p) => p.code));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length) {
      throw new NotFoundException(
        `Permisos no encontrados: ${missing.join(', ')}`,
      );
    }

    await this.drizzle.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (permRows.length) {
        await tx.insert(rolePermissions).values(
          permRows.map((p) => ({
            roleId: id,
            permissionId: Number(p.id),
          })),
        );
      }
    });

    return this.getRolePermissions(id);
  }
}
