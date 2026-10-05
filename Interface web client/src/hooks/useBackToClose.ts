import { useEffect, useRef } from "react";

/**
 * Cierra un modal/overlay cuando se pulsa el botón "atrás" del dispositivo
 * (Android / WebView) o del navegador.
 *
 * Mientras el modal está abierto se empuja una entrada al historial; al
 * retroceder se dispara `popstate` y se cierra. Si el modal se cierra desde la
 * UI (la X u otro botón), se descarta esa entrada para no dejar historial
 * colgado — así el siguiente "atrás" no queda "atrapado".
 */
export function useBackToClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ¿Hay una entrada de historial nuestra pendiente de consumir?
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      // Cerrado desde la UI: consumimos la entrada que habíamos empujado.
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
      return;
    }

    // Abierto: dejamos una entrada "propia" para poder interceptar el atrás.
    window.history.pushState({ __backToClose: true }, "");
    pushedRef.current = true;

    const handlePopState = () => {
      // El atrás ya consumió nuestra entrada.
      pushedRef.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [open]);
}
