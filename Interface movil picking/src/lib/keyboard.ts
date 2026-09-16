import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Altura del teclado en pantalla (0 cuando está cerrado).
 *
 * Con edge-to-edge (Android 15+ / targetSdk 35+) el sistema **ignora**
 * `windowSoftInputMode="adjustResize"` y el teclado se superpone al contenido:
 * la app tiene que apartarse por su cuenta. Este hook expone la altura que hay
 * que restar para que el contenido quede por encima del teclado.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // En iOS la animación empieza en `willShow`, así que conviene escuchar ahí
    // para no ver el salto; en Android `willShow` no existe y el evento fiable
    // es `didShow`.
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const show = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
