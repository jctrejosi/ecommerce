import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/theme";
import { getApiUrl, setApiUrl } from "@/api/apiConfig";
import { findBackend, probeBackend } from "@/api/discovery";
import { useAuthStore } from "@/auth/authStore";
import { connectPickingSocket, disconnectPickingSocket } from "@/socket";
import { queryClient } from "@/lib/queryClient";

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  /** Abre el login (cambio de usuario). */
  onSwitchUser: () => void;
}

/**
 * Información del usuario activo + estado del servidor. El backend se
 * descubre automáticamente en la red local; aquí solo se muestra y se puede
 * forzar una nueva búsqueda.
 */
export function SettingsModal({ visible, onClose, onSwitchUser }: SettingsModalProps) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [url, setUrl] = useState(getApiUrl());
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setUrl(getApiUrl());
      setStatus(null);
    }
  }, [visible]);

  const rescan = async () => {
    setSearching(true);
    setStatus(null);
    try {
      const found = await findBackend();
      if (found) {
        await setApiUrl(found);
        setUrl(found);
        setStatus(`Servidor encontrado: ${found}`);
        // Re-conecta eventos y refresca datos contra el nuevo servidor.
        disconnectPickingSocket();
        connectPickingSocket();
        void queryClient.clear();
        void queryClient.invalidateQueries();
      } else {
        setStatus("No se encontró ningún servidor en la red local.");
      }
    } finally {
      setSearching(false);
    }
  };

  // Estado en vivo del servidor activo.
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void probeBackend(getApiUrl(), 1500).then((ok) => {
      if (!cancelled) setOnline(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, url]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(spacing(8), insets.bottom + spacing(4)) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          {/* Usuario */}
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name ?? "?").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.name} numberOfLines={1}>
                {user?.name ?? "Sin sesión"}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                @{user?.username ?? "—"} · {user?.email ?? ""}
              </Text>
              {user?.isSuperuser ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>ADMINISTRADOR</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Servidor */}
          <View style={styles.serverHeader}>
            <Text style={styles.sectionTitle}>Servidor</Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.dot,
                  online === null
                    ? styles.dotUnknown
                    : online
                      ? styles.dotOk
                      : styles.dotBad,
                ]}
              />
              <Text style={styles.statusText}>
                {online === null
                  ? "verificando…"
                  : online
                    ? "conectado"
                    : "sin conexión"}
              </Text>
            </View>
          </View>

          <View style={styles.urlBox}>
            <Text style={styles.urlLabel}>URL activa (descubierta en la red)</Text>
            <Text style={styles.url} numberOfLines={1}>
              {url}
            </Text>
          </View>

          <Pressable
            onPress={() => void rescan()}
            disabled={searching}
            style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.9 }]}
          >
            {searching ? (
              <ActivityIndicator color={colors.onAccent} size="small" />
            ) : (
              <Ionicons name="wifi-outline" size={18} color={colors.onAccent} />
            )}
            <Text style={styles.scanText}>
              {searching ? "Buscando en la red…" : "Buscar servidor ahora"}
            </Text>
          </Pressable>

          {status ? <Text style={styles.saved}>{status}</Text> : null}

          {/* Acciones de sesión */}
          <View style={styles.actions}>
            <Pressable
              onPress={onSwitchUser}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="people-outline" size={18} color={colors.textMuted} />
              <Text style={styles.actionText}>Cambiar de usuario</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void logout();
                onClose();
              }}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.dangerText} />
              <Text style={[styles.actionText, { color: colors.dangerText }]}>
                Cerrar sesión
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing(5),
    paddingBottom: spacing(8),
    paddingTop: spacing(2),
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing(4),
  },
  userRow: { flexDirection: "row", alignItems: "center", gap: spacing(3), marginBottom: spacing(5) },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onAccent, fontSize: 22, fontWeight: "800" },
  userInfo: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,179,0,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,179,0,0.4)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2),
    paddingVertical: 2,
    marginTop: spacing(2),
  },
  badgeText: { color: "#FFB300", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  serverHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing(2),
  },
  sectionTitle: {
    color: colors.textHint,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOk: { backgroundColor: "#34C759" },
  dotBad: { backgroundColor: colors.danger },
  dotUnknown: { backgroundColor: colors.textHint },
  statusText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  urlBox: {
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    marginBottom: spacing(2),
  },
  urlLabel: { color: colors.textHint, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  url: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: 2 },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing(3),
  },
  scanText: { color: colors.onAccent, fontSize: 14, fontWeight: "800" },
  saved: { color: "#34C759", fontSize: 12, fontWeight: "700", marginTop: spacing(2) },
  actions: { gap: spacing(2), marginTop: spacing(6) },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2.5),
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
  },
  actionText: { color: colors.textMuted, fontSize: 14, fontWeight: "700" },
});
