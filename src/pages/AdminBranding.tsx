import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ImagePlus, RefreshCw, Search, Trash2 } from 'lucide-react'
import {
  autoLogoForUrl,
  deletePanelLogo,
  fetchBrandingSettings,
  fetchPanelLogos,
  saveBrandingSettings,
  upsertPanelLogo,
} from '../lib/queries'
import { ACCENTS, THEME_MODES } from '../lib/theme'
import { Button, EmptyState, Field, Input, Select } from '../components/ui'
import type { AccentColor, MenuStyle, ThemeMode } from '../lib/types'

const STYLE_LABELS: Record<MenuStyle, string> = {
  top: 'Barra superior',
  side: 'Lateral',
  dock: 'Flotante inferior (iOS)',
}

export default function AdminBranding() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['super-settings'], queryFn: fetchBrandingSettings })
  const logosQuery = useQuery({ queryKey: ['panel-logos'], queryFn: fetchPanelLogos })

  const [siteName, setSiteName] = useState('SuperPanel')
  const [defaultStyle, setDefaultStyle] = useState<MenuStyle>('dock')
  const [defaultMode, setDefaultMode] = useState<ThemeMode>('dark')
  const [defaultAccent, setDefaultAccent] = useState<AccentColor>('sky')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState('')

  const [newDomain, setNewDomain] = useState('')
  const [newLogoUrl, setNewLogoUrl] = useState('')
  const [logoError, setLogoError] = useState('')
  const [savingLogo, setSavingLogo] = useState(false)

  // Ediciones en línea de logos existentes
  const [edits, setEdits] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settingsQuery.data) {
      setSiteName(settingsQuery.data.site_name)
      setDefaultStyle(settingsQuery.data.default_menu_style)
      setDefaultMode(settingsQuery.data.default_theme_mode)
      setDefaultAccent(settingsQuery.data.default_accent)
    }
  }, [settingsQuery.data])

  const logos = logosQuery.data ?? []

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    setSettingsMsg('')
    try {
      await saveBrandingSettings({
        site_name: siteName.trim() || 'SuperPanel',
        default_menu_style: defaultStyle,
        default_theme_mode: defaultMode,
        default_accent: defaultAccent,
      })
      await qc.invalidateQueries({ queryKey: ['super-settings'] })
      setSettingsMsg('Guardado')
      window.setTimeout(() => setSettingsMsg(''), 2000)
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSavingSettings(false)
    }
  }

  async function onAddLogo(e: FormEvent) {
    e.preventDefault()
    setLogoError('')
    const domain = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!domain.includes('.')) {
      setLogoError('Introduce un dominio válido (ej: oneprovider.com)')
      return
    }
    if (!newLogoUrl.trim()) {
      setLogoError('Falta la URL del logo')
      return
    }
    setSavingLogo(true)
    try {
      await upsertPanelLogo(domain, newLogoUrl.trim())
      setNewDomain('')
      setNewLogoUrl('')
      await qc.invalidateQueries({ queryKey: ['panel-logos'] })
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSavingLogo(false)
    }
  }

  async function onSaveExistingLogo(domain: string) {
    const url = edits[domain]?.trim()
    if (!url) return
    setLogoError('')
    try {
      await upsertPanelLogo(domain, url)
      setEdits((prev) => {
        const next = { ...prev }
        delete next[domain]
        return next
      })
      await qc.invalidateQueries({ queryKey: ['panel-logos'] })
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  async function onDeleteLogo(domain: string) {
    if (!window.confirm(`¿Eliminar el logo guardado de «${domain}»?`)) return
    setLogoError('')
    try {
      await deletePanelLogo(domain)
      await qc.invalidateQueries({ queryKey: ['panel-logos'] })
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Personalización</h1>
        <p className="text-sm text-slate-400">Identidad del hub, menú por defecto y logos oficiales de los paneles</p>
      </div>

      {/* Ajustes generales */}
      <form onSubmit={onSaveSettings} className="card space-y-4 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Ajustes generales</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nombre del sitio">
            <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="SuperPanel" />
          </Field>
          <Field label="Estilo de menú por defecto (para nuevos usuarios)">
            <Select value={defaultStyle} onChange={(e) => setDefaultStyle(e.target.value as MenuStyle)}>
              {(Object.keys(STYLE_LABELS) as MenuStyle[]).map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tema por defecto">
            <Select value={defaultMode} onChange={(e) => setDefaultMode(e.target.value as ThemeMode)}>
              {THEME_MODES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Color de acento por defecto">
            <div className="flex flex-wrap items-center gap-2 pt-1.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setDefaultAccent(a.value)}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                  style={{
                    borderColor: defaultAccent === a.value ? a.swatch : undefined,
                    color: defaultAccent === a.value ? a.swatch : undefined,
                  }}
                >
                  <span
                    className="grid h-4 w-4 place-items-center rounded-full"
                    style={{ backgroundColor: a.swatch }}
                  >
                    {defaultAccent === a.value && <Check size={10} className="text-white drop-shadow" />}
                  </span>
                  {a.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Cada usuario puede elegir su propio menú, tema y acento desde «Apariencia» en la interfaz; esto define los
          valores iniciales.
        </p>
        <div className="flex items-center justify-end gap-3">
          {settingsMsg && <span className="text-xs text-emerald-400">{settingsMsg}</span>}
          <Button variant="primary" type="submit" disabled={savingSettings || settingsQuery.isLoading}>
            {savingSettings ? 'Guardando…' : 'Guardar ajustes'}
          </Button>
        </div>
      </form>

      {/* Caché de logos */}
      <div className="card space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Logos de paneles</h2>
          <p className="text-xs text-slate-500">
            Cuando un usuario registra un panel, su logo se detecta automáticamente del dominio y se guarda aquí para
            todos los demás. Puedes corregirlo, añadir uno manualmente o eliminarlo.
          </p>
        </div>

        {/* Alta manual */}
        <form onSubmit={onAddLogo} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
          <Field label="Dominio">
            <Input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="oneprovider.com" />
          </Field>
          <Field label="URL del logo">
            <div className="flex gap-1.5">
              <Input value={newLogoUrl} onChange={(e) => setNewLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
              <Button
                type="button"
                className="shrink-0 px-2"
                title="Detectar automáticamente desde el dominio"
                onClick={() => {
                  const detected = autoLogoForUrl(`https://${newDomain.trim()}`)
                  setNewLogoUrl(detected ?? '')
                }}
              >
                <Search size={14} />
              </Button>
            </div>
          </Field>
          <Button variant="primary" type="submit" disabled={savingLogo} className="justify-center">
            <ImagePlus size={14} /> Añadir
          </Button>
        </form>

        {logoError && <p className="text-sm text-red-400">{logoError}</p>}

        {/* Tabla de logos */}
        {logosQuery.isLoading ? (
          <EmptyState>Cargando logos…</EmptyState>
        ) : logos.length === 0 ? (
          <EmptyState>
            Todavía no hay logos guardados. Se añadirán automáticamente cuando los usuarios registren paneles.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {logos.map((l) => {
              const edited = edits[l.domain]
              return (
                <li key={l.domain} className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
                  <img
                    src={edited?.trim() || l.logo_url}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg bg-slate-800 object-contain p-1 ring-1 ring-slate-700"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.opacity = '0.3'
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold text-slate-200">{l.domain}</p>
                    <Input
                      value={edited ?? l.logo_url}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [l.domain]: e.target.value }))}
                      className="mt-1 py-1 font-mono text-[11px]"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {edited !== undefined && edited.trim() !== l.logo_url && (
                      <Button className="px-2 py-1 text-xs text-emerald-400" title="Guardar cambio" onClick={() => onSaveExistingLogo(l.domain)}>
                        <RefreshCw size={13} />
                      </Button>
                    )}
                    <Button className="px-2 py-1 text-xs text-red-400" title="Eliminar" onClick={() => onDeleteLogo(l.domain)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
