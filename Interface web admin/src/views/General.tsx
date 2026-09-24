import { resolveApiBaseUrl } from "../lib/api";
import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";

const API_BASE_URL = resolveApiBaseUrl();

export default function General() {
  const [logoUrl, setLogoUrl] = useState("");
  const [siteTitle, setSiteTitle] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState("");
  const [pendingFaviconFile, setPendingFaviconFile] = useState<File | null>(null);
  const [pendingFaviconPreview, setPendingFaviconPreview] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/landing/general-logo`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setLogoUrl(data.url ?? "");
        setSiteTitle(data.title ?? "");
        setFaviconUrl(data.favicon ?? "");
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

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setOk(false);
    try {
      let url = logoUrl;
      if (pendingFile) {
        url = await uploadImage(pendingFile, "logo_mercaldas");
        setLogoUrl(url);
        setPendingFile(null);
        setPendingPreview("");
      }
      let favicon = faviconUrl;
      if (pendingFaviconFile) {
        favicon = await uploadImage(pendingFaviconFile, "favicon_mercaldas");
        setFaviconUrl(favicon);
        setPendingFaviconFile(null);
        setPendingFaviconPreview("");
      }
      const res = await fetch(`${API_BASE_URL}/admin/landing/general-logo`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title: siteTitle, favicon }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      setOk(true);
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">General</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Configuración general de la tienda
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-xl space-y-5">
        <div>
          <h3 className="font-semibold text-sm text-gray-900">Título de la página</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Es el título que aparece en la pestaña del navegador. Siempre se muestra con el sufijo <strong>| DSI</strong>.
          </p>
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

        {error && <p className="text-sm text-red-500">{error}</p>}
        {ok && <p className="text-sm text-green-600">Título guardado correctamente</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          <Save size={14} /> Guardar título
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-xl space-y-5">
        <div>
          <h3 className="font-semibold text-sm text-gray-900">Logo de la empresa</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Aparece en el header (junto al buscador) y en el footer. Si no se configura, se muestra el logo de texto.
          </p>
        </div>

        {/* Vista previa del logo actual */}
        {(pendingPreview || logoUrl) ? (
          <div className="border border-gray-200 rounded-xl p-4 flex items-center justify-center bg-gray-50">
            <img
              src={pendingPreview || logoUrl}
              alt="Logo"
              className="h-12 object-contain"
            />
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
              Elegir archivo
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setPendingFile(file);
                  setPendingPreview(URL.createObjectURL(file));
                }}
                className="hidden"
              />
            </label>
            <input
              value={logoUrl}
              onChange={(e) => {
                setLogoUrl(e.target.value);
                setPendingFile(null);
                setPendingPreview("");
              }}
              placeholder="…o pega una URL de imagen"
              className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {ok && <p className="text-sm text-green-600">Logo guardado correctamente</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          <Save size={14} /> Guardar logo
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-xl space-y-5">
        <div>
          <h3 className="font-semibold text-sm text-gray-900">Logo del favicon</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Es el ícono que aparece en la pestaña del navegador del cliente. Si no se
            configura, se usa el logo de la empresa.
          </p>
        </div>

        {/* Vista previa del favicon actual */}
        <div className="border border-gray-200 rounded-xl p-4 flex items-center gap-4 bg-gray-50">
          <div className="w-12 h-12 flex items-center justify-center bg-white border border-gray-200 rounded-lg overflow-hidden shrink-0">
            {pendingFaviconPreview || faviconUrl || logoUrl ? (
              <img
                src={pendingFaviconPreview || faviconUrl || logoUrl}
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
              Elegir archivo
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setPendingFaviconFile(file);
                  setPendingFaviconPreview(URL.createObjectURL(file));
                }}
                className="hidden"
              />
            </label>
            <input
              value={faviconUrl}
              onChange={(e) => {
                setFaviconUrl(e.target.value);
                setPendingFaviconFile(null);
                setPendingFaviconPreview("");
              }}
              placeholder="…o pega una URL de imagen"
              className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono"
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Recomendado: imagen cuadrada (por ejemplo 192×192) con fondo transparente.
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {ok && <p className="text-sm text-green-600">Favicon guardado correctamente</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          <Save size={14} /> Guardar favicon
        </button>
      </div>
    </div>
  );
}
