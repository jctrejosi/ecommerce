import { SectionList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useHistory } from "@/api/orders";
import { OrderCard } from "@/ui/OrderCard";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorBox } from "@/ui/ErrorBox";
import { Screen } from "@/ui/Screen";
import { dayGroupLabel } from "@/lib/format";
import { colors, spacing } from "@/theme";
import type { HistoryEntry } from "@/api/types";

interface Section {
  title: string;
  data: HistoryEntry[];
}

function groupByDay(entries: HistoryEntry[]): Section[] {
  const map = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const day = dayGroupLabel(entry.completedAt ?? entry.assignedAt ?? new Date().toISOString());
    const list = map.get(day) ?? [];
    list.push(entry);
    map.set(day, list);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

export default function HistoryScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useHistory();

  const sections = data ? groupByDay(data) : [];

  return (
    <Screen title="Historial" padded={false} scroll={false}>
      {isError ? (
        <View style={styles.padded}>
          <ErrorBox message={error instanceof Error ? error.message : "Error al cargar el historial."} />
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={() => router.push(`/order/${item.id}`)} />
        )}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon="time-outline"
              title="Aún no hay entregas"
              subtitle="Los pedidos entregados aparecerán aquí."
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textMuted,
    marginBottom: spacing(2),
    marginTop: spacing(1),
  },
});
