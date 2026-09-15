import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useActiveOrders, useHistory } from "@/api/orders";
import { useAdminChatSummary } from "@/api/admin-chat";
import { OrderCard } from "@/ui/OrderCard";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorBox } from "@/ui/ErrorBox";
import { Screen } from "@/ui/Screen";
import { isToday } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import type { DeliveryOrder } from "@/api/types";

type TabKey = "nuevos" | "enCamino" | "entregados";

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: { key: TabKey; label: string; icon: IconName; emptyTitle: string; emptySubtitle: string }[] = [
  {
    key: "nuevos",
    label: "Nuevos",
    icon: "cube-outline",
    emptyTitle: "Sin pedidos nuevos",
    emptySubtitle:
      "Los pedidos que salgan de picking aparecerán aquí como nuevos (y te llegará una notificación).",
  },
  {
    key: "enCamino",
    label: "En camino",
    icon: "bicycle-outline",
    emptyTitle: "Nada en camino",
    emptySubtitle: "Cuando recojas un pedido y salgas a entregarlo aparecerá aquí.",
  },
  {
    key: "entregados",
    label: "Entregados",
    icon: "checkmark-done-outline",
    emptyTitle: "Aún no has entregado hoy",
    emptySubtitle: "Los pedidos que entregues hoy aparecerán aquí.",
  },
];

/** Pedidos que acaban de salir de picking (antes de recoger). */
const NUEVOS_STATUSES = ["ASSIGNED", "ACCEPTED", "READY_FOR_PICKUP"] as const;
/** Pedidos recogidos y rumbo al cliente. */
const EN_CAMINO_STATUSES = ["PICKED_UP", "IN_DELIVERY"] as const;

/**
 * Solo se evalúa una vez por arranque de la app: si el repartidor ya traía un
 * pedido en camino, se le deja directo en el detalle de ese pedido.
 */
let landingChecked = false;

/**
 * Pantalla "Pedidos": vista del día con 3 pestañas — Nuevos (recién salidos
 * de picking), En camino y Entregados hoy. El historial completo del usuario
 * vive en la pestaña "Historial".
 */
export default function OrdersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("nuevos");
  const active = useActiveOrders();
  const history = useHistory();
  // No leídos del chat con el panel (badge del header).
  const chatSummary = useAdminChatSummary();
  const chatUnread = chatSummary.data?.unread ?? 0;

  const groups = useMemo(() => {
    const actives = active.data ?? [];
    const finished = history.data ?? [];
    return {
      nuevos: actives.filter((o) =>
        (NUEVOS_STATUSES as readonly string[]).includes(o.status),
      ),
      enCamino: actives.filter((o) =>
        (EN_CAMINO_STATUSES as readonly string[]).includes(o.status),
      ),
      entregados: finished.filter(
        (o) => o.status === "DELIVERED" && isToday(o.completedAt ?? o.deliveredAt),
      ),
    } satisfies Record<TabKey, DeliveryOrder[]>;
  }, [active.data, history.data]);

  const isLoading = active.isLoading || history.isLoading;
  const isError = active.isError || history.isError;
  const error = active.error ?? history.error;
  const refreshing = active.isRefetching || history.isRefetching;

  // Al abrir la app con un pedido en camino, se entra directo a ese pedido
  // (solo la primera vez por arranque; luego se respeta la navegación).
  useEffect(() => {
    if (landingChecked || !active.data) return;
    landingChecked = true;
    const current = active.data.find((o) =>
      (EN_CAMINO_STATUSES as readonly string[]).includes(o.status),
    );
    if (current) router.push(`/order/${current.id}`);
  }, [active.data, router]);

  const refetch = () => {
    void active.refetch();
    void history.refetch();
  };

  const currentTab = TABS.find((t) => t.key === tab)!;
  const list = groups[tab];

  return (
    <Screen
      title="Pedidos"
      padded={false}
      scroll={false}
      bottomInset
      headerRight={
        <Pressable
          onPress={() => router.push("/admin-chat")}
          hitSlop={8}
          style={styles.chatBtn}
          accessibilityLabel="Chat con administración"
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={24}
            color={colors.text}
          />
          {chatUnread > 0 && (
            <View style={styles.chatBadge}>
              <Text style={styles.chatBadgeText}>
                {chatUnread > 9 ? "9+" : chatUnread}
              </Text>
            </View>
          )}
        </Pressable>
      }
    >
      {/* Pestañas del día */}
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const selected = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabBtn, selected && styles.tabBtnActive]}
            >
              <Text
                style={[styles.tabLabel, selected && styles.tabLabelActive]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
              <View style={[styles.tabCount, selected && styles.tabCountActive]}>
                <Text style={[styles.tabCountText, selected && styles.tabCountTextActive]}>
                  {groups[t.key].length}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {isError ? (
        <View style={styles.padded}>
          <ErrorBox
            message={
              error instanceof Error ? error.message : "Error al cargar pedidos."
            }
          />
        </View>
      ) : null}

      <FlatList
        key={tab}
        data={list}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={() => router.push(`/order/${item.id}`)} />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refetch} />
        }
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon={currentTab.icon}
              title={currentTab.emptyTitle}
              subtitle={currentTab.emptySubtitle}
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chatBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  chatBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  chatBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  tabs: {
    flexDirection: "row",
    gap: spacing(2),
    paddingHorizontal: spacing(4),
    paddingTop: spacing(3),
    paddingBottom: spacing(2),
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(1),
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.textMuted,
    textAlign: "center",
  },
  tabLabelActive: { color: "#FFFFFF" },
  tabCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  tabCountActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  tabCountText: { fontSize: 11, fontWeight: "800", color: colors.textMuted },
  tabCountTextActive: { color: "#FFFFFF" },
  list: { padding: spacing(4), flexGrow: 1 },
  padded: { padding: spacing(4) },
});
