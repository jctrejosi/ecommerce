import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  branches,
  inventory,
  productLocations,
  productVariants,
  products,
  shelfRows,
  shelves,
} from '../../../drizzle/schema';

export interface ShelfRowDto {
  rowNumber: number;
  label: string;
}

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
  rows?: ShelfRowDto[];
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
  rows?: ShelfRowDto[];
}

export interface SetLocationDto {
  productVariantId: number;
  branchId: number;
  shelfId: number;
  rowNumber: number;
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
      })
      .from(branches)
      .where(isNull(branches.deletedAt))
      .orderBy(asc(branches.priority), asc(branches.name));

    return rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, city: r.city }));
  }

  private async assertBranchExists(branchId: number) {
    const [row] = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, BigInt(branchId)), isNull(branches.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Sucursal ${branchId} no encontrada`);
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

  private async rowsOfShelf(shelfId: number) {
    const rows = await this.db
      .select({ id: shelfRows.id, rowNumber: shelfRows.rowNumber, label: shelfRows.label })
      .from(shelfRows)
      .where(eq(shelfRows.shelfId, shelfId))
      .orderBy(asc(shelfRows.rowNumber));
    return rows.map((r) => ({
      id: Number(r.id),
      rowNumber: r.rowNumber,
      label: r.label,
    }));
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
      .select()
      .from(shelves)
      .where(branchId ? eq(shelves.branchId, branchId) : undefined)
      .orderBy(asc(shelves.code));

    const ids = rows.map((r) => Number(r.id));

    // Batch de filas: UNA sola query para todas las estanterías (evita N+1 y
    // agotar el pool del pooler de Supabase, límite ~15 sesiones).
    const rowRows =
      ids.length > 0
        ? await this.db
            .select({
              id: shelfRows.id,
              shelfId: shelfRows.shelfId,
              rowNumber: shelfRows.rowNumber,
              label: shelfRows.label,
            })
            .from(shelfRows)
            .where(inArray(shelfRows.shelfId, ids))
            .orderBy(asc(shelfRows.rowNumber))
        : [];
    const rowsByShelf = new Map<number, { id: number; rowNumber: number; label: string }[]>();
    for (const rr of rowRows) {
      const sid = Number(rr.shelfId);
      if (!rowsByShelf.has(sid)) rowsByShelf.set(sid, []);
      rowsByShelf.get(sid)!.push({ id: Number(rr.id), rowNumber: rr.rowNumber, label: rr.label });
    }

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
      productCount: counts.get(Number(r.id)) ?? 0,
      rows: rowsByShelf.get(Number(r.id)) ?? [],
    }));
  }

  async createShelf(dto: CreateShelfDto) {
    await this.assertBranchExists(dto.branchId);
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
    await this.replaceRows(shelfId, dto.rows ?? []);
    return this.findOne(shelfId);
  }

  async findOne(id: number) {
    const [row] = await this.db
      .select()
      .from(shelves)
      .where(eq(shelves.id, BigInt(id)))
      .limit(1);
    if (!row) throw new NotFoundException(`Estantería ${id} no encontrada`);
    const [cnt] = await this.db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(productLocations)
      .where(eq(productLocations.shelfId, id));
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
      productCount: cnt?.cnt ?? 0,
      rows: await this.rowsOfShelf(id),
    };
  }

  async updateShelf(id: number, dto: UpdateShelfDto) {
    const shelf = await this.assertShelfExists(id);

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

    if (dto.rows !== undefined) {
      await this.replaceRows(id, dto.rows);
    }
    return this.findOne(id);
  }

  private async replaceRows(shelfId: number, rows: ShelfRowDto[]) {
    await this.db.delete(shelfRows).where(eq(shelfRows.shelfId, shelfId));
    if (rows.length === 0) return;
    await this.db.insert(shelfRows).values(
      rows.map((r, i) => ({
        shelfId,
        rowNumber: r.rowNumber ?? i + 1,
        label: String(r.label ?? '').trim().slice(0, 150) || `Fila ${i + 1}`,
      })),
    );
  }

  async deleteShelf(id: number) {
    await this.assertShelfExists(id);
    // Filas y ubicaciones de productos se borran en cascada (FK)
    await this.db.delete(shelves).where(eq(shelves.id, BigInt(id)));
    return { success: true };
  }

  // ── Ubicaciones de productos ───────────────────────────────────────────────

  private async assertShelfRow(branchId: number, shelfId: number, rowNumber: number) {
    const [shelf] = await this.db
      .select({ id: shelves.id, branchId: shelves.branchId })
      .from(shelves)
      .where(eq(shelves.id, BigInt(shelfId)))
      .limit(1);
    if (!shelf) throw new NotFoundException(`Estantería ${shelfId} no encontrada`);
    if (Number(shelf.branchId) !== branchId) {
      throw new BadRequestException('La estantería no pertenece a esa sucursal');
    }
    const [row] = await this.db
      .select({ id: shelfRows.id })
      .from(shelfRows)
      .where(and(eq(shelfRows.shelfId, shelfId), eq(shelfRows.rowNumber, rowNumber)))
      .limit(1);
    if (!row) throw new BadRequestException(`La fila ${rowNumber} no existe en la estantería`);
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
        rowNumber: productLocations.rowNumber,
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
      rowNumber: r.rowNumber ?? null,
      shelfCode: r.shelfCode ?? null,
      shelfName: r.shelfName ?? null,
    }));
  }

  /** Asignar (upsert) la ubicación de un producto en una sucursal. */
  async setLocation(dto: SetLocationDto) {
    await this.assertBranchExists(dto.branchId);
    await this.assertShelfRow(dto.branchId, dto.shelfId, dto.rowNumber);

    await this.db
      .insert(productLocations)
      .values({
        productVariantId: dto.productVariantId,
        branchId: dto.branchId,
        shelfId: dto.shelfId,
        rowNumber: dto.rowNumber,
      })
      .onConflictDoUpdate({
        target: [productLocations.productVariantId, productLocations.branchId],
        set: {
          shelfId: dto.shelfId,
          rowNumber: dto.rowNumber,
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
        rowNumber: productLocations.rowNumber,
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
      rowNumber: r.rowNumber,
      shelfCode: r.shelfCode,
      shelfName: r.shelfName,
      shelfColor: r.shelfColor,
    }));
  }

  /**
   * Asignar una ubicación a TODOS los productos con inventario en la sucursal.
   * Con `onlyUnassigned=true` respeta las ubicaciones ya existentes.
   */
  async bulkAssign(branchId: number, shelfId: number, rowNumber: number, onlyUnassigned?: boolean) {
    await this.assertBranchExists(branchId);
    await this.assertShelfRow(branchId, shelfId, rowNumber);

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
              rowNumber,
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
          rowNumber,
        })),
      )
      .onConflictDoUpdate({
        target: [productLocations.productVariantId, productLocations.branchId],
        set: { shelfId, rowNumber, updatedAt: new Date().toISOString() },
      });

    return { assigned: variants.length, total: variants.length };
  }
}
