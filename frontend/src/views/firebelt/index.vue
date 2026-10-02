<template>
  <section class="page" data-module="firebelt">
    <header class="page-head">
      <div>
        <h2>防火林带管理</h2>
        <p class="page-desc">维护防火林带，围绕林带编号、林带名称、所属林区、树种组成做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记防火林带</button>
        <button class="btn" type="button" @click="exportRows">导出防火林带清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openEdit(row)">补录</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无防火林带数据，可先登记防火林带</td>
        </tr>
      </tbody>
    </table>

    <div v-if="editingRow" class="dialog-mask">
      <div class="dialog">
        <h3>补录林带信息（{{ editingRow.林带编号 }}）</h3>
        <label>
          林带名称
          <input v-model="editForm.林带名称" placeholder="必填" />
        </label>
        <label>
          树种组成
          <input v-model="editForm.树种组成" placeholder="必填" />
        </label>
        <label>
          林带宽度
          <input v-model="editForm.林带宽度" placeholder="必填" />
        </label>
        <p class="dialog-tip">确认补植前必须先保存林带名称、树种组成和林带宽度。</p>
        <div class="dialog-actions">
          <button class="btn primary" type="button" @click="submitEdit">保存</button>
          <button class="btn ghost" type="button" @click="editingRow = null">取消</button>
        </div>
      </div>
    </div>

    <div v-if="acceptingRow" class="dialog-mask">
      <div class="dialog">
        <h3>完好验收（{{ acceptingRow.林带名称 }}）</h3>
        <label>
          成活情况
          <select v-model="acceptForm.成活情况">
            <option value="全部成活">全部成活</option>
            <option value="部分成活">部分成活</option>
          </select>
        </label>
        <label>
          缺株情况
          <input v-model="acceptForm.缺株情况" placeholder="全部成活可填：无缺株" />
        </label>
        <p class="dialog-tip">
          验收通过转「完好」，并同步登记运营缺株台账和防火隔离带维护待办各一条；部分成活先转「需补植」。
        </p>
        <div class="dialog-actions">
          <button class="btn primary" type="button" @click="submitAccept">提交验收</button>
          <button class="btn ghost" type="button" @click="acceptingRow = null">取消</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条防火林带记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  saveEntryFields,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('firebelt')
const columns = ["林带编号", "林带名称", "所属林区", "树种组成", "林带长度", "林带宽度", "种植年份", "林带状态"]
const actions = ["安排补植", "确认补植", "完好验收", "标记退化"]
const statuses = ["完好", "有缺株", "需补植", "待验收", "已退化"]

const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 统计按全量数据算，不受筛选条件影响，验收通过一次完好条数只加一。
const stats = computed(() => [
  { label: '林带总数', value: allRows.value.length },
  { label: '完好条数', value: allRows.value.filter((row) => String(row.status) === '完好').length },
  { label: '缺株条数', value: allRows.value.filter((row) => String(row.status) === '有缺株').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const editingRow = ref<EntryRow | null>(null)
const editForm = ref({ 林带名称: '', 树种组成: '', 林带宽度: '' })
const acceptingRow = ref<EntryRow | null>(null)
const acceptForm = ref({ 成活情况: '全部成活', 缺株情况: '' })

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '防火林带登记入口尚未接入审批流'
}

function openEdit(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  editingRow.value = row
  editForm.value = {
    林带名称: String(row.林带名称 ?? ''),
    树种组成: String(row.树种组成 ?? ''),
    林带宽度: String(row.林带宽度 ?? ''),
  }
}

function submitEdit() {
  if (!editingRow.value) {
    return
  }
  const result = saveEntryFields(meta.key, Number(editingRow.value.id), { ...editForm.value })
  editingRow.value = null
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  noticeMessage.value = result.message
}

function openAccept(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  acceptingRow.value = row
  acceptForm.value = { 成活情况: '全部成活', 缺株情况: '' }
}

function submitAccept() {
  if (!acceptingRow.value) {
    return
  }
  const result = applyAction(meta.key, Number(acceptingRow.value.id), '完好验收', {
    outcome: acceptForm.value.成活情况,
    note: acceptForm.value.缺株情况,
  })
  acceptingRow.value = null
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  noticeMessage.value = result.message
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (action === '完好验收') {
    openAccept(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  noticeMessage.value = result.message
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allRows.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '防火林带列表读取失败'
  }
}

onMounted(reload)
</script>
