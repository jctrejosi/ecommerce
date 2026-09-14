import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { newsletterApi } from "../../api/content";
import { colors, fonts, radii, spacing, text } from "../../theme";

const EMAIL_REGEX = /\S+@\S+\.\S+/;

/** "Recibe las mejores ofertas": formulario de suscripción al newsletter. */
export function NewsletterSection() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const emailValid = EMAIL_REGEX.test(email);

  const handleSubmit = async () => {
    if (!emailValid) {
      setError("Ingresa un correo válido");
      return;
    }
    if (!acceptedTerms) {
      setError("Debes aceptar los términos y condiciones del newsletter");
      return;
    }

    setError("");
    setLoading(true);
    try {
      await newsletterApi.subscribe({
        email,
        name: name.trim() || undefined,
        acceptedTerms,
      });
      setSuccess(true);
      setName("");
      setEmail("");
      setAcceptedTerms(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No pudimos completar tu suscripción",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.container}>
        <View style={styles.iconBox}>
          <Ionicons name="mail" size={24} color={colors.primaryForeground} />
        </View>

        <Text style={styles.title}>Recibe las mejores ofertas</Text>
        <Text style={styles.subtitle}>
          Suscríbete y sé el primero en enterarte de promociones exclusivas,
          descuentos de temporada y novedades de Mercaldas.
        </Text>

        {success ? (
          <View style={styles.successBox}>
            <Ionicons name="shield-checkmark" size={16} color={colors.primaryForeground} />
            <Text style={styles.successText}>¡Listo! Te notificaremos las mejores ofertas.</Text>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Tu nombre (opcional)"
              placeholderTextColor={colors.mutedForeground}
              style={styles.input}
            />

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="tu@correo.com"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
            />

            <Pressable
              style={styles.termsRow}
              onPress={() => setAcceptedTerms((v) => !v)}
            >
              <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
                {acceptedTerms && (
                  <Ionicons name="checkmark" size={12} color={colors.primaryForeground} />
                )}
              </View>
              <Text style={styles.termsText}>
                Acepto los{" "}
                <Text style={styles.termsLink}>términos y condiciones</Text>{" "}
                del newsletter y autorizo el envío de comunicaciones promocionales
                de Mercaldas a mi correo.
              </Text>
            </Pressable>

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#fca5a5" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submit, (loading || !emailValid) && styles.submitDisabled]}
              disabled={loading || !emailValid}
              onPress={handleSubmit}
            >
              <Text style={styles.submitText}>
                {loading ? "Suscribiendo..." : "Suscribirme"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.fourXl,
    backgroundColor: colors.secondary,
  },
  container: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 576,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radii.twoXl,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.white,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    fontSize: text.sm,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 28,
    textAlign: "center",
  },
  form: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 384,
    gap: spacing.md,
  },
  input: {
    width: "100%",
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.xl,
    fontSize: text.sm,
    fontFamily: fonts.sans,
    backgroundColor: colors.white,
    color: colors.foreground,
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
  },
  termsText: {
    flex: 1,
    fontSize: text.xs,
    fontFamily: fonts.sans,
    color: "rgba(255,255,255,0.7)",
    lineHeight: 18,
  },
  termsLink: {
    color: colors.primary,
    fontFamily: fonts.sansSemibold,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderRadius: radii.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: text.xs,
    fontFamily: fonts.sans,
    color: "#fca5a5",
  },
  submit: {
    backgroundColor: colors.primary,
    width: "100%",
    paddingVertical: 10,
    borderRadius: radii.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: colors.primaryForeground,
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
  },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.primary,
  },
  successText: {
    color: colors.primaryForeground,
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
  },
});
