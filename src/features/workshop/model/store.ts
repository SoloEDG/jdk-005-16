import { reactive, readonly } from "vue";
import type {
  Job,
  Item,
  Notice,
  Receipt,
  CostLine,
} from "../../../shared/contracts";
import { recipeById } from "../lib/recipes";
import { items } from "../../../shared/catalog";
import { queueFinish } from "../lib/schedule";
import {
  allocateOutputs,
  outputCosts,
} from "../../ledger/lib/costing";

interface Ports {
  reserve: (owner: string, item: Item, n: number) => string | null;
  consume: (id: string) => Receipt | null;
  release: (id: string) => void;
  reservationBatches: (
    id: string,
  ) => { batch: string; quantity: number }[];
  add: (
    item: Item,
    n: number,
    q?: number,
    hour?: number,
    source?: string,
    costs?: CostLine[],
    extra?: { jobId?: string },
  ) => string;
  spend: (n: number) => boolean;
}

interface LedgerPorts {
  enqueue: (args: {
    hour: number;
    jobId: string;
    recipe: string;
    output: Item;
    outputQuantity: number;
    fee: number;
    batchIds: string[];
  }) => string;
  consume: (entryId: string, lines: Receipt["lines"]) => void;
  claim: (
    entryId: string,
    outputs: readonly { batch: string; quantity: number; cost: number }[],
  ) => void;
  fail: (entryId: string, at: "queued" | "ready") => void;
  feeLoss: (hour: number, jobId: string, fee: number) => void;
}

export function createWorkshop(
  ports: Ports,
  ledger: LedgerPorts,
  notice: Notice,
) {
  const state = reactive({ jobs: [] as Job[], serial: 0 });
  return {
    state: readonly(state),
    enqueue(recipe: string, hour: number) {
      const r = recipeById(recipe);
      if (!r || state.jobs.filter((j) => j.status === "queued").length >= 4) {
        notice("加工队列已满");
        return;
      }
      const reservation = ports.reserve("workshop", r.input, r.amount);
      if (!reservation) {
        notice("加工原料不足");
        return;
      }
      if (!ports.spend(r.cost)) {
        ports.release(reservation);
        notice("加工费不足");
        return;
      }
      const id = `j${++state.serial}`;
      const batchIds = ports.reservationBatches(reservation).map(
        (x) => x.batch,
      );
      // 加工费在入队时即现金流出，登记加工流水（此时在制品尚未投料）
      const entryId = ledger.enqueue({
        hour,
        jobId: id,
        recipe: r.id,
        output: r.output,
        outputQuantity: r.quantity,
        fee: r.cost,
        batchIds,
      });
      state.jobs.push({
        id,
        recipe,
        reservation,
        finish: queueFinish(state.jobs, hour, r.duration),
        status: "queued",
        entryId,
        fee: r.cost,
      });
      notice("原料已锁定，加入加工队列");
    },
    tick(hour: number) {
      for (const job of state.jobs)
        if (job.status === "queued" && job.finish <= hour) {
          const receipt = ports.consume(job.reservation);
          if (!receipt) {
            // queued 阶段失败：原料腐坏由仓库流水处理，加工费单独记损失
            job.status = "failed";
            if (job.entryId) ledger.fail(job.entryId, "queued");
            if (job.fee) ledger.feeLoss(hour, job.id, job.fee);
            notice("原料已过期，本批加工终止");
            continue;
          }
          // 投料：原料成本从库存转入在制品
          if (job.entryId) ledger.consume(job.entryId, receipt.lines);
          job.receipt = receipt;
          job.status = "ready";
        }
    },
    claim(id: string, hour: number) {
      const job = state.jobs.find((j) => j.id === id),
        r = job && recipeById(job.recipe);
      if (!job || job.status !== "ready" || !r) return;
      if (!job.receipt || !job.entryId) return;
      if (job.finish + items[r.output].life <= hour) {
        // ready 后变质：在制品（含原料成本+加工费）报废
        job.status = "failed";
        ledger.fail(job.entryId, "ready");
        notice("成品存放过久，已变质");
        return;
      }
      // 总成本 = 被消耗批次成本（沿用来源批次）+ 加工费；混合产出按实际数量分摊（内部保留精度）
      const inputCost = job.receipt.cost;
      const totalCost = inputCost + (job.fee ?? 0);
      const plan = [{ batch: "", quantity: r.quantity }];
      const allocated = allocateOutputs(totalCost, plan);
      const outputs: { batch: string; quantity: number; cost: number }[] = [];
      for (const part of allocated) {
        const costs = outputCosts(
          job.receipt.lines,
          job.fee ?? 0,
          job.id,
          part.quantity,
          totalCost,
          part.cost,
        );
        const batchId = ports.add(
          r.output,
          part.quantity,
          job.receipt.quality,
          job.finish,
          `工坊${job.id} · ${job.receipt.sources.join(" / ")}`,
          costs,
          { jobId: job.id },
        );
        outputs.push({ batch: batchId, quantity: part.quantity, cost: part.cost });
      }
      ledger.claim(job.entryId, outputs);
      job.status = "claimed";
      notice("成品已入仓");
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, JSON.parse(JSON.stringify(data)));
    },
  };
}
