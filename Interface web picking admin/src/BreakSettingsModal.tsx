import { useEffect, useState } from 'react'
import { api, ApiError } from './services/api'
import type { PickingBreakSettings } from './types'

const DEFAULTS: PickingBreakSettings = {
  productsPerBreak: 20,
  breakMinutes: 5,
  dailyProductGoal: 100,
  dailyBonusAmount: 0,
  bankExpiryDays: 0,
}

/**
 * Configuración de descansos y metas del picking.
 *
 * Reglas: cada `productsPerBreak` unidades alistadas se ganan `breakMinutes`
 * minutos acumulables; al llegar a `dailyProductGoal` en el día se registra el
 * bono de `dailyBonusAmount`. El banco caduca a los `bankExpiryDays` (0 = nunca).
 */
export function BreakSettingsModal({
  open,
  onClose,
  notify,
}: {
  open: boolean
  onClose: () => void
  notify: (m: string) => void
}) {
  const [form, setForm] = useState<PickingBreakSettings>(DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    api
      .pickingSettings()
      .then((s) => setForm(s))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar la configuración'))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const setNum = (key: keyof PickingBreakSettings, value: string) => {
    const n = value === '' ? 0 : Number(value)
    setForm((f) => ({ ...f, [key]: Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0 }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const saved = await api.updatePickingSettings(form)
      setForm(saved)
      notify('Configuración de descansos guardada')
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la configuración')
      setSaving(false)
    }
  }

  const field = (
    key: keyof PickingBreakSettings,
    label: string,
    hint: string,
    step = '1',
  ) => (
    <label className="block">
      <span className="text-white/50 text-xs font-semibold">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={form[key]}
        onChange={(e) => setNum(key, e.target.value)}
        className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
      />
      <span className="mt-1 block text-white/30 text-[11px] font-medium">{hint}</span>
    </label>
  )

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[90dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-extrabold text-lg">Configuración</h2>
            <p className="text-white/40 text-xs font-medium">Descansos y metas del picking</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
            title="Cerrar"
            aria-label="Cerrar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-white/40 text-sm text-center py-8">Cargando…</p>
          ) : (
            <>
              <div className="rounded-xl bg-amber-400/10 border border-amber-400/25 px-3 py-2.5">
                <p className="text-amber-300 text-[11px] font-medium leading-relaxed">
                  Cada <b>{form.productsPerBreak}</b> unidades alistadas se ganan{' '}
                  <b>{form.breakMinutes} min</b> de descanso, acumulables si el picker decide
                  seguir trabajando.
                </p>
              </div>

              {field('productsPerBreak', 'Productos por descanso', 'Unidades alistadas por cada descanso ganado.')}
              {field('breakMinutes', 'Minutos por descanso', 'Minutos que otorga cada descanso ganado.')}
              {field('dailyProductGoal', 'Meta diaria de productos', 'Unidades del día para ganar el bono. 0 = sin meta.')}
              {field('dailyBonusAmount', 'Bono diario ($)', 'Importe del bono al cumplir la meta. 0 = sin bono.')}
              {field('bankExpiryDays', 'Caducidad del banco (días)', 'Días de vigencia de los minutos acumulados. 0 = nunca caduca.')}

              {error && <p className="text-red-400 text-xs font-medium">{error}</p>}
            </>
          )}
        </div>

        <div className="border-t border-white/8 px-5 py-4 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={() => void save()}
            disabled={loading || saving}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
