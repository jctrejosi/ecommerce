import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/api";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { colors, radius, spacing } from "@/theme";

/** Deep link: deliveryapp://reset-password?token=… */
export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!token) {
      setError("Enlace inválido.");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      Alert.alert("Contraseña actualizada", "Ya puedes iniciar sesión.");
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restablecer la contraseña.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Nueva contraseña</Text>
        {error ? <ErrorBox message={error} /> : null}
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Nueva contraseña"
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Confirmar contraseña"
          secureTextEntry
        />
        <Button label="Guardar contraseña" onPress={submit} loading={loading} />
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
});
