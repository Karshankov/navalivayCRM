import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function trackedTextFiles() {
  const output = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' })
  const excluded = new Set(['ops/prod.sh'])
  return output.split(/\r?\n/).filter(Boolean).filter((file) => {
    if (excluded.has(file) || file.startsWith('ops/tests/')) return false
    if (/package-lock\.json$/.test(file)) return false
    if (!/\.(?:md|txt|js|cjs|mjs|ts|vue|sh|service|ps1|ya?ml|json|toml|conf|rules)$/.test(file) && !['AGENTS.md', 'WARP.md', '.cursorrules'].includes(file)) return false
    return fs.existsSync(path.join(repo, file))
  })
}

test('документы и комментарии не возвращают опасные команды', () => {
  const forbidden = [
    /systemctl\s+(?:start|restart)\s+navalivay-(?:server|bot)\b/i,
    /pm2\s+(?:start|restart|reload)\s+navalivay-(?:api|bot|userbot)\b/i,
    /pm2\s+delete\s+navalivay-api\b/i,
    /pm2\s+logs\s+navalivay-server\b/i,
    /journalctl\b[^\n]*\s-u\s+navalivay-bot\b/i,
    /pm2\s+startOrReload\b[^\n]*ecosystem\.config/i,
  ]
  const violations = []
  for (const file of trackedTextFiles()) {
    const source = fs.readFileSync(path.join(repo, file), 'utf8')
    for (const pattern of forbidden) {
      if (pattern.test(source)) violations.push(`${file}: ${pattern}`)
    }
  }
  assert.deepEqual(violations, [])
})

test('обычный PM2 ecosystem содержит только bot и userbot', async () => {
  const url = pathToFileURL(path.join(repo, 'server/ecosystem.config.cjs'))
  url.searchParams.set('t', Date.now())
  const config = await import(url.href)
  const names = config.default.apps.map((app) => app.name)
  assert.deepEqual(names, ['navalivay-bot', 'navalivay-userbot'])
})
