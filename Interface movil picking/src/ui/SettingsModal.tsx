import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/theme";
import { apiErrorMessage, pickingApi } from "@/api";
import { useAuthStore } from "@/auth/authStore";

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  /** Abre el login (cambio de usuario). */
  onSwitchUser: () => void;
}

/**
 * Información del usuario activo y acciones sobre su cuenta: su foto, su
 * contraseña y la sesión.
 *
 * El backend se descubre solo, en segundo plano (ver `api/serverGate`), así que
 * aquí no se muestra nada del servidor.
 */
export function SettingsModal({ visible, onClose, onSwitchUser }: SettingsModalProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const patchUser = useAuthStore((s) => s.patchUser);

  const [uploading, setUploading] = useState(false);

  /** Sube la foto elegida y la refleja en la app (y en el panel, vía backend). */
  const uploadAvatar = async (uri: string) => {
    setUploading(true);
    try {
      const { avatarUrl } = await pickingApi.uploadAvatar(uri);
      await patchUser({ avatarUrl });
    } catch (e) {
      Alert.alert("No se pudo cambiar la foto", apiErrorMessage(e, "Intenta de nuevo."));
    } finally {
      setUploading(false);
    }
  };

  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso necesario", "Habilita la cámara para tomar tu foto.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!res.canceled && res.assets[0]?.uri) await uploadAvatar(res.assets[0].uri);
  };

  const fromGallery = async () => {
    // En Android 13+ se usa el selector del sistema (no hace falta permiso de
    // lectura); en versiones viejas se pide el de siempre.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso necesario", "Habilita el acceso a las fotos para elegir tu imagen.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!res.canceled && res.assets[0]?.uri) await uploadAvatar(res.assets[0].uri);
  };

  const changeAvatar = () => {
    Alert.alert("Cambiar foto", "¿De dónde tomamos la foto?", [
      { text: "Tomar una foto", onPress: () => void fromCamera() },
      { text: "Elegir de la galería", onPress: () => void fromGallery() },
      { text: "Cancelar", style: "cancel" },
    ]);
  };

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
            <Pressable
              onPress={changeAvatar}
              disabled={uploading}
              accessibilityLabel="Cambiar foto de perfil"
              style={({ pressed }) => [styles.avatarWrap, pressed && { opacity: 0.85 }]}
            >
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(user?.name ?? "?").charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              {/* Pista de que la foto es tocable (y estado de subida). */}
              <View style={styles.avatarBadge}>
                {uploading ? (
                  <ActivityIndicator size="small" color={colors.onAccent} />
                ) : (
                  <Ionicons name="camera" size={13} color={colors.onAccent} />
                )}
              </View>
            </Pressable>
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

          {/* Acciones sobre la cuenta */}
          <View style={styles.actions}>
            <Pressable
              onPress={changeAvatar}
              disabled={uploading}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="camera-outline" size={18} color={colors.textMuted} />
              <Text style={styles.actionText}>
                {uploading ? "Subiendo foto…" : "Cambiar foto"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onClose();
                router.push("/(main)/change-password");
              }}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="key-outline" size={18} color={colors.textMuted} />
              <Text style={styles.actionText}>Cambiar contraseña</Text>
            </Pressable>
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
  avatarWrap: { width: 52, height: 52 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.chip },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surfaceAlt,
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
