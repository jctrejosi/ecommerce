import { describe, it, expect, afterEach, vi } from 'vitest';
import { DRIVER_COLORS, pickRouteColor } from './driver-colors';

describe('pickRouteColor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('devuelve un color de la paleta', () => {
    expect(DRIVER_COLORS).toContain(pickRouteColor());
  });

  it('evita los colores ya usados', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(pickRouteColor([DRIVER_COLORS[0], DRIVER_COLORS[1]])).toBe(
      DRIVER_COLORS[2],
    );
  });

  it('reutiliza la paleta completa si ya están todos usados', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(pickRouteColor([...DRIVER_COLORS])).toBe(DRIVER_COLORS[0]);
  });

  it('funciona sin argumentos', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    expect(pickRouteColor()).toBe(DRIVER_COLORS[DRIVER_COLORS.length - 1]);
  });
});
