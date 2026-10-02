import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { makeStyles, radius, spacing } from "@/theme";

interface ToastProps {
  message: string | null;
  onHide: () => void;
}

/** Aviso flotante que aparece arriba y desaparece solo. */
export function Toast({ message, onHide }: ToastProps) {
  const styles = useStyles();
  const translateY = useRef(new Animated.Value(-40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -40, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => onHide());
    }, 3500);

    return () => clearTimeout(timer);
  }, [message, onHide, opacity, translateY]);

  if (!message) return null;

  return (
    <Animated.View style={[styles.wrap, { opacity, transform: [{ translateY }] }]}>
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 8,
    left: spacing(4),
    right: spacing(4),
    zIndex: 50,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
  },
  text: { color: colors.onAccent, fontSize: 13, fontWeight: "700" },
}));
