import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { pickerChatMessages, userBranches, users } from '../../../drizzle/schema';
import { PushService } from '../notifications/push.service';
import { PickingGateway } from './picking.gateway';

const MAX_MESSAGE_LENGTH = 2000;

/** Lado del chat desde el que se lee/escribe. */
export type ChatSide = 'picker' | 'admin';

export interface PickerChatMessage {
  id: number;
  senderType: ChatSide;
  senderUserId: number | null;
  body: string;
  createdAt: string | null;
  readAt: string | null;
}

export interface PickerConversation {
  pickerId: number;
  fullName: string;
  /** Usuario de login del picker; el admin lo usa como "código" al buscar. */
  username: string;
  email: string;
  isActive: boolean;
  unread: number;
  lastMessage: {
    body: string;
    senderType: ChatSide;
    createdAt: string | null;
  } | null;
}

/**
 * Chat directo picker ↔ administrador (un hilo por picker).
 *
 * Es el equivalente de `DriverChatService` para el picking. El picker se
 * identifica por su usuario (`users.id`), que es el mismo con el que entra a la
 * app; el panel filtra por los usuarios marcados con `isPicker`.
 */
@Injectable()
export class PickerChatService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly gateway: PickingGateway,
    private readonly push: PushService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  /** Picker existente o 404. */
  private async resolvePicker(pickerId: number) {
    if (!Number.isFinite(pickerId)) {
      throw new NotFoundException('Picker no encontrado.');
    }
    const [row] = await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(and(eq(users.id, BigInt(pickerId)), isNull(users.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Picker no encontrado.');
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
  }): PickerChatMessage {
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
  async listMessages(pickerId: number, viewer: ChatSide) {
    await this.resolvePicker(pickerId);
    // Se marca antes de leer para que la respuesta ya refleje el nuevo estado
    // (si no, el cliente ve `readAt: null` justo después de marcar leído).
    await this.markRead(pickerId, viewer);
    const rows = await this.db
      .select()
      .from(pickerChatMessages)
      .where(eq(pickerChatMessages.pickerId, pickerId))
      .orderBy(asc(pickerChatMessages.id));

    return rows.map((r) => this.toMessage(r));
  }

  /** Resumen para badges: no leídos + último mensaje (no marca nada leído). */
  async summary(pickerId: number, viewer: ChatSide) {
    await this.resolvePicker(pickerId);
    const from: ChatSide = viewer === 'admin' ? 'picker' : 'admin';
    const [stat] = await this.db
      .select({
        unread: sql<number>`count(*)::int`,
      })
      .from(pickerChatMessages)
      .where(
        and(
          eq(pickerChatMessages.pickerId, pickerId),
          eq(pickerChatMessages.senderType, from),
          isNull(pickerChatMessages.readAt),
        ),
      );
    const [last] = await this.db
      .select()
      .from(pickerChatMessages)
      .where(eq(pickerChatMessages.pickerId, pickerId))
      .orderBy(desc(pickerChatMessages.id))
      .limit(1);
    return {
      unread: Number(stat?.unread ?? 0),
      lastMessage: last ? this.toMessage(last) : null,
    };
  }

  /** Bandeja del panel: un renglón por picker con no leídos y último mensaje.
   *
   * Con `branchId` solo lista los pickers de esa sucursal (alcance del admin de
   * sucursal). */
  async listConversations(branchId?: number | null): Promise<PickerConversation[]> {
    const pickers = await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        email: users.email,
        isActive: users.isActive,
      })
      .from(users)
      .leftJoin(userBranches, eq(userBranches.userId, users.id))
      .where(
        and(
          eq(users.isPicker, true),
          isNull(users.deletedAt),
          branchId != null ? eq(userBranches.branchId, branchId) : undefined,
        ),
      )
      .orderBy(asc(users.firstName), asc(users.lastName));

    // No leídos por picker (solo lo que escribió el picker).
    const unreadRows = await this.db
      .select({
        pickerId: pickerChatMessages.pickerId,
        unread: sql<number>`count(*)::int`,
      })
      .from(pickerChatMessages)
      .where(
        and(
          eq(pickerChatMessages.senderType, 'picker'),
          isNull(pickerChatMessages.readAt),
        ),
      )
      .groupBy(pickerChatMessages.pickerId);

    // Último mensaje de cada picker (DISTINCT ON = uno por picker).
    const lastRows = await this.db
      .selectDistinctOn([pickerChatMessages.pickerId], {
        pickerId: pickerChatMessages.pickerId,
        body: pickerChatMessages.body,
        senderType: pickerChatMessages.senderType,
        createdAt: pickerChatMessages.createdAt,
      })
      .from(pickerChatMessages)
      .orderBy(pickerChatMessages.pickerId, desc(pickerChatMessages.id));

    const unreadBy = new Map(
      unreadRows.map((r) => [Number(r.pickerId), Number(r.unread)]),
    );
    const lastBy = new Map(lastRows.map((r) => [Number(r.pickerId), r]));

    return (
      pickers
        .map((p) => {
          const last = lastBy.get(Number(p.id));
          return {
            pickerId: Number(p.id),
            fullName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
            username: p.username,
            email: p.email,
            isActive: p.isActive,
            unread: unreadBy.get(Number(p.id)) ?? 0,
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
        })
    );
  }

  /** Mensaje del administrador hacia el picker. */
  async sendFromAdmin(pickerId: number, adminUserId: number, body: string) {
    return this.send(pickerId, 'admin', adminUserId, body);
  }

  /** Mensaje del picker hacia el panel (es su propio hilo). */
  async sendFromPicker(pickerId: number, body: string) {
    return this.send(pickerId, 'picker', pickerId, body);
  }

  private async send(
    pickerId: number,
    side: ChatSide,
    senderUserId: number,
    body: string,
  ) {
    await this.resolvePicker(pickerId);
    const text = this.cleanBody(body);

    const [row] = await this.db
      .insert(pickerChatMessages)
      .values({
        pickerId,
        senderType: side,
        senderUserId,
        body: text,
      })
      .returning();

    const message = this.toMessage(row);

    // Tiempo real: el mensaje del panel va a la sala del picker; y todo va a la
    // sala `staff` para que varias pestañas del panel queden sincronizadas.
    if (side === 'admin') {
      this.gateway.emitToPicker(pickerId, 'picking:chat', { pickerId, message });
      // Aviso push: el picker puede tener la app en segundo plano o cerrada.
      void this.push.sendToUser(pickerId, {
        title: 'Mensaje de administración',
        body: text,
        data: { type: 'CHAT', pickerId: String(pickerId) },
        channelId: 'picking-alerts',
      });
    }
    this.gateway.emitStaff('picking:chat', { pickerId, message });

    return message;
  }

  /** Marca como leídos los mensajes que escribió la contraparte. */
  private async markRead(pickerId: number, viewer: ChatSide) {
    const from: ChatSide = viewer === 'admin' ? 'picker' : 'admin';
    await this.db
      .update(pickerChatMessages)
      .set({ readAt: new Date().toISOString() })
      .where(
        and(
          eq(pickerChatMessages.pickerId, pickerId),
          eq(pickerChatMessages.senderType, from),
          isNull(pickerChatMessages.readAt),
        ),
      );
  }
}
