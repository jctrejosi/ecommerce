import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, radius, spacing } from "@/theme";
import { formatMoney, formatTimeAgo, minutesAgo } from "@/lib/format";
import { orderStatus } from "@/picking/status";
import { StatusChip } from "./StatusChip";
import { Button } from "./Button";
import type { PickingOrder } from "@/api";

interface OrderCardProps {
  order: PickingOrder;
  onPress: () => void;
  onMarkReviewed?: () => void;
  marking?: boolean;
}

function PulseDot() {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

export function OrderCard({ order, onPress, onMarkReviewed, marking }: OrderCardProps) {
  const styles = useStyles();
  const status = orderStatus(order);
  const isNew = status === "nuevo" && !order.reviewed;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isNew && styles.cardNew,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.codeRow}>
          {isNew ? <PulseDot /> : null}
          <Text style={styles.code}>{order.referenceCode}</Text>
          {isNew ? (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>Nuevo</Text>
            </View>
          ) : null}
        </View>
        <StatusChip status={status} />
      </View>

      <Text style={styles.customer} numberOfLines={1}>
        {order.customerName}
      </Text>

      <View style={styles.bottomRow}>
        <Text style={styles.time}>{formatTimeAgo(minutesAgo(order.createdAt))}</Text>
        <Text style={styles.total}>{formatMoney(order.grandTotal)}</Text>
      </View>

      <Text style={styles.meta}>
        {order.itemsCount} producto(s) · {order.totalPieces} pieza(s)
        {order.scannedPieces > 0 ? ` · ${order.scannedPieces} escaneada(s)` : ""}
      </Text>

      {isNew && onMarkReviewed ? (
        <View style={styles.reviewRow}>
          <Button
            label="Marcar revisado"
            variant="secondary"
            compact
            loading={marking}
            onPress={onMarkReviewed}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4),
    marginBottom: spacing(3),
  },
  cardNew: {
    backgroundColor: "rgba(251,191,36,0.08)",
    borderColor: "rgba(251,191,36,0.30)",
  },
  pressed: { opacity: 0.85 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing(2) },
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing(2), flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  code: { color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  newBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2),
    paddingVertical: 2,
  },
  newBadgeText: { color: colors.onAccent, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  customer: { color: colors.textMuted, fontSize: 14, fontWeight: "500", marginTop: spacing(3) },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing(2) },
  time: { color: colors.textFaint, fontSize: 12, fontWeight: "500" },
  total: { color: colors.text, fontSize: 14, fontWeight: "700" },
  meta: { color: colors.textHint, fontSize: 12, fontWeight: "500", marginTop: spacing(2) },
  reviewRow: { marginTop: spacing(3), alignItems: "flex-start" },
}));
