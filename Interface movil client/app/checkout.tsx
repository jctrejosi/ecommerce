import { useState, useCallback } from "react";
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
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ordersApi, type PaymentMethod } from "../src/api/orders";
import { useAuthStore } from "../src/stores/auth";
import { useCartStore } from "../src/stores/cart";
import { colors, fmtCOP, radius, spacing } from "../src/theme";

const SHIPPING_TYPES = [
  { key: "standard", label: "Estándar (1-2 h)" },
  { key: "express", label: "Express (60 min)" },
] as const;

const PAYMENT_METHODS: { key: PaymentMethod; label: string; icon: string }[] = [
  { key: "efectivo", label: "Efectivo contra entrega", icon: "cash-outline" },
  { key: "nequi", label: "Nequi", icon: "phone-portrait-outline" },
  { key: "pse", label: "PSE", icon: "globe-outline" },
  { key: "tarjeta", label: "Tarjeta", icon: "card-outline" },
  { key: "breb", label: "Botón Bancolombia (Breb)", icon: "apps-outline" },
];

export default function CheckoutScreen() {
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore((s) => s.subtotal());
  const clear = useCartStore((s) => s.clear);
  const customer = useAuthStore((s) => s.customer);

  const [name, setName] = useState(customer?.fullName ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("Manizales");
  const [notes, setNotes] = useState("");
  const [shippingType, setShippingType] = useState<"standard" | "express">("standard");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Al volver a entrar al checkout (después de un pedido exitoso), reinicia la
  // pantalla de éxito para permitir una nueva compra.
  useFocusEffect(
    useCallback(() => {
      if (done && items.length > 0) {
        setDone(null);
      }
    }, [done, items.length]),
  );

  const shippingCost = shippingType === "express" ? 9900 : 4900;
  const total = subtotal + shippingCost;

  const submit = async () => {
    if (!name.trim() || !phone.trim() || !address.trim() || !city.trim()) {
      setError("Completa nombre, teléfono, dirección y ciudad.");
      return;
    }
    if (!/^3\d{9}$/.test(phone.trim())) {
      setError("El teléfono debe ser un celular válido (10 dígitos, ej: 3001234567).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Ingresa un correo válido.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const payload = {
        items: items.map((i) => ({ productId: i.id, quantity: i.quantity })),
        address: {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          city: city.trim(),
          notes: notes.trim() || undefined,
        },
        shippingType,
        paymentMethod,
      };
      const res = customer
        ? await ordersApi.checkout(payload)
        : await ordersApi.guestCheckout(payload);
      clear();
      setDone(res.referenceCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el pedido");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.doneWrap}>
          <Ionicons name="checkmark-circle" size={72} color={colors.success} />
          <Text style={styles.doneTitle}>¡Pedido registrado!</Text>
          <Text style={styles.doneCode}>Código: {done}</Text>
          <Text style={styles.doneText}>
            Te notificaremos cuando esté listo. Puedes verlo en Mi cuenta → Pedidos.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.push("/")}>
            <Text style={styles.primaryBtnText}>Volver al inicio</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        {/* Dirección */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Datos de entrega</Text>
          <TextInput style={styles.input} placeholder="Nombre de quien recibe" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Teléfono (celular, 10 dígitos)" placeholderTextColor={colors.muted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={styles.input} placeholder="Correo" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextInput style={styles.input} placeholder="Dirección" placeholderTextColor={colors.muted} value={address} onChangeText={setAddress} />
          <TextInput style={styles.input} placeholder="Ciudad" placeholderTextColor={colors.muted} value={city} onChangeText={setCity} />
          <TextInput style={styles.input} placeholder="Notas (opcional)" placeholderTextColor={colors.muted} value={notes} onChangeText={setNotes} />
        </View>

        {/* Envío */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tipo de envío</Text>
          {SHIPPING_TYPES.map((t) => (
            <Pressable
              key={t.key}
              style={[styles.option, shippingType === t.key && styles.optionActive]}
              onPress={() => setShippingType(t.key)}
            >
              <Text style={styles.optionLabel}>{t.label}</Text>
              <Text style={styles.optionValue}>
                {t.key === "express" ? fmtCOP(9900) : fmtCOP(4900)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Pago */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Método de pago</Text>
          {PAYMENT_METHODS.map((m) => (
            <Pressable
              key={m.key}
              style={[styles.option, paymentMethod === m.key && styles.optionActive]}
              onPress={() => setPaymentMethod(m.key)}
            >
              <Ionicons
                name={m.icon as never}
                size={18}
                color={colors.foreground}
              />
              <Text style={styles.optionLabel}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Total */}
        <View style={styles.card}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Subtotal</Text>
            <Text style={styles.sumValue}>{fmtCOP(subtotal)}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Domicilio</Text>
            <Text style={styles.sumValue}>{fmtCOP(shippingCost)}</Text>
          </View>
          <View style={[styles.sumRow, styles.sumTotal]}>
            <Text style={styles.sumTotalLabel}>Total</Text>
            <Text style={styles.sumTotalValue}>{fmtCOP(total)}</Text>
          </View>
        </View>

        <Pressable
          style={[styles.primaryBtn, sending && { opacity: 0.6 }]}
          onPress={() => void submit()}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <Text style={styles.primaryBtnText}>Confirmar pedido</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: "800", color: colors.foreground },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.muted,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: "#fff",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  optionActive: { borderColor: colors.accent, backgroundColor: "#FFFBE6" },
  optionLabel: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  optionValue: { fontSize: 13, color: colors.muted },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  sumLabel: { fontSize: 13, color: colors.muted },
  sumValue: { fontSize: 13, color: colors.foreground },
  sumTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  sumTotalLabel: { fontSize: 15, fontWeight: "800", color: colors.foreground },
  sumTotalValue: { fontSize: 18, fontWeight: "900", color: colors.foreground },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { fontWeight: "800", fontSize: 15, color: colors.foreground },
  doneWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  doneTitle: { fontSize: 20, fontWeight: "900", color: colors.foreground },
  doneCode: { fontSize: 14, fontWeight: "700", color: colors.muted },
  doneText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
});
