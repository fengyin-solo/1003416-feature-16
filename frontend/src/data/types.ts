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
  /** 单向流转约束：动作允许发起的源状态；不登记的动作保持任意状态可执行 */
  actionSources?: Record<string, string[]>
  /** 动作执行前必须已保存（非空）的字段 */
  actionRequirements?: Record<string, string[]>
  metrics: string[]
}

export type ActionPayload = {
  /** 验收类动作的结论，例如防火林带完好验收：完好 / 部分成活 */
  conclusion?: string
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
