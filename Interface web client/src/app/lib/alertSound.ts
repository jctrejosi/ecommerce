/**
 * Alerta sonora de las notificaciones del cliente.
 *
 * El sonido se sintetiza con la Web Audio API (dos notas cortas), así no hay que
 * descargar ningún archivo de audio. Los navegadores no dejan sonar nada hasta
 * que el usuario interactúa con la página, así que el contexto se desbloquea en
 * el primer gesto (`unlockAlertSound`); hasta entonces `playAlertSound` no hace
 * nada.
 */

type AudioContextCtor = new () => AudioContext;

let audioContext: AudioContext | null = null;
let unlocked = false;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }
  return audioContext;
}

/** Habilita el sonido. Hay que llamarlo dentro de un gesto del usuario. */
export function unlockAlertSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  unlocked = true;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/** Reproduce la alerta (no hace nada si el audio aún no está desbloqueado). */
export function playAlertSound(): void {
  const ctx = getAudioContext();
  if (!ctx || !unlocked) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  // Dos notas ascendentes (La5 → Mi6): cortas y distinguibles, sin ser
  // estridentes si llegan varias notificaciones seguidas.
  [880, 1318.51].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + index * 0.15;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  });
}
