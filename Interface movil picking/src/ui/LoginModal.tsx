import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import { apiErrorMessage, type Picker } from "@/api";
import { usePickers } from "@/picking/queries";
import { useAuthStore } from "@/auth/authStore";

interface LoginModalProps {
  visible: boolean;
  /** Solo se permite cerrar cuando ya hay sesión (cambio de usuario / logout). */
  onClose?: () => void;
}

/**
 * Login en dos pasos: primero la lista de usuarios (igual que el selector
 * actual) y, al elegir uno, se pide la contraseña.
 */
export function LoginModal({ visible, onClose }: LoginModalProps) {
  const { data: pickers, isLoading } = usePickers();
  const current = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);

  const [selected, setSelected] = useState<Picker | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(null);
    setPassword("");
    setError(null);
  };

  const submit = async () => {
    if (!selected || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(selected.username || selected.email || "", password);
      reset();
      onClose?.();
    } catch (e) {
      setError(apiErrorMessage(e, "Usuario o contraseña incorrectos"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => (selected ? reset() : onClose?.())}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          {!selected ? (
            <>
              <View style={styles.head}>
                <Text style={styles.title}>¿Quién eres?</Text>
                <Text style={styles.sub}>Selecciona tu usuario para iniciar sesión</Text>
              </View>

              {isLoading ? (
                <ActivityIndicator color={colors.accent} style={styles.loader} />
              ) : (
                <FlatList
                  data={pickers ?? []}
                  keyExtractor={(p) => String(p.id)}
                  style={styles.list}
                  renderItem={({ item }) => {
                    const active = item.id === current?.id;
                    return (
                      <Pressable
                        onPress={() => {
                          setSelected(item);
                          setPassword("");
                          setError(null);
                        }}
                        style={({ pressed }) => [
                          styles.row,
                          active && styles.rowActive,
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {item.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.name} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
                      </Pressable>
                    );
                  }}
                />
              )}

              {current ? (
                <Pressable
                  onPress={() => {
                    void logout();
                    reset();
                  }}
                  style={styles.logout}
                >
                  <Ionicons name="log-out-outline" size={16} color={colors.dangerText} />
                  <Text style={styles.logoutText} numberOfLines={1}>
                    Cerrar sesión ({current.name})
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.head}>
                <Text style={styles.title}>{selected.name}</Text>
                <Text style={styles.sub}>Ingresa tu contraseña para continuar</Text>
              </View>

              <View style={styles.form}>
                <View style={styles.userChip}>
                  <View style={styles.avatarSmall}>
                    <Text style={styles.avatarText}>
                      {selected.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.userName} numberOfLines={1}>
                    {selected.username || selected.email || selected.name}
                  </Text>
                </View>

                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={() => void submit()}
                  placeholder="Contraseña"
                  placeholderTextColor={colors.textHint}
                  secureTextEntry
                  autoFocus
                  style={styles.input}
                  returnKeyType="go"
                />

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  onPress={() => void submit()}
                  disabled={busy || password.length === 0}
                  style={({ pressed }) => [
                    styles.primary,
                    (busy || password.length === 0) && styles.primaryDisabled,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={styles.primaryText}>Iniciar sesión</Text>
                  )}
                </Pressable>

                <Pressable onPress={reset} style={styles.secondary}>
                  <Text style={styles.secondaryText}>‹ Elegir otro usuario</Text>
                </Pressable>
              </View>
            </>
          )}
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
    paddingTop: spacing(2),
    paddingBottom: spacing(6),
    maxHeight: "80%",
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing(3),
  },
  head: { paddingHorizontal: spacing(5), paddingBottom: spacing(3) },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.textFaint, fontSize: 12, fontWeight: "500", marginTop: 2 },
  loader: { paddingVertical: spacing(8) },
  list: { paddingHorizontal: spacing(4) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    marginBottom: spacing(2),
  },
  rowActive: { backgroundColor: "rgba(251,191,36,0.10)", borderColor: "rgba(251,191,36,0.30)" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmall: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onAccent, fontSize: 15, fontWeight: "800" },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    marginTop: spacing(3),
    paddingVertical: spacing(3),
    marginHorizontal: spacing(4),
    borderRadius: radius.md,
    backgroundColor: "rgba(239,68,68,0.10)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.30)",
  },
  logoutText: { color: colors.dangerText, fontSize: 13, fontWeight: "700" },
  form: { paddingHorizontal: spacing(5), gap: spacing(3) },
  userChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  userName: { flex: 1, color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  input: {
    height: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    color: colors.text,
    fontSize: 15,
  },
  error: { color: colors.dangerText, fontSize: 12, fontWeight: "600" },
  primary: {
    height: 50,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: colors.onAccent, fontSize: 15, fontWeight: "800" },
  secondary: { alignItems: "center", paddingVertical: spacing(2) },
  secondaryText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
});
