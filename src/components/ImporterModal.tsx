import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileUp, Search, Share2, Upload } from 'lucide-react'
import { parsePanelListing, type ParsedPanelEntry } from '../lib/importer'
import { fetchPanels, savePanel, sharePanel, upsertCredential } from '../lib/queries'
import { useAuth } from '../lib/auth'
import { Badge, Button, Field, Input, Modal } from './ui'

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
  const [category, setCategory] = useState(defaultCategory || 'Plex')
  const [shareEmails, setShareEmails] = useState('')
  const [entries, setEntries] = useState<ParsedPanelEntry[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  const panelsQuery = useQuery({
    queryKey: ['panels'],
    queryFn: fetchPanels,
    enabled: open,
  })

  const existingOwnUrls = useMemo(() => {
    const set = new Set<string>()
    for (const p of panelsQuery.data ?? []) {
      if (!p.is_shared) set.add(p.url.trim().toLowerCase())
    }
    return set
  }, [panelsQuery.data])

  const categoryList = useMemo(() => {
    const set = new Set<string>(existingCategories)
    set.add('Plex')
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [existingCategories])

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
    setShareEmails('')
  }

  function targetEmails(): string[] {
    return shareEmails
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'))
  }

  async function runImport() {
    if (!entries || !user) return
    setImporting(true)
    setError('')

    const cat = category.trim() || 'General'
    const emails = targetEmails()
    const res: ImportResult = { imported: 0, shared: 0, skipped: [], errors: [] }

    for (const e of entries) {
      const isDuplicate = existingOwnUrls.has(e.url.toLowerCase())
      if (isDuplicate) {
        res.skipped.push({ name: e.name, reason: 'Ya tienes un panel con esta URL' })
        continue
      }

      try {
        const panelId = await savePanel({
          name: e.name,
          url: e.url,
          kind: 'third',
          category: cat,
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
          <Field label="Categoría para todos los paneles importados">
            <Input
              required
              list="importer-cat-datalist"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ej: Plex"
            />
            <datalist id="importer-cat-datalist">
              {categoryList.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Compartir todos con (opcional, emails separados por comas)">
            <Input
              value={shareEmails}
              onChange={(e) => setShareEmails(e.target.value)}
              placeholder="socio1@correo.com, socio2@correo.com"
            />
          </Field>
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
              {targetEmails().length > 0 && (
                <Badge tone="violet">
                  <Share2 size={11} /> Se compartirá con {targetEmails().length} usuario(s)
                </Badge>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto rounded border border-slate-800">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-left text-slate-400">
                    <th className="px-2 py-1.5">Nombre</th>
                    <th className="px-2 py-1.5">URL</th>
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
              <CheckCircle2 size={15} /> {result.imported} panel(es) importados en «{category.trim() || 'General'}»
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
