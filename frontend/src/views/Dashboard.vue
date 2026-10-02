<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">运营缺株台账</h3>
    <p class="page-desc">防火林带完好验收的结论逐条登记于此；历史结论按当时验收标准保留，不随标准调整回改。</p>
    <table class="data-table ledger-table">
      <thead>
        <tr><th>林带编号</th><th>林带名称</th><th>验收结论</th><th>验收标准</th><th>验收时间</th><th>流转结果</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in ledgerRows" :key="String(row.id)">
          <td>{{ row.林带编号 }}</td>
          <td>{{ row.林带名称 }}</td>
          <td>{{ row.验收结论 }}</td>
          <td>{{ row.验收标准 }}</td>
          <td>{{ row.验收时间 }}</td>
          <td>{{ row.流转结果 }}</td>
        </tr>
        <tr v-if="!ledgerRows.length">
          <td colspan="6" class="empty-state">暂无台账记录，防火林带完好验收后自动登记</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { listFirebeltOpsLedger, loadOverview } from '@/api/local-service'
import type { EntryRow, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const ledgerRows = ref<EntryRow[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  ledgerRows.value = listFirebeltOpsLedger()
}

onMounted(refresh)
</script>
