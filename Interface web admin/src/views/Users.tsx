import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Shield,
  Check,
  X,
  Users as UsersIcon,
  Loader2,
  Trash2,
  KeyRound,
  Search,
  Edit,
  Save,
} from "lucide-react";
import {
  adminUsersService,
  type AdminUser,
  type PermissionModule,
  type Role,
  type UserKind,
} from "../services/admin-users.service";

const KIND_LABEL: Record<UserKind, string> = {
  admin: "Admin",
  picking: "Picking",
  delivery: "Delivery",
};

const KIND_COLOR: Record<UserKind, string> = {
  admin: "bg-red-100 text-red-700",
  picking: "bg-green-100 text-green-700",
  delivery: "bg-blue-100 text-blue-700",
};

interface UserFormState {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  isSuperuser: boolean;
  isActive: boolean;
  roleIds: number[];
}

const EMPTY_USER_FORM: UserFormState = {
  fullName: "",
  username: "",
  email: "",
  phone: "",
  password: "",
  isSuperuser: false,
  isActive: true,
  roleIds: [],
};

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="mt-10 w-full max-w-lg bg-white rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full px-3 py-2 text-sm text-gray-800 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300";

export default function UsersView() {
  const [tab, setTab] = useState<"usuarios" | "roles">("usuarios");

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionModules, setPermissionModules] = useState<PermissionModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<UserKind | "all">("all");
  const [search, setSearch] = useState("");

  // Modales
  const [userModal, setUserModal] = useState<{ mode: "create" } | { mode: "edit"; user: AdminUser } | null>(null);
  const [resetModal, setResetModal] = useState<AdminUser | null>(null);
  const [roleModal, setRoleModal] = useState<{ mode: "create" } | { mode: "edit"; role: Role } | null>(null);

  // Matriz de permisos
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [savingPerms, setSavingPerms] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, r, p] = await Promise.all([
        adminUsersService.getUsers(),
        adminUsersService.getRoles(),
        adminUsersService.getPermissions(),
      ]);
      setUsers(u);
      setRoles(r);
      setPermissionModules(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar los datos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshUsers = useCallback(async () => {
    const u = await adminUsersService.getUsers();
    setUsers(u);
  }, []);

  const refreshRoles = useCallback(async () => {
    const r = await adminUsersService.getRoles();
    setRoles(r);
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (kindFilter !== "all" && !u.kinds.includes(kindFilter)) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
      );
    });
  }, [users, kindFilter, search]);

  async function openRolePermissions(role: Role) {
    setSelectedRole(role);
    try {
      const { permissionCodes } = await adminUsersService.getRolePermissions(role.id);
      setSelectedCodes(new Set(permissionCodes));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar permisos");
    }
  }

  async function togglePermission(code: string) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function savePermissions() {
    if (!selectedRole) return;
    setSavingPerms(true);
    setError(null);
    try {
      await adminUsersService.setRolePermissions(selectedRole.id, Array.from(selectedCodes));
      await refreshRoles();
      setSelectedRole((r) => (r ? { ...r, permissionCount: selectedCodes.size } : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar permisos");
    } finally {
      setSavingPerms(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios y Permisos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gestiona el acceso al panel, delivery y picking
          </p>
        </div>
        <button
          onClick={() => setUserModal({ mode: "create" })}
          className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors"
        >
          <Plus size={14} /> Nuevo usuario
        </button>
      </div>

      <div className="flex gap-1 border-b border-gray-100">
        {(["usuarios", "roles"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 capitalize transition-colors ${
              tab === t
                ? "border-amber-400 text-amber-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "roles" ? "Roles y permisos" : "Usuarios"}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm flex items-center gap-2">
          <X size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          {tab === "usuarios" && (
            <UserTab
              users={filteredUsers}
              kindFilter={kindFilter}
              setKindFilter={setKindFilter}
              search={search}
              setSearch={setSearch}
              onEdit={(u) => setUserModal({ mode: "edit", user: u })}
              onReset={(u) => setResetModal(u)}
            />
          )}

          {tab === "roles" && (
            <RoleTab
              roles={roles}
              permissionModules={permissionModules}
              selectedRole={selectedRole}
              selectedCodes={selectedCodes}
              savingPerms={savingPerms}
              onSelectRole={openRolePermissions}
              onCreateRole={() => setRoleModal({ mode: "create" })}
              onEditRole={(r) => setRoleModal({ mode: "edit", role: r })}
              onDeleteRole={async (r) => {
                if (!window.confirm(`¿Eliminar el rol "${r.name}"?`)) return;
                try {
                  await adminUsersService.deleteRole(r.id);
                  await refreshRoles();
                  setSelectedRole(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Error al eliminar rol");
                }
              }}
              onTogglePermission={togglePermission}
              onSavePermissions={savePermissions}
            />
          )}
        </>
      )}

      {userModal && (
        <UserModal
          initial={userModal.mode === "edit" ? userModal.user : null}
          roles={roles}
          onClose={() => setUserModal(null)}
          onSaved={async () => {
            setUserModal(null);
            await refreshUsers();
          }}
        />
      )}

      {resetModal && (
        <ResetModal
          user={resetModal}
          onClose={() => setResetModal(null)}
        />
      )}

      {roleModal && (
        <RoleModal
          initial={roleModal.mode === "edit" ? roleModal.role : null}
          onClose={() => setRoleModal(null)}
          onSaved={async () => {
            setRoleModal(null);
            await refreshRoles();
          }}
        />
      )}
    </div>
  );
}

/* ── Usuarios ─────────────────────────────────────────────────────────────── */

function UserTab({
  users,
  kindFilter,
  setKindFilter,
  search,
  setSearch,
  onEdit,
  onReset,
}: {
  users: AdminUser[];
  kindFilter: UserKind | "all";
  setKindFilter: (k: UserKind | "all") => void;
  search: string;
  setSearch: (s: string) => void;
  onEdit: (u: AdminUser) => void;
  onReset: (u: AdminUser) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2">
          <Search size={14} className="text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar usuario…"
            className="text-sm bg-transparent outline-none w-48"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "admin", "picking", "delivery"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full capitalize transition-colors ${
                kindFilter === k
                  ? "bg-gray-900 text-white"
                  : "bg-white border border-gray-200 text-gray-500 hover:text-gray-700"
              }`}
            >
              {k === "all" ? "Todos" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {["Usuario", "Tipo", "Roles", "Estado", "Último acceso", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                  No hay usuarios que coincidan.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-linear-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {u.firstName?.[0] || "?"}
                      {u.lastName?.[0] || ""}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{u.fullName}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.kinds.map((k) => (
                      <span key={k} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${KIND_COLOR[k]}`}>
                        {KIND_LABEL[k]}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-60">
                    {u.isSuperuser && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                        Super
                      </span>
                    )}
                    {u.roles.map((r) => (
                      <span key={r.id} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {r.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {u.isActive ? "activo" : "inactivo"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("es-CO") : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      onClick={() => onReset(u)}
                      title="Restablecer contraseña"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"
                    >
                      <KeyRound size={13} />
                    </button>
                    <button
                      onClick={() => onEdit(u)}
                      title="Editar"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"
                    >
                      <Edit size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Roles y permisos ─────────────────────────────────────────────────────── */

function RoleTab({
  roles,
  permissionModules,
  selectedRole,
  selectedCodes,
  savingPerms,
  onSelectRole,
  onCreateRole,
  onEditRole,
  onDeleteRole,
  onTogglePermission,
  onSavePermissions,
}: {
  roles: Role[];
  permissionModules: PermissionModule[];
  selectedRole: Role | null;
  selectedCodes: Set<string>;
  savingPerms: boolean;
  onSelectRole: (r: Role) => void;
  onCreateRole: () => void;
  onEditRole: (r: Role) => void;
  onDeleteRole: (r: Role) => void;
  onTogglePermission: (code: string) => void;
  onSavePermissions: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectRole(r)}
            className={`bg-white rounded-2xl border p-4 text-left hover:shadow-sm transition-shadow ${
              selectedRole?.id === r.id ? "border-amber-400 ring-1 ring-amber-200" : "border-gray-100"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Shield size={15} />
                </div>
                <p className="text-sm font-bold text-gray-900">{r.name}</p>
              </div>
              {r.isSystem && (
                <span className="text-[10px] font-bold uppercase text-gray-400">Sistema</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2 line-clamp-2">{r.description}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
              <span>{r.userCount} usuarios</span>
              <span>{r.permissionCount} permisos</span>
            </div>
          </button>
        ))}

        <button
          onClick={onCreateRole}
          className="rounded-2xl border-2 border-dashed border-gray-200 p-4 text-left hover:border-amber-300 transition-colors flex items-center justify-center gap-2 text-sm font-semibold text-gray-400 hover:text-amber-600"
        >
          <Plus size={15} /> Nuevo rol
        </button>
      </div>

      {selectedRole ? (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">
                Permisos del rol: {selectedRole.name}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Marca los permisos que tendrá este rol en cada interface.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!selectedRole.isSystem && (
                <>
                  <button
                    onClick={() => onEditRole(selectedRole)}
                    className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => onDeleteRole(selectedRole)}
                    className="px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg flex items-center gap-1"
                  >
                    <Trash2 size={12} /> Eliminar
                  </button>
                </>
              )}
              <button
                onClick={onSavePermissions}
                disabled={savingPerms}
                className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-lg flex items-center gap-1 disabled:opacity-60"
              >
                {savingPerms ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Guardar
              </button>
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {permissionModules.map((mod) => (
              <div key={mod.module} className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">
                  {mod.module === "admin"
                    ? "Web Admin"
                    : mod.module === "delivery"
                      ? "Delivery Admin"
                      : "Picking Admin"}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {mod.permissions.map((p) => {
                    const active = selectedCodes.has(p.code);
                    return (
                      <button
                        key={p.code}
                        onClick={() => onTogglePermission(p.code)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
                          active ? "bg-amber-50 text-gray-800" : "text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                            active ? "bg-amber-400 border-amber-400 text-amber-900" : "border-gray-300"
                          }`}
                        >
                          {active && <Check size={11} />}
                        </span>
                        <span>
                          <span className="block font-medium">{p.description}</span>
                          <span className="block text-[11px] text-gray-400 font-mono">{p.code}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center text-sm text-gray-400">
          Selecciona un rol para gestionar sus permisos.
        </div>
      )}
    </div>
  );
}

/* ── Modales ──────────────────────────────────────────────────────────────── */

function UserModal({
  initial,
  roles,
  onClose,
  onSaved,
}: {
  initial: AdminUser | null;
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(initial);
  const [form, setForm] = useState<UserFormState>(() =>
    initial
      ? {
          fullName: initial.fullName,
          username: initial.username,
          email: initial.email,
          phone: initial.phone ?? "",
          password: "",
          isSuperuser: initial.isSuperuser,
          isActive: initial.isActive,
          roleIds: initial.roles.map((r) => r.id),
        }
      : { ...EMPTY_USER_FORM },
  );
  const [kinds, setKinds] = useState<("picking" | "delivery")[]>(() =>
    initial ? initial.kinds.filter((k): k is "picking" | "delivery" => k !== "admin") : [],
  );
  const [vehicleType, setVehicleType] = useState("MOTO");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleKind(k: "picking" | "delivery") {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const isPicker = kinds.includes("picking");
      const isDelivery = kinds.includes("delivery");
      if (editing && initial) {
        await adminUsersService.updateUser(initial.id, {
          fullName: form.fullName,
          username: form.username,
          email: form.email,
          phone: form.phone || undefined,
          isSuperuser: form.isSuperuser,
          isActive: form.isActive,
          isPicker,
          isDelivery,
          vehicleType: isDelivery ? vehicleType : undefined,
          roleIds: form.roleIds,
        });
      } else {
        await adminUsersService.createUser({
          fullName: form.fullName,
          username: form.username,
          email: form.email,
          phone: form.phone || undefined,
          password: form.password,
          isSuperuser: form.isSuperuser,
          isActive: form.isActive,
          isPicker,
          isDelivery,
          vehicleType: isDelivery ? vehicleType : undefined,
          roleIds: form.roleIds,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "Editar usuario" : "Nuevo usuario"} onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{err}</div>}

        <Field label="Nombre completo">
          <input className={inputCls} value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Usuario">
            <input className={inputCls} value={form.username} onChange={(e) => set("username", e.target.value)} />
          </Field>
          <Field label="Teléfono">
            <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
        </div>

        <Field label="Email">
          <input className={inputCls} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>

        {!editing && (
          <Field label="Contraseña">
            <input className={inputCls} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
          </Field>
        )}

        <Field label="Tipos de acceso">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setKinds([])}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${
                kinds.length === 0
                  ? "bg-amber-400 text-amber-900 border-amber-400"
                  : "bg-white text-gray-500 border-gray-200 hover:text-gray-700"
              }`}
            >
              Admin
            </button>
            {(["picking", "delivery"] as const).map((k) => {
              const active = kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleKind(k)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${
                    active
                      ? "bg-amber-400 text-amber-900 border-amber-400"
                      : "bg-white text-gray-500 border-gray-200 hover:text-gray-700"
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
          {kinds.length === 0 && (
            <p className="text-[11px] text-gray-400 mt-1">Usuario del panel (web admin).</p>
          )}
        </Field>

        {kinds.includes("delivery") && (
          <Field label="Tipo de vehículo">
            <select className={inputCls} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
              <option value="MOTO">Moto</option>
              <option value="CARRO">Carro</option>
              <option value="BICICLETA">Bicicleta</option>
              <option value="FURGONETA">Furgoneta</option>
            </select>
          </Field>
        )}

        <Field label="Roles">
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => {
              const active = form.roleIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() =>
                    set(
                      "roleIds",
                      active ? form.roleIds.filter((id) => id !== r.id) : [...form.roleIds, r.id],
                    )
                  }
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${
                    active
                      ? "bg-amber-400 text-amber-900 border-amber-400"
                      : "bg-white text-gray-500 border-gray-200 hover:text-gray-700"
                  }`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="space-y-2 pt-1">
          <Toggle checked={form.isSuperuser} onChange={(v) => set("isSuperuser", v)} label="Superadministrador (acceso total)" />
          <Toggle checked={form.isActive} onChange={(v) => set("isActive", v)} label="Cuenta activa" />
        </div>

        <div className="flex justify-end gap-2 pt-3">
          <button onClick={onClose} className="px-3 py-2 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-gray-700"
    >
      <span
        className={`w-9 h-5 rounded-full relative transition-colors ${
          checked ? "bg-amber-400" : "bg-gray-200"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

function ResetModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await adminUsersService.resetPassword(user.id, password);
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al restablecer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Restablecer contraseña — ${user.fullName}`} onClose={onClose}>
      {done ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-gray-600">Contraseña actualizada correctamente.</p>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 rounded-xl">
            Listo
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {err && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{err}</div>}
          <Field label="Nueva contraseña">
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-xl">
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={saving || password.length < 8}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 rounded-xl disabled:opacity-60"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Restablecer
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RoleModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Role | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      if (editing && initial) {
        await adminUsersService.updateRole(initial.id, { name, description });
      } else {
        await adminUsersService.createRole({ name, description });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "Editar rol" : "Nuevo rol"} onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{err}</div>}
        <Field label="Nombre">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción">
          <textarea
            className={inputCls}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-xl">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving || name.trim().length < 2}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 rounded-xl disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  );
}
