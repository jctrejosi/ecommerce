import { useRef, useState } from 'react';
import {
  Camera,
  CheckCircle,
  KeyRound,
  Loader2,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import type { AuthUser } from '../types';
import { api, ApiError } from '../services/api';
import { initials } from '../lib/format';

const inputCls =
  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft';

type Msg = { ok: boolean; text: string } | null;

const mensaje = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

/**
 * "Mi perfil" del panel: datos del usuario autenticado, cambio de contraseña y
 * foto de perfil (se sube a Cloudinary y se guarda su URL en el usuario).
 */
export default function ProfileModal({
  user,
  onClose,
  onSaved,
}: {
  user: AuthUser;
  onClose: () => void;
  onSaved: (u: AuthUser) => void;
}) {
  const [tab, setTab] = useState<'perfil' | 'password'>('perfil');

  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<Msg>(null);

  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<Msg>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const siglas =
    initials([firstName, lastName].filter(Boolean).join(' ')) ||
    initials(user.fullName || user.username) ||
    'U';

  const uploadAvatar = async (file: File) => {
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      const { url } = await api.uploadImage(file, `avatar_${user.id}`);
      const updated = await api.updateProfile({ avatarUrl: url });
      setAvatarUrl(url);
      onSaved(updated);
      setAvatarMsg({ ok: true, text: 'Imagen de perfil actualizada' });
    } catch (e) {
      setAvatarMsg({ ok: false, text: mensaje(e, 'Error al subir la imagen') });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      const updated = await api.updateProfile({ avatarUrl: '' });
      setAvatarUrl('');
      onSaved(updated);
      setAvatarMsg({ ok: true, text: 'Imagen de perfil eliminada' });
    } catch (e) {
      setAvatarMsg({ ok: false, text: mensaje(e, 'Error al eliminar la imagen') });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const updated = await api.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      onSaved(updated);
      setProfileMsg({ ok: true, text: 'Perfil actualizado' });
    } catch (e) {
      setProfileMsg({ ok: false, text: mensaje(e, 'No se pudo guardar') });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (next.length < 8) {
      setPwdMsg({ ok: false, text: 'La nueva contraseña debe tener al menos 8 caracteres' });
      return;
    }
    if (next !== repeat) {
      setPwdMsg({ ok: false, text: 'Las contraseñas no coinciden' });
      return;
    }
    setSavingPwd(true);
    setPwdMsg(null);
    try {
      await api.changePassword(current, next);
      setPwdMsg({ ok: true, text: 'Contraseña actualizada' });
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (e) {
      setPwdMsg({ ok: false, text: mensaje(e, 'No se pudo cambiar la contraseña') });
    } finally {
      setSavingPwd(false);
    }
  };

  const tabBtn = (key: 'perfil' | 'password', label: string, Icon: typeof UserIcon) => (
    <button
      onClick={() => setTab(key)}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-bold transition-colors ${
        tab === key
          ? 'border-accent text-ink'
          : 'border-transparent text-ink-faint hover:text-ink-soft'
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center bg-overlay/50 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface shadow-2xl">
        {/* Cabecera con la foto de perfil */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div className="relative shrink-0">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-invert text-base font-bold text-invert-ink">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Imagen de perfil" className="h-full w-full object-cover" />
              ) : (
                siglas
              )}
            </div>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              title="Cambiar imagen de perfil"
              className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-ink-faint shadow transition hover:text-accent-strong disabled:opacity-50"
            >
              {uploadingAvatar ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Camera className="h-3 w-3" />
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">{user.fullName}</p>
            <p className="truncate text-xs text-ink-faint">
              {user.username} · {user.email}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="text-[11px] font-semibold text-accent-strong hover:underline disabled:opacity-50"
              >
                {avatarUrl ? 'Cambiar foto' : 'Añadir foto'}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => void removeAvatar()}
                  disabled={uploadingAvatar}
                  className="flex items-center gap-1 text-[11px] font-semibold text-ink-faint hover:text-rose-500 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> Quitar
                </button>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {avatarMsg && (
          <p
            className={`px-5 pt-2 text-xs font-semibold ${avatarMsg.ok ? 'text-emerald-600' : 'text-rose-500'}`}
          >
            {avatarMsg.text}
          </p>
        )}

        {/* Pestañas */}
        <div className="flex border-b border-line px-2">
          {tabBtn('perfil', 'Mi perfil', UserIcon)}
          {tabBtn('password', 'Contraseña', KeyRound)}
        </div>

        <div className="space-y-3 p-5">
          {tab === 'perfil' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-soft">Nombre</span>
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-soft">Apellido</span>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">Teléfono</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">Usuario</span>
                <input
                  value={user.username}
                  disabled
                  className={`${inputCls} text-ink-faint opacity-70`}
                />
                <span className="mt-1 block text-[11px] text-ink-faint">
                  El nombre de usuario no se puede cambiar desde aquí.
                </span>
              </label>

              {profileMsg && (
                <p
                  className={`text-xs font-semibold ${profileMsg.ok ? 'text-emerald-600' : 'text-rose-500'}`}
                >
                  {profileMsg.text}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void saveProfile()}
                  disabled={savingProfile}
                  className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingProfile ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Guardar
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">
                  Contraseña actual
                </span>
                <input
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  className={inputCls}
                  autoComplete="current-password"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">
                  Nueva contraseña
                </span>
                <input
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  className={inputCls}
                  autoComplete="new-password"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">
                  Repetir nueva contraseña
                </span>
                <input
                  type="password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className={inputCls}
                  autoComplete="new-password"
                />
              </label>

              {pwdMsg && (
                <p
                  className={`text-xs font-semibold ${pwdMsg.ok ? 'text-emerald-600' : 'text-rose-500'}`}
                >
                  {pwdMsg.text}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void savePassword()}
                  disabled={savingPwd || !current || !next}
                  className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingPwd ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
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
