import type { Batch, CostLine, Item } from "../../../shared/contracts";
import { items } from "../../../shared/catalog";
import { sumAmount } from "../../../shared/money";

export function makeBatch(
  item: Item,
  quantity: number,
  quality: number,
  hour: number,
  id: string,
  source = "收获",
  costs: readonly CostLine[] = [],
  extra: Partial<Batch> = {},
): Batch {
  const totalCost = sumAmount(costs.map((c) => c.amount));
  return {
    id,
    item,
    quantity,
    quality,
    source,
    expires: hour + items[item].life,
    // 单位成本内部保留精度，仅在展示层取整，保证单价×数量与总成本闭合
    unitCost: quantity > 0 ? totalCost / quantity : 0,
    costs,
    costUnknown: costs.some((c) => c.unknown) || undefined,
    ...extra,
  };
}
export function summarize(batches: readonly Readonly<Batch>[]) {
  return batches.reduce((n, b) => n + b.quantity, 0);
}
