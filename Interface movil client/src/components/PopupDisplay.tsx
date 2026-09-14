import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { popupsApi } from "../api/content";
import type { Popup } from "../api/types";
import { colors, duration, fonts, layout, radii, shadow, spacing, text } from "../theme";

const BAR_HEIGHT = 60;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

type ResolvedPosition = "left" | "right" | "top" | "bottom" | "center";

function resolvePosition(position: Popup["position"]): ResolvedPosition {
  if (
    position === "left" ||
    position === "right" ||
    position === "top" ||
    position === "bottom"
  ) {
    return position;
  }
  return "center";
}

interface PopupItemProps {
  popup: Popup;
  closing: boolean;
  onClose: (id: number) => void;
  onClosed: (id: number) => void;
}

/** Un popup individual con su animación de entrada/salida. */
function PopupItem({ popup, closing, onClose, onClosed }: PopupItemProps) {
  const position = resolvePosition(popup.position);
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const [imageAspect, setImageAspect] = useState<number | null>(null);

  // Posición inicial (fuera de pantalla según el borde de origen).
  const startX =
    position === "left" ? -winWidth : position === "right" ? winWidth : 0;
  const startY =
    position === "top" ? -BAR_HEIGHT : position === "bottom" ? BAR_HEIGHT : 0;

  const translateX = useRef(new Animated.Value(startX)).current;
  const translateY = useRef(new Animated.Value(startY)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  // Entrada: 500 ms con cubic-bezier(0.22, 1, 0.36, 1).
  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: duration.popup,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: duration.popup,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: duration.popup,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salida: inversa; al terminar se retira del listado visible.
  useEffect(() => {
    if (!closing) return;
    const endX =
      position === "left" ? -winWidth : position === "right" ? winWidth : 0;
    const endY =
      position === "top" ? -BAR_HEIGHT : position === "bottom" ? BAR_HEIGHT : 0;

    Animated.parallel([
      Animated.timing(translateX, {
        toValue: endX,
        duration: duration.popup,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: endY,
        duration: duration.popup,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: duration.popup,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onClosed(popup.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const transform = [{ translateX }, { translateY }];

  const closeButton = (
    <Pressable
      style={[
        styles.closeBtn,
        position === "bottom" ? styles.closeBtnBottom : styles.closeBtnTop,
      ]}
      onPress={() => onClose(popup.id)}
      hitSlop={8}
    >
      <Ionicons name="close" size={14} color={colors.white} />
    </Pressable>
  );

  // Barras top/bottom: full-width ancladas arriba/abajo.
  if (position === "top" || position === "bottom") {
    return (
      <Animated.View
        style={[
          styles.bar,
          position === "top" ? styles.barTop : styles.barBottom,
          { opacity, transform },
        ]}
      >
        {popup.image ? (
          <Image
            source={{ uri: popup.image }}
            style={styles.barImage}
            resizeMode="cover"
          />
        ) : null}
        {closeButton}
      </Animated.View>
    );
  }

  const customMaxHeight =
    popup.maxHeight && popup.maxHeight > 0 ? popup.maxHeight : null;
  const sideMaxHeight = customMaxHeight ?? Math.max(winHeight - 112, 120);
  const centerMaxHeight = customMaxHeight ?? Math.max(winHeight - 32, 120);

  const panelContent = (
    <ScrollView contentContainerStyle={styles.panelContent} bounces={false}>
      {popup.image ? (
        <Image
          source={{ uri: popup.image }}
          style={[
            styles.panelImage,
            imageAspect ? { aspectRatio: imageAspect } : null,
          ]}
          resizeMode="contain"
          onLoad={(e) => {
            const { width: w, height: h } = e.nativeEvent.source;
            if (w > 0 && h > 0) setImageAspect(w / h);
          }}
        />
      ) : null}
      {popup.title ? <Text style={styles.panelTitle}>{popup.title}</Text> : null}
    </ScrollView>
  );

  // Paneles left/right: overlay a pantalla completa con panel flotante.
  if (position === "left" || position === "right") {
    return (
      <View style={styles.fill} pointerEvents="box-none">
        <Animated.View
          style={[styles.panelSide, { maxHeight: sideMaxHeight, opacity, transform }]}
        >
          {panelContent}
          {closeButton}
        </Animated.View>
      </View>
    );
  }

  // Posición por defecto: panel centrado.
  return (
    <View
      style={[styles.fill, styles.centerOverlay]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[styles.panelCenter, { maxHeight: centerMaxHeight, opacity, transform }]}
      >
        {panelContent}
        {closeButton}
      </Animated.View>
    </View>
  );
}

/** Muestra los popups activos (con imagen) según su posición configurada. */
export function PopupDisplay() {
  const { data } = useQuery({
    queryKey: ["popups"],
    queryFn: popupsApi.getActive,
  });
  const popups = useMemo(() => (data ?? []).filter((p) => p.image), [data]);

  const [visibleIds, setVisibleIds] = useState<Set<number>>(() => new Set());
  const [closingIds, setClosingIds] = useState<Set<number>>(() => new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(() => new Set());

  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const dismissedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    dismissedRef.current = dismissedIds;
  }, [dismissedIds]);

  // Programa la aparición (delayMs) y el auto-cierre (durationMs) por popup.
  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    for (const p of popups) {
      if (dismissedRef.current.has(p.id)) continue;
      const delayMs = p.delayMs ?? 0;
      const durationMs = p.durationMs ?? 0;

      const showTimer = setTimeout(() => {
        if (dismissedRef.current.has(p.id)) return;
        setVisibleIds((prev) => new Set(prev).add(p.id));
        if (durationMs > 0) {
          const hideTimer = setTimeout(() => {
            setClosingIds((prev) => new Set(prev).add(p.id));
          }, durationMs);
          timers.set(p.id, hideTimer);
        }
      }, delayMs);

      timers.set(p.id, showTimer);
    }

    timersRef.current = timers;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timersRef.current = new Map();
    };
  }, [popups]);

  const handleClose = useCallback((id: number) => {
    setClosingIds((prev) => new Set(prev).add(id));
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const handleClosed = useCallback((id: number) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDismissedIds((prev) => new Set(prev).add(id));
    setClosingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Orden de render: top/bottom primero, luego left/right, por último centrados
  // (los posteriores se dibujan encima).
  const visiblePopups = useMemo(() => {
    const order = (p: Popup): number => {
      const pos = resolvePosition(p.position);
      if (pos === "top" || pos === "bottom") return 0;
      if (pos === "left" || pos === "right") return 1;
      return 2;
    };
    return popups
      .filter((p) => visibleIds.has(p.id) && !dismissedIds.has(p.id))
      .sort((a, b) => order(a) - order(b));
  }, [popups, visibleIds, dismissedIds]);

  if (visiblePopups.length === 0) return null;

  return (
    <>
      {visiblePopups.map((p) => (
        <PopupItem
          key={p.id}
          popup={p}
          closing={closingIds.has(p.id)}
          onClose={handleClose}
          onClosed={handleClosed}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  barTop: { top: 0 },
  barBottom: { bottom: 0 },
  barImage: { width: "100%", height: "100%" },

  panelSide: {
    position: "absolute",
    top: layout.headerHeight + 24,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radii.threeXl,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    overflow: "hidden",
    ...shadow.lg,
  },
  centerOverlay: {
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  panelCenter: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: radii.threeXl,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    overflow: "hidden",
    ...shadow.lg,
  },

  panelContent: { flexGrow: 1 },
  panelImage: { width: "100%", minHeight: 120 },
  panelTitle: {
    padding: spacing.md,
    fontFamily: fonts.sansSemibold,
    fontSize: text.sm,
    color: colors.foreground,
    textAlign: "center",
  },

  closeBtn: {
    position: "absolute",
    right: 12,
    width: 28,
    height: 28,
    borderRadius: radii.full,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  closeBtnTop: { top: 12 },
  closeBtnBottom: { bottom: 12 },
});
