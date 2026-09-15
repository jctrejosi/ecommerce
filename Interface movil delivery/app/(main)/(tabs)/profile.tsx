import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/auth/authStore";
import { Button } from "@/ui/Button";
import { InfoRow } from "@/ui/InfoRow";
import { Screen } from "@/ui/Screen";
import { USE_MOCK } from "@/api";
import { getServerUrl, resolveServer } from "@/api/server";
import { colors, radius, spacing } from "@/theme";

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [server, setServer] = useState(getServerUrl());
  const [searching, setSearching] = useState(false);

  const searchServer = async () => {
    setSearching(true);
    const res = await resolveServer();
    setServer(getServerUrl());
    setSearching(false);
    Alert.alert(
      res.url ? "Servidor encontrado" : "Sin conexión",
      res.url
        ? `Conectado a ${res.url}`
        : "No se encontró el servidor en la red local.",
    );
  };

  const confirmLogout = () => {
    // En web, Alert con botones no ejecuta callbacks: logout directo.
    if (Platform.OS === "web") {
      void logout().then(() => router.replace("/login"));
      return;
    }
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir",
        style: "destructive",
        onPress: () => {
          void logout().then(() => router.replace("/login"));
        },
      },
    ]);
  };

  return (
    <Screen title="Perfil">
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.fullName ?? "D").charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{user?.fullName ?? "Repartidor"}</Text>
        <Text style={styles.role}>Repartidor · {user?.username}</Text>
        {USE_MOCK ? <Text style={styles.mock}>Modo demo (mock)</Text> : null}
      </View>

      <View style={styles.card}>
        <InfoRow label="Nombre" value={user?.fullName ?? "—"} />
        <InfoRow label="Teléfono" value={user?.phone ?? "—"} />
        <InfoRow label="Correo" value={user?.email ?? "—"} />
        <InfoRow label="Vehículo" value={user?.vehicleType ?? "—"} />
        <InfoRow label="Placa" value={user?.vehiclePlate ?? "—"} />
        <InfoRow
          label="Estado"
          value={user?.isActive === false ? "Inactivo" : "Activo"}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Servidor</Text>
        <InfoRow label="Dirección" value={server || "—"} />
        <Text style={styles.serverHint}>
          Si cambias de red, la app vuelve a buscar el servidor automáticamente.
          Puedes forzarlo aquí.
        </Text>
        <View style={styles.serverBtn}>
          <Button
            label="Buscar servidor de nuevo"
            icon="search-outline"
            variant="secondary"
            loading={searching}
            onPress={() => void searchServer()}
          />
        </View>
      </View>

      <View style={styles.logoutWrap}>
        <Button
          label="Cerrar sesión"
          icon="log-out-outline"
          variant="danger"
          onPress={confirmLogout}
        />
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
    marginBottom: spacing(4),
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  avatarText: { color: "#fff", fontSize: 24, fontWeight: "800" },
  name: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginTop: spacing(2),
  },
  role: { fontSize: 13, color: colors.textMuted, textAlign: "center", marginTop: 2 },
  mock: {
    fontSize: 11,
    color: colors.warning,
    textAlign: "center",
    marginTop: spacing(1),
    fontWeight: "700",
  },
  logoutWrap: { marginTop: spacing(2) },
  cardTitle: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.textFaint,
    marginBottom: spacing(2),
  },
  serverHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing(2),
    lineHeight: 17,
  },
  serverBtn: { marginTop: spacing(3) },
});
