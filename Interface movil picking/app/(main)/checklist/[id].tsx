import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import { isItemDone } from "@/picking/status";
import { useCompleteOrder, useOrder } from "@/picking/queries";
import { saveSession } from "@/picking/sessionStore";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";

export default function ChecklistScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const orderId = Number(params.id);

  const { data: order, isLoading, error, refetch } = useOrder(orderId);
  const complete = useCompleteOrder(orderId);
  const [showDialog, setShowDialog] = useState(false);
  const [reported, setReported] = useState<number[]>([]);

  useEffect(() => {
    if (Number.isFinite(orderId)) void saveSession({ orderId, productId: null });
  }, [orderId]);

  const items = order?.items ?? [];
  const missingItems = useMemo(() => items.filter((i) => !isItemDone(i)), [items]);

  const toggleReported = (id: number) =>
    setReported((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const confirm = async () => {
    setShowDialog(false);
    try {
      await complete.mutateAsync();
    } catch {
      /* el backend puede responder ya entregado; se navega igual */
    }
    router.replace(`/(main)/success/${orderId}`);
  };

  if (isLoading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.center}>
        <ErrorBox message="No se pudo cargar el pedido." onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        title="Verificación final"
        subtitle={`${order.referenceCode} · ${order.customerName}`}
        onBack={() => router.back()}
      />

      <Screen>
        {missingItems.length > 0 ? (
          <View style={styles.banner}>
            <Ionicons name="alert-circle" size={18} color={colors.accent} />
            <View style={styles.bannerText}>
              <Text style={styles.bannerTitle}>
                {missingItems.length} producto(s) faltante(s)
              </Text>
              <Text style={styles.bannerSub}>
                Reporta los productos sin stock antes de entregar en caja.
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.banner, styles.bannerOk]}>
            <Ionicons name="checkmark-circle" size={18} color={colors.successText} />
            <Text style={styles.bannerTitle}>Todos los productos están escaneados.</Text>
          </View>
        )}

        {items.map((item) => {
          const done = isItemDone(item);
          const marked = reported.includes(item.id);
          return (
            <View key={item.id} style={[styles.row, done ? styles.rowDone : styles.rowPending]}>
              <View style={[styles.icon, done ? styles.iconDone : styles.iconPending]}>
                <Ionicons
                  name={done ? "checkmark" : "alert"}
                  size={15}
                  color={done ? "#04120A" : colors.accent}
                />
              </View>
              <View style={styles.info}>
                <Text style={[styles.name, done && styles.nameDone]} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  ×{item.quantity}
                  {item.sku ? ` · ${item.sku}` : ""}
                </Text>
              </View>
              {!done ? (
                <Pressable
                  onPress={() => toggleReported(item.id)}
                  style={[styles.reportBtn, marked && styles.reportBtnActive]}
                >
                  <Text style={[styles.reportText, marked && styles.reportTextActive]}>
                    {marked ? "Reportado" : "Reportar"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        <View style={styles.cta}>
          <Button
            label="ENTREGADO EN CAJA"
            variant="success"
            icon="checkmark-done"
            loading={complete.isPending}
            onPress={() => setShowDialog(true)}
          />
        </View>
      </Screen>

      <Modal visible={showDialog} transparent animationType="fade" onRequestClose={() => setShowDialog(false)}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialog}>
            <View style={styles.dialogIcon}>
              <Ionicons name="checkmark" size={30} color="#04120A" />
            </View>
            <Text style={styles.dialogTitle}>Confirmar entrega</Text>
            <Text style={styles.dialogText}>
              ¿Confirmas que el pedido {order.referenceCode} fue entregado en caja?
            </Text>
            <View style={styles.dialogActions}>
              <View style={styles.dialogBtn}>
                <Button label="Cancelar" variant="secondary" onPress={() => setShowDialog(false)} />
              </View>
              <View style={styles.dialogBtn}>
                <Button label="Confirmar" variant="success" onPress={() => void confirm()} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing(5) },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing(3),
    backgroundColor: "rgba(251,191,36,0.10)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.30)",
    borderRadius: radius.lg,
    padding: spacing(3),
    marginBottom: spacing(4),
  },
  bannerOk: {
    backgroundColor: "rgba(34,197,94,0.10)",
    borderColor: "rgba(34,197,94,0.30)",
    alignItems: "center",
  },
  bannerText: { flex: 1 },
  bannerTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  bannerSub: { color: colors.textFaint, fontSize: 12, fontWeight: "500", marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing(3),
    marginBottom: spacing(2),
  },
  rowDone: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.30)" },
  rowPending: { backgroundColor: "rgba(251,191,36,0.08)", borderColor: "rgba(251,191,36,0.25)" },
  icon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  iconDone: { backgroundColor: colors.success },
  iconPending: { backgroundColor: "rgba(251,191,36,0.15)" },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14, fontWeight: "700" },
  nameDone: { color: colors.textFaint, textDecorationLine: "line-through" },
  meta: { color: colors.textHint, fontSize: 11, fontWeight: "500", marginTop: 2 },
  reportBtn: {
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.40)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing(3),
    paddingVertical: 5,
  },
  reportBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  reportText: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  reportTextActive: { color: colors.onAccent },
  cta: { marginTop: spacing(4) },
  dialogBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing(5) },
  dialog: {
    width: "100%",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xl,
    padding: spacing(5),
    alignItems: "center",
    gap: spacing(3),
  },
  dialogIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  dialogText: { color: colors.textMuted, fontSize: 13, fontWeight: "500", textAlign: "center" },
  dialogActions: { flexDirection: "row", gap: spacing(3), marginTop: spacing(2) },
  dialogBtn: { flex: 1 },
});
