import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionPayload, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 防火林带现行验收标准：结论落库时带上当时的标准，以后标准调整也不回写历史结论。
const FIREBELT_ACCEPTANCE_STANDARD = '成活率≥90%为全部成活'

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

export function runAction(
  key: string,
  id: number,
  action: string,
  payload: ActionPayload = {},
): ActionResult {
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
  const current = String(rows[index].status)

  // 单向流转：登记了来源状态的动作只能从指定状态发起，不能跳步也不能回头。
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    const allowed = sources.map((status) => `「${status}」`).join('、')
    return { ok: false, message: `「${action}」只能从${allowed}发起，当前状态是「${current}」，请按顺序流转` }
  }

  // 前置字段：要求的字段没保存齐，不允许执行这个动作。
  const required = meta.requiredBefore?.[action] ?? []
  const missing = required.filter((field) => String(rows[index][field] ?? '').trim() === '')
  if (missing.length > 0) {
    return { ok: false, message: `执行「${action}」前必须先保存${missing.join('、')}，请先补录再流转` }
  }

  // 分支动作：按验收结果分流到不同目标状态（如完好验收按成活情况判定）。
  let target = baseTarget
  const branches = meta.actionBranches?.[action]
  if (branches) {
    const outcome = (payload.outcome ?? '').trim()
    if (!outcome) {
      return { ok: false, message: `执行「${action}」前请先选择验收结果（${Object.keys(branches).join('、')}）` }
    }
    const branched = branches[outcome]
    if (!branched) {
      return { ok: false, message: `「${action}」不支持「${outcome}」这种结果` }
    }
    target = branched
  }

  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  let message = `${meta.entity}已${action}，当前状态「${target}」`
  if (key === 'firebelt' && action === '完好验收') {
    message = settleFirebeltAcceptance(updated, payload, target)
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message }
}

// 补录字段：只接受非空值，保存后流转的前置校验才能通过。
export function saveEntryFields(key: string, id: number, fields: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const entries = Object.entries(fields)
  const empty = entries.filter(([, value]) => value.trim() === '').map(([field]) => field)
  if (empty.length > 0) {
    return { ok: false, message: `${empty.join('、')}不能为空，填写完整再保存` }
  }
  const updated: EntryRow = { ...rows[index] }
  for (const [field, value] of entries) {
    updated[field] = value.trim()
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}信息已保存` }
}

// 完好验收落结论：通过才联动登记运营缺株台账和防火隔离带维护待办各一条。
// 验收动作只能从「待验收」发起，同一林带重复提交会被来源状态校验拦住，完成数不会连续增加。
function settleFirebeltAcceptance(belt: EntryRow, payload: ActionPayload, target: string): string {
  const passed = target === '完好'
  belt.验收日期 = today()
  belt.验收标准 = FIREBELT_ACCEPTANCE_STANDARD
  belt.验收结论 = passed ? '全部成活，验收通过' : '部分成活，先转需补植'
  if (!passed) {
    return `防火林带完好验收结果为部分成活，当前状态「${target}」，补植后重新确认再报验`
  }
  appendGapLedger(belt, payload)
  appendFirebreakTodo(belt)
  return '防火林带完好验收通过，当前状态「完好」，已同步登记运营缺株台账和防火隔离带维护待办各一条'
}

function appendGapLedger(belt: EntryRow, payload: ActionPayload): void {
  const rows = listRows('gapledger')
  const id = nextId(rows)
  const entry: EntryRow = {
    id,
    status: '待处理',
    pending: true,
    abnormal: false,
    台账编号: `GAP-${String(id).padStart(4, '0')}`,
    来源模块: '防火林带',
    林带编号: String(belt.林带编号 ?? ''),
    林带名称: String(belt.林带名称 ?? ''),
    缺株情况: payload.note?.trim() || '无缺株（全部成活）',
    验收结论: `全部成活，验收通过（标准：${FIREBELT_ACCEPTANCE_STANDARD}）`,
    登记日期: today(),
    处理状态: '待处理',
  }
  saveRows('gapledger', [...rows, entry])
}

function appendFirebreakTodo(belt: EntryRow): void {
  const rows = listRows('firebreak')
  const id = nextId(rows)
  const todo: EntryRow = {
    id,
    status: '需割草',
    pending: true,
    abnormal: false,
    隔离带编号: `FIRE-${String(id).padStart(4, '0')}`,
    所属林区: String(belt.所属林区 ?? ''),
    起止坐标: '待现场测定',
    带宽米数: String(belt.林带宽度 ?? ''),
    建成日期: today(),
    最近维护日期: today(),
    植被恢复程度: '待核查',
    维护状态: '需割草',
  }
  saveRows('firebreak', [...rows, todo])
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
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
