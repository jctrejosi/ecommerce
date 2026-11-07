import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeliveryService, parsePoint } from './delivery.service';
import { createDbMock } from '../../../test/helpers/db-mock';

/** Construye un POINT EWKB (lo que Postgres devuelve al pasar por geometry). */
function ewkbPoint(lng: number, lat: number, type = 1) {
  const buffer = Buffer.alloc(21);
  buffer.writeUInt8(1, 0);
  buffer.writeUInt32LE(type, 1);
  buffer.writeDoubleLE(lng, 5);
  buffer.writeDoubleLE(lat, 13);
  return buffer.toString('hex');
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as any;
}

const driver = {
  id: 3n,
  authUserId: 9n,
  currentLocation: 'POINT(-75.6 5.0)',
} as any;

describe('parsePoint', () => {
  it('interpreta WKT POINT(lng lat)', () => {
    expect(parsePoint('POINT(-75.5188 5.0329)')).toEqual({
      lng: -75.5188,
      lat: 5.0329,
    });
  });

  it('interpreta el formato lat,lng del panel', () => {
    expect(parsePoint('5.067,-75.517')).toEqual({ lng: -75.517, lat: 5.067 });
  });

  it('trata 0,0 como sin ubicación', () => {
    expect(parsePoint('0,0')).toBeNull();
  });

  it('interpreta EWKB hexadecimal', () => {
    expect(parsePoint(ewkbPoint(-75.5, 5.1))).toEqual({
      lng: -75.5,
      lat: 5.1,
    });
  });

  it('descarta EWKB que no sea un punto 2D', () => {
    expect(parsePoint(ewkbPoint(-75.5, 5.1, 2))).toBeNull();
  });

  it('devuelve null para valores vacíos o inválidos', () => {
    expect(parsePoint(null)).toBeNull();
    expect(parsePoint(undefined)).toBeNull();
    expect(parsePoint('')).toBeNull();
    expect(parsePoint('no es un punto')).toBeNull();
  });
});

describe('DeliveryService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let service: DeliveryService;

  beforeEach(() => {
    mock = createDbMock();
    service = new DeliveryService(mock.drizzle as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getDriverByAuthUserId', () => {
    it('devuelve el repartidor de la cuenta', async () => {
      mock.queueSelectOne(driver);

      await expect(service.getDriverByAuthUserId(9)).resolves.toBe(driver);
    });

    it('devuelve null si la cuenta no tiene repartidor', async () => {
      mock.queueSelect([]);

      await expect(service.getDriverByAuthUserId(9)).resolves.toBeNull();
    });
  });

  describe('resolveDriver', () => {
    it('lanza 401 si no hay repartidor asociado', async () => {
      mock.queueSelect([]);

      await expect(service.resolveDriver(9)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('resuelve el repartidor existente', async () => {
      mock.queueSelectOne(driver);

      await expect(service.resolveDriver(9)).resolves.toBe(driver);
    });
  });

  describe('saveLocation', () => {
    it('guarda la posición actual y la traza histórica', async () => {
      const result = await service.saveLocation(3, {
        lat: 5.1,
        lng: -75.5,
        speed: 12.345,
        heading: 90.6,
        timestamp: '2024-01-01T00:00:00.000Z',
      });

      expect(result).toEqual({ ok: true, location: { lat: 5.1, lng: -75.5 } });

      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toEqual({
        currentLocation: 'POINT(-75.5 5.1)',
        lastLocationAt: '2024-01-01T00:00:00.000Z',
        lastSeenAt: expect.any(String),
      });

      expect(mock.state.inserts).toHaveLength(1);
      expect(mock.state.inserts[0].values).toEqual({
        driverId: 3,
        location: 'POINT(-75.5 5.1)',
        speedKmh: '12.345',
        headingDegrees: 91,
        recordedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('usa la hora actual y nulos cuando el DTO no los trae', async () => {
      await service.saveLocation(3, { lat: 5.1, lng: -75.5 });

      const inserted = mock.state.inserts[0].values as Record<string, any>;
      expect(inserted.speedKmh).toBeNull();
      expect(inserted.headingDegrees).toBeNull();
      expect(new Date(inserted.recordedAt).toString()).not.toBe('Invalid Date');
    });
  });

  describe('touchLastSeen', () => {
    it('solo actualiza la marca de presencia', async () => {
      const result = await service.touchLastSeen(3);

      expect(result).toEqual({ ok: true, lastSeenAt: expect.any(String) });
      expect(mock.state.updates[0].values).toEqual({
        lastSeenAt: expect.any(String),
      });
    });
  });

  describe('setAvatarUrl', () => {
    it('persiste la URL pública del avatar', async () => {
      await expect(
        service.setAvatarUrl(3, 'https://cdn/avatar.png'),
      ).resolves.toEqual({ ok: true, avatarUrl: 'https://cdn/avatar.png' });

      expect(mock.state.updates[0].values).toMatchObject({
        avatarUrl: 'https://cdn/avatar.png',
        updatedAt: expect.any(String),
      });
    });
  });

  describe('getOrderRoute', () => {
    it('devuelve la ruta del domicilio calculada por OSRM', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.5 5.1)' });
      const fetchMock = vi.fn().mockResolvedValue(
        okJson({
          routes: [
            {
              geometry: 'encoded-polyline',
              distance: '1234.5',
              duration: '567.8',
            },
          ],
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getOrderRoute(driver, 7);

      expect(result).toEqual({
        polyline: 'encoded-polyline',
        distanceM: 1234.5,
        durationS: 567.8,
      });
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/route/v1/car/-75.6,5;-75.5,5.1');
      expect(url).toContain('overview=full');
    });

    it('usa la tienda como destino cuando target=store', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.4 5.2)' });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          okJson({ routes: [{ geometry: 'g', distance: 1, duration: 2 }] }),
        );
      vi.stubGlobal('fetch', fetchMock);

      await service.getOrderRoute(driver, 7, undefined, 'store');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('-75.4,5.2');
    });

    it('prioriza el origen explícito `from` sobre la posición del repartidor', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.5 5.1)' });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          okJson({ routes: [{ geometry: 'g', distance: 1, duration: 2 }] }),
        );
      vi.stubGlobal('fetch', fetchMock);

      await service.getOrderRoute(null, 7, '-75.7,5.3');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/-75.7,5.3;-75.5,5.1');
    });

    it('lanza 422 si el envío no tiene coordenadas', async () => {
      mock.queueSelectOne({ location: null });

      await expect(service.getOrderRoute(driver, 7)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.getOrderRoute(driver, 7)).rejects.toThrow(
        'El pedido no tiene coordenadas de entrega.',
      );
    });

    it('lanza 422 si la tienda no tiene coordenadas', async () => {
      mock.queueSelect([]);

      await expect(
        service.getOrderRoute(driver, 7, undefined, 'store'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('lanza 422 si no hay posición de origen', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.5 5.1)' });

      await expect(
        service.getOrderRoute({ currentLocation: null } as any, 7),
      ).rejects.toThrow('No hay posición de origen (repartidor).');
    });

    it('ignora un `from` inválido y recurre al repartidor', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.5 5.1)' });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          okJson({ routes: [{ geometry: 'g', distance: 1, duration: 2 }] }),
        );
      vi.stubGlobal('fetch', fetchMock);

      await service.getOrderRoute(driver, 7, 'basura');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('-75.6,5;');
    });

    it('propaga un 502 si OSRM responde con error HTTP', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.5 5.1)' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 503 } as any),
      );

      const promise = service.getOrderRoute(driver, 7);
      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await expect(promise).rejects.toThrow('OSRM respondió 503');
    });

    it('propaga un 502 si no se puede conectar con OSRM', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.5 5.1)' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      await expect(service.getOrderRoute(driver, 7)).rejects.toThrow(
        'No se pudo conectar con el motor de rutas (OSRM).',
      );
    });

    it('lanza 404 si OSRM no devuelve geometría', async () => {
      mock.queueSelectOne({ location: 'POINT(-75.5 5.1)' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ routes: [] })));

      await expect(service.getOrderRoute(driver, 7)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
