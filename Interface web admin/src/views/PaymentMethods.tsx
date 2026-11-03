import { resolveApiBaseUrl } from "../lib/api";
import { useState, useEffect, useRef } from "react";

const API_BASE = resolveApiBaseUrl();

export default function PaymentMethodsView() {
  const [payMethods, setPayMethods] = useState<any>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState("");
  const payMethodsRef = useRef<any>(null);

  const loadPaymentMethods = () => {
    setPayLoading(true);
    fetch(`${API_BASE}/admin/settings/payment-methods`, { credentials: "include" })
      .then((r) => r.json())
      .then(setPayMethods)
      .catch(() => {})
      .finally(() => setPayLoading(false));
  };

  useEffect(() => {
    loadPaymentMethods();
  }, []);

  // Mantiene una referencia al valor actual para los handlers que guardan
  // sobre el último estado.
  useEffect(() => {
    payMethodsRef.current = payMethods;
  }, [payMethods]);

  /**
   * Guarda los medios de pago con actualización optimista y revierte si el
   * backend rechaza el cambio (la validación automática responde 400).
   */
  const persistPaymentMethods = async (updated: any, prev: any) => {
    setPayMethods(updated);
    payMethodsRef.current = updated;
    setPayError("");
    try {
      const res = await fetch(`${API_BASE}/admin/settings/payment-methods`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = Array.isArray(data?.message)
          ? data.message.join(" ")
          : data?.message || "No se pudo guardar el medio de pago.";
        setPayError(msg);
        setPayMethods(prev);
        payMethodsRef.current = prev;
      }
    } catch {
      setPayError("No se pudo contactar el servidor. Revisa tu conexión.");
      setPayMethods(prev);
      payMethodsRef.current = prev;
    }
  };

  // Consulta al backend si el servicio QR Analyzer está disponible
  const checkQrService = () => {
    fetch(`${API_BASE}/admin/qr/status`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setQrServiceAvailable(d?.available === true))
      .catch(() => setQrServiceAvailable(false));
  };

  const toggleWompi = () => {
    const prev = payMethodsRef.current;
    if (!prev) return;
    const updated = { ...prev, wompi: { ...prev.wompi, enabled: !prev.wompi?.enabled } };
    void persistPaymentMethods(updated, prev);
  };

  const toggleWompiMethod = (method: string) => {
    const prev = payMethodsRef.current;
    if (!prev) return;
    const updated = {
      ...prev,
      wompi: { ...prev.wompi, methods: { ...prev.wompi?.methods, [method]: !prev.wompi?.methods?.[method] } },
    };
    void persistPaymentMethods(updated, prev);
  };

  const toggleBreb = () => {
    const prev = payMethodsRef.current;
    if (!prev) return;
    const updated = { ...prev, breb: { ...prev.breb, enabled: !prev.breb?.enabled } };
    void persistPaymentMethods(updated, prev);
  };

  const updateBrebField = (field: string, value: string) => {
    const prev = payMethodsRef.current;
    if (!prev) return;
    const updated = { ...prev, breb: { ...prev.breb, [field]: value } };
    void persistPaymentMethods(updated, prev);
  };

  const toggleEfectivo = () => {
    const prev = payMethodsRef.current;
    if (!prev) return;
    const updated = { ...prev, efectivo: { ...prev.efectivo, enabled: !prev.efectivo?.enabled } };
    void persistPaymentMethods(updated, prev);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Métodos de pago</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Medios de pago disponibles en la tienda
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-3xl">
        {payError && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-red-800">
                No se pudo guardar el medio de pago
              </p>
              <p className="text-xs text-red-700 mt-0.5">{payError}</p>
            </div>
            <button
              type="button"
              onClick={() => setPayError("")}
              className="text-xs font-semibold text-red-700 hover:text-red-900"
            >
              Cerrar
            </button>
          </div>
        )}
        {qrServiceAvailable === false && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-amber-800">
                Servicio QR Analyzer no disponible temporalmente
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                No se pueden subir ni generar nuevos QRs hasta que el servicio
                vuelva a estar en línea. El QR actual guardado se sigue mostrando
                en la tienda sin cambios.
              </p>
              <button
                type="button"
                onClick={checkQrService}
                className="mt-2 text-xs font-semibold text-amber-800 underline hover:text-amber-900"
              >
                Reintentar conexión
              </button>
            </div>
          </div>
        )}
        {!payMethods && payLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-amber-500" /></div>
        ) : (
          <div className="space-y-3">
            {/* Efectivo contra entrega */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Efectivo contra entrega</p>
                  <p className="text-xs text-gray-400">Pago en efectivo al recibir el pedido</p>
                </div>
                <button onClick={toggleEfectivo} className={`w-11 h-6 rounded-full relative transition-all ${payMethods?.efectivo?.enabled ? "bg-green-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${payMethods?.efectivo?.enabled ? "right-1" : "left-1"}`} />
                </button>
              </div>
            </div>

            {/* Wompi */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Wompi</p>
                  <p className="text-xs text-gray-400">Tarjetas, PSE, Nequi</p>
                </div>
                <button onClick={toggleWompi} className={`w-11 h-6 rounded-full relative transition-all ${payMethods?.wompi?.enabled ? "bg-green-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${payMethods?.wompi?.enabled ? "right-1" : "left-1"}`} />
                </button>
              </div>
              {payMethods?.wompi?.enabled && (
                <div className="space-y-2 pl-2 border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-600">Tarjeta de Crédito / Débito</span>
                    <button onClick={() => toggleWompiMethod("card")} className={`w-11 h-6 rounded-full relative transition-all ${payMethods?.wompi?.methods?.card ? "bg-green-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${payMethods?.wompi?.methods?.card ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-600">PSE (Transferencia bancaria)</span>
                    <button onClick={() => toggleWompiMethod("pse")} className={`w-11 h-6 rounded-full relative transition-all ${payMethods?.wompi?.methods?.pse ? "bg-green-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${payMethods?.wompi?.methods?.pse ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-600">Nequi</span>
                    <button onClick={() => toggleWompiMethod("nequi")} className={`w-11 h-6 rounded-full relative transition-all ${payMethods?.wompi?.methods?.nequi ? "bg-green-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${payMethods?.wompi?.methods?.nequi ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bre-B */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Bre-B</p>
                  <p className="text-xs text-gray-400">Transferencia entre bancos</p>
                </div>
                <button onClick={toggleBreb} className={`w-11 h-6 rounded-full relative transition-all ${payMethods?.breb?.enabled ? "bg-green-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${payMethods?.breb?.enabled ? "right-1" : "left-1"}`} />
                </button>
              </div>
              {payMethods?.breb?.enabled && (
                <div className="space-y-3 pl-2 border-t border-gray-100 pt-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                      Llave Bre-B
                    </label>
                    <input
                      value={payMethods?.breb?.key ?? ""}
                      onChange={(e) => updateBrebField("key", e.target.value)}
                      placeholder="@davi3148853458"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                      Banco
                    </label>
                    <input
                      value={payMethods?.breb?.bank ?? ""}
                      onChange={(e) => updateBrebField("bank", e.target.value)}
                      placeholder="Davivienda"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2">Los cambios se reflejan en los medios de pago de la tienda.</p>
          </div>
        )}
      </div>
    </div>
  );
}
