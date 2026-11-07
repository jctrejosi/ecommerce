import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Loader2,
  X,
  Copy,
  Check,
  Ban,
  RotateCcw,
  Wallet,
  Ticket,
  History,
} from "lucide-react";
import {
  couponsService,
  type Coupon,
  type CouponKind,
  type CouponTransaction,
  type IssuedCoupon,
} from "../services/coupons.service";

const KIND_LABEL: Record<CouponKind, string> = {
  discount: "Descuento",
  balance: "Saldo",
  mixed: "Descuento + saldo",
};

const KIND_BADGE: Record<CouponKind, string> = {
  discount: "bg-blue-50 text-blue-700 border-blue-200",
  balance: "bg-emerald-50 text-emerald-700 border-emerald-200",
  mixed: "bg-purple-50 text-purple-700 border-purple-200",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  exhausted: "bg-gray-100 text-gray-500 border-gray-200",
  expired: "bg-red-50 text-red-600 border-red-200",
  blocked: "bg-amber-50 text-amber-700 border-amber-200",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  exhausted: "Agotado",
  expired: "Vencido",
  blocked: "Bloqueado",
};

function fmtMoney(value: string | number | null): string {
  if (value == null || value === "") return "—";
  return "$" + Number(value).toLocaleString("es-CO");
}

function fmtDate(value: string | null): string {
  if (!value) return "Sin vencimiento";
  return new Date(value).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard no disponible */
        }
      }}
      className="text-muted-foreground hover:text-foreground"
      title="Copiar código"
    >
      {copied ? (
        <Check size={13} className="text-green-600" />
      ) : (
        <Copy size={13} />
      )}
    </button>
  );
}

// ── Emitir cupón ──

function IssueCouponModal({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: () => void;
}) {
  const [kind, setKind] = useState<CouponKind>("discount");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">(
    "percentage",
  );
  const [discountValue, setDiscountValue] = useState("");
  const [initialBalance, setInitialBalance] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUsesTotal, setMaxUsesTotal] = useState("");
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedCoupon[] | null>(null);

  const hasDiscount = kind === "discount" || kind === "mixed";
  const hasBalance = kind === "balance" || kind === "mixed";

  const handleIssue = async () => {
    const discount = hasDiscount ? Number(discountValue.replace(",", ".")) : 0;
    const balance = hasBalance ? Number(initialBalance.replace(",", ".")) : 0;

    if (hasDiscount && (!discount || discount <= 0)) {
      setError("Ingresa un valor de descuento válido");
      return;
    }
    if (hasDiscount && discountType === "percentage" && discount > 100) {
      setError("El porcentaje no puede superar 100");
      return;
    }
    if (hasBalance && (!balance || balance <= 0)) {
      setError("Ingresa un saldo inicial válido");
      return;
    }

    setError("");
    setSaving(true);
    try {
      const result = await couponsService.issue({
        kind,
        discountType: hasDiscount ? discountType : undefined,
        discountValue: hasDiscount ? discount : undefined,
        initialBalance: hasBalance ? balance : undefined,
        quantity: Math.max(1, parseInt(quantity) || 1),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        maxUsesTotal: maxUsesTotal ? parseInt(maxUsesTotal) : undefined,
        maxUsesPerCustomer:
          hasDiscount && maxUsesPerCustomer
            ? parseInt(maxUsesPerCustomer)
            : undefined,
        notes: notes.trim() || undefined,
      });
      setIssued(result.coupons);
      onIssued();
    } catch (e: any) {
      setError(e.message || "No se pudieron emitir los cupones");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-900">
            {issued ? "Cupones emitidos" : "Emitir cupón"}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        {issued ? (
          <div className="p-5 space-y-3">
            <p className="text-xs text-gray-500">
              Guarda estos códigos: se muestran una sola vez completos.
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
              {issued.map((coupon) => (
                <div
                  key={coupon.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="font-mono text-sm font-semibold text-gray-800">
                    {coupon.code}
                  </span>
                  <div className="flex items-center gap-2">
                    {coupon.currentBalance != null && (
                      <span className="text-xs text-gray-400">
                        {fmtMoney(coupon.currentBalance)}
                      </span>
                    )}
                    <CopyButton text={coupon.code} />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-full py-2.5 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl"
            >
              Listo
            </button>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">
                  Tipo de cupón
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: "discount", label: "Descuento" },
                      { id: "balance", label: "Saldo" },
                      { id: "mixed", label: "Ambos" },
                    ] as { id: CouponKind; label: string }[]
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setKind(option.id)}
                      className={`px-2 py-2.5 rounded-xl border-2 text-xs font-semibold ${
                        kind === option.id
                          ? "border-amber-400 bg-amber-50 text-amber-900"
                          : "border-gray-200 text-gray-500"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {hasDiscount && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Tipo de descuento
                    </label>
                    <select
                      value={discountType}
                      onChange={(e) =>
                        setDiscountType(
                          e.target.value as "percentage" | "fixed",
                        )
                      }
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none"
                    >
                      <option value="percentage">Porcentaje (%)</option>
                      <option value="fixed">Monto fijo ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Valor
                    </label>
                    <input
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      inputMode="decimal"
                      placeholder={
                        discountType === "percentage" ? "15" : "5000"
                      }
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {hasBalance && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Saldo inicial
                  </label>
                  <input
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(e.target.value)}
                    inputMode="decimal"
                    placeholder="100000"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Cantidad a emitir
                  </label>
                  <input
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(e.target.value.replace(/\D/g, ""))
                    }
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none"
                    placeholder="1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Vencimiento
                  </label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              {hasDiscount && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Máx. usos totales
                    </label>
                    <input
                      value={maxUsesTotal}
                      onChange={(e) =>
                        setMaxUsesTotal(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="Sin límite"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Máx. usos por cliente
                    </label>
                    <input
                      value={maxUsesPerCustomer}
                      onChange={(e) =>
                        setMaxUsesPerCustomer(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="1"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Notas
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Campaña, lote, motivo..."
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none resize-none"
                />
              </div>

              <p className="text-[11px] text-gray-400">
                El código se genera automáticamente al emitir.
              </p>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleIssue}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Emitir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Movimientos ──

const TX_LABEL: Record<string, string> = {
  ISSUE: "Emisión",
  REDEEM: "Canje",
  REVERSAL: "Reverso",
  ADJUSTMENT: "Ajuste",
  EXPIRATION: "Vencimiento",
};

function TransactionsModal({
  coupon,
  onClose,
}: {
  coupon: Coupon;
  onClose: () => void;
}) {
  const [transactions, setTransactions] = useState<CouponTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    couponsService
      .getTransactions(coupon.id)
      .then(setTransactions)
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [coupon.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Movimientos</h3>
            <p className="text-xs font-mono text-gray-500 mt-0.5">
              {coupon.code}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              Sin movimientos
            </p>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-700">
                    {TX_LABEL[tx.type] ?? tx.type}
                    {tx.orderReference && (
                      <span className="ml-2 font-mono text-[11px] text-gray-400">
                        #{tx.orderReference}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {new Date(tx.createdAt).toLocaleString("es-CO")}
                    {tx.note ? ` · ${tx.note}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {Number(tx.discountAmount) > 0 && (
                    <p className="text-xs font-semibold text-blue-600">
                      Desc. {fmtMoney(tx.discountAmount)}
                    </p>
                  )}
                  {Number(tx.amount) > 0 && (
                    <p className="text-xs font-semibold text-emerald-600">
                      Saldo {fmtMoney(tx.amount)}
                    </p>
                  )}
                  {tx.balanceAfter != null && (
                    <p className="text-[11px] text-gray-400">
                      Queda {fmtMoney(tx.balanceAfter)}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vista principal ──

export default function Coupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [txCoupon, setTxCoupon] = useState<Coupon | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await couponsService.getAll({
        search: search || undefined,
        status: statusFilter || undefined,
        kind: kindFilter || undefined,
        limit: 100,
      });
      setCoupons(data.items);
      setTotal(data.total);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, kindFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleBlock = async (coupon: Coupon) => {
    try {
      await couponsService.update(coupon.id, {
        isActive: !coupon.isActive,
      });
      fetchData();
    } catch {
      /* se muestra el estado real al recargar */
    }
  };

  const activeCount = coupons.filter((c) => c.status === "active").length;
  const balanceTotal = coupons.reduce(
    (sum, c) => sum + (c.currentBalance ? Number(c.currentBalance) : 0),
    0,
  );

  return (
    <>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cupones</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {total} cupón{total === 1 ? "" : "es"} emitidos · código
              autogenerado
            </p>
          </div>
          <button
            onClick={() => setIssueOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl"
          >
            <Plus size={14} /> Emitir cupón
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
            <p className="text-2xl mb-1">🎟️</p>
            <p className="text-lg font-bold text-gray-900">{activeCount}</p>
            <p className="text-xs text-gray-500">Activos</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-2xl mb-1">💰</p>
            <p className="text-lg font-bold text-gray-900">
              {fmtMoney(balanceTotal)}
            </p>
            <p className="text-xs text-gray-500">Saldo disponible</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-2xl mb-1">⏳</p>
            <p className="text-lg font-bold text-gray-900">
              {coupons.filter((c) => c.status === "expired").length}
            </p>
            <p className="text-xs text-gray-500">Vencidos</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-xs flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código o nota..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white"
          >
            <option value="">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="exhausted">Agotados</option>
            <option value="expired">Vencidos</option>
            <option value="blocked">Bloqueados</option>
          </select>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white"
          >
            <option value="">Todos los tipos</option>
            <option value="discount">Descuento</option>
            <option value="balance">Saldo</option>
            <option value="mixed">Descuento + saldo</option>
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : coupons.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">
            No hay cupones emitidos
          </div>
        ) : (
          <div className="space-y-2">
            {coupons.map((coupon) => (
              <div
                key={coupon.id}
                className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4 hover:shadow-sm transition-shadow"
              >
                <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center shrink-0 text-amber-700">
                  {coupon.kind === "discount" ? (
                    <Ticket size={18} />
                  ) : (
                    <Wallet size={18} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-gray-900">
                      {coupon.code}
                    </span>
                    <CopyButton text={coupon.code} />
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${KIND_BADGE[coupon.kind]}`}
                    >
                      {KIND_LABEL[coupon.kind]}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[coupon.status] ?? STATUS_BADGE.active}`}
                    >
                      {STATUS_LABEL[coupon.status] ?? coupon.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-400 flex-wrap">
                    {coupon.discountValue && (
                      <span>
                        Descuento{" "}
                        {coupon.discountType === "fixed"
                          ? fmtMoney(coupon.discountValue)
                          : `${Number(coupon.discountValue)}%`}
                      </span>
                    )}
                    {coupon.currentBalance != null && (
                      <span>
                        Saldo {fmtMoney(coupon.currentBalance)}
                        {coupon.initialBalance
                          ? ` de ${fmtMoney(coupon.initialBalance)}`
                          : ""}
                      </span>
                    )}
                    <span>Vence: {fmtDate(coupon.expiresAt)}</span>
                    <span>
                      {coupon.timesUsed} uso{coupon.timesUsed === 1 ? "" : "s"}
                      {coupon.maxUsesTotal ? ` / ${coupon.maxUsesTotal}` : ""}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setTxCoupon(coupon)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                    title="Movimientos"
                  >
                    <History size={14} />
                  </button>
                  <button
                    onClick={() => toggleBlock(coupon)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg ${
                      coupon.isActive
                        ? "hover:bg-red-50 text-gray-400 hover:text-red-500"
                        : "hover:bg-green-50 text-gray-400 hover:text-green-600"
                    }`}
                    title={coupon.isActive ? "Bloquear" : "Reactivar"}
                  >
                    {coupon.isActive ? (
                      <Ban size={14} />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {issueOpen && (
        <IssueCouponModal
          onClose={() => setIssueOpen(false)}
          onIssued={fetchData}
        />
      )}

      {txCoupon && (
        <TransactionsModal
          coupon={txCoupon}
          onClose={() => setTxCoupon(null)}
        />
      )}
    </>
  );
}
