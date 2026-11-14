import { reactive, readonly } from "vue";
import type {
  Item,
  Batch,
  Reservation,
  Notice,
  Receipt,
  CostLine,
} from "../../../shared/contracts";
import { allocate, available } from "../lib/allocation";
import { makeBatch } from "../lib/storage";
import { receiptLine, splitCosts, unknownCostLine } from "../../ledger/lib/costing";
import { sumAmount } from "../../../shared/money";

interface SpoilageReport {
  item: Item;
  quantity: number;
  costs: readonly CostLine[];
  batchIds: readonly string[];
  jobId?: string;
  unknown: boolean;
}

export function createWarehouse(now: () => number, notice: Notice) {
  const state = reactive({
    batches: [] as Batch[],
    reservations: [] as Reservation[],
    serial: 0,
    wasted: 0,
  });
  /** 腐坏回调：由 workspace 接入台账，记录对应损失 */
  let onSpoil: ((report: SpoilageReport) => void) | null = null;

  const add = (
    item: Item,
    n: number,
    q = 1,
    hour = now(),
    source = "田间收获",
    costs: readonly CostLine[] = [],
    extra: Partial<Batch> = {},
  ) => {
    state.batches.push(
      makeBatch(item, n, q, hour, `b${++state.serial}`, source, [...costs], extra),
    );
    return state.batches[state.batches.length - 1]!.id;
  };

  /** 建仓初始批次（成本未知，供新游戏/迁移使用） */
  const addLegacy = (
    item: Item,
    n: number,
    q: number,
    label: string,
  ) => {
    add(item, n, q, now(), label, [unknownCostLine(label, n)]);
  };

  return {
    state: readonly(state),
    add,
    addLegacy,
    onSpoil: (fn: (report: SpoilageReport) => void) => {
      onSpoil = fn;
    },
    free: (id: string) => {
      const b = state.batches.find((b) => b.id === id);
      return b ? available(b, state.reservations) : 0;
    },
    reserve(owner: string, item: Item, n: number, minQuality = 1) {
      const allocations = allocate(
        state.batches,
        state.reservations,
        item,
        n,
        now(),
        minQuality,
      );
      if (!allocations) return null;
      const id = `r${++state.serial}`;
      state.reservations.push({ id, owner, allocations });
      return id;
    },
    /** 列出一笔占用对应的批次与数量（供加工登记来源） */
    reservationBatches(id: string) {
      const r = state.reservations.find((r) => r.id === id);
      if (!r) return [];
      return r.allocations.map((a) => ({
        batch: a.batch,
        quantity: a.quantity,
      }));
    },
    consume(id: string): Receipt | null {
      const r = state.reservations.find((r) => r.id === id);
      if (!r) return null;
      for (const a of r.allocations) {
        const b = state.batches.find((b) => b.id === a.batch);
        if (!b || b.quantity < a.quantity || b.expires <= now()) return null;
      }
      const lines = r.allocations.map((a) => {
        const b = state.batches.find((b) => b.id === a.batch)!;
        return receiptLine(b, a.quantity);
      });
      const receipt: Receipt = {
        quality: Math.min(...lines.map((l) => l.quality)),
        sources: lines.map((l) => l.source),
        quantity: lines.reduce((n, l) => n + l.quantity, 0),
        lines,
        cost: sumAmount(lines.map((l) => l.cost)),
        unknown: lines.some((l) => l.unknown),
      };
      for (const a of r.allocations)
        state.batches.find((b) => b.id === a.batch)!.quantity -= a.quantity;
      state.batches = state.batches.filter((b) => b.quantity > 0);
      state.reservations = state.reservations.filter((r) => r.id !== id);
      return receipt;
    },
    release: (id: string) => {
      state.reservations = state.reservations.filter((r) => r.id !== id);
    },
    /** 现货出售：按真实消耗份额返回成本，供台账结转 */
    sell(id: string, n: number) {
      const b = state.batches.find((b) => b.id === id);
      if (!b || available(b, state.reservations) < n) return null;
      const costs = splitCosts(b, n);
      const result = {
        item: b.item,
        quantity: n,
        unitCost: b.unitCost,
        costs,
        cost: sumAmount(costs.map((c) => c.amount)),
        unknown: !!b.costUnknown,
        batchId: b.id,
      };
      b.quantity -= n;
      if (!b.quantity) state.batches = state.batches.filter((b) => b.id !== id);
      return result;
    },
    /** 一批库存的总成本（内部精度，供期初/核对使用） */
    batchCost: (id: string) => {
      const b = state.batches.find((b) => b.id === id);
      return b ? b.unitCost * b.quantity : 0;
    },
    tick(hour: number) {
      const expired = state.batches.filter((b) => b.expires <= hour);
      state.wasted += expired.reduce((n, b) => n + b.quantity, 0);
      // 逐批上报腐坏损失（在制品原料由加工任务关联）
      for (const b of expired) {
        onSpoil?.({
          item: b.item,
          quantity: b.quantity,
          costs: b.costs.map((c) => ({ ...c })),
          batchIds: [b.id],
          jobId: b.jobId,
          unknown: !!b.costUnknown,
        });
      }
      state.batches = state.batches.filter((b) => b.expires > hour);
      state.reservations = state.reservations.filter(
        (r) =>
          !r.allocations.some((a) => expired.some((b) => b.id === a.batch)),
      );
      if (expired.length) notice(`${expired.length} 批库存已到保质期`);
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      const cloned = JSON.parse(JSON.stringify(data)) as typeof state;
      // v1 旧批次没有成本字段：规范化为“成本未知”，单位成本 0，避免重算出 NaN
      for (const b of cloned.batches) {
        if (b.unitCost === undefined || !Array.isArray(b.costs)) {
          b.unitCost = 0;
          b.costs = [unknownCostLine(b.source || "旧存档货物", b.quantity)];
          b.costUnknown = true;
        }
      }
      Object.assign(state, cloned);
    },
  };
}
