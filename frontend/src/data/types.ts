/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 单向流转约束：动作 → 允许发起的来源状态；不登记则不限制来源 */
  actionSources?: Record<string, string[]>
  /** 动作执行前必须已保存（非空）的字段 */
  requiredBefore?: Record<string, string[]>
  /** 按结果分支到不同目标状态：动作 → 结果 → 目标状态 */
  actionBranches?: Record<string, Record<string, string>>
}

/** 执行动作时附带的业务数据：验收结果、补充说明等 */
export type ActionPayload = {
  outcome?: string
  note?: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
