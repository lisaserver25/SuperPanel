import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileUp, Search, Share2, Upload, Users } from 'lucide-react'
import { parsePanelListing, type ParsedPanelEntry } from '../lib/importer'
import { fetchPanels, fetchUserDirectory, savePanel, sharePanel, upsertCredential } from '../lib/queries'
import {
  getUserCustomSubservices,
} from '../lib/categories'
import { PRESET_SUBSERVICES } from '../lib/categories'
import { useAuth } from '../lib/auth'
import { Badge, Button, Field, Input, Modal, Select } from './ui'

const PRESET_SERVICES = ['Plex', 'Emby', 'Jellyfin', 'IPTV', 'Music'] as const
const CUSTOM_OPTION = '__custom__'

interface ImportResult {
  imported: number
  shared: number
  skipped: { name: string; reason: string }[]
  errors: string[]
}

export default function ImporterModal({
  open,
  onClose,
  defaultCategory,
  existingCategories = [],
}: {
  open: boolean
  onClose: () => void
  defaultCategory?: string
  existingCategories?: string[]
}) {
  const { user } = useAuth()
  const qc = useQueryClient()

  const [text, setText] = useState('')
  const [category, setCategory] = useState<string>(defaultCategory || 'Plex')
  const [customCategory, setCustomCategory] = useState('')
  const [subMode, setSubMode] = useState<string>('__auto__')
  const [customSub, setCustomSub] = useState('')
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [manualEmail, setManualEmail] = useState('')
  const [entries, setEntries] = useState<ParsedPanelEntry[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  // Categoría final aplicada al lote
  const finalCategory = (category === CUSTOM_OPTION ? customCategory.trim() : category.trim()) || 'General'

  // Subservicio por entrada: '__auto__' usa el [tag] del listado
  function subFor(e: ParsedPanelEntry): string {
    if (subMode === '__auto__') return e.serviceTag?.trim() || 'General'
    if (subMode === '__custom__') return customSub.trim() || 'General'
    return subMode
  }

  const subOptions = useMemo(() => {
    const set = new Set<string>([...PRESET_SUBSERVICES, ...getUserCustomSubservices(user?.id)])
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [user?.id, open])

  const panelsQuery = useQuery({
    queryKey: ['panels'],
    queryFn: fetchPanels,
    enabled: open,
  })

  const directoryQuery = useQuery({
    queryKey: ['user-directory'],
    queryFn: fetchUserDirectory,
    enabled: open,
  })

  const existingOwnUrls = useMemo(() => {
    const set = new Set<string>()
    for (const p of panelsQuery.data ?? []) {
      if (!p.is_shared) set.add(p.url.trim().toLowerCase())
    }
    return set
  }, [panelsQuery.data])

  // Directorio excluyéndome a mí
  const directory = useMemo(() => {
    const myEmail = (user?.email ?? '').toLowerCase()
    return (directoryQuery.data ?? []).filter((u) => u.email.toLowerCase() !== myEmail)
  }, [directoryQuery.data, user?.email])

  function toggleDirectoryUser(email: string) {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    )
  }

  function addManualEmail() {
    const norm = manualEmail.trim().toLowerCase()
    if (!norm || !norm.includes('@')) return
    if (!selectedEmails.includes(norm)) setSelectedEmails((prev) => [...prev, norm])
    setManualEmail('')
  }

  // Emails finales a invitar: los marcados del directorio + los manuales
  const targetEmails = useMemo(
    () => Array.from(new Set(selectedEmails.map((e) => e.toLowerCase()))),
    [selectedEmails]
  )

  const categoryList = useMemo(() => {
    const set = new Set<string>([...PRESET_SERVICES, ...existingCategories])
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [existingCategories])

  // Al abrir, resetear la categoría al valor propuesto
  useEffect(() => {
    if (open) {
      setCategory(defaultCategory || 'Plex')
      setCustomCategory('')
      setSubMode('__auto__')
      setCustomSub('')
    }
  }, [open, defaultCategory])

  function analyze() {
    setError('')
    setResult(null)
    const parsed = parsePanelListing(text)
    if (parsed.length === 0) {
      setError('No se ha detectado ningún panel en el texto. Comprueba el formato (líneas con 🖥 NOMBRE [Plex] y campos IP/Email/Contraseña).')
      setEntries(null)
      return
    }
    setEntries(parsed)
  }

  function reset() {
    setText('')
    setEntries(null)
    setResult(null)
    setError('')
    setSelectedEmails([])
    setManualEmail('')
    setSubMode('__auto__')
    setCustomSub('')
  }

  async function runImport() {
    if (!entries || !user) return
    setImporting(true)
    setError('')

    const cat = finalCategory
    const emails = targetEmails
    const res: ImportResult = { imported: 0, shared: 0, skipped: [], errors: [] }

    for (const e of entries) {
      const isDuplicate = existingOwnUrls.has(e.url.toLowerCase())
      if (isDuplicate) {
        res.skipped.push({ name: e.name, reason: 'Ya tienes un panel con esta URL' })
        continue
      }

      try {
        const sub = subFor(e)
        const panelId = await savePanel({
          name: e.name,
          url: e.url,
          kind: 'third',
          category: cat,
          subcategory: sub,
          logo_url: null, // se detecta automáticamente del dominio
          notes: e.referenceUser ? `Usuario del panel: ${e.referenceUser} (no se usa para el acceso)` : 'Importado masivamente',
          sort_order: 0,
          supabase_url: null,
          supabase_anon_key: null,
        })

        // Credencial: el acceso es email + contraseña (el campo Usuario no conecta)
        if (e.loginEmail && e.loginPassword) {
          await upsertCredential({
            panel_id: panelId,
            label: 'Acceso principal',
            username: e.loginEmail,
            password: e.loginPassword,
          })
        } else {
          res.skipped.push({ name: e.name, reason: 'Importado sin credencial (falta email o contraseña)' })
        }

        // Compartir con otros usuarios de SuperPanel si se ha indicado
        for (const email of emails) {
          if (email === (user.email ?? '').toLowerCase()) continue
          try {
            await sharePanel(panelId, email)
            res.shared += 1
          } catch {
            /* compartir es best-effort */
          }
        }

        res.imported += 1
      } catch (err) {
        res.errors.push(`${e.name}: ${err instanceof Error ? err.message : 'error desconocido'}`)
      }
    }

    setResult(res)
    setImporting(false)
    await qc.invalidateQueries({ queryKey: ['panels'] })
    await qc.invalidateQueries({ queryKey: ['credentials'] })
    await qc.invalidateQueries({ queryKey: ['pending-panel-shares'] })
  }

  const okCount = entries?.filter((e) => e.loginEmail && e.loginPassword).length ?? 0
  const warnCount = (entries?.length ?? 0) - okCount

  return (
    <Modal open={open} onClose={onClose} title="Importador masivo de paneles" maxWidth="max-w-3xl">
      <div className="space-y-3 text-xs">
        <p className="text-slate-400">
          Pega el listado completo (formato 🖥 NOMBRE [Plex] con campos IP / Usuario / Email / Contraseña). Cada panel
          se creará con su nombre, la URL de su IP y la credencial de acceso (email + contraseña), agrupados en la
          categoría que elijas.
        </p>

        <Field label="Listado a importar">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={'🖥 CARACOL [Plex]\n   📍 IP: 62.210.244.119\n   👤 Usuario: CARACOL_\n   📧 Email: caracol_new@cuentagotas.net\n   🔑 Contraseña: …'}
            className="input font-mono text-[11px] leading-relaxed"
          />
        </Field>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label="Categoría (servicio global)">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categoryList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>Personalizado…</option>
            </Select>
            {category === CUSTOM_OPTION && (
              <Input
                required
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Nombre del servicio global"
                className="mt-1.5 py-1 text-[11px]"
              />
            )}
            <span className="block pt-0.5 text-[10px] text-slate-500">
              Las categorías personalizadas se guardan para próximas importaciones.
            </span>
          </Field>
          <Field label="Subservicio (tipo dentro de la categoría)">
            <Select value={subMode} onChange={(e) => setSubMode(e.target.value)}>
              <option value="__auto__">Auto (según el [tag] del listado)</option>
              {subOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__custom__">Personalizado…</option>
            </Select>
            {subMode === '__custom__' && (
              <Input
                required
                value={customSub}
                onChange={(e) => setCustomSub(e.target.value)}
                placeholder="Nombre del subservicio"
                className="mt-1.5 py-1 text-[11px]"
              />
            )}
            <span className="block pt-0.5 text-[10px] text-slate-500">
              Ej: Plex, Emby, Jellyfin, Datacenter, IPTV, Music… En modo Auto se deduce del [tag] de cada nombre y se
              guardan los personalizados.
            </span>
          </Field>
        </div>

        {/* Selector de usuarios a invitar (con su rol) */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Users size={13} className="text-sky-400" />
              Compartir todos con:
            </span>
            {targetEmails.length > 0 && (
              <span className="text-[10px] text-sky-400">{targetEmails.length} seleccionado(s)</span>
            )}
          </div>

          {directoryQuery.isLoading ? (
            <p className="text-[11px] text-slate-500">Cargando usuarios…</p>
          ) : directory.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              No hay otros usuarios registrados todavía. Añade usuarios desde «Usuarios» (superadmin) o por email abajo.
            </p>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded border border-slate-800 divide-y divide-slate-800/60">
              {directory.map((u) => {
                const checked = selectedEmails.includes(u.email.toLowerCase())
                return (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDirectoryUser(u.email.toLowerCase())}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
                      {u.full_name ? (
                        <>
                          {u.full_name} <span className="text-slate-500">({u.email})</span>
                        </>
                      ) : (
                        u.email
                      )}
                    </span>
                    <Badge tone={u.role === 'superadmin' ? 'sky' : 'slate'}>
                      {u.role === 'superadmin' ? 'Superadmin' : 'Cliente'}
                    </Badge>
                  </label>
                )
              })}
            </div>
          )}

          {/* Email manual (usuario que aún no está en el listado) */}
          <div className="flex items-center gap-1.5">
            <Input
              type="email"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addManualEmail()
                }
              }}
              placeholder="Otro correo que no esté en la lista…"
              className="py-1 text-[11px]"
            />
            <Button type="button" onClick={addManualEmail} className="shrink-0 px-2.5 py-1 text-xs">
              Añadir
            </Button>
          </div>

          {/* Chips de seleccionados */}
          {targetEmails.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="inline-flex items-center gap-1 text-[10px] text-sky-400 mr-1">
                <Share2 size={10} /> Se invitará:
              </span>
              {targetEmails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded bg-sky-950/80 px-2 py-0.5 text-[11px] text-sky-300 border border-sky-800/80"
                >
                  {email}
                  <button
                    type="button"
                    onClick={() => setSelectedEmails((prev) => prev.filter((e) => e !== email))}
                    className="ml-0.5 font-bold text-sky-400 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-red-400">{error}</p>}

        {!result && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={analyze} disabled={!text.trim()}>
              <Search size={13} /> Analizar listado
            </Button>
          </div>
        )}

        {/* Vista previa */}
        {entries && !result && (
          <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="sky">{entries.length} paneles detectados</Badge>
              <Badge tone="green">{okCount} con acceso completo</Badge>
              {warnCount > 0 && (
                <Badge tone="red">
                  <AlertTriangle size={11} /> {warnCount} sin email/contraseña
                </Badge>
              )}
              {targetEmails.length > 0 && (
                <Badge tone="violet">
                  <Share2 size={11} /> Se compartirá con {targetEmails.length} usuario(s)
                </Badge>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto rounded border border-slate-800">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-left text-slate-400">
                    <th className="px-2 py-1.5">Nombre</th>
                    <th className="px-2 py-1.5">URL</th>
                    <th className="px-2 py-1.5">Subservicio</th>
                    <th className="px-2 py-1.5">Acceso (email)</th>
                    <th className="hidden px-2 py-1.5 sm:table-cell">Ref. usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {entries.map((e, i) => {
                    const duplicate = existingOwnUrls.has(e.url.toLowerCase())
                    return (
                      <tr key={i} className={duplicate ? 'opacity-50' : undefined}>
                        <td className="px-2 py-1 font-medium text-slate-200">
                          {e.name}
                          {duplicate && <span className="ml-1 text-[10px] text-amber-400">(duplicado)</span>}
                        </td>
                        <td className="px-2 py-1 font-mono text-slate-400">{e.url}</td>
                        <td className="px-2 py-1">
                          <Badge tone={subFor(e) === 'General' ? 'slate' : 'sky'}>{subFor(e)}</Badge>
                        </td>
                        <td className="px-2 py-1 text-slate-300">
                          {e.loginEmail ? (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 size={11} className="text-emerald-400" />
                              {e.loginEmail}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400">
                              <AlertTriangle size={11} /> sin acceso
                            </span>
                          )}
                        </td>
                        <td className="hidden px-2 py-1 text-slate-500 sm:table-cell">{e.referenceUser ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                onClick={() => {
                  setEntries(null)
                  setResult(null)
                }}
              >
                Volver a editar
              </Button>
              <Button variant="primary" onClick={runImport} disabled={importing}>
                <Upload size={13} />
                {importing ? 'Importando…' : `Importar ${entries.length} paneles`}
              </Button>
            </div>
          </div>
        )}

        {/* Resultado */}
        {result && (
          <div className="space-y-2.5 rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
              <CheckCircle2 size={15} /> {result.imported} panel(es) importados en «{finalCategory}»
              {result.shared > 0 && ` · ${result.shared} invitaciones enviadas`}
            </p>
            {result.skipped.length > 0 && (
              <div className="text-[11px] text-slate-400">
                {result.skipped.map((s, i) => (
                  <p key={i}>
                    • {s.name}: {s.reason}
                  </p>
                ))}
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="text-[11px] text-red-400">
                {result.errors.map((s, i) => (
                  <p key={i}>• {s}</p>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                onClick={() => {
                  reset()
                  setEntries(null)
                }}
              >
                Importar otro listado
              </Button>
              <Button variant="primary" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-start border-t border-slate-800 pt-2.5 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <FileUp size={11} />
            Las credenciales se guardan cifradas; el campo «Usuario» del listado se guarda como referencia en las notas.
          </span>
        </div>
      </div>
    </Modal>
  )
}
