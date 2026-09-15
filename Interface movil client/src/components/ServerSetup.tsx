import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  getServerUrl,
  resolveServer,
  useManualServer,
} from "../server";
import { colors, radii, spacing, text as type } from "../theme";

interface ServerSetupProps {
  /** Direcciones que ya se intentaron (diagnóstico). */
  tried: string[];
  /** Se llama con la URL cuando ya hay un servidor respondiendo. */
  onResolved: (url: string) => void;
}

/**
 * Pantalla que se muestra cuando el WebView no encuentra el servidor del
 * cliente en la red local: permite reintentar el escaneo o escribir la
 * dirección a mano.
 */
export function ServerSetup({ tried, onResolved }: ServerSetupProps) {
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<"scan" | "manual" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retryScan = async () => {
    setBusy("scan");
    setError(null);
    const res = await resolveServer();
    setBusy(null);
    if (res.url) onResolved(res.url);
    else setError("No se encontró el servidor en la red local.");
  };

  const useManual = async () => {
    if (!manual.trim()) return;
    setBusy("manual");
    setError(null);
    const ok = await useManualServer(manual);
    setBusy(null);
    if (ok) onResolved(getServerUrl());
    else setError("No respondió ningún servidor en esa dirección.");
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>No encontramos el servidor</Text>
        <Text style={styles.text}>
          Verifica que el celular esté conectado al Wi-Fi de la tienda y vuelve a
          buscar. El servidor se descubre automáticamente en la red local.
        </Text>

        {busy === "scan" ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Buscando en la red local…</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={() => void retryScan()}
          >
            <Text style={styles.buttonLabel}>Buscar de nuevo</Text>
          </Pressable>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {tried.length ? (
          <View style={styles.triedBox}>
            <Text style={styles.triedTitle}>Se intentó con</Text>
            {tried.slice(-4).map((item) => (
              <Text key={item} style={styles.triedItem} numberOfLines={1}>
                • {item}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dirección manual</Text>
        <Text style={styles.text}>
          Si conoces la IP del servidor, escríbela (por ejemplo 192.168.1.50).
        </Text>
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder="192.168.1.50"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        {busy === "manual" ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.secondary} />
            <Text style={styles.muted}>Probando la dirección…</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={!manual.trim()}
            style={({ pressed }) => [
              styles.button,
              styles.buttonSecondary,
              !manual.trim() && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
            onPress={() => void useManual()}
          >
            <Text style={styles.buttonLabel}>Usar esta dirección</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: type.lg,
    fontWeight: "800",
    color: colors.secondary,
    textAlign: "center",
  },
  text: {
    fontSize: type.xs,
    color: colors.mutedForeground,
    textAlign: "center",
    lineHeight: 19,
  },
  cardTitle: {
    fontSize: type.xxs + 1,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  muted: { fontSize: type.xs, color: colors.mutedForeground },
  error: {
    fontSize: type.xs,
    color: colors.destructive,
    textAlign: "center",
    fontWeight: "600",
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: colors.secondary,
  },
  buttonDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  buttonLabel: {
    fontSize: type.sm,
    fontWeight: "800",
    color: colors.primaryForeground,
  },
  triedBox: {
    backgroundColor: colors.muted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  triedTitle: {
    fontSize: type.xxs,
    fontWeight: "800",
    color: colors.mutedForeground,
    marginBottom: 2,
  },
  triedItem: { fontSize: type.xxs, color: colors.mutedForeground },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: type.base - 1,
    color: colors.foreground,
    backgroundColor: colors.muted,
  },
});
