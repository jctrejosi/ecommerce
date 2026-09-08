import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { colors, radius, spacing } from "@/theme";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.includes("@")) {
      setError("Ingresa un correo válido.");
      return;
    }
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el correo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Recuperar contraseña</Text>
        {sent ? (
          <Text style={styles.sent}>
            Si el correo existe, te enviamos un enlace para restablecer tu
            contraseña. Revisa tu bandeja de entrada.
          </Text>
        ) : (
          <>
            {error ? <ErrorBox message={error} /> : null}
            <Text style={styles.hint}>
              Escribe tu correo y te enviaremos un enlace de recuperación.
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="correo@empresa.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Button label="Enviar enlace" onPress={submit} loading={loading} />
          </>
        )}
        <View style={styles.row}>
          <Link href="/login" style={styles.link}>
            Volver al login
          </Link>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: spacing(5) },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing(5),
    gap: spacing(3),
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: spacing(1) },
  hint: { fontSize: 14, color: colors.textMuted },
  sent: { fontSize: 14, color: colors.success, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    fontSize: 15,
    color: colors.text,
  },
  row: { alignItems: "center" },
  link: { color: colors.primary, fontSize: 14, fontWeight: "600" },
});
