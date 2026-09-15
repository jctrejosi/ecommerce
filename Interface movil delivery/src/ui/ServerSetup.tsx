import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { resolveServer, useManualServer } from "@/api/server";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { colors, radius, spacing } from "@/theme";

interface ServerSetupProps {
  /** Direcciones que ya se intentaron (diagnóstico). */
  tried: string[];
  /** Se llama cuando ya hay un servidor respondiendo. */
  onResolved: () => void;
}

/**
 * Pantalla que se muestra cuando la app no encuentra el backend en la red
 * local: permite reintentar el escaneo o escribir la dirección a mano.
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
    if (res.url) {
      onResolved();
    } else {
      setError("No se encontró el servidor en la red local.");
    }
  };

  const useManual = async () => {
    if (!manual.trim()) return;
    setBusy("manual");
    setError(null);
    const ok = await useManualServer(manual);
    setBusy(null);
    if (ok) {
      onResolved();
    } else {
      setError("No respondió ningún servidor en esa dirección.");
    }
  };

  return (
    <Screen title="Conexión" scroll>
      <View style={styles.card}>
        <Image
          source={require("../../assets/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={styles.iconWrap}>
          <Ionicons name="wifi-outline" size={26} color={colors.danger} />
        </View>
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
          <Button label="Buscar de nuevo" icon="search-outline" onPress={() => void retryScan()} />
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {tried.length ? (
          <View style={styles.triedBox}>
            <Text style={styles.triedTitle}>Se intentó con</Text>
            {tried.slice(-4).map((t) => (
              <Text key={t} style={styles.triedItem} numberOfLines={1}>
                • {t}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dirección manual</Text>
        <Text style={styles.text}>
          Si conoces la IP del servidor, escríbela (por ejemplo
          192.168.1.50:3000).
        </Text>
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder="192.168.1.50:3000"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        {busy === "manual" ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Probando la dirección…</Text>
          </View>
        ) : (
          <Button
            label="Usar esta dirección"
            icon="link-outline"
            variant="secondary"
            disabled={!manual.trim()}
            onPress={() => void useManual()}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4),
    marginBottom: spacing(3),
    gap: spacing(3),
  },
  logo: { height: 28, width: 120, alignSelf: "center" },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  text: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.textFaint,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing(2) },
  muted: { fontSize: 13, color: colors.textMuted },
  error: { fontSize: 13, color: colors.danger, textAlign: "center", fontWeight: "600" },
  triedBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing(3),
    gap: 2,
  },
  triedTitle: { fontSize: 11, fontWeight: "800", color: colors.textFaint, marginBottom: 2 },
  triedItem: { fontSize: 11, color: colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(3),
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
});
