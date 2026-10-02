import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionPayload, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 运营缺株台账：防火林带验收结论的登记处，是本地数据层里的独立集合，只增不改。
const OPS_LEDGER_KEY = 'firebelt-ops-ledger'

// 现行验收标准。每次验收都把当时执行的标准快照进台账，历史结论不随标准调整回改。
const FIREBELT_ACCEPTANCE_STANDARD = '成活率≥85%判定完好，60%–85%判定部分成活（2026版）'

const FIREBELT_CONCLUSIONS = ['完好', '部分成活']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 运营缺株台账只增不改：每次验收追加一条，结论与当时执行的标准一起留存。
function appendOpsLedger(belt: EntryRow, conclusion: string, resultingStatus: string): void {
  const ledger = listRows(OPS_LEDGER_KEY)
  const entry: EntryRow = {
    id: nextId(ledger),
    status: conclusion,
    pending: conclusion !== '完好',
    abnormal: false,
    林带编号: String(belt.林带编号 ?? ''),
    林带名称: String(belt.林带名称 ?? ''),
    验收结论: conclusion,
    验收标准: FIREBELT_ACCEPTANCE_STANDARD,
    验收时间: today(),
    流转结果: `林带转「${resultingStatus}」`,
  }
  saveRows(OPS_LEDGER_KEY, [...ledger, entry])
}

// 防火隔离带维护待办：林带验收通过后，联动给防火隔离带模块追加一条待办记录。
function appendFirebreakTodo(belt: EntryRow): void {
  const rows = listRows('firebreak')
  const id = nextId(rows)
  const todo: EntryRow = {
    id,
    status: '需补植',
    pending: true,
    abnormal: false,
    隔离带编号: `FIRE-${String(id).padStart(4, '0')}`,
    所属林区: String(belt.所属林区 ?? ''),
    起止坐标: '待补录',
    带宽米数: String(belt.林带宽度 ?? '') || '待补录',
    建成日期: today(),
    最近维护日期: today(),
    植被恢复程度: '待评估',
    维护状态: `防火林带「${String(belt.林带名称 ?? '')}」验收通过，联动生成维护待办`,
  }
  saveRows('firebreak', [...rows, todo])
}

export function runAction(key: string, id: number, action: string, payload: ActionPayload = {}): ActionResult {
  const meta = moduleMeta(key)
  const baseTarget = meta.actionTargets[action]
  if (!baseTarget) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)

  // 单向流转：登记了源状态的动作只能从源状态发起，不能跳步也不能回退；
  // 同一林带重复提交验收会在这里被拦下，完成数不会连续增加。
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    const expectation =
      sources.length === 1 ? `需处于「${sources[0]}」` : `需处于${sources.map((s) => `「${s}」`).join('、')}之一`
    return { ok: false, message: `${meta.entity}当前状态「${current}」不能执行「${action}」，单向流转${expectation}` }
  }

  // 防火林带完好验收：验收结论决定目标状态。部分成活先转「有缺株」而不是「需补植」——
  // 「需补植」是安排补植之后的状态，直接跳过去会绕过单向链上的安排动作。
  let conclusion = ''
  let target = baseTarget
  if (key === 'firebelt' && action === '完好验收') {
    conclusion = payload.conclusion ?? '完好'
    if (!FIREBELT_CONCLUSIONS.includes(conclusion)) {
      return { ok: false, message: `完好验收结论只能是${FIREBELT_CONCLUSIONS.map((c) => `「${c}」`).join('或')}` }
    }
    target = conclusion === '部分成活' ? '有缺株' : '完好'
  }

  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 动作前置字段：登记了的字段必须先保存（非空）才允许流转。
  const required = meta.actionRequirements?.[action] ?? []
  const missing = required.filter((field) => String(row[field] ?? '').trim() === '')
  if (missing.length > 0) {
    return { ok: false, message: `${meta.entity}执行「${action}」前必须先保存${missing.join('、')}` }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (conclusion) {
    // 林带上只留最近一次验收结论，完整历史在运营缺株台账里。
    updated.最近验收结论 = conclusion
    updated.最近验收标准 = FIREBELT_ACCEPTANCE_STANDARD
    updated.最近验收时间 = today()
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  if (conclusion) {
    appendOpsLedger(row, conclusion, target)
    if (conclusion === '完好') {
      appendFirebreakTodo(row)
      return { ok: true, message: `${meta.entity}验收通过，当前状态「完好」；运营缺株台账与防火隔离带维护待办已各登记 1 条` }
    }
    return { ok: true, message: `${meta.entity}验收结论「部分成活」，已转「有缺株」；运营缺株台账已登记 1 条` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function saveEntryFields(key: string, id: number, fields: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const patch: Record<string, string> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (meta.fields.includes(field)) {
      patch[field] = value.trim()
    }
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: `${meta.entity}没有可保存的字段` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], ...patch }
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}信息已保存` }
}

export function listFirebeltOpsLedger(): EntryRow[] {
  return listRows(OPS_LEDGER_KEY)
}

export function currentAcceptanceStandard(): string {
  return FIREBELT_ACCEPTANCE_STANDARD
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
