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
import { colors, fmtCOP, fonts, radii, spacing, text } from "../src/theme";

const SHIPPING_TYPES = [
  { key: "standard", label: "Envío estándar", desc: "2-3 horas hábiles" },
  { key: "express", label: "Envío express", desc: "45-60 minutos" },
] as const;

const PAYMENT_METHODS: {
  key: PaymentMethod;
  label: string;
  icon: string;
  desc: string;
}[] = [
  { key: "efectivo", label: "Efectivo contra entrega", icon: "cash-outline", desc: "Paga al recibir tu pedido" },
  { key: "nequi", label: "Nequi", icon: "phone-portrait-outline", desc: "Transferencia inmediata" },
  { key: "pse", label: "PSE", icon: "globe-outline", desc: "Débito bancario en línea" },
  { key: "tarjeta", label: "Tarjeta débito / crédito", icon: "card-outline", desc: "Visa, Mastercard, Amex" },
  { key: "breb", label: "Bre-B (Transferencia entre bancos)", icon: "apps-outline", desc: "Transferencia entre bancos" },
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
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          <Text style={styles.doneTitle}>¡Pedido registrado!</Text>
          <Text style={styles.doneCode}>Nº de pedido: {done}</Text>
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

      <ScrollView contentContainerStyle={styles.content}>
        {/* Dirección */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dirección de entrega</Text>
          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Nombre completo</Text>
              <TextInput style={styles.input} placeholder="Carlos Ríos" placeholderTextColor={colors.mutedForeground} value={name} onChangeText={setName} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Celular</Text>
              <TextInput style={styles.input} placeholder="300 123 4567" placeholderTextColor={colors.mutedForeground} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput style={styles.input} placeholder="correo@ejemplo.com" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Dirección</Text>
              <TextInput style={styles.input} placeholder="Cra 23 #45-67, Barrio San José" placeholderTextColor={colors.mutedForeground} value={address} onChangeText={setAddress} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Ciudad</Text>
              <TextInput style={styles.input} placeholder="Manizales" placeholderTextColor={colors.mutedForeground} value={city} onChangeText={setCity} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Indicaciones adicionales (opcional)</Text>
              <TextInput style={styles.input} placeholder="Apto 301, timbre no funciona..." placeholderTextColor={colors.mutedForeground} value={notes} onChangeText={setNotes} />
            </View>
          </View>
        </View>

        {/* Envío */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tipo de envío</Text>
          <View style={styles.card}>
            {SHIPPING_TYPES.map((t) => (
              <Pressable
                key={t.key}
                style={[styles.option, shippingType === t.key && styles.optionActive]}
                onPress={() => setShippingType(t.key)}
              >
                <View style={[styles.radio, shippingType === t.key && styles.radioActive]}>
                  {shippingType === t.key && <View style={styles.radioDot} />}
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionLabel}>{t.label}</Text>
                  <Text style={styles.optionDesc}>{t.desc}</Text>
                </View>
                <Text style={styles.optionValue}>
                  {t.key === "express" ? fmtCOP(9900) : fmtCOP(4900)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Pago */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Método de pago</Text>
          <View style={styles.card}>
            {PAYMENT_METHODS.map((m) => (
              <Pressable
                key={m.key}
                style={[styles.option, paymentMethod === m.key && styles.optionActive]}
                onPress={() => setPaymentMethod(m.key)}
              >
                <View style={[styles.radio, paymentMethod === m.key && styles.radioActive]}>
                  {paymentMethod === m.key && <View style={styles.radioDot} />}
                </View>
                <Ionicons
                  name={m.icon as never}
                  size={20}
                  color={colors.mutedForeground}
                />
                <View style={styles.optionInfo}>
                  <Text style={styles.optionLabel}>{m.label}</Text>
                  <Text style={styles.optionDesc}>{m.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Resumen */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resumen del pedido</Text>
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
        </View>

        <Pressable
          style={[styles.primaryBtn, sending && { opacity: 0.6 }]}
          onPress={() => void submit()}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={styles.primaryBtnText}>Confirmar pedido</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: text.lg,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: {
    fontSize: text.base,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.twoXl,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.card,
  },
  field: { gap: spacing.xs },
  fieldLabel: {
    fontSize: text.xs,
    fontFamily: fonts.sansSemibold,
    color: colors.mutedForeground,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: text.sm,
    color: colors.foreground,
    backgroundColor: colors.white,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  optionActive: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { borderColor: colors.primary },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.foreground,
  },
  optionInfo: { flex: 1, gap: 2 },
  optionLabel: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
  },
  optionDesc: {
    fontSize: text.xs,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
  },
  optionValue: {
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  error: {
    color: colors.accent,
    fontSize: text.sm,
    fontFamily: fonts.sansMedium,
    textAlign: "center",
  },
  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },
  sumLabel: {
    fontSize: text.sm,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
  },
  sumValue: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
  },
  sumTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  sumTotalLabel: {
    fontSize: text.base,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  sumTotalValue: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: 14,
    fontFamily: fonts.sansBold,
    color: colors.primaryForeground,
  },
  doneWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  doneTitle: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
    textAlign: "center",
  },
  doneCode: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.mutedForeground,
  },
  doneText: {
    fontSize: text.sm,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
    textAlign: "center",
  },
});
