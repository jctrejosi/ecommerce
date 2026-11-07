import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  branches,
  cartItems,
  carts,
  categories,
  media,
  productCategories,
  productImages,
  products,
  productVariants,
} from '../../../drizzle/schema';
import { UpdateCartDto } from './dto/update-cart.dto';
import {
  branchComparePriceSql,
  branchPriceSql,
} from '../../common/pricing/branch-price';
import {
  PromotionEngineService,
  type PromotionEngineItem,
} from '../promotions/promotion-engine.service';

@Injectable()
export class CartService {
  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly promotionEngine: PromotionEngineService,
  ) {}

  private get db() {
    return this.drizzleService.db;
  }

  async getCart(customerId: number) {
    const cart = await this.getOrCreateActiveCart(customerId);
    return this.buildCartResponse(Number(cart.id));
  }

  async updateCart(customerId: number, dto: UpdateCartDto) {
    const cart = await this.getOrCreateActiveCart(customerId);
    const cartId = Number(cart.id);

    await this.db.delete(cartItems).where(eq(cartItems.cartId, cartId));

    const cartBranchId = cart.branchId ? Number(cart.branchId) : null;

    if (dto.items.length > 0) {
      const productIds = dto.items.map((item) => item.productId);
      const variants = await this.db
        .select({
          variantId: productVariants.id,
          productId: productVariants.productId,
          price: branchPriceSql(cartBranchId),
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            inArray(productVariants.productId, productIds),
            eq(productVariants.isActive, true),
            isNull(productVariants.deletedAt),
            eq(products.isActive, true),
            isNull(products.deletedAt),
          ),
        )
        .orderBy(asc(productVariants.productId), asc(productVariants.id));

      const variantByProductId = new Map<number, (typeof variants)[number]>();
      for (const variant of variants) {
        const productId = Number(variant.productId);
        if (!variantByProductId.has(productId)) {
          variantByProductId.set(productId, variant);
        }
      }

      const payload = dto.items
        .map((item) => {
          const variant = variantByProductId.get(item.productId);
          if (!variant) return null;

          const unitPrice = Number(variant.price);
          return {
            cartId,
            productVariantId: Number(variant.variantId),
            quantity: item.quantity,
            unitPrice: String(unitPrice),
            subtotal: String(unitPrice * item.quantity),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (payload.length > 0) {
        await this.db.insert(cartItems).values(payload);
      }
    }

    await this.db
      .update(carts)
      .set({ lastActivityAt: new Date().toISOString() })
      .where(eq(carts.id, BigInt(cartId)));

    return this.buildCartResponse(cartId);
  }

  /**
   * Cotiza una lista de ítems sin crear carrito ni cliente (carrito local del
   * cliente web). Reutiliza el mismo motor de promociones del checkout.
   */
  async quote(
    items: Array<{ productId: number; quantity: number }>,
    branchId: number | null = null,
  ) {
    const wanted = items.filter(
      (item) => item.productId > 0 && item.quantity > 0,
    );

    if (wanted.length === 0) {
      return {
        items: [],
        subtotal: 0,
        discountTotal: 0,
        total: 0,
        appliedPromotions: [],
      };
    }

    const variants = await this.db
      .select({
        variantId: productVariants.id,
        productId: productVariants.productId,
        price: branchPriceSql(branchId),
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          inArray(
            productVariants.productId,
            wanted.map((item) => item.productId),
          ),
          eq(productVariants.isActive, true),
          isNull(productVariants.deletedAt),
          eq(products.isActive, true),
          isNull(products.deletedAt),
        ),
      )
      .orderBy(asc(productVariants.productId), asc(productVariants.id));

    const variantByProductId = new Map<number, (typeof variants)[number]>();
    for (const variant of variants) {
      const productId = Number(variant.productId);
      if (!variantByProductId.has(productId)) {
        variantByProductId.set(productId, variant);
      }
    }

    const engineItems: PromotionEngineItem[] = [];
    for (const item of wanted) {
      const variant = variantByProductId.get(item.productId);
      if (!variant) continue;
      engineItems.push({
        productId: item.productId,
        productVariantId: Number(variant.variantId),
        quantity: item.quantity,
        unitPrice: Number(variant.price),
      });
    }

    const evaluation = await this.promotionEngine.evaluate(
      engineItems,
      branchId,
    );

    return {
      items: evaluation.items.map((line) => ({
        productId: line.productId,
        productVariantId: line.productVariantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        discount: line.discount,
        total: line.total,
      })),
      subtotal: evaluation.subtotal,
      discountTotal: evaluation.discountTotal,
      total: evaluation.total,
      appliedPromotions: evaluation.appliedPromotions,
    };
  }

  private async getOrCreateActiveCart(customerId: number) {
    const existing = await this.db
      .select({ id: carts.id, branchId: carts.branchId })
      .from(carts)
      .where(and(eq(carts.customerId, customerId), eq(carts.status, 'ACTIVE')))
      .limit(1);

    if (existing.length) {
      return existing[0];
    }

    const branch = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.isActive, true), isNull(branches.deletedAt)))
      .orderBy(asc(branches.priority), asc(branches.id))
      .limit(1);

    if (!branch.length) {
      throw new NotFoundException(
        'No hay sucursales activas para crear carrito',
      );
    }

    const inserted = await this.db
      .insert(carts)
      .values({
        customerId,
        guestSessionId: null,
        branchId: Number(branch[0].id),
        status: 'ACTIVE',
        lastActivityAt: new Date().toISOString(),
      })
      .returning({ id: carts.id, branchId: carts.branchId });

    return inserted[0];
  }

  private async buildCartResponse(cartId: number) {
    const [cart] = await this.db
      .select({ branchId: carts.branchId })
      .from(carts)
      .where(eq(carts.id, BigInt(cartId)))
      .limit(1);
    const branchId = cart?.branchId ? Number(cart.branchId) : null;

    const rows = await this.db
      .select({
        productId: products.id,
        productVariantId: cartItems.productVariantId,
        name: products.name,
        slug: products.slug,
        description: products.description,
        price: branchPriceSql(branchId),
        originalPrice: branchComparePriceSql(branchId),
        image: media.path,
        category: categories.name,
        categoryId: categories.id,
        quantity: cartItems.quantity,
        isFeatured: products.featured,
      })
      .from(cartItems)
      .innerJoin(
        productVariants,
        eq(productVariants.id, cartItems.productVariantId),
      )
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(productCategories, eq(productCategories.productId, products.id))
      .leftJoin(categories, eq(categories.id, productCategories.categoryId))
      .leftJoin(
        productImages,
        and(
          eq(productImages.productId, products.id),
          eq(productImages.isCover, true),
        ),
      )
      .leftJoin(media, eq(media.id, productImages.mediaId))
      .where(eq(cartItems.cartId, cartId))
      .orderBy(asc(cartItems.createdAt));

    const items = new Map<
      number,
      {
        id: number;
        variantId: number;
        slug: string;
        name: string;
        description: string | null;
        price: number;
        originalPrice?: number;
        image: string | null;
        category: string;
        categoryId: number;
        quantity: number;
        isFeatured: boolean;
      }
    >();

    for (const row of rows) {
      const productId = Number(row.productId);
      if (items.has(productId)) continue;

      items.set(productId, {
        id: productId,
        variantId: Number(row.productVariantId),
        slug: row.slug,
        name: row.name,
        description: row.description,
        price: Number(row.price),
        originalPrice: row.originalPrice
          ? Number(row.originalPrice)
          : undefined,
        image: row.image,
        category: row.category ?? '',
        categoryId: row.categoryId ? Number(row.categoryId) : 0,
        quantity: row.quantity,
        isFeatured: row.isFeatured,
      });
    }

    const cartItemsList = Array.from(items.values());

    const engineItems: PromotionEngineItem[] = cartItemsList.map((item) => ({
      productId: item.id,
      productVariantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.price,
    }));

    const evaluation = await this.promotionEngine.evaluate(
      engineItems,
      branchId,
    );

    const discountByProduct = new Map<number, number>();
    evaluation.items.forEach((line) => {
      discountByProduct.set(line.productId, line.discount);
    });

    return {
      items: cartItemsList.map((item) => {
        const discount = discountByProduct.get(item.id) ?? 0;
        return {
          id: item.id,
          slug: item.slug,
          name: item.name,
          description: item.description,
          price: item.price,
          originalPrice: item.originalPrice,
          image: item.image,
          category: item.category,
          categoryId: item.categoryId,
          quantity: item.quantity,
          isFeatured: item.isFeatured,
          discount,
          total:
            Math.round((item.price * item.quantity - discount) * 100) / 100,
        };
      }),
      subtotal: evaluation.subtotal,
      discountTotal: evaluation.discountTotal,
      total: evaluation.total,
      appliedPromotions: evaluation.appliedPromotions,
    };
  }
}
