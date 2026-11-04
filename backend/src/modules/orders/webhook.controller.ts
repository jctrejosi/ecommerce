import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { DrizzleService } from '../../database/drizzle.service';
import { orders, orderStatusHistory } from '../../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { OrdersGateway } from './orders.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CouponsService } from '../coupons/coupons.service';
import { ConfigService } from '@nestjs/config';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly ordersGateway: OrdersGateway,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly couponsService: CouponsService,
  ) {}

  @Public()
  @Post('wompi')
  @HttpCode(HttpStatus.OK)
  async handleWompiWebhook(
    @Headers('x-event-checksum') checksum: string,
    @Body() body: any,
  ) {
    const integrityKey = this.configService.get<string>('wompi.integrityKey') ?? '';

    const event = body?.event;
    const transaction = body?.data?.transaction;

    if (!event || !transaction?.reference) {
      return { ok: true };
    }

    this.logger.log(`Webhook received: ${event} for ${transaction.reference}`);

    // ── Validar la firma del evento ──
    // El checksum es un sha256 de los valores de las propiedades firmadas
    // combinados con la llave de integridad. Si la firma no coincide, el
    // evento no proviene de Wompi y se ignora.
    const signature = body?.signature;
    const signedProperties: string[] = Array.isArray(signature?.properties)
      ? signature.properties
      : [];
    const providedChecksum = checksum || signature?.checksum;

    // ── Fail-closed: sin firma verificable no se procesa nada ──
    // Un evento sin `signature.properties` o sin checksum puede venir de
    // cualquiera: antes se procesaba igual y permitía marcar pedidos como
    // pagados (o cancelados) sin pasar por Wompi.
    if (!integrityKey) {
      this.logger.error(
        'WOMPI_INTEGRITY_KEY no configurada: se rechazan los webhooks de Wompi',
      );
      throw new ServiceUnavailableException('Webhook no configurado');
    }
    if (!signedProperties.length || !providedChecksum) {
      this.logger.warn(
        `Webhook sin firma para ${transaction.reference}: rechazado`,
      );
      throw new UnauthorizedException('Firma ausente');
    }

    // Las propiedades firmadas (p. ej. "transaction.id") se resuelven
    // contra el objeto `data` del evento de Wompi.
    const values = signedProperties
      .map((prop: string) =>
        prop
          .split('.')
          .reduce((acc: any, key: string) => acc?.[key], body?.data),
      )
      .join('');
    const expectedA = createHash('sha256')
      .update(`${integrityKey}${values}`)
      .digest('hex');
    const expectedB = createHash('sha256')
      .update(`${values}${integrityKey}`)
      .digest('hex');
    const provided = String(providedChecksum).toLowerCase();
    const valid = [expectedA, expectedB].some((expected) => {
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!valid) {
      this.logger.warn(
        `Checksum inválido en webhook para ${transaction.reference}: rechazado`,
      );
      throw new UnauthorizedException('Firma inválida');
    }
    this.logger.log('Webhook firmado correctamente (checksum válido)');

    if (event === 'transaction.updated') {
      const status = transaction.status;
      const reference = transaction.reference;

      const result = await this.drizzleService.db
        .select({ id: orders.id, status: orders.status, customerId: orders.customerId, couponId: orders.couponId })
        .from(orders)
        .where(eq(orders.referenceCode, reference))
        .limit(1);

      if (result.length === 0) {
        this.logger.warn(`Order not found for reference: ${reference}`);
        return { ok: true };
      }

      const order = result[0];
      const orderId = Number(order.id);
      const customerId = order.customerId;

      if (status === 'APPROVED') {
        await this.drizzleService.db
          .update(orders)
          .set({ status: 'paid', updatedAt: new Date().toISOString() })
          .where(eq(orders.id, BigInt(orderId)));
        this.ordersGateway.notifyOrderStatus(reference, 'preparando', {
          customerId,
        });
        await this.drizzleService.db.insert(orderStatusHistory).values({
          orderId, status: 'paid', note: 'Pago confirmado por Wompi (webhook)', createdBy: customerId ?? null,
        });
        if (customerId) {
          await this.notificationsService.create({
            type: 'ORDER',
            title: 'Pago confirmado',
            message: `Tu pedido ${reference} ha sido aprobado y está siendo preparado.`,
            targetCustomerId: customerId,
            linkUrl: `/account?tab=orders`,
          });
        }
        this.logger.log(`Order ${reference} payment approved`);
      } else if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
        const statusMessage = transaction?.status_message || 'Transacción rechazada por Wompi';

        await this.drizzleService.db
          .update(orders)
          .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
          .where(eq(orders.id, BigInt(orderId)));
        this.ordersGateway.notifyOrderStatus(reference, 'cancelado', {
          reason: statusMessage,
          customerId,
        });
        await this.drizzleService.db.insert(orderStatusHistory).values({
          orderId, status: 'cancelled', note: `Pago rechazado: ${statusMessage}`, createdBy: customerId ?? null,
        });
        // El pago nunca se completó: devolver el saldo del cupón descontado.
        if (order.couponId) {
          try {
            await this.couponsService.reverseForOrder({
              couponId: Number(order.couponId),
              orderId,
              customerId: customerId ? Number(customerId) : null,
              note: `Reverso por pago rechazado: ${statusMessage}`,
            });
          } catch (reverseError) {
            this.logger.warn(
              `No se pudo revertir el cupón del pedido ${reference}: ${
                reverseError instanceof Error ? reverseError.message : String(reverseError)
              }`,
            );
          }
        }
        if (customerId) {
          await this.notificationsService.create({
            type: 'ORDER',
            title: 'Pago rechazado',
            message: `El pago de tu pedido ${reference} fue rechazado: ${statusMessage}. Intenta de nuevo.`,
            targetCustomerId: customerId,
            linkUrl: '/catalog',
          });
        }
        this.logger.log(`Order ${reference} payment declined`);
      } else {
        this.logger.log(`Ignoring status: ${status}`);
      }
    }

    return { ok: true };
  }
}
