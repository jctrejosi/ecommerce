import { useRef, useState } from "react";
import { Loader2, X, User as UserIcon, KeyRound, CheckCircle, Camera, Trash2 } from "lucide-react";
import { authService, type UserProfile } from "../services/auth.service";
import { resolveApiBaseUrl } from "../lib/api";

const inputCls =
  "w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300";

export default function ProfileModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserProfile;
  onClose: () => void;
  onSaved: (u: UserProfile) => void;
}) {
  const [tab, setTab] = useState<"perfil" | "password">("perfil");

  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const uploadAvatar = async (file: File) => {
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("code", `avatar_${user.id}`);
      fd.append("resize", "512");
      const res = await fetch(`${resolveApiBaseUrl()}/upload/image`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) throw new Error("No se pudo subir la imagen");
      const { url } = (await res.json()) as { url: string };
      const updated = await authService.updateProfile({ avatarUrl: url });
      setAvatarUrl(url);
      onSaved(updated);
      setAvatarMsg({ ok: true, text: "Imagen de perfil actualizada" });
    } catch (e) {
      setAvatarMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Error al subir la imagen",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      const updated = await authService.updateProfile({ avatarUrl: "" });
      setAvatarUrl("");
      onSaved(updated);
      setAvatarMsg({ ok: true, text: "Imagen de perfil eliminada" });
    } catch (e) {
      setAvatarMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Error al eliminar la imagen",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((n) => n?.[0] ?? "")
    .join("")
    .toUpperCase() || user.username?.[0]?.toUpperCase() || "U";

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const updated = await authService.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      onSaved(updated);
      setProfileMsg({ ok: true, text: "Perfil actualizado" });
    } catch (e) {
      setProfileMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Error al guardar",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (next.length < 8) {
      setPwdMsg({ ok: false, text: "La nueva contraseña debe tener al menos 8 caracteres" });
      return;
    }
    if (next !== repeat) {
      setPwdMsg({ ok: false, text: "Las contraseñas no coinciden" });
      return;
    }
    setSavingPwd(true);
    setPwdMsg(null);
    try {
      await authService.changePassword(current, next);
      setPwdMsg({ ok: true, text: "Contraseña actualizada" });
      setCurrent("");
      setNext("");
      setRepeat("");
    } catch (e) {
      setPwdMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Error al cambiar la contraseña",
      });
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-full overflow-hidden bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Imagen de perfil" className="w-full h-full object-cover" />
              ) : (
                <span className="text-base font-bold text-white">{initials}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              title="Cambiar imagen de perfil"
              className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-amber-600 disabled:opacity-50"
            >
              {uploadingAvatar ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Camera size={11} />
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate">{user.fullName}</p>
            <p className="text-xs text-gray-400 truncate">
              {user.username} · {user.email}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 disabled:opacity-50"
              >
                {avatarUrl ? "Cambiar foto" : "Añadir foto"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  disabled={uploadingAvatar}
                  className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50"
                >
                  <Trash2 size={11} /> Quitar
                </button>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"
          >
            <X size={16} />
          </button>
        </div>

        {avatarMsg && (
          <p
            className={`px-5 pt-2 text-xs ${avatarMsg.ok ? "text-green-600" : "text-red-500"}`}
          >
            {avatarMsg.text}
          </p>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab("perfil")}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold transition-colors ${
              tab === "perfil"
                ? "text-amber-600 border-b-2 border-amber-400"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <UserIcon size={13} /> Mi perfil
          </button>
          <button
            onClick={() => setTab("password")}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold transition-colors ${
              tab === "password"
                ? "text-amber-600 border-b-2 border-amber-400"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <KeyRound size={13} /> Contraseña
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {tab === "perfil" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Apellido</label>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Teléfono</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Usuario</label>
                <input value={user.username} disabled className={`${inputCls} bg-gray-50 text-gray-400`} />
                <p className="text-[11px] text-gray-400 mt-1">
                  El nombre de usuario no se puede cambiar desde aquí.
                </p>
              </div>

              {profileMsg && (
                <p className={`text-xs ${profileMsg.ok ? "text-green-600" : "text-red-500"}`}>
                  {profileMsg.text}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl">
                  Cancelar
                </button>
                <button
                  onClick={saveProfile}
                  disabled={savingProfile}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl disabled:opacity-50"
                >
                  {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Guardar
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Contraseña actual</label>
                <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} autoComplete="current-password" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Nueva contraseña</label>
                <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Repetir nueva contraseña</label>
                <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={inputCls} autoComplete="new-password" />
              </div>

              {pwdMsg && (
                <p className={`text-xs ${pwdMsg.ok ? "text-green-600" : "text-red-500"}`}>
                  {pwdMsg.text}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl">
                  Cancelar
                </button>
                <button
                  onClick={savePassword}
                  disabled={savingPwd || !current || !next}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl disabled:opacity-50"
                >
                  {savingPwd ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  Cambiar contraseña
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
