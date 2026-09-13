import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "@/theme";
import type { PickingShelf } from "@/api";

const GRID_W = 14;
const GRID_H = 28;
const HEADER_H = 20;

export interface MapSpot {
  shelfId: number;
  rowNumber: number;
}

interface PickingMapProps {
  shelves: PickingShelf[];
  active?: MapSpot;
  others?: MapSpot[];
  width: number;
}

/** Franja de fila que titila (verde = ítem activo, rojo = otras ubicaciones). */
function BlinkBand({
  top,
  height,
  color,
}: {
  top: number;
  height: number;
  color: string;
}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.band, { top, height, backgroundColor: color, opacity }]}
    />
  );
}

/** Mapa de bodega (solo lectura): dibuja las estanterías y resalta ubicaciones. */
export function PickingMap({ shelves, active, others = [], width }: PickingMapProps) {
  const cellPx = width / GRID_W;
  const height = GRID_H * cellPx;

  return (
    <View style={[styles.canvas, { width, height }]}>
      {shelves.map((shelf) => {
        const rotated = shelf.rotation === 90;
        const wCells = shelf.width || 3;
        const hCells = shelf.height || Math.max(2, shelf.rows.length);
        const w = (rotated ? hCells : wCells) * cellPx;
        const h = (rotated ? wCells : hCells) * cellPx;
        const left = shelf.posX * cellPx;
        const top = shelf.posY * cellPx;
        const rowsCount = Math.max(1, shelf.rows.length);

        const activeHere = active?.shelfId === shelf.id;
        const otherRows = others.filter((o) => o.shelfId === shelf.id).map((o) => o.rowNumber);

        return (
          <View
            key={shelf.id}
            style={[
              styles.shelf,
              {
                left,
                top,
                width: w,
                height: h,
                borderColor: shelf.color ? `${shelf.color}80` : colors.borderStrong,
                backgroundColor: shelf.color ? `${shelf.color}22` : "rgba(255,255,255,0.06)",
              },
            ]}
          >
            <View
              style={[
                styles.shelfHeader,
                { backgroundColor: shelf.color ? `${shelf.color}55` : colors.chip, height: Math.min(HEADER_H, h) },
              ]}
            >
              <Text style={styles.shelfCode} numberOfLines={1}>
                {shelf.code}
              </Text>
            </View>

            <View style={styles.rowsArea}>
              {shelf.rows.map((row, idx) => {
                const bandH = (h - Math.min(HEADER_H, h)) / rowsCount;
                const bandTop = idx * bandH;
                const isActive = activeHere && active?.rowNumber === row.rowNumber;
                const isOther = otherRows.includes(row.rowNumber);
                return (
                  <View key={row.id} style={[styles.rowBand, { top: bandTop, height: bandH }]}>
                    {isActive ? (
                      <BlinkBand top={0} height={bandH} color="rgba(34,197,94,0.65)" />
                    ) : isOther ? (
                      <BlinkBand top={0} height={bandH} color="rgba(239,68,68,0.55)" />
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: "#111113",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    position: "relative",
    overflow: "hidden",
  },
  shelf: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  shelfHeader: {
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  shelfCode: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  rowsArea: { flex: 1, position: "relative" },
  rowBand: { position: "absolute", left: 0, right: 0 },
  band: { position: "absolute", left: 0, right: 0 },
});
