import { resolveApiBaseUrl } from "../lib/api";
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2 } from "lucide-react";

const API_BASE_URL = resolveApiBaseUrl();

/** Tokens de color que se pueden personalizar en cada tema. */
const THEME_TOKENS: { token: string; label: string }[] = [
  { token: "--background", label: "Fondo de página" },
  { token: "--foreground", label: "Texto principal" },
  { token: "--card", label: "Tarjetas (fondo)" },
  { token: "--card-foreground", label: "Tarjetas (texto)" },
  { token: "--popover", label: "Popovers (fondo)" },
  { token: "--popover-foreground", label: "Popovers (texto)" },
  { token: "--primary", label: "Color de marca" },
  { token: "--primary-foreground", label: "Texto sobre marca" },
  { token: "--secondary", label: "Superficie oscura" },
  { token: "--secondary-foreground", label: "Texto sobre superficie" },
  { token: "--muted", label: "Fondo atenuado" },
  { token: "--muted-foreground", label: "Texto atenuado" },
  { token: "--accent", label: "Acento" },
  { token: "--accent-foreground", label: "Texto sobre acento" },
  { token: "--border", label: "Bordes" },
  { token: "--ring", label: "Anillo de foco" },
];

const THEME_TABS = [
  { id: "claro", label: "Claro" },
  { id: "oscuro", label: "Oscuro" },
] as const;

type ThemeTab = (typeof THEME_TABS)[number]["id"];
type ThemeState = Record<ThemeTab, Record<string, string>>;

const EMPTY_THEME: ThemeState = { claro: {}, oscuro: {} };

/** Normaliza lo que devuelve la API a las dos pestañas del editor. */
function toThemeState(raw: unknown): ThemeState {
  const source = (raw ?? {}) as Record<string, Record<string, string>>;
  return {
    claro: { ...(source.claro ?? {}) },
    oscuro: { ...(source.oscuro ?? {}) },
  };
}

export default function General() {
  const [logoUrl, setLogoUrl] = useState("");
  const [siteTitle, setSiteTitle] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [theme, setTheme] = useState<ThemeState>(EMPTY_THEME);
  const [themeTab, setThemeTab] = useState<ThemeTab>("claro");
  // Última versión persistida, para no guardar al cargar ni repetir guardados.
  const savedRef = useRef("");

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/landing/general-logo`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        const url = data.url ?? "";
        const title = data.title ?? "";
        const favicon = data.favicon ?? "";
        const loadedTheme = toThemeState(data.theme);
        setLogoUrl(url);
        setSiteTitle(title);
        setFaviconUrl(favicon);
        setTheme(loadedTheme);
        savedRef.current = JSON.stringify({
          url,
          title,
          favicon,
          theme: loadedTheme,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const uploadImage = async (file: File, code: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("code", code);
    const res = await fetch(`${API_BASE_URL}/upload/image`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error("Error al subir la imagen");
    const data = await res.json();
    return data.url as string;
  };

  const updateToken = (tab: ThemeTab, token: string, value: string) => {
    setTheme((prev) => ({ ...prev, [tab]: { ...prev[tab], [token]: value } }));
  };

  /** Vuelve a los colores por defecto de un tema (envía la paleta vacía). */
  const resetTheme = async (tab: ThemeTab) => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/landing/general-logo`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: logoUrl,
          title: siteTitle,
          favicon: faviconUrl,
          theme: { [tab]: {} },
        }),
      });
      if (!res.ok) throw new Error("Error al restablecer");
      // El guardado deja los valores por defecto: se recargan para verlos.
      await load();
      setSaved(true);
    } catch (e: any) {
      setError(e.message || "Error al restablecer");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const body = { url: logoUrl, title: siteTitle, favicon: faviconUrl, theme };
      const res = await fetch(`${API_BASE_URL}/admin/landing/general-logo`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Error al guardar");
      savedRef.current = JSON.stringify(body);
      setSaved(true);
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }, [logoUrl, siteTitle, faviconUrl, theme]);

  // Autoguardado: cualquier cambio de título, logo o favicon se persiste solo.
  useEffect(() => {
    if (loading) return;
    const snap = JSON.stringify({
      url: logoUrl,
      title: siteTitle,
      favicon: faviconUrl,
      theme,
    });
    if (snap === savedRef.current) return;
    const t = setTimeout(() => {
      void handleSave();
    }, 800);
    return () => clearTimeout(t);
  }, [logoUrl, siteTitle, faviconUrl, theme, loading, handleSave]);

  const onPickFile = async (file: File, kind: "logo" | "favicon") => {
    const setBusy = kind === "logo" ? setUploadingLogo : setUploadingFavicon;
    setBusy(true);
    setError("");
    try {
      const url = await uploadImage(
        file,
        kind === "logo" ? "logo_mercaldas" : "favicon_mercaldas",
      );
      if (kind === "logo") setLogoUrl(url);
      else setFaviconUrl(url);
    } catch (e: any) {
      setError(e.message || "Error al subir la imagen");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const Status = () => (
    <>
      {saving && (
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" /> Guardando…
        </span>
      )}
      {!saving && saved && (
        <span className="text-xs text-green-600 font-medium">Guardado</span>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">General</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Configuración general de la tienda
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm text-gray-900">Título de la página</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Es el título que aparece en la pestaña del navegador. Siempre se muestra con el sufijo <strong>| DSI</strong>.
            </p>
          </div>
          <Status />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Título
          </label>
          <input
            value={siteTitle}
            onChange={(e) => setSiteTitle(e.target.value)}
            placeholder="Mercaldas"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <p className="text-xs text-gray-400 mt-2">
            Resultado: <span className="font-semibold text-gray-700">{(siteTitle.trim() || "Mercaldas") + " | DSI"}</span>
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm text-gray-900">Logo de la empresa</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Aparece en el header (junto al buscador) y en el footer. Si no se configura, se muestra el logo de texto.
            </p>
          </div>
          <Status />
        </div>

        {/* Vista previa del logo actual */}
        {logoUrl ? (
          <div className="border border-gray-200 rounded-xl p-4 flex items-center justify-center bg-gray-50">
            <img src={logoUrl} alt="Logo" className="h-12 object-contain" />
          </div>
        ) : (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center text-gray-400 text-sm">
            Sin logo configurado
            <span className="text-xs">— se usará el logo de texto por defecto</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Subir imagen
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center justify-center gap-1 px-4 py-2 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
              {uploadingLogo ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Subiendo…
                </>
              ) : (
                "Elegir archivo"
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickFile(file, "logo");
                  e.target.value = "";
                }}
                className="hidden"
              />
            </label>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="…o pega una URL de imagen"
              className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm text-gray-900">Logo del favicon</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Es el ícono que aparece en la pestaña del navegador del cliente. Si no se
              configura, se usa el logo de la empresa.
            </p>
          </div>
          <Status />
        </div>

        {/* Vista previa del favicon actual */}
        <div className="border border-gray-200 rounded-xl p-4 flex items-center gap-4 bg-gray-50">
          <div className="w-12 h-12 flex items-center justify-center bg-white border border-gray-200 rounded-lg overflow-hidden shrink-0">
            {faviconUrl || logoUrl ? (
              <img
                src={faviconUrl || logoUrl}
                alt="Favicon"
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[10px] text-gray-300 text-center leading-tight">
                sin
                <br />
                favicon
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            {faviconUrl
              ? "Favicon personalizado"
              : "Usando el logo de la empresa por defecto"}
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Subir imagen
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center justify-center gap-1 px-4 py-2 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
              {uploadingFavicon ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Subiendo…
                </>
              ) : (
                "Elegir archivo"
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickFile(file, "favicon");
                  e.target.value = "";
                }}
                className="hidden"
              />
            </label>
            <input
              value={faviconUrl}
              onChange={(e) => setFaviconUrl(e.target.value)}
              placeholder="…o pega una URL de imagen"
              className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono"
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Recomendado: imagen cuadrada (por ejemplo 192×192) con fondo transparente.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm text-gray-900">
              Temas (claro y oscuro)
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Colores del cliente. El cliente sólo alterna entre claro y oscuro;
              aquí se definen los colores de cada uno.
            </p>
          </div>
          <Status />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {THEME_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setThemeTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  themeTab === tab.id
                    ? "bg-white shadow-sm text-gray-900"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void resetTheme(themeTab)}
            className="text-xs font-medium text-gray-500 hover:text-red-600 transition-colors"
          >
            Restablecer {themeTab}
          </button>
        </div>

        <div className="space-y-2">
          {THEME_TOKENS.map(({ token, label }) => {
            const value = theme[themeTab][token] ?? "";
            const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
            return (
              <div key={token} className="flex items-center gap-3">
                <label className="w-40 shrink-0 text-xs text-gray-600">
                  {label}
                </label>
                <input
                  type="color"
                  value={hex ?? "#ffffff"}
                  disabled={!hex}
                  onChange={(e) => updateToken(themeTab, token, e.target.value)}
                  title={token}
                  className="w-8 h-8 shrink-0 rounded border border-gray-200 bg-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                />
                <input
                  value={value}
                  onChange={(e) => updateToken(themeTab, token, e.target.value)}
                  placeholder="#rrggbb"
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-400">
          Acepta <span className="font-mono">#fff200</span>,{" "}
          <span className="font-mono">#ff4444</span> y{" "}
          <span className="font-mono">rgba(0,0,0,0.08)</span>. Un valor vacío o
          inválido vuelve al color por defecto.
        </p>
      </div>
    </div>
  );
}
