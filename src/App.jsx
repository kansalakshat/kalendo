import { useEffect, useMemo, useRef, useState } from 'react'
import { KINDS, USER, approvedAt, breakdown, buildEvents, dayKey, daysBetween, monthGrid, orgOf, toItem } from './logic.js'

const STALE_DAYS = 14
const DISCORD = { '': 'Not asked', waiting: 'Asked, waiting', responded: 'Responded' }

const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback }
}
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full/blocked */ }
}

async function search(q) {
  const out = []
  for (let page = 1; page <= 10; page++) { // search API caps at 1000 results
    const r = await fetch(
      `https://api.github.com/search/issues?q=author:${USER}+${q}&per_page=100&page=${page}`,
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

async function reviews(x) {
  const r = await fetch(`${x.repository_url}/pulls/${x.number}/reviews?per_page=100`,
    { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`GitHub ${r.status}`)
  return r.json()
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
  const [filter, setFilter] = useState({ type: 'all', state: 'all', org: 'all', repo: 'all', discord: 'all' })
  const [hidden, setHiddenState] = useState(() => load('kalendo-hidden-repos', []))
  const [day, setDay] = useState(null)
  const [groupBy, setGroupBy] = useState('repo')
  const dialog = useRef(null)
  useEffect(() => { if (day) dialog.current.showModal() }, [day])

  const setMeta = (m) => { setMetaState(m); save('kalendo-meta', m) }
  const toggleRepo = (r) => {
    const h = hidden.includes(r) ? hidden.filter((x) => x !== r) : [...hidden, r]
    setHiddenState(h); save('kalendo-hidden-repos', h)
    // Hidden repo (or an org with every repo hidden) can't stay selected.
    const orgGone = filter.org !== 'all' && !allRepos.some((x) => !h.includes(x) && orgOf(x) === filter.org)
    if (h.includes(filter.repo) || orgGone) setFilter({ ...filter, repo: 'all', ...(orgGone && { org: 'all' }) })
  }

  async function refresh() {
    setLoading(true); setError('')
    try {
      const [issues, prs] = await Promise.all([search('is:issue'), search('is:pr')])
      // search's review:approved counts bot approvals (coderabbit), so read each open PR's reviews.
      // One call per open PR; on failure keep the cached date.
      const openPrs = prs.filter((x) => x.state === 'open')
      const prev = Object.fromEntries(items.map((i) => [i.id, i.maintainerApprovedAt]))
      const dates = await Promise.all(openPrs.map((x) =>
        reviews(x).then((r) => approvedAt(r, USER)).catch(() => prev[x.html_url] || null)))
      const ok = new Map(openPrs.map((x, n) => [x.html_url, dates[n]]))
      const next = [...issues, ...prs].map((x) => {
        const at = ok.get(x.html_url) || null
        return { ...toItem(x), approved: !!at, maintainerApprovedAt: at }
      })
        .sort((a, b) => b.created.localeCompare(a.created))
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

  const allRepos = useMemo(() => [...new Set(items.map((i) => i.repo))].sort(), [items])
  // Org and repo filters scope the whole page; the other filters only narrow calendar + table.
  const counted = allRepos.filter((r) => !hidden.includes(r))
  const orgs = [...new Set(counted.map(orgOf))].sort((a, b) => a.localeCompare(b))
  const repos = counted.filter((r) => filter.org === 'all' || orgOf(r) === filter.org)
  const visible = items.filter((i) => repos.includes(i.repo) && (filter.repo === 'all' || i.repo === filter.repo))
  const shown = visible.filter((i) =>
    (filter.type === 'all' || i.type === filter.type) &&
    (filter.state === 'all' || i.state === filter.state) &&
    (filter.discord === 'all' || (meta[i.id]?.discord || '') === filter.discord))
  const events = buildEvents(shown)
  const open = visible.filter((i) => i.state === 'open')

  const prs = visible.filter((i) => i.type === 'pr')
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

      <div className="filters">
        <select value={filter.type} onChange={f('type')}>
          <option value="all">All types</option><option value="issue">Issues</option><option value="pr">PRs</option>
        </select>
        <select value={filter.state} onChange={f('state')}>
          <option value="all">Any state</option><option value="open">Open</option><option value="closed">Closed</option>
        </select>
        <select value={filter.org} onChange={(e) => setFilter({ ...filter, org: e.target.value, repo: 'all' })}>
          <option value="all">All orgs</option>
          {orgs.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select value={filter.repo} onChange={f('repo')}>
          <option value="all">All repos</option>
          {repos.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select value={filter.discord} onChange={f('discord')}>
          <option value="all">Any Discord status</option>
          {Object.entries(DISCORD).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <details className="repo-pick">
          <summary>Repos counted ({counted.length}/{allRepos.length})</summary>
          <div>
            {allRepos.map((r) => (
              <label key={r}><input type="checkbox" checked={!hidden.includes(r)} onChange={() => toggleRepo(r)} />{r}</label>
            ))}
          </div>
        </details>
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
          {grid.filter((d) => d.getMonth() === cursor.m).map((d) => {
            const k = dayKey(d)
            return (
              <div key={k} className={`cell${k === today ? ' today' : ''}`} onClick={() => setDay(k)}
                style={d.getDate() === 1 ? { gridColumnStart: d.getDay() + 1 } : undefined}>
                <button className="date" aria-label={`Details for ${d.toDateString()}`}>{d.getDate()}</button>
                {(events[k] || []).map(({ kind, item }) => (
                  <a key={kind + item.id} className="chip" href={item.url} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ background: KINDS[kind].color }}
                    title={`${KINDS[kind].label}: ${item.repo}#${item.number} ${item.title}`}>
                    {item.repo.split('/')[1]}#{item.number} {item.title}
                  </a>
                ))}
              </div>
            )
          })}
        </div>
      </section>

      <dialog ref={dialog} className="day" onClose={() => setDay(null)}
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
        {day && (
          <div>
            <div className="day-head">
              <h2>{new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
              <button onClick={() => dialog.current.close()} aria-label="Close">✕</button>
            </div>
            {!events[day] && <p className="muted">Nothing on this day.</p>}
            <ul>
              {(events[day] || []).map(({ kind, item }) => (
                <li key={kind + item.id} style={{ borderLeftColor: KINDS[kind].color }}>
                  <b style={{ color: KINDS[kind].color }}>{KINDS[kind].label}</b>
                  <a href={item.url} target="_blank" rel="noreferrer">{item.repo}#{item.number} {item.title}</a>
                  <span className="muted">
                    Opened {dayKey(item.created)} · {item.merged ? `merged ${dayKey(item.merged)}` : item.closed ? `closed ${dayKey(item.closed)}` : `open ${daysBetween(item.created)}d`}
                  </span>
                  {item.approved && !item.merged && <span className="approved">✓ Approved, not merged</span>}
                  <DiscordSelect id={item.id} meta={meta} setMeta={setMeta} />
                  {meta[item.id]?.note && <span>📝 {meta[item.id].note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </dialog>

      {[['Open PRs', (i) => i.type === 'pr'], ['Approved by maintainer, not merged', (i) => i.approved],
        ['Open issues', (i) => i.type === 'issue']].map(([heading, pick]) => {
        const list = open.filter(pick)
        return (
          <section key={heading} className="open-bar">
            <h2>{heading} ({list.length})</h2>
            {list.length === 0 && <p className="muted">Nothing open.</p>}
            <ul>
              {list.map((i) => {
                const age = daysBetween(i.created)
                return (
                  <li key={i.id} style={{ borderLeftColor: KINDS[`${i.type}-opened`].color }}>
                    <a href={i.url} target="_blank" rel="noreferrer">{i.repo}#{i.number} {i.title}</a>
                    {i.approved && <span className="approved">✓ Approved{i.maintainerApprovedAt &&
                      ` ${dayKey(i.maintainerApprovedAt)} · ${daysBetween(i.maintainerApprovedAt)}d ago`}</span>}
                    <span className={age >= STALE_DAYS ? 'age stale' : 'age'}>{age}d open</span>
                    <DiscordSelect id={i.id} meta={meta} setMeta={setMeta} />
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <section className="open-bar">
        <h2>Merged PRs ({merged.length})</h2>
        {merged.length === 0 && <p className="muted">Nothing merged yet.</p>}
        <ul>
          {[...merged].sort((a, b) => b.merged.localeCompare(a.merged)).map((i) => (
            <li key={i.id} style={{ borderLeftColor: KINDS['pr-merged'].color }}>
              <a href={i.url} target="_blank" rel="noreferrer">{i.repo}#{i.number} {i.title}</a>
              <span className="age">merged {dayKey(i.merged)} · took {daysBetween(i.created, i.merged)}d</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="stats">
        <div><b>{visible.filter((i) => i.type === 'issue').length}</b> issues</div>
        <div><b>{prs.length}</b> PRs</div>
        <div><b>{merged.length}</b> merged</div>
        <div><b>{prs.length ? Math.round((merged.length / prs.length) * 100) : 0}%</b> merge rate</div>
        <div><b>{avgMerge}</b> avg days to merge</div>
        <div><b>{visible.filter((i) => meta[i.id]?.discord === 'waiting').length}</b> waiting on Discord</div>
      </section>

      <section>
        <div className="analysis-head">
          <h2>Analysis</h2>
          {[['repo', 'By repo'], ['org', 'By org']].map(([k, label]) => (
            <button key={k} aria-pressed={groupBy === k} onClick={() => setGroupBy(k)}>{label}</button>
          ))}
        </div>
        <table>
          <thead>
            <tr><th>{groupBy === 'repo' ? 'Repo' : 'Org'}</th><th>Issues</th><th>PRs</th><th>Merged</th><th>Approved, waiting to merge</th>
              <th>Merge rate</th><th>Avg days to merge</th><th>Open</th></tr>
          </thead>
          <tbody>
            {breakdown(visible, groupBy === 'repo' ? (i) => i.repo : (i) => orgOf(i.repo)).map((s) => (
              <tr key={s.name}>
                <td><a href={`https://github.com/${s.name}`} target="_blank" rel="noreferrer">{s.name}</a></td>
                <td>{s.issues}</td><td>{s.prs}</td><td>{s.merged}</td><td>{s.approved}</td>
                <td>{s.prs ? Math.round((s.merged / s.prs) * 100) : 0}%</td>
                <td>{s.merged ? (s.mergeDays / s.merged).toFixed(1) : '-'}</td>
                <td>{s.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
