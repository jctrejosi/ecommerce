import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  branches,
  categories,
  inventory,
  productCategories,
  productLocations,
  productVariants,
  products,
  shelfCategories,
  shelves,
} from '../../../drizzle/schema';

export interface CreateShelfDto {
  branchId: number;
  code: string;
  name: string;
  type?: 'wall' | 'center';
  color?: string;
  width?: number;
  height?: number;
  posX?: number;
  posY?: number;
  rotation?: 0 | 90;
  /** Categorías de la estantería (N:M). */
  categoryIds?: number[];
}

export interface UpdateShelfDto {
  code?: string;
  name?: string;
  type?: 'wall' | 'center';
  color?: string;
  width?: number;
  height?: number;
  posX?: number;
  posY?: number;
  rotation?: 0 | 90;
  /** Categorías de la estantería (N:M); si viene, reemplaza las actuales. */
  categoryIds?: number[];
}

export interface SetLocationDto {
  productVariantId: number;
  branchId: number;
  shelfId: number;
}

@Injectable()
export class ShelvesService {
  private readonly logger = new Logger(ShelvesService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  // ── Sucursales (selector del admin de picking) ─────────────────────────────

  async branches() {
    const rows = await this.db
      .select({
        id: branches.id,
        code: branches.code,
        name: branches.name,
        city: branches.city,
        schedule: branches.schedule,
      })
      .from(branches)
      // Solo sucursales activas: el filtro del panel no debe ofrecer sucursales
      // dadas de baja.
      .where(and(isNull(branches.deletedAt), eq(branches.isActive, true)))
      .orderBy(asc(branches.priority), asc(branches.name));

    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      name: r.name,
      city: r.city,
      schedule: (r.schedule ?? null) as Record<string, string> | null,
    }));
  }

  /** Horario (días → "HH:MM-HH:MM") de una sucursal. */
  async getSchedule(branchId: number) {
    await this.assertBranchExists(branchId);
    const [row] = await this.db
      .select({ schedule: branches.schedule })
      .from(branches)
      .where(eq(branches.id, BigInt(branchId)))
      .limit(1);
    return {
      branchId,
      schedule: (row.schedule ?? {}) as Record<string, string>,
    };
  }

  private readonly DAY_KEYS = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ] as const;

  /** Guarda el horario de una sucursal. */
  async saveSchedule(branchId: number, schedule: Record<string, string>) {
    await this.assertBranchExists(branchId);

    const clean: Record<string, string> = {};
    for (const key of this.DAY_KEYS) {
      const value = schedule[key];
      if (value === undefined || value === null || String(value).trim() === '') continue;
      const v = String(value).trim();
      if (!/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(v)) {
        throw new BadRequestException(
          `Horario inválido para ${key}: use el formato "08:00-20:00"`,
        );
      }
      clean[key] = v.replace(/\s+/g, '');
    }

    await this.db
      .update(branches)
      .set({ schedule: clean })
      .where(eq(branches.id, BigInt(branchId)));

    return { branchId, schedule: clean };
  }

  /**
   * Hora de cierre más tardía entre todas las sucursales para el día actual.
   * La app la usa para vencer la sesión del picker a final del turno.
   */
  async shiftToday() {
    const day = this.DAY_KEYS[(new Date().getDay() + 6) % 7]; // getDay(): 0=domingo
    const rows = await this.db
      .select({ schedule: branches.schedule })
      .from(branches)
      .where(isNull(branches.deletedAt));

    let closeTime: string | null = null;
    for (const row of rows) {
      const sched = (row.schedule ?? {}) as Record<string, string>;
      const range = sched[day];
      if (!range) continue;
      const close = range.split('-')[1]?.trim();
      if (close && (!closeTime || close > closeTime)) closeTime = close;
    }

    return { day, closeTime };
  }

  private async assertBranchExists(branchId: number) {
    const [row] = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, BigInt(branchId)), isNull(branches.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Sucursal ${branchId} no encontrada`);
  }

  private async assertCategoryExists(categoryId: number) {
    const [row] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, BigInt(categoryId)), isNull(categories.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Categoría ${categoryId} no encontrada`);
  }

  /** Valida que todas las categorías existan (asociación N:M de estanterías). */
  private async assertCategories(categoryIds?: number[]) {
    for (const id of [...new Set(categoryIds ?? [])]) {
      await this.assertCategoryExists(Number(id));
    }
  }

  /** Categorías activas para asociar a las estanterías (selector del admin). */
  async categories() {
    const rows = await this.db
      .select({
        id: categories.id,
        name: categories.name,
        parentId: categories.parentId,
        level: categories.level,
      })
      .from(categories)
      .where(and(isNull(categories.deletedAt), eq(categories.isActive, true)))
      .orderBy(asc(categories.displayOrder), asc(categories.name));

    const ids = rows.map((r) => Number(r.id));
    const countRows =
      ids.length > 0
        ? await this.db
            .select({
              categoryId: productCategories.categoryId,
              n: sql<number>`COUNT(*)::int`,
            })
            .from(productCategories)
            .where(inArray(productCategories.categoryId, ids))
            .groupBy(productCategories.categoryId)
        : [];
    const countBy = new Map(countRows.map((c) => [Number(c.categoryId), c.n]));

    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      parentId: r.parentId != null ? Number(r.parentId) : null,
      level: r.level ?? 0,
      productCount: countBy.get(Number(r.id)) ?? 0,
    }));
  }

  /**
   * Organización de una categoría en una sucursal: sus estanterías y los
   * productos de la categoría con su ubicación actual.
   */
  async categoryOrganization(categoryId: number, branchId?: number) {
    const [cat] = await this.db
      .select({
        id: categories.id,
        name: categories.name,
        parentId: categories.parentId,
        level: categories.level,
      })
      .from(categories)
      .where(and(eq(categories.id, BigInt(categoryId)), isNull(categories.deletedAt)))
      .limit(1);
    if (!cat) throw new NotFoundException(`Categoría ${categoryId} no encontrada`);
    if (branchId) await this.assertBranchExists(branchId);

    // Estanterías que incluyen la categoría (en la sucursal si viene).
    const catShelves = await this.db
      .select({
        id: shelves.id,
        branchId: shelves.branchId,
        code: shelves.code,
        name: shelves.name,
        color: shelves.color,
      })
      .from(shelves)
      .innerJoin(shelfCategories, eq(shelfCategories.shelfId, shelves.id))
      .where(
        and(
          eq(shelfCategories.categoryId, categoryId),
          branchId ? eq(shelves.branchId, branchId) : undefined,
        ),
      )
      .orderBy(asc(shelves.code));
    const counts = await this.productCountByShelf();

    // Productos de la categoría (variantes) con su ubicación en la sucursal.
    const prodRows = branchId
      ? await this.db
          .select({
            productVariantId: productVariants.id,
            productId: products.id,
            productName: products.name,
            sku: productVariants.sku,
            barcode: productVariants.barcode,
            stock: inventory.stock,
            shelfId: productLocations.shelfId,
            shelfCode: shelves.code,
            shelfName: shelves.name,
          })
          .from(productCategories)
          .innerJoin(
            productVariants,
            eq(productVariants.productId, productCategories.productId),
          )
          .innerJoin(products, eq(products.id, productVariants.productId))
          .leftJoin(
            inventory,
            and(
              eq(inventory.productVariantId, productVariants.id),
              eq(inventory.branchId, branchId),
            ),
          )
          .leftJoin(
            productLocations,
            and(
              eq(productLocations.productVariantId, productVariants.id),
              eq(productLocations.branchId, branchId),
            ),
          )
          .leftJoin(shelves, eq(shelves.id, productLocations.shelfId))
          .where(eq(productCategories.categoryId, categoryId))
          .orderBy(asc(products.name))
          .limit(1000)
      : [];

    return {
      category: {
        id: Number(cat.id),
        name: cat.name,
        level: cat.level ?? 0,
        parentId: cat.parentId != null ? Number(cat.parentId) : null,
      },
      shelves: catShelves.map((r) => ({
        id: Number(r.id),
        branchId: Number(r.branchId),
        code: r.code,
        name: r.name,
        color: r.color,
        productCount: counts.get(Number(r.id)) ?? 0,
      })),
      products: prodRows.map((r) => ({
        productVariantId: Number(r.productVariantId),
        productId: Number(r.productId),
        productName: r.productName,
        sku: r.sku,
        barcode: r.barcode,
        stock: r.stock ?? 0,
        shelfId: r.shelfId != null ? Number(r.shelfId) : null,
        shelfCode: r.shelfCode ?? null,
        shelfName: r.shelfName ?? null,
      })),
    };
  }

  private async assertShelfExists(id: number) {
    const [row] = await this.db
      .select({ id: shelves.id, branchId: shelves.branchId })
      .from(shelves)
      .where(eq(shelves.id, BigInt(id)))
      .limit(1);
    if (!row) throw new NotFoundException(`Estantería ${id} no encontrada`);
    return { id: Number(row.id), branchId: Number(row.branchId) };
  }

  /** Categorías de varias estanterías (una sola query, sin N+1). */
  private async categoriesByShelf(
    shelfIds: number[],
  ): Promise<Map<number, { id: number; name: string }[]>> {
    const map = new Map<number, { id: number; name: string }[]>();
    if (shelfIds.length === 0) return map;
    const rows = await this.db
      .select({
        shelfId: shelfCategories.shelfId,
        id: categories.id,
        name: categories.name,
      })
      .from(shelfCategories)
      .innerJoin(categories, eq(categories.id, shelfCategories.categoryId))
      .where(inArray(shelfCategories.shelfId, shelfIds))
      .orderBy(asc(categories.name));
    for (const r of rows) {
      const sid = Number(r.shelfId);
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push({ id: Number(r.id), name: r.name });
    }
    return map;
  }

  /** Reemplaza las categorías de una estantería (N:M). */
  private async replaceCategories(shelfId: number, categoryIds: number[]) {
    const ids = [...new Set(categoryIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    await this.db.delete(shelfCategories).where(eq(shelfCategories.shelfId, shelfId));
    if (ids.length === 0) return;
    await this.db
      .insert(shelfCategories)
      .values(ids.map((categoryId) => ({ shelfId, categoryId })))
      .onConflictDoNothing();
  }

  private async productCountByShelf(): Promise<Map<number, number>> {
    const rows = await this.db
      .select({
        shelfId: productLocations.shelfId,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(productLocations)
      .groupBy(productLocations.shelfId);
    return new Map(rows.map((r) => [Number(r.shelfId), r.cnt]));
  }

  // ── Estanterías ────────────────────────────────────────────────────────────

  async listShelves(branchId?: number) {
    if (branchId) await this.assertBranchExists(branchId);
    const rows = await this.db
      .select(getTableColumns(shelves))
      .from(shelves)
      .where(branchId ? eq(shelves.branchId, branchId) : undefined)
      .orderBy(asc(shelves.code));

    const ids = rows.map((r) => Number(r.id));
    // Categorías y conteo en batch (una query cada uno: evita N+1 y agotar el
    // pool del pooler de Supabase).
    const catsByShelf = await this.categoriesByShelf(ids);
    const counts = await this.productCountByShelf();

    return rows.map((r) => ({
      id: Number(r.id),
      branchId: Number(r.branchId),
      code: r.code,
      name: r.name,
      type: r.type,
      color: r.color,
      width: r.width,
      height: r.height,
      posX: r.posX,
      posY: r.posY,
      rotation: r.rotation,
      categories: catsByShelf.get(Number(r.id)) ?? [],
      productCount: counts.get(Number(r.id)) ?? 0,
      // La app móvil todavía lee `rows`; las filas ya no existen.
      rows: [] as { id: number; rowNumber: number; label: string }[],
    }));
  }

  async createShelf(dto: CreateShelfDto) {
    await this.assertBranchExists(dto.branchId);
    await this.assertCategories(dto.categoryIds);
    const code = (dto.code ?? '').trim().toUpperCase();
    if (!code) throw new BadRequestException('El código de la estantería es obligatorio');
    const [dup] = await this.db
      .select({ id: shelves.id })
      .from(shelves)
      .where(and(eq(shelves.branchId, dto.branchId), eq(shelves.code, code)))
      .limit(1);
    if (dup) throw new BadRequestException(`Ya existe una estantería con código ${code}`);

    const [row] = await this.db
      .insert(shelves)
      .values({
        branchId: dto.branchId,
        code,
        name: (dto.name ?? code).trim(),
        type: dto.type ?? 'center',
        color: dto.color ?? '#F59E0B',
        width: dto.width ?? 3,
        height: dto.height ?? 4,
        posX: dto.posX ?? 0,
        posY: dto.posY ?? 0,
        rotation: dto.rotation ?? 0,
      })
      .returning({ id: shelves.id });

    const shelfId = Number(row.id);
    await this.replaceCategories(shelfId, dto.categoryIds ?? []);
    return this.findOne(shelfId);
  }

  async findOne(id: number) {
    const [row] = await this.db
      .select(getTableColumns(shelves))
      .from(shelves)
      .where(eq(shelves.id, BigInt(id)))
      .limit(1);
    if (!row) throw new NotFoundException(`Estantería ${id} no encontrada`);
    const [cnt] = await this.db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(productLocations)
      .where(eq(productLocations.shelfId, id));
    const cats = await this.categoriesByShelf([id]);
    return {
      id: Number(row.id),
      branchId: Number(row.branchId),
      code: row.code,
      name: row.name,
      type: row.type,
      color: row.color,
      width: row.width,
      height: row.height,
      posX: row.posX,
      posY: row.posY,
      rotation: row.rotation,
      categories: cats.get(id) ?? [],
      productCount: cnt?.cnt ?? 0,
    };
  }

  async updateShelf(id: number, dto: UpdateShelfDto) {
    const shelf = await this.assertShelfExists(id);

    if (dto.categoryIds !== undefined) await this.assertCategories(dto.categoryIds);

    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();
      if (!code) throw new BadRequestException('El código de la estantería es obligatorio');
      const [dup] = await this.db
        .select({ id: shelves.id })
        .from(shelves)
        .where(
          and(
            eq(shelves.branchId, shelf.branchId),
            eq(shelves.code, code),
            sql`${shelves.id} <> ${BigInt(id)}`,
          ),
        )
        .limit(1);
      if (dup) throw new BadRequestException(`Ya existe una estantería con código ${code}`);
      dto.code = code;
    }

    const data: Record<string, unknown> = {};
    for (const key of ['code', 'name', 'type', 'color', 'width', 'height', 'posX', 'posY', 'rotation'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (Object.keys(data).length > 0) {
      await this.db
        .update(shelves)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(shelves.id, BigInt(id)));
    }

    if (dto.categoryIds !== undefined) {
      await this.replaceCategories(id, dto.categoryIds);
    }
    return this.findOne(id);
  }

  async deleteShelf(id: number) {
    await this.assertShelfExists(id);
    // Filas y ubicaciones de productos se borran en cascada (FK)
    await this.db.delete(shelves).where(eq(shelves.id, BigInt(id)));
    return { success: true };
  }

  // ── Ubicaciones de productos ───────────────────────────────────────────────

  private async assertShelfInBranch(branchId: number, shelfId: number) {
    const [shelf] = await this.db
      .select({ id: shelves.id, branchId: shelves.branchId })
      .from(shelves)
      .where(eq(shelves.id, BigInt(shelfId)))
      .limit(1);
    if (!shelf) throw new NotFoundException(`Estantería ${shelfId} no encontrada`);
    if (Number(shelf.branchId) !== branchId) {
      throw new BadRequestException('La estantería no pertenece a esa sucursal');
    }
  }

  /** Productos (todas las variantes) + stock en la sucursal + su ubicación. */
  async listProducts(branchId: number, search?: string) {
    await this.assertBranchExists(branchId);

    const conditions: SQL[] = [];
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      conditions.push(
        sql`(${products.name} ILIKE ${q} OR ${productVariants.sku} ILIKE ${q} OR ${productVariants.barcode} ILIKE ${q})`,
      );
    }

    const rows = await this.db
      .select({
        productVariantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
        stock: inventory.stock,
        shelfId: productLocations.shelfId,
        shelfCode: shelves.code,
        shelfName: shelves.name,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        inventory,
        and(
          eq(inventory.productVariantId, productVariants.id),
          eq(inventory.branchId, branchId),
        ),
      )
      .leftJoin(
        productLocations,
        and(
          eq(productLocations.productVariantId, productVariants.id),
          eq(productLocations.branchId, branchId),
        ),
      )
      .leftJoin(shelves, eq(shelves.id, productLocations.shelfId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(products.name))
      .limit(2000);

    return rows.map((r) => ({
      productVariantId: Number(r.productVariantId),
      productId: Number(r.productId),
      productName: r.productName,
      sku: r.sku,
      barcode: r.barcode,
      stock: r.stock ?? 0,
      shelfId: r.shelfId != null ? Number(r.shelfId) : null,
      shelfCode: r.shelfCode ?? null,
      shelfName: r.shelfName ?? null,
    }));
  }

  /** Asignar (upsert) la ubicación de un producto en una sucursal. */
  async setLocation(dto: SetLocationDto) {
    await this.assertBranchExists(dto.branchId);
    await this.assertShelfInBranch(dto.branchId, dto.shelfId);

    await this.db
      .insert(productLocations)
      .values({
        productVariantId: dto.productVariantId,
        branchId: dto.branchId,
        shelfId: dto.shelfId,
      })
      .onConflictDoUpdate({
        target: [productLocations.productVariantId, productLocations.branchId],
        set: {
          shelfId: dto.shelfId,
          updatedAt: new Date().toISOString(),
        },
      });

    return { success: true, ...dto };
  }

  /** Quitar la ubicación de un producto en una sucursal. */
  async removeLocation(productVariantId: number, branchId: number) {
    await this.db
      .delete(productLocations)
      .where(
        and(
          eq(productLocations.productVariantId, productVariantId),
          eq(productLocations.branchId, branchId),
        ),
      );
    return { success: true };
  }

  /**
   * Ubicaciones de varias variantes en una sucursal (para el mapa del picking):
   * devuelve la estantería de cada variante si tiene ubicación asignada.
   */
  async locationsByVariants(branchId: number, variantIds: number[]) {
    if (variantIds.length === 0) return [];
    const rows = await this.db
      .select({
        productVariantId: productLocations.productVariantId,
        shelfId: productLocations.shelfId,
        shelfCode: shelves.code,
        shelfName: shelves.name,
        shelfColor: shelves.color,
      })
      .from(productLocations)
      .innerJoin(shelves, eq(shelves.id, productLocations.shelfId))
      .where(
        and(
          eq(productLocations.branchId, branchId),
          inArray(productLocations.productVariantId, variantIds),
        ),
      );
    return rows.map((r) => ({
      productVariantId: Number(r.productVariantId),
      shelfId: Number(r.shelfId),
      // Ya no hay filas; se mantiene el campo por la app móvil.
      rowNumber: null,
      shelfCode: r.shelfCode,
      shelfName: r.shelfName,
      shelfColor: r.shelfColor,
    }));
  }

  /**
   * Asignar una ubicación a TODOS los productos con inventario en la sucursal.
   * Con `onlyUnassigned=true` respeta las ubicaciones ya existentes.
   */
  async bulkAssign(branchId: number, shelfId: number, onlyUnassigned?: boolean) {
    await this.assertBranchExists(branchId);
    await this.assertShelfInBranch(branchId, shelfId);

    // Por ahora: TODAS las variantes reciben ubicación en la sucursal.
    const variants = await this.db
      .selectDistinct({ productVariantId: productVariants.id })
      .from(productVariants);

    if (variants.length === 0) {
      return { assigned: 0, total: 0 };
    }

    if (onlyUnassigned) {
      const existing = await this.db
        .select({ productVariantId: productLocations.productVariantId })
        .from(productLocations)
        .where(eq(productLocations.branchId, branchId));
      const existingSet = new Set(existing.map((r) => Number(r.productVariantId)));
      const toAssign = variants.filter((v) => !existingSet.has(Number(v.productVariantId)));
      if (toAssign.length > 0) {
        await this.db
          .insert(productLocations)
          .values(
            toAssign.map((v) => ({
              productVariantId: Number(v.productVariantId),
              branchId,
              shelfId,
            })),
          )
          .onConflictDoNothing();
      }
      return { assigned: toAssign.length, total: variants.length };
    }

    await this.db
      .insert(productLocations)
      .values(
        variants.map((v) => ({
          productVariantId: Number(v.productVariantId),
          branchId,
          shelfId,
        })),
      )
      .onConflictDoUpdate({
        target: [productLocations.productVariantId, productLocations.branchId],
        set: { shelfId, updatedAt: new Date().toISOString() },
      });

    return { assigned: variants.length, total: variants.length };
  }
}
