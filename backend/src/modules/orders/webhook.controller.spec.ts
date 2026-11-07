import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { WebhookController } from './webhook.controller';
import { createConfigMock, createDbMock } from '../../../test/helpers/db-mock';
import type { DrizzleService } from '../../database/drizzle.service';
import type { OrdersGateway } from './orders.gateway';
import type { ConfigService } from '@nestjs/config';
import type { NotificationsService } from '../notifications/notifications.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { WompiService } from '../payments/wompi.service';

const INTEGRITY_KEY = 'integrity-key';
const REFERENCE = 'MER-12345678';
const TRANSACTION_ID = 'tx-1';

interface WompiEventBody {
  event: string;
  data: { transaction: { id?: string; reference: string } };
  signature?: { properties: string[]; checksum?: string };
}

function makeBody(overrides: Record<string, any> = {}): WompiEventBody {
  return {
    event: 'transaction.updated',
    data: {
      transaction: { id: TRANSACTION_ID, reference: REFERENCE },
    },
    signature: { properties: ['transaction.id'] },
    ...overrides,
  };
}

function checksumFor(body: WompiEventBody, key = INTEGRITY_KEY) {
  const values = (body.signature?.properties ?? [])
    .map((prop) =>
      prop
        .split('.')
        .reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown>)?.[part],
          body.data,
        ),
    )
    .join('');
  return createHash('sha256').update(`${key}${values}`).digest('hex');
}

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 1n,
    status: 'payment_pending',
    customerId: 9n,
    couponId: null,
    grandTotal: '100.00',
    ...overrides,
  };
}

describe('WebhookController (Wompi)', () => {
  let mock: ReturnType<typeof createDbMock>;
  let config: ReturnType<typeof createConfigMock>;
  let gateway: { notifyOrderStatus: ReturnType<typeof vi.fn> };
  let notifications: { create: ReturnType<typeof vi.fn> };
  let coupons: { reverseForOrder: ReturnType<typeof vi.fn> };
  let wompi: { getTransaction: ReturnType<typeof vi.fn> };
  let controller: WebhookController;

  beforeEach(() => {
    mock = createDbMock();
    config = createConfigMock({ 'wompi.integrityKey': INTEGRITY_KEY });
    gateway = { notifyOrderStatus: vi.fn() };
    notifications = { create: vi.fn().mockResolvedValue({}) };
    coupons = { reverseForOrder: vi.fn().mockResolvedValue({}) };
    wompi = { getTransaction: vi.fn() };
    controller = new WebhookController(
      mock.drizzle as unknown as DrizzleService,
      gateway as unknown as OrdersGateway,
      config as unknown as ConfigService,
      notifications as unknown as NotificationsService,
      coupons as unknown as CouponsService,
      wompi as unknown as WompiService,
    );
  });

  it('ignora eventos sin datos de transacción', async () => {
    await expect(
      controller.handleWompiWebhook('', { event: 'transaction.updated' }),
    ).resolves.toEqual({ ok: true });
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('rechaza el webhook si no hay llave de integridad configurada', async () => {
    config.get.mockImplementation((key: string, def?: unknown) =>
      key === 'wompi.integrityKey' ? '' : def,
    );

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rechaza un webhook sin firma ni checksum', async () => {
    const body = makeBody({ signature: undefined });

    await expect(
      controller.handleWompiWebhook('', body),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(wompi.getTransaction).not.toHaveBeenCalled();
  });

  it('rechaza un checksum inválido', async () => {
    await expect(
      controller.handleWompiWebhook('deadbeef', makeBody()),
    ).rejects.toThrow('Firma inválida');
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('acepta el checksum enviado en el cuerpo del evento', async () => {
    const body = makeBody();
    body.signature!.checksum = checksumFor(body);
    mock.queueSelect([]);

    await expect(controller.handleWompiWebhook('', body)).resolves.toEqual({
      ok: true,
    });
  });

  it('ignora eventos que no son transaction.updated', async () => {
    const body = makeBody({ event: 'transaction.created' });

    await expect(
      controller.handleWompiWebhook(checksumFor(body), body),
    ).resolves.toEqual({ ok: true });
  });

  it('no modifica el pedido si no existe la referencia', async () => {
    mock.queueSelect([]);

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).resolves.toEqual({ ok: true });
    expect(mock.state.updates).toHaveLength(0);
  });

  it('rechaza el evento si falta el id de transacción', async () => {
    const body = makeBody();
    delete body.data.transaction.id;
    mock.queueSelectOne(makeOrder());

    await expect(
      controller.handleWompiWebhook(checksumFor(body), body),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mock.state.updates).toHaveLength(0);
  });

  it('no cambia el estado si Wompi no confirma la transacción', async () => {
    mock.queueSelectOne(makeOrder());
    wompi.getTransaction.mockRejectedValue(new Error('timeout'));

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(mock.state.updates).toHaveLength(0);
    expect(mock.state.inserts).toHaveLength(0);
    expect(gateway.notifyOrderStatus).not.toHaveBeenCalled();
  });

  it('rechaza una respuesta inválida de Wompi', async () => {
    mock.queueSelectOne(makeOrder());
    wompi.getTransaction.mockResolvedValue({ data: null });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mock.state.updates).toHaveLength(0);
  });

  it('rechaza una transacción de otra referencia', async () => {
    mock.queueSelectOne(makeOrder());
    wompi.getTransaction.mockResolvedValue({
      data: { status: 'APPROVED', reference: 'OTRA', amount_in_cents: 10000 },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).rejects.toThrow('La transacción no corresponde al pedido');
    expect(mock.state.updates).toHaveLength(0);
  });

  it('rechaza una transacción distinta a la registrada en el pedido', async () => {
    mock.queueSelectOne(makeOrder());
    mock.queueSelect([
      {
        amount: '100.00',
        providerTransactionId: 'otra-tx',
        providerResponse: null,
      },
    ]);
    wompi.getTransaction.mockResolvedValue({
      data: {
        status: 'APPROVED',
        reference: REFERENCE,
        amount_in_cents: 10000,
      },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).rejects.toThrow('La transacción no corresponde al pedido');
    expect(mock.state.updates).toHaveLength(0);
  });

  it('rechaza si el monto pagado no coincide con el pedido', async () => {
    mock.queueSelectOne(makeOrder());
    mock.queueSelect([]);
    wompi.getTransaction.mockResolvedValue({
      data: {
        status: 'APPROVED',
        reference: REFERENCE,
        amount_in_cents: 5000,
      },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).rejects.toThrow('El monto pagado no coincide con el pedido');
    expect(mock.state.updates).toHaveLength(0);
  });

  it('marca el pedido como pagado y notifica cuando el pago es aprobado', async () => {
    mock.queueSelectOne(makeOrder());
    mock.queueSelect([]);
    wompi.getTransaction.mockResolvedValue({
      data: {
        status: 'APPROVED',
        reference: REFERENCE,
        amount_in_cents: 10000,
      },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).resolves.toEqual({ ok: true });

    expect(mock.state.updates[0].values).toMatchObject({ status: 'paid' });
    expect(mock.state.inserts[0].values).toMatchObject({
      orderId: 1,
      status: 'paid',
    });
    expect(gateway.notifyOrderStatus).toHaveBeenCalledWith(
      REFERENCE,
      'preparando',
      { customerId: 9n },
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Pago confirmado' }),
    );
  });

  it('no reprocesa un pago aprobado duplicado', async () => {
    mock.queueSelectOne(makeOrder({ status: 'paid' }));
    mock.queueSelect([]);
    wompi.getTransaction.mockResolvedValue({
      data: {
        status: 'APPROVED',
        reference: REFERENCE,
        amount_in_cents: 10000,
      },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).resolves.toEqual({ ok: true });

    expect(mock.state.updates).toHaveLength(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('cancela el pedido y revierte el cupón si el pago es rechazado', async () => {
    mock.queueSelectOne(makeOrder({ couponId: 77n }));
    mock.queueSelect([]);
    wompi.getTransaction.mockResolvedValue({
      data: {
        status: 'DECLINED',
        reference: REFERENCE,
        amount_in_cents: 10000,
        status_message: 'Fondos insuficientes',
      },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).resolves.toEqual({ ok: true });

    expect(mock.state.updates[0].values).toMatchObject({ status: 'cancelled' });
    expect(coupons.reverseForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: 77, orderId: 1, customerId: 9 }),
    );
    const reverseArg = coupons.reverseForOrder.mock.calls[0][0] as {
      note?: string;
    };
    expect(reverseArg.note).toContain('Fondos insuficientes');
    expect(gateway.notifyOrderStatus).toHaveBeenCalledWith(
      REFERENCE,
      'cancelado',
      expect.objectContaining({
        reason: 'Fondos insuficientes',
        customerId: 9n,
      }),
    );
  });

  it('no reprocesa una cancelación duplicada', async () => {
    mock.queueSelectOne(makeOrder({ status: 'cancelled' }));
    mock.queueSelect([]);
    wompi.getTransaction.mockResolvedValue({
      data: {
        status: 'VOIDED',
        reference: REFERENCE,
        amount_in_cents: 10000,
      },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).resolves.toEqual({ ok: true });
    expect(mock.state.updates).toHaveLength(0);
  });

  it('no modifica el pedido ante estados de Wompi no terminales', async () => {
    mock.queueSelectOne(makeOrder());
    mock.queueSelect([]);
    wompi.getTransaction.mockResolvedValue({
      data: {
        status: 'PENDING',
        reference: REFERENCE,
        amount_in_cents: 10000,
      },
    });

    await expect(
      controller.handleWompiWebhook(checksumFor(makeBody()), makeBody()),
    ).resolves.toEqual({ ok: true });
    expect(mock.state.updates).toHaveLength(0);
  });
});
