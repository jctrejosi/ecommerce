import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAdminChatMessages,
  useSendAdminChatMessage,
} from "@/api/admin-chat";
import type { AdminChatMessage } from "@/api/types";
import { ErrorBox } from "@/ui/ErrorBox";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { colors, radius, spacing } from "@/theme";

const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

/**
 * Chat del repartidor con el panel (administración).
 *
 * Es un hilo único por repartidor, independiente de los pedidos: sirve para
 * coordinar novedades con la central. Queda guardado en el backend, así que el
 * historial se conserva entre sesiones.
 */
export default function AdminChatScreen() {
  const messages = useAdminChatMessages();
  const send = useSendAdminChatMessage();
  const [draft, setDraft] = useState("");

  // FlatList invertida: el mensaje más nuevo primero se dibuja abajo.
  const listData = useMemo(
    () => [...(messages.data ?? [])].reverse(),
    [messages.data],
  );

  const doSend = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft("");
    send.mutate(text);
  };

  return (
    <Screen scroll={false} bottomInset keyboardAware>
      <View style={styles.flex}>
        {/* Encabezado: con quién se habla */}
        <View style={styles.panelBar}>
          <View style={styles.avatar}>
            <Ionicons name="headset-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.panelMeta}>
            <Text style={styles.panelTitle} numberOfLines={1}>
              Administración
            </Text>
            <Text style={styles.panelSub} numberOfLines={1}>
              Mercaldas · coordinación de entregas
            </Text>
          </View>
        </View>

        {/* Mensajes */}
        {messages.isLoading && !messages.data ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.hint}>Cargando conversación…</Text>
          </View>
        ) : messages.isError ? (
          <View style={styles.centerPadded}>
            <ErrorBox
              message={
                messages.error instanceof Error
                  ? messages.error.message
                  : "No se pudo cargar el chat."
              }
            />
            <View style={styles.retryWrap}>
              <Button
                label="Reintentar"
                variant="secondary"
                onPress={() => void messages.refetch()}
              />
            </View>
          </View>
        ) : (
          <FlatList
            style={styles.flex}
            contentContainerStyle={styles.list}
            data={listData}
            inverted
            keyExtractor={(m: AdminChatMessage) => String(m.id)}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={40}
                  color={colors.textFaint}
                />
                <Text style={styles.emptyTitle}>Aún no hay mensajes</Text>
                <Text style={styles.hint}>
                  Escríbele a administración si necesitas algo de la entrega.
                </Text>
              </View>
            }
            renderItem={({ item }) => <Bubble msg={item} />}
          />
        )}

        {/* Entrada */}
        <View style={styles.inputBar}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Escribe un mensaje…"
            placeholderTextColor={colors.textFaint}
            multiline
            style={styles.input}
            onSubmitEditing={doSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable
            onPress={doSend}
            disabled={!draft.trim() || send.isPending}
            style={({ pressed }) => [
              styles.sendBtn,
              (!draft.trim() || send.isPending) && styles.sendBtnDisabled,
              pressed && styles.sendBtnPressed,
            ]}
          >
            <Ionicons name="send" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function Bubble({ msg }: { msg: AdminChatMessage }) {
  const mine = msg.senderType === "driver";
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine ? <Text style={styles.bubbleAuthor}>Administración</Text> : null}
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
          {msg.body}
        </Text>
        <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
          {fmtTime(msg.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
  },
  centerPadded: {
    flex: 1,
    justifyContent: "center",
    padding: spacing(4),
    gap: spacing(3),
  },
  retryWrap: { alignSelf: "center", minWidth: 160 },
  panelBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.infoBg,
    alignItems: "center",
    justifyContent: "center",
  },
  panelMeta: { flex: 1 },
  panelTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  panelSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  list: {
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  bubbleRow: {
    flexDirection: "row",
    marginVertical: spacing(1),
  },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "82%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(2),
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleTheirs: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleAuthor: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: 2,
  },
  bubbleText: { fontSize: 14, lineHeight: 19, color: colors.text },
  bubbleTextMine: { color: "#FFFFFF" },
  bubbleTime: {
    fontSize: 10,
    color: colors.textFaint,
    marginTop: spacing(1),
    alignSelf: "flex-end",
  },
  bubbleTimeMine: { color: "rgba(255,255,255,0.75)" },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(1.5),
    paddingVertical: spacing(12),
  },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing(2),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing(3.5),
    paddingTop: spacing(2.5),
    paddingBottom: spacing(2.5),
    fontSize: 14,
    color: colors.text,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnPressed: { transform: [{ scale: 0.92 }] },
});
