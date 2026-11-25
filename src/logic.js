export const USER = 'kansalakshat'

export const KINDS = {
  'issue-opened': { label: 'Issue opened', color: '#0969da' },
  'issue-closed': { label: 'Issue closed', color: '#8250df' },
  'pr-opened': { label: 'PR opened', color: '#1a7f37' },
  'pr-merged': { label: 'PR merged', color: '#bf3989' },
  'pr-closed': { label: 'PR closed (not merged)', color: '#cf222e' },
  assigned: { label: 'Assigned (merged/closed)', color: '#9a6700' },
}

const pad = (n) => String(n).padStart(2, '0')

// Local-time day key, so an event at 23:30 lands on the day you saw it.
export const dayKey = (d) => {
  d = new Date(d)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const daysBetween = (a, b = new Date()) =>
  Math.floor((new Date(b) - new Date(a)) / 86400000)

export const toItem = (x) => ({
  id: x.html_url,
  type: x.pull_request ? 'pr' : 'issue',
  title: x.title,
  number: x.number,
  repo: x.repository_url.split('/repos/')[1],
  url: x.html_url,
  state: x.state,
  created: x.created_at,
  closed: x.closed_at,
  merged: x.pull_request?.merged_at || null,
})

// Latest maintainer approval time, or null. Humans only (bots like coderabbit don't count),
// not the PR author, and only reviewers whose latest verdict is still APPROVED.
export function approvedAt(reviews, author) {
  const last = {}
  for (const r of reviews) { // API returns reviews oldest first
    if (!r.user || r.user.type === 'Bot' || r.user.login === author) continue
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') last[r.user.login] = r
  }
  return Object.values(last).filter((r) => r.state === 'APPROVED').map((r) => r.submitted_at).sort().pop() || null
}

// One "opened" event per item (recolored 'assigned' once merged/closed), plus one closing event (merged wins over closed).
export function buildEvents(items) {
  const byDay = {}
  const add = (date, kind, item) => (byDay[dayKey(date)] ||= []).push({ kind, item })
  for (const it of items) {
    add(it.created, it.merged || it.closed ? 'assigned' : `${it.type}-opened`, it)
    if (it.merged) add(it.merged, 'pr-merged', it)
    else if (it.closed) add(it.closed, `${it.type}-closed`, it)
  }
  return byDay
}

// Stats per group (repo or org), busiest first. key(item) names the group.
export function breakdown(items, key) {
  const g = {}
  for (const i of items) {
    const s = (g[key(i)] ||= { name: key(i), issues: 0, prs: 0, merged: 0, open: 0, mergeDays: 0 })
    if (i.type === 'pr') s.prs++; else s.issues++
    if (i.state === 'open') s.open++
    if (i.merged) { s.merged++; s.mergeDays += daysBetween(i.created, i.merged) }
  }
  return Object.values(g).sort((a, b) => b.prs + b.issues - a.prs - a.issues || a.name.localeCompare(b.name))
}

// 42 cells (6 weeks), Sunday first.
export function monthGrid(year, month) {
  const start = new Date(year, month, 1 - new Date(year, month, 1).getDay())
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}
