import { useEffect, useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  pickerChatKeys,
  usePickerChatMessages,
  usePickerChatSummary,
  useSendPickerChatMessage,
} from "@/api/picker-chat";
import type { PickerChatMessage } from "@/api";
import { useKeyboardHeight } from "@/lib/keyboard";
import { Header } from "@/ui/Header";
import { ErrorBox } from "@/ui/ErrorBox";
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
 * Chat del picker con administración.
 *
 * Es un hilo único por picker, independiente de los pedidos: sirve para avisar
 * novedades de bodega. Queda guardado en el backend, así que el historial se
 * conserva entre sesiones.
 */
export default function PickerChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const messages = usePickerChatMessages();
  const summary = usePickerChatSummary();
  const send = useSendPickerChatMessage();
  const [draft, setDraft] = useState("");

  // Con edge-to-edge el teclado se superpone al contenido (Android ignora
  // `adjustResize`), así que la barra de escribir se aparta a mano.
  const keyboardHeight = useKeyboardHeight();
  const keyboardOpen = keyboardHeight > 0;

  // FlatList invertida: el mensaje más nuevo primero se dibuja abajo.
  const listData = useMemo(() => [...(messages.data ?? [])].reverse(), [messages.data]);

  // Abrir el hilo marca como leído lo del admin en el backend, así que el badge
  // del header se apaga en el momento en vez de esperar al resumen (15 s).
  const unread = summary.data?.unread ?? 0;
  useEffect(() => {
    if (messages.data && unread > 0) {
      void queryClient.invalidateQueries({ queryKey: pickerChatKeys.summary });
    }
  }, [messages.data, unread, queryClient]);

  const doSend = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft("");
    send.mutate(text);
  };

  return (
    <View style={styles.root}>
      <Header
        title="Chat con administración"
        subtitle="Mercaldas · coordinación de bodega"
        onBack={() => router.back()}
      />

      {/* Mensajes */}
      {messages.isLoading && !messages.data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
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
            onRetry={() => void messages.refetch()}
          />
        </View>
      ) : (
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={listData}
          inverted
          keyboardShouldPersistTaps="handled"
          keyExtractor={(m: PickerChatMessage) => String(m.id)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={40} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>Aún no hay mensajes</Text>
              <Text style={styles.hint}>
                Escríbele a administración si necesitas algo de la bodega.
              </Text>
            </View>
          }
          renderItem={({ item }) => <Bubble msg={item} />}
        />
      )}

      {/* El mensaje no salió: el picker tiene que saberlo, no darlo por enviado. */}
      {send.isError ? (
        <View style={styles.sendError}>
          <ErrorBox message="No se pudo enviar el mensaje. Inténtalo de nuevo." />
        </View>
      ) : null}

      {/* Entrada */}
      <View
        style={[
          styles.inputBar,
          {
            paddingBottom: keyboardOpen
              ? keyboardHeight + spacing(3)
              : insets.bottom + spacing(3),
          },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribe un mensaje…"
          placeholderTextColor={colors.textHint}
          multiline
          style={styles.input}
          onSubmitEditing={doSend}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <Pressable
          onPress={doSend}
          disabled={!draft.trim() || send.isPending}
          accessibilityLabel="Enviar mensaje"
          style={({ pressed }) => [
            styles.sendBtn,
            (!draft.trim() || send.isPending) && styles.sendBtnDisabled,
            pressed && styles.sendBtnPressed,
          ]}
        >
          {send.isPending ? (
            <ActivityIndicator color={colors.onAccent} size="small" />
          ) : (
            <Ionicons name="send" size={18} color={colors.onAccent} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function Bubble({ msg }: { msg: PickerChatMessage }) {
  const mine = msg.senderType === "picker";
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine ? <Text style={styles.bubbleAuthor}>Administración</Text> : null}
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{msg.body}</Text>
        <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
          {fmtTime(msg.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
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
  },
  sendError: { paddingHorizontal: spacing(4), paddingTop: spacing(2) },
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
    backgroundColor: colors.accent,
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
  bubbleTextMine: { color: colors.onAccent, fontWeight: "600" },
  bubbleTime: {
    fontSize: 10,
    color: colors.textFaint,
    marginTop: spacing(1),
    alignSelf: "flex-end",
  },
  bubbleTimeMine: { color: "rgba(12,12,13,0.55)" },
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
    paddingTop: spacing(3),
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
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnPressed: { transform: [{ scale: 0.92 }] },
});
