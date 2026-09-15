import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
import { colors, fmtCOP, fonts, radii, spacing, text } from "../src/theme";
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

const STATUS_BADGE: Record<Order["status"], { bg: string; fg: string }> = {
  pendiente: { bg: colors.accent, fg: "#FFFFFF" },
  preparando: { bg: colors.accent, fg: "#FFFFFF" },
  "en camino": { bg: colors.accent, fg: "#FFFFFF" },
  entregado: { bg: colors.muted, fg: colors.mutedForeground },
  cancelado: { bg: colors.muted, fg: colors.mutedForeground },
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
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => ordersApi.getOrders(),
    enabled: !!customer,
  });

  const expandedOrder =
    orders.data?.find((o) => o.id === expandedOrderId) ?? null;

  const tracking = useQuery({
    queryKey: ["order-tracking", expandedOrderId],
    queryFn: () => ordersApi.liveTracking(expandedOrderId as string),
    enabled: expandedOrder !== null && expandedOrder.status === "en camino",
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

  const openMap = (order: Order) => {
    const location = tracking.data?.driver?.location ?? null;
    const address = tracking.data?.destination?.address ?? order.address;
    if (location && typeof location.lat === "number" && typeof location.lng === "number") {
      void Linking.openURL(
        `https://www.google.com/maps?q=${location.lat},${location.lng}`,
      );
    } else {
      void Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      );
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
                placeholderTextColor={colors.mutedForeground}
                value={firstName}
                onChangeText={setFirstName}
              />
              <TextInput
                style={styles.input}
                placeholder="Apellido"
                placeholderTextColor={colors.mutedForeground}
                value={lastName}
                onChangeText={setLastName}
              />
              <TextInput
                style={styles.input}
                placeholder="Teléfono (opcional)"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder="Correo"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor={colors.mutedForeground}
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
              <ActivityIndicator color={colors.primaryForeground} />
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
            <Ionicons name="person" size={28} color={colors.primaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>
              {customer.fullName || "Cliente Mercaldas"}
            </Text>
            <Text style={styles.profileEmail}>{customer.email}</Text>
          </View>
          <Pressable onPress={() => void logout()} hitSlop={8}>
            <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Pedidos */}
        <Text style={styles.sectionTitle}>Mis pedidos</Text>
        {orders.isLoading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.foreground} />
        ) : orders.data && orders.data.length > 0 ? (
          orders.data.map((o) => {
            const isExpanded = o.id === expandedOrderId;
            const isOnTheWay = o.status === "en camino";
            const badge = STATUS_BADGE[o.status];
            const driver = tracking.data?.driver ?? null;
            const vehicle = driver
              ? [driver.vehicleType, driver.vehiclePlate].filter(Boolean).join(" · ")
              : "";
            const destination =
              tracking.data?.destination?.address ?? o.address;

            return (
              <Pressable
                key={o.id}
                style={styles.orderCard}
                onPress={() => setExpandedOrderId(isExpanded ? null : o.id)}
              >
                <View style={styles.orderHead}>
                  <Text style={styles.orderId}>{o.id}</Text>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.fg }]}>
                      {STATUS_LABEL[o.status]}
                    </Text>
                  </View>
                </View>
                <Text style={styles.orderDate}>{o.date}</Text>
                <Text style={styles.orderItems} numberOfLines={2}>
                  {o.items.map((i) => `${i.quantity}× ${i.name}`).join(" · ")}
                </Text>
                <View style={styles.orderFoot}>
                  <Text style={styles.orderTotal}>{fmtCOP(o.total)}</Text>
                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </View>

                {isExpanded && (
                  <View style={styles.orderDetail}>
                    <Text style={styles.detailHeading}>Productos</Text>
                    {o.items.map((i) => (
                      <View key={i.id} style={styles.detailItemRow}>
                        <Text style={styles.detailItemName} numberOfLines={1}>
                          {i.name}
                        </Text>
                        <Text style={styles.detailItemQty}>× {i.quantity}</Text>
                        <Text style={styles.detailItemPrice}>
                          {fmtCOP(i.price * i.quantity)}
                        </Text>
                      </View>
                    ))}

                    {isOnTheWay ? (
                      <>
                        {tracking.isLoading && (
                          <ActivityIndicator
                            size="small"
                            color={colors.foreground}
                            style={{ alignSelf: "flex-start" }}
                          />
                        )}
                        {driver && (
                          <View style={styles.detailBlock}>
                            <Text style={styles.detailHeading}>Lo lleva</Text>
                            <Text style={styles.detailValue}>
                              {driver.name}
                              {vehicle ? ` · ${vehicle}` : ""}
                            </Text>
                          </View>
                        )}
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailHeading}>
                            Dirección de entrega
                          </Text>
                          <Text style={styles.detailValue}>{destination}</Text>
                        </View>
                        <Pressable
                          style={styles.mapBtn}
                          onPress={() => openMap(o)}
                        >
                          <Text style={styles.mapBtnText}>Ver mapa</Text>
                        </Pressable>
                      </>
                    ) : (
                      <View style={styles.detailBlock}>
                        <Text style={styles.detailHeading}>Dirección</Text>
                        <Text style={styles.detailValue}>{o.address}</Text>
                      </View>
                    )}

                    <View style={styles.detailDivider} />
                    <View style={styles.detailTotalRow}>
                      <Text style={styles.detailTotalLabel}>Total</Text>
                      <Text style={styles.detailTotalValue}>
                        {fmtCOP(o.total)}
                      </Text>
                    </View>
                  </View>
                )}
              </Pressable>
            );
          })
        ) : (
          <Text style={styles.noOrders}>Aún no tienes pedidos.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  authWrap: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  authTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: text.xl,
    color: colors.foreground,
  },
  authSubtitle: {
    fontFamily: fonts.sans,
    fontSize: text.sm,
    color: colors.mutedForeground,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    fontFamily: fonts.sans,
    fontSize: text.sm,
    color: colors.foreground,
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  termsText: { fontFamily: fonts.sans, fontSize: text.xs, color: colors.foreground },
  error: {
    fontFamily: fonts.sans,
    fontSize: text.sm,
    color: colors.accent,
    textAlign: "center",
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: fonts.sansBold,
    fontSize: text.sm,
    color: colors.primaryForeground,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginVertical: spacing.xs,
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: colors.mutedForeground,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  googleBtnText: {
    fontFamily: fonts.sansSemibold,
    fontSize: text.sm,
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
    fontFamily: fonts.sansBold,
    fontSize: 15,
    color: "#4285F4",
  },
  switchText: {
    textAlign: "center",
    color: colors.foreground,
    fontFamily: fonts.sansSemibold,
    fontSize: text.xs,
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
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: {
    fontFamily: fonts.sansBold,
    fontSize: text.base,
    color: colors.foreground,
  },
  profileEmail: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: colors.mutedForeground,
  },
  sectionTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: text.twoXl,
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
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  orderHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  orderId: {
    fontFamily: fonts.displayBlack,
    fontSize: text.sm,
    color: colors.foreground,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontFamily: fonts.sansBold,
    fontSize: text.xs,
  },
  orderDate: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: colors.mutedForeground,
  },
  orderItems: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: colors.mutedForeground,
  },
  orderFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderTotal: {
    fontFamily: fonts.displayBlack,
    fontSize: text.base,
    color: colors.foreground,
  },
  orderDetail: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  detailHeading: {
    fontFamily: fonts.displayBlack,
    fontSize: text.xs,
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  detailItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  detailItemName: {
    flex: 1,
    fontFamily: fonts.sansSemibold,
    fontSize: text.xs,
    color: colors.foreground,
  },
  detailItemQty: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: colors.mutedForeground,
  },
  detailItemPrice: {
    fontFamily: fonts.sansBold,
    fontSize: text.xs,
    color: colors.foreground,
  },
  detailBlock: { gap: 2 },
  detailValue: {
    fontFamily: fonts.sans,
    fontSize: text.sm,
    color: colors.foreground,
  },
  detailDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  detailTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailTotalLabel: {
    fontFamily: fonts.displayBlack,
    fontSize: text.sm,
    color: colors.foreground,
  },
  detailTotalValue: {
    fontFamily: fonts.displayBlack,
    fontSize: text.base,
    color: colors.foreground,
  },
  mapBtn: {
    backgroundColor: colors.secondary,
    borderRadius: radii.xl,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  mapBtnText: {
    fontFamily: fonts.sansSemibold,
    fontSize: text.sm,
    color: colors.secondaryForeground,
  },
  noOrders: {
    textAlign: "center",
    color: colors.mutedForeground,
    fontFamily: fonts.sans,
    fontSize: text.sm,
    marginTop: spacing.xl,
  },
});
