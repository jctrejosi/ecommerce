import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Package,
  Globe,
  MapPin,
  Star,
  Loader2,
} from "lucide-react";
import { catalogService, CatalogProduct } from "../services/catalog.service";
import { BrandEditorPanel, type AdminBrand } from "../components/BrandEditorPanel";
import { apiFetch, API_BASE_URL } from "../lib/api";

interface LandingBrandRow {
  id: number;
  code: string | null;
  name: string;
  isActive: boolean;
  selected: boolean;
}

export default function Brands() {
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "todas" | "activas" | "inactivas"
  >("todas");

  // Marca en edición/creación ("new" cuando se está creando)
  const [editorOpen, setEditorOpen] = useState<"new" | AdminBrand | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<AdminBrand | null>(null);

  // Unbranded products
  const [unbranded, setUnbranded] = useState<CatalogProduct[]>([]);
  const [unbrandedLoading, setUnbrandedLoading] = useState(false);
  const [unbrandedSearch, setUnbrandedSearch] = useState("");
  const [unbrandedOffset, setUnbrandedOffset] = useState(0);
  const [unbrandedHasMore, setUnbrandedHasMore] = useState(true);
  const [unbrandedTotal, setUnbrandedTotal] = useState(0);
  const unbrandedSentinelRef = useRef<HTMLDivElement>(null);

  // Assign brand modal
  const [assignProductId, setAssignProductId] = useState<number | null>(null);
  const [assignBrandId, setAssignBrandId] = useState("");
  const [assignBrandSearch, setAssignBrandSearch] = useState("");
  const [assignBrandDropdownOpen, setAssignBrandDropdownOpen] = useState(false);

  // Selección de marcas para la landing (por id de marca)
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [savingSelection, setSavingSelection] = useState(false);
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const loadUnbranded = async (reset = false) => {
    setUnbrandedLoading(true);
    const offset = reset ? 0 : unbrandedOffset;
    try {
      const [countData, data] = await Promise.all([
        catalogService.getUnbrandedCount(),
        catalogService.getUnbrandedProducts(
          offset,
          20,
          unbrandedSearch || undefined,
        ),
      ]);
      if (reset) {
        setUnbrandedTotal(countData.total);
        setUnbranded(data);
        setUnbrandedOffset(20);
      } else {
        setUnbranded((prev) => [...prev, ...data]);
        setUnbrandedOffset(offset + 20);
      }
      setUnbrandedHasMore(data.length === 20);
    } catch {
      if (reset) setUnbranded([]);
    }
    setUnbrandedLoading(false);
  };

  // Load unbranded on mount
  useEffect(() => {
    loadUnbranded(true);
  }, []);

  // Infinite scroll for unbranded
  useEffect(() => {
    if (!unbrandedHasMore || unbrandedLoading) return;
    const el = unbrandedSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadUnbranded(false);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [unbrandedHasMore, unbrandedLoading]);

  // Debounce search for unbranded
  useEffect(() => {
    if (!unbrandedSearch) {
      loadUnbranded(true);
      return;
    }
    const timer = setTimeout(() => loadUnbranded(true), 400);
    return () => clearTimeout(timer);
  }, [unbrandedSearch]);

  const assignBrandToProduct = async () => {
    if (!assignProductId || !assignBrandId) return;
    try {
      await catalogService.addProductToBrand(
        Number(assignBrandId),
        assignProductId,
      );
      setAssignProductId(null);
      setAssignBrandId("");
      await Promise.all([loadBrands(), loadUnbranded(true)]);
    } catch {}
  };

  const loadBrands = useCallback(async () => {
    try {
      setLoading(true);
      const data = await catalogService.getBrandsAdmin();
      setBrands(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBrands();
  }, [loadBrands]);

  // ── Landing: selección y visibilidad ──
  const loadLanding = useCallback(async () => {
    try {
      const rows = await apiFetch<LandingBrandRow[]>(`${API_BASE_URL}/admin/landing/brands`);
      const map: Record<number, boolean> = {};
      for (const r of rows) map[r.id] = r.selected;
      setSelected(map);
      setSelectionDirty(false);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    loadLanding();
  }, [loadLanding]);

  const toggleSelected = (id: number) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
    setSelectionDirty(true);
  };

  const saveSelection = async () => {
    setSavingSelection(true);
    try {
      const codes = brands
        .filter((b) => selected[b.id] && b.code)
        .map((b) => b.code as string);
      await apiFetch(`${API_BASE_URL}/admin/landing/brands`, {
        method: "PUT",
        body: JSON.stringify({ codes }),
      });
      setSelectionDirty(false);
    } catch {
      /* silent */
    } finally {
      setSavingSelection(false);
    }
  };

  const toggleActive = async (b: AdminBrand) => {
    const next = !b.isActive;
    setBrands((prev) => prev.map((x) => (x.id === b.id ? { ...x, isActive: next } : x)));
    try {
      await apiFetch(`${API_BASE_URL}/admin/landing/brands/${b.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      setBrands((prev) => prev.map((x) => (x.id === b.id ? { ...x, isActive: b.isActive } : x)));
    }
  };

  const batchSelected = async (isActive: boolean) => {
    const targets = brands.filter((b) => selected[b.id]);
    if (targets.length === 0) return;
    setBatchBusy(true);
    try {
      for (const b of targets) {
        await apiFetch(`${API_BASE_URL}/admin/landing/brands/${b.id}/active`, {
          method: "PATCH",
          body: JSON.stringify({ isActive }),
        });
        setBrands((prev) => prev.map((x) => (x.id === b.id ? { ...x, isActive } : x)));
      }
    } catch {
      /* silent */
    } finally {
      setBatchBusy(false);
    }
  };

  const selectableBrands = brands.filter((b) => b.code);
  const allSelected =
    selectableBrands.length > 0 && selectableBrands.every((b) => selected[b.id]);
  const selectedCount = selectableBrands.filter((b) => selected[b.id]).length;
  const toggleSelectAll = () => {
    const next: Record<number, boolean> = {};
    for (const b of selectableBrands) next[b.id] = !allSelected;
    setSelected(next);
    setSelectionDirty(true);
  };

  // ── Debounced search ──
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = brands.filter((b) => {
    const matchesSearch = b.name
      .toLowerCase()
      .includes(debouncedSearch.toLowerCase());
    const matchesStatus =
      statusFilter === "todas" ||
      (statusFilter === "activas" && b.isActive) ||
      (statusFilter === "inactivas" && !b.isActive);
    return matchesSearch && matchesStatus;
  });

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    await catalogService.deleteBrand(deleteConfirm.id);
    setDeleteConfirm(null);
    await loadBrands();
  };

  return (
    <div className="p-6 space-y-5 relative">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marcas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {brands.length} marcas · {brands.filter((b) => b.isActive).length} visibles · {selectedCount} en la landing
          </p>
        </div>
        <button
          onClick={() => setEditorOpen("new")}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all hover:brightness-95"
          style={{ background: "#FFF200", color: "#1A1A2E" }}
        >
          <Plus size={15} /> Nueva marca
        </button>
      </div>

      {/* Search + filtro de estado */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar marca..."
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
          />
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
          {(["todas", "activas", "inactivas"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                statusFilter === opt
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {opt === "todas" ? "Todas" : opt === "activas" ? "Activas" : "Inactivas"}
            </button>
          ))}
        </div>
      </div>

      {/* Landing: selección + acciones por lote */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-3.5 h-3.5 rounded border-gray-300 text-amber-500" />
          Seleccionar todas
        </label>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <>
              <span className="text-[11px] font-semibold text-amber-700">{selectedCount} seleccionada{selectedCount !== 1 ? "s" : ""}</span>
              <button onClick={() => batchSelected(true)} disabled={batchBusy} className="px-2.5 py-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50">Activar</button>
              <button onClick={() => batchSelected(false)} disabled={batchBusy} className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 disabled:opacity-50">Inactivar</button>
            </>
          )}
          <button
            onClick={saveSelection}
            disabled={savingSelection || !selectionDirty}
            title="Guardar qué marcas se muestran en la landing"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg disabled:opacity-50"
          >
            {savingSelection && <Loader2 size={12} className="animate-spin" />}
            Guardar selección
          </button>
        </div>
      </div>

      {/* Brand Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse"
            >
              <div className="w-12 h-12 rounded-xl bg-gray-100 mb-3" />
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((b) => (
            <div
              key={b.id}
              className={`bg-white rounded-2xl border p-5 hover:shadow-md transition-shadow group cursor-pointer ${
                !b.isActive ? "opacity-60" : ""
              }`}
              style={{ borderColor: b.isFeatured ? "#FFF200" : "#E5E7EB" }}
              onClick={() => setEditorOpen(b)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  {b.code && (
                    <input
                      type="checkbox"
                      checked={!!selected[b.id]}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelected(b.id)}
                      title="Mostrar en la landing"
                      className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-300 cursor-pointer shrink-0"
                    />
                  )}
                  <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center overflow-hidden">
                    {b.image ? (
                      <img
                        src={b.image}
                        alt={b.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl select-none opacity-40">
                        {b.name.charAt(0)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {b.isFeatured && (
                    <Star size={12} className="text-amber-400" fill="#FACC15" />
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditorOpen(b);
                    }}
                  >
                    <Edit size={13} />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(b);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <h3 className="font-bold text-gray-900">{b.name}</h3>
              {b.code && (
                <p className="text-[11px] font-mono text-gray-400 mt-0.5">
                  #{b.code}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                {b.country && (
                  <>
                    <MapPin size={10} />
                    {b.country}
                  </>
                )}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <Package size={12} className="text-gray-400" />
                <span className="text-xs text-gray-500">
                  {b.productCount} producto{b.productCount !== 1 ? "s" : ""}
                </span>
                {b.website && (
                  <a
                    href={`https://${b.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-gray-300 hover:text-gray-500 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Globe size={12} />
                  </a>
                )}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                <span className={`text-xs font-semibold ${b.isActive ? "text-green-600" : "text-gray-400"}`}>
                  {b.isActive ? "Visible" : "Oculta"}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleActive(b); }}
                  title={b.isActive ? "Ocultar en la landing" : "Mostrar en la landing"}
                  className="flex items-center gap-1.5"
                >
                  <span className={`relative w-9 h-5 rounded-full transition-colors ${b.isActive ? "bg-green-500" : "bg-gray-300"}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${b.isActive ? "translate-x-4" : "translate-x-0"}`} />
                  </span>
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="col-span-full text-center py-12 text-sm text-gray-400">
              No se encontraron marcas
            </div>
          )}
        </div>
      )}

      {/* ── Unbranded Products ── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-gray-400" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Productos sin marca
            </p>
          </div>
          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
            {unbrandedTotal}
          </span>
        </div>
        <div className="px-4 py-3 border-b border-gray-50">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={unbrandedSearch}
              onChange={(e) => setUnbrandedSearch(e.target.value)}
              placeholder="Buscar productos sin marca..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>
        {unbrandedLoading && unbranded.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-amber-400 rounded-full animate-spin" />
          </div>
        ) : unbranded.length === 0 && !unbrandedLoading ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-400">
              Todos los productos tienen marca asignada
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {unbranded.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  setAssignProductId(p.id);
                  setAssignBrandId("");
                  setAssignBrandSearch("");
                  setAssignBrandDropdownOpen(false);
                }}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                  {p.image ? (
                    <img
                      src={p.image}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package size={14} className="text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">
                    {p.name}
                  </p>
                  {p.productTypeCode && (
                    <p className="text-[10px] text-gray-400">
                      {p.productTypeCode}
                    </p>
                  )}
                </div>
              </div>
            ))}
            <div ref={unbrandedSentinelRef} className="h-4" />
            {unbrandedLoading && unbranded.length > 0 && (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-amber-400 rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assign brand modal */}
      {assignProductId !== null && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[60]"
            onClick={() => setAssignProductId(null)}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5">
              <h4 className="font-bold text-sm text-gray-900 mb-4">
                Asignar marca a producto
              </h4>
              <div className="relative mb-4">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <input
                  value={assignBrandSearch}
                  onChange={(e) => {
                    setAssignBrandSearch(e.target.value);
                    setAssignBrandDropdownOpen(true);
                  }}
                  onFocus={() => setAssignBrandDropdownOpen(true)}
                  placeholder="Buscar marca..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                  autoFocus
                />
                {assignBrandDropdownOpen && (
                  <div
                    className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {brands
                      .filter((b) =>
                        b.name
                          .toLowerCase()
                          .includes(assignBrandSearch.toLowerCase()),
                      )
                      .map((b) => (
                        <button
                          key={b.id}
                          onClick={() => {
                            setAssignBrandId(String(b.id));
                            setAssignBrandSearch(b.name);
                            setAssignBrandDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                            String(b.id) === assignBrandId
                              ? "bg-amber-50 font-semibold"
                              : ""
                          }`}
                        >
                          {b.name}
                        </button>
                      ))}
                    {brands.filter((b) =>
                      b.name
                        .toLowerCase()
                        .includes(assignBrandSearch.toLowerCase()),
                    ).length === 0 && (
                      <p className="px-3 py-4 text-xs text-gray-400 text-center">
                        No se encontraron marcas
                      </p>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={assignBrandToProduct}
                disabled={!assignBrandId}
                className="w-full py-2 rounded-xl text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 transition-colors disabled:opacity-50"
              >
                Asignar marca
              </button>
            </div>
          </div>
        </>
      )}


      {/* ── Editor de marca (drawer compartido) ── */}
      {editorOpen !== null && (
        <BrandEditorPanel
          creating={editorOpen === "new"}
          brand={editorOpen === "new" ? null : editorOpen}
          onClose={() => setEditorOpen(null)}
          onSaved={loadBrands}
          onRequestDelete={(b) => setDeleteConfirm(b)}
        />
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDeleteConfirm(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Eliminar marca</h3>
                <p className="text-xs text-gray-500">{deleteConfirm.name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              ¿Estás seguro? Esta acción no se puede deshacer. Los productos
              asociados a esta marca quedarán sin marca.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2 rounded-xl text-sm font-bold bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
