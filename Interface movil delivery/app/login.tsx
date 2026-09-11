import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthStore } from "@/auth/authStore";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { USE_MOCK } from "@/api";
import { colors, radius, spacing } from "@/theme";

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    clearError();
    setFieldError(null);
    if (!username.trim() || !password) {
      setFieldError("Ingresa usuario y contraseña.");
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      router.replace("/(main)");
    } catch {
      // el error ya queda en el store
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.wrap}>
          <View style={styles.header}>
            <Image
              source={require("../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.subtitle}>
              Repartidores · Inicia sesión con tu usuario
            </Text>
          </View>

          <View style={styles.card}>
            {error ? <ErrorBox message={error} /> : null}
            {fieldError ? <ErrorBox message={fieldError} /> : null}

            <Text style={styles.label}>Usuario o correo</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="usuario@empresa.com"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
            />

            <Text style={styles.label}>Contraseña</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoComplete="current-password"
            />

            <View style={styles.forgotRow}>
              <Link href="/forgot-password" style={styles.link}>
                ¿Olvidaste tu contraseña?
              </Link>
            </View>

            <Button
              label="Iniciar sesión"
              icon="log-in-outline"
              onPress={submit}
              loading={loading}
            />

            {USE_MOCK ? (
              <Text style={styles.mockHint}>
                Modo demo: usa <Text style={styles.mockCred}>demo / demo1234</Text>
              </Text>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  wrap: { flex: 1, justifyContent: "center", padding: spacing(5) },
  header: { alignItems: "center", marginBottom: spacing(6) },
  logo: { width: 180, height: 58, marginBottom: spacing(3) },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: spacing(1) },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing(5),
    gap: spacing(3),
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    fontSize: 15,
    color: colors.text,
    marginTop: -spacing(1),
  },
  forgotRow: { alignItems: "flex-end" },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  mockHint: {
    textAlign: "center",
    fontSize: 12,
    color: colors.textFaint,
    marginTop: spacing(1),
  },
  mockCred: { fontWeight: "700", color: colors.textMuted },
});
