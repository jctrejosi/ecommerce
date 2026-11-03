import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Put,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Public } from '../../common/decorators/public.decorator';
import { DrizzleService } from '../../database/drizzle.service';
import { WompiService } from '../payments/wompi.service';
import { store, settings } from '../../../drizzle/schema';

@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly wompiService: WompiService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  @Get('store')
  async getStore() {
    const [row] = await this.db.select().from(store).limit(1);
    if (!row) return {};
    return {
      tradeName: row.tradeName,
      primaryDomain: row.primaryDomain,
      email: row.email,
      currencyCode: row.currencyCode,
      timezone: row.timezone,
      phone: row.phone,
      whatsapp: row.whatsapp,
      address: row.address,
    };
  }

  @Put('store')
  @HttpCode(HttpStatus.OK)
  async updateStore(
    @Body()
    body: {
      tradeName?: string;
      primaryDomain?: string;
      email?: string;
      currencyCode?: string;
      timezone?: string;
      phone?: string;
      whatsapp?: string;
      address?: string;
    },
  ) {
    const [row] = await this.db.select({ id: store.id }).from(store).limit(1);
    if (!row) return { error: 'No store found' };

    const data: Record<string, unknown> = {};
    if (body.tradeName !== undefined) data.tradeName = body.tradeName;
    if (body.primaryDomain !== undefined) data.primaryDomain = body.primaryDomain;
    if (body.email !== undefined) data.email = body.email;
    if (body.currencyCode !== undefined) data.currencyCode = body.currencyCode;
    if (body.timezone !== undefined) data.timezone = body.timezone;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.whatsapp !== undefined) data.whatsapp = body.whatsapp;
    if (body.address !== undefined) data.address = body.address;

    if (Object.keys(data).length > 0) {
      data.updatedAt = new Date().toISOString();
      await this.db.update(store).set(data as any).where(eq(store.id, row.id));
    }
    return this.getStore();
  }

  // ── Payment methods ──
  @Put('payment-methods')
  @HttpCode(HttpStatus.OK)
  async updatePaymentMethods(@Body() body: any) {
    const [current] = await this.db.select().from(settings).where(eq(settings.key, 'payment_methods')).limit(1);

    // Valida ANTES de guardar: si un método pasa a habilitado y no está
    // configurado correctamente, se rechaza y no se persiste el cambio.
    await this.validatePaymentMethods(body, (current?.value as any) ?? null);

    if (current) {
      await this.db.update(settings).set({ value: body }).where(eq(settings.key, 'payment_methods'));
    } else {
      await this.db.insert(settings).values({
        key: 'payment_methods',
        value: body,
        dataType: 'json',
        module: 'payments',
        description: 'Configuración de medios de pago habilitados',
        isPublic: true,
      } as any);
    }
    return this.getPaymentMethods();
  }

  /**
   * Comprueba un medio de pago antes de guardarlo.
   *
   * Solo se valida cuando el método pasa de deshabilitado a habilitado (o se
   * guarda por primera vez), para no bloquear toggles no relacionados ni la
   * edición de campos mientras el método ya está activo. Si la validación
   * falla, lanza BadRequestException y el guardado no se realiza.
   */
  private async validatePaymentMethods(next: any, prev: any): Promise<void> {
    const wasEnabled = (key: 'efectivo' | 'wompi' | 'breb'): boolean =>
      prev ? (prev?.[key]?.enabled ?? true) : true;

    // Wompi: requiere las credenciales configuradas y que Wompi las acepte.
    if (next?.wompi?.enabled === true && !wasEnabled('wompi')) {
      await this.wompiService.validateConfiguration();

      const methods = next.wompi?.methods ?? {};
      if (!methods.card && !methods.pse && !methods.nequi) {
        throw new BadRequestException(
          'Wompi requiere al menos un método habilitado (tarjeta, PSE o Nequi).',
        );
      }
    }

    // Bre-B: requiere una llave válida para mostrarle al cliente.
    if (next?.breb?.enabled === true && !wasEnabled('breb')) {
      const key = String(next?.breb?.key ?? '').trim();
      if (key.length < 3 || /\s/.test(key)) {
        throw new BadRequestException(
          'Bre-B requiere una llave válida (sin espacios), p. ej. @davi3148853458.',
        );
      }
    }

    // Efectivo contra entrega: no tiene configuración externa que validar.
  }

  @Get('payment-methods')
  async getPaymentMethods() {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, 'payment_methods')).limit(1);
    const defaults = {
      efectivo: { enabled: true },
      wompi: { enabled: true, methods: { card: true, pse: true, nequi: true } },
      breb: { enabled: true, key: '@davi3148853458', bank: 'Davivienda' },
    };
    if (!row) {
      return defaults;
    }
    const value = row.value as any;
    return {
      efectivo: { enabled: value?.efectivo?.enabled ?? true },
      wompi: {
        enabled: value?.wompi?.enabled ?? true,
        methods: {
          card: value?.wompi?.methods?.card ?? true,
          pse: value?.wompi?.methods?.pse ?? true,
          nequi: value?.wompi?.methods?.nequi ?? true,
        },
      },
      breb: {
        enabled: value?.breb?.enabled ?? true,
        key: value?.breb?.key ?? '@davi3148853458',
        bank: value?.breb?.bank ?? 'Davivienda',
      },
    };
  }

  @Public()
  @Get("public-info")
  async getPublicInfo() {
    const [row] = await this.db.select().from(store).limit(1);
    if (!row) return {};
    return { phone: row.phone, whatsapp: row.whatsapp, tradeName: row.tradeName };
  }
}
