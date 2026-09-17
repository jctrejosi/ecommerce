/**
 * Genera el tono de "pedido nuevo" de la app móvil de picking.
 *
 * Son dos campanadas ascendentes (A5 → E6) con timbre metálico: suena a aviso
 * de mostrador, no a notificación de mensajería. Distinto del "rockerito" del
 * delivery para que en una tienda con las dos apps abiertas se distingan.
 *
 * Salida (16-bit PCM mono 44.1 kHz):
 *   - Interface movil picking/assets/sounds/picking-alert.wav
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/gen-picking-alert-sound.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'Interface movil picking', 'assets', 'sounds', 'picking-alert.wav');

const SR = 44100;
const DURATION = 0.95;

/** Campanadas: [inicio, duración, fundamental]. La segunda sube una quinta. */
const BELLS = [
  { start: 0.0, dur: 0.46, freq: 880.0 }, // A5
  { start: 0.3, dur: 0.65, freq: 1318.51 }, // E6
];

/**
 * Parciales de una campana: [ratio, amplitud, decaimiento]. Los agudos caen más
 * rápido, que es lo que da el timbre metálico (y no el de un tono puro).
 */
const PARTIALS = [
  { ratio: 1.0, amp: 1.0, decay: 3.1 },
  { ratio: 2.0, amp: 0.55, decay: 4.6 },
  { ratio: 2.76, amp: 0.32, decay: 6.2 },
  { ratio: 5.4, amp: 0.16, decay: 8.5 },
];

function render() {
  const total = Math.floor(SR * DURATION);
  const out = new Float32Array(total);

  for (const bell of BELLS) {
    const start = Math.floor(bell.start * SR);
    const len = Math.floor(bell.dur * SR);
    for (let i = 0; i < len && start + i < total; i++) {
      const t = i / SR;
      // Ataque corto (el mazo golpea) y cola exponencial de cada parcial.
      const attack = Math.min(1, t / 0.004);
      let v = 0;
      for (const p of PARTIALS) {
        v +=
          Math.sin(2 * Math.PI * bell.freq * p.ratio * t) *
          p.amp *
          Math.exp(-p.decay * t);
      }
      out[start + i] += v * attack * 0.34;
    }
  }

  // Normalizar dejando margen y desvanecer el final para no chasquear.
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? 0.85 / peak : 1;
  const fade = Math.floor(0.04 * SR);
  for (let i = 0; i < total; i++) {
    let v = out[i] * gain;
    if (i > total - fade) v *= (total - i) / fade;
    out[i] = v;
  }
  return out;
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const wav = toWav(render());
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, wav);
console.log(`escrito ${path.relative(ROOT, OUT)} (${(wav.length / 1024).toFixed(1)} KB)`);
