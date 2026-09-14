import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import {
  GoogleSignin,
  statusCodes as googleStatusCodes,
} from "@react-native-google-signin/google-signin";
import { ordersApi } from "../src/api/orders";
import type { Order } from "../src/api/types";
import { useAuthStore } from "../src/stores/auth";
import { colors, fmtCOP, radius, spacing } from "../src/theme";
import Constants from "expo-constants";

const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
  Constants.expoConfig?.extra?.googleClientId;

if (GOOGLE_CLIENT_ID) {
  GoogleSignin.configure({ webClientId: GOOGLE_CLIENT_ID });
}

const STATUS_LABEL: Record<Order["status"], string> = {
  pendiente: "Pendiente de pago",
  preparando: "Preparando",
  "en camino": "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

function GoogleIcon() {
  return (
    <View style={styles.googleG}>
      <Text style={styles.googleGText}>G</Text>
    </View>
  );
}

export default function AccountScreen() {
  const customer = useAuthStore((s) => s.customer);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const socialLogin = useAuthStore((s) => s.socialLogin);
  const logout = useAuthStore((s) => s.logout);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptsTerms, setAcceptsTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => ordersApi.getOrders(),
    enabled: !!customer,
  });

  useEffect(() => {
    setError(null);
    setPassword("");
  }, [mode]);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Ingresa correo y contraseña.");
      return;
    }
    if (mode === "register") {
      if (!firstName.trim() || !lastName.trim()) {
        setError("Ingresa nombre y apellido.");
        return;
      }
      if (!acceptsTerms) {
        setError("Debes aceptar los términos y condiciones.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email.trim(), password);
      else {
        await register({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
          acceptsTerms,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo continuar");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (!GOOGLE_CLIENT_ID) {
      setError("Google login no está configurado en esta app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInRes = await GoogleSignin.signIn();
      if (!signInRes.data?.idToken) throw new Error("No se obtuvo sesión de Google");
      const tokens = await GoogleSignin.getTokens();
      await socialLogin("google", tokens.accessToken, {
        email: signInRes.data.user.email ?? undefined,
        name: signInRes.data.user.name ?? undefined,
        picture: signInRes.data.user.photo ?? undefined,
        id: signInRes.data.user.id,
      });
    } catch (e: any) {
      if (e?.code === googleStatusCodes.SIGN_IN_CANCELLED) {
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : "No se pudo continuar con Google");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!customer) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.authWrap}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.authTitle}>
            {mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}
          </Text>
          <Text style={styles.authSubtitle}>
            {mode === "login"
              ? "Para ver tus pedidos, direcciones y pagos."
              : "Compra más rápido y sigue tus pedidos en vivo."}
          </Text>

          {mode === "register" && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Nombre"
                placeholderTextColor={colors.muted}
                value={firstName}
                onChangeText={setFirstName}
              />
              <TextInput
                style={styles.input}
                placeholder="Apellido"
                placeholderTextColor={colors.muted}
                value={lastName}
                onChangeText={setLastName}
              />
              <TextInput
                style={styles.input}
                placeholder="Teléfono (opcional)"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder="Correo"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor={colors.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {mode === "register" && (
            <Pressable
              style={styles.termsRow}
              onPress={() => setAcceptsTerms((v) => !v)}
            >
              <Ionicons
                name={acceptsTerms ? "checkbox" : "square-outline"}
                size={20}
                color={colors.foreground}
              />
              <Text style={styles.termsText}>
                Acepto los términos y condiciones
              </Text>
            </Pressable>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            onPress={() => void submit()}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {mode === "login" ? "Entrar" : "Registrarme"}
              </Text>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>o</Text>
            <View style={styles.divider} />
          </View>

          <Pressable
            style={[styles.googleBtn, (!GOOGLE_CLIENT_ID || busy) && { opacity: 0.5 }]}
            onPress={() => void handleGoogle()}
            disabled={busy}
          >
            <GoogleIcon />
            <Text style={styles.googleBtnText}>Continuar con Google</Text>
          </Pressable>
          {!GOOGLE_CLIENT_ID && (
            <Text style={styles.hint}>
              Google login requiere configurar EXPO_PUBLIC_GOOGLE_CLIENT_ID.
            </Text>
          )}

          <Pressable
            onPress={() => setMode(mode === "login" ? "register" : "login")}
          >
            <Text style={styles.switchText}>
              {mode === "login"
                ? "¿No tienes cuenta? Regístrate"
                : "¿Ya tienes cuenta? Inicia sesión"}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Perfil */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={28} color={colors.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>
              {customer.fullName || "Cliente MercAldas"}
            </Text>
            <Text style={styles.profileEmail}>{customer.email}</Text>
          </View>
          <Pressable onPress={() => void logout()} hitSlop={8}>
            <Ionicons name="log-out-outline" size={22} color={colors.muted} />
          </Pressable>
        </View>

        {/* Pedidos */}
        <Text style={styles.sectionTitle}>Mis pedidos</Text>
        {orders.isLoading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.foreground} />
        ) : orders.data && orders.data.length > 0 ? (
          orders.data.map((o) => (
            <View key={o.id} style={styles.orderCard}>
              <View style={styles.orderHead}>
                <Text style={styles.orderId}>{o.id}</Text>
                <Text style={styles.orderStatus}>{STATUS_LABEL[o.status]}</Text>
              </View>
              <Text style={styles.orderDate}>{o.date}</Text>
              <Text style={styles.orderItems} numberOfLines={2}>
                {o.items.map((i) => `${i.quantity}× ${i.name}`).join(" · ")}
              </Text>
              <Text style={styles.orderTotal}>{fmtCOP(o.total)}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.noOrders}>Aún no tienes pedidos.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  authWrap: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  authTitle: { fontSize: 24, fontWeight: "900", color: colors.foreground },
  authSubtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.foreground,
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  termsText: { fontSize: 13, color: colors.foreground },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  hint: { fontSize: 11, color: colors.muted, textAlign: "center" },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { fontWeight: "800", fontSize: 15, color: colors.foreground },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginVertical: spacing.xs,
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 12, color: colors.muted },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  googleBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.foreground,
  },
  googleG: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleGText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#4285F4",
  },
  switchText: {
    textAlign: "center",
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "600",
  },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: { fontSize: 16, fontWeight: "800", color: colors.foreground },
  profileEmail: { fontSize: 12, color: colors.muted },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.foreground,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  orderCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
  },
  orderHead: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  orderId: { fontSize: 14, fontWeight: "800", color: colors.foreground },
  orderStatus: { fontSize: 12, fontWeight: "700", color: colors.muted },
  orderDate: { fontSize: 12, color: colors.muted },
  orderItems: { fontSize: 12, color: colors.muted },
  orderTotal: { fontSize: 14, fontWeight: "800", color: colors.foreground },
  noOrders: {
    textAlign: "center",
    color: colors.muted,
    marginTop: spacing.xl,
  },
});
