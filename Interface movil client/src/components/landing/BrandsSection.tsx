import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { landingApi } from "../../api/content";
import { colors, fonts, radii, spacing, text } from "../../theme";

/** "Nuestros aliados": carrusel horizontal de marcas de la landing. */
export function BrandsSection() {
  const { data } = useQuery({
    queryKey: ["landing-brands"],
    queryFn: landingApi.getBrands,
  });

  const brands = data ?? [];
  if (brands.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.bar} />
        <View>
          <Text style={styles.eyebrow}>Nuestros aliados</Text>
          <Text style={styles.title}>Marcas destacadas</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
      >
        {brands.map((brand, i) => (
          <View key={`brand-${brand.id ?? brand.name}-${i}`} style={styles.item}>
            <View style={styles.logoBox}>
              {brand.image ? (
                <Image
                  source={{ uri: brand.image }}
                  style={styles.logo}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.logoFallback}>{brand.name.charAt(0)}</Text>
              )}
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {brand.name}
            </Text>
          </View>
        ))}
      </ScrollView>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  bar: {
    width: spacing.sm,
    height: spacing.twoXl,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
  },
  eyebrow: {
    fontSize: text.xs,
    fontFamily: fonts.sansBold,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: colors.mutedForeground,
  },
  title: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  carousel: {
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  item: {
    alignItems: "center",
    gap: spacing.md,
  },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: radii.twoXl,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  logoFallback: {
    fontSize: 30,
    color: colors.foreground,
    opacity: 0.4,
  },
  name: {
    fontSize: text.xs,
    fontFamily: fonts.sansSemibold,
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 80,
  },
});
