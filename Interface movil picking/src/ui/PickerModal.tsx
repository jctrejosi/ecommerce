import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import type { Picker } from "@/api";

interface PickerModalProps {
  visible: boolean;
  pickers: Picker[];
  currentId: number | null;
  loading?: boolean;
  onSelect: (picker: Picker) => void;
  onClose?: () => void;
}

export function PickerModal({ visible, pickers, currentId, loading, onSelect, onClose }: PickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>¿Quién eres?</Text>
            <Text style={styles.sub}>Selecciona el picker que está alistando</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : (
            <FlatList
              data={pickers}
              keyExtractor={(p) => String(p.id)}
              style={styles.list}
              renderItem={({ item }) => {
                const active = item.id === currentId;
                return (
                  <Pressable
                    onPress={() => onSelect(item)}
                    style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && { opacity: 0.8 }]}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {active ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
                  </Pressable>
                );
              }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing(2),
    paddingBottom: spacing(6),
    maxHeight: "75%",
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 999, backgroundColor: colors.borderStrong, marginBottom: spacing(3) },
  head: { paddingHorizontal: spacing(5), paddingBottom: spacing(3) },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.textFaint, fontSize: 12, fontWeight: "500", marginTop: 2 },
  loader: { paddingVertical: spacing(8) },
  list: { paddingHorizontal: spacing(4) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    marginBottom: spacing(2),
  },
  rowActive: { backgroundColor: "rgba(251,191,36,0.10)", borderColor: "rgba(251,191,36,0.30)" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onAccent, fontSize: 16, fontWeight: "800" },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
});
