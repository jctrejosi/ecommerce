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
  BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { DrizzleService } from '../../database/drizzle.service';
import { orders, orderStatusHistory, paymentIntents } from '../../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { OrdersGateway } from './orders.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CouponsService } from '../coupons/coupons.service';
import { WompiService } from '../payments/wompi.service';
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
    private readonly wompiService: WompiService,
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

    if (event !== 'transaction.updated') {
      return { ok: true };
    }

    const reference = transaction.reference;

    const result = await this.drizzleService.db
      .select({ id: orders.id, status: orders.status, customerId: orders.customerId, couponId: orders.couponId, grandTotal: orders.grandTotal })
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

    // ── Confirmar la transacción contra la API de Wompi ──
    // El payload solo dice *qué* transacción consultar: el estado, la
    // referencia y el monto se toman de la respuesta de Wompi, nunca del
    // cuerpo del evento.
    if (!transaction.id) {
      this.logger.warn(
        `Webhook sin id de transacción para ${reference}: rechazado`,
      );
      throw new BadRequestException('Falta el id de la transacción');
    }

    let verified: any;
    try {
      const response = await this.wompiService.getTransaction(
        String(transaction.id),
      );
      verified = response?.data ?? response;
    } catch (error) {
      this.logger.error(
        `No se pudo confirmar la transacción ${transaction.id} con Wompi: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // 503: Wompi reintenta el evento y el pedido queda intacto.
      throw new ServiceUnavailableException(
        'No se pudo confirmar la transacción con Wompi',
      );
    }

    if (!verified || typeof verified !== 'object' || !verified.status) {
      this.logger.error(
        `Respuesta inválida de Wompi para la transacción ${transaction.id}`,
      );
      throw new ServiceUnavailableException('Respuesta inválida de Wompi');
    }

    if (verified.reference !== reference) {
      this.logger.error(
        `La transacción ${transaction.id} pertenece a ${verified.reference}, no a ${reference}: rechazado`,
      );
      throw new UnauthorizedException('La transacción no corresponde al pedido');
    }

    // ── La transacción debe ser la que registró este pedido ──
    // `payment_intents.provider_transaction_id` guarda el id que devolvió
    // Wompi al crear la transacción (los ids llevan guion), o `pi_<ref>` si el
    // pedido no tiene transacción propia (p. ej. Bre-B). Si hay un id real y no
    // coincide, alguien creó otra transacción con la misma referencia.
    const intentRows = await this.drizzleService.db
      .select({
        amount: paymentIntents.amount,
        providerTransactionId: paymentIntents.providerTransactionId,
        providerResponse: paymentIntents.providerResponse,
      })
      .from(paymentIntents)
      .where(eq(paymentIntents.orderId, orderId));

    const providerIntents = intentRows.filter((row) => {
      const stored = String(row.providerTransactionId ?? '');
      return stored !== '' && !stored.startsWith('pi_');
    });
    const matchingIntent = providerIntents.find(
      (row) => String(row.providerTransactionId) === String(transaction.id),
    );
    if (providerIntents.length > 0 && !matchingIntent) {
      this.logger.error(
        `La transacción ${transaction.id} no es la registrada para ${reference}: rechazado`,
      );
      throw new UnauthorizedException('La transacción no corresponde al pedido');
    }

    // ── El monto pagado debe coincidir con lo que debía cobrarse ──
    // Lo cobrado es el total del pedido menos el saldo de cupón aplicado.
    const intent = matchingIntent ?? intentRows[0];
    const balanceApplied = Number(
      (intent?.providerResponse as any)?.coupon?.balanceApplied ?? 0,
    );
    const expectedAmount =
      Number(intent?.amount ?? order.grandTotal ?? 0) -
      (Number.isFinite(balanceApplied) ? balanceApplied : 0);

    const paidCents = Number(verified.amount_in_cents);
    const expectedCents = Math.round(expectedAmount * 100);
    if (!Number.isFinite(paidCents) || paidCents !== expectedCents) {
      this.logger.error(
        `Monto no coincide para ${reference}: transacción ${paidCents} vs pedido ${expectedCents}: rechazado`,
      );
      throw new UnauthorizedException('El monto pagado no coincide con el pedido');
    }

    const status = verified.status;

    if (status === 'APPROVED') {
      this.logger.log(`Order ${reference} payment approved`);
      if (order.status === 'paid') {
        this.logger.log(`Order ${reference} ya estaba pagada: evento duplicado`);
        return { ok: true };
      }
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
    } else if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
      const statusMessage = verified?.status_message || 'Transacción rechazada por Wompi';

      if (order.status === 'cancelled') {
        this.logger.log(`Order ${reference} ya estaba cancelada: evento duplicado`);
        return { ok: true };
      }

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

    return { ok: true };
  }
}
