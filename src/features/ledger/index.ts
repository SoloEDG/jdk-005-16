import type { createLedger } from "./model/store";
import type { Batch, Plot } from "../../shared/contracts";

type Ledger = ReturnType<typeof createLedger>;

/** 从实物状态构造核对快照，验证台账各成本桶未漂移 */
export function buildReport(
  ledger: Ledger,
  batches: readonly Readonly<Batch>[],
  plots: readonly Readonly<Plot>[],
  wips: { jobId: string; inputCost: number; fee: number }[],
  coins: number,
) {
  return ledger.report(
    batches.map((b) => ({
      id: b.id,
      item: b.item,
      quantity: b.quantity,
      unitCost: b.unitCost,
      costUnknown: b.costUnknown,
    })),
    plots
      .filter((p) => p.crop)
      .map((p) => ({
        // 田间在长成本实物侧：首轮收获前等于播种成本，收获吸收后归零
        plotId: p.id,
        cost: p.crop?.seedCost ?? 0,
      })),
    wips,
    coins,
  );
}

export { createLedger } from "./model/store";
export { default as LedgerPanel } from "./ui/LedgerPanel.vue";

