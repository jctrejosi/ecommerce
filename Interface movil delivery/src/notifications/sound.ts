import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * Tono de mensaje entrante ("rockerito").
 *
 * Es un riff corto de dos acordes de potencia distorsionados, poco común como
 * tono de notificación. El archivo se genera con
 * `scripts-agent/gen-rockerito-sound.cjs` y vive en `assets/sounds/`.
 */
const SOURCE = require("../../assets/sounds/rockerito.wav");

/** Anti-ráfaga: si llegan varios mensajes juntos, no se pisan los tonos. */
const MIN_GAP_MS = 1200;

let player: AudioPlayer | null = null;
let lastPlayedAt = 0;
let configured = false;

function ensurePlayer(): AudioPlayer | null {
  try {
    if (!player) {
      player = createAudioPlayer(SOURCE);
      player.volume = 0.9;
    }
    return player;
  } catch (err) {
    console.warn("⚠️ no se pudo preparar el tono de mensaje:", err);
    return null;
  }
}

/**
 * Configura el modo de audio una sola vez.
 *
 * - `playsInSilentMode`: el tono suena aunque el móvil esté en silencio.
 * - `shouldPlayInBackground`: suena también con la app en segundo plano, que es
 *   el caso normal en la calle (el repartidor lleva Waze u otra app delante y
 *   necesita enterarse igual del mensaje).
 * - `duckOthers`: no corta lo que esté sonando, solo lo baja un momento.
 */
export async function configureMessageSound(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "duckOthers",
    });
  } catch {
    /* sin audio configurado la app sigue funcionando, solo no sonará el tono */
  }
}

/** Reproduce el tono de mensaje entrante (idempotente y a prueba de errores). */
export function playIncomingMessageSound(): void {
  const now = Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) {
    console.log("[rockerito] tono omitido (llegan mensajes en ráfaga)");
    return;
  }
  lastPlayedAt = now;

  const sound = ensurePlayer();
  if (!sound) return;
  try {
    // Reinicia por si el tono anterior seguía sonando.
    void sound.seekTo(0);
    sound.play();
    console.log("[rockerito] tono reproducido");
  } catch (err) {
    console.warn("⚠️ no se pudo reproducir el tono de mensaje:", err);
  }
}
