<script setup lang="ts">
import { computed, ref } from "vue";
import type { Batch, Plot } from "../../../shared/contracts";
import { items } from "../../../shared/catalog";
import { hourLabel } from "../../../shared/catalog";
import { fmt } from "../../../shared/money";
import type { LedgerEntry } from "../lib/contracts";
import { buildReport } from "../index";
import { createLedger } from "../model/store";

const props = defineProps<{
  ledger: ReturnType<typeof createLedger>;
  batches: readonly Readonly<Batch>[];
  plots: readonly Readonly<Plot>[];
  wips: { jobId: string; inputCost: number; fee: number }[];
  coins: number;
  wasted: number;
}>();

const filter = ref<"all" | LedgerEntry["type"]>("all");
const openId = ref<string | null>(null);

const report = computed(() =>
  buildReport(
    props.ledger,
    props.batches,
    props.plots,
    props.wips,
    props.coins,
  ),
);

const entries = computed(() =>
  [...props.ledger.state.entries]
    .reverse()
    .filter((e) => filter.value === "all" || e.type === filter.value),
);

const typeName: Record<LedgerEntry["type"], string> = {
  opening: "期初",
  plant: "播种",
  harvest: "收获",
  processing: "加工",
  sale: "出售",
  delivery: "交付",
  spoilage: "腐坏",
  "fee-loss": "费用损失",
};

const filters: { key: "all" | LedgerEntry["type"]; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "plant", label: "播种" },
  { key: "harvest", label: "收获" },
  { key: "processing", label: "加工" },
  { key: "sale", label: "出售" },
  { key: "delivery", label: "交付" },
  { key: "spoilage", label: "腐坏" },
  { key: "fee-loss", label: "费用损失" },
];

const cashFlow = (e: LedgerEntry): number | null => {
  switch (e.type) {
    case "opening":
      return e.cash;
    case "plant":
      return e.cashDelta;
    case "processing":
      return -e.fee;
    case "sale":
      return e.revenue;
    case "delivery":
      return e.revenue;
    default:
      return null;
  }
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "0.00" : fmt(n);

const entryCosts = (e: LedgerEntry) => {
  if ("costs" in e) return e.costs;
  if (e.type === "delivery")
    return e.lines.flatMap((l) => l.costs);
  if (e.type === "processing")
    return e.inputLines.flatMap((l) => l.costs);
  return [];
};
</script>

<template>
  <section class="panel ledger-panel">
    <div class="panel-heading">
      <h2>经营账</h2>
      <span>批次成本 · 永续盘存</span>
    </div>

    <div class="ledger-grid">
      <div class="ledger-card">
        <small>现金余额</small><strong>◈ {{ report.cash }}</strong>
      </div>
      <div class="ledger-card">
        <small>库存成本</small><strong>¥{{ report.inventoryCost }}</strong>
      </div>
      <div class="ledger-card">
        <small>田间在长</small><strong>¥{{ report.growingCost }}</strong>
      </div>
      <div class="ledger-card">
        <small>加工在制品</small><strong>¥{{ report.wipCost }}</strong>
      </div>
      <div class="ledger-card" :class="{ neg: report.realizedProfit < 0 }">
        <small>已实现利润</small><strong>¥{{ report.realizedProfit }}</strong>
      </div>
      <div class="ledger-card neg">
        <small>累计损耗</small><strong>¥{{ report.totalLoss }}</strong>
      </div>
    </div>

    <div class="ledger-checks">
      <div
        v-for="c in report.checks"
        :key="c.label"
        class="check-row"
        :class="{ bad: !c.ok }"
      >
        <b>{{ c.ok ? "✓" : "✕" }}</b>
        <span>{{ c.label }}</span>
        <small>{{ c.detail }}</small>
      </div>
    </div>

    <div class="ledger-sub">
      <span>播种支出 ¥{{ report.totals.seedSpend }}</span>
      <span>加工费 ¥{{ report.totals.feeSpend }}</span>
      <span>销售收入 ¥{{ report.totals.saleRevenue }}</span>
      <span>交付收入 ¥{{ report.totals.deliveryRevenue }}</span>
      <span>实物损耗 {{ wasted }} 份</span>
      <span v-if="report.totals.unknownCost !== null" class="unknown-note"
        >含成本未知旧货</span
      >
    </div>

    <div class="ledger-filters">
      <button
        v-for="f in filters"
        :key="f.key"
        :class="{ active: filter === f.key }"
        @click="filter = f.key"
      >
        {{ f.label }}
      </button>
    </div>

    <div class="ledger-entries">
      <article
        v-for="e in entries"
        :key="e.id"
        class="ledger-row"
        :class="[e.type, { open: openId === e.id }]"
        @click="openId = openId === e.id ? null : e.id"
      >
        <div class="ledger-row-head">
          <b class="ledger-type">{{ typeName[e.type] }}</b>
          <span class="ledger-memo">{{ e.memo }}</span>
          <span class="ledger-time">{{ hourLabel(e.hour) }}</span>
          <strong
            v-if="cashFlow(e) !== null"
            class="ledger-cash"
            :class="{ neg: cashFlow(e)! < 0 }"
            >{{ cashFlow(e)! >= 0 ? "+" : "" }}¥{{ money(cashFlow(e)) }}</strong
          >
        </div>
        <div class="ledger-refs">
          <small v-if="e.plotId !== undefined">田块{{ e.plotId + 1 }}</small>
          <small v-if="e.jobId">任务 {{ e.jobId }}</small>
          <small v-if="e.orderId">合同 {{ e.orderId }}</small>
          <small v-if="e.plantingId">播种 {{ e.plantingId }}</small>
          <small v-for="b in e.batchIds" :key="b">批次 {{ b }}</small>
          <small v-if="('unknown' in e && e.unknown)" class="unknown-note"
            >成本未知</small
          >
        </div>
        <div v-if="openId === e.id" class="ledger-detail" @click.stop>
          <div v-if="e.type === 'processing' && e.inputLines.length">
            <p v-for="l in e.inputLines" :key="l.batch" class="cost-line">
              消耗 {{ items[l.item].name }} 批次 {{ l.batch }} ×{{ l.quantity }}
              · 成本 ¥{{ money(l.cost) }}
            </p>
            <p
              v-for="o in e.outputs"
              :key="o.batch"
              class="cost-line out"
            >
              产出批次 {{ o.batch }} ×{{ o.quantity }} · 分摊成本 ¥{{ money(o.cost) }}
            </p>
          </div>
          <div v-if="entryCosts(e).length" class="cost-components">
            <p v-for="(c, i) in entryCosts(e)" :key="i" class="cost-line">
              <b>{{ c.label }}</b>
              <span
                >数量 {{ money(c.quantity ?? 0) }} · 单价 ¥{{ money(c.unitCost) }} ·
                金额 ¥{{ money(c.amount) }}</span
              >
              <em v-if="c.unknown" class="unknown-note">未知</em>
            </p>
          </div>
          <p v-if="e.type === 'processing' && e.failedAt" class="cost-line bad">
            加工失败（{{ e.failedAt === "ready" ? "成品变质" : "原料腐坏" }}）·
            在制品损失 ¥{{ money(e.lostInputCost ?? 0) }} · 加工费损失
            ¥{{ money(e.lostFee ?? e.fee) }}
          </p>
        </div>
      </article>
      <p v-if="!entries.length" class="empty">暂无该类流水。</p>
    </div>
    <p class="hint">流水不可变 · 余额随业务实时更新，非打开面板重算</p>
  </section>
</template>
