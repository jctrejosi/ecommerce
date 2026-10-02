import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { api, ApiError, API_BASE_URL } from '../services/api';
import type { AuthUser } from '../types';
import AppFooter from './AppFooter';

interface Props {
  onLogin: (token: string, user: AuthUser) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Logo de la tienda configurado en el panel (endpoint público).
  const [storeLogo, setStoreLogo] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/admin/landing/general-logo`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string } | null) => {
        if (d?.url) setStoreLogo(d.url);
      })
      .catch(() => {
        /* sin logo de tienda: se muestra solo el título */
      });
  }, []);

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
    <div className="login-bg flex min-h-full flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            {storeLogo && (
              <img
                src={storeLogo}
                alt="Tienda"
                className="mx-auto mb-5 h-10 w-auto object-contain"
              />
            )}
            <h1 className="text-2xl font-bold text-white">Mercaldas Delivery</h1>
            <p className="mt-1 text-sm text-ink-faint">
              Panel administrativo de repartidores
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-surface p-6 shadow-2xl"
          >
          <label className="block text-sm font-semibold text-ink-soft">
            Usuario o email
            <div className="relative mt-1.5">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="admin@tienda.com"
                className="w-full rounded-xl border border-line bg-surface-2 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft"
              />
            </div>
          </label>

          <label className="mt-4 block text-sm font-semibold text-ink-soft">
            Contraseña
            <div className="relative mt-1.5">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-xl border border-line bg-surface-2 py-2.5 pl-9 pr-10 text-sm outline-none transition focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-soft"
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
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-invert py-2.5 text-sm font-bold text-invert-ink transition hover:bg-invert/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-faint">
          Acceso restringido a administradores · Mercaldas
        </p>
        </div>
      </div>

      {/* Logo (logo.png) y copyright, al pie */}
      <AppFooter />
    </div>
  );
}
