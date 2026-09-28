import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Loader2, X } from 'lucide-react';
import type { FleetDriver } from '../types';
import { api, ApiError } from '../services/api';
import { driverVisual } from '../lib/status';

interface Props {
  mode: 'create' | 'edit';
  driver?: FleetDriver | null;
  onClose: () => void;
  onSaved: (driver: FleetDriver) => void;
}

interface FormState {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  vehicleType: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleColor: string;
  /** Capacidad de carga del vehículo, en litros (en la BD se guarda en cm³). */
  cargoLiters: string;
}

const VEHICLE_TYPES = ['Motocicleta', 'Automóvil', 'Camioneta', 'Bicicleta'];

const EMPTY: FormState = {
  fullName: '',
  username: '',
  email: '',
  phone: '',
  password: '',
  vehicleType: VEHICLE_TYPES[0],
  vehiclePlate: '',
  vehicleBrand: '',
  vehicleModel: '',
  vehicleColor: '',
  cargoLiters: '',
};

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

export default function DriverFormModal({ mode, driver, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [isAvailable, setIsAvailable] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (driver) {
      setForm({
        fullName: driver.fullName,
        username: driver.username ?? '',
        email: driver.email ?? '',
        phone: driver.phone ?? '',
        password: '',
        vehicleType: driver.vehicleType ?? '',
        vehiclePlate: driver.vehiclePlate ?? '',
        vehicleBrand: driver.vehicleBrand ?? '',
        vehicleModel: driver.vehicleModel ?? '',
        vehicleColor: driver.vehicleColor ?? '',
        cargoLiters: driver.cargoVolumeCm3 ? String(driver.cargoVolumeCm3 / 1000) : '',
      });
      setIsAvailable(driver.isAvailable);
      setIsActive(driver.isActive);
    }
  }, [driver]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    // Capacidad: se escribe en litros y se guarda en cm³ (1 L = 1.000 cm³).
    const cargoRaw = form.cargoLiters.trim().replace(',', '.');
    if (cargoRaw && (!Number.isFinite(Number(cargoRaw)) || Number(cargoRaw) < 1)) {
      setError('La capacidad debe ser un número mayor o igual a 1 (en litros).');
      setBusy(false);
      return;
    }
    const cargoVolumeCm3 = cargoRaw ? Math.round(Number(cargoRaw) * 1000) : null;

    try {
      if (mode === 'create') {
        const created = await api.createDriver({
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          password: form.password,
          vehicleType: form.vehicleType.trim() || undefined,
          vehiclePlate: form.vehiclePlate.trim() || undefined,
          vehicleBrand: form.vehicleBrand.trim() || undefined,
          vehicleModel: form.vehicleModel.trim() || undefined,
          vehicleColor: form.vehicleColor.trim() || undefined,
          cargoVolumeCm3: cargoVolumeCm3 ?? undefined,
        });
        onSaved(created);
      } else if (driver) {
        const updated = await api.updateDriver(driver.id, {
          fullName: form.fullName.trim() || undefined,
          username: form.username.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          vehicleType: form.vehicleType.trim() || undefined,
          vehiclePlate: form.vehiclePlate.trim() || undefined,
          vehicleBrand: form.vehicleBrand.trim() || undefined,
          vehicleModel: form.vehicleModel.trim() || undefined,
          vehicleColor: form.vehicleColor.trim() || undefined,
          cargoVolumeCm3,
          isAvailable,
          isActive,
        });
        onSaved(updated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    if (!driver || newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.resetPassword(driver.id, newPassword);
      setNewPassword('');
      setNotice('Contraseña actualizada. El repartidor ya puede ingresar con ella.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo actualizar la contraseña.');
    } finally {
      setBusy(false);
    }
  }

  const valid =
    form.fullName.trim().length >= 3 &&
    form.username.trim().length >= 3 &&
    /.+@.+\..+/.test(form.email.trim()) &&
    form.phone.trim().length >= 6 &&
    (mode === 'edit' || form.password.length >= 8);

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {mode === 'create' ? 'Nuevo repartidor' : 'Editar repartidor'}
            </h2>
            <p className="text-xs text-slate-400">
              {mode === 'create'
                ? 'Crea la cuenta con la que ingresará a la app móvil de delivery.'
                : driver?.fullName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre completo" required>
              <input
                className={inputCls}
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                placeholder="Juan Pérez"
              />
            </Field>
            <Field label="Teléfono" required>
              <input
                className={inputCls}
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="3001234567"
              />
            </Field>
            <Field label="Usuario de acceso" required>
              <input
                className={inputCls}
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                placeholder="juan.perez"
                autoComplete="off"
              />
            </Field>
            <Field label="Email" required>
              <input
                className={inputCls}
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="juan@mercaldas.com"
                autoComplete="off"
              />
            </Field>
          </div>

          {mode === 'create' && (
            <Field label="Contraseña inicial" required>
              <input
                className={inputCls}
                type="text"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                El repartidor la usará para loguear en la app móvil.
              </span>
            </Field>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-600">Vehículo</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">
                <select
                  className={inputCls}
                  value={form.vehicleType}
                  onChange={(e) => set('vehicleType', e.target.value)}
                >
                  {VEHICLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Placa">
                <input
                  className={inputCls}
                  value={form.vehiclePlate}
                  onChange={(e) => set('vehiclePlate', e.target.value)}
                  placeholder="ABC-123"
                />
              </Field>
              <Field label="Marca">
                <input
                  className={inputCls}
                  value={form.vehicleBrand}
                  onChange={(e) => set('vehicleBrand', e.target.value)}
                  placeholder="Yamaha"
                />
              </Field>
              <Field label="Modelo">
                <input
                  className={inputCls}
                  value={form.vehicleModel}
                  onChange={(e) => set('vehicleModel', e.target.value)}
                  placeholder="NMAX 2023"
                />
              </Field>
              <Field label="Capacidad (litros)">
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  step={1}
                  value={form.cargoLiters}
                  onChange={(e) => set('cargoLiters', e.target.value)}
                  placeholder="120"
                />
              </Field>
            </div>
            <span className="mt-1.5 block text-[11px] text-slate-400">
              Cuánto cabe en el vehículo. Se usa para validar que los pedidos
              asignados no superen su capacidad; sin declararla, no se valida.
            </span>
          </div>

          {mode === 'edit' && (
            <div className="flex gap-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <label className="flex flex-1 items-center justify-between text-sm text-slate-700">
                Disponible
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
              <label className="flex flex-1 items-center justify-between text-sm text-slate-700">
                Cuenta activa
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700">
              {notice}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !valid}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'create' ? 'Crear repartidor' : 'Guardar cambios'}
            </button>
          </div>
        </form>

        {mode === 'edit' && (
          <div className="border-t border-slate-100 bg-slate-50 p-5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
              <KeyRound className="h-3.5 w-3.5" /> Restablecer contraseña
            </p>
            <div className="flex gap-2">
              <input
                className={inputCls}
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nueva contraseña (mín. 8)"
                autoComplete="off"
              />
              <button
                onClick={handleResetPassword}
                disabled={busy || newPassword.length < 8}
                className="shrink-0 rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-amber-950 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Actualizar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
