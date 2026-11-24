/**
 * 人生日历 · Host 半
 * ==============================
 * 在 DSH 认证共享 API 上注册 `/api/life-calendar`：
 *   POST /api/life-calendar
 *   body: { type:'client-request', rpcId, method:'life-calendar', payload:{ action, ... } }
 *   resp: { type:'server-response', rpcId, result:{ ok:true, value } }
 *       | { type:'server-response', rpcId, result:{ ok:false, error:{ code, message } } }
 *
 * 数据落在 $DSH_HOME/life-calendar/life.json（可用 DSH_LIFE_CALENDAR_FILE 覆盖），
 * 结构：{ version, profile:{ birth, expectancy }, events:[{ id, date, title, kind, star, note }] }
 *
 * 失败策略：文件损坏就报 store-corrupt 并**绝不覆盖**原文件；写盘走临时文件 + rename。
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-life-calendar'
export const inject = ['connection']

const ENDPOINT = 'life-calendar'
const VERSION = 4
const MAX_TITLE = 120
const MAX_NOTE = 2000
const MAX_EVENTS = 2000
const MAX_STAGES = 40
const MAX_STAGE_NAME = 24
const MAX_STAGE_NOTE = 400
const MAX_STRATEGY = 4000
const MAX_SUMMARY_LEGACY_TITLE = 80
const MAX_SUMMARY_BODY = 4000
const MAX_SUMMARIES = 50
const YEAR_MIN = 1800
const YEAR_MAX = 2200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KIND_SLUG_RE = /^[a-z][a-z0-9_-]{0,15}$/  // 类型 slug 形状
const KINDS = ['milestone', 'work', 'study', 'family', 'health', 'travel', 'invest', 'other']

class LifeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LifeCalendarError'
    this.code = code
  }
}

function storePath() {
  const explicit = process.env.DSH_LIFE_CALENDAR_FILE
  if (explicit) return explicit
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'life-calendar', 'life.json')
}

function emptyDoc() {
  return {
    version: VERSION,
    profile: { birth: null, expectancy: 80 },
    events: [],
    stages: [],
    strategy: '',
    summaries: [],
  }
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function newId() {
  return randomBytes(6).toString('hex')
}

function normalizeEvent(raw) {
  const e = isRecord(raw) ? raw : {}
  const date = str(e.date, 10)
  const title = str(e.title, MAX_TITLE)
  if (!DATE_RE.test(date)) throw new LifeError('invalid-payload', '日期必须是 YYYY-MM-DD。')
  if (!title) throw new LifeError('invalid-payload', '标题不能为空。')
  return {
    id: /^[a-z0-9]{6,32}$/.test(String(e.id || '')) ? String(e.id) : newId(),
    date,
    title,
    // 已知类型照收；未知但形状合法的 slug 也原样保留（不静默降级成 other，
    // 免得旧宿主进程读到新客户端写的类型后把数据改脏）。
    kind: KINDS.includes(e.kind) ? e.kind
      : (typeof e.kind === 'string' && KIND_SLUG_RE.test(e.kind) ? e.kind : 'other'),
    star: e.star === true,
    note: str(e.note, MAX_NOTE),
  }
}

/* 阶段：按年份区间切分一生。年份是绝对的，年龄是派生量，换生日也不用重算数据。 */
function normalizeStage(raw) {
  const s = isRecord(raw) ? raw : {}
  const from = Math.round(Number(s.from))
  const to = Math.round(Number(s.to))
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new LifeError('invalid-payload', '阶段要有起始年和结束年。')
  }
  if (from < YEAR_MIN || to > YEAR_MAX || from > to) {
    throw new LifeError('invalid-payload', '年份区间不成立（需要 ' + YEAR_MIN + '..' + YEAR_MAX + '，且起 ≤ 止）。')
  }
  return {
    id: /^[a-z0-9]{6,32}$/.test(String(s.id || '')) ? String(s.id) : newId(),
    name: str(s.name, MAX_STAGE_NAME) || '未命名阶段',
    from,
    to,
    note: str(s.note, MAX_STAGE_NOTE),
  }
}

/* 总结：一段时期之后回头看，写下还成立的那几句。只留「什么时候」和「写了什么」。 */
function todayStr() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + mm + '-' + dd
}

function normalizeSummary(raw) {
  const s = isRecord(raw) ? raw : {}
  // 兼容 v3 的 {title, body}：标题并进正文，日期补今天。
  const legacy = str(s.title, MAX_SUMMARY_LEGACY_TITLE)
  const body = [legacy, str(s.body, MAX_SUMMARY_BODY)].filter(Boolean).join(' —— ')
  if (!body) throw new LifeError('invalid-payload', '总结要有内容。')
  const date = str(s.date, 10)
  return {
    id: /^[a-z0-9]{6,32}$/.test(String(s.id || '')) ? String(s.id) : newId(),
    date: DATE_RE.test(date) ? date : todayStr(),
    body: body.slice(0, MAX_SUMMARY_BODY),
  }
}

function sortSummaries(list) {
  return list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

function sortStages(list) {
  return list.slice().sort((a, b) => (a.from - b.from) || (a.to - b.to))
}

function normalizeDoc(raw) {
  const doc = emptyDoc()
  if (!isRecord(raw)) return doc
  const p = isRecord(raw.profile) ? raw.profile : {}
  const birth = str(p.birth, 10)
  doc.profile.birth = DATE_RE.test(birth) ? birth : null
  const years = Number(p.expectancy)
  doc.profile.expectancy = Number.isFinite(years)
    ? Math.min(120, Math.max(1, Math.round(years))) : 80
  const list = Array.isArray(raw.events) ? raw.events : []
  doc.events = list
    .map((e) => { try { return normalizeEvent(e) } catch { return null } })
    .filter(Boolean)
    .slice(0, MAX_EVENTS)
  doc.strategy = str(raw.strategy, MAX_STRATEGY)
  const rawSummaries = Array.isArray(raw.summaries) ? raw.summaries : []
  doc.summaries = sortSummaries(rawSummaries
    .map((x) => { try { return normalizeSummary(x) } catch { return null } })
    .filter(Boolean)
    .slice(0, MAX_SUMMARIES))
  const rawStages = Array.isArray(raw.stages) ? raw.stages : []
  doc.stages = sortStages(rawStages
    .map((s) => { try { return normalizeStage(s) } catch { return null } })
    .filter(Boolean)
    .slice(0, MAX_STAGES))
  return doc
}

/* ── 读写（串行化，读-改-写不交错） ── */
let queue = Promise.resolve()

function serialize(fn) {
  const run = queue.then(fn, fn)
  queue = run.then(() => undefined, () => undefined)
  return run
}

async function readDoc() {
  const file = storePath()
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyDoc()
    throw new LifeError('store-unavailable', '读不到数据文件：' + file)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new LifeError('store-corrupt', '数据文件不是合法 JSON，已停止写入：' + file)
  }
  if (!isRecord(raw) || !Array.isArray(raw.events)) {
    throw new LifeError('store-corrupt', '数据文件结构不认识，已停止写入：' + file)
  }
  return normalizeDoc(raw)
}

async function writeDoc(doc) {
  const file = storePath()
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + newId()
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
  return doc
}

function sortEvents(list) {
  return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)))
}

/* ── 业务动作 ── */
async function run(payload) {
  const action = str(payload.action, 40) || 'get'

  if (action === 'get') {
    return { ...(await readDoc()), file: storePath() }
  }

  if (action === 'profile') {
    return serialize(async () => {
      const doc = await readDoc()
      const birth = str(payload.birth, 10)
      if (birth && !DATE_RE.test(birth)) throw new LifeError('invalid-payload', '生日必须是 YYYY-MM-DD。')
      doc.profile.birth = birth || null
      const years = Number(payload.expectancy)
      if (Number.isFinite(years)) doc.profile.expectancy = Math.min(120, Math.max(1, Math.round(years)))
      await writeDoc(doc)
      return { ...doc, file: storePath() }
    })
  }

  if (action === 'save') {
    return serialize(async () => {
      const doc = await readDoc()
      const next = normalizeEvent(payload.event || payload)
      const idx = doc.events.findIndex((e) => e.id === next.id)
      if (idx >= 0) doc.events[idx] = next
      else {
        if (doc.events.length >= MAX_EVENTS) throw new LifeError('invalid-payload', '事件过多（上限 ' + MAX_EVENTS + ' 条）。')
        doc.events.push(next)
      }
      doc.events = sortEvents(doc.events)
      await writeDoc(doc)
      return { ...doc, file: storePath(), saved: next.id }
    })
  }

  if (action === 'stage-save') {
    return serialize(async () => {
      const doc = await readDoc()
      const next = normalizeStage(payload.stage || payload)
      const clash = doc.stages.find((s) => s.id !== next.id && s.from <= next.to && next.from <= s.to)
      if (clash) {
        throw new LifeError('invalid-payload', '和「' + clash.name + '」（' + clash.from + '–' + clash.to + '）重叠了。')
      }
      const idx = doc.stages.findIndex((s) => s.id === next.id)
      if (idx >= 0) doc.stages[idx] = next
      else {
        if (doc.stages.length >= MAX_STAGES) throw new LifeError('invalid-payload', '阶段过多（上限 ' + MAX_STAGES + ' 个）。')
        doc.stages.push(next)
      }
      doc.stages = sortStages(doc.stages)
      await writeDoc(doc)
      return { ...doc, file: storePath(), saved: next.id }
    })
  }

  if (action === 'stage-delete') {
    return serialize(async () => {
      const doc = await readDoc()
      const id = str(payload.id, 32)
      const before = doc.stages.length
      doc.stages = doc.stages.filter((s) => s.id !== id)
      if (doc.stages.length === before) throw new LifeError('not-found', '没有这个阶段（可能已删除）。')
      await writeDoc(doc)
      return { ...doc, file: storePath(), deleted: id }
    })
  }

  if (action === 'strategy-save') {
    return serialize(async () => {
      const doc = await readDoc()
      doc.strategy = str(payload.text, MAX_STRATEGY)
      await writeDoc(doc)
      return { ...doc, file: storePath(), saved: 'strategy' }
    })
  }

  if (action === 'summary-save') {
    return serialize(async () => {
      const doc = await readDoc()
      const next = normalizeSummary(payload.summary || payload)
      const idx = doc.summaries.findIndex((x) => x.id === next.id)
      if (idx >= 0) doc.summaries[idx] = next
      else {
        if (doc.summaries.length >= MAX_SUMMARIES) throw new LifeError('invalid-payload', '总结过多（上限 ' + MAX_SUMMARIES + ' 条）。')
        doc.summaries.unshift(next)
      }
      doc.summaries = sortSummaries(doc.summaries)
      await writeDoc(doc)
      return { ...doc, file: storePath(), saved: next.id }
    })
  }

  if (action === 'summary-delete') {
    return serialize(async () => {
      const doc = await readDoc()
      const id = str(payload.id, 32)
      const before = doc.summaries.length
      doc.summaries = doc.summaries.filter((x) => x.id !== id)
      if (doc.summaries.length === before) throw new LifeError('not-found', '没有这条总结（可能已删除）。')
      await writeDoc(doc)
      return { ...doc, file: storePath(), deleted: id }
    })
  }

  if (action === 'delete') {
    return serialize(async () => {
      const doc = await readDoc()
      const id = str(payload.id, 32)
      const before = doc.events.length
      doc.events = doc.events.filter((e) => e.id !== id)
      if (doc.events.length === before) throw new LifeError('not-found', '没有这条事件（可能已删除）。')
      await writeDoc(doc)
      return { ...doc, file: storePath(), deleted: id }
    })
  }

  throw new LifeError('bad-request', '不认识的 action：' + action)
}

/* ── HTTP 信封 ── */
function envelope(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId, result })
}

function failure(rpcId, code, message) {
  /* 🔴 2026-11-20：DSH 只认 result.error = { code, message, details }。
     少了 details 会被判成 "connection: invalid server-response failure"，
     真实错误被吞掉。见 simple-desk 的同一条注释。 */
  return envelope(rpcId, {
    ok: false,
    error: {
      code: String(code || 'internal'),
      message: String(message || '未知错误'),
      details: { where: 'handle', at: new Date().toISOString() },
    },
  })
}

async function handle(request) {
  let body = null
  try {
    body = await request.json()
  } catch {
    return failure(null, 'bad-request', '请求体不是合法 JSON。')
  }
  const rpcId = isRecord(body) && typeof body.rpcId === 'string' ? body.rpcId : null
  if (!isRecord(body) || body.type !== 'client-request' || !rpcId || body.method !== ENDPOINT) {
    return failure(rpcId, 'bad-request', '协议不对：需要 client-request 信封。')
  }
  try {
    const value = await run(isRecord(body.payload) ? body.payload : {})
    return envelope(rpcId, { ok: true, value })
  } catch (err) {
    const code = err && err.code ? err.code : 'internal'
    const message = err && err.message ? err.message : String(err)
    if (!(err instanceof LifeError)) console.error('[life-calendar]', err)
    return failure(rpcId, code, message)
  }
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: `/api/${ENDPOINT}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handle(request),
    }),
  )
}
