import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { DeliveryGateway } from './delivery.gateway';
import { createConfigMock } from '../../../test/helpers/db-mock';

function makeSocket(token?: string) {
  return {
    id: 'sock-1',
    handshake: { auth: token === undefined ? {} : { token } },
    data: {} as Record<string, any>,
    join: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe('DeliveryGateway', () => {
  let jwt: { verify: ReturnType<typeof vi.fn> };
  let config: ReturnType<typeof createConfigMock>;
  let gateway: DeliveryGateway;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jwt = { verify: vi.fn() };
    config = createConfigMock({ 'jwt.secret': 'secreto' });
    gateway = new DeliveryGateway(jwt as any, config as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleConnection', () => {
    it('une al repartidor a su sala privada', () => {
      jwt.verify.mockReturnValue({ sub: 9 });
      const client = makeSocket('token-driver');

      gateway.handleConnection(client as any);

      expect(jwt.verify).toHaveBeenCalledWith('token-driver', {
        secret: 'secreto',
      });
      expect(client.data).toEqual({ userId: 9, isSuperuser: false });
      expect(client.join).toHaveBeenCalledWith('driver:9');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('une a los administradores a la sala de flota', () => {
      jwt.verify.mockReturnValue({ sub: '4', isSuperuser: true });
      const client = makeSocket('token-admin');

      gateway.handleConnection(client as any);

      expect(client.data).toEqual({ userId: 4, isSuperuser: true });
      expect(client.join).toHaveBeenCalledWith('fleet');
    });

    it('usa el secreto por defecto si no hay configuración', () => {
      config.get.mockReturnValue(undefined);
      jwt.verify.mockReturnValue({ sub: 9 });

      gateway.handleConnection(makeSocket('t') as any);

      expect(jwt.verify).toHaveBeenCalledWith('t', { secret: 'secret-key' });
    });

    it('desconecta si no hay token', () => {
      const client = makeSocket();

      gateway.handleConnection(client as any);

      expect(jwt.verify).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('desconecta si el token es inválido', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const client = makeSocket('token-malo');

      gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('emisión de eventos', () => {
    let emit: ReturnType<typeof vi.fn>;
    let to: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      emit = vi.fn();
      to = vi.fn(() => ({ emit }));
      (gateway as any).server = { to };
    });

    it('emite la posición del repartidor a la flota', () => {
      gateway.emitDriverLocation(5, { lat: 1, lng: 2 });

      expect(to).toHaveBeenCalledWith('fleet');
      expect(emit).toHaveBeenCalledWith('delivery:fleet-location', {
        driverId: 5,
        lat: 1,
        lng: 2,
        at: expect.any(String),
      });
    });

    it('emite a la sala privada del repartidor', () => {
      gateway.emitToDriver(9, 'delivery:assigned', { orderId: 1 });

      expect(to).toHaveBeenCalledWith('driver:9');
      expect(emit).toHaveBeenCalledWith('delivery:assigned', { orderId: 1 });
    });

    it('emite el estado de la flota con marca de tiempo', () => {
      gateway.emitFleetStatus({ event: 'availability', driverId: 5 });

      expect(to).toHaveBeenCalledWith('fleet');
      expect(emit).toHaveBeenCalledWith('delivery:fleet-status', {
        event: 'availability',
        driverId: 5,
        at: expect.any(String),
      });
    });

    it('emite el chat del panel a la sala de flota', () => {
      gateway.emitFleetChat({ driverId: 5, message: 'hola' });

      expect(emit).toHaveBeenCalledWith('delivery:admin-chat', {
        driverId: 5,
        message: 'hola',
        at: expect.any(String),
      });
    });

    it('no falla si el servidor aún no está disponible', () => {
      const fresh = new DeliveryGateway(jwt as any, config as any);

      expect(() => {
        fresh.emitDriverLocation(1, {});
        fresh.emitToDriver(1, 'evt', {});
        fresh.emitFleetStatus({});
        fresh.emitFleetChat({});
      }).not.toThrow();
    });
  });
});
