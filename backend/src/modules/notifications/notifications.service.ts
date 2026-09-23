import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { notifications } from '../../../drizzle/schema';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import type { InferInsertModel } from 'drizzle-orm';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly gateway: NotificationsGateway,
    private readonly pushService: PushService,
  ) {}

  async getForCustomer(customerId: number) {
    const rows = await this.drizzleService.db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        isRead: notifications.isRead,
        linkUrl: notifications.linkUrl,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.targetCustomerId, customerId))
      // Más reciente primero (el cliente antepone las que llegan en vivo por
      // WebSocket, así que el listado inicial debe usar el mismo orden). El id
      // desempata cuando dos comparten marca de tiempo.
      .orderBy(desc(notifications.createdAt), desc(notifications.id));

    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
    }));
  }

  async getUnreadCount(customerId: number) {
    const rows = await this.drizzleService.db
      .select({ count: notifications.id })
      .from(notifications)
      .where(
        and(
        eq(notifications.targetCustomerId, customerId),
        eq(notifications.isRead, false),
      ));
    return rows.length;
  }

  async markAsRead(notificationId: number) {
    await this.drizzleService.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date().toISOString() })
      .where(eq(notifications.id, BigInt(notificationId)));
  }

  async create(data: {
    type: string;
    title: string;
    message: string;
    targetCustomerId: number;
    linkUrl?: string;
  }) {
    const inserted = await this.drizzleService.db
      .insert(notifications)
      .values({
        type: data.type as any,
        title: data.title,
        message: data.message,
        targetCustomerId: data.targetCustomerId,
        linkUrl: data.linkUrl ?? null,
        channel: 'IN_APP' as any,
        isRead: false,
      })
      .returning({ id: notifications.id });

    const notification = {
      id: Number(inserted[0].id),
      type: data.type,
      title: data.title,
      message: data.message,
      isRead: false,
      linkUrl: data.linkUrl,
      createdAt: new Date().toISOString(),
    };

    this.gateway.notifyCustomer(data.targetCustomerId, notification);

    // Además del aviso in-app (Socket.IO), se manda el push al dispositivo del
    // cliente (si tiene la app con token registrado). Es "best-effort": nunca
    // bloquea ni rompe la creación de la notificación.
    void this.pushService.sendToCustomer(data.targetCustomerId, {
      title: data.title,
      body: data.message,
      data: {
        type: data.type,
        notificationId: String(notification.id),
        linkUrl: data.linkUrl ?? '',
      },
    });

    return notification;
  }
}
