import { resolveApiBaseUrl } from "../lib/api";
import { useState, useEffect, useCallback, useRef, type ElementType, type ReactNode } from "react";
import {
  Plus, Edit, SquarePen, Trash2, X, Loader2, Filter, GripVertical,
  Image, Type, Palette, Link, Calendar, Eye, ChevronLeft, ChevronRight,
  LayoutTemplate, SlidersHorizontal, Zap, Truck, ShieldCheck, Clock, Megaphone,
  Search, Package, ArrowUp, ArrowDown, Check, Save, AlertTriangle, Tag, Store, Star,
} from "lucide-react";
import {
  bannersService,
  type Banner,
  type CreateBannerData,
} from "../services/banners.service";
import {
  featuredService,
  type FeaturedTab,
  type FeaturedProduct,
} from "../services/featured.service";
import { filtersService, type FilterConfig } from "../services/filters.service";
import { catalogService } from "../services/catalog.service";
import {
  ProductPicker,
  CategoryPicker,
  useAdminCategories,
  useProductOptions,
  type ProductOption,
  type AdminCategory,
} from "../components/TargetingPickers";

const STATUS_BADGE: Record<string, string> = {
  activo: "bg-green-50 text-green-700 border-green-200",
  programado: "bg-blue-50 text-blue-700 border-blue-200",
  inactivo: "bg-gray-100 text-gray-600 border-gray-200",
  expirado: "bg-red-50 text-red-600 border-red-200",
};

const STATUS_LABEL: Record<string, string> = {
  activo: "Activo",
  programado: "Programado",
  inactivo: "Inactivo",
  expirado: "Expirado",
};

// ── Filtro: editor ──

// Resumen legible de los criterios de un filtro.
function filterSummary(f: FilterConfig): string {
  const parts: string[] = [];
  if (f.categoryIds?.length)
    parts.push(`${f.categoryIds.length} categoría${f.categoryIds.length > 1 ? "s" : ""}`);
  if (f.productIds?.length)
    parts.push(`${f.productIds.length} producto${f.productIds.length > 1 ? "s" : ""}`);
  if (f.onSale) parts.push("En oferta");
  if (f.search) parts.push(`“${f.search}”`);
  if (f.sort) parts.push(`orden ${f.sort}`);
  if (f.brandId) parts.push("marca específica");
  if (f.productTypeCode) parts.push(`tipo ${f.productTypeCode}`);
  return parts.length ? parts.join(" · ") : "Sin criterios (abre todo el catálogo)";
}

// Editor de un filtro: categorías, productos, oferta, búsqueda y orden.
function FilterEditor({
  filter,
  onSaved,
  onCancel,
}: {
  filter: FilterConfig | null;
  onSaved: (f: FilterConfig) => void;
  onCancel: () => void;
}) {
  const isEdit = !!filter;
  const [name, setName] = useState(filter?.name ?? "");
  const [categoryIds, setCategoryIds] = useState<number[]>(filter?.categoryIds ?? []);
  const [onSale, setOnSale] = useState(filter?.onSale ?? false);
  const [sort, setSort] = useState(filter?.sort ?? "");
  const [search, setSearch] = useState(filter?.search ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const categories = useAdminCategories();
  const { products: selectedProducts, setProducts: setSelectedProducts } =
    useProductOptions(filter?.productIds ?? []);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        categoryIds,
        productIds: selectedProducts.map((p) => p.id),
        onSale,
        sort: sort || undefined,
        search: search.trim() || undefined,
        // Preserva criterios avanzados que no se editan en este formulario.
        brandId: filter?.brandId ?? null,
        productTypeCode: filter?.productTypeCode ?? undefined,
        priceMin: filter?.priceMin ?? undefined,
        priceMax: filter?.priceMax ?? undefined,
        isActive: filter?.isActive ?? true,
      };
      const saved =
        isEdit && filter
          ? await filtersService.update(filter.id, payload)
          : await filtersService.create(payload);
      onSaved(saved);
    } catch (e: any) {
      setError(e.message || "Error al guardar el filtro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
      <p className="text-xs font-semibold text-gray-700">
        {isEdit ? `Editar filtro: ${filter?.name}` : "Nuevo filtro"}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div>
        <label className="block text-[11px] font-semibold text-gray-500 mb-1">Nombre *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Ofertas de tecnología"
          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
      </div>

      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 mb-1">
            <Package size={11} /> Productos específicos (opcional)
          </label>
          <ProductPicker selected={selectedProducts} onChange={setSelectedProducts} />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 mb-1">
            <Tag size={11} /> Categorías (opcional)
          </label>
          <CategoryPicker categories={categories} selected={categoryIds} onChange={setCategoryIds} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Búsqueda (opcional)</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ej: nevera"
            className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Orden</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white"
          >
            <option value="">Por defecto</option>
            <option value="precio-asc">Precio ↑</option>
            <option value="precio-desc">Precio ↓</option>
            <option value="descuento">Descuento</option>
            <option value="relevancia">Relevancia</option>
            <option value="nombre">Nombre A–Z</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={onSale} onChange={(e) => setOnSale(e.target.checked)} className="w-3.5 h-3.5" />
        Solo productos en oferta
      </label>

      <p className="text-[11px] text-gray-400">
        Si eliges productos, el catálogo mostrará exactamente esos productos (en ese orden). Si además eliges categorías, se combinan ambos criterios.
      </p>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-amber-400 text-amber-900 rounded-lg hover:bg-amber-500 disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />} {isEdit ? "Guardar cambios" : "Crear filtro"}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
      </div>
    </div>
  );
}

// Persiste los criterios de un banner en un saved filter y devuelve su id.
// - Sin selección ⇒ null (desvincula el filtro del banner, sin borrarlo).
// - Con filtro existente ⇒ lo actualiza (conserva los criterios avanzados).
// - Sin filtro ⇒ crea uno nuevo.
async function persistBannerFilter(opts: {
  filterId: number | null;
  base?: Banner["filter"];
  name: string;
  categoryIds: number[];
  productIds: number[];
}): Promise<number | null> {
  const { filterId, base, name, categoryIds, productIds } = opts;
  const hasSelection = categoryIds.length > 0 || productIds.length > 0;
  if (!hasSelection) return null;

  const criteria = {
    categoryIds,
    productIds,
    onSale: base?.onSale ?? false,
    sort: base?.sort ?? undefined,
    search: base?.search ?? undefined,
    brandId: base?.brandId ?? null,
    productTypeCode: base?.productTypeCode ?? undefined,
    priceMin: base?.priceMin ?? undefined,
    priceMax: base?.priceMax ?? undefined,
  };

  if (filterId) {
    // No renombramos al editar: puede estar compartido con otros banners.
    const saved = await filtersService.update(filterId, criteria);
    return saved.id;
  }
  const created = await filtersService.create({
    name: (name.trim() || base?.name || "Filtro de banner").slice(0, 100),
    ...criteria,
  });
  return created.id;
}

// Sección reutilizable para los modales: elegir productos y/o categorías
// que se aplicarán como filtro al hacer clic en el banner.
function BannerTargetingSection({
  filter,
  categoryIds,
  setCategoryIds,
  productIds,
  setProductIds,
}: {
  filter?: Banner["filter"];
  categoryIds: number[];
  setCategoryIds: (v: number[]) => void;
  productIds: number[];
  setProductIds: (v: number[]) => void;
}) {
  const categories = useAdminCategories();
  const { products: selectedProducts, setProducts: setSelectedProducts } =
    useProductOptions(filter?.productIds ?? []);

  const handleProductsChange = (next: ProductOption[]) => {
    setSelectedProducts(next);
    setProductIds(next.map((p) => p.id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
        <Filter size={12} /> Productos y categorías
      </div>
      <p className="text-[11px] text-gray-400 -mt-2">
        Elige productos concretos y/o categorías. Al hacer clic en el botón del banner, el catálogo se abrirá filtrado por ellos. Si no eliges nada, el botón abre todo el catálogo.
      </p>
      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 mb-1">
            <Package size={11} /> Productos
          </label>
          <ProductPicker selected={selectedProducts} onChange={handleProductsChange} />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 mb-1">
            <Tag size={11} /> Categorías
          </label>
          <CategoryPicker categories={categories} selected={categoryIds} onChange={setCategoryIds} />
        </div>
      </div>
    </div>
  );
}

// Pestaña de filtros: asigna a cada slide qué catálogo abrir al hacer clic.
function SlideFiltersTab({
  slides,
  filters,
  onSaved,
}: {
  slides: Banner[];
  filters: FilterConfig[];
  onSaved: () => void;
}) {
  const [localFilters, setLocalFilters] = useState<FilterConfig[]>(filters);
  const [assignments, setAssignments] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    slides.forEach((s) => { map[s.id] = s.filterId?.toString() ?? ""; });
    return map;
  });
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ slideId: number; filter: FilterConfig | null } | null>(null);
  const [error, setError] = useState("");

  const sortedSlides = [...slides].sort((a, b) => a.position - b.position);
  const filterById = (id: string) => localFilters.find((f) => f.id.toString() === id) ?? null;

  const handleAssign = async (slideId: number) => {
    setSavingId(slideId);
    setError("");
    try {
      const value = assignments[slideId];
      await bannersService.update(slideId, {
        filterId: value ? parseInt(value) : null,
      } as any);
      onSaved();
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSavingId(null);
    }
  };

  const handleFilterSaved = (slideId: number, f: FilterConfig) => {
    setLocalFilters((prev) =>
      prev.some((x) => x.id === f.id)
        ? prev.map((x) => (x.id === f.id ? f : x))
        : [...prev, f],
    );
    setAssignments((prev) => ({ ...prev, [slideId]: f.id.toString() }));
    setEditor(null);
    // Auto-asigna el filtro al slide para que el clic ya funcione.
    void bannersService
      .update(slideId, { filterId: f.id } as any)
      .then(() => onSaved())
      .catch(() => {});
  };

  return (
    <div className="p-6 space-y-4">
      <p className="text-sm text-gray-500">
        Configura qué catálogo se abre al hacer clic en el botón de cada slide: productos concretos o una categoría completa.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {sortedSlides.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">No hay slides configurados.</div>
      ) : (
        <div className="space-y-4">
          {sortedSlides.map((s) => {
            const assignedId = assignments[s.id] ?? "";
            const assigned = filterById(assignedId);
            return (
              <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  {s.image && <img src={s.image} alt="" className="w-16 h-10 rounded-lg object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.title || <span className="underline decoration-dotted">Sin texto</span>}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">Botón: {s.ctaText || <span className="underline decoration-dotted">Sin texto</span>}</p>
                    {assigned && <p className="text-[11px] text-amber-700 mt-1">{filterSummary(assigned)}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={assignedId}
                    onChange={(e) => setAssignments((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                  >
                    <option value="">Sin filtro (abre todo el catálogo)</option>
                    {localFilters.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setEditor({ slideId: s.id, filter: assigned })}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
                  >
                    {assigned ? <SquarePen size={11} /> : <Plus size={11} />} {assigned ? "Editar" : "Nuevo"}
                  </button>
                  <button
                    onClick={() => handleAssign(s.id)}
                    disabled={savingId === s.id}
                    className="shrink-0 px-3 py-2 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50"
                  >
                    {savingId === s.id ? <Loader2 size={12} className="animate-spin" /> : "Guardar"}
                  </button>
                </div>

                {editor?.slideId === s.id && (
                  <div className="mt-3">
                    <FilterEditor
                      filter={editor.filter}
                      onSaved={(f) => handleFilterSaved(s.id, f)}
                      onCancel={() => setEditor(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Slide Editor (nested in Content tab) ──
function SlideEditor({
  slide,
  onClose,
  onSaved,
}: {
  slide: Banner | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!slide;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState(slide?.title ?? "");
  const [subtitle, setSubtitle] = useState(slide?.subtitle ?? "");
  const [description, setDescription] = useState(slide?.description ?? "");
  const [imageUrl, setImageUrl] = useState(slide?.image ?? "");
  const [mobileImageUrl, setMobileImageUrl] = useState(slide?.mobileImage ?? "");
  const [ctaText, setCtaText] = useState(slide?.ctaText ?? "");
  const [bgColor, setBgColor] = useState(slide?.bgColor ?? "#1A1A2E");
  const [accentColor, setAccentColor] = useState(slide?.accentColor ?? "#FFF200");
  const [position, setPosition] = useState(slide?.position?.toString() ?? "0");
  const [isActive, setIsActive] = useState(slide?.isActive ?? true);
  const [startDate, setStartDate] = useState(slide?.startDate ? new Date(slide.startDate).toISOString().slice(0, 16) : "");
  const [endDate, setEndDate] = useState(slide?.endDate ? new Date(slide.endDate).toISOString().slice(0, 16) : "");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingMobileFile, setPendingMobileFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categoryIds, setCategoryIds] = useState<number[]>(slide?.filter?.categoryIds ?? []);
  const [productIds, setProductIds] = useState<number[]>(slide?.filter?.productIds ?? []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, mobile: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (mobile) {
      setPendingMobileFile(file);
      setMobileImageUrl(URL.createObjectURL(file));
    } else {
      setPendingFile(file);
      setImageUrl(URL.createObjectURL(file));
    }
  };

  const uploadFile = async (file: File): Promise<{ url: string; mediaType: string } | null> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("code", `hero_${Date.now()}`);
    const res = await fetch(
      `${resolveApiBaseUrl()}/upload/image`,
      { method: "POST", body: fd },
    );
    if (!res.ok) throw new Error("Error al subir imagen");
    const data = await res.json();
    return { url: data.url, mediaType: data.mediaType || "image/webp" };
  };

  const handleSave = async () => {
    if (!imageUrl.trim()) { setError("La imagen es obligatoria"); return; }
    setError(""); setSaving(true);
    try {
      let finalImageUrl = imageUrl.trim();
      let finalMobileUrl = mobileImageUrl.trim();
      if (pendingFile) { const u = await uploadFile(pendingFile); if (u) finalImageUrl = u.url; }
      if (pendingMobileFile) { const u = await uploadFile(pendingMobileFile); if (u) finalMobileUrl = u.url; }
      const imageMediaId = await createMediaFromUrl(finalImageUrl);
      const mobileMediaId = finalMobileUrl ? await createMediaFromUrl(finalMobileUrl) : undefined;
      const filterId = await persistBannerFilter({
        filterId: slide?.filterId ?? null,
        base: slide?.filter,
        name: title.trim() || "Filtro de banner",
        categoryIds,
        productIds,
      });
      const data: CreateBannerData = {
        title: title.trim(),
        subtitle: subtitle.trim(),
        description: description.trim(),
        mediaId: imageMediaId,
        mobileImageId: mobileMediaId,
        bannerType: "hero",
        ctaText: ctaText.trim(),
        bgColor: bgColor.trim() || undefined,
        accentColor: accentColor.trim() || undefined,
        position: parseInt(position) || 0,
        isActive,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        filterId,
      };
      if (isEdit && slide) await bannersService.update(slide.id, data);
      else await bannersService.create(data);
      onSaved();
    } catch (e: any) { setError(e.message || "Error al guardar"); }
    finally { setSaving(false); setUploading(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-3xl bg-white flex flex-col shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">{isEdit ? "Editar Slide" : "Nuevo Slide"}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-5">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</div>}

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Type size={12} /> Contenido</div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Título * <span className="text-gray-400 font-normal">— \\n para salto de línea</span></label>
              <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none" placeholder="Frutas y Verduras\nFrescas del Día" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Slogan / Subtítulo</label>
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" placeholder="Directo de los mejores cultivadores" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Descripción</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none" placeholder="Texto adicional..." />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Image size={12} /> Imágenes</div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Imagen escritorio *</label>
              <div className="flex items-center gap-2">
                <input value={imageUrl} onChange={(e) => { setImageUrl(e.target.value); setPendingFile(null); }} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono" placeholder="https://... o sube una imagen" />
                <label className="px-3 py-2.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl cursor-pointer shrink-0 transition-colors">
                  {pendingFile ? "✓ Imagen lista" : "Subir archivo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileSelect(e, false)} />
                </label>
              </div>
              {imageUrl && <div className="mt-2 rounded-xl overflow-hidden bg-gray-100 h-28"><img src={imageUrl} alt="" className="w-full h-full object-cover" /></div>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Imagen móvil</label>
              <div className="flex items-center gap-2">
                <input value={mobileImageUrl} onChange={(e) => { setMobileImageUrl(e.target.value); setPendingMobileFile(null); }} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono" placeholder="https://... o sube una imagen" />
                <label className="px-3 py-2.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl cursor-pointer shrink-0 transition-colors">
                  {pendingMobileFile ? "✓ Imagen lista" : "Subir archivo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileSelect(e, true)} />
                </label>
              </div>
              {mobileImageUrl && <div className="mt-2 rounded-xl overflow-hidden bg-gray-100 h-24"><img src={mobileImageUrl} alt="" className="w-full h-full object-cover" /></div>}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Palette size={12} /> Apariencia</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Color de fondo</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border" />
                  <input value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Color de acento</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border" />
                  <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono" />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Link size={12} /> Botón</div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Texto del botón</label>
              <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" placeholder="Ver Frutas y Verduras" />
            </div>
          </div>

          <BannerTargetingSection
            filter={slide?.filter}
            categoryIds={categoryIds}
            setCategoryIds={setCategoryIds}
            productIds={productIds}
            setProductIds={setProductIds}
          />

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Calendar size={12} /> Programación</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Posición</label>
                <input type="number" value={position} onChange={(e) => setPosition(e.target.value)} min={0} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" />
              </div>
              <div className="flex items-end pb-0.5">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-amber-500" />
                  <span className="text-sm text-gray-700">Activo</span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Inicio</label><input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Fin</label><input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helper ──
async function createMediaFromUrl(url: string, mediaType?: string): Promise<number> {
  const API_BASE_URL = resolveApiBaseUrl();
  const res = await fetch(`${API_BASE_URL}/admin/banners/upload-url`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, mediaType }),
  });
  if (!res.ok) throw new Error("Error al crear media");
  return (await res.json()).mediaId;
}

// ── Main Carousel Manager Modal ──
function CarouselManager({
  slides,
  filters,
  onSaved,
}: {
  slides: Banner[];
  filters: FilterConfig[];
  onSaved: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"contenido" | "filtros">("contenido");
  const [slideEditor, setSlideEditor] = useState<Banner | null | "new">(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Banner | null>(null);

  const sortedSlides = [...slides].sort((a, b) => a.position - b.position);

  const handleDeleteSlide = async () => {
    if (!deleteConfirm) return;
    try { await bannersService.remove(deleteConfirm.id); setDeleteConfirm(null); onSaved(); }
    catch (e) { console.error(e); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select]:cursor-pointer [&_label]:cursor-pointer">
        {/* Header with tabs */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveTab("contenido")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === "contenido" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <LayoutTemplate size={13} /> Contenido
              </button>
              <button
                onClick={() => setActiveTab("filtros")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === "filtros" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <SlidersHorizontal size={13} /> Filtros
              </button>
            </div>
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "contenido" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
              <p className="text-sm text-gray-500">{sortedSlides.length} slides · ordenados por posición</p>
              <button
                onClick={() => setSlideEditor("new")}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors"
              >
                <Plus size={13} /> Añadir slide
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              {sortedSlides.length === 0 ? (
                <div className="text-center py-16 text-sm text-gray-400">
                  <Image size={32} className="mx-auto text-gray-300 mb-3" />
                  No hay slides. Añade el primero con el botón de arriba.
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedSlides.map((s) => (
                    <div key={s.id} onClick={() => setSlideEditor(s)} className="relative rounded-xl overflow-hidden group cursor-pointer" style={{ background: s.bgColor || "#1A1A2E", minHeight: "160px" }}>
                      {/* Background image */}
                      {s.image && (
                        <div className="absolute right-0 top-0 h-full w-2/5">
                          <img src={s.image} alt="" className="w-full h-full object-cover opacity-35" />
                          <div className="absolute inset-0" style={{ background: `linear-gradient(to right, ${s.bgColor || "#1A1A2E"} 0%, transparent 70%)` }} />
                        </div>
                      )}

                      {/* Content */}
                      <div className="relative z-10 p-6 max-w-lg">
                        <span
                          className="inline-block text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full mb-4"
                          style={{ background: s.accentColor || "#FFF200", color: s.bgColor || "#1A1A2E" }}
                        >
                          {s.subtitle || <span className="underline decoration-dotted">Sin texto</span>}
                        </span>
                        <h3 className="font-black text-xl md:text-2xl text-white whitespace-pre-line leading-tight mb-2">
                          {s.title || <span className="underline decoration-dotted">Sin texto</span>}
                        </h3>
                        <p className="text-xs md:text-sm mb-5 max-w-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
                          {s.description || <span className="underline decoration-dotted">Sin texto</span>}
                        </p>
                        <span
                          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold"
                          style={{ background: s.accentColor || "#FFF200", color: s.bgColor || "#1A1A2E" }}
                        >
                          {s.ctaText || <span className="underline decoration-dotted">Sin texto</span>}
                          <ChevronRight size={13} />
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20" onClick={(e) => e.stopPropagation()}>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${STATUS_BADGE[s.status]}`}>
                          {STATUS_LABEL[s.status]} · #{s.position}
                        </span>
                        <button
                          onClick={() => setSlideEditor(s)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/90 hover:bg-white text-gray-700 transition-colors"
                        >
                          <Edit size={13} /> Editar
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(s)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/90 hover:bg-red-50 text-gray-700 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={13} /> Borrar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── FILTROS TAB ── */
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SlideFiltersTab slides={slides} filters={filters} onSaved={onSaved} />
          </div>
        )}

      {/* Slide Editor (nested modal) */}
      {slideEditor !== null && (
        <SlideEditor
          slide={slideEditor === "new" ? null : slideEditor}
          onClose={() => setSlideEditor(null)}
          onSaved={() => { setSlideEditor(null); onSaved(); }}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Eliminar slide</h3>
            <p className="text-sm text-gray-500 mb-5">¿Eliminar "{deleteConfirm.title}" del carousel?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button onClick={handleDeleteSlide} className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Promo Banner (Advertising) Manager ──
function PromoSlideEditor({
  slide,
  onClose,
  onSaved,
}: {
  slide: Banner | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!slide;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(slide?.title ?? "");
  const [subtitle, setSubtitle] = useState(slide?.subtitle ?? "");
  const [imageUrl, setImageUrl] = useState(slide?.image ?? "");
  const [ctaText, setCtaText] = useState(slide?.ctaText ?? "");
  const [bgColor, setBgColor] = useState(slide?.bgColor ?? "#1A1A2E");
  const [accentColor, setAccentColor] = useState(slide?.accentColor ?? "#FFF200");
  const [position, setPosition] = useState(slide?.position?.toString() ?? "0");
  const [isActive, setIsActive] = useState(slide?.isActive ?? true);
  const [startDate, setStartDate] = useState(slide?.startDate ? new Date(slide.startDate).toISOString().slice(0, 16) : "");
  const [endDate, setEndDate] = useState(slide?.endDate ? new Date(slide.endDate).toISOString().slice(0, 16) : "");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [categoryIds, setCategoryIds] = useState<number[]>(slide?.filter?.categoryIds ?? []);
  const [productIds, setProductIds] = useState<number[]>(slide?.filter?.productIds ?? []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setImageUrl(URL.createObjectURL(file));
  };

  const uploadFile = async (file: File): Promise<{ url: string; mediaType: string } | null> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("code", `promo_${Date.now()}`);
    const res = await fetch(
      `${resolveApiBaseUrl()}/upload/image`,
      { method: "POST", body: fd },
    );
    if (!res.ok) throw new Error("Error al subir imagen");
    const data = await res.json();
    return { url: data.url, mediaType: data.mediaType || "image/webp" };
  };

  const handleSave = async () => {
    if (!imageUrl.trim()) { setError("La imagen es obligatoria"); return; }
    setError(""); setSaving(true);
    try {
      let finalImageUrl = imageUrl.trim();
      if (pendingFile) { const u = await uploadFile(pendingFile); if (u) finalImageUrl = u.url; }
      const imageMediaId = await createMediaFromUrl(finalImageUrl);
      const filterId = await persistBannerFilter({
        filterId: slide?.filterId ?? null,
        base: slide?.filter,
        name: title.trim() || "Filtro de banner",
        categoryIds,
        productIds,
      });
      const data: CreateBannerData = {
        title: title.trim(),
        subtitle: subtitle.trim(),
        mediaId: imageMediaId,
        bannerType: "promo",
        ctaText: ctaText.trim(),
        bgColor: bgColor.trim() || undefined,
        accentColor: accentColor.trim() || undefined,
        position: parseInt(position) || 0,
        isActive,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        filterId,
      };
      if (isEdit && slide) await bannersService.update(slide.id, data);
      else await bannersService.create(data);
      onSaved();
    } catch (e: any) { setError(e.message || "Error al guardar"); }
    finally { setSaving(false); }
  };

  const badge = title.trim() ? title.split(" ").slice(0, 2).join(" ").toUpperCase() : "OFERTA";

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-3xl bg-white flex flex-col shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">{isEdit ? "Editar Banner Promo" : "Nuevo Banner Promo"}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-5">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</div>}

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Type size={12} /> Contenido</div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Título *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" placeholder="Semana del Ahorro" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subtítulo</label>
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" placeholder="Hasta 40% de descuento..." />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Image size={12} /> Imagen</div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">URL de imagen de fondo *</label>
              <div className="flex items-center gap-2">
                <input value={imageUrl} onChange={(e) => { setImageUrl(e.target.value); setPendingFile(null); }} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono" placeholder="https://... o sube una imagen" />
                <label className="px-3 py-2.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl cursor-pointer shrink-0 transition-colors">
                  {pendingFile ? "✓ Imagen lista" : "Subir archivo"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                </label>
              </div>
              {imageUrl && <div className="mt-2 rounded-xl overflow-hidden bg-gray-100 h-24"><img src={imageUrl} alt="" className="w-full h-full object-cover" /></div>}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Palette size={12} /> Apariencia</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Color de fondo</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border" />
                  <input value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Color de acento</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border" />
                  <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 font-mono" />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Link size={12} /> Botón</div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Texto del botón CTA</label>
              <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" placeholder="Aprovechar ahora" />
            </div>
          </div>

          <BannerTargetingSection
            filter={slide?.filter}
            categoryIds={categoryIds}
            setCategoryIds={setCategoryIds}
            productIds={productIds}
            setProductIds={setProductIds}
          />

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Calendar size={12} /> Programación</div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Posición</label><input type="number" value={position} onChange={(e) => setPosition(e.target.value)} min={0} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
              <div className="flex items-end pb-0.5"><label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-amber-500" /><span className="text-sm text-gray-700">Activo</span></label></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Inicio</label><input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Fin</label><input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
            </div>
          </div>

          {/* Preview */}
          {title && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"><Eye size={12} /> Vista previa</div>
              <div className="rounded-xl overflow-hidden relative" style={{ background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}dd 100%)`, minHeight: "110px" }}>
                {imageUrl && <img src={imageUrl} alt="" className="absolute right-0 top-0 h-full w-2/5 object-cover opacity-20" />}
                <div className="relative z-10 p-4">
                  <span className="inline-block text-[9px] font-black tracking-widest px-2 py-1 rounded-full mb-2" style={{ background: accentColor, color: bgColor }}>{badge}</span>
                  <h3 className="font-black text-base text-white leading-tight mb-1">{title}</h3>
                  {subtitle && <p className="text-xs text-white/60 mb-2">{subtitle}</p>}
                  {ctaText && <span className="inline-block px-3 py-1 rounded-lg text-[10px] font-bold" style={{ background: accentColor, color: bgColor }}>{ctaText}</span>}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoManager({
  slides,
  filters,
  onSaved,
}: {
  slides: Banner[];
  filters: FilterConfig[];
  onSaved: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"contenido" | "filtros">("contenido");
  const [slideEditor, setSlideEditor] = useState<Banner | null | "new">(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Banner | null>(null);

  const sortedSlides = [...slides].sort((a, b) => a.position - b.position);

  const handleDeleteSlide = async () => {
    if (!deleteConfirm) return;
    try { await bannersService.remove(deleteConfirm.id); setDeleteConfirm(null); onSaved(); }
    catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button onClick={() => setActiveTab("contenido")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === "contenido" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                <LayoutTemplate size={13} /> Contenido
              </button>
              <button onClick={() => setActiveTab("filtros")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === "filtros" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                <SlidersHorizontal size={13} /> Filtros
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "contenido" ? (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">{sortedSlides.length} banners · ordenados por posición</p>
                <button onClick={() => setSlideEditor("new")} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg">
                  <Plus size={13} /> Añadir banner
                </button>
              </div>
              {sortedSlides.length === 0 ? (
                <div className="text-center py-16 text-sm text-gray-400">No hay banners. Añade el primero.</div>
              ) : (
                <div className="space-y-3">
                  {sortedSlides.map((s) => {
                    const badge = (s.title || "OFERTA").split(" ").slice(0, 2).join(" ").toUpperCase();
                    return (
                      <div key={s.id} onClick={() => setSlideEditor(s)} className="relative rounded-xl overflow-hidden group cursor-pointer" style={{ background: `linear-gradient(135deg, ${s.bgColor || "#1A1A2E"} 0%, ${(s.bgColor || "#1A1A2E") + "dd"} 100%)`, minHeight: "120px" }}>
                        {s.image && (
                          <div className="absolute right-0 top-0 h-full w-2/5">
                            <img src={s.image} alt="" className="w-full h-full object-cover opacity-20" />
                          </div>
                        )}
                        <div className="relative z-10 p-5 flex items-center gap-5">
                          <div className="flex-1">
                            <span className="inline-block text-[9px] font-black tracking-widest px-2 py-1 rounded-full mb-2" style={{ background: s.accentColor || "#FFF200", color: s.bgColor || "#1A1A2E" }}>{badge}</span>
                            <h3 className="font-black text-lg text-white leading-tight mb-1">{s.title || <span className="underline decoration-dotted">Sin texto</span>}</h3>
                            <p className="text-xs text-white/60">{s.subtitle || <span className="underline decoration-dotted">Sin texto</span>}</p>
                          </div>
                          <span className="shrink-0 px-4 py-2 rounded-lg text-xs font-bold" style={{ background: s.accentColor || "#FFF200", color: s.bgColor || "#1A1A2E" }}>{s.ctaText || <span className="underline decoration-dotted">Sin texto</span>}</span>
                        </div>
                        <div className="absolute top-3 right-3 flex items-center gap-1 z-20" onClick={(e) => e.stopPropagation()}>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[s.status]}`}>{STATUS_LABEL[s.status]} · #{s.position}</span>
                          <button onClick={() => setSlideEditor(s)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/90 hover:bg-white text-gray-600"><Edit size={12} /></button>
                          <button onClick={() => setDeleteConfirm(s)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/90 hover:bg-red-50 text-gray-600 hover:text-red-500"><Trash2 size={12} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <SlideFiltersTab slides={slides} filters={filters} onSaved={onSaved} />
          )}
        </div>

      {slideEditor !== null && <PromoSlideEditor slide={slideEditor === "new" ? null : slideEditor} onClose={() => setSlideEditor(null)} onSaved={() => { setSlideEditor(null); onSaved(); }} />}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Eliminar banner</h3>
            <p className="text-sm text-gray-500 mb-5">¿Eliminar "{deleteConfirm.title}"?</p>
            <div className="flex justify-end gap-2"><button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button><button onClick={handleDeleteSlide} className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl">Eliminar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Benefits/Promo Banner Editor ──
const BENEFIT_ICONS: Record<string, React.ElementType> = {
  truck: Truck,
  shield: ShieldCheck,
  clock: Clock,
  zap: Zap,
};

const BENEFIT_DEFAULTS = [
  { icon: "truck", text: "Domicilio gratis en pedidos +$80.000" },
  { icon: "shield", text: "Compra 100% segura" },
  { icon: "clock", text: "Entrega en 2 horas" },
];

type BenefitDraft = { id: number; icon: string; text: string };

function BenefitsInlineEditor({
  benefits,
  onSaved,
}: {
  benefits: Banner[];
  onSaved: () => void;
}) {
  const [items, setItems] = useState<BenefitDraft[]>(() => {
    if (benefits.length > 0) {
      return [...benefits]
        .sort((a, b) => a.position - b.position)
        .map((b) => ({ id: b.id, icon: b.subtitle || "zap", text: b.title || "" }));
    }
    return BENEFIT_DEFAULTS.map((d, i) => ({ id: -(i + 1), icon: d.icon, text: d.text }));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const startEditing = () => {
    setItems(
      benefits.length > 0
        ? [...benefits]
            .sort((a, b) => a.position - b.position)
            .map((b) => ({ id: b.id, icon: b.subtitle || "zap", text: b.title || "" }))
        : BENEFIT_DEFAULTS.map((d, i) => ({ id: -(i + 1), icon: d.icon, text: d.text })),
    );
    setError("");
    setEditing(true);
  };

  const cancelEdit = () => {
    setError("");
    setEditing(false);
  };

  const addItem = () => {
    setItems((prev) => [...prev, { id: -Date.now(), icon: "zap", text: "" }]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: "icon" | "text", value: string) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      // 1. Crear/actualizar primero: nunca borrar antes de guardar
      const savedIds: number[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.text.trim()) continue;
        if (item.id > 0) {
          await bannersService.update(item.id, {
            title: item.text.trim(),
            subtitle: item.icon,
          });
          savedIds.push(item.id);
        } else {
          const mediaId = await createMediaFromUrl(
            "https://images.unsplash.com/photo-1?w=1&h=1&fit=crop",
          );
          const created = await bannersService.create({
            title: item.text.trim(),
            subtitle: item.icon,
            bannerType: "benefits" as any,
            mediaId,
            position: i,
          });
          savedIds.push(created.id);
        }
      }
      // 2. Solo después de guardar, eliminar los ítems removidos
      for (const b of benefits) {
        if (!savedIds.includes(b.id)) {
          await bannersService.remove(b.id).catch(() => {});
        }
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!editing ? (
        <>
          {/* Barra de solo lectura: idéntica al PromoBanner de Interfaz web */}
          <div className="rounded-none" style={{ background: "#FFF200" }}>
            <div
              className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-center gap-6 md:gap-12 text-sm font-bold"
              style={{ color: "#1A1A2E" }}
            >
              {[...benefits]
                .sort((a, b) => a.position - b.position)
                .map((b) => {
                  const Icon = BENEFIT_ICONS[b.subtitle || "zap"] || Zap;
                  return (
                    <span key={b.id} className="flex items-center gap-2">
                      <Icon className="w-4 h-4" /> {b.title}
                    </span>
                  );
                })}
              {benefits.length === 0 && (
                <span className="text-sm font-normal text-black/40">Sin beneficios configurados</span>
              )}
            </div>
          </div>
          <button
            onClick={startEditing}
            className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg hover:border-amber-300 hover:text-amber-600 transition-colors"
          >
            <SquarePen size={13} /> Editar
          </button>
        </>
      ) : (
        <>
          {/* Modo edición: mismas proporciones que el modo lectura */}
          <div className="rounded-none" style={{ background: "#FFF200" }}>
            <div
              className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-center gap-6 md:gap-12 text-sm font-bold"
              style={{ color: "#1A1A2E" }}
            >
              {items.map((item, i) => {
                const Icon = BENEFIT_ICONS[item.icon] || Zap;
                return (
                  <span key={item.id} className="flex items-center gap-2 group/item">
                    <span className="relative inline-flex" title="Cambiar icono">
                      <Icon className="w-4 h-4" />
                      <select
                        value={item.icon}
                        onChange={(e) => updateItem(i, "icon", e.target.value)}
                        aria-label="Cambiar icono"
                        className="absolute inset-0 opacity-0 cursor-pointer appearance-none"
                      >
                        <option value="truck">🚚</option>
                        <option value="shield">🛡️</option>
                        <option value="clock">⏱️</option>
                        <option value="zap">⚡</option>
                      </select>
                    </span>
                    <input
                      value={item.text}
                      onChange={(e) => updateItem(i, "text", e.target.value)}
                      placeholder="Texto del beneficio"
                      className="w-44 md:w-56 appearance-none rounded-none bg-transparent text-sm font-bold outline-none border-b border-dashed border-black/25 focus:border-black/50 placeholder:text-black/40"
                    />
                    <button
                      onClick={() => removeItem(i)}
                      title="Quitar beneficio"
                      className="w-4 h-4 flex items-center justify-center text-black/40 hover:text-red-500 transition-colors shrink-0"
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
              {items.length === 0 && (
                <span className="text-sm font-normal text-black/40">Sin beneficios configurados</span>
              )}
            </div>
          </div>

          {/* Acciones */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={addItem}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-amber-300 hover:text-amber-600 transition-colors"
            >
              <Plus size={13} /> Añadir beneficio
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 size={12} className="animate-spin" />} Guardar cambios
            </button>
            <button onClick={cancelEdit} disabled={saving} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600">
              Cancelar
            </button>
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Daily Deals Manager ──
interface DealItemForm {
  id: string;
  title: string;
  subtitle: string;
  discount: string;
  price: string;
  originalPrice: string;
  unit: string;
  image: string;
  bgFrom: string;
  bgTo: string;
  endsAt: string;
  productIds: number[];
  categoryIds: number[];
  startAt: string | null;
  endAt: string | null;
}

interface DealCarouselProduct {
  id: number;
  name: string;
  price: number;
  originalPrice?: number;
  image: string | null;
  category?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}

interface DealCarouselGroup {
  id: string;
  name: string;
  startAt: string | null;
  endAt: string | null;
  products: DealCarouselProduct[];
}

// ISO -> "YYYY-MM-DDTHH:mm" en hora local, para <input type="datetime-local">.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "YYYY-MM-DDTHH:mm" -> ISO (o null si se borra).
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ¿El rango [startAt, endAt] incluye el momento actual? (null = sin límite)
function isScheduleActiveNow(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
): boolean {
  const now = Date.now();
  if (startAt) {
    const s = new Date(startAt).getTime();
    if (!Number.isNaN(s) && now < s) return false;
  }
  if (endAt) {
    const e = new Date(endAt).getTime();
    if (!Number.isNaN(e) && now > e) return false;
  }
  return true;
}

function scheduleLabel(startAt: string | null, endAt: string | null): string {
  if (!startAt && !endAt) return "Sin programación (siempre activo)";
  if (startAt && endAt) {
    return `Activo: ${toLocalInput(startAt).replace("T", " ")} → ${toLocalInput(endAt).replace("T", " ")}`;
  }
  if (startAt) return `Activo desde: ${toLocalInput(startAt).replace("T", " ")}`;
  return `Activo hasta: ${toLocalInput(endAt).replace("T", " ")}`;
}

// Dos rangos se cruzan si comparten algún instante (null = abierto por ese lado).
function rangesOverlap(
  a: { startAt: string | null; endAt: string | null },
  b: { startAt: string | null; endAt: string | null },
): boolean {
  const toTime = (v: string | null, fallback: number) => {
    if (!v) return fallback;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? fallback : t;
  };
  const aS = toTime(a.startAt, -Infinity);
  const aE = toTime(a.endAt, Infinity);
  const bS = toTime(b.startAt, -Infinity);
  const bE = toTime(b.endAt, Infinity);
  return aS < bE && bS < aE;
}

// Nombres de los otros carouseles cuyas fechas se cruzan con el dado.
function overlappingNames(
  groups: DealCarouselGroup[],
  group: DealCarouselGroup,
): string[] {
  return groups
    .filter((o) => o.id !== group.id && rangesOverlap(group, o))
    .map((o) => o.name);
}

// Filtro por item del display de Ofertas del día (productos y/o categorías).
function DealItemFilter({
  categories,
  categoryIds,
  productIds,
  onChange,
}: {
  categories: AdminCategory[];
  categoryIds: number[];
  productIds: number[];
  onChange: (v: { productIds: number[]; categoryIds: number[] }) => void;
}) {
  const { products, setProducts } = useProductOptions(productIds);
  return (
    <div className="border-t border-gray-100 pt-3 space-y-3">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
        Filtro al hacer clic
      </p>
      <div>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 mb-1">
          <Package size={11} /> Productos
        </label>
        <ProductPicker
          selected={products}
          onChange={(next) => {
            setProducts(next);
            onChange({ productIds: next.map((p) => p.id), categoryIds });
          }}
        />
      </div>
      <div>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 mb-1">
          <Tag size={11} /> Categorías
        </label>
        <CategoryPicker
          categories={categories}
          selected={categoryIds}
          onChange={(next) => onChange({ productIds, categoryIds: next })}
        />
      </div>
    </div>
  );
}

// ── Editor de un item del display de Ofertas del día ──
function DealItemEditor({
  item,
  index,
  categories,
  onChange,
  onClose,
}: {
  item: DealItemForm;
  index: number;
  categories: AdminCategory[];
  onChange: (patch: Partial<DealItemForm>) => void;
  onClose: () => void;
}) {
  const inputCls =
    "w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300";
  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white flex flex-col shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">Editar Item #{index + 1}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                Título <span className="text-gray-400">(\n para salto de línea)</span>
              </label>
              <input
                value={item.title}
                onChange={(e) => onChange({ title: e.target.value })}
                className={inputCls}
                placeholder="Papa Criolla\nLimpia"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Subtítulo</label>
              <input value={item.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} className={inputCls} placeholder="Fresca desde las fincas" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Descuento</label>
              <input value={item.discount} onChange={(e) => onChange({ discount: e.target.value })} className={inputCls} placeholder="21% OFF" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Unidad</label>
              <input value={item.unit} onChange={(e) => onChange({ unit: e.target.value })} className={inputCls} placeholder="x kg" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Precio</label>
              <input type="number" min="0" value={item.price} onChange={(e) => onChange({ price: e.target.value })} className={inputCls} placeholder="3800" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Precio original</label>
              <input type="number" min="0" value={item.originalPrice} onChange={(e) => onChange({ originalPrice: e.target.value })} className={inputCls} placeholder="4800" />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Imagen (URL)</label>
              <input value={item.image} onChange={(e) => onChange({ image: e.target.value })} className={`${inputCls} font-mono`} placeholder="https://..." />
              {item.image && (
                <img src={item.image} alt="" className="mt-2 h-24 w-full object-cover rounded-lg border border-gray-200" />
              )}
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Fondo</label>
                <input type="color" value={item.bgFrom} onChange={(e) => onChange({ bgFrom: e.target.value })} className="w-8 h-8 rounded cursor-pointer border" />
                <input type="color" value={item.bgTo} onChange={(e) => onChange({ bgTo: e.target.value })} className="w-8 h-8 rounded cursor-pointer border" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Texto final (⏱)</label>
                <input value={item.endsAt} onChange={(e) => onChange({ endsAt: e.target.value })} className={inputCls} placeholder="Hoy · Hasta agotar existencias" />
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Programación (opcional)</label>
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={toLocalInput(item.startAt)}
                  onChange={(e) => onChange({ startAt: fromLocalInput(e.target.value) })}
                  className={inputCls}
                />
                <span className="text-xs text-gray-400 shrink-0">hasta</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(item.endAt)}
                  onChange={(e) => onChange({ endAt: fromLocalInput(e.target.value) })}
                  className={inputCls}
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Vacío = siempre visible. Solo se muestra dentro del rango.</p>
            </div>
          </div>

          <DealItemFilter
            categories={categories}
            categoryIds={item.categoryIds}
            productIds={item.productIds}
            onChange={(v) => onChange(v)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Buscador de productos del carousel de Ofertas del día ──
// Muestra 5 productos al abrir y carga de 5 en 5 al hacer scroll.
const DEAL_SEARCH_PAGE_SIZE = 5;

function DealCarouselSearchModal({
  addedIds,
  onAdd,
  onClose,
}: {
  addedIds: Set<number>;
  onAdd: (p: DealCarouselProduct) => void;
  onClose: () => void;
}) {
  const currency = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DealCarouselProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const offsetRef = useRef(0);
  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(async (q: string, reset: boolean) => {
    const offset = reset ? 0 : offsetRef.current;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const list = await catalogService.getProducts({
        limit: DEAL_SEARCH_PAGE_SIZE,
        offset,
        search: q.trim() || undefined,
      });
      if (reqId !== reqIdRef.current) return; // respuesta obsoleta
      const mapped: DealCarouselProduct[] = list.map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price ?? 0),
        originalPrice: p.originalPrice ? Number(p.originalPrice) : undefined,
        image: p.image ?? null,
        category: p.category ?? null,
      }));
      setItems((prev) => {
        if (reset) return mapped;
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...mapped.filter((p) => !seen.has(p.id))];
      });
      offsetRef.current = offset + mapped.length;
      setDone(mapped.length < DEAL_SEARCH_PAGE_SIZE);
    } catch {
      if (reqId === reqIdRef.current) setDone(true);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  // Carga inicial (5 productos) + búsqueda con debounce.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      offsetRef.current = 0;
      void loadPage(query, true);
      return;
    }
    debounceRef.current = setTimeout(() => {
      offsetRef.current = 0;
      setDone(false);
      void loadPage(query, true);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, loadPage]);

  // Lazy load: siguiente página al llegar al final de la lista.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && !done) {
          void loadPage(query, false);
        }
      },
      { root: el.parentElement, rootMargin: "48px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, done, query, loadPage]);

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-gray-900">Añadir productos al carousel</h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
              <X size={16} />
            </button>
          </div>
          <div className="relative mb-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar producto..."
              className="w-full text-sm border border-gray-200 rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          </div>
          <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
            {items.map((p) => {
              const already = addedIds.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => onAdd(p)}
                  disabled={already}
                  className={`flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${already ? "opacity-50 bg-gray-50" : "bg-gray-50 hover:bg-amber-50"}`}
                >
                  <div className="w-9 h-9 rounded-lg bg-gray-200 overflow-hidden shrink-0">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center">
                        <Package size={14} className="text-gray-400" />
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{p.name}</p>
                    <p className="text-[10px] text-gray-400">
                      {currency.format(p.price)}
                      {p.originalPrice ? <span className="line-through ml-1.5">{currency.format(p.originalPrice)}</span> : null}
                    </p>
                  </div>
                  {already ? <Check size={14} className="text-green-500 shrink-0" /> : <Plus size={14} className="text-amber-500 shrink-0" />}
                </button>
              );
            })}
            <div ref={sentinelRef} className="h-8 flex items-center justify-center">
              {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
              {!loading && done && items.length > 0 && <span className="text-[10px] text-gray-400">Fin de la lista</span>}
            </div>
            {items.length === 0 && !loading && (
              <p className="text-xs text-gray-400 py-8 text-center">Sin resultados</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Modal de edición de un carousel programable (nombre, fechas y productos).
function DealCarouselEditor({
  group,
  index,
  currency,
  onPatch,
  onAddProducts,
  onRemoveProduct,
  onPatchProduct,
  onDelete,
  onClose,
  overlapNames,
}: {
  group: DealCarouselGroup;
  index: number;
  currency: Intl.NumberFormat;
  onPatch: (patch: Partial<DealCarouselGroup>) => void;
  onAddProducts: () => void;
  onRemoveProduct: (productId: number) => void;
  onPatchProduct: (productId: number, patch: Partial<DealCarouselProduct>) => void;
  onDelete: () => void;
  onClose: () => void;
  overlapNames: string[];
}) {
  const inputCls =
    "w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300";
  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white flex flex-col shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900">Editar Carousel #{index + 1}</h2>
            <p className="text-[11px] text-gray-500">{scheduleLabel(group.startAt, group.endAt)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              value={group.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder="Nombre del carousel"
              className="w-full text-sm font-semibold border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
            <input
              type="datetime-local"
              value={toLocalInput(group.startAt)}
              onChange={(e) => onPatch({ startAt: fromLocalInput(e.target.value) })}
              className={inputCls}
              title="Vigente desde"
            />
            <input
              type="datetime-local"
              value={toLocalInput(group.endAt)}
              onChange={(e) => onPatch({ endAt: fromLocalInput(e.target.value) })}
              className={inputCls}
              title="Vigente hasta"
            />
          </div>
          <p className="text-[10px] text-gray-400">Rango de vigencia del carousel (vacío = sin límite).</p>
          {overlapNames.length > 0 && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Las fechas se cruzan con: {overlapNames.join(", ")}. Solo un carousel puede estar activo a la vez.
            </p>
          )}

          <button
            onClick={onAddProducts}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors"
          >
            <Plus size={13} /> Añadir productos
          </button>

          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Productos ({group.products.length})
          </p>
          {group.products.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-4 text-center">Sin productos en este carousel</p>
          ) : (
            <div className="flex flex-col gap-2">
              {group.products.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 rounded bg-gray-200 overflow-hidden shrink-0">
                    {p.image && <img src={p.image} alt={p.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-[8rem]">
                    <p className="text-xs text-gray-700 truncate font-medium">{p.name}</p>
                    <p className="text-[10px] text-gray-400">
                      {currency.format(p.price)}
                      {p.originalPrice ? (
                        <span className="line-through ml-1.5">{currency.format(p.originalPrice)}</span>
                      ) : null}
                    </p>
                  </div>
                  <input
                    type="datetime-local"
                    value={toLocalInput(p.startAt)}
                    onChange={(e) => onPatchProduct(p.id, { startAt: fromLocalInput(e.target.value) })}
                    className="w-36 text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300 shrink-0"
                    title="Inicio (opcional)"
                  />
                  <input
                    type="datetime-local"
                    value={toLocalInput(p.endAt)}
                    onChange={(e) => onPatchProduct(p.id, { endAt: fromLocalInput(e.target.value) })}
                    className="w-36 text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300 shrink-0"
                    title="Expiración (opcional)"
                  />
                  <button
                    onClick={() => onRemoveProduct(p.id)}
                    className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0"
                    title="Quitar del carousel"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={onDelete}
            className="w-full py-2.5 rounded-xl text-sm font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={13} className="inline mr-1" /> Eliminar carousel
          </button>
        </div>
      </div>
    </div>
  );
}

function DailyDealsManager({ onSaved }: { onSaved?: () => void }) {
  const [items, setItems] = useState<DealItemForm[]>([]);
  const [groups, setGroups] = useState<DealCarouselGroup[]>([]);
  const [tab, setTab] = useState<"display" | "carousel">("display");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [searchGroupId, setSearchGroupId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const categories = useAdminCategories();

  const API_BASE = resolveApiBaseUrl();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/landing/daily-deals`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setItems(
          (data.featuredItems ?? []).map((it: any, idx: number) => ({
            id: String(it.id ?? idx),
            title: it.title ?? "",
            subtitle: it.subtitle ?? "",
            discount: it.discount ?? "",
            price: String(it.price ?? ""),
            originalPrice: String(it.originalPrice ?? ""),
            unit: it.unit ?? "",
            image: it.image ?? "",
            bgFrom: it.bgFrom ?? "#1A4A2E",
            bgTo: it.bgTo ?? "#0D3B1F",
            endsAt: it.endsAt ?? "",
            productIds: Array.isArray(it.productIds)
              ? it.productIds.map(Number)
              : [],
            categoryIds: Array.isArray(it.categoryIds)
              ? it.categoryIds.map(Number)
              : [],
            startAt: it.startAt ?? null,
            endAt: it.endAt ?? null,
          })),
        );

        const rawGroups = Array.isArray(data.carousels) ? data.carousels : [];
        let nextGroups: DealCarouselGroup[] = rawGroups.map((g: any, i: number) => ({
          id: String(g.id ?? `c${i + 1}`),
          name: g.name ?? `Carousel ${i + 1}`,
          startAt: g.startAt ?? null,
          endAt: g.endAt ?? null,
          products: (Array.isArray(g.products) ? g.products : []).map((p: any) => ({
            id: Number(p.id),
            name: p.name ?? "",
            price: Number(p.price ?? 0),
            originalPrice: p.originalPrice ? Number(p.originalPrice) : undefined,
            image: p.image ?? null,
            category: p.category ?? null,
            startAt: p.startAt ?? null,
            endAt: p.endAt ?? null,
          })),
        }));
        // Compatibilidad: si no hay grupos, arma uno con el carousel legacy.
        if (
          nextGroups.length === 0 &&
          Array.isArray(data.carousel) &&
          data.carousel.length > 0
        ) {
          nextGroups = [
            {
              id: "default",
              name: "Carousel principal",
              startAt: null,
              endAt: null,
              products: data.carousel.map((p: any) => ({
                id: Number(p.id),
                name: p.name ?? "",
                price: Number(p.price ?? 0),
                originalPrice: p.originalPrice ? Number(p.originalPrice) : undefined,
                image: p.image ?? null,
                category: p.category ?? null,
                startAt: null,
                endAt: null,
              })),
            },
          ];
        }
        setGroups(nextGroups);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchItem = (id: string, patch: Partial<DealItemForm>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    const id = `n${Date.now()}`;
    setItems((prev) => [
      ...prev,
      {
        id,
        title: "",
        subtitle: "",
        discount: "",
        price: "",
        originalPrice: "",
        unit: "",
        image: "",
        bgFrom: "#1A4A2E",
        bgTo: "#0D3B1F",
        endsAt: "",
        productIds: [],
        categoryIds: [],
        startAt: null,
        endAt: null,
      },
    ]);
    setEditingId(id);
  };

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((it) => it.id !== id));

  const patchGroup = (id: string, patch: Partial<DealCarouselGroup>) =>
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const addGroup = () => {
    const id = `g${Date.now()}`;
    setGroups((prev) => [
      ...prev,
      { id, name: `Carousel ${prev.length + 1}`, startAt: null, endAt: null, products: [] },
    ]);
  };

  const removeGroup = (id: string) =>
    setGroups((prev) => prev.filter((g) => g.id !== id));

  const addCarouselProduct = (groupId: string, p: DealCarouselProduct) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && !g.products.some((x) => x.id === p.id)
          ? {
              ...g,
              products: [
                ...g.products,
                { ...p, startAt: p.startAt ?? null, endAt: p.endAt ?? null },
              ],
            }
          : g,
      ),
    );
  };

  const removeCarouselProduct = (groupId: string, id: number) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, products: g.products.filter((p) => p.id !== id) } : g,
      ),
    );

  const patchCarouselProduct = (
    groupId: string,
    productId: number,
    patch: Partial<DealCarouselProduct>,
  ) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              products: g.products.map((p) =>
                p.id === productId ? { ...p, ...patch } : p,
              ),
            }
          : g,
      ),
    );

  const handleSave = async () => {
    // Solo un carousel activo a la vez: los rangos no deben cruzarse.
    const conflict = groups.find((g) =>
      groups.some((o) => o.id !== g.id && rangesOverlap(g, o)),
    );
    if (conflict) {
      const other = groups.find(
        (o) => o.id !== conflict.id && rangesOverlap(conflict, o),
      );
      setError(
        `El carousel "${conflict.name}" se cruza con "${other?.name ?? ""}". Solo uno puede estar activo a la vez.`,
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const featuredItems = items
        .filter((it) => it.title.trim() || it.image.trim())
        .map((it, i) => ({
          id: i,
          title: it.title.trim(),
          subtitle: it.subtitle.trim(),
          discount: it.discount.trim(),
          price: Number(it.price) || 0,
          originalPrice: Number(it.originalPrice) || 0,
          unit: it.unit.trim(),
          image: it.image.trim(),
          bgFrom: it.bgFrom,
          bgTo: it.bgTo,
          endsAt: it.endsAt.trim(),
          productIds: it.productIds,
          categoryIds: it.categoryIds,
          startAt: it.startAt,
          endAt: it.endAt,
        }));
      const carousels = groups.map((g) => ({
        id: g.id,
        name: g.name.trim() || "Carousel",
        startAt: g.startAt,
        endAt: g.endAt,
        products: g.products.map((p) => ({
          id: p.id,
          startAt: p.startAt ?? null,
          endAt: p.endAt ?? null,
        })),
      }));
      const res = await fetch(`${API_BASE}/admin/landing/daily-deals`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featuredItems,
          carousels,
          carouselProductIds: groups.flatMap((g) => g.products.map((p) => p.id)),
        }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      onSaved?.();
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const currency = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

  const editingItem = items.find((it) => it.id === editingId) ?? null;
  const editingGroup = groups.find((g) => g.id === editingGroupId) ?? null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0">
          <button
            onClick={() => setTab("display")}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === "display" ? "text-amber-600 border-b-2 border-amber-400" : "text-gray-400 hover:text-gray-600"}`}
          >
            Display ({items.length})
          </button>
          <button
            onClick={() => setTab("carousel")}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === "carousel" ? "text-amber-600 border-b-2 border-amber-400" : "text-gray-400 hover:text-gray-600"}`}
          >
            Carousel ({groups.reduce((n, g) => n + g.products.length, 0)})
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-amber-400 rounded-full animate-spin" />
          </div>
        ) : tab === "display" ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
            {items.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-8">
                Sin items. Añade el primero.
              </p>
            )}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {items.map((it, i) => {
                const hasFilter = it.productIds.length > 0 || it.categoryIds.length > 0;
                return (
                  <div
                    key={it.id}
                    onClick={() => setEditingId(it.id)}
                    className="relative rounded-2xl overflow-hidden cursor-pointer group"
                    style={{ background: `linear-gradient(160deg, ${it.bgFrom} 0%, ${it.bgTo} 100%)` }}
                  >
                    <div className="flex flex-col sm:flex-row">
                      <div className="p-5 flex-1 min-w-0">
                        <span className="inline-block text-[10px] font-black tracking-widest px-2.5 py-1 rounded-full mb-3" style={{ background: "#FFF200", color: "#1A1A2E" }}>
                          {it.discount || "Sin descuento"}
                        </span>
                        <h3 className="text-xl font-black text-white whitespace-pre-line leading-tight mb-1">
                          {it.title || <span className="underline decoration-dotted">Sin título</span>}
                        </h3>
                        <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.65)" }}>
                          {it.subtitle || <span className="underline decoration-dotted">Sin subtítulo</span>}
                        </p>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-black text-white">{currency.format(Number(it.price) || 0)}</span>
                          {Number(it.originalPrice) > 0 && (
                            <span className="text-sm line-through" style={{ color: "rgba(255,255,255,0.45)" }}>
                              {currency.format(Number(it.originalPrice) || 0)}
                            </span>
                          )}
                        </div>
                        {it.unit && <p className="text-xs mt-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>{it.unit}</p>}
                        <p className="text-xs mt-2 font-semibold" style={{ color: "#FFF200" }}>⏱ {it.endsAt || "Sin texto final"}</p>
                        <div className="mt-3">
                          {hasFilter ? (
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-white/15 text-white">
                              <SlidersHorizontal size={10} /> Filtro activo
                              {it.productIds.length > 0 && <span>· {it.productIds.length} prod.</span>}
                              {it.categoryIds.length > 0 && <span>· {it.categoryIds.length} cat.</span>}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-black/20" style={{ color: "rgba(255,255,255,0.6)" }}>
                              Sin filtro
                            </span>
                          )}
                        </div>
                        {(it.startAt || it.endAt) && (
                          <p className="text-[10px] mt-2 font-semibold" style={{ color: "rgba(255,255,255,0.75)" }}>
                            ⏳ {it.startAt ? toLocalInput(it.startAt).replace("T", " ") : "…"} → {it.endAt ? toLocalInput(it.endAt).replace("T", " ") : "…"}
                          </p>
                        )}
                      </div>
                      {it.image && (
                        <div className="sm:w-40 h-36 sm:h-auto shrink-0 overflow-hidden">
                          <img src={it.image} alt="" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>

                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[11px] font-bold text-white/80 bg-black/25 px-2 py-1 rounded-full">#{i + 1}</span>
                      <button
                        onClick={() => setEditingId(it.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white/90 hover:bg-white text-gray-700"
                      >
                        <Edit size={12} /> Editar
                      </button>
                      <button
                        onClick={() => removeItem(it.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white/90 hover:bg-red-50 text-gray-700 hover:text-red-500"
                      >
                        <Trash2 size={12} /> Borrar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {groups.length} carousel(es) · {groups.reduce((n, g) => n + g.products.length, 0)} productos
              </p>
              <button
                onClick={addGroup}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors"
              >
                <Plus size={13} /> Añadir carousel
              </button>
            </div>

            {groups.length === 0 && (
              <p className="text-xs text-gray-400 py-8 text-center">
                Sin carouseles. Crea uno para agrupar productos por fechas.
              </p>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {groups.map((g) => {
                const active = isScheduleActiveNow(g.startAt, g.endAt);
                const overlaps = overlappingNames(groups, g);
                return (
                  <div
                    key={g.id}
                    onClick={() => setEditingGroupId(g.id)}
                    className={`bg-white border rounded-2xl overflow-hidden cursor-pointer hover:shadow-md transition-shadow ${overlaps.length > 0 ? "border-red-300" : "border-gray-200"}`}
                  >
                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{g.name}</p>
                        <p className={`text-[11px] ${overlaps.length > 0 ? "text-red-500" : "text-gray-400"}`}>
                          {scheduleLabel(g.startAt, g.endAt)}
                          {overlaps.length > 0 && ` · Se cruza con: ${overlaps.join(", ")}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                          {active ? "Vigente" : "Inactivo"}
                        </span>
                        <button
                          onClick={() => setEditingGroupId(g.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-gray-600 border border-gray-200 hover:border-amber-300 hover:text-amber-600 transition-colors"
                        >
                          <Edit size={12} /> Editar
                        </button>
                        <button
                          onClick={() => removeGroup(g.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          title="Eliminar carousel"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="p-4">
                      {g.products.length === 0 ? (
                        <p className="text-[11px] text-gray-400 py-4 text-center">Sin productos en este carousel</p>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {g.products.slice(0, 4).map((p) => (
                            <div key={p.id} className="border border-gray-100 rounded-lg overflow-hidden">
                              <div className="aspect-square bg-gray-100 overflow-hidden">
                                {p.image && <img src={p.image} alt={p.name} className="w-full h-full object-cover" />}
                              </div>
                              <div className="p-1.5">
                                <p className="text-[10px] font-semibold text-gray-700 truncate">{p.name}</p>
                                <p className="text-[10px] font-bold text-gray-900">{currency.format(p.price)}</p>
                              </div>
                            </div>
                          ))}
                          {g.products.length > 4 && (
                            <div className="aspect-square rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-xs font-semibold text-gray-400">
                              +{g.products.length - 4}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
          <span className="text-xs text-red-500">{error}</span>
          <div className="flex items-center gap-2">
            {tab === "display" && (
              <button
                onClick={addItem}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 hover:border-amber-300 hover:text-amber-600 rounded-xl transition-colors"
              >
                <Plus size={14} /> Añadir item
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl"
            >
              {saving && <Loader2 size={14} className="animate-spin" />} Guardar cambios
            </button>
          </div>
        </div>

      {/* Buscador de productos del carousel */}
      {searchGroupId !== null && (
        <DealCarouselSearchModal
          addedIds={
            new Set(
              (groups.find((g) => g.id === searchGroupId)?.products ?? []).map((p) => p.id),
            )
          }
          onAdd={(p) => addCarouselProduct(searchGroupId, p)}
          onClose={() => setSearchGroupId(null)}
        />
      )}

      {/* Editor de un item del display */}
      {editingItem && (
        <DealItemEditor
          item={editingItem}
          index={items.findIndex((it) => it.id === editingItem.id)}
          categories={categories}
          onChange={(patch) => patchItem(editingItem.id, patch)}
          onClose={() => setEditingId(null)}
        />
      )}

      {/* Editor de un carousel programable */}
      {editingGroup && (
        <DealCarouselEditor
          group={editingGroup}
          index={groups.findIndex((g) => g.id === editingGroup.id)}
          currency={currency}
          onPatch={(patch) => patchGroup(editingGroup.id, patch)}
          onAddProducts={() => setSearchGroupId(editingGroup.id)}
          onRemoveProduct={(pid) => removeCarouselProduct(editingGroup.id, pid)}
          onPatchProduct={(pid, patch) => patchCarouselProduct(editingGroup.id, pid, patch)}
          onDelete={() => {
            removeGroup(editingGroup.id);
            setEditingGroupId(null);
          }}
          onClose={() => setEditingGroupId(null)}
          overlapNames={overlappingNames(groups, editingGroup)}
        />
      )}
    </div>
  );
}

// ── Landing Benefits Manager ──
const BENEFIT_OPTIONS = [
  { key: "Truck", label: "🚚 Envío" },
  { key: "MapPin", label: "📍 Mapa" },
  { key: "CreditCard", label: "💳 Pago" },
  { key: "ShieldCheck", label: "🛡️ Seguro" },
  { key: "Phone", label: "📞 Teléfono" },
  { key: "Store", label: "🏪 Tienda" },
  { key: "Heart", label: "❤️ Salud" },
  { key: "Zap", label: "⚡ Rápido" },
  { key: "Clock", label: "⏱ Horario" },
  { key: "Star", label: "⭐ Calidad" },
];

interface BenefitItemForm {
  id: string;
  icon: string;
  title: string;
  desc: string;
}

function BenefitsLandingManager({ onSaved }: { onSaved?: () => void }) {
  const [items, setItems] = useState<BenefitItemForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const API_BASE = resolveApiBaseUrl();
  const savedSnapshotRef = useRef<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/landing/benefits`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (Array.isArray(data) ? data : []).map(
          (it: any, idx: number) => ({
            id: String(it.id ?? idx),
            icon: it.icon ?? "Star",
            title: it.title ?? "",
            desc: it.desc ?? "",
          }),
        );
        setItems(mapped);
        savedSnapshotRef.current = JSON.stringify(mapped);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateItem = (idx: number, field: "icon" | "title" | "desc", value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `n${Date.now()}`, icon: "Star", title: "", desc: "" },
    ]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const payload = items
        .filter((it) => it.title.trim() || it.desc.trim())
        .map((it, i) => ({
          id: i,
          icon: it.icon,
          title: it.title.trim(),
          desc: it.desc.trim(),
        }));
      const res = await fetch(`${API_BASE}/admin/landing/benefits`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Error al guardar");
      savedSnapshotRef.current = JSON.stringify(items);
      onSaved?.();
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }, [items, API_BASE, onSaved]);

  // Autoguardado con debounce: ya no hay botón "Guardar cambios".
  useEffect(() => {
    if (loading) return;
    if (JSON.stringify(items) === savedSnapshotRef.current) return;
    const t = setTimeout(() => {
      void handleSave();
    }, 900);
    return () => clearTimeout(t);
  }, [items, loading, handleSave]);

  const inputCls =
    "w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <p className="text-sm text-gray-500">{items.length} beneficios</p>
            {saving && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Guardando…
              </span>
            )}
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>
          <button
            onClick={addItem}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors shrink-0"
          >
            <Plus size={13} /> Añadir beneficio
          </button>
        </div>
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-amber-400 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-3">
            {items.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-8">Sin beneficios configurados</p>
            )}
            {items.map((it, i) => (
              <div key={it.id} className="flex flex-col gap-2 bg-gray-50 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <select
                    value={it.icon}
                    onChange={(e) => updateItem(i, "icon", e.target.value)}
                    className="w-28 px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                  >
                    {BENEFIT_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <input
                    value={it.title}
                    onChange={(e) => updateItem(i, "title", e.target.value)}
                    placeholder="Título del beneficio"
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    onClick={() => removeItem(i)}
                    className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0"
                    title="Quitar beneficio"
                  >
                    <X size={12} />
                  </button>
                </div>
                <textarea
                  value={it.desc}
                  onChange={(e) => updateItem(i, "desc", e.target.value)}
                  placeholder="Descripción del beneficio"
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Footer Manager ──
interface FooterSocial { platform: string; url: string }
interface FooterHelpLink { label: string; url: string }
interface FooterContact { address: string; phone: string; whatsapp: string; email: string }
interface FooterCategoryOption { code: string; name: string; isActive: boolean; parentId: number | null }

function FooterLandingManager({ onSaved }: { onSaved?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [description, setDescription] = useState("");
  const [socialLinks, setSocialLinks] = useState<FooterSocial[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState<FooterCategoryOption[]>([]);
  const [helpLinks, setHelpLinks] = useState<FooterHelpLink[]>([]);
  const [contact, setContact] = useState<FooterContact>({ address: "", phone: "", whatsapp: "", email: "" });
  const [hours, setHours] = useState("");
  // Category search + filter
  const [catSearch, setCatSearch] = useState("");
  const [catFilter, setCatFilter] = useState<"all" | "active" | "inactive">("all");
  const API_BASE = resolveApiBaseUrl();

  const load = useCallback(async () => {
    try {
      const [fRes, catRes] = await Promise.all([
        fetch(`${API_BASE}/admin/landing/footer`, { credentials: "include" }),
        fetch(`${API_BASE}/admin/catalog/categories`, { credentials: "include" }),
      ]);
      if (fRes.ok) {
        const fc = await fRes.json();
        setDescription(fc.description ?? "");
        setSocialLinks(Array.isArray(fc.socialLinks) ? fc.socialLinks : []);
        setSelectedCategories(Array.isArray(fc.categoryCodes) ? fc.categoryCodes : []);
        setHelpLinks(Array.isArray(fc.helpLinks) ? fc.helpLinks : []);
        setContact(fc.contact ?? { address: "", phone: "", whatsapp: "", email: "" });
        setHours(fc.hours ?? "");
      }
      if (catRes.ok) {
        const cats = await catRes.json();
        const list: FooterCategoryOption[] = [];
        (Array.isArray(cats) ? cats : []).forEach((c: any) => {
          if (c.code) list.push({ code: c.code, name: c.name ?? c.code, isActive: c.isActive ?? true, parentId: c.parentId ?? null });
          if (c.children && Array.isArray(c.children)) c.children.forEach((ch: any) => { if (ch.code) list.push({ code: ch.code, name: ch.name ?? ch.code, isActive: ch.isActive ?? true, parentId: ch.parentId ?? c.id ?? null }); });
        });
        setAllCategories(list);
        // Si el footer no tiene categorías configuradas, reflejar el fallback del
        // cliente (las primeras 6 categorías raíz) para que se vean "activas".
        setSelectedCategories((prev) =>
          prev.length > 0
            ? prev
            : list.filter((c) => c.parentId == null).slice(0, 6).map((c) => c.code),
        );
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [API_BASE]);

  useEffect(() => { void load(); }, [load]);

  const addSocial = () => setSocialLinks((p) => [...p, { platform: "instagram", url: "" }]);
  const updateSocial = (i: number, f: keyof FooterSocial, v: string) => setSocialLinks((p) => p.map((x, idx) => idx === i ? { ...x, [f]: v } : x));
  const removeSocial = (i: number) => setSocialLinks((p) => p.filter((_, idx) => idx !== i));

  const addHelp = () => setHelpLinks((p) => [...p, { label: "", url: "" }]);
  const updateHelp = (i: number, f: keyof FooterHelpLink, v: string) => setHelpLinks((p) => p.map((x, idx) => idx === i ? { ...x, [f]: v } : x));
  const removeHelp = (i: number) => setHelpLinks((p) => p.filter((_, idx) => idx !== i));

  const toggleCategory = (code: string) => {
    setSelectedCategories((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  };

  // "Activa" = categoría incluida en el footer. El filtro y el check usan lo mismo.
  const catQuery = catSearch.trim().toLowerCase();
  const filteredCats = allCategories.filter((c) => {
    if (catQuery && !c.name.toLowerCase().includes(catQuery)) return false;
    const inFooter = selectedCategories.includes(c.code);
    if (catFilter === "active") return inFooter;
    if (catFilter === "inactive") return !inFooter;
    return true;
  });

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/admin/landing/footer`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          socialLinks: socialLinks.filter((s) => s.platform && s.url),
          categoryCodes: selectedCategories,
          helpLinks: helpLinks.filter((h) => h.label),
          contact,
          hours,
        }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      onSaved?.();
    } catch (e: any) { setError(e.message || "Error al guardar"); }
    finally { setSaving(false); }
  };

  const inputCls = "w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300";
  const labelCls = "text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1";

  return (
    <div className="flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-gray-300 border-t-amber-400 rounded-full animate-spin" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Descripción */}
            <div>
              <h4 className="text-sm font-bold text-gray-900 mb-2">Descripción</h4>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
            </div>

            {/* Redes sociales */}
            <div>
              <h4 className="text-sm font-bold text-gray-900 mb-2">Redes sociales</h4>
              <div className="space-y-2">
                {socialLinks.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={s.platform} onChange={(e) => updateSocial(i, "platform", e.target.value)} className="w-28 text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300">
                      <option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="youtube">YouTube</option>
                    </select>
                    <input value={s.url} onChange={(e) => updateSocial(i, "url", e.target.value)} placeholder="https://..." className={`${inputCls} flex-1 font-mono text-xs`} />
                    <button onClick={() => removeSocial(i)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0"><X size={12} /></button>
                  </div>
                ))}
                <button onClick={addSocial} className="flex items-center gap-1 text-xs text-gray-500 hover:text-amber-600"><Plus size={12} /> Añadir red social</button>
              </div>
            </div>

            {/* Categorías */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-gray-900">Categorías del footer</h4>
                <span className="text-[11px] font-semibold text-green-600">
                  {selectedCategories.length} activa{selectedCategories.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    placeholder="Buscar categoría..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </div>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 shrink-0">
                  {([
                    { key: "all", label: "Todas" },
                    { key: "active", label: "Activas" },
                    { key: "inactive", label: "Inactivas" },
                  ] as const).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setCatFilter(f.key)}
                      className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${catFilter === f.key ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-52 overflow-y-auto grid grid-cols-2 gap-1">
                {filteredCats.map((c) => {
                  const active = selectedCategories.includes(c.code);
                  return (
                    <label
                      key={c.code}
                      className={`flex items-center gap-2 text-xs cursor-pointer rounded px-2 py-1 transition-colors ${active ? "bg-green-50" : "hover:bg-gray-50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleCategory(c.code)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-amber-500 shrink-0 cursor-pointer"
                      />
                      <span className="truncate flex-1">{c.name}</span>
                      {active && (
                        <span className="text-[9px] font-bold text-green-600 uppercase shrink-0">Activa</span>
                      )}
                    </label>
                  );
                })}
                {filteredCats.length === 0 && (
                  <p className="col-span-2 text-xs text-gray-400 py-2 text-center">Sin resultados</p>
                )}
              </div>
            </div>

            {/* Ayuda */}
            <div>
              <h4 className="text-sm font-bold text-gray-900 mb-2">Links de ayuda</h4>
              <div className="space-y-2">
                {helpLinks.length === 0 && (
                  <p className="text-xs text-gray-400">No hay links de ayuda configurados.</p>
                )}
                {helpLinks.map((h, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase w-14 shrink-0">Nombre</span>
                      <input value={h.label} onChange={(e) => updateHelp(i, "label", e.target.value)} placeholder="Ej: Preguntas frecuentes" className={`${inputCls} flex-1`} />
                      <button onClick={() => removeHelp(i)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0"><X size={12} /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase w-14 shrink-0">URL</span>
                      <input value={h.url} onChange={(e) => updateHelp(i, "url", e.target.value)} placeholder="https://..." className={`${inputCls} flex-1 font-mono text-xs`} />
                    </div>
                    {h.label && h.url && (
                      <p className="text-[11px] text-gray-400 truncate">
                        → <span className="text-gray-600 font-medium">{h.label}</span> · {h.url}
                      </p>
                    )}
                  </div>
                ))}
                <button onClick={addHelp} className="flex items-center gap-1 text-xs text-gray-500 hover:text-amber-600"><Plus size={12} /> Añadir link</button>
              </div>
            </div>

            {/* Contacto */}
            <div>
              <h4 className="text-sm font-bold text-gray-900 mb-2">Contacto</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Dirección</label>
                  <input value={contact.address} onChange={(e) => setContact((p) => ({ ...p, address: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Teléfono</label>
                  <input value={contact.phone} onChange={(e) => setContact((p) => ({ ...p, phone: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>WhatsApp</label>
                  <input value={contact.whatsapp} onChange={(e) => setContact((p) => ({ ...p, whatsapp: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input value={contact.email} onChange={(e) => setContact((p) => ({ ...p, email: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>

            {/* Horario */}
            <div>
              <h4 className="text-sm font-bold text-gray-900 mb-2">Horario de atención</h4>
              <input value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls} placeholder="Lun–Dom · 6am – 10pm" />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl">
            {saving && <Loader2 size={14} className="animate-spin" />} Guardar footer
          </button>
        </div>
    </div>
  );
}

// ── Featured Products Manager ──
function FeaturedProductsManager() {
  const [tabs, setTabs] = useState<FeaturedTab[]>([]);
  const [selectedTab, setSelectedTab] = useState<number | null>(null);
  const [products, setProducts] = useState<FeaturedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FeaturedProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<FeaturedTab | null>(null);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTabs = useCallback(async () => {
    const data = await featuredService.getTabs();
    setTabs(data);
    setSelectedTab((prev) => {
      if (prev !== null && data.some((t) => t.id === prev)) return prev;
      return data.length ? data[0].id : null;
    });
    setLoading(false);
  }, []);

  const loadProducts = useCallback(async (tabId: number) => {
    setProductsLoading(true);
    try {
      setProducts(await featuredService.getTabProducts(tabId));
    } catch (e: any) { setError(e.message || "Error"); }
    finally { setProductsLoading(false); }
  }, []);

  useEffect(() => { void loadTabs(); }, [loadTabs]);

  useEffect(() => {
    if (selectedTab === null) { setProducts([]); return; }
    void loadProducts(selectedTab);
  }, [selectedTab, loadProducts]);

  const handleCreateTab = async () => {
    if (!newTabName.trim()) return;
    setCreating(true); setError("");
    try {
      const data = await featuredService.createTab({ name: newTabName.trim() });
      setTabs(data);
      setNewTabName("");
      const created = data[data.length - 1];
      setSelectedTab(created.id);
    } catch (e: any) { setError(e.message || "Error"); }
    finally { setCreating(false); }
  };

  const handleRename = async (id: number) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    setError("");
    try {
      const data = await featuredService.updateTab(id, { name: renameValue.trim() });
      setTabs(data);
    } catch (e: any) { setError(e.message || "Error"); }
    finally { setRenamingId(null); }
  };

  const handleToggleActive = async (tab: FeaturedTab) => {
    setError("");
    try {
      const data = await featuredService.updateTab(tab.id, { isActive: !tab.isActive });
      setTabs(data);
    } catch (e: any) { setError(e.message || "Error"); }
  };

  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= tabs.length) return;
    const reordered = [...tabs];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    setTabs(reordered);
    setError("");
    try {
      for (let i = 0; i < reordered.length; i++) {
        await featuredService.updateTab(reordered[i].id, { position: i });
      }
    } catch (e: any) { setError(e.message || "Error al reordenar"); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setError("");
    try {
      const data = await featuredService.deleteTab(deleteConfirm.id);
      setTabs(data);
      setDeleteConfirm(null);
      setSelectedTab(data.length ? data[0].id : null);
    } catch (e: any) { setError(e.message || "Error"); }
  };

  const handleSearch = (q: string) => {
    setSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (!q.trim()) { setSearchResults([]); return; }
      setSearching(true);
      try {
        setSearchResults(await featuredService.searchProducts(q.trim()));
      } catch (e: any) { setError(e.message || "Error"); }
      finally { setSearching(false); }
    }, 350);
  };

  const handleAdd = async (productId: number) => {
    if (selectedTab === null) return;
    setAdding(true); setError("");
    try {
      const data = await featuredService.assignProducts(selectedTab, [productId]);
      setProducts(data);
      setSearch(""); setSearchResults([]);
      await loadTabs();
    } catch (e: any) { setError(e.message || "Error"); }
    finally { setAdding(false); }
  };

  const handleRemove = async (productId: number) => {
    if (selectedTab === null) return;
    setError("");
    try {
      const data = await featuredService.removeProduct(selectedTab, productId);
      setProducts(data);
      await loadTabs();
    } catch (e: any) { setError(e.message || "Error"); }
  };

  const handleMoveProduct = async (index: number, dir: -1 | 1) => {
    if (selectedTab === null) return;
    const target = index + dir;
    if (target < 0 || target >= products.length) return;
    const reordered = [...products];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    setProducts(reordered);
    setError("");
    try {
      const data = await featuredService.reorderProducts(
        selectedTab,
        reordered.map((p) => p.id),
      );
      setProducts(data);
    } catch (e: any) { setError(e.message || "Error al reordenar"); }
  };

  const selected = tabs.find((t) => t.id === selectedTab) ?? null;
  const assignedIds = new Set(products.map((p) => p.id));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
        {error && <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</div>}

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Left: Tabs */}
          <div className="w-72 border-r border-gray-100 flex flex-col shrink-0 min-h-0">
            <div className="p-4 border-b border-gray-100 space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pestañas</p>
              <div className="flex gap-2">
                <input
                  value={newTabName}
                  onChange={(e) => setNewTabName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreateTab(); }}
                  placeholder="Nueva pestaña..."
                  className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <button
                  onClick={handleCreateTab}
                  disabled={creating || !newTabName.trim()}
                  className="px-3 py-2 text-xs font-bold bg-amber-400 text-amber-900 rounded-xl hover:bg-amber-500 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Añadir
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
              ) : tabs.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">Crea la primera pestaña</p>
              ) : (
                tabs.map((tab, i) => (
                  <div
                    key={tab.id}
                    className={`group rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${selectedTab === tab.id ? "bg-amber-50 border border-amber-200" : "border border-transparent hover:bg-gray-50"}`}
                    onClick={() => setSelectedTab(tab.id)}
                  >
                    {renamingId === tab.id ? (
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void handleRename(tab.id); }}
                          autoFocus
                          className="flex-1 px-2 py-1 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                        />
                        <button onClick={() => void handleRename(tab.id)} className="p-1 text-green-600"><Check size={13} /></button>
                        <button onClick={() => setRenamingId(null)} className="p-1 text-gray-400"><X size={13} /></button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className={`flex-1 text-sm font-semibold ${tab.isActive ? "text-gray-800" : "text-gray-300 line-through"}`}>
                            {tab.name}
                          </span>
                          <span className="text-[10px] text-gray-400 font-medium">{tab.productCount}</span>
                        </div>
                        <div className="flex items-center gap-0.5 mt-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handleMove(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30"><ArrowUp size={11} /></button>
                          <button onClick={() => handleMove(i, 1)} disabled={i === tabs.length - 1} className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30"><ArrowDown size={11} /></button>
                          <button onClick={() => { setRenamingId(tab.id); setRenameValue(tab.name); }} className="p-1 rounded hover:bg-gray-200 text-gray-500"><Edit size={11} /></button>
                          <button onClick={() => handleToggleActive(tab)} className={`p-1 rounded hover:bg-gray-200 ${tab.isActive ? "text-green-600" : "text-gray-400"}`}>{tab.isActive ? <Eye size={11} /> : <Eye size={11} />}</button>
                          {!tab.isDefault && (
                            <button onClick={() => setDeleteConfirm(tab)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 size={11} /></button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Products */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="p-4 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {selected ? `Productos en "${selected.name}" (${products.length})` : "Selecciona una pestaña"}
              </p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Buscar producto por nombre, PLU o código..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
              {searching && <div className="mt-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin inline mr-1" />Buscando...</div>}
              {searchResults.length > 0 && (
                <div className="mt-2 max-h-56 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                  {searchResults.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                        {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">{p.name}</p>
                        <p className="text-[10px] text-gray-400">{p.plu || p.externalId || p.barcode || "—"} · ${p.price.toLocaleString("es-CO")}</p>
                      </div>
                      <button
                        onClick={() => void handleAdd(p.id)}
                        disabled={adding || assignedIds.has(p.id)}
                        className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-amber-400 text-amber-900 hover:bg-amber-500 disabled:opacity-40 flex items-center gap-1"
                      >
                        {assignedIds.has(p.id) ? <Check size={11} /> : <Plus size={11} />}
                        {assignedIds.has(p.id) ? "Agregado" : "Agregar"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              {productsLoading ? (
                <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
              ) : products.length === 0 ? (
                <div className="text-center py-12">
                  <Package size={28} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">Sin productos asignados</p>
                  <p className="text-xs text-gray-300">Busca y agrega productos desde la barra superior</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {products.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-100 hover:border-amber-200 transition-colors">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => handleMoveProduct(i, -1)} disabled={i === 0} className="p-0.5 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-30"><ArrowUp size={11} /></button>
                        <button onClick={() => handleMoveProduct(i, 1)} disabled={i === products.length - 1} className="p-0.5 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-30"><ArrowDown size={11} /></button>
                      </div>
                      <div className="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                        {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-700 truncate">{p.name}</p>
                        <p className="text-[11px] text-gray-400">{p.plu || p.externalId || p.barcode || "—"}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-800">${p.price.toLocaleString("es-CO")}</span>
                      {p.originalPrice && (
                        <span className="text-xs text-gray-400 line-through">${p.originalPrice.toLocaleString("es-CO")}</span>
                      )}
                      <button onClick={() => void handleRemove(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="font-bold text-gray-900 mb-2">Eliminar pestaña</h3>
            <p className="text-sm text-gray-500 mb-4">
              ¿Seguro que quieres eliminar "{deleteConfirm.name}"? Se quitarán sus productos asignados.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button onClick={handleDelete} className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Datos compartidos de la sección Home ──
function useHomeData() {
  const [slides, setSlides] = useState<Banner[]>([]);
  const [promos, setPromos] = useState<Banner[]>([]);
  const [benefits, setBenefits] = useState<Banner[]>([]);
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, b, f] = await Promise.all([
        bannersService.getAll({ bannerType: "hero" }),
        bannersService.getAll({ bannerType: "promo" }),
        bannersService.getAll({ bannerType: "benefits" }),
        filtersService.getAll(),
      ]);
      setSlides(s);
      setPromos(p);
      setBenefits(b);
      setFilters(f);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { slides, promos, benefits, filters, loading, fetchData };
}

function HomeLoading() {
  return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;
}

function HomeSection({
  icon: Icon,
  iconClass,
  title,
  subtitle,
  stats,
  fill,
  children,
}: {
  icon: ElementType;
  iconClass: string;
  title: string;
  subtitle: string;
  stats?: ReactNode;
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`p-6${fill ? " h-full flex flex-col" : ""}`}>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + iconClass}>
              <Icon size={18} />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 text-lg">{title}</h1>
              <p className="text-xs text-gray-500">{subtitle}</p>
            </div>
          </div>
          {stats}
        </div>
        <div className={fill ? "flex-1 min-h-0 flex flex-col" : ""}>{children}</div>
      </div>
    </div>
  );
}

export function HomeHeroSection() {
  const { slides, filters, loading, fetchData } = useHomeData();
  if (loading) return <HomeLoading />;
  return (
    <HomeSection icon={LayoutTemplate} iconClass="bg-amber-100 text-amber-600" title="Banners publicitarios" subtitle="Sección principal del sitio · 1920×600px"
      stats={
        <div className="flex gap-6 text-sm">
          <div><span className="font-bold text-gray-900">{slides.length}</span> <span className="text-gray-400 text-xs">slides</span></div>
          <div><span className="font-bold text-green-600">{slides.filter((s) => s.status === "activo").length}</span> <span className="text-gray-400 text-xs">activos</span></div>
        </div>
      }
      fill>
      <CarouselManager slides={slides} filters={filters} onSaved={fetchData} />
    </HomeSection>
  );
}

export function HomePromosSection() {
  const { promos, filters, loading, fetchData } = useHomeData();
  if (loading) return <HomeLoading />;
  return (
    <HomeSection icon={Megaphone} iconClass="bg-blue-100 text-blue-600" title="Banners Promocionales" subtitle="Sección debajo de productos destacados"
      stats={
        <div className="flex gap-6 text-sm">
          <div><span className="font-bold text-gray-900">{promos.length}</span> <span className="text-gray-400 text-xs">banners</span></div>
          <div><span className="font-bold text-green-600">{promos.filter((p) => p.status === "activo").length}</span> <span className="text-gray-400 text-xs">activos</span></div>
        </div>
      }>
      <PromoManager slides={promos} filters={filters} onSaved={fetchData} />
    </HomeSection>
  );
}

export function HomeBenefitsBarSection() {
  const { benefits, loading, fetchData } = useHomeData();
  if (loading) return <HomeLoading />;
  return (
    <HomeSection icon={Zap} iconClass="bg-green-100 text-green-600" title="Barra de Beneficios" subtitle="Textos promocionales debajo del carousel de tipos">
      <BenefitsInlineEditor benefits={benefits} onSaved={fetchData} />
    </HomeSection>
  );
}

export function HomeFeaturedSection() {
  return (
    <HomeSection icon={Package} iconClass="bg-indigo-100 text-indigo-600" title="Productos Destacados" subtitle="Pestañas (Más vendidos, Promociones...) y productos asignados" fill>
      <FeaturedProductsManager />
    </HomeSection>
  );
}

export function HomeDealsSection() {
  return (
    <HomeSection icon={Clock} iconClass="bg-orange-100 text-orange-600" title="Ofertas del Día" subtitle="Display rotativo y carousel de ofertas" fill>
      <DailyDealsManager />
    </HomeSection>
  );
}

export function HomeBenefitsSection() {
  return (
    <HomeSection icon={Star} iconClass="bg-rose-100 text-rose-600" title="Beneficios" subtitle="Sección ¿Por qué comprar en Mercaldas?" fill>
      <BenefitsLandingManager />
    </HomeSection>
  );
}

export function HomeFooterSection() {
  return (
    <HomeSection icon={LayoutTemplate} iconClass="bg-violet-100 text-violet-600" title="Footer" subtitle="Configuración del pie de página del sitio">
      <FooterLandingManager />
    </HomeSection>
  );
}
