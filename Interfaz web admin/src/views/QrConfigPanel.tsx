import { useCallback, useEffect, useRef, useState } from "react";
import {
  QrCode,
  Upload,
  Wand2,
  Save,
  Loader2,
  FileDown,
  Check,
  AlertTriangle,
  Image,
  FileText,
} from "lucide-react";
import { qrAdminService } from "../services/qr.service";

function dataUri(mime: string, base64: string) {
  return `data:${mime};base64,${base64}`;
}

export default function QrConfigPanel() {
  const [serviceStatus, setServiceStatus] = useState<Record<string, unknown> | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Formulario de generación
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"png" | "pdf">("png");
  const [size, setSize] = useState(400);
  const [errorCorrection, setErrorCorrection] = useState<"L" | "M" | "Q" | "H">("M");
  const [border, setBorder] = useState(4);

  // Estado de la operación actual
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Resultado pendiente de guardar
  const [pending, setPending] = useState<{
    fileMediaId: number;
    fileName: string;
    mimeType: string;
    url: string;
    source: "generated" | "uploaded";
    decoded?: unknown;
  } | null>(null);

  // Configuración guardada
  const [savedConfig, setSavedConfig] = useState<Record<string, unknown> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadingStatus(true);

    // El estado del servicio y la configuración son independientes:
    // si uno falla, el otro no debe bloquear el panel.
    const [statusRes, configRes] = await Promise.allSettled([
      qrAdminService.status(),
      qrAdminService.getConfig(),
    ]);

    if (statusRes.status === "fulfilled") {
      setServiceStatus(statusRes.value);
    } else {
      setServiceStatus({
        available: false,
        detail: statusRes.reason instanceof Error ? statusRes.reason.message : String(statusRes.reason),
      });
    }

    if (configRes.status === "fulfilled") {
      const config = configRes.value;
      setSavedConfig(config);
      if (config?.text) setText(String(config.text));
      const gen = (config?.generation ?? {}) as Record<string, unknown>;
      if (gen.format === "pdf") setFormat("pdf");
      if (typeof gen.size === "number") setSize(gen.size);
      if (typeof gen.errorCorrection === "string")
        setErrorCorrection(gen.errorCorrection as "L" | "M" | "Q" | "H");
      if (typeof gen.border === "number") setBorder(gen.border);
    } else {
      setError(
        configRes.reason instanceof Error
          ? configRes.reason.message
          : String(configRes.reason),
      );
    }

    setLoadingStatus(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGenerate = async () => {
    if (!text.trim()) {
      setError("Escribe el contenido del QR o sube un QR existente para extraerlo");
      return;
    }
    setGenerating(true);
    setError("");
    setSuccess("");
    try {
      const res = await qrAdminService.generate({
        text: text.trim(),
        format,
        size,
        errorCorrection,
        border,
      });
      const mime = res.media_type === "application/pdf" ? "application/pdf" : "image/png";
      const url = dataUri(mime, res.content_base64);
      setPending({
        fileMediaId: -1, // aún sin guardar en media; se guardará al persistir
        fileName: `qr-pago.${res.format}`,
        mimeType: mime,
        url,
        source: "generated",
      });
      setSuccess(`QR ${res.format.toUpperCase()} generado. Revisa la vista previa y guarda.`);
    } catch (e: any) {
      setError(e.message || "Error al generar el QR");
    } finally {
      setGenerating(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const res = await qrAdminService.upload(file);
      const first = res.decoded?.items?.[0];
      if (first) setText(first.text);
      setPending({
        fileMediaId: res.mediaId,
        fileName: res.fileName,
        mimeType: res.mimeType,
        url: res.url,
        source: "uploaded",
        decoded: res.decoded,
      });
      setSuccess(
        `Archivo guardado (${res.fileName}). ${res.decoded?.qr_count ?? 0} QR detectado(s)` +
          (first ? ` · Formato: ${first.format}` : "") +
          (res.decoded?.total_pages ? ` · PDF de ${res.decoded.total_pages} páginas` : ""),
      );
    } catch (e: any) {
      setError(e.message || "Error al subir el archivo");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!pending) {
      setError("Genera o sube un QR antes de guardar");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Si fue generado, guardar el archivo en media vía el backend
      let fileMediaId = pending.fileMediaId;
      if (pending.source === "generated") {
        const mime = pending.mimeType;
        const base64 = pending.url.split(",")[1];
        const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: mime });
        const file = new File([blob], pending.fileName, { type: mime });
        const uploaded = await qrAdminService.upload(file);
        fileMediaId = uploaded.mediaId;
      }

      await qrAdminService.saveConfig({
        fileMediaId,
        fileName: pending.fileName,
        mimeType: pending.mimeType,
        source: pending.source,
        text: text.trim() || null,
        decoded: (pending.decoded as Record<string, unknown>) ?? null,
        generation:
          pending.source === "generated"
            ? { format, size, errorCorrection, border }
            : null,
        enabled: true,
      });
      setSuccess("Configuración del QR guardada. Ya está disponible para la web.");
      await load();
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const isPdf = pending?.mimeType === "application/pdf" || (savedConfig?.mimeType === "application/pdf" && !pending);
  const previewUrl = pending?.url ?? (savedConfig?.url as string | undefined);

  return (
    <div>
      <h2 className="font-bold text-gray-900 mb-1">QR de pago — Bre-b</h2>
      <p className="text-xs text-gray-400 mb-5">
        El QR se genera desde el servicio QR Analyzer (conectado por el backend), a partir de la
        información extraída con /decode. Puedes subir un QR (imagen o PDF) o generarlo.
      </p>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</div>}
      {success && <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 flex items-center gap-2"><Check size={14} /> {success}</div>}

      {/* Estado del servicio */}
      <div className="flex items-center gap-2 mb-5 text-xs">
        {loadingStatus ? (
          <span className="text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Consultando servicio QR...</span>
        ) : serviceStatus?.available ? (
          <span className="flex items-center gap-1.5 text-green-600 font-semibold">
            <span className="w-2 h-2 rounded-full bg-green-500" /> Servicio QR Analyzer disponible
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-red-500 font-semibold">
            <AlertTriangle size={13} /> Servicio QR Analyzer no disponible
            <span className="text-gray-400 font-normal">({String(serviceStatus?.detail ?? "")})</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Generar */}
        <div className="border border-gray-100 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Wand2 size={15} className="text-purple-500" /> Generar QR
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Contenido del QR *</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="https://mercaldas.com.co/pago?ref=1234"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Formato</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as "png" | "pdf")} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white">
                <option value="png">PNG (imagen)</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Tamaño (px)</label>
              <input type="number" value={size} onChange={(e) => setSize(parseInt(e.target.value) || 400)} min={100} max={4096} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Corrección</label>
              <select value={errorCorrection} onChange={(e) => setErrorCorrection(e.target.value as "L" | "M" | "Q" | "H")} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white">
                <option value="L">L — 7%</option>
                <option value="M">M — 15%</option>
                <option value="Q">Q — 25%</option>
                <option value="H">H — 30%</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Borde</label>
              <input type="number" value={border} onChange={(e) => setBorder(parseInt(e.target.value) || 4)} min={0} max={40} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" />
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 rounded-xl transition-colors"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {generating ? "Generando..." : "Generar QR"}
          </button>
        </div>

        {/* Subir */}
        <div className="border border-gray-100 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Upload size={15} className="text-blue-500" /> Subir QR existente (imagen o PDF)
          </div>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-amber-300 transition-colors"
          >
            <QrCode size={28} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-600 font-medium">Haz clic para seleccionar</p>
            <p className="text-xs text-gray-400 mt-1">PNG · JPG · WebP · PDF (máx. 10 MB)</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = "";
              }}
            />
          </div>
          {uploading && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Subiendo y decodificando (vía /decode)...
            </p>
          )}
          <div className="text-xs text-gray-400 space-y-1">
            <p>Al subir, el backend:</p>
            <p>1. Guarda el archivo (imagen o PDF).</p>
            <p>2. Lo decodifica con el servicio /decode y rellena el contenido.</p>
          </div>
        </div>
      </div>

      {/* Vista previa */}
      {previewUrl && (
        <div className="mt-6 border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
            <Image size={15} className="text-amber-500" /> Vista previa
            <span className="text-xs font-normal text-gray-400 ml-1">
              ({isPdf ? "PDF" : "Imagen"} · {pending ? (pending.source === "generated" ? "generado" : "subido") : "guardado"})
            </span>
          </div>
          <div className="flex items-center gap-6">
            {isPdf ? (
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <FileText size={32} className="text-red-400" />
                <a href={previewUrl} download="qr-pago.pdf" className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-gray-100 hover:bg-gray-200 rounded-xl">
                  <FileDown size={13} /> Descargar PDF
                </a>
              </div>
            ) : (
              <img src={previewUrl} alt="QR" className="w-40 h-40 rounded-xl border border-gray-100" />
            )}
            <div className="text-xs text-gray-400 space-y-1">
              <p>
                <strong className="text-gray-600">Contenido:</strong>{" "}
                <span className="font-mono break-all">
                  {text || String(savedConfig?.text ?? "")}
                </span>
              </p>
              {pending?.decoded ? (
                <p>
                  <strong className="text-gray-600">Detectado:</strong>{" "}
                  {JSON.stringify(pending.decoded, null, 2).slice(0, 200)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Configuración guardada */}
      {savedConfig && !pending && (
        <div className="mt-4 text-xs text-gray-400">
          Última configuración guardada: {String(savedConfig.fileName ?? "—")} · fuente:{" "}
          {String(savedConfig.source ?? "—")} · {savedConfig.updatedAt ? `actualizado ${String(savedConfig.updatedAt).slice(0, 19).replace("T", " ")}` : ""}
        </div>
      )}

      {/* Guardar */}
      <div className="flex justify-end mt-6 pt-6 border-t border-gray-100">
        <button
          onClick={handleSave}
          disabled={saving || !pending}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 disabled:opacity-40 rounded-xl transition-colors"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? "Guardando..." : "Guardar configuración del QR"}
        </button>
      </div>
    </div>
  );
}
