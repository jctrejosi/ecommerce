import type { ComponentProps } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { landingApi } from "../../api/content";
import { colors, fonts, radii, spacing, text } from "../../theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const WHITE_08 = "rgba(255, 255, 255, 0.08)";
const WHITE_30 = "rgba(255, 255, 255, 0.3)";
const WHITE_40 = "rgba(255, 255, 255, 0.4)";
const WHITE_50 = "rgba(255, 255, 255, 0.5)";
const WHITE_65 = "rgba(255, 255, 255, 0.65)";
const WHITE_70 = "rgba(255, 255, 255, 0.7)";

const PAYMENT_METHODS = ["Visa", "Mastercard", "PSE", "Nequi", "Daviplata", "Efectivo"];

/** Mapeo label → Ionicons, replicando los íconos sociales del web client. */
const SOCIAL_ICONS: Record<string, IoniconName> = {
  facebook: "logo-facebook",
  instagram: "logo-instagram",
  twitter: "logo-twitter",
  x: "logo-twitter",
  whatsapp: "logo-whatsapp",
  tiktok: "musical-notes",
  youtube: "logo-youtube",
};

function socialIconName(label?: string): IoniconName {
  if (!label) return "link";
  return SOCIAL_ICONS[label.toLowerCase()] ?? "link";
}

/** Footer de la tienda (réplica móvil del web client). */
export function FooterSection() {
  const { data: footer } = useQuery({
    queryKey: ["footer"],
    queryFn: landingApi.getFooter,
  });
  const { data: general } = useQuery({
    queryKey: ["general"],
    queryFn: landingApi.getGeneral,
  });

  const categories = footer?.resolvedCategories?.slice(0, 6) ?? [];
  const helpLinks = footer?.helpLinks ?? [];
  const socialLinks = footer?.socialLinks ?? [];
  const contact = footer?.contact;
  const description = footer?.description;
  const hours = footer?.hours;
  const logoUrl = general?.url;

  return (
    <View style={styles.footer}>
      <View style={styles.container}>
        {/* Columnas: marca (100%) + categorías / ayuda / contacto (2 columnas). */}
        <View style={styles.columns}>
          <View style={styles.brandColumn}>
            {logoUrl ? (
              <Image
                source={{ uri: logoUrl }}
                style={styles.logo}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.brandText}>MercAldas</Text>
            )}
            {description ? (
              <Text style={styles.description}>{description}</Text>
            ) : null}
            {socialLinks.length > 0 ? (
              <View style={styles.socialRow}>
                {socialLinks.map((s, i) => (
                  <Pressable
                    key={s.label ?? i}
                    style={styles.socialBox}
                    onPress={() => {
                      if (s.url) void Linking.openURL(s.url);
                    }}
                  >
                    <Ionicons
                      name={socialIconName(s.label)}
                      size={14}
                      color={WHITE_65}
                    />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.column}>
            <Text style={styles.columnTitle}>Categorías</Text>
            <View style={styles.columnLinks}>
              {categories.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    router.push({
                      pathname: "/catalog",
                      params: { category: c.code },
                    })
                  }
                >
                  <Text style={styles.columnLink}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.column}>
            <Text style={styles.columnTitle}>Ayuda</Text>
            <View style={styles.columnLinks}>
              {helpLinks.map((l, i) => (
                <Pressable
                  key={l.label || i}
                  onPress={() => {
                    if (l.url) void Linking.openURL(l.url);
                  }}
                >
                  <Text style={styles.columnLink}>{l.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.column}>
            <Text style={styles.columnTitle}>Contacto</Text>
            <View style={styles.columnLinks}>
              {contact?.address ? (
                <Text style={styles.contactLine}>📍 {contact.address}</Text>
              ) : null}
              {contact?.phone ? (
                <Text style={styles.contactLine}>📞 {contact.phone}</Text>
              ) : null}
              {contact?.email ? (
                <Text style={styles.contactLine}>✉️ {contact.email}</Text>
              ) : null}
              <Text style={styles.hoursTitle}>Horario de atención</Text>
              {hours ? <Text style={styles.contactLine}>{hours}</Text> : null}
            </View>
          </View>
        </View>

        {/* Medios de pago */}
        <View style={styles.payments}>
          <Text style={styles.paymentsTitle}>Medios de pago</Text>
          <View style={styles.pillsRow}>
            {PAYMENT_METHODS.map((method) => (
              <View key={method} style={styles.pill}>
                <Text style={styles.pillText}>{method}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Barra legal */}
        <View style={styles.legal}>
          {logoUrl ? (
            <Image
              source={{ uri: logoUrl }}
              style={styles.legalLogo}
              resizeMode="contain"
            />
          ) : null}
          <Text style={styles.copyright}>
            © {new Date().getFullYear()} Desarrollado por{" "}
            <Text style={styles.copyrightStrong}>DSI SA</Text> · Todos los
            derechos reservados
          </Text>
          <Text style={styles.city}>Manizales, Caldas, Colombia</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    backgroundColor: colors.footerBg,
    paddingTop: spacing.threeXl,
    paddingBottom: spacing.lg,
  },
  container: { paddingHorizontal: spacing.lg },

  columns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.twoXl,
    marginBottom: spacing.threeXl,
  },
  brandColumn: { width: "100%" },
  column: { flexBasis: "44%", flexGrow: 1 },

  logo: { width: 140, height: 32, alignSelf: "flex-start" },
  brandText: {
    fontFamily: fonts.displayBlack,
    fontSize: text.twoXl,
    color: colors.white,
    alignSelf: "flex-start",
  },
  description: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    lineHeight: 20,
    color: WHITE_50,
    marginTop: spacing.md,
  },
  socialRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  socialBox: {
    width: 32,
    height: 32,
    borderRadius: radii.lg,
    backgroundColor: WHITE_08,
    alignItems: "center",
    justifyContent: "center",
  },

  columnTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: text.sm,
    color: colors.white,
    marginBottom: spacing.md,
  },
  columnLinks: { gap: spacing.sm },
  columnLink: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: WHITE_50,
  },

  contactLine: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: WHITE_50,
  },
  hoursTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: text.xs,
    color: colors.white,
    marginTop: spacing.md,
  },

  payments: {
    borderTopWidth: 1,
    borderColor: WHITE_08,
    paddingVertical: 20,
  },
  paymentsTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: text.xs,
    color: WHITE_40,
    marginBottom: spacing.md,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.lg,
    backgroundColor: WHITE_08,
  },
  pillText: {
    fontFamily: fonts.sansBold,
    fontSize: text.xs,
    color: WHITE_65,
  },

  legal: {
    borderTopWidth: 1,
    borderColor: WHITE_08,
    paddingTop: spacing.md,
    paddingBottom: 6,
    alignItems: "center",
    gap: 4,
  },
  legalLogo: { width: 140, height: 32 },
  copyright: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: WHITE_40,
    textAlign: "center",
  },
  copyrightStrong: {
    fontFamily: fonts.sansBold,
    color: WHITE_70,
  },
  city: {
    fontFamily: fonts.sans,
    fontSize: text.xs,
    color: WHITE_30,
  },
});
