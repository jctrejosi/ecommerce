import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DriverChatService } from './driver-chat.service';
import { createDbMock } from '../../../test/helpers/db-mock';

function driverSummary(overrides: Record<string, any> = {}) {
  return { id: 5n, fullName: 'Ana', authUserId: 9n, ...overrides };
}

function messageRow(overrides: Record<string, any> = {}) {
  return {
    id: 1n,
    senderType: 'driver',
    senderUserId: 9,
    body: 'hola',
    createdAt: '2024-01-01T10:00:00.000Z',
    readAt: null,
    driverId: 5,
    ...overrides,
  };
}

describe('DriverChatService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let gateway: {
    emitToDriver: ReturnType<typeof vi.fn>;
    emitFleetChat: ReturnType<typeof vi.fn>;
  };
  let pushService: { sendToDriver: ReturnType<typeof vi.fn> };
  let service: DriverChatService;

  beforeEach(() => {
    mock = createDbMock();
    // `selectDistinctOn` no está en el mock compartido: se reaprovecha la cola
    // de `select` porque el test no depende de la forma exacta del SQL.
    (mock.db as any).selectDistinctOn = vi.fn(() => mock.db.select({}));
    gateway = {
      emitToDriver: vi.fn(),
      emitFleetChat: vi.fn(),
    };
    pushService = {
      sendToDriver: vi.fn().mockResolvedValue(undefined),
    };
    service = new DriverChatService(
      mock.drizzle as any,
      gateway as any,
      pushService as any,
    );
  });

  describe('listMessages', () => {
    it('devuelve el hilo y marca como leído lo del otro lado', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueSelect([
        messageRow({ id: 1n, senderType: 'admin', senderUserId: 1 }),
        messageRow({ id: 2n, senderType: 'driver', body: 'respuesta' }),
      ]);

      const messages = await service.listMessages(5, 'driver');

      expect(messages).toEqual([
        {
          id: 1,
          senderType: 'admin',
          senderUserId: 1,
          body: 'hola',
          createdAt: '2024-01-01T10:00:00.000Z',
          readAt: null,
        },
        {
          id: 2,
          senderType: 'driver',
          senderUserId: 9,
          body: 'respuesta',
          createdAt: '2024-01-01T10:00:00.000Z',
          readAt: null,
        },
      ]);
      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toEqual({
        readAt: expect.any(String),
      });
    });

    it('convierte senderUserId null a null', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueSelect([messageRow({ senderUserId: null })]);

      const [message] = await service.listMessages(5, 'admin');

      expect(message.senderUserId).toBeNull();
    });

    it('lanza 404 si el repartidor no existe', async () => {
      mock.queueSelect([]);

      await expect(service.listMessages(5, 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rechaza ids no numéricos sin consultar la BD', async () => {
      await expect(service.listMessages(NaN, 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mock.db.select).not.toHaveBeenCalled();
    });
  });

  describe('summary', () => {
    it('devuelve no leídos y último mensaje (vista admin)', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueSelectOne({ unread: 3 });
      mock.queueSelectOne(messageRow({ body: 'último' }));

      await expect(service.summary(5, 'admin')).resolves.toEqual({
        unread: 3,
        lastMessage: expect.objectContaining({ body: 'último', id: 1 }),
      });
    });

    it('devuelve unread 0 y lastMessage null sin mensajes', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueSelect([]);
      mock.queueSelect([]);

      await expect(service.summary(5, 'driver')).resolves.toEqual({
        unread: 0,
        lastMessage: null,
      });
    });

    it('lanza 404 si el repartidor no existe', async () => {
      mock.queueSelect([]);

      await expect(service.summary(5, 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listConversations', () => {
    it('combina repartidores, no leídos y último mensaje, con orden por actividad', async () => {
      mock.queueSelect([
        {
          id: 1n,
          fullName: 'Zoe',
          phone: '111',
          username: 'zoe',
          routeColor: '#2563EB',
          isActive: true,
        },
        {
          id: 2n,
          fullName: 'Ana',
          phone: '222',
          username: null,
          routeColor: null,
          isActive: true,
        },
        {
          id: 3n,
          fullName: 'Beto',
          phone: '333',
          username: 'beto',
          routeColor: '#DC2626',
          isActive: false,
        },
      ]);
      mock.queueSelect([{ driverId: 1n, unread: 2 }]);
      mock.queueSelect([
        {
          driverId: 1n,
          body: 'hola zoe',
          senderType: 'driver',
          createdAt: '2024-01-02T10:00:00.000Z',
        },
        {
          driverId: 2n,
          body: 'hola ana',
          senderType: 'admin',
          createdAt: '2024-01-03T10:00:00.000Z',
        },
      ]);

      const conversations = await service.listConversations();

      expect(conversations.map((c) => c.fullName)).toEqual([
        'Ana',
        'Zoe',
        'Beto',
      ]);
      expect(conversations[0]).toMatchObject({
        driverId: 2,
        username: null,
        unread: 0,
        lastMessage: { body: 'hola ana', senderType: 'admin' },
      });
      expect(conversations[1]).toMatchObject({
        driverId: 1,
        unread: 2,
        lastMessage: { body: 'hola zoe', senderType: 'driver' },
      });
      expect(conversations[2].lastMessage).toBeNull();
    });

    it('ordena alfabéticamente si ningún repartidor tiene mensajes', async () => {
      mock.queueSelect([
        {
          id: 2n,
          fullName: 'Zoe',
          phone: '1',
          username: null,
          routeColor: null,
          isActive: true,
        },
        {
          id: 1n,
          fullName: 'Ana',
          phone: '2',
          username: null,
          routeColor: null,
          isActive: true,
        },
      ]);
      mock.queueSelect([]);
      mock.queueSelect([]);

      const conversations = await service.listConversations();

      expect(conversations.map((c) => c.fullName)).toEqual(['Ana', 'Zoe']);
    });
  });

  describe('sendFromAdmin', () => {
    it('guarda el mensaje, lo emite y envía push al repartidor', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueInsert([
        messageRow({
          senderType: 'admin',
          senderUserId: 1,
          body: 'mensaje del panel',
        }),
      ]);

      const message = await service.sendFromAdmin(
        5,
        1,
        '  mensaje del panel  ',
      );

      expect(message).toMatchObject({
        id: 1,
        senderType: 'admin',
        body: 'mensaje del panel',
      });
      expect(mock.state.inserts[0].values).toMatchObject({
        driverId: 5,
        senderType: 'admin',
        senderUserId: 1,
        body: 'mensaje del panel',
      });
      expect(gateway.emitToDriver).toHaveBeenCalledWith(
        9,
        'delivery:admin-chat',
        { driverId: 5, message },
      );
      expect(gateway.emitFleetChat).toHaveBeenCalledWith({
        driverId: 5,
        message,
      });
      expect(pushService.sendToDriver).toHaveBeenCalledWith(5, {
        title: 'Mensaje del administrador',
        body: 'mensaje del panel',
        data: { type: 'admin-chat', driverId: '5' },
      });
    });

    it('recorta el cuerpo del push a ~120 caracteres', async () => {
      mock.queueSelectOne(driverSummary());
      const longBody = 'x'.repeat(200);
      mock.queueInsert([messageRow({ senderType: 'admin', body: longBody })]);

      await service.sendFromAdmin(5, 1, longBody);

      const pushBody = pushService.sendToDriver.mock.calls[0][1].body as string;
      expect(pushBody.length).toBeLessThanOrEqual(120);
      expect(pushBody.endsWith('…')).toBe(true);
    });

    it('no falla si el push es rechazado', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueInsert([messageRow({ senderType: 'admin', body: 'hola' })]);
      pushService.sendToDriver.mockRejectedValue(new Error('sin token'));

      await expect(service.sendFromAdmin(5, 1, 'hola')).resolves.toMatchObject({
        body: 'hola',
      });
    });

    it('no emite al repartidor si su cuenta no tiene authUserId', async () => {
      mock.queueSelectOne(driverSummary({ authUserId: null }));
      mock.queueInsert([messageRow({ senderType: 'admin', body: 'hola' })]);

      await service.sendFromAdmin(5, 1, 'hola');

      expect(gateway.emitToDriver).not.toHaveBeenCalled();
      expect(gateway.emitFleetChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendFromDriver', () => {
    it('guarda y emite al panel, sin push ni emisión directa al repartidor', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueInsert([
        messageRow({ senderType: 'driver', body: 'necesito ayuda' }),
      ]);

      const message = await service.sendFromDriver(5, 9, 'necesito ayuda');

      expect(message.senderType).toBe('driver');
      expect(gateway.emitFleetChat).toHaveBeenCalledWith({
        driverId: 5,
        message,
      });
      expect(gateway.emitToDriver).not.toHaveBeenCalled();
      expect(pushService.sendToDriver).not.toHaveBeenCalled();
    });
  });

  describe('validación del mensaje', () => {
    it('rechaza mensajes vacíos', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueSelectOne(driverSummary());

      await expect(service.sendFromAdmin(5, 1, '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.sendFromAdmin(5, 1, '   ')).rejects.toThrow(
        'Escribe un mensaje.',
      );
      expect(mock.state.inserts).toHaveLength(0);
    });

    it('rechaza mensajes de más de 2000 caracteres', async () => {
      mock.queueSelectOne(driverSummary());

      await expect(
        service.sendFromAdmin(5, 1, 'x'.repeat(2001)),
      ).rejects.toThrow('El mensaje no puede superar 2000 caracteres.');
      expect(mock.state.inserts).toHaveLength(0);
    });

    it('acepta exactamente 2000 caracteres', async () => {
      mock.queueSelectOne(driverSummary());
      mock.queueInsert([
        messageRow({ senderType: 'admin', body: 'x'.repeat(2000) }),
      ]);

      await expect(
        service.sendFromAdmin(5, 1, 'x'.repeat(2000)),
      ).resolves.toBeDefined();
    });
  });
});
