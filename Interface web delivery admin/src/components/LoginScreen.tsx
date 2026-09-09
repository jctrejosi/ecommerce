import { useState, type FormEvent } from 'react';
import { Bike, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { api, ApiError } from '../services/api';
import type { AuthUser } from '../types';

interface Props {
  onLogin: (token: string, user: AuthUser) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(identifier.trim(), password);
      if (!res.user?.isSuperuser) {
        setError('Esta cuenta no tiene permisos de administrador.');
        return;
      }
      onLogin(res.accessToken, res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 shadow-lg shadow-amber-400/30">
            <Bike className="h-8 w-8 text-slate-900" />
          </div>
          <h1 className="text-2xl font-bold text-white">MercAldas Delivery</h1>
          <p className="mt-1 text-sm text-slate-400">
            Panel administrativo de repartidores
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white p-6 shadow-2xl"
        >
          <label className="block text-sm font-semibold text-slate-700">
            Usuario o email
            <div className="relative mt-1.5">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="admin@tienda.com"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-200"
              />
            </div>
          </label>

          <label className="mt-4 block text-sm font-semibold text-slate-700">
            Contraseña
            <div className="relative mt-1.5">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-10 text-sm outline-none transition focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-200"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {error && (
            <div className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !identifier.trim() || !password}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Acceso restringido a administradores · MercAldas
        </p>
      </div>
    </div>
  );
}
