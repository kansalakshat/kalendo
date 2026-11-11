import { useEffect, useMemo, useState } from 'react'
import { KINDS, USER, buildEvents, dayKey, daysBetween, monthGrid, toItem } from './logic.js'

const STALE_DAYS = 14
const DISCORD = { '': 'Not asked', waiting: 'Asked, waiting', responded: 'Responded' }

const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback }
}
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full/blocked */ }
}

async function search(kind) {
  const out = []
  for (let page = 1; page <= 10; page++) { // search API caps at 1000 results
    const r = await fetch(
      `https://api.github.com/search/issues?q=author:${USER}+is:${kind}&per_page=100&page=${page}`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) {
      const msg = (await r.json().catch(() => ({}))).message || r.statusText
      throw new Error(`GitHub ${r.status}: ${msg}`)
    }
    const j = await r.json()
    out.push(...j.items)
    if (j.items.length < 100 || out.length >= j.total_count) break
  }
  return out
}

function DiscordSelect({ id, meta, setMeta }) {
  const v = meta[id]?.discord || ''
  return (
    <select className={`discord ${v}`} value={v}
      onChange={(e) => setMeta({ ...meta, [id]: { ...meta[id], discord: e.target.value } })}>
      {Object.entries(DISCORD).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  )
}

export default function App() {
  const [items, setItems] = useState(() => load('kalendo-items', []))
  const [fetchedAt, setFetchedAt] = useState(() => load('kalendo-fetched', null))
  const [meta, setMetaState] = useState(() => load('kalendo-meta', {}))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [filter, setFilter] = useState({ type: 'all', state: 'all', repo: 'all', discord: 'all' })

  const setMeta = (m) => { setMetaState(m); save('kalendo-meta', m) }

  async function refresh() {
    setLoading(true); setError('')
    try {
      const [issues, prs] = await Promise.all([search('issue'), search('pr')])
      const next = [...issues, ...prs].map(toItem).sort((a, b) => b.created.localeCompare(a.created))
      const now = new Date().toISOString()
      setItems(next); setFetchedAt(now)
      save('kalendo-items', next); save('kalendo-fetched', now)
    } catch (e) {
      setError(`${e.message}. Showing cached data.`)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { refresh() }, [])

  const repos = useMemo(() => [...new Set(items.map((i) => i.repo))].sort(), [items])
  const shown = items.filter((i) =>
    (filter.type === 'all' || i.type === filter.type) &&
    (filter.state === 'all' || i.state === filter.state) &&
    (filter.repo === 'all' || i.repo === filter.repo) &&
    (filter.discord === 'all' || (meta[i.id]?.discord || '') === filter.discord))
  const events = buildEvents(shown)
  const open = items.filter((i) => i.state === 'open')

  const prs = items.filter((i) => i.type === 'pr')
  const merged = prs.filter((i) => i.merged)
  const avgMerge = merged.length
    ? (merged.reduce((s, i) => s + daysBetween(i.created, i.merged), 0) / merged.length).toFixed(1) : '-'

  const today = dayKey(new Date())
  const grid = monthGrid(cursor.y, cursor.m)
  const move = (n) => setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  function exportMeta() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }))
    a.download = 'kalendo-notes.json'
    a.click()
  }
  async function importMeta(e) {
    const f = e.target.files[0]
    if (!f) return
    try {
      const m = JSON.parse(await f.text())
      if (typeof m !== 'object' || Array.isArray(m) || !m) throw new Error()
      setMeta({ ...meta, ...m })
    } catch { setError('Import failed: not a Kalendo notes file.') }
    e.target.value = ''
  }

  const f = (k) => (e) => setFilter({ ...filter, [k]: e.target.value })

  return (
    <div className="app">
      <header>
        <h1>Kalendo · <a href={`https://github.com/${USER}`} target="_blank" rel="noreferrer">@{USER}</a></h1>
        <div className="actions">
          <span className="muted">{fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleString()}` : 'Never fetched'}</span>
          <button onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button onClick={exportMeta}>Export notes</button>
          <label className="button">Import notes<input type="file" accept=".json" hidden onChange={importMeta} /></label>
        </div>
      </header>

      <div className="legend">
        {Object.entries(KINDS).map(([k, { label, color }]) => (
          <span key={k}><i style={{ background: color }} />{label}</span>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <section className="open-bar">
        <h2>Still open ({open.length})</h2>
        {open.length === 0 && <p className="muted">Nothing open.</p>}
        <ul>
          {open.map((i) => {
            const age = daysBetween(i.created)
            return (
              <li key={i.id} style={{ borderLeftColor: KINDS[`${i.type}-opened`].color }}>
                <span className="tag">{i.type === 'pr' ? 'PR' : 'Issue'}</span>
                <a href={i.url} target="_blank" rel="noreferrer">{i.repo}#{i.number} {i.title}</a>
                <span className={age >= STALE_DAYS ? 'age stale' : 'age'}>{age}d open</span>
                <DiscordSelect id={i.id} meta={meta} setMeta={setMeta} />
              </li>
            )
          })}
        </ul>
      </section>

      <div className="filters">
        <select value={filter.type} onChange={f('type')}>
          <option value="all">All types</option><option value="issue">Issues</option><option value="pr">PRs</option>
        </select>
        <select value={filter.state} onChange={f('state')}>
          <option value="all">Any state</option><option value="open">Open</option><option value="closed">Closed</option>
        </select>
        <select value={filter.repo} onChange={f('repo')}>
          <option value="all">All repos</option>
          {repos.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select value={filter.discord} onChange={f('discord')}>
          <option value="all">Any Discord status</option>
          {Object.entries(DISCORD).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>

      <section className="calendar">
        <div className="cal-head">
          <button onClick={() => move(-1)} aria-label="Previous month">‹</button>
          <h2>{new Date(cursor.y, cursor.m).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button onClick={() => move(1)} aria-label="Next month">›</button>
          <button onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }}>Today</button>
        </div>
        <div className="grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="dow">{d}</div>)}
          {grid.map((d) => {
            const k = dayKey(d)
            return (
              <div key={k} className={`cell${d.getMonth() !== cursor.m ? ' other' : ''}${k === today ? ' today' : ''}`}>
                <span className="date">{d.getDate()}</span>
                {(events[k] || []).map(({ kind, item }) => (
                  <a key={kind + item.id} className="chip" href={item.url} target="_blank" rel="noreferrer"
                    style={{ background: KINDS[kind].color }}
                    title={`${KINDS[kind].label}: ${item.repo}#${item.number} ${item.title}`}>
                    #{item.number} {item.title}
                  </a>
                ))}
              </div>
            )
          })}
        </div>
      </section>

      <section className="stats">
        <div><b>{items.filter((i) => i.type === 'issue').length}</b> issues</div>
        <div><b>{prs.length}</b> PRs</div>
        <div><b>{merged.length}</b> merged</div>
        <div><b>{prs.length ? Math.round((merged.length / prs.length) * 100) : 0}%</b> merge rate</div>
        <div><b>{avgMerge}</b> avg days to merge</div>
        <div><b>{Object.values(meta).filter((m) => m.discord === 'waiting').length}</b> waiting on Discord</div>
      </section>

      <section>
        <h2>All items ({shown.length})</h2>
        <table>
          <thead>
            <tr><th>Type</th><th>Item</th><th>Opened</th><th>Closed / merged</th><th>Discord</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id}>
                <td>{i.type === 'pr' ? 'PR' : 'Issue'}</td>
                <td><a href={i.url} target="_blank" rel="noreferrer">{i.repo}#{i.number}</a> {i.title}</td>
                <td>{dayKey(i.created)}</td>
                <td>{i.merged ? `merged ${dayKey(i.merged)}` : i.closed ? `closed ${dayKey(i.closed)}` : <b>open</b>}</td>
                <td><DiscordSelect id={i.id} meta={meta} setMeta={setMeta} /></td>
                <td>
                  <input value={meta[i.id]?.note || ''} placeholder="maintainer, next step…"
                    onChange={(e) => setMeta({ ...meta, [i.id]: { ...meta[i.id], note: e.target.value } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
