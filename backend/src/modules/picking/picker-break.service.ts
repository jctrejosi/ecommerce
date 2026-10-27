import { Injectable, BadRequestException } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  pickerBreakLedger,
  pickerDailyStats,
  settings as settingsTable,
} from '../../../drizzle/schema';

/** Política de descansos/bono, editable desde el admin de picking. */
export interface BreakSettings {
  /** Unidades alistadas por cada descanso ganado (P). */
  productsPerBreak: number;
  /** Minutos que otorga cada descanso ganado (B). */
  breakMinutes: number;
  /** Unidades diarias para ganar el bono (G). 0 = sin meta. */
  dailyProductGoal: number;
  /** Importe del bono diario (M). */
  dailyBonusAmount: number;
  /** Días de vigencia del banco de minutos. 0 = nunca caduca. */
  bankExpiryDays: number;
}

const DEFAULT_SETTINGS: BreakSettings = {
  productsPerBreak: 20,
  breakMinutes: 5,
  dailyProductGoal: 100,
  dailyBonusAmount: 0,
  bankExpiryDays: 0,
};

const SETTINGS_KEY = 'picking_break_policy';
const TZ = 'America/Bogota';

/** Día local (YYYY-MM-DD) en la zona de la tienda. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const asInt = (v: unknown, fallback: number, min = 0): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.trunc(n));
};

const asAmount = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n * 100) / 100);
};

/**
 * Descansos y metas del picking.
 *
 * Reglas (confirmadas con el negocio):
 *  - Cada P unidades alistadas se ganan B minutos de descanso (acumulativo diario).
 *  - Si el picker no descansa, los minutos quedan en su banco.
 *  - Al llegar a G unidades en el día gana un bono de $M (independiente del banco).
 *  - El banco puede caducar a los N días (0 = nunca).
 *
 * El "banco" es la suma de movimientos `earned` menos `used`; el contador del día
 * vive en `picker_daily_stats` y se actualiza de forma transaccional.
 */
@Injectable()
export class PickerBreakService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  // ─── Configuración ────────────────────────────────────────────────────────

  async getSettings(): Promise<BreakSettings> {
    const [row] = await this.db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTINGS_KEY))
      .limit(1);
    const stored = (row?.value ?? {}) as Partial<Record<keyof BreakSettings, unknown>>;
    return this.normalize(stored);
  }

  private normalize(raw: Partial<Record<keyof BreakSettings, unknown>>): BreakSettings {
    return {
      productsPerBreak: asInt(raw.productsPerBreak, DEFAULT_SETTINGS.productsPerBreak, 1),
      breakMinutes: asInt(raw.breakMinutes, DEFAULT_SETTINGS.breakMinutes, 0),
      dailyProductGoal: asInt(raw.dailyProductGoal, DEFAULT_SETTINGS.dailyProductGoal, 0),
      dailyBonusAmount: asAmount(raw.dailyBonusAmount, DEFAULT_SETTINGS.dailyBonusAmount),
      bankExpiryDays: asInt(raw.bankExpiryDays, DEFAULT_SETTINGS.bankExpiryDays, 0),
    };
  }

  async updateSettings(patch: Partial<BreakSettings>): Promise<BreakSettings> {
    const current = await this.getSettings();
    const next = this.normalize({ ...current, ...patch });
    await this.db
      .insert(settingsTable)
      .values({
        key: SETTINGS_KEY,
        value: next,
        dataType: 'jsonb',
        module: 'picking',
        description: 'Descansos y metas del picking (P/B/G/bono/caducidad)',
        isEditable: true,
        isPublic: false,
      })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: next, updatedAt: new Date().toISOString() },
      });
    return next;
  }

  // ─── Banco de minutos ─────────────────────────────────────────────────────

  /** Minutos disponibles en el banco (descontando caducidad configurada). */
  async bankMinutes(userId: number, settings?: BreakSettings): Promise<number> {
    const cfg = settings ?? (await this.getSettings());
    const expiry = cfg.bankExpiryDays;
    const earnedWhere = and(
      eq(pickerBreakLedger.userId, userId),
      eq(pickerBreakLedger.type, 'earned'),
      expiry > 0 ? gte(pickerBreakLedger.day, isoDaysAgo(expiry)) : undefined,
    );
    const [earned] = await this.db
      .select({ minutes: sql<number>`COALESCE(SUM(${pickerBreakLedger.minutes}),0)::int` })
      .from(pickerBreakLedger)
      .where(earnedWhere);
    const [used] = await this.db
      .select({ minutes: sql<number>`COALESCE(SUM(${pickerBreakLedger.minutes}),0)::int` })
      .from(pickerBreakLedger)
      .where(
        and(
          eq(pickerBreakLedger.userId, userId),
          eq(pickerBreakLedger.type, 'used'),
        ),
      );
    return Math.max(0, Number(earned?.minutes ?? 0) - Number(used?.minutes ?? 0));
  }

  // ─── Registro de unidades alistadas ───────────────────────────────────────

  /**
   * Suma `units` al contador diario del picker y otorga descansos/bono si cruza
   * los umbrales. Idempotente por umbral (índice único parcial).
   */
  async recordPick(params: {
    userId: number;
    branchId: number | null;
    orderId: number | null;
    units: number;
  }): Promise<{
    unitsAdded: number;
    earnedMinutes: number;
    bonusAwardedNow: boolean;
    productsToday: number;
    breaksEarnedToday: number;
    bankMinutes: number;
    settings: BreakSettings;
  }> {
    const { userId, branchId, orderId } = params;
    const units = Math.max(0, Math.trunc(params.units));
    const cfg = await this.getSettings();
    if (units === 0) {
      const todayRow = await this.dailyRow(userId);
      return {
        unitsAdded: 0,
        earnedMinutes: 0,
        bonusAwardedNow: false,
        productsToday: Number(todayRow?.productsPicked ?? 0),
        breaksEarnedToday: Number(todayRow?.breaksEarned ?? 0),
        bankMinutes: await this.bankMinutes(userId, cfg),
        settings: cfg,
      };
    }

    const day = today();
    let earnedMinutes = 0;
    let bonusAwardedNow = false;
    let productsToday = 0;
    let breaksEarnedToday = 0;

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pickerDailyStats)
        .values({
          userId,
          day,
          branchId: branchId ?? undefined,
          productsPicked: units,
        })
        .onConflictDoUpdate({
          target: [pickerDailyStats.userId, pickerDailyStats.day],
          set: {
            productsPicked: sql`${pickerDailyStats.productsPicked} + ${units}`,
            branchId: branchId ?? undefined,
            updatedAt: new Date().toISOString(),
          },
        })
        .returning();

      productsToday = Number(row?.productsPicked ?? units);
      const already = Number(row?.breaksEarned ?? 0);
      const targetBreaks = Math.floor(productsToday / cfg.productsPerBreak);

      if (targetBreaks > already && cfg.breakMinutes > 0) {
        for (let i = already + 1; i <= targetBreaks; i++) {
          await tx
            .insert(pickerBreakLedger)
            .values({
              userId,
              branchId: branchId ?? undefined,
              day,
              type: 'earned',
              minutes: cfg.breakMinutes,
              thresholdIndex: i,
              orderId,
              note: `Descanso por ${cfg.productsPerBreak} unidades alistadas`,
            })
            .onConflictDoNothing();
          earnedMinutes += cfg.breakMinutes;
        }
        await tx
          .update(pickerDailyStats)
          .set({ breaksEarned: targetBreaks, updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(pickerDailyStats.userId, userId),
              eq(pickerDailyStats.day, day),
            ),
          );
        breaksEarnedToday = targetBreaks;
      } else {
        breaksEarnedToday = already;
      }

      const goalReached =
        cfg.dailyProductGoal > 0 && productsToday >= cfg.dailyProductGoal;
      if (goalReached && !row?.bonusAwarded) {
        await tx.insert(pickerBreakLedger).values({
          userId,
          branchId: branchId ?? undefined,
          day,
          type: 'bonus',
          minutes: 0,
          amount: String(cfg.dailyBonusAmount),
          orderId,
          note: `Bono por meta diaria (${cfg.dailyProductGoal} unidades)`,
        });
        await tx
          .update(pickerDailyStats)
          .set({ bonusAwarded: true, updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(pickerDailyStats.userId, userId),
              eq(pickerDailyStats.day, day),
            ),
          );
        bonusAwardedNow = cfg.dailyBonusAmount > 0;
      }
    });

    return {
      unitsAdded: units,
      earnedMinutes,
      bonusAwardedNow,
      productsToday,
      breaksEarnedToday,
      bankMinutes: await this.bankMinutes(userId, cfg),
      settings: cfg,
    };
  }

  // ─── Resumen para la app / admin ──────────────────────────────────────────

  private async dailyRow(userId: number) {
    const day = today();
    const [row] = await this.db
      .select()
      .from(pickerDailyStats)
      .where(and(eq(pickerDailyStats.userId, userId), eq(pickerDailyStats.day, day)))
      .limit(1);
    return row;
  }

  /** Estado del picker: banco, progreso del día, meta/bono y últimos movimientos. */
  async summary(userId: number) {
    const cfg = await this.getSettings();
    const day = today();
    const row = await this.dailyRow(userId);
    const productsToday = Number(row?.productsPicked ?? 0);
    const breaksEarnedToday = Number(row?.breaksEarned ?? 0);
    const bankMinutes = await this.bankMinutes(userId, cfg);
    const recent = await this.db
      .select({
        id: pickerBreakLedger.id,
        type: pickerBreakLedger.type,
        minutes: pickerBreakLedger.minutes,
        amount: pickerBreakLedger.amount,
        day: pickerBreakLedger.day,
        note: pickerBreakLedger.note,
        createdAt: pickerBreakLedger.createdAt,
      })
      .from(pickerBreakLedger)
      .where(eq(pickerBreakLedger.userId, userId))
      .orderBy(desc(pickerBreakLedger.id))
      .limit(15);

    return {
      day,
      settings: cfg,
      productsToday,
      breaksEarnedToday,
      bankMinutes,
      goal: {
        target: cfg.dailyProductGoal,
        products: productsToday,
        remaining: Math.max(0, cfg.dailyProductGoal - productsToday),
        reached: cfg.dailyProductGoal > 0 && productsToday >= cfg.dailyProductGoal,
        bonusAmount: cfg.dailyBonusAmount,
        awarded: Boolean(row?.bonusAwarded),
      },
      nextBreakAt:
        cfg.productsPerBreak > 0
          ? breaksEarnedToday * cfg.productsPerBreak + cfg.productsPerBreak
          : null,
      recent: recent.map((r) => ({
        id: Number(r.id),
        type: r.type,
        minutes: Number(r.minutes),
        amount: Number(r.amount),
        day: r.day,
        note: r.note,
        createdAt: r.createdAt,
      })),
    };
  }

  /** Reclama minutos del banco (descanso). */
  async useBreak(userId: number, minutes: number) {
    const mins = Math.trunc(Number(minutes));
    if (!Number.isFinite(mins) || mins <= 0) {
      throw new BadRequestException('Los minutos de descanso deben ser mayores a 0.');
    }
    const available = await this.bankMinutes(userId);
    if (mins > available) {
      throw new BadRequestException(
        `No tienes suficientes minutos acumulados (disponibles: ${available}).`,
      );
    }
    await this.db.insert(pickerBreakLedger).values({
      userId,
      day: today(),
      type: 'used',
      minutes: mins,
      note: 'Descanso reclamado',
    });
    return this.summary(userId);
  }
}
