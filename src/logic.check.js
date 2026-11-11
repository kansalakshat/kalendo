import assert from 'node:assert/strict'
import { buildEvents, dayKey, monthGrid, toItem } from './logic.js'

const raw = (o) => ({
  html_url: 'https://github.com/a/b/pull/1', title: 't', number: 1,
  repository_url: 'https://api.github.com/repos/a/b', state: 'closed',
  created_at: '2026-11-02T10:00:00Z', closed_at: '2026-11-05T10:00:00Z', ...o,
})

const pr = toItem(raw({ pull_request: { merged_at: '2026-11-05T10:00:00Z' } }))
assert.equal(pr.type, 'pr')
assert.equal(pr.repo, 'a/b')

const closedPr = toItem(raw({ pull_request: { merged_at: null } }))
const issue = toItem(raw({ state: 'open', closed_at: null }))

const ev = buildEvents([pr, closedPr, issue])
const all = Object.values(ev).flat().map((e) => e.kind).sort()
assert.deepEqual(all, ['assigned', 'assigned', 'issue-opened', 'pr-closed', 'pr-merged'])
assert.equal(ev[dayKey('2026-11-05T10:00:00Z')].length, 2)

const g = monthGrid(2026, 10) // Nov 2026 starts on Sunday
assert.equal(g.length, 42)
assert.equal(dayKey(g[0]), '2026-11-01')
assert.equal(dayKey(monthGrid(2026, 11)[0]), '2026-11-29') // Dec 1 is Tuesday

console.log('logic checks passed')
