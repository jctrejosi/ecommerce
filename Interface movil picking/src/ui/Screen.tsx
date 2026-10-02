import { ReactNode, useCallback } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { makeStyles, spacing } from "@/theme";

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Se dispara al acercarse al final del scroll (para listas largas). */
  onEndReached?: () => void;
  /** Distancia al final (px) que dispara `onEndReached`. */
  endReachedThreshold?: number;
}

/** Contenedor base de pantalla (tema oscuro + SafeArea). */
export function Screen({
  children,
  scroll = true,
  padded = true,
  onEndReached,
  endReachedThreshold = 240,
}: ScreenProps) {
  const styles = useStyles();
  const content = <View style={[styles.body, padded && styles.padded]}>{children}</View>;

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!onEndReached) return;
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const distanceFromEnd =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceFromEnd <= endReachedThreshold) onEndReached();
    },
    [onEndReached, endReachedThreshold],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          onScroll={onEndReached ? handleScroll : undefined}
          scrollEventThrottle={onEndReached ? 100 : undefined}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1 },
  body: { flex: 1 },
  padded: { padding: spacing(4) },
}));
