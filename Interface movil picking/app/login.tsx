import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { makeStyles, radius, spacing, useTheme } from "@/theme";
import { apiErrorMessage, pickingApi } from "@/api";
import { resolveAssetUrl } from "@/api/apiConfig";
import { useAuthStore } from "@/auth/authStore";
import { useKeyboardHeight } from "@/lib/keyboard";
import { ErrorBox } from "@/ui/ErrorBox";

/**
 * Login de la app de picking: pantalla propia al arrancar (no modal).
 * Se entra con el usuario/correo y la contraseña que administra el panel
 * de picking. La sesión queda guardada hasta que venza el turno o por
 * inactividad.
 */
export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const login = useAuthStore((s) => s.login);

  // Logo de la tienda configurado en el admin (endpoint público). Si el backend
  // aún no responde, la pantalla se ve igual: simplemente no hay logo arriba.
  const storeInfo = useQuery({
    queryKey: ["store", "general"],
    queryFn: () => pickingApi.storeInfo(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const storeLogo = resolveAssetUrl(storeInfo.data?.url);

  // Con edge-to-edge el teclado se superpone al contenido (Android ignora
  // `adjustResize`), así que apartamos el formulario a mano.
  const keyboardHeight = useKeyboardHeight();
  const keyboardOpen = keyboardHeight > 0;

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const user = identifier.trim();
    if (!user || !password) {
      setErrorMsg("Ingresa usuario y contraseña.");
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await login(user, password);
      router.replace("/");
    } catch (e) {
      setErrorMsg(apiErrorMessage(e, "Usuario o contraseña incorrectos"));
    } finally {
      setBusy(false);
    }
  }, [identifier, login, password, router]);

  return (
    <SafeAreaView
      style={styles.safe}
      // Con el teclado abierto el borde inferior seguro sobra: el propio
      // teclado ya ocupa esa zona.
      edges={keyboardOpen ? ["top", "left", "right"] : ["top", "bottom", "left", "right"]}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scroll,
          keyboardOpen && styles.scrollKeyboard,
          keyboardOpen && { paddingBottom: keyboardHeight + spacing(4) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Mientras se escribe se ocultan las marcas: libera la altura que
            necesita el formulario para quedar por encima del teclado en las
            pantallas pequeñas del dispositivo de picking. */}
        {keyboardOpen ? null : (
          <View style={styles.topBrand}>
            {storeLogo ? (
              <Image
                source={{ uri: storeLogo }}
                style={styles.storeLogo}
                resizeMode="contain"
              />
            ) : null}
            <Text style={styles.appName}>Picking | DSI</Text>
            <Text style={styles.tagline}>Inicia sesión para comenzar</Text>
          </View>
        )}

        <View style={styles.card}>
          {errorMsg ? <ErrorBox message={errorMsg} /> : null}

          <Text style={styles.label}>Usuario o correo</Text>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="usuario"
            placeholderTextColor={colors.textHint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            returnKeyType="next"
            style={styles.input}
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            placeholder="••••••••"
            placeholderTextColor={colors.textHint}
            secureTextEntry
            autoComplete="current-password"
            returnKeyType="go"
            style={styles.input}
          />

          <Pressable
            onPress={() => void submit()}
            disabled={busy || !identifier.trim() || password.length === 0}
            style={({ pressed }) => [
              styles.primary,
              (busy || !identifier.trim() || password.length === 0) &&
                styles.primaryDisabled,
              pressed && { opacity: 0.9 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.primaryText}>Iniciar sesión</Text>
            )}
          </Pressable>
        </View>

        {/* Marca de la app, al pie de la pantalla. */}
        {keyboardOpen ? null : (
          <View style={styles.bottomBrand}>
            <Image
              source={require("../assets/picking.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  // space-between: logo de la tienda arriba, formulario en el centro y la marca
  // de la app al pie.
  scroll: { flexGrow: 1, justifyContent: "space-between", padding: spacing(5) },
  // Con el teclado abierto solo queda el formulario: se centra en lo visible.
  scrollKeyboard: { justifyContent: "center" },
  topBrand: { alignItems: "center" },
  storeLogo: { height: 52, width: 200, marginBottom: spacing(4) },
  bottomBrand: { alignItems: "center" },
  logo: { height: 64, width: 116 },
  appName: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: spacing(2) },
  tagline: { color: colors.textFaint, fontSize: 13, fontWeight: "600", marginTop: spacing(1) },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing(5),
    gap: spacing(3),
  },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  input: {
    height: 50,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    color: colors.text,
    fontSize: 15,
    marginTop: -spacing(1),
  },
  primary: {
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing(1),
  },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: colors.onAccent, fontSize: 15, fontWeight: "800" },
}));
