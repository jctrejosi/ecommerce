import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { landingApi } from "../../api/content";
import { colors, fonts, radii, spacing, text } from "../../theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

const ICON_MAP: Record<string, IconName> = {
  Truck: "cube",
  MapPin: "location",
  CreditCard: "card",
  Clock: "time",
  ShieldCheck: "shield-checkmark",
  Zap: "flash",
  Wallet: "wallet",
  Star: "star",
};

/** "¿Por qué comprar en Mercaldas?" · beneficios en 1 columna (móvil). */
export function BenefitsSection() {
  const { data } = useQuery({
    queryKey: ["benefits"],
    queryFn: landingApi.getBenefits,
  });

  const items = data ?? [];
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.container}>
        <Text style={styles.title}>¿Por qué comprar en Mercaldas?</Text>

        <View style={styles.grid}>
          {items.map((benefit) => (
            <View key={benefit.id} style={styles.item}>
              <View style={styles.iconBox}>
                <Ionicons
                  name={ICON_MAP[benefit.icon] ?? "sparkles"}
                  size={20}
                  color={colors.primaryForeground}
                />
              </View>
              <View style={styles.itemText}>
                <Text style={styles.itemTitle}>{benefit.title}</Text>
                <Text style={styles.itemDesc}>{benefit.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.threeXl,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  container: {
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
    textAlign: "center",
    marginBottom: spacing.twoXl,
  },
  grid: {
    gap: spacing.lg,
  },
  item: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.xl,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  itemText: {
    flex: 1,
  },
  itemTitle: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
  },
  itemDesc: {
    fontSize: text.xs,
    color: colors.mutedForeground,
    marginTop: 2,
    lineHeight: 20,
  },
});
