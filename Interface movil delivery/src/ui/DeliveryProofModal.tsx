import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/ui/Button";
import { api } from "@/api";
import { colors, radius, spacing } from "@/theme";

// expo-image-picker es un módulo nativo: se importa de forma diferida (require
// con try/catch) para que el bundle no reviente en un APK que aún no lo incluye
// (p. ej. dev build anterior). Una vez instalado el build nuevo, require lo resuelve.
interface PickerAsset {
  uri: string;
}
interface PickerResult {
  canceled: boolean;
  assets?: PickerAsset[] | null;
}
interface PickerLike {
  requestCameraPermissionsAsync(): Promise<{ granted: boolean }>;
  requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
  launchCameraAsync(options: {
    mediaTypes: string[];
    quality: number;
  }): Promise<PickerResult>;
  launchImageLibraryAsync(options: {
    mediaTypes: string[];
    quality: number;
  }): Promise<PickerResult>;
}
let pickerModule: PickerLike | null | undefined;
function loadPicker(): PickerLike | null {
  if (pickerModule === undefined) {
    try {
      pickerModule = require("expo-image-picker") as PickerLike;
    } catch {
      pickerModule = null;
    }
  }
  return pickerModule;
}

export interface DeliveryProofPayload {
  proofLocationUrl: string;
  proofPackageUrl: string;
  note?: string;
}

type Slot = "location" | "package";

interface DeliveryProofModalProps {
  visible: boolean;
  orderReference?: string;
  onCancel: () => void;
  /** Sube a la nube y ejecuta la transición; lanza error si algo falla. */
  onSubmit: (payload: DeliveryProofPayload) => Promise<void>;
}

const SLOT_INFO: Record<
  Slot,
  { title: string; hint: string; emptyIcon: keyof typeof Ionicons.glyphMap }
> = {
  location: {
    title: "1. Foto del lugar de entrega",
    hint: "Casa, apto, oficina, portería…",
    emptyIcon: "home-outline",
  },
  package: {
    title: "2. Foto del pedido",
    hint: "El paquete o bolsa entregado",
    emptyIcon: "bag-check-outline",
  },
};

/**
 * Modal de confirmación de entrega con prueba fotográfica.
 * Ambas fotos son obligatorias; las notas son opcionales.
 */
export function DeliveryProofModal({
  visible,
  orderReference,
  onCancel,
  onSubmit,
}: DeliveryProofModalProps) {
  const [photos, setPhotos] = useState<Record<Slot, string | null>>({
    location: null,
    package: null,
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada vez que se abre el modal empieza limpio.
  useEffect(() => {
    if (visible) {
      setPhotos({ location: null, package: null });
      setNote("");
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const pickFor = (slot: Slot, source: "camera" | "library") => async () => {
    const ImagePicker = loadPicker();
    if (!ImagePicker) {
      setError(
        "Esta versión de la app no incluye la cámara. Reinstala con el dev build actualizado.",
      );
      return;
    }
    setError(null);
    try {
      let result: PickerResult;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            "Permiso de cámara",
            "Sin acceso a la cámara no puedes tomar la foto de la entrega.",
          );
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.6,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            "Permiso de galería",
            "Sin acceso a la galería no puedes adjuntar la foto.",
          );
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.6,
        });
      }
      const uri = result.assets?.[0]?.uri;
      if (!result.canceled && uri) {
        setPhotos((prev) => ({ ...prev, [slot]: uri }));
      }
    } catch {
      setError("No se pudo abrir la cámara o la galería.");
    }
  };

  const askSource = (slot: Slot) => {
    Alert.alert(SLOT_INFO[slot].title, "¿De dónde tomas la foto?", [
      { text: "📷 Tomar foto", onPress: pickFor(slot, "camera") },
      { text: "🖼️ Galería", onPress: pickFor(slot, "library") },
      { text: "Cancelar", style: "cancel" },
    ]);
  };

  const confirm = async () => {
    if (!photos.location || !photos.package) {
      setError("Debes adjuntar las dos fotos para confirmar la entrega.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Sube ambas en paralelo y luego dispara la transición 'deliver'.
      const [proofLocationUrl, proofPackageUrl] = await Promise.all([
        api.uploadProofImage(photos.location, "location"),
        api.uploadProofImage(photos.package, "package"),
      ]);
      const trimmedNote = note.trim();
      await onSubmit({
        proofLocationUrl,
        proofPackageUrl,
        note: trimmedNote.length ? trimmedNote : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar la entrega.");
      setBusy(false);
    }
  };

  const bothAttached = Boolean(photos.location && photos.package);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Confirmar entrega</Text>
            {orderReference ? (
              <Text style={styles.subtitle}>Pedido {orderReference}</Text>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={styles.body} bounces={false}>
            {(Object.keys(SLOT_INFO) as Slot[]).map((slot) => {
              const info = SLOT_INFO[slot];
              const uri = photos[slot];
              return (
                <Pressable
                  key={slot}
                  style={styles.slot}
                  onPress={() => !busy && askSource(slot)}
                  disabled={busy}
                >
                  <View style={styles.slotText}>
                    <Text style={styles.slotTitle}>{info.title}</Text>
                    <Text style={styles.slotHint}>{info.hint}</Text>
                  </View>
                  {uri ? (
                    <View>
                      <Image source={{ uri }} style={styles.thumb} />
                      <View style={styles.retakeBadge}>
                        <Text style={styles.retakeText}>Tocar para rehacer</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.emptyThumb}>
                      <Ionicons name={info.emptyIcon} size={22} color={colors.textFaint} />
                    </View>
                  )}
                </Pressable>
              );
            })}

            <Text style={styles.notesLabel}>Notas de la entrega (opcional)</Text>
            <TextInput
              style={styles.notesInput}
              value={note}
              onChangeText={setNote}
              placeholder="Ej: lo recibió la portería, se dejó en recepción…"
              placeholderTextColor={colors.textFaint}
              multiline
              editable={!busy}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.actionBtn}>
              <Button
                label="Cancelar"
                variant="secondary"
                onPress={onCancel}
                disabled={busy}
              />
            </View>
            <View style={styles.actionBtn}>
              <Button
                label="CONFIRMAR ENTREGA"
                loading={busy}
                disabled={!bothAttached || busy}
                onPress={() => void confirm()}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(4),
  },
  card: {
    width: "100%",
    maxHeight: "88%",
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    padding: spacing(4),
    gap: spacing(2),
  },
  header: { gap: 2 },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted },
  body: { gap: spacing(2), paddingBottom: spacing(1) },
  slot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: radius.md,
    padding: spacing(2),
    gap: spacing(3),
  },
  slotText: { flex: 1 },
  slotTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  slotHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  retakeBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: "rgba(15,23,42,0.65)",
    borderRadius: 6,
    paddingVertical: 2,
  },
  retakeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyThumb: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.textFaint,
    marginTop: spacing(1),
  },
  notesInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(3),
    minHeight: 76,
    textAlignVertical: "top",
    fontSize: 14,
    color: colors.text,
  },
  error: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing(2) },
  actionBtn: { flex: 1 },
});
