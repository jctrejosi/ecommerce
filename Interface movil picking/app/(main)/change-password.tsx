import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { makeStyles, radius, spacing, useTheme } from "@/theme";
import { apiErrorMessage, pickingApi } from "@/api";
import { useKeyboardHeight } from "@/lib/keyboard";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { ErrorBox } from "@/ui/ErrorBox";

/** Mismo mínimo que exige el backend y el panel de picking. */
const MIN_LENGTH = 8;

/**
 * Cambio de contraseña del picker, abierto desde el detalle de usuario del
 * header. Pide la actual: el dispositivo queda en la bodega y sin ese control
 * cualquiera podría cambiarla desde la app abierta.
 */
export default function ChangePasswordScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  // Con edge-to-edge Android ignora `adjustResize`: apartamos el formulario.
  const keyboardHeight = useKeyboardHeight();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!current) {
      setError("Escribe tu contraseña actual.");
      return;
    }
    if (next.length < MIN_LENGTH) {
      setError(`La nueva contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (next !== repeat) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }

    setBusy(true);
    try {
      await pickingApi.changePassword(current, next);
      Alert.alert("Contraseña actualizada", "La próxima vez ingresa con la nueva.", [
        { text: "Listo", onPress: () => router.back() },
      ]);
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo cambiar la contraseña"));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !!current && next.length >= MIN_LENGTH && next === repeat;

  return (
    <View style={styles.root}>
      <Header title="Cambiar contraseña" onBack={() => router.back()} />

      <Screen>
        <View style={{ paddingBottom: keyboardHeight }}>
          {error ? (
            <View style={styles.mb}>
              <ErrorBox message={error} />
            </View>
          ) : null}

          <Text style={styles.label}>Contraseña actual</Text>
          <TextInput
            value={current}
            onChangeText={setCurrent}
            placeholder="••••••••"
            placeholderTextColor={colors.textHint}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />

          <Text style={styles.label}>Nueva contraseña</Text>
          <TextInput
            value={next}
            onChangeText={setNext}
            placeholder={`mínimo ${MIN_LENGTH} caracteres`}
            placeholderTextColor={colors.textHint}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />

          <Text style={styles.label}>Repite la nueva</Text>
          <TextInput
            value={repeat}
            onChangeText={setRepeat}
            onSubmitEditing={() => void submit()}
            placeholder="••••••••"
            placeholderTextColor={colors.textHint}
            secureTextEntry
            autoCapitalize="none"
            returnKeyType="go"
            style={styles.input}
          />

          <Pressable
            onPress={() => void submit()}
            disabled={busy || !canSubmit}
            style={({ pressed }) => [
              styles.primary,
              (busy || !canSubmit) && styles.primaryDisabled,
              pressed && { opacity: 0.9 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.primaryText}>Guardar contraseña</Text>
            )}
          </Pressable>
        </View>
      </Screen>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  mb: { marginBottom: spacing(4) },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "700", marginBottom: spacing(1.5) },
  input: {
    height: 50,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing(4),
  },
  primary: {
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing(2),
  },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: colors.onAccent, fontSize: 15, fontWeight: "800" },
}));
