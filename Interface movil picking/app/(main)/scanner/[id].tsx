import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { colors, radius, spacing } from "@/theme";
import type { ScanResult } from "@/api";
import { isItemDone } from "@/picking/status";
import { useOrder, useScan } from "@/picking/queries";
import { saveSession } from "@/picking/sessionStore";
import { Header } from "@/ui/Header";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { ProductImage } from "@/ui/ProductImage";

const BARCODE_TYPES = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "code93",
  "codabar",
  "itf14",
] as const;

type ScanState = "idle" | "success" | "error";

export default function ScannerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; itemId?: string }>();
  const orderId = Number(params.id);

  const { data: order, error, refetch } = useOrder(orderId);
  const scan = useScan(orderId);
  const [permission, requestPermission] = useCameraPermissions();

  const items = order?.items ?? [];

  const [activeItemId, setActiveItemId] = useState<number | undefined>(
    params.itemId ? Number(params.itemId) : undefined,
  );
  const [input, setInput] = useState("");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [successName, setSuccessName] = useState("");
  const [qty, setQty] = useState(0);
  const processingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Ítem activo: el del parámetro o el primer pendiente.
  const activeItem =
    items.find((i) => i.id === activeItemId) ?? items.find((i) => !isItemDone(i)) ?? items[0];

  // Inicializa el picker de ítem y la cantidad restante al abrir/cambiar de ítem.
  useEffect(() => {
    if (!activeItem) return;
    setQty(activeItem.quantity - activeItem.pickedQty);
    void saveSession({ orderId, productId: String(activeItem.id) });
  }, [orderId, activeItem?.id, activeItem?.quantity, activeItem?.pickedQty, activeItem]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Escáner de hardware (Zebra DataWedge): inyecta el código como keystrokes en
  // el campo enfocado y termina con ENTER. Mantenemos el foco en el input
  // (sin abrir el teclado) para que el gatillo físico funcione en cualquier momento.
  useEffect(() => {
    if (scanState === "idle") inputRef.current?.focus();
  }, [scanState]);

  const scheduleReset = (fn: () => void, ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fn, ms);
  };

  const advance = useCallback(
    (result: ScanResult) => {
      if (result.allDone) {
        router.replace(`/(main)/checklist/${orderId}`);
        return;
      }
      const remaining = items.filter((i) => !isItemDone(i) && i.id !== result.itemId);
      const current = items.find((i) => i.id === result.itemId);
      // Si el ítem actual aún tiene piezas, se queda; si no, salta al siguiente pendiente.
      if (result.remaining > 0) {
        setQty(result.remaining);
        setActiveItemId(result.itemId);
      } else if (remaining.length > 0) {
        setActiveItemId(remaining[0].id);
        setQty(remaining[0].quantity - remaining[0].pickedQty);
      } else if (current) {
        setActiveItemId(current.id);
        setQty(0);
      }
      setScanState("idle");
    },
    [items, orderId, router],
  );

  const handleScan = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || processingRef.current) return;
      processingRef.current = true;
      setScanState("idle");
      setErrorMsg("");
      try {
        const result = await scan.mutateAsync(code);
        Vibration.vibrate(60);
        setSuccessName(result.name);
        setScanState("success");
        setInput("");
        scheduleReset(() => advance(result), 800);
      } catch (e) {
        const payload = (e as { payload?: { expected?: string[] } })?.payload;
        const expected =
          payload?.expected && payload.expected.length > 0
            ? payload.expected
            : [activeItem?.barcode, activeItem?.plu].filter(Boolean);
        Vibration.vibrate([120, 60, 120]);
        setErrorMsg(
          `Escaneaste: ${code}. Se esperaba: ${expected?.[0] ?? "otro código"}`,
        );
        setInput("");
        setScanState("error");
        scheduleReset(() => setScanState("idle"), 1800);
      } finally {
        processingRef.current = false;
      }
    },
    [activeItem?.barcode, activeItem?.plu, advance, scan],
  );

  const onBarcodeScanned = useCallback(
    (res: BarcodeScanningResult) => {
      if (scanState !== "idle" || processingRef.current) return;
      if (res.data) void handleScan(res.data);
    },
    [handleScan, scanState],
  );

  if (error) {
    return (
      <View style={styles.center}>
        <ErrorBox message="No se pudo cargar el pedido." onRetry={() => void refetch()} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        title="Escanear"
        subtitle={order.referenceCode}
        onBack={() => router.back()}
        right={
          <View style={styles.rightBox}>
            <View style={styles.qtyBadge}>
              <Text style={styles.qtyText}>
                <Text style={styles.qtyActive}>{qty}</Text>/{activeItem?.quantity ?? 0}
              </Text>
            </View>
            <Pressable
              onPress={() => router.push(`/(main)/map/${orderId}${activeItem ? `?itemId=${activeItem.id}` : ""}`)}
              style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="map" size={16} color={colors.onAccent} />
              <Text style={styles.mapText}>Mapa</Text>
            </Pressable>
          </View>
        }
      />

      {/* Cámara */}
      <View style={styles.cameraWrap}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            onBarcodeScanned={scanState === "idle" ? onBarcodeScanned : undefined}
          />
        ) : (
          <View style={styles.permBox}>
            <Ionicons name="camera-outline" size={40} color={colors.textFaint} />
            <Text style={styles.permText}>Permiso de cámara no concedido</Text>
            <Button
              label="Permitir cámara"
              variant="primary"
              compact
              onPress={() => void requestPermission()}
              fullWidth={false}
            />
          </View>
        )}

        {/* Overlays de feedback */}
        {scanState === "success" ? (
          <View style={[styles.overlay, styles.overlayOk]}>
            <View style={styles.bigCheck}>
              <Ionicons name="checkmark" size={48} color="#04120A" />
            </View>
            <Text style={styles.overlayTitle}>Escaneado</Text>
            <Text style={styles.overlaySub} numberOfLines={2}>
              {successName}
            </Text>
          </View>
        ) : null}

        {scanState === "error" ? (
          <View style={[styles.overlay, styles.overlayErr]}>
            <Ionicons name="close-circle" size={54} color={colors.dangerText} />
            <Text style={styles.overlayTitle}>Producto incorrecto</Text>
            <Text style={styles.overlaySub}>{errorMsg}</Text>
          </View>
        ) : null}
      </View>

      {/* Tarjeta inferior: producto + ingreso manual */}
      <View style={styles.bottom}>
        {activeItem ? (
          <View style={styles.productCard}>
            <ProductImage uri={activeItem.image} seed={activeItem.sku ?? activeItem.name} size={52} />
            <View style={styles.productInfo}>
              <Text style={styles.productName} numberOfLines={2}>
                {activeItem.name}
              </Text>
              <View style={styles.productMetaRow}>
                <View
                  style={[
                    styles.locChip,
                    activeItem.shelfCode ? styles.locOk : styles.locMissing,
                  ]}
                >
                  <Text
                    style={[
                      styles.locText,
                      { color: activeItem.shelfCode ? colors.successText : colors.accent },
                    ]}
                  >
                    {activeItem.shelfCode
                      ? `${activeItem.shelfCode}${activeItem.rowNumber ? ` · Fila ${activeItem.rowNumber}` : ""}`
                      : "Sin ubicación"}
                  </Text>
                </View>
                {activeItem.plu ? (
                  <View style={styles.plu}>
                    <Text style={styles.pluText}>PLU {activeItem.plu}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.productSku} numberOfLines={1}>
                {activeItem.sku ? `SKU ${activeItem.sku}` : "Sin SKU"}
                {activeItem.barcode ? ` · ${activeItem.barcode}` : ""}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.noItem}>Este pedido no tiene productos pendientes.</Text>
        )}

        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => void handleScan(input)}
            autoFocus
            showSoftInputOnFocus={false}
            keyboardType="number-pad"
            placeholder="Escanea con el gatillo o ingresa el código…"
            placeholderTextColor={colors.textHint}
            style={styles.input}
            returnKeyType="done"
          />
          <Button
            label="OK"
            compact
            fullWidth={false}
            onPress={() => void handleScan(input)}
            disabled={!input.trim()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing(5) },
  rightBox: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  qtyBadge: {
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(3),
    paddingVertical: 4,
  },
  qtyText: { color: colors.textMuted, fontSize: 13, fontWeight: "800" },
  qtyActive: { color: colors.accent },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(3),
    paddingVertical: 6,
  },
  mapText: { color: colors.onAccent, fontSize: 12, fontWeight: "800" },
  cameraWrap: { flex: 1, backgroundColor: "#111112", overflow: "hidden" },
  permBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing(3) },
  permText: { color: colors.textFaint, fontSize: 13, fontWeight: "600" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    paddingHorizontal: spacing(6),
  },
  overlayOk: { backgroundColor: "rgba(34,197,94,0.92)" },
  overlayErr: { backgroundColor: "rgba(12,12,13,0.92)" },
  bigCheck: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  overlaySub: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "600", textAlign: "center" },
  bottom: {
    padding: spacing(4),
    gap: spacing(3),
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  productCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing(3),
  },
  productInfo: { flex: 1, minWidth: 0, gap: spacing(2) },
  productName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  productMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(2) },
  locChip: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing(2), paddingVertical: 2 },
  locOk: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.25)" },
  locMissing: { backgroundColor: "rgba(251,191,36,0.10)", borderColor: "rgba(251,191,36,0.20)" },
  locText: { fontSize: 11, fontWeight: "700" },
  plu: {
    backgroundColor: "rgba(139,92,246,0.20)",
    borderColor: "rgba(139,92,246,0.30)",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2),
    paddingVertical: 2,
  },
  pluText: { color: "#C4B5FD", fontSize: 10, fontWeight: "700" },
  productSku: { color: colors.textHint, fontSize: 11, fontWeight: "500" },
  noItem: { color: colors.textFaint, fontSize: 14, fontWeight: "600" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  input: {
    flex: 1,
    height: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    color: colors.text,
    fontSize: 14,
  },
});
