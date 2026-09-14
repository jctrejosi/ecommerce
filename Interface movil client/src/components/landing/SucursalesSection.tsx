import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { branchesApi } from "../../api/content";
import type { Branch } from "../../api/types";
import { colors, fonts, radii, spacing, text } from "../../theme";

const DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mié",
  thursday: "Jue",
  friday: "Vie",
  saturday: "Sáb",
  sunday: "Dom",
};

/** "Lun–Dom · horario" a partir del rango de días con horario definido. */
function formatSchedule(schedule: Record<string, string> | null | undefined): string | null {
  if (!schedule) return null;
  const days = DAY_ORDER.filter((d) => schedule[d]);
  if (days.length === 0) return null;

  const first = days[0];
  const last = days[days.length - 1];
  const range = first === last ? DAY_LABELS[first] : `${DAY_LABELS[first]}–${DAY_LABELS[last]}`;
  return `${range} · ${schedule[first]}`;
}

function openMap(branch: Branch) {
  const query = encodeURIComponent(`${branch.name}, ${branch.address}, ${branch.city}, Colombia`);
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => {});
}

/** "Nuestras tiendas": listado de sucursales (1 columna en móvil). */
export function SucursalesSection() {
  const { data } = useQuery({
    queryKey: ["branches"],
    queryFn: branchesApi.getBranches,
  });

  const branches = data ?? [];
  if (branches.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>NUESTRAS TIENDAS</Text>
          </View>
          <View>
            <Text style={styles.title}>Sucursales en Manizales</Text>
            <Text style={styles.subtitle}>
              {branches.length} tiendas en toda la ciudad. Compra en línea y recoge en la
              más cercana sin costo adicional.
            </Text>
          </View>
        </View>

        <View style={styles.grid}>
          {branches.map((branch) => {
            const schedule = formatSchedule(branch.schedule);
            return (
              <View key={branch.id} style={styles.card}>
                {branch.image ? (
                  <View style={styles.imageWrap}>
                    <Image
                      source={{ uri: branch.image }}
                      style={styles.image}
                      resizeMode="cover"
                    />
                    <LinearGradient
                      colors={["rgba(26,26,46,0.6)", "transparent"]}
                      locations={[0, 0.55]}
                      start={{ x: 0.5, y: 1 }}
                      end={{ x: 0.5, y: 0 }}
                      style={styles.overlay}
                    />
                    <Text style={styles.imageName}>{branch.name}</Text>
                  </View>
                ) : null}

                <View style={styles.body}>
                  {!branch.image && <Text style={styles.name}>{branch.name}</Text>}

                  <View style={[styles.infoRow, styles.infoRowTop]}>
                    <Ionicons name="location" size={12} color={colors.mutedForeground} />
                    <Text style={styles.infoText}>{branch.address}</Text>
                  </View>

                  {schedule && (
                    <View style={styles.infoRow}>
                      <Ionicons name="time" size={12} color={colors.mutedForeground} />
                      <Text style={styles.infoText}>{schedule}</Text>
                    </View>
                  )}

                  {!!branch.phone && (
                    <View style={styles.infoRow}>
                      <Ionicons name="call" size={12} color={colors.mutedForeground} />
                      <Text style={styles.infoText}>{branch.phone}</Text>
                    </View>
                  )}

                  <Pressable style={styles.cta} onPress={() => openMap(branch)}>
                    <Text style={styles.ctaText}>Cómo llegar</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.threeXl,
    backgroundColor: colors.muted,
  },
  container: {
    paddingHorizontal: spacing.lg,
  },
  header: {
    marginBottom: spacing.xl,
    gap: spacing.lg,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.secondary,
  },
  badgeText: {
    color: colors.primary,
    fontSize: text.xs,
    fontFamily: fonts.sansBold,
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },
  title: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  subtitle: {
    fontSize: text.sm,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  grid: {
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageWrap: {
    height: 160,
    backgroundColor: colors.muted,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imageName: {
    position: "absolute",
    bottom: spacing.sm,
    left: spacing.md,
    color: colors.white,
    fontSize: text.base,
    fontFamily: fonts.displayBlack,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  name: {
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  infoRowTop: {
    alignItems: "flex-start",
  },
  infoText: {
    flex: 1,
    fontSize: text.xs,
    color: colors.mutedForeground,
  },
  cta: {
    backgroundColor: colors.primary,
    width: "100%",
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    marginTop: "auto",
    alignItems: "center",
  },
  ctaText: {
    color: colors.primaryForeground,
    fontSize: text.xs,
    fontFamily: fonts.sansBold,
  },
});
