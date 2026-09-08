import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useActiveOrders } from "@/api/orders";
import { OrderCard } from "@/ui/OrderCard";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorBox } from "@/ui/ErrorBox";
import { Screen } from "@/ui/Screen";
import { colors, spacing } from "@/theme";

export default function OrdersScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isRefetching } = useActiveOrders();

  return (
    <Screen title="Pedidos" padded={false} scroll={false}>
      {isError ? (
        <View style={styles.padded}>
          <ErrorBox message={error instanceof Error ? error.message : "Error al cargar pedidos."} />
        </View>
      ) : null}

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={() => router.push(`/order/${item.id}`)} />
        )}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon="bicycle-outline"
              title="Sin pedidos asignados"
              subtitle="Cuando te asignen un pedido aparecerá aquí (y te llegará una notificación)."
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing(4), flexGrow: 1 },
  padded: { padding: spacing(4) },
});
