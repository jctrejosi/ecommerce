import { useEffect } from "react";
import { router } from "expo-router";
import { pickingApi } from "@/api";
import { useAuthStore } from "@/auth/authStore";
import {
  ensureNotificationPermission,
  getDevicePushToken,
  loadNotifications,
} from "./push";

/**
 * Registro del dispositivo para el push (FCM).
 *
 * Al iniciar sesión se pide el permiso, se obtiene el token FCM y se entrega al
 * backend, que lo guarda en `users.push_token`. Con eso el servidor puede avisar
 * al picker aunque la app esté en segundo plano o cerrada (pedido nuevo o
 * mensaje de administración).
 */
export function usePushRegistration(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (userId == null) return;
    let cancelled = false;

    void (async () => {
      // El permiso se pide aquí: es cuando el picker ya está dentro y el aviso
      // tiene sentido para él.
      await ensureNotificationPermission();
      const token = await getDevicePushToken();
      if (!token || cancelled) return;
      try {
        await pickingApi.registerPushToken(token);
        console.log("[push] token registrado en el backend");
      } catch (err) {
        console.warn("[push] no se pudo registrar el token:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);
}

/**
 * Lleva al picker a la pantalla correcta cuando toca una notificación: el pedido
 * nuevo abre su detalle y un mensaje de administración abre el chat.
 *
 * Se monta dentro del área autenticada, así que si la app se abrió desde el
 * aviso estando sin sesión, primero pasa por el login y navega al entrar.
 */
export function useNotificationRouting(): void {
  useEffect(() => {
    let cancelled = false;
    let sub: { remove: () => void } | undefined;

    void (async () => {
      const Notifications = await loadNotifications();
      if (!Notifications || cancelled) return;

      const go = (data: Record<string, unknown> | undefined) => {
        const type = String(data?.type ?? "");
        if (type === "ORDER" && data?.orderId != null) {
          router.push(`/(main)/order/${Number(data.orderId)}`);
        } else if (type === "CHAT") {
          router.push("/(main)/chat");
        }
      };

      // Toque con la app abierta (o en segundo plano).
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        go(response.notification.request.content.data as Record<string, unknown>);
      });

      // La app pudo abrirse justo por el toque: ese caso llega aquí.
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!cancelled && last) {
        go(last.notification.request.content.data as Record<string, unknown>);
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
}
