import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, radius, spacing, THEME_OPTIONS, useTheme } from "@/theme";
import { apiErrorMessage, pickingApi } from "@/api";
import { useAuthStore } from "@/auth/authStore";
import { useBreaks, useUseBreak } from "@/picking/queries";

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
  const styles = useStyles();
  const { colors, preset, setPreset } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const patchUser = useAuthStore((s) => s.patchUser);

  const [uploading, setUploading] = useState(false);
  // Disponibilidad para la cola (true = puede recibir pedidos).
  const [available, setAvailable] = useState(true);
  const breaksQuery = useBreaks(visible);
  const breaks = breaksQuery.data;
  const useBreak = useUseBreak();

  /** Alterna la disponibilidad del picker en la cola de pedidos. */
  const toggleAvailability = async () => {
    const next = !available;
    setAvailable(next);
    try {
      await pickingApi.setAvailability(next);
    } catch {
      setAvailable(!next);
      Alert.alert("No se pudo actualizar", "Intenta de nuevo.");
    }
  };

  /** Reclama todo el banco acumulado (descanso). */
  const claimBreak = () => {
    const mins = breaks?.bankMinutes ?? 0;
    if (mins <= 0) return;
    Alert.alert(
      "Tomar descanso",
      `¿Reclamar ${mins} min acumulados?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Reclamar",
          onPress: () =>
            useBreak.mutate(mins, {
              onSuccess: () =>
                Alert.alert("Descanso registrado", `Se descontaron ${mins} min de tu banco.`),
              onError: (e) =>
                Alert.alert("No se pudo reclamar", apiErrorMessage(e, "Intenta de nuevo.")),
            }),
        },
      ],
    );
  };

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

          <ScrollView showsVerticalScrollIndicator={false}>

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

          {/* Descansos y metas del picker */}
          {breaks ? (
            <View style={styles.breakSection}>
              <View style={styles.breakHeaderRow}>
                <Text style={styles.themeLabel}>Descansos y metas</Text>
                <Text style={styles.breakDay}>{breaks.productsToday} prod. hoy</Text>
              </View>
              <View style={styles.breakRow}>
                <View style={styles.breakBank}>
                  <Text style={styles.breakBankValue}>{breaks.bankMinutes}</Text>
                  <Text style={styles.breakBankLabel}>min acumulados</Text>
                </View>
                <View style={styles.breakGoal}>
                  <Text style={styles.breakGoalText}>
                    {breaks.goal.target > 0
                      ? `Meta diaria: ${breaks.goal.products}/${breaks.goal.target}`
                      : "Sin meta diaria"}
                  </Text>
                  {breaks.goal.target > 0 ? (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(
                              100,
                              (breaks.goal.products / breaks.goal.target) * 100,
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                  ) : null}
                  {breaks.goal.awarded ? (
                    <Text style={styles.bonusText}>
                      Bono de ${breaks.goal.bonusAmount} registrado
                    </Text>
                  ) : breaks.goal.target > 0 ? (
                    <Text style={styles.breakHint}>
                      Faltan {breaks.goal.remaining} para el bono
                    </Text>
                  ) : null}
                </View>
              </View>
              {breaks.bankMinutes > 0 ? (
                <Pressable
                  onPress={claimBreak}
                  disabled={useBreak.isPending}
                  style={({ pressed }) => [styles.claimBtn, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="cafe-outline" size={16} color={colors.onAccent} />
                  <Text style={styles.claimText}>
                    {useBreak.isPending
                      ? "Reclamando…"
                      : `Reclamar ${breaks.bankMinutes} min`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Acciones sobre la cuenta */}
          <View style={styles.actions}>
            {/* Disponibilidad en la cola */}
            <Pressable
              onPress={() => void toggleAvailability()}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={available ? "toggle" : "toggle-outline"}
                size={20}
                color={available ? colors.accent : colors.textMuted}
              />
              <Text style={styles.actionText}>
                {available ? "Disponible para pedidos" : "En pausa"}
              </Text>
            </Pressable>

            {/* Tema */}
            <View style={styles.themeSection}>
              <Text style={styles.themeLabel}>Tema</Text>
              <View style={styles.themeChips}>
                {THEME_OPTIONS.map((opt) => {
                  const active = preset === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => setPreset(opt.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Tema ${opt.label}`}
                      style={({ pressed }) => [
                        styles.themeChip,
                        active && styles.themeChipActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      {/* Muestra de color del tema (como en el admin). */}
                      <View style={[styles.themeSwatch, { backgroundColor: opt.swatch }]} />
                      <Text style={[styles.themeChipText, active && styles.themeChipTextActive]}>
                        {opt.label}
                      </Text>
                      <Text style={[styles.themeChipHint, active && styles.themeChipHintActive]}>
                        {opt.hint}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Pressable
              onPress={() => {
                onClose();
                router.push("/(main)/history");
              }}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="time-outline" size={18} color={colors.textMuted} />
              <Text style={styles.actionText}>Historial de pedidos</Text>
            </Pressable>
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
        </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing(5),
    paddingBottom: spacing(8),
    paddingTop: spacing(2),
    maxHeight: "90%",
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
  themeSection: { gap: spacing(2) },
  themeLabel: {
    color: colors.textHint,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: spacing(1),
  },
  themeChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing(2) },
  themeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
  },
  themeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  themeSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  themeChipText: { color: colors.textMuted, fontSize: 13, fontWeight: "800" },
  themeChipTextActive: { color: colors.onAccent },
  themeChipHint: { color: colors.textHint, fontSize: 10, fontWeight: "600" },
  themeChipHintActive: { color: colors.onAccent, opacity: 0.7 },
  actions: { gap: spacing(2), marginTop: spacing(6) },
  breakSection: { gap: spacing(2), marginTop: spacing(5) },
  breakHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  breakDay: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  breakRow: { flexDirection: "row", gap: spacing(2) },
  breakBank: {
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(3),
    alignItems: "center",
    justifyContent: "center",
    minWidth: 88,
  },
  breakBankValue: { color: colors.accent, fontSize: 24, fontWeight: "900" },
  breakBankLabel: {
    color: colors.textHint,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  breakGoal: {
    flex: 1,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(3),
    justifyContent: "center",
    gap: 3,
  },
  breakGoalText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  progressTrack: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.accent, borderRadius: 3 },
  breakHint: { color: colors.textHint, fontSize: 10, fontWeight: "600" },
  bonusText: { color: colors.successText, fontSize: 10, fontWeight: "800" },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing(3),
  },
  claimText: { color: colors.onAccent, fontSize: 13, fontWeight: "800" },
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
}));
