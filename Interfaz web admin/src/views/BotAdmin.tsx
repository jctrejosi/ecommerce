import { useEffect, useState } from "react";
import { Bot, Save, CheckCircle2 } from "lucide-react";
import { botService, type BotFunction } from "../services/bot.service";

export default function BotAdmin() {
  const [functions, setFunctions] = useState<BotFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await botService.getFunctions();
      setFunctions(data.functions);
    } catch {
      setError("No se pudieron cargar las funciones del bot.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = (name: string) => {
    setFunctions((prev) =>
      prev.map((f) => (f.name === name ? { ...f, enabled: !f.enabled } : f)),
    );
    setSaved(false);
  };

  const save = async () => {
    const map = Object.fromEntries(functions.map((f) => [f.name, f.enabled]));
    setSaving(true);
    setError(null);
    try {
      await botService.updateFunctions(map);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = functions.filter((f) => f.enabled).length;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bot size={22} className="text-gray-400" />
            Bot de compras
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Activa o desactiva las funciones disponibles del asistente.
            {enabledCount > 0 && (
              <span className="ml-1 text-gray-400">
                ({enabledCount} de {functions.length} habilitadas)
              </span>
            )}
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || loading || functions.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all hover:brightness-95 disabled:opacity-50"
          style={{ background: "#FFF200", color: "#1A1A2E" }}
        >
          <Save size={15} />
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>

      {saved && (
        <div className="flex items-center gap-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
          <CheckCircle2 size={16} />
          Cambios guardados correctamente.
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {error}
        </div>
      )}

      {/* Lista de funciones */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse"
            >
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {functions.map((f) => (
            <div key={f.name} className="flex items-center gap-4 p-5">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{f.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{f.description}</p>
                <p className="text-[11px] font-mono text-gray-300 mt-1">
                  {f.name}
                </p>
              </div>
              {/* Toggle */}
              <button
                onClick={() => toggle(f.name)}
                role="switch"
                aria-checked={f.enabled}
                aria-label={`Activar ${f.label}`}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  f.enabled ? "bg-green-500" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    f.enabled ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                  style={{ left: 0 }}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
