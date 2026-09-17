import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * Tono de "pedido nuevo".
 *
 * Son dos campanadas ascendentes, distintas del "rockerito" del delivery para
 * que en una tienda con las dos apps abiertas no se confundan. El archivo se
 * genera con `scripts-agent/gen-picking-alert-sound.cjs` y vive en
 * `assets/sounds/`.
 */
const SOURCE = require("../../assets/sounds/picking-alert.wav");

/** Anti-ráfaga: si entran varios pedidos juntos, no se pisan los tonos. */
const MIN_GAP_MS = 1500;

let player: AudioPlayer | null = null;
let lastPlayedAt = 0;
let configured = false;

function ensurePlayer(): AudioPlayer | null {
  try {
    if (!player) {
      player = createAudioPlayer(SOURCE);
      player.volume = 1.0;
    }
    return player;
  } catch (err) {
    console.warn("⚠️ no se pudo preparar el tono de pedido nuevo:", err);
    return null;
  }
}

/**
 * Configura el modo de audio una sola vez.
 *
 * - `playsInSilentMode`: el picker suele llevar el dispositivo en silencio y el
 *   aviso tiene que oírse igual.
 * - `shouldPlayInBackground`: si el socket sigue vivo con la app atrás, el
 *   aviso también suena.
 * - `duckOthers`: no corta lo que esté sonando, solo lo baja un momento.
 */
export async function configureNewOrderSound(): Promise<void> {
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

/** Reproduce el tono de pedido nuevo (idempotente y a prueba de errores). */
export function playNewOrderSound(): void {
  const now = Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) {
    console.log("[aviso] tono omitido (llegan pedidos en ráfaga)");
    return;
  }
  lastPlayedAt = now;

  const sound = ensurePlayer();
  if (!sound) return;
  try {
    // Reinicia por si el tono anterior seguía sonando.
    void sound.seekTo(0);
    sound.play();
    console.log("[aviso] tono de pedido nuevo reproducido");
  } catch (err) {
    console.warn("⚠️ no se pudo reproducir el tono de pedido nuevo:", err);
  }
}
