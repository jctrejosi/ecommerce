import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuthStore } from "@/auth/authStore";
import { Button } from "@/ui/Button";
import { InfoRow } from "@/ui/InfoRow";
import { Screen } from "@/ui/Screen";
import { api, USE_MOCK } from "@/api";
import { getServerUrl, resolveServer } from "@/api/server";
import { colors, radius, spacing } from "@/theme";

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const [server, setServer] = useState(getServerUrl());
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);

  /**
   * Foto de perfil: se elige de la galería, el backend la publica en Cloudinary
   * y guarda la URL en la ficha del repartidor.
   */
  const changeAvatar = async () => {
    if (uploading) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    setUploading(true);
    try {
      const updated = await api.uploadAvatar(picked.assets[0].uri);
      // El backend devuelve el perfil ya con la URL nueva.
      if (user) setUser({ ...user, ...updated });
      Alert.alert("Listo", "Tu foto de perfil se actualizó.");
    } catch (err) {
      Alert.alert(
        "No se pudo subir la foto",
        err instanceof Error ? err.message : "Inténtalo de nuevo.",
      );
    } finally {
      setUploading(false);
    }
  };

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
        <Pressable
          onPress={() => void changeAvatar()}
          style={styles.avatarWrap}
          accessibilityLabel="Cambiar foto de perfil"
        >
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.fullName ?? "D").charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.avatarBadge}>
            <Ionicons name="camera" size={12} color="#FFFFFF" />
          </View>
          {uploading && (
            <View style={styles.avatarLoading}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          )}
        </Pressable>
        <Text style={styles.avatarHint}>
          {uploading ? "Subiendo foto…" : "Toca la foto para cambiarla"}
        </Text>
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
  avatarWrap: { alignSelf: "center", width: 72, height: 72 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.border,
  },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 36,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHint: {
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    marginTop: spacing(1.5),
  },
  avatarText: { color: "#fff", fontSize: 28, fontWeight: "800" },
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
