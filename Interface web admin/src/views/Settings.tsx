import { resolveApiBaseUrl } from "../lib/api";
import { useState, useEffect } from "react";
import { Save, Loader2, CheckCircle } from "lucide-react";

const API_BASE = resolveApiBaseUrl();

// Prefijos telefónicos conocidos (los más largos primero para no cortar de más).
const KNOWN_PHONE_PREFIXES = [
  "+591", "+593", "+595", "+598", "+351",
  "+57", "+52", "+51", "+54", "+56", "+58", "+55", "+34", "+44", "+49", "+33", "+39", "+1",
];

// Separa el WhatsApp guardado ("+57 3001234567" o "+573001234567") en prefijo y número.
function splitWhatsapp(raw: string): { prefix: string; number: string } {
  const value = String(raw || "").trim();
  if (!value) return { prefix: "+57", number: "" };

  const spaced = value.match(/^(\+\d{1,4})\s+(.+)$/);
  if (spaced) return { prefix: spaced[1], number: spaced[2].trim() };

  const prefix = KNOWN_PHONE_PREFIXES.find((p) => value.startsWith(p));
  if (prefix) return { prefix, number: value.slice(prefix.length).trim() };

  if (value.startsWith("+")) {
    const m = value.match(/^(\+\d{1,3})(\d{6,})$/);
    if (m) return { prefix: m[1], number: m[2] };
  }

  return { prefix: "+57", number: value };
}

function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      <div className="shrink-0 ml-8">{children}</div>
    </div>
  );
}

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button onClick={() => setOn(!on)} className={`w-11 h-6 rounded-full relative transition-all ${on ? "bg-amber-400" : "bg-gray-200"}`}>
      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${on ? "right-1" : "left-1"}`} />
    </button>
  );
}

export default function SettingsView() {
  // General settings: store fields
  const [storeName, setStoreName] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState("COP");
  const [timezone, setTimezone] = useState("America/Bogota");
  const [phone, setPhone] = useState("");
  const [whatsappPrefix, setWhatsappPrefix] = useState("+57");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/admin/settings/store`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setStoreName(d.tradeName || "");
        setDomain(d.primaryDomain || "");
        setEmail(d.email || "");
        setCurrency(d.currencyCode || "COP");
        setTimezone(d.timezone || "America/Bogota");
        setPhone(d.phone || "");
        {
          const { prefix, number } = splitWhatsapp(d.whatsapp || "");
          setWhatsappPrefix(prefix);
          setWhatsappNumber(number);
        }
        setAddress(d.address || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/admin/settings/store`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeName: storeName,
          primaryDomain: domain,
          email,
          currencyCode: currency,
          timezone,
          phone,
          whatsapp: [whatsappPrefix.trim(), whatsappNumber.trim()]
            .filter(Boolean)
            .join(" "),
          address,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    finally { setSaving(false); }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-sm text-gray-500 mt-0.5">Ajustes generales de la tienda</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-3xl">
        <div className="space-y-0">
          <h2 className="font-bold text-gray-900 mb-5">Configuración General</h2>
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-amber-500" /></div>
          ) : (
            <>
              <SettingRow label="Nombre de la tienda" sub="Visible en el encabezado y facturas">
                <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 w-72" />
              </SettingRow>
              <SettingRow label="Sitio web" sub="URL del frontend público">
                <input value={domain} onChange={(e) => setDomain(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 w-72 font-mono" />
              </SettingRow>
              <SettingRow label="Email de contacto">
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 w-72" />
              </SettingRow>
              <SettingRow label="Teléfono">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 w-72" />
              </SettingRow>
              <SettingRow label="WhatsApp">
                <div className="flex items-center gap-2">
                  <input
                    value={whatsappPrefix}
                    onChange={(e) => setWhatsappPrefix(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 w-20 text-center"
                    placeholder="+57"
                  />
                  <input
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 w-52"
                    placeholder="3001234567"
                  />
                </div>
              </SettingRow>
              <SettingRow label="Dirección">
                <input value={address} onChange={(e) => setAddress(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 w-72" />
              </SettingRow>
              <SettingRow label="Moneda" sub="Moneda principal del catálogo">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white w-72">
                  <option value="COP">COP — Peso colombiano</option>
                  <option value="USD">USD — Dólar</option>
                </select>
              </SettingRow>
              <SettingRow label="Zona horaria">
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white w-72">
                  <option value="America/Bogota">America/Bogota (UTC-5)</option>
                  <option value="America/Mexico_City">America/Mexico City (UTC-6)</option>
                  <option value="America/Lima">America/Lima (UTC-5)</option>
                </select>
              </SettingRow>
              <SettingRow label="Modo mantenimiento" sub="Muestra página de mantenimiento en el sitio">
                <Toggle defaultOn={false} />
              </SettingRow>
            </>
          )}
        </div>

        <div className="flex justify-end mt-6 pt-6 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} /> : <Save size={14} />}
            {saved ? "Guardado" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
