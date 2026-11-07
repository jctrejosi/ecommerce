import { useState, useEffect, useCallback } from "react";
import { Plus, Edit, Trash2, X, Loader2, MapPin, Package, FolderTree, Tag, Truck, Store, Phone, Mail, User } from "lucide-react";
import { branchesService, type Branch, type BranchProduct, type BranchCategory, type BranchBrand, type DeliveryZone } from "../services/branches.service";
import { useCan } from "../lib/auth-context";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Imágenes por defecto (las mismas que usa el cliente cuando la sucursal no tiene imagen propia).
const BRANCH_FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1779370139349-c5a1d667cc9e?w=400&h=260&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1759178388578-d3589d058c0f?w=400&h=260&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1758701446898-83d8dcf6309c?w=400&h=260&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1770993189356-f8def91ec5a5?w=400&h=260&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1770927423667-3c701c99ba3a?w=400&h=260&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1779370139349-c5a1d667cc9e?w=400&h=260&fit=crop&auto=format&crop=right",
  "https://images.unsplash.com/photo-1758701446898-83d8dcf6309c?w=400&h=260&fit=crop&auto=format",
];

const branchImage = (branch: { imagePath?: string | null }, index: number) =>
  branch.imagePath || BRANCH_FALLBACK_IMAGES[index % BRANCH_FALLBACK_IMAGES.length];

function openBranchMap(b: { name: string; address: string; city: string }) {
  const q = encodeURIComponent(`${b.name}, ${b.address}, ${b.city}, Colombia`);
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank");
}

const BRANCH_DAYS: { key: string; label: string }[] = [
  { key: "monday", label: "Lunes" },
  { key: "tuesday", label: "Martes" },
  { key: "wednesday", label: "Miércoles" },
  { key: "thursday", label: "Jueves" },
  { key: "friday", label: "Viernes" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
];

function branchScheduleSummary(schedule: Record<string, string> | null): string {
  if (!schedule) return "Horario no configurado";
  const filled = BRANCH_DAYS.filter((d) => schedule[d.key]?.trim());
  if (filled.length === 0) return "Horario no configurado";
  return `${filled.length} días · ${schedule[filled[0].key]}`;
}

/** Normaliza "8:00", "8:00 am", "20:00" → "HH:MM" (24h). Devuelve "" si no es válido. */
function to24(raw: string | undefined): string {
  if (!raw) return "";
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const min = m[2] ?? "00";
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || parseInt(min, 10) > 59) return "";
  return `${String(h).padStart(2, "0")}:${min}`;
}

function parseRange(value: string | undefined): { start: string; end: string } {
  if (!value) return { start: "", end: "" };
  const parts = value.split(/\s*[-–—]\s*/);
  return { start: to24(parts[0]), end: to24(parts[1]) };
}

function parseSchedule(
  schedule: Record<string, string> | null | undefined,
): Record<string, { start: string; end: string }> {
  const out: Record<string, { start: string; end: string }> = {};
  if (schedule) {
    for (const [day, value] of Object.entries(schedule)) out[day] = parseRange(value);
  }
  return out;
}

// ── Branch Editor Modal ──
function BranchModal({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!branch;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState(branch?.imagePath ?? "");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState("");
  const [f, setF] = useState({
    code: branch?.code ?? "", name: branch?.name ?? "", address: branch?.address ?? "",
    city: branch?.city ?? "Manizales", phone: branch?.phone ?? "", email: branch?.email ?? "",
    storeId: branch?.storeId?.toString() ?? "1", managerName: branch?.managerName ?? "",
    managerPhone: branch?.managerPhone ?? "", location: branch?.location ?? "",
    priority: branch?.priority?.toString() ?? "1", branchType: branch?.branchType ?? "STORE",
    deliveryRadiusKm: branch?.deliveryRadiusKm?.toString() ?? "5",
    maxDailyOrders: branch?.maxDailyOrders?.toString() ?? "", isActive: branch?.isActive ?? true,
    isVisible: branch?.isVisible ?? true,
    schedule: parseSchedule(branch?.schedule),
  });

  const set = (k: string, v: string | boolean) => setF((prev) => ({ ...prev, [k]: v }));
  const setTime = (day: string, field: "start" | "end", value: string) =>
    setF((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: { ...(prev.schedule[day] ?? { start: "", end: "" }), [field]: value },
      },
    }));

  const handleSave = async () => {
    if (!f.code || !f.name || !f.address) { setError("Código, nombre y dirección son obligatorios"); return; }
    setSaving(true); setError("");
    try {
      let finalImage = imageUrl;
      if (pendingFile) {
        const fd = new FormData();
        fd.append("file", pendingFile);
        fd.append("code", `branch_${(f.name || "sucursal").replace(/\s+/g, "_")}`);
        const res = await fetch(`${API_BASE}/upload/image`, { method: "POST", body: fd });
        if (!res.ok) throw new Error("Error al subir la imagen");
        finalImage = (await res.json()).url;
      }
      const schedule: Record<string, string> = {};
      for (const d of BRANCH_DAYS) {
        const t = f.schedule[d.key];
        if (t?.start && t?.end) schedule[d.key] = `${t.start}-${t.end}`;
      }
      const data: Record<string, unknown> = {
        ...f,
        schedule,
        storeId: parseInt(f.storeId),
        priority: parseInt(f.priority),
        deliveryRadiusKm: parseFloat(f.deliveryRadiusKm),
        maxDailyOrders: f.maxDailyOrders ? parseInt(f.maxDailyOrders) : null,
      };
      if (finalImage) data.imageUrl = finalImage;
      if (isEdit && branch) await branchesService.update(branch.id, data);
      else await branchesService.create(data);
      onSaved();
    } catch (e: any) { setError(e.message || "Error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-bold text-gray-900">{isEdit ? "Editar Sucursal" : "Nueva Sucursal"}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border-red-200 rounded-xl px-4 py-2.5">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Código *</label><input value={f.code} onChange={(e) => set("code", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Nombre *</label><input value={f.name} onChange={(e) => set("name", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Dirección *</label><input value={f.address} onChange={(e) => set("address", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Ciudad</label><input value={f.city} onChange={(e) => set("city", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Teléfono</label><input value={f.phone} onChange={(e) => set("phone", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Email</label><input value={f.email} onChange={(e) => set("email", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Encargado</label><input value={f.managerName} onChange={(e) => set("managerName", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Tel. Encargado</label><input value={f.managerPhone} onChange={(e) => set("managerPhone", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Tipo</label><select value={f.branchType} onChange={(e) => set("branchType", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl bg-white"><option>STORE</option><option>WAREHOUSE</option><option>PICKUP</option></select></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Prioridad</label><input type="number" value={f.priority} onChange={(e) => set("priority", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Radio (km)</label><input type="number" step="0.1" value={f.deliveryRadiusKm} onChange={(e) => set("deliveryRadiusKm", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Máx. pedidos/día</label><input type="number" value={f.maxDailyOrders} onChange={(e) => set("maxDailyOrders", e.target.value)} className="w-full px-3 py-2.5 text-sm border rounded-xl" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Coordenadas GPS</label><input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="5.067,-75.517" className="w-full px-3 py-2.5 text-sm border rounded-xl" /></div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Imagen</label>
            {(pendingPreview || imageUrl) ? (
              <div className="relative mb-2">
                <img src={pendingPreview || imageUrl} alt="" className="w-full h-32 object-cover rounded-xl border border-gray-200" />
                <button
                  onClick={() => { setPendingFile(null); setPendingPreview(""); setImageUrl(""); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600"
                ><X size={12} /></button>
              </div>
            ) : (
              <div className="mb-2 h-32 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-xs text-gray-400">Sin imagen</div>
            )}
            <label className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
              Subir imagen
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
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Horario</label>
            <div className="space-y-1.5">
              {BRANCH_DAYS.map((d) => {
                const t = f.schedule[d.key] ?? { start: "", end: "" };
                return (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-16 text-xs text-gray-500">{d.label}</span>
                    <input type="time" value={t.start} onChange={(e) => setTime(d.key, "start", e.target.value)} className="flex-1 min-w-0 px-2.5 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" />
                    <span className="text-xs text-gray-400">a</span>
                    <input type="time" value={t.end} onChange={(e) => setTime(d.key, "end", e.target.value)} className="flex-1 min-w-0 px-2.5 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" />
                  </div>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-amber-500" /><span className="text-sm text-gray-700">Sucursal activa</span></label>
          <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={f.isVisible} onChange={(e) => set("isVisible", e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-amber-500" /><span className="text-sm text-gray-700">Visible en la tienda</span></label>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl">{saving && <Loader2 size={14} className="animate-spin" />}{isEdit ? "Guardar" : "Crear"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Branch Detail Modal ──
function BranchDetail({ branchId, onClose }: { branchId: number; onClose: () => void }) {
  const [tab, setTab] = useState<"products" | "categories" | "brands" | "zones">("products");
  const [branch, setBranch] = useState<Branch | null>(null);
  const [products, setProducts] = useState<BranchProduct[]>([]);
  const [categories, setCategories] = useState<BranchCategory[]>([]);
  const [brands, setBrands] = useState<BranchBrand[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      branchesService.getById(branchId),
      branchesService.getProducts(branchId),
      branchesService.getCategories(branchId),
      branchesService.getBrands(branchId),
      branchesService.getDeliveryZones(branchId),
    ]).then(([b, p, c, br, z]) => {
      setBranch(b); setProducts(p); setCategories(c); setBrands(br); setZones(z);
    }).finally(() => setLoading(false));
  }, [branchId]);

  const tabs = [
    { id: "products" as const, label: "Productos", icon: Package, count: products.length },
    { id: "categories" as const, label: "Categorías", icon: FolderTree, count: categories.length },
    { id: "brands" as const, label: "Marcas", icon: Tag, count: brands.length },
    { id: "zones" as const, label: "Zonas de entrega", icon: Truck, count: zones.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-bold text-gray-900">{branch?.name || "Cargando..."}</h2>
              {branch && <p className="text-xs text-gray-500">{branch.address}, {branch.city} · {branch.phone}</p>}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${tab === t.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                <t.icon size={13} /> {t.label} <span className="text-gray-400">({t.count})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div> : (
            <>
              {tab === "products" && (
                <div className="space-y-2">
                  {products.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">Sin productos en inventario</p> : (
                    products.map((p) => (
                      <div key={p.inventoryId} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.productName}</p>
                          <p className="text-xs text-gray-400">SKU: {p.variantSku} · ${parseFloat(p.price).toLocaleString("es-CO")}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-gray-900">{p.stock} uds</p>
                          {p.reservedStock > 0 && <p className="text-xs text-amber-600">{p.reservedStock} reservadas</p>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "categories" && (
                <div className="space-y-2">
                  {categories.map((c) => (
                    <div key={c.categoryId} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                      <FolderTree size={16} className="text-gray-400 shrink-0" />
                      <div className="flex-1"><p className="text-sm font-semibold text-gray-900">{c.categoryName}</p></div>
                      <span className="text-xs text-gray-500">{c.productCount} productos</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === "brands" && (
                <div className="space-y-2">
                  {brands.map((b) => (
                    <div key={b.brandId} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                      <Tag size={16} className="text-gray-400 shrink-0" />
                      <div className="flex-1"><p className="text-sm font-semibold text-gray-900">{b.brandName}</p></div>
                      <span className="text-xs text-gray-500">{b.productCount} productos</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === "zones" && (
                <div className="space-y-2">
                  {zones.map((z) => (
                    <div key={z.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                      <Truck size={16} className="text-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{z.name}</p>
                        <p className="text-xs text-gray-400">{z.coverageArea} · {z.estimatedMinMinutes}-{z.estimatedMaxMinutes} min · ${parseFloat(z.deliveryPrice).toLocaleString("es-CO")}</p>
                      </div>
                      {z.isActive ? <span className="text-xs text-green-600 font-medium">Activa</span> : <span className="text-xs text-gray-400">Inactiva</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──
export default function Branches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Branch | null | "new">(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Branch | null>(null);
  const [activeConfirm, setActiveConfirm] = useState<Branch | null>(null);

  const canCreate = useCan("admin:catalog:branches:create");
  const canEdit = useCan("admin:catalog:branches:edit");
  const canDelete = useCan("admin:catalog:branches:delete");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try { setBranches(await branchesService.getAll()); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try { await branchesService.remove(deleteConfirm.id); setDeleteConfirm(null); fetchAll(); } catch {}
  };

  const toggleActive = async (b: Branch) => {
    const next = !b.isActive;
    setBranches((prev) => prev.map((x) => (x.id === b.id ? { ...x, isActive: next } : x)));
    try { await branchesService.update(b.id, { isActive: next }); }
    catch { setBranches((prev) => prev.map((x) => (x.id === b.id ? { ...x, isActive: b.isActive } : x))); }
  };

  const confirmActiveChange = async () => {
    if (!activeConfirm) return;
    const b = activeConfirm;
    setActiveConfirm(null);
    await toggleActive(b);
  };

  const toggleVisible = async (b: Branch) => {
    const next = !b.isVisible;
    setBranches((prev) => prev.map((x) => (x.id === b.id ? { ...x, isVisible: next } : x)));
    try { await branchesService.update(b.id, { isVisible: next }); }
    catch { setBranches((prev) => prev.map((x) => (x.id === b.id ? { ...x, isVisible: b.isVisible } : x))); }
  };

  return (
    <>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sucursales</h1>
            <p className="text-sm text-gray-500 mt-0.5">{branches.length} sucursales · datos, visibilidad, imagen, horario y zonas de entrega</p>
          </div>
          {canCreate && (
            <button onClick={() => setModal("new")} className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl"><Plus size={14} /> Nueva sucursal</button>
          )}
        </div>

        {loading ? <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div> : (
          <div className="grid md:grid-cols-2 gap-4">
            {branches.map((b, idx) => (
              <div key={b.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                <div className="relative h-32 bg-gray-100">
                  <img src={branchImage(b, idx)} alt={b.name} className="w-full h-full object-cover" />
                  <span className={`absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.isVisible ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>{b.isVisible ? "Visible" : "Oculta"}</span>
                  {!b.isActive && (
                    <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-800/80 text-white">Inactiva</span>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${b.isActive ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                        <Store size={15} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{b.name}</p>
                        <p className="text-xs text-gray-400">{b.code} · {b.branchType}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button onClick={() => setModal(b)} title="Editar" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><Edit size={13} /></button>
                      )}
                      {canDelete && (
                        <button onClick={() => setDeleteConfirm(b)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs text-gray-500 mb-3">
                    <div className="flex items-center gap-1.5"><MapPin size={11} /> {b.address}, {b.city}</div>
                    <div className="flex items-center gap-3"><span className="flex items-center gap-1"><Phone size={11} /> {b.phone}</span><span className="flex items-center gap-1"><Mail size={11} /> {b.email}</span></div>
                    <div className="flex items-center gap-1.5"><User size={11} /> {b.managerName} · {b.managerPhone}</div>
                    <div className="flex items-center gap-1.5 text-gray-400">{branchScheduleSummary(b.schedule)}</div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <div onClick={() => setDetailId(b.id)} className="flex-1 bg-amber-50 hover:bg-amber-100 rounded-xl p-2.5 text-center cursor-pointer transition-colors">
                      <p className="text-lg font-bold text-amber-700">{b.productCount}</p>
                      <p className="text-[10px] text-amber-600">productos</p>
                    </div>
                    <div onClick={() => setDetailId(b.id)} className="flex-1 bg-blue-50 hover:bg-blue-100 rounded-xl p-2.5 text-center cursor-pointer transition-colors">
                      <p className="text-lg font-bold text-blue-700">{b.orderCount}</p>
                      <p className="text-[10px] text-blue-600">pedidos</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <button onClick={() => openBranchMap(b)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-gray-600 border border-gray-200 hover:border-amber-300 hover:text-amber-600 rounded-lg transition-colors"><MapPin size={13} /> Ver mapa</button>
                    <button onClick={() => setDetailId(b.id)} className="flex-1 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">Ver detalle →</button>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setActiveConfirm(b)}
                        title={b.isActive ? "Marcar como inactiva" : "Marcar como activa"}
                        className="flex items-center gap-1.5"
                      >
                        <span className={`relative w-9 h-5 rounded-full transition-colors ${b.isActive ? "bg-green-500" : "bg-gray-300"}`}>
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${b.isActive ? "translate-x-4" : "translate-x-0"}`} />
                        </span>
                        <span className={`text-xs font-semibold ${b.isActive ? "text-green-600" : "text-gray-400"}`}>{b.isActive ? "Activa" : "Inactiva"}</span>
                      </button>
                      <button
                        onClick={() => toggleVisible(b)}
                        title={b.isVisible ? "Ocultar en la landing" : "Mostrar en la landing"}
                        className="flex items-center gap-1.5"
                      >
                        <span className={`relative w-9 h-5 rounded-full transition-colors ${b.isVisible ? "bg-blue-500" : "bg-gray-300"}`}>
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${b.isVisible ? "translate-x-4" : "translate-x-0"}`} />
                        </span>
                        <span className={`text-xs font-semibold ${b.isVisible ? "text-blue-600" : "text-gray-400"}`}>{b.isVisible ? "Visible" : "Oculta"}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && <BranchModal branch={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); fetchAll(); }} />}
      {detailId && <BranchDetail branchId={detailId} onClose={() => setDetailId(null)} />}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Eliminar sucursal</h3>
            <p className="text-sm text-gray-500 mb-5">¿Eliminar "{deleteConfirm.name}"?</p>
            <div className="flex justify-end gap-2"><button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button><button onClick={handleDelete} className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl">Eliminar</button></div>
          </div>
        </div>
      )}

      {activeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setActiveConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">
              {activeConfirm.isActive ? "Desactivar sucursal" : "Activar sucursal"}
            </h3>
            <p className="text-sm text-gray-500 mb-1">{activeConfirm.name}</p>
            <p className="text-xs text-gray-400 mb-5">
              {activeConfirm.isActive
                ? "Dejará de estar operativa (no recibirá pedidos)."
                : "Volverá a estar operativa para recibir pedidos."}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setActiveConfirm(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button
                onClick={confirmActiveChange}
                className={`px-4 py-2 text-sm font-bold text-white rounded-xl ${activeConfirm.isActive ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"}`}
              >
                {activeConfirm.isActive ? "Desactivar" : "Activar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
