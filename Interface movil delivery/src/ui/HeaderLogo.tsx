import { Image } from "react-native";

/** Relación de aspecto del `logo.png` (213×69). */
const RATIO = 69 / 213;

/**
 * Logo DSI que acompaña los títulos en las cabeceras de la app (lado derecho).
 * Se usa tanto en la cabecera propia (`Screen`) como en `headerRight` de las
 * pantallas con barra nativa (mapa, chat).
 */
export function HeaderLogo({ width = 62 }: { width?: number }) {
  return (
    <Image
      source={require("../../assets/logo.png")}
      style={{ width, height: Math.round(width * RATIO) }}
      resizeMode="contain"
    />
  );
}
