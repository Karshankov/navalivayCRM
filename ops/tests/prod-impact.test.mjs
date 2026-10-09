import assert from 'node:assert/strict'
import test from 'node:test'

import { extractRelativeImports, planImpact } from '../prod-impact.mjs'

const graph = (values = {}) => ({
  api: new Set(values.api || []),
  bot: new Set(values.bot || []),
  userbot: new Set(values.userbot || []),
})

test('извлекает ESM, CommonJS и dynamic import', () => {
  const imports = extractRelativeImports(`
    import x from './x.js'
    export { y } from "../y.js"
    const z = require('./z')
    await import('./lazy.js')
  `)
  assert.deepEqual(new Set(imports), new Set(['./x.js', '../y.js', './z', './lazy.js']))
})

test('frontend собирается без рестартов', () => {
  const plan = planImpact([
    'frontend/src/App.vue',
    'frontend/src/assets/product.webp',
    'frontend/public/ownership.txt',
  ], graph(), graph())
  assert.equal(plan.frontendBuild, true)
  assert.deepEqual(plan.components, [])
})

test('API, bot и userbot определяются по графу', () => {
  const oldGraph = graph({
    api: ['server/routes/api.js'],
    bot: ['server/services/bot-shared.js'],
    userbot: ['server/userbot/client.js'],
  })
  assert.deepEqual(planImpact(['server/routes/api.js'], oldGraph, graph()).components, ['api'])
  assert.deepEqual(planImpact(['server/services/bot-shared.js'], oldGraph, graph()).components, ['bot'])
  assert.deepEqual(planImpact(['server/userbot/client.js'], oldGraph, graph()).components, ['userbot'])
})

test('общий модуль затрагивает все точки входа', () => {
  const shared = graph({ api: ['server/db.js'], bot: ['server/db.js'], userbot: ['server/db.js'] })
  assert.deepEqual(planImpact(['server/db.js'], shared, shared).components, ['api', 'bot', 'userbot'])
})

test('старый и новый граф объединяются для удалённого модуля', () => {
  const oldGraph = graph({ api: ['server/removed.js'] })
  assert.deepEqual(planImpact(['server/removed.js'], oldGraph, graph()).components, ['api'])
})

test('server dependencies требуют npm ci и всех рестартов', () => {
  const plan = planImpact(['server/package-lock.json'], graph(), graph())
  assert.equal(plan.serverInstall, true)
  assert.deepEqual(plan.components, ['api', 'bot', 'userbot'])
})

test('изменение PM2-конфига применяет его к bot и userbot', () => {
  const plan = planImpact(['server/ecosystem.config.cjs'], graph(), graph())
  assert.equal(plan.pm2Reload, true)
  assert.deepEqual(plan.components, ['bot', 'userbot'])
})

test('смешанный коммит объединяет действия', () => {
  const reachable = graph({ api: ['server/index.js'], bot: ['server/bot.js'] })
  const plan = planImpact(['frontend/src/App.vue', 'server/index.js', 'server/bot.js'], reachable, reachable)
  assert.equal(plan.frontendBuild, true)
  assert.deepEqual(plan.components, ['api', 'bot'])
})

test('docs и тесты не вызывают действий', () => {
  const plan = planImpact(['docs/runbook.md', 'server/tests/api.test.js', 'AGENTS.md'], graph(), graph())
  assert.equal(plan.noRuntimeActions, true)
  assert.deepEqual(plan.blocked, [])
})

test('файлы без влияния на прод не блокируют и не вызывают действий', () => {
  const plan = planImpact(
    ['.gitignore', 'server/dev-server.js', 'ops/nginx.conf'],
    graph(),
    graph(),
  )
  assert.deepEqual(plan.blocked, [])
  assert.equal(plan.noRuntimeActions, true)
})

test('настоящие инфраструктурные пути блокируют по-прежнему', () => {
  // Послабление для справочной копии не должно распространяться на конфиги,
  // которые действительно раскатывают на сервер.
  const plan = planImpact(['nginx/site.conf', 'ops/systemd/api.service'], graph(), graph())
  assert.equal(plan.blocked.length, 2)
})

test('соседний серверный файл вне графа запуска по-прежнему блокирует', () => {
  // Исключение точечное: послабление не должно расползтись на server/dev-*.
  const plan = planImpact(['server/dev-tools.js'], graph(), graph())
  assert.equal(plan.blocked.length, 1)
})

test('неизвестный путь и инфраструктура блокируют деплой', () => {
  const plan = planImpact([
    'mystery/config.bin',
    'ops/systemd/unit.service',
    'server/prompts/runtime.txt',
  ], graph(), graph())
  assert.equal(plan.blocked.length, 3)
})
