import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { deliveryDrivers, driverChatMessages } from '../../../drizzle/schema';
import { DeliveryGateway } from './delivery.gateway';

const MAX_MESSAGE_LENGTH = 2000;

/** Lado del chat desde el que se lee/escribe. */
export type ChatSide = 'driver' | 'admin';

export interface DriverChatMessage {
  id: number;
  senderType: ChatSide;
  senderUserId: number | null;
  body: string;
  createdAt: string | null;
  readAt: string | null;
}

export interface DriverConversation {
  driverId: number;
  fullName: string;
  phone: string;
  routeColor: string | null;
  isActive: boolean;
  unread: number;
  lastMessage: {
    body: string;
    senderType: ChatSide;
    createdAt: string | null;
  } | null;
}

/**
 * Chat directo repartidor ↔ administrador (un hilo por repartidor).
 *
 * Complementa al chat por pedido (`order_chat_messages`) que vive en
 * `DeliveryOrdersService`: ese es cliente ↔ repartidor y solo existe mientras
 * la entrega está en curso. Este es coordinación operativa con el panel y queda
 * guardado aunque no haya pedidos.
 */
@Injectable()
export class DriverChatService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly gateway: DeliveryGateway,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  /** Repartidor existente o 404. */
  private async resolveDriver(driverId: number) {
    if (!Number.isFinite(driverId)) {
      throw new NotFoundException('Repartidor no encontrado.');
    }
    const [row] = await this.db
      .select({
        id: deliveryDrivers.id,
        fullName: deliveryDrivers.fullName,
        authUserId: deliveryDrivers.authUserId,
      })
      .from(deliveryDrivers)
      .where(
        and(
          eq(deliveryDrivers.id, BigInt(driverId)),
          isNull(deliveryDrivers.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Repartidor no encontrado.');
    return row;
  }

  private cleanBody(body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Escribe un mensaje.');
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        'El mensaje no puede superar 2000 caracteres.',
      );
    }
    return text;
  }

  private toMessage(row: {
    id: bigint | number;
    senderType: ChatSide;
    senderUserId: number | null;
    body: string;
    createdAt: string | null;
    readAt: string | null;
  }): DriverChatMessage {
    return {
      id: Number(row.id),
      senderType: row.senderType,
      senderUserId:
        row.senderUserId != null ? Number(row.senderUserId) : null,
      body: row.body,
      createdAt: row.createdAt,
      readAt: row.readAt,
    };
  }

  /** Hilo completo (cronológico). Al leerlo, se marca leído lo recibido. */
  async listMessages(driverId: number, viewer: ChatSide) {
    await this.resolveDriver(driverId);
    const rows = await this.db
      .select()
      .from(driverChatMessages)
      .where(eq(driverChatMessages.driverId, driverId))
      .orderBy(asc(driverChatMessages.id));

    await this.markRead(driverId, viewer);
    return rows.map((r) => this.toMessage(r));
  }

  /** Resumen para badges: no leídos + último mensaje (no marca nada leído). */
  async summary(driverId: number, viewer: ChatSide) {
    await this.resolveDriver(driverId);
    const from: ChatSide = viewer === 'admin' ? 'driver' : 'admin';
    const [stat] = await this.db
      .select({
        unread: sql<number>`count(*)::int`,
      })
      .from(driverChatMessages)
      .where(
        and(
          eq(driverChatMessages.driverId, driverId),
          eq(driverChatMessages.senderType, from),
          isNull(driverChatMessages.readAt),
        ),
      );
    const [last] = await this.db
      .select()
      .from(driverChatMessages)
      .where(eq(driverChatMessages.driverId, driverId))
      .orderBy(desc(driverChatMessages.id))
      .limit(1);
    return {
      unread: Number(stat?.unread ?? 0),
      lastMessage: last ? this.toMessage(last) : null,
    };
  }

  /** Bandeja del panel: un renglón por repartidor con no leídos y último mensaje. */
  async listConversations(): Promise<DriverConversation[]> {
    const drivers = await this.db
      .select({
        id: deliveryDrivers.id,
        fullName: deliveryDrivers.fullName,
        phone: deliveryDrivers.phone,
        routeColor: deliveryDrivers.routeColor,
        isActive: deliveryDrivers.isActive,
      })
      .from(deliveryDrivers)
      .where(isNull(deliveryDrivers.deletedAt))
      .orderBy(asc(deliveryDrivers.fullName));

    // No leídos por repartidor (solo lo que escribió el repartidor).
    const unreadRows = await this.db
      .select({
        driverId: driverChatMessages.driverId,
        unread: sql<number>`count(*)::int`,
      })
      .from(driverChatMessages)
      .where(
        and(
          eq(driverChatMessages.senderType, 'driver'),
          isNull(driverChatMessages.readAt),
        ),
      )
      .groupBy(driverChatMessages.driverId);

    // Último mensaje de cada repartidor (DISTINCT ON = uno por driver).
    const lastRows = await this.db
      .selectDistinctOn([driverChatMessages.driverId], {
        driverId: driverChatMessages.driverId,
        body: driverChatMessages.body,
        senderType: driverChatMessages.senderType,
        createdAt: driverChatMessages.createdAt,
      })
      .from(driverChatMessages)
      .orderBy(driverChatMessages.driverId, desc(driverChatMessages.id));

    const unreadBy = new Map(
      unreadRows.map((r) => [Number(r.driverId), Number(r.unread)]),
    );
    const lastBy = new Map(lastRows.map((r) => [Number(r.driverId), r]));

    return drivers
      .map((d) => {
        const last = lastBy.get(Number(d.id));
        return {
          driverId: Number(d.id),
          fullName: d.fullName,
          phone: d.phone,
          routeColor: d.routeColor,
          isActive: d.isActive,
          unread: unreadBy.get(Number(d.id)) ?? 0,
          lastMessage: last
            ? {
                body: last.body,
                senderType: last.senderType,
                createdAt: last.createdAt,
              }
            : null,
        };
      })
      // Con mensajes primero (los más recientes arriba); el resto alfabético.
      .sort((a, b) => {
        const at = a.lastMessage?.createdAt ?? '';
        const bt = b.lastMessage?.createdAt ?? '';
        if (at && bt) return bt.localeCompare(at);
        if (at) return -1;
        if (bt) return 1;
        return a.fullName.localeCompare(b.fullName);
      });
  }

  /** Mensaje del administrador hacia el repartidor. */
  async sendFromAdmin(driverId: number, adminUserId: number, body: string) {
    return this.send(driverId, 'admin', adminUserId, body);
  }

  /** Mensaje del repartidor hacia el panel. */
  async sendFromDriver(driverId: number, driverUserId: number, body: string) {
    return this.send(driverId, 'driver', driverUserId, body);
  }

  private async send(
    driverId: number,
    side: ChatSide,
    senderUserId: number,
    body: string,
  ) {
    const driver = await this.resolveDriver(driverId);
    const text = this.cleanBody(body);

    const [row] = await this.db
      .insert(driverChatMessages)
      .values({
        driverId,
        senderType: side,
        senderUserId,
        body: text,
      })
      .returning();

    const message = this.toMessage(row);

    // Tiempo real: al repartidor le llega el suyo; al panel (sala `fleet`)
    // todos, para que varias pestañas de admin queden sincronizadas.
    if (side === 'admin' && driver.authUserId != null) {
      this.gateway.emitToDriver(
        Number(driver.authUserId),
        'delivery:admin-chat',
        { driverId, message },
      );
    }
    this.gateway.emitFleetChat({ driverId, message });

    return message;
  }

  /** Marca como leídos los mensajes que escribió la contraparte. */
  private async markRead(driverId: number, viewer: ChatSide) {
    const from: ChatSide = viewer === 'admin' ? 'driver' : 'admin';
    await this.db
      .update(driverChatMessages)
      .set({ readAt: new Date().toISOString() })
      .where(
        and(
          eq(driverChatMessages.driverId, driverId),
          eq(driverChatMessages.senderType, from),
          isNull(driverChatMessages.readAt),
        ),
      );
  }
}
