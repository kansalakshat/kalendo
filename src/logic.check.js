import assert from 'node:assert/strict'
import { approvedAt, buildEvents, dayKey, monthGrid, toItem } from './logic.js'

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

const rv = (login, state, day, type = 'User') => ({ user: { login, type }, state, submitted_at: `2026-11-${day}T00:00:00Z` })
assert.equal(approvedAt([rv('coderabbitai[bot]', 'APPROVED', 10, 'Bot')], 'me'), null) // bot ignored
assert.equal(approvedAt([rv('me', 'APPROVED', 10)], 'me'), null) // self ignored
assert.equal(approvedAt([rv('m', 'APPROVED', 10), rv('m', 'COMMENTED', 20)], 'me'), '2026-11-10T00:00:00Z')
assert.equal(approvedAt([rv('m', 'APPROVED', 10), rv('m', 'CHANGES_REQUESTED', 12)], 'me'), null) // retracted
assert.equal(approvedAt([rv('m', 'APPROVED', 10), rv('m', 'DISMISSED', 12)], 'me'), null)
assert.equal(approvedAt([rv('a', 'APPROVED', 10), rv('b', 'APPROVED', 15)], 'me'), '2026-11-15T00:00:00Z')

console.log('logic checks passed')
