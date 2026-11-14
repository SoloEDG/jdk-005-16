import { reactive, readonly } from "vue";
import type {
  CostLine,
  Item,
  ReceiptLine,
} from "../../../shared/contracts";
import { round2, sumAmount } from "../../../shared/money";
import type {
  DeliveryEntry,
  FeeLossEntry,
  HarvestEntry,
  LedgerEntry,
  LedgerReport,
  LedgerTotals,
  OpeningEntry,
  PlantEntry,
  ProcessingEntry,
  SaleEntry,
  SpoilageEntry,
} from "../lib/contracts";

const zeroTotals = (): LedgerTotals => ({
  openingCash: 0,
  cashIn: 0,
  cashOut: 0,
  seedSpend: 0,
  feeSpend: 0,
  saleRevenue: 0,
  deliveryRevenue: 0,
  saleCogs: 0,
  deliveryCogs: 0,
  spoilageLoss: 0,
  feeLoss: 0,
  wipLoss: 0,
  unknownCost: 0,
});

function emptyState() {
  return {
    serial: 0,
    entries: [] as LedgerEntry[],
    totals: zeroTotals(),
    /** 库存成本桶：随入库/消耗/腐坏实时变动（内部保留精度） */
    inventoryCost: 0,
    /** 田间在长成本桶：播种计入，首轮收获转出 */
    growingCost: 0,
    /** 加工在制品桶：投料计入，产出/报废转出 */
    wipCost: 0,
  };
}

export interface BatchSnapshot {
  id: string;
  item: Item;
  quantity: number;
  unitCost: number;
  costUnknown?: boolean;
}
export interface GrowingSnapshot {
  plotId: number;
  cost: number;
}
export interface WipSnapshot {
  jobId: string;
  inputCost: number;
  fee: number;
}

export function createLedger() {
  const state = reactive(emptyState());
  const nextId = () => `e${++state.serial}`;
  const cash = () =>
    state.totals.openingCash + state.totals.cashIn - state.totals.cashOut;

  return {
    state: readonly(state),
    /** 现金（内部精度），展示层用 fmt 取整 */
    cash,

    /** 读档前清空当前台账，避免与新游戏期初重复累计 */
    reset() {
      Object.assign(state, emptyState());
    },

    /** 期初：新游戏或读档迁移。旧存档余额作为期初现金，旧货成本未知单列 */
    opening(
      hour: number,
      cashValue: number,
      inventoryCost: number,
      unknownCost: number,
      memo: string,
    ): string {
      const entry: OpeningEntry = {
        id: nextId(),
        type: "opening",
        hour,
        cash: cashValue,
        inventoryCost,
        unknownCost,
        memo,
      };
      state.entries.push(entry);
      state.totals.openingCash += cashValue;
      state.inventoryCost += inventoryCost;
      state.totals.unknownCost += unknownCost;
      return entry.id;
    },

    /** 播种：现金流出，成本进入田间在长成本，等待首轮收获吸收 */
    plant(
      hour: number,
      plotId: number,
      item: Item,
      seedCost: number,
    ): string {
      const entry: PlantEntry = {
        id: nextId(),
        type: "plant",
        hour,
        plotId,
        item,
        seedCost,
        cashDelta: -seedCost,
        memo: `田块${plotId + 1} 播种 · 种子支出 ¥${round2(seedCost)}`,
      };
      state.entries.push(entry);
      state.totals.cashOut += seedCost;
      state.totals.seedSpend += seedCost;
      state.growingCost += seedCost;
      return entry.id;
    },

    /** 收获：在长成本按轮次转入库存。首轮承担全部播种成本，后续轮仅新增投入 */
    harvest(args: {
      hour: number;
      plotId: number;
      plantingId: string;
      item: Item;
      round: number;
      quantity: number;
      quality: number;
      batchId: string;
      costs: readonly CostLine[];
      unknown?: boolean;
    }): string {
      const cost = sumAmount(args.costs.map((c) => c.amount));
      const entry: HarvestEntry = {
        id: nextId(),
        type: "harvest",
        hour: args.hour,
        plotId: args.plotId,
        plantingId: args.plantingId,
        item: args.item,
        round: args.round,
        quantity: args.quantity,
        quality: args.quality,
        batchId: args.batchId,
        cost,
        costs: args.costs,
        unknown: args.unknown,
        memo: `田块${args.plotId + 1} 第${args.round}轮收获 ${args.item} ×${args.quantity}（成本 ¥${round2(cost)}）`,
      };
      state.entries.push(entry);
      // 首轮吸收全部在长成本；后续轮新增投入为 0，不再占用在长桶
      if (args.round === 1) state.growingCost -= cost;
      state.inventoryCost += cost;
      if (args.unknown) state.totals.unknownCost += cost;
      return entry.id;
    },

    /** 加工投料（任务完成时）：原料成本从库存转入在制品 */
    processingConsume(entryId: string, lines: readonly ReceiptLine[]) {
      const entry = state.entries.find(
        (e) => e.id === entryId && e.type === "processing",
      ) as ProcessingEntry | undefined;
      if (!entry) return;
      const inputCost = sumAmount(lines.map((l) => l.cost));
      entry.inputLines = lines;
      entry.inputCost = inputCost;
      entry.unknown = lines.some((l) => l.unknown);
      state.inventoryCost -= inputCost;
      state.wipCost += inputCost;
    },

    /** 加工产出领取：在制品 + 加工费转为成品库存，混合产出按数量分摊 */
    processingClaim(
      entryId: string,
      outputs: readonly {
        batch: string;
        quantity: number;
        cost: number;
      }[],
    ) {
      const entry = state.entries.find(
        (e) => e.id === entryId && e.type === "processing",
      ) as ProcessingEntry | undefined;
      if (!entry) return;
      entry.outputs = outputs;
      entry.outputBatchId = outputs[0]?.batch;
      const total = sumAmount(outputs.map((o) => o.cost));
      state.wipCost -= entry.inputCost;
      state.inventoryCost += total;
    },

    /** 加工失败：ready 后变质，在制品成本与加工费转损失 */
    processingFail(entryId: string, at: "queued" | "ready") {
      const entry = state.entries.find(
        (e) => e.id === entryId && e.type === "processing",
      ) as ProcessingEntry | undefined;
      if (!entry) return;
      entry.failedAt = at;
      if (at === "ready") {
        // 已投料：在制品报废，加工费损失
        entry.lostInputCost = entry.inputCost;
        entry.lostFee = entry.fee;
        state.wipCost -= entry.inputCost;
        state.totals.wipLoss += entry.inputCost;
        state.totals.feeLoss += entry.fee;
      }
      // queued 阶段失败：原料由库存腐坏流水处理，加工费由 fee-loss 流水处理
    },

    /** 登记一笔加工（入队即付加工费，现金流出），返回流水 id */
    processingEnqueue(args: {
      hour: number;
      jobId: string;
      recipe: string;
      output: Item;
      outputQuantity: number;
      fee: number;
      batchIds: readonly string[];
    }): string {
      const entry: ProcessingEntry = {
        id: nextId(),
        type: "processing",
        hour: args.hour,
        jobId: args.jobId,
        recipe: args.recipe,
        output: args.output,
        outputQuantity: args.outputQuantity,
        fee: args.fee,
        inputCost: 0,
        inputLines: [],
        batchIds: args.batchIds,
        memo: `加工任务 ${args.jobId} · 加工费 ¥${round2(args.fee)}`,
      };
      state.entries.push(entry);
      state.totals.cashOut += args.fee;
      state.totals.feeSpend += args.fee;
      return entry.id;
    },

    /** 加工费损失（queued 阶段失败，加工费无法收回） */
    feeLoss(hour: number, jobId: string, fee: number): string {
      const entry: FeeLossEntry = {
        id: nextId(),
        type: "fee-loss",
        hour,
        jobId,
        fee,
        memo: `加工任务 ${jobId} 失败 · 加工费损失 ¥${round2(fee)}`,
      };
      state.entries.push(entry);
      state.totals.feeLoss += fee;
      return entry.id;
    },

    /** 现货出售：收入入账，按真实消耗份额结转成本 */
    sale(args: {
      hour: number;
      item: Item;
      quantity: number;
      revenue: number;
      costs: readonly CostLine[];
      unitCost: number;
      batchIds: readonly string[];
      unknown?: boolean;
    }): string {
      const cost = sumAmount(args.costs.map((c) => c.amount));
      const entry: SaleEntry = {
        id: nextId(),
        type: "sale",
        hour: args.hour,
        item: args.item,
        quantity: args.quantity,
        revenue: args.revenue,
        cost,
        unitCost: args.unitCost,
        costs: args.costs,
        batchIds: args.batchIds,
        unknown: args.unknown,
        memo: `出售 ${args.item} ×${args.quantity} · 收入 ¥${round2(args.revenue)} · 成本 ¥${round2(cost)}`,
      };
      state.entries.push(entry);
      state.totals.cashIn += args.revenue;
      state.totals.saleRevenue += args.revenue;
      state.totals.saleCogs += cost;
      state.inventoryCost -= cost;
      return entry.id;
    },

    /** 订单交付：收入入账，按真实消耗份额结转成本，关联合同 */
    delivery(args: {
      hour: number;
      orderId: string;
      item: Item;
      quantity: number;
      revenue: number;
      lines: readonly ReceiptLine[];
    }): string {
      const cost = sumAmount(args.lines.map((l) => l.cost));
      const entry: DeliveryEntry = {
        id: nextId(),
        type: "delivery",
        hour: args.hour,
        orderId: args.orderId,
        item: args.item,
        quantity: args.quantity,
        revenue: args.revenue,
        cost,
        lines: args.lines,
        batchIds: args.lines.map((l) => l.batch),
        unknown: args.lines.some((l) => l.unknown),
        memo: `交付订单 ${args.orderId} · 收入 ¥${round2(args.revenue)} · 成本 ¥${round2(cost)}`,
      };
      state.entries.push(entry);
      state.totals.cashIn += args.revenue;
      state.totals.deliveryRevenue += args.revenue;
      state.totals.deliveryCogs += cost;
      state.inventoryCost -= cost;
      return entry.id;
    },

    /** 库存腐坏：对应批次剩余成本转损失 */
    spoilage(args: {
      hour: number;
      item: Item;
      quantity: number;
      costs: readonly CostLine[];
      batchIds: readonly string[];
      jobId?: string;
      unknown?: boolean;
    }): string {
      const cost = sumAmount(args.costs.map((c) => c.amount));
      const entry: SpoilageEntry = {
        id: nextId(),
        type: "spoilage",
        hour: args.hour,
        item: args.item,
        quantity: args.quantity,
        cost,
        costs: args.costs,
        batchIds: args.batchIds,
        jobId: args.jobId,
        unknown: args.unknown,
        memo: `${args.item} ×${args.quantity} 腐坏报废 · 损失 ¥${round2(cost)}`,
      };
      state.entries.push(entry);
      state.totals.spoilageLoss += cost;
      state.inventoryCost -= cost;
      return entry.id;
    },

    /** 经营账核对：现金、库存成本、在长、在制品、已实现利润彼此印证（输出取整） */
    report(
      batches: readonly BatchSnapshot[],
      growing: readonly GrowingSnapshot[],
      wips: readonly WipSnapshot[],
      coins: number,
    ): LedgerReport {
      const t = state.totals;
      const realizedProfit =
        t.saleRevenue +
        t.deliveryRevenue -
        t.saleCogs -
        t.deliveryCogs;
      const totalLoss = t.spoilageLoss + t.feeLoss + t.wipLoss;
      // 独立从实物重算，验证台账桶未漂移
      const physicalInventory = sumAmount(
        batches.map((b) => b.unitCost * b.quantity),
      );
      const physicalGrowing = sumAmount(growing.map((g) => g.cost));
      const physicalWip = sumAmount(wips.map((w) => w.inputCost));
      const ledgerCash = cash();
      const check = (label: string, a: number, b: number) => ({
        label,
        ok: Math.abs(a - b) < 0.001,
        detail: `账 ¥${round2(a)} / 实 ¥${round2(b)}`,
      });
      // 资产 = 期初权益(期初现金) + 已实现利润 - 损耗
      const assets =
        state.inventoryCost + state.growingCost + state.wipCost + cash();
      const equity = t.openingCash + realizedProfit - totalLoss;
      const roundedTotals: LedgerTotals = {
        ...t,
        openingCash: round2(t.openingCash),
        cashIn: round2(t.cashIn),
        cashOut: round2(t.cashOut),
        seedSpend: round2(t.seedSpend),
        feeSpend: round2(t.feeSpend),
        saleRevenue: round2(t.saleRevenue),
        deliveryRevenue: round2(t.deliveryRevenue),
        saleCogs: round2(t.saleCogs),
        deliveryCogs: round2(t.deliveryCogs),
        spoilageLoss: round2(t.spoilageLoss),
        feeLoss: round2(t.feeLoss),
        wipLoss: round2(t.wipLoss),
        unknownCost: round2(t.unknownCost),
      };
      return {
        cash: round2(ledgerCash),
        inventoryCost: round2(state.inventoryCost),
        growingCost: round2(state.growingCost),
        wipCost: round2(state.wipCost),
        realizedProfit: round2(realizedProfit),
        totalLoss: round2(totalLoss),
        totals: roundedTotals,
        checks: [
          check("现金与钱包一致", ledgerCash, coins),
          check(
            "库存成本与批次重算一致",
            state.inventoryCost,
            physicalInventory,
          ),
          check(
            "田间在长成本与作物重算一致",
            state.growingCost,
            physicalGrowing,
          ),
          check(
            "加工在制品与任务重算一致",
            state.wipCost,
            physicalWip,
          ),
          check("资产恒等式（资产=期初权益+利润-损耗）", assets, equity),
        ],
      };
    },

    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, JSON.parse(JSON.stringify(data)));
    },
  };
}
