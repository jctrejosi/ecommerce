import { useState } from "react";
import { Loader2, Lock, User as UserIcon, AlertCircle } from "lucide-react";
import { authService, type UserProfile } from "../services/auth.service";
import AppFooter from "../components/AppFooter";
import logo from "../assets/logo.png";

export default function Login({ onSuccess }: { onSuccess: (user: UserProfile) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError("Ingresa usuario y contraseña");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const user = await authService.login(identifier.trim(), password);
      onSuccess(user);
    } catch (err: any) {
      setError(err?.message || "Credenciales inválidas");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-6">
            <img src={logo} alt="Mercaldas" className="h-8 w-auto object-contain mb-3" />
            <h1 className="text-lg font-bold text-gray-900">Panel administrativo</h1>
            <p className="text-xs text-gray-500 mt-0.5">Inicia sesión para continuar</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4"
          >
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Usuario o correo
            </label>
            <div className="relative">
              <UserIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin-ecommerce"
                autoComplete="username"
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
        </div>
      </div>

      <AppFooter />
    </div>
  );
}
