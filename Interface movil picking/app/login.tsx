import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/theme";
import { apiErrorMessage } from "@/api";
import { useAuthStore } from "@/auth/authStore";
import { ErrorBox } from "@/ui/ErrorBox";

/**
 * Login de la app de picking: pantalla propia al arrancar (no modal).
 * Se entra con el usuario/correo y la contraseña que administra el panel
 * de picking. La sesión queda guardada hasta que venza el turno o por
 * inactividad.
 */
export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const user = identifier.trim();
    if (!user || !password) {
      setErrorMsg("Ingresa usuario y contraseña.");
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await login(user, password);
      router.replace("/");
    } catch (e) {
      setErrorMsg(apiErrorMessage(e, "Usuario o contraseña incorrectos"));
    } finally {
      setBusy(false);
    }
  }, [identifier, login, password, router]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <Image
              source={require("../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.appName}>Picking | DSI</Text>
            <Text style={styles.tagline}>Inicia sesión para comenzar</Text>
          </View>

          <View style={styles.card}>
            {errorMsg ? <ErrorBox message={errorMsg} /> : null}

            <Text style={styles.label}>Usuario o correo</Text>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="usuario"
              placeholderTextColor={colors.textHint}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              style={styles.input}
            />

            <Text style={styles.label}>Contraseña</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void submit()}
              placeholder="••••••••"
              placeholderTextColor={colors.textHint}
              secureTextEntry
              autoComplete="current-password"
              returnKeyType="go"
              style={styles.input}
            />

            <Pressable
              onPress={() => void submit()}
              disabled={busy || !identifier.trim() || password.length === 0}
              style={({ pressed }) => [
                styles.primary,
                (busy || !identifier.trim() || password.length === 0) &&
                  styles.primaryDisabled,
                pressed && { opacity: 0.9 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.primaryText}>Iniciar sesión</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing(5) },
  brand: { alignItems: "center", marginBottom: spacing(7) },
  logo: { height: 42, width: 130 },
  appName: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: spacing(2) },
  tagline: { color: colors.textFaint, fontSize: 13, fontWeight: "600", marginTop: spacing(1) },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing(5),
    gap: spacing(3),
  },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  input: {
    height: 50,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    color: colors.text,
    fontSize: 15,
    marginTop: -spacing(1),
  },
  primary: {
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing(1),
  },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: colors.onAccent, fontSize: 15, fontWeight: "800" },
});
