/**
 * Genera el tono de notificación "rockerito" de la app de delivery.
 *
 * Es un riff corto de dos acordes de potencia (E5 → G5) con distorsión suave y
 * un toque de ruido de púa al atacar: suena a guitarra eléctrica, poco común
 * como tono de notificación.
 *
 * Salidas (16-bit PCM mono 44.1 kHz):
 *   - Interface movil delivery/assets/sounds/rockerito.wav          (playback en la app)
 *   - Interface movil delivery/android/app/src/main/res/raw/rockerito.wav  (canal de notificación)
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/gen-rockerito-sound.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'Interface movil delivery');
const OUTS = [
  path.join(APP, 'assets', 'sounds', 'rockerito.wav'),
  path.join(APP, 'android', 'app', 'src', 'main', 'res', 'raw', 'rockerito.wav'),
];

const SR = 44100;
const DURATION = 0.82;

/** Acordes: [inicio, duración, notas (Hz)] — dos power chords con solape (strum). */
const CHORDS = [
  { start: 0.0, dur: 0.42, root: 82.41 }, // E2  + quinta
  { start: 0.34, dur: 0.46, root: 98.0 }, // G2  + quinta
];

const fifth = (root) => root * 1.4983; // quinta justa

/** Diente de sierra con armónicos limitados (evita aliasing). */
function saw(t, freq) {
  let v = 0;
  const maxH = Math.floor(SR / 2 / freq);
  for (let h = 1; h <= Math.min(maxH, 14); h++) {
    v += Math.sin(2 * Math.PI * freq * h * t) / h;
  }
  return v * 0.55;
}

function envelope(t, dur) {
  const attack = 0.006;
  const release = 0.16;
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  if (t > dur - release) return Math.max(0, (dur - t) / release);
  // Caída suave tras el ataque (como una cuerda que se apaga).
  return 0.35 + 0.65 * Math.exp(-3.2 * (t - attack));
}

function makeNoise(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x3fffffff) - 1;
  };
}

function render() {
  const n = Math.floor(SR * DURATION);
  const out = new Float32Array(n);
  const noise = makeNoise(20260916);

  for (const chord of CHORDS) {
    const start = Math.floor(chord.start * SR);
    const len = Math.floor(chord.dur * SR);
    const notes = [chord.root, fifth(chord.root)];
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SR;
      const env = envelope(t, chord.dur);
      if (env <= 0) continue;
      let v = 0;
      for (const f of notes) {
        // Ligero detune entre "cuerdas" para dar cuerpo.
        v += saw(t, f) + saw(t, f * 1.004) * 0.7;
      }
      // Ruido de púa solo en el ataque.
      if (t < 0.02) v += noise() * 0.6 * (1 - t / 0.02);
      out[start + i] += v * env * 0.32;
    }
  }

  // Distorsión (soft clip) + filtro paso-bajo de un polo para redondear.
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const driven = Math.tanh(out[i] * 7);
    prev = prev + 0.35 * (driven - prev);
    out[i] = prev;
  }

  // Normalizar con margen y desvanecer el final.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? 0.7 / peak : 1;
  const fade = Math.floor(0.03 * SR);
  for (let i = 0; i < n; i++) {
    let v = out[i] * gain;
    if (i > n - fade) v *= (n - i) / fade;
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
  header.writeUInt32LE(16, 16); // tamaño del bloque fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28); // bytes por segundo
  header.writeUInt16LE(2, 32); // alineación
  header.writeUInt16LE(16, 34); // bits por muestra
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const wav = toWav(render());
for (const out of OUTS) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, wav);
  console.log(`escrito ${path.relative(ROOT, out)} (${(wav.length / 1024).toFixed(1)} KB)`);
}
