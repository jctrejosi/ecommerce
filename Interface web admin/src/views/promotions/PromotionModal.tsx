import { useEffect, useState } from "react";
import { X, Loader2, Plus, Trash2, Search, Check } from "lucide-react";
import {
  promotionsService,
  type Promotion,
  type CreatePromotionData,
  type DiscountType,
  type PromotionComboMode,
} from "../../services/promotions.service";
import {
  catalogService,
  type CatalogCategory,
  type CatalogProduct,
} from "../../services/catalog.service";
import { branchesService, type Branch } from "../../services/branches.service";
import { couponsService } from "../../services/coupons.service";

const DISCOUNT_TYPES: { id: DiscountType; label: string; icon: string }[] = [
  { id: "porcentaje", label: "% Descuento", icon: "%" },
  { id: "fijo", label: "Monto fijo", icon: "$" },
  { id: "cupon", label: "Cupón", icon: "🎟️" },
];

const WEEKDAYS = [
  { value: 1, label: "L" },
  { value: 2, label: "M" },
  { value: 3, label: "X" },
  { value: 4, label: "J" },
  { value: 5, label: "V" },
  { value: 6, label: "S" },
  { value: 0, label: "D" },
];

function formatCurrency(n: number): string {
  return "$" + n.toLocaleString("es-CO");
}

function toLocalDatetime(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

type ProductDraft = {
  productId: number;
  name: string;
  discountValue: string;
  isPercentage: boolean;
};

type ComboItemDraft = {
  productId: number;
  name: string;
  discountValue: string;
  isPercentage: boolean;
};

type ComboDraft = {
  key: number;
  name: string;
  mode: PromotionComboMode;
  quantityRequired: number;
  discountValue: string;
  isPercentage: boolean;
  items: ComboItemDraft[];
};

// ── Buscador de productos ──

function ProductPicker({
  onPick,
  excludedIds,
  placeholder,
}: {
  onPick: (product: CatalogProduct) => void;
  excludedIds: number[];
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await catalogService.getProducts({
          search: search.trim() || undefined,
          limit: 12,
        });
        if (!cancelled) setResults(list);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="relative">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder ?? "Buscar producto..."}
          className="w-full pl-8 pr-3 py-2 text-xs focus:outline-none"
        />
        {loading && (
          <Loader2
            size={13}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin"
          />
        )}
      </div>
      {search.trim() !== "" && (
        <div className="max-h-40 overflow-y-auto border-t border-gray-100 divide-y divide-gray-50">
          {results.length === 0 && !loading ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
          ) : (
            results.map((product) => {
              const disabled = excludedIds.includes(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onPick(product);
                    setSearch("");
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-amber-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="text-xs text-gray-700 truncate">
                    {product.name}
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">
                    {formatCurrency(product.price)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal de creación / edición ──

export function PromotionModal({
  promotion,
  onClose,
  onSaved,
}: {
  promotion: Promotion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!promotion;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(promotion?.name ?? "");
  const [description, setDescription] = useState(promotion?.description ?? "");
  const [discountType, setDiscountType] = useState<DiscountType>(
    promotion?.discountType ?? "porcentaje",
  );
  const [discountValue, setDiscountValue] = useState(
    promotion?.discountValue ? String(Number(promotion.discountValue)) : "",
  );
  const [maximumDiscount, setMaximumDiscount] = useState(
    promotion?.maximumDiscount ? String(Number(promotion.maximumDiscount)) : "",
  );
  const [weekdays, setWeekdays] = useState<number[]>(promotion?.weekdays ?? []);
  const [couponCode, setCouponCode] = useState(promotion?.couponCode ?? "");
  const [maxUsesTotal, setMaxUsesTotal] = useState(
    promotion?.couponMaxUsesTotal?.toString() ?? "",
  );
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState(
    promotion?.couponMaxUsesPerCustomer?.toString() ?? "1",
  );
  const [usageLimit, setUsageLimit] = useState(
    promotion?.usageLimit?.toString() ?? "",
  );
  const [startDate, setStartDate] = useState(
    toLocalDatetime(promotion?.startDate ?? new Date().toISOString()),
  );
  const [endDate, setEndDate] = useState(
    toLocalDatetime(
      promotion?.endDate ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );
  const [isActive, setIsActive] = useState(promotion?.isActive ?? true);
  const [priority, setPriority] = useState(
    promotion?.priority?.toString() ?? "0",
  );

  // ── Alcance ──
  const initialHasTargets =
    !!promotion?.categoryIds?.length ||
    !!promotion?.products?.length ||
    !!promotion?.combos?.length;
  const [scope, setScope] = useState<"all" | "targeted">(
    initialHasTargets ? "targeted" : "all",
  );
  const [categoryIds, setCategoryIds] = useState<number[]>(
    promotion?.categoryIds ?? [],
  );
  const [branchIds, setBranchIds] = useState<number[]>(
    promotion?.branchIds ?? [],
  );
  const [products, setProducts] = useState<ProductDraft[]>(
    (promotion?.products ?? []).map((p) => ({
      productId: p.productId,
      name: p.name,
      discountValue: p.discountValue ? String(Number(p.discountValue)) : "",
      isPercentage: p.isPercentage ?? true,
    })),
  );
  const [comboKeySeed, setComboKeySeed] = useState(1);
  const [combos, setCombos] = useState<ComboDraft[]>(
    (promotion?.combos ?? []).map((c, index) => ({
      key: index + 1,
      name: c.name ?? "",
      mode: c.mode,
      quantityRequired: c.quantityRequired,
      discountValue: c.discountValue ? String(Number(c.discountValue)) : "",
      isPercentage: c.isPercentage,
      items: c.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        discountValue: item.discountValue
          ? String(Number(item.discountValue))
          : "",
        isPercentage: item.isPercentage,
      })),
    })),
  );

  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showBranchPicker, setShowBranchPicker] = useState(false);

  useEffect(() => {
    catalogService
      .getCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    branchesService
      .getAll()
      .then((list) => setBranches(list.filter((b) => b.isActive !== false)))
      .catch(() => setBranches([]));
  }, []);

  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(categorySearch.trim().toLowerCase()),
  );

  const regenerateCouponCode = async () => {
    setGeneratingCode(true);
    try {
      const result = await couponsService.generateCode();
      setCouponCode(result.code);
    } catch {
      /* se conserva el código actual */
    } finally {
      setGeneratingCode(false);
    }
  };

  useEffect(() => {
    if (discountType === "cupon" && !couponCode) {
      void regenerateCouponCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountType]);

  const toggleWeekday = (value: number) => {
    setWeekdays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value],
    );
  };

  const addProduct = (product: CatalogProduct) => {
    setProducts((prev) =>
      prev.some((p) => p.productId === product.id)
        ? prev
        : [
            ...prev,
            {
              productId: product.id,
              name: product.name,
              discountValue: "",
              isPercentage: true,
            },
          ],
    );
  };

  const addCombo = () => {
    setCombos((prev) => [
      ...prev,
      {
        key: comboKeySeed,
        name: "",
        mode: "same_discount",
        quantityRequired: 2,
        discountValue: "",
        isPercentage: true,
        items: [],
      },
    ]);
    setComboKeySeed((k) => k + 1);
  };

  const updateCombo = (key: number, patch: Partial<ComboDraft>) => {
    setCombos((prev) =>
      prev.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    );
  };

  const addComboItem = (key: number, product: CatalogProduct) => {
    setCombos((prev) =>
      prev.map((c) =>
        c.key === key
          ? c.items.some((i) => i.productId === product.id)
            ? c
            : {
                ...c,
                items: [
                  ...c.items,
                  {
                    productId: product.id,
                    name: product.name,
                    discountValue: "",
                    isPercentage: true,
                  },
                ],
              }
          : c,
      ),
    );
  };

  const handleSave = async () => {
    const numericDiscount = parseNumber(discountValue);
    if (!name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (numericDiscount === undefined || numericDiscount <= 0) {
      setError("Ingresa un valor de descuento válido");
      return;
    }
    if (discountType === "porcentaje" && numericDiscount > 100) {
      setError("El porcentaje no puede superar 100");
      return;
    }
    if (discountType === "cupon" && !couponCode.trim()) {
      setError("El código de cupón es obligatorio");
      return;
    }
    if (!startDate || !endDate) {
      setError("Las fechas de inicio y fin son obligatorias");
      return;
    }
    if (new Date(endDate) <= new Date(startDate)) {
      setError("La fecha de fin debe ser posterior a la de inicio");
      return;
    }
    for (const combo of combos) {
      if (combo.items.length < 2) {
        setError("Cada combo debe tener al menos 2 productos");
        return;
      }
      if (combo.mode === "same_discount" && !parseNumber(combo.discountValue)) {
        setError("Cada combo necesita un descuento");
        return;
      }
      if (
        combo.mode === "per_product" &&
        combo.items.some(
          (item) => parseNumber(item.discountValue) === undefined,
        )
      ) {
        setError("Asigna un descuento a cada producto del combo");
        return;
      }
    }

    setError("");
    setSaving(true);
    try {
      const targeted = scope === "targeted";
      const data: CreatePromotionData = {
        name: name.trim(),
        description: description.trim() || undefined,
        discountType,
        discountValue: numericDiscount,
        maximumDiscount: parseNumber(maximumDiscount),
        weekdays,
        categoryIds: targeted ? categoryIds : [],
        branchIds,
        products: targeted
          ? products.map((p) => ({
              productId: p.productId,
              discountValue: parseNumber(p.discountValue),
              isPercentage: p.isPercentage,
            }))
          : [],
        combos: targeted
          ? combos.map((c) => ({
              name: c.name.trim() || undefined,
              mode: c.mode,
              quantityRequired: Math.max(2, c.quantityRequired),
              discountValue: parseNumber(c.discountValue) ?? 0,
              isPercentage: c.isPercentage,
              items: c.items.map((item) => ({
                productId: item.productId,
                discountValue: parseNumber(item.discountValue) ?? 0,
                isPercentage: item.isPercentage,
              })),
            }))
          : [],
        couponCode:
          discountType === "cupon"
            ? couponCode.trim().toUpperCase()
            : undefined,
        maxUsesTotal: maxUsesTotal ? parseInt(maxUsesTotal) : undefined,
        maxUsesPerCustomer: parseInt(maxUsesPerCustomer) || 1,
        usageLimit: usageLimit ? parseInt(usageLimit) : undefined,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        isActive,
        priority: parseInt(priority) || 0,
      };

      if (isEdit && promotion) {
        await promotionsService.update(promotion.id, data);
      } else {
        await promotionsService.create(data);
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || "Error al guardar la promoción");
    } finally {
      setSaving(false);
    }
  };

  const valuePrefix = discountType === "porcentaje" ? "%" : "$";
  const valuePlaceholder = discountType === "porcentaje" ? "20" : "10000";
  const targetedCount = categoryIds.length + products.length + combos.length;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-3xl bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">
            {isEdit ? "Editar Promoción" : "Nueva Promoción"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          {/* Nombre + descripción */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Nombre de la promoción *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
                placeholder="Ej: Lunes de frutas"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Descripción
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                placeholder="Descripción opcional..."
              />
            </div>
          </div>

          {/* Tipo de descuento base */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">
              Tipo de descuento base
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DISCOUNT_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDiscountType(t.id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                    discountType === t.id
                      ? "border-amber-400 bg-amber-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <span className="text-lg">{t.icon}</span>
                  <span className="text-xs font-medium text-gray-600">
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Valor + cupón */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Valor del descuento base *
              </label>
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-amber-300">
                <span className="px-3 py-2.5 text-sm text-gray-500 bg-gray-50 border-r border-gray-200">
                  {valuePrefix}
                </span>
                <input
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  inputMode="decimal"
                  className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                  placeholder={valuePlaceholder}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Tope de descuento (opcional)
              </label>
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-amber-300">
                <span className="px-3 py-2.5 text-sm text-gray-500 bg-gray-50 border-r border-gray-200">
                  $
                </span>
                <input
                  value={maximumDiscount}
                  onChange={(e) => setMaximumDiscount(e.target.value)}
                  inputMode="decimal"
                  className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                  placeholder="Sin tope"
                />
              </div>
            </div>
          </div>

          {discountType === "cupon" && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Código del cupón (autogenerado)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    value={couponCode}
                    readOnly
                    className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 font-mono text-gray-700"
                    placeholder="Generando..."
                  />
                  <button
                    type="button"
                    onClick={regenerateCouponCode}
                    disabled={generatingCode}
                    className="px-3 py-2.5 text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 rounded-xl"
                    title="Generar otro código"
                  >
                    {generatingCode ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      "Regenerar"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (couponCode) {
                        void navigator.clipboard.writeText(couponCode);
                      }
                    }}
                    className="px-3 py-2.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl"
                    title="Copiar código"
                  >
                    Copiar
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Máx. usos totales
                </label>
                <input
                  value={maxUsesTotal}
                  onChange={(e) =>
                    setMaxUsesTotal(e.target.value.replace(/\D/g, ""))
                  }
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
                  placeholder="Sin límite"
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
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
                  placeholder="1"
                />
              </div>
            </div>
          )}

          {/* Días de la semana */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">
              Días de la semana
            </label>
            <div className="flex items-center gap-2">
              {WEEKDAYS.map((day) => {
                const active = weekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleWeekday(day.value)}
                    className={`w-9 h-9 rounded-full text-xs font-bold border transition-all ${
                      active
                        ? "bg-amber-400 border-amber-400 text-amber-900"
                        : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {weekdays.length === 0
                ? "Sin selección = todos los días."
                : "La promoción solo aplicará los días marcados."}
            </p>
          </div>

          {/* Alcance */}
          <div className="border border-gray-200 rounded-2xl p-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">
                Alcance de la promoción
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`px-3 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${
                    scope === "all"
                      ? "border-amber-400 bg-amber-50 text-amber-900"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  Todo el catálogo
                </button>
                <button
                  type="button"
                  onClick={() => setScope("targeted")}
                  className={`px-3 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${
                    scope === "targeted"
                      ? "border-amber-400 bg-amber-50 text-amber-900"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  Categorías, productos o combos
                  {scope === "targeted" && targetedCount > 0 && (
                    <span className="ml-1 text-amber-600">
                      ({targetedCount})
                    </span>
                  )}
                </button>
              </div>
            </div>

            {scope === "targeted" && (
              <div className="space-y-4">
                {/* Categorías */}
                <div className="rounded-xl bg-gray-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">
                      Categorías
                      {categoryIds.length > 0 && (
                        <span className="ml-1 text-amber-600">
                          ({categoryIds.length})
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCategoryPicker((v) => !v)}
                      className="text-xs font-semibold text-amber-600 hover:text-amber-700"
                    >
                      {showCategoryPicker ? "Cerrar" : "Seleccionar"}
                    </button>
                  </div>

                  {categoryIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {categoryIds.map((id) => {
                        const cat = categories.find((c) => c.id === id);
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-900 text-[11px] font-medium"
                          >
                            {cat?.name ?? `Categoría ${id}`}
                            <button
                              type="button"
                              onClick={() =>
                                setCategoryIds((prev) =>
                                  prev.filter((c) => c !== id),
                                )
                              }
                              className="text-amber-700 hover:text-amber-900"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {showCategoryPicker && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search
                          size={12}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                          value={categorySearch}
                          onChange={(e) => setCategorySearch(e.target.value)}
                          placeholder="Buscar categoría..."
                          className="w-full pl-7 pr-2 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none"
                        />
                      </div>
                      <div className="max-h-44 overflow-y-auto bg-white border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {filteredCategories.map((cat) => {
                          const selected = categoryIds.includes(cat.id);
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() =>
                                setCategoryIds((prev) =>
                                  selected
                                    ? prev.filter((c) => c !== cat.id)
                                    : [...prev, cat.id],
                                )
                              }
                              className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-amber-50"
                            >
                              <span className="text-gray-700">{cat.name}</span>
                              <span className="flex items-center gap-2 text-gray-400">
                                {cat.count}
                                {selected && (
                                  <Check size={12} className="text-amber-500" />
                                )}
                              </span>
                            </button>
                          );
                        })}
                        {filteredCategories.length === 0 && (
                          <p className="px-3 py-2 text-xs text-gray-400">
                            Sin categorías
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Productos con descuento propio */}
                <div className="rounded-xl bg-gray-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">
                      Productos específicos
                      {products.length > 0 && (
                        <span className="ml-1 text-amber-600">
                          ({products.length})
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Deja el descuento vacío para usar el descuento base. Si lo
                    llenas, ese producto tendrá su propio descuento.
                  </p>

                  <ProductPicker
                    onPick={addProduct}
                    excludedIds={products.map((p) => p.productId)}
                  />

                  {products.length > 0 && (
                    <div className="space-y-1.5">
                      {products.map((product) => (
                        <div
                          key={product.productId}
                          className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5 border border-gray-100"
                        >
                          <span className="flex-1 text-xs text-gray-700 truncate">
                            {product.name}
                          </span>
                          <select
                            value={product.isPercentage ? "%" : "$"}
                            onChange={(e) =>
                              setProducts((prev) =>
                                prev.map((p) =>
                                  p.productId === product.productId
                                    ? {
                                        ...p,
                                        isPercentage: e.target.value === "%",
                                      }
                                    : p,
                                ),
                              )
                            }
                            className="text-[11px] border border-gray-200 rounded-md px-1 py-0.5 bg-white"
                          >
                            <option value="%">%</option>
                            <option value="$">$</option>
                          </select>
                          <input
                            value={product.discountValue}
                            onChange={(e) =>
                              setProducts((prev) =>
                                prev.map((p) =>
                                  p.productId === product.productId
                                    ? { ...p, discountValue: e.target.value }
                                    : p,
                                ),
                              )
                            }
                            inputMode="decimal"
                            placeholder="Base"
                            className="w-16 px-2 py-0.5 text-xs border border-gray-200 rounded-md focus:outline-none text-right"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setProducts((prev) =>
                                prev.filter(
                                  (p) => p.productId !== product.productId,
                                ),
                              )
                            }
                            className="text-gray-300 hover:text-red-500"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Combos */}
                <div className="rounded-xl bg-gray-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">
                      Combos (productos que van juntos)
                    </span>
                    <button
                      type="button"
                      onClick={addCombo}
                      className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700"
                    >
                      <Plus size={12} /> Añadir combo
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    El descuento aplica cuando los productos del combo están
                    juntos en el carrito. Puedes usar el mismo descuento para
                    todos o uno distinto por producto.
                  </p>

                  {combos.map((combo) => (
                    <div
                      key={combo.key}
                      className="bg-white rounded-xl border border-gray-100 p-3 space-y-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          value={combo.name}
                          onChange={(e) =>
                            updateCombo(combo.key, { name: e.target.value })
                          }
                          placeholder="Nombre del combo (opcional)"
                          className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCombos((prev) =>
                              prev.filter((c) => c.key !== combo.key),
                            )
                          }
                          className="text-gray-300 hover:text-red-500"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateCombo(combo.key, { mode: "same_discount" })
                          }
                          className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium ${
                            combo.mode === "same_discount"
                              ? "border-amber-400 bg-amber-50 text-amber-900"
                              : "border-gray-200 text-gray-500"
                          }`}
                        >
                          Mismo descuento
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateCombo(combo.key, { mode: "per_product" })
                          }
                          className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium ${
                            combo.mode === "per_product"
                              ? "border-amber-400 bg-amber-50 text-amber-900"
                              : "border-gray-200 text-gray-500"
                          }`}
                        >
                          Descuento por producto
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {combo.mode === "same_discount" && (
                          <>
                            <select
                              value={combo.isPercentage ? "%" : "$"}
                              onChange={(e) =>
                                updateCombo(combo.key, {
                                  isPercentage: e.target.value === "%",
                                })
                              }
                              className="text-[11px] border border-gray-200 rounded-md px-1 py-1 bg-white"
                            >
                              <option value="%">%</option>
                              <option value="$">$</option>
                            </select>
                            <input
                              value={combo.discountValue}
                              onChange={(e) =>
                                updateCombo(combo.key, {
                                  discountValue: e.target.value,
                                })
                              }
                              inputMode="decimal"
                              placeholder="Descuento"
                              className="w-20 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none text-right"
                            />
                          </>
                        )}
                        <label className="text-[11px] text-gray-400 ml-auto flex items-center gap-1">
                          Cantidad requerida
                          <input
                            value={combo.quantityRequired}
                            onChange={(e) =>
                              updateCombo(combo.key, {
                                quantityRequired: Math.max(
                                  2,
                                  parseInt(e.target.value) || 2,
                                ),
                              })
                            }
                            className="w-12 px-1.5 py-0.5 text-xs border border-gray-200 rounded-md text-center focus:outline-none"
                          />
                        </label>
                      </div>

                      <ProductPicker
                        onPick={(product) => addComboItem(combo.key, product)}
                        excludedIds={combo.items.map((i) => i.productId)}
                        placeholder="Añadir producto al combo..."
                      />

                      {combo.items.length > 0 && (
                        <div className="space-y-1.5">
                          {combo.items.map((item) => (
                            <div
                              key={item.productId}
                              className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5"
                            >
                              <span className="flex-1 text-xs text-gray-700 truncate">
                                {item.name}
                              </span>
                              {combo.mode === "per_product" && (
                                <>
                                  <select
                                    value={item.isPercentage ? "%" : "$"}
                                    onChange={(e) =>
                                      setCombos((prev) =>
                                        prev.map((c) =>
                                          c.key === combo.key
                                            ? {
                                                ...c,
                                                items: c.items.map((i) =>
                                                  i.productId === item.productId
                                                    ? {
                                                        ...i,
                                                        isPercentage:
                                                          e.target.value ===
                                                          "%",
                                                      }
                                                    : i,
                                                ),
                                              }
                                            : c,
                                        ),
                                      )
                                    }
                                    className="text-[11px] border border-gray-200 rounded-md px-1 py-0.5 bg-white"
                                  >
                                    <option value="%">%</option>
                                    <option value="$">$</option>
                                  </select>
                                  <input
                                    value={item.discountValue}
                                    onChange={(e) =>
                                      setCombos((prev) =>
                                        prev.map((c) =>
                                          c.key === combo.key
                                            ? {
                                                ...c,
                                                items: c.items.map((i) =>
                                                  i.productId === item.productId
                                                    ? {
                                                        ...i,
                                                        discountValue:
                                                          e.target.value,
                                                      }
                                                    : i,
                                                ),
                                              }
                                            : c,
                                        ),
                                      )
                                    }
                                    inputMode="decimal"
                                    placeholder="0"
                                    className="w-16 px-2 py-0.5 text-xs border border-gray-200 rounded-md focus:outline-none text-right"
                                  />
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setCombos((prev) =>
                                    prev.map((c) =>
                                      c.key === combo.key
                                        ? {
                                            ...c,
                                            items: c.items.filter(
                                              (i) =>
                                                i.productId !== item.productId,
                                            ),
                                          }
                                        : c,
                                    ),
                                  )
                                }
                                className="text-gray-300 hover:text-red-500"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sucursales */}
          <div className="border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-semibold text-gray-600">
                  Sucursales
                  {branchIds.length > 0 && (
                    <span className="ml-1 text-amber-600">
                      ({branchIds.length})
                    </span>
                  )}
                </label>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Sin selección = aplica en todas las sucursales.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBranchPicker((v) => !v)}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700"
              >
                {showBranchPicker ? "Cerrar" : "Seleccionar"}
              </button>
            </div>

            {branchIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {branchIds.map((id) => {
                  const branch = branches.find((b) => b.id === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-900 text-[11px] font-medium"
                    >
                      {branch?.name ?? `Sucursal ${id}`}
                      <button
                        type="button"
                        onClick={() =>
                          setBranchIds((prev) => prev.filter((b) => b !== id))
                        }
                        className="text-amber-700 hover:text-amber-900"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {showBranchPicker && (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
                {branches.map((branch) => {
                  const selected = branchIds.includes(branch.id);
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() =>
                        setBranchIds((prev) =>
                          selected
                            ? prev.filter((b) => b !== branch.id)
                            : [...prev, branch.id],
                        )
                      }
                      className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-amber-50"
                    >
                      <span className="text-gray-700">
                        {branch.name}
                        <span className="ml-2 text-[10px] text-gray-400">
                          {branch.code}
                        </span>
                      </span>
                      {selected && (
                        <Check size={12} className="text-amber-500" />
                      )}
                    </button>
                  );
                })}
                {branches.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    No hay sucursales disponibles
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Límite de usos general */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Límite de usos de la promoción
            </label>
            <input
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value.replace(/\D/g, ""))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="Sin límite (vacío = ilimitado)"
            />
          </div>

          {/* Programación */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Fecha y hora de inicio *
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Fecha y hora de fin *
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
          </div>

          {/* Configuración */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-gray-600">
              Configuración adicional
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-300"
              />
              <span className="text-sm text-gray-700">Promoción activa</span>
            </label>

            <div className="flex items-center gap-4">
              <label className="text-xs text-gray-500 w-20">Prioridad</label>
              <input
                value={priority}
                onChange={(e) => setPriority(e.target.value.replace(/\D/g, ""))}
                className="w-20 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 text-center"
              />
              <span className="text-xs text-gray-400">
                Mayor número = más prioridad
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 sticky bottom-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? "Guardar cambios" : "Crear Promoción"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PromotionModal;
