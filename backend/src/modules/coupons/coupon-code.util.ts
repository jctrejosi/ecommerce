import { randomInt } from 'node:crypto';

/**
 * Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) para códigos impresos.
 * 32^8 ≈ 1.1e12 combinaciones por prefijo.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateCouponCodeString(prefix = 'CUP'): string {
  const pick = () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `${prefix}-${group()}-${group()}`;
}
