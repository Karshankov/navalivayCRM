#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTRYPOINTS = {
  api: 'server/index.js',
  bot: 'server/bot.js',
  userbot: 'server/userbot/index.js',
}

const MODULE_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '/index.js', '/index.mjs', '/index.cjs']

function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

export function extractRelativeImports(source) {
  const imports = new Set()
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('.')) imports.add(match[1])
    }
  }
  return [...imports]
}

function filesAtCommit(repo, sha) {
  const output = git(repo, ['ls-tree', '-r', '--name-only', sha, '--', 'server'])
  return new Set(output ? output.split('\n').map((item) => item.trim()).filter(Boolean) : [])
}

function filesContentAtCommit(repo, sha, files) {
  const ordered = [...files].filter((file) => /\.[cm]?js$/.test(file))
  if (!ordered.length) return new Map()
  const input = `${ordered.map((file) => `${sha}:${file}`).join('\n')}\n`
  const output = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], {
    input,
    maxBuffer: 100 * 1024 * 1024,
  })
  const result = new Map()
  let offset = 0
  for (const file of ordered) {
    const lineEnd = output.indexOf(10, offset)
    if (lineEnd < 0) throw new Error(`Некорректный ответ git cat-file для ${file}`)
    const header = output.subarray(offset, lineEnd).toString('utf8')
    offset = lineEnd + 1
    const size = Number(header.split(' ').at(-1))
    if (!Number.isFinite(size)) throw new Error(`Не удалось прочитать ${file} из ${sha}`)
    result.set(file, output.subarray(offset, offset + size).toString('utf8'))
    offset += size + 1
  }
  return result
}

function resolveImport(fromFile, specifier, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  for (const suffix of MODULE_EXTENSIONS) {
    const candidate = `${base}${suffix}`
    if (files.has(candidate)) return candidate
  }
  return null
}

export function buildReachability(repo, sha) {
  const files = filesAtCommit(repo, sha)
  const contents = filesContentAtCommit(repo, sha, files)
  const result = {}
  for (const [component, entrypoint] of Object.entries(ENTRYPOINTS)) {
    const seen = new Set()
    const queue = files.has(entrypoint) ? [entrypoint] : []
    while (queue.length) {
      const current = queue.pop()
      if (seen.has(current)) continue
      seen.add(current)
      const source = contents.get(current)
      if (source === undefined) continue
      for (const specifier of extractRelativeImports(source)) {
        const resolved = resolveImport(current, specifier, files)
        if (resolved && !seen.has(resolved)) queue.push(resolved)
      }
    }
    result[component] = seen
  }
  return result
}

function unionReachability(oldGraph, newGraph) {
  const result = {}
  for (const component of Object.keys(ENTRYPOINTS)) {
    result[component] = new Set([
      ...(oldGraph[component] || []),
      ...(newGraph[component] || []),
    ])
  }
  return result
}

/**
 * Файлы, которые лежат в репозитории, но на работающий прод не влияют никак.
 *
 * `.gitignore` читает только git. `server/dev-server.js` — локальный запуск
 * витрины в браузере: он подхватывает server/.env и импортирует index.js, а на
 * проде сервер поднимает systemd напрямую, поэтому в граф запуска этот файл не
 * входит и войти не должен.
 *
 * Список намеренно перечисляет точные пути: маска вида `server/dev-*` рано или
 * поздно пропустит на прод то, чего там быть не должно.
 */
function hasNoRuntimeImpact(file) {
  return (
    file === '.gitignore' ||
    file === '.gitattributes' ||
    file === 'server/dev-server.js' ||
    // Справочная копия боевого конфига nginx. Деплой её никуда не applies:
    // конфиг меняют на сервере руками. Настоящие инфраструктурные пути
    // (nginx/, ops/systemd/, deploy/) блокировку по-прежнему получают.
    file === 'ops/nginx.conf'
  )
}

function isDocsOrTest(file) {
  return (
    file === 'AGENTS.md' ||
    file === 'WARP.md' ||
    file === 'README.md' ||
    file === '.cursorrules' ||
    file.startsWith('docs/') ||
    file.startsWith('ops/tests/') ||
    /(^|\/)(tests?|__tests__|fixtures)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  )
}

export function planImpact(changedFiles, oldGraph = {}, newGraph = {}) {
  const reachable = unionReachability(oldGraph, newGraph)
  const components = new Set()
  const blocked = []
  let frontendBuild = false
  let frontendInstall = false
  let serverInstall = false
  let pm2Reload = false

  for (const file of changedFiles) {
    if (hasNoRuntimeImpact(file)) continue

    if (file.startsWith('frontend/')) {
      if (isDocsOrTest(file)) continue
      if (file === 'frontend/package.json' || file === 'frontend/package-lock.json') frontendInstall = true
      frontendBuild = true
      continue
    }

    if (isDocsOrTest(file)) continue

    if (file === 'server/package.json' || file === 'server/package-lock.json') {
      serverInstall = true
      components.add('api')
      components.add('bot')
      components.add('userbot')
      continue
    }
    if (file === 'server/ecosystem.config.cjs') {
      pm2Reload = true
      components.add('bot')
      components.add('userbot')
      continue
    }
    if (file === 'server/userbot/start.sh') {
      components.add('userbot')
      continue
    }
    if (file.startsWith('server/migrations/')) {
      components.add('api')
      continue
    }
    if (file.startsWith('server/')) {
      let matched = false
      for (const component of Object.keys(ENTRYPOINTS)) {
        if (reachable[component].has(file)) {
          components.add(component)
          matched = true
        }
      }
      if (!matched && !file.endsWith('.env.example')) blocked.push(`${file}: серверный файл вне графа запуска`)
      continue
    }

    if (
      file === 'ops/prod.sh' ||
      file === 'ops/prod-impact.mjs' ||
      file === 'ops/check-prod-runtime.sh' ||
      file === 'ops/monitor.sh' ||
      file === 'ops/README.md'
    ) {
      continue
    }
    if (
      file.startsWith('ops/systemd/') ||
      file.startsWith('deploy/') ||
      file.startsWith('nginx/') ||
      file.startsWith('.github/') ||
      /(^|\/)(Dockerfile|docker-compose[^/]*)$/.test(file)
    ) {
      blocked.push(`${file}: инфраструктуру выкладывают отдельной процедурой`)
      continue
    }

    blocked.push(`${file}: неизвестный путь`)
  }

  return {
    changedFiles: [...changedFiles],
    frontendBuild,
    frontendInstall,
    serverInstall,
    pm2Reload,
    components: ['api', 'bot', 'userbot'].filter((item) => components.has(item)),
    blocked,
    noRuntimeActions: !frontendBuild && !serverInstall && components.size === 0,
  }
}

export function planBetweenCommits(repo, oldSha, targetSha) {
  const output = git(repo, ['diff', '--name-only', '--no-renames', oldSha, targetSha])
  const changedFiles = output ? output.split('\n').map((item) => item.trim()).filter(Boolean) : []
  const oldGraph = buildReachability(repo, oldSha)
  const newGraph = oldSha === targetSha ? oldGraph : buildReachability(repo, targetSha)
  return planImpact(changedFiles, oldGraph, newGraph)
}

function main() {
  const [repo, oldSha, targetSha] = process.argv.slice(2)
  if (!repo || !oldSha || !targetSha) {
    console.error('Использование: node ops/prod-impact.mjs <repo> <old-sha> <target-sha>')
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(planBetweenCommits(repo, oldSha, targetSha))}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
