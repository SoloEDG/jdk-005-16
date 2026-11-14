import type {
  Batch,
  CostLine,
  ReceiptLine,
} from "../../../shared/contracts";
import { sumAmount } from "../../../shared/money";

/**
 * 按真实消耗份额，从一个批次的成本组件链中切出 takeQty 对应的成本。
 * 保留每条来源（田块/输入批次/加工费/合同）的可追溯信息，仅按比例缩小金额与数量。
 * 内部保留精度，不逐笔取整，保证多次部分结转后总成本精确闭合。
 */
export function splitCosts(
  batch: Readonly<Batch>,
  takeQty: number,
): CostLine[] {
  if (takeQty <= 0 || batch.quantity <= 0) return [];
  const ratio = takeQty / batch.quantity;
  return batch.costs.map((c) => ({
    ...c,
    quantity:
      c.quantity !== undefined ? c.quantity * ratio : undefined,
    amount: c.amount * ratio,
    // 单位成本保持不变，便于追溯原始单价
  }));
}

/** 把若干成本组件按 label/ref 合并，避免链条无限膨胀，同时保留来源明细 */
export function mergeCosts(lines: readonly CostLine[]): CostLine[] {
  const map = new Map<string, CostLine>();
  for (const line of lines) {
    const key = `${line.kind}:${line.ref ?? ""}:${line.label}`;
    const exist = map.get(key);
    if (!exist) {
      map.set(key, { ...line });
      continue;
    }
    exist.amount += line.amount;
    exist.quantity =
      exist.quantity !== undefined && line.quantity !== undefined
        ? exist.quantity + line.quantity
        : exist.quantity;
    exist.unknown = exist.unknown || line.unknown;
  }
  return [...map.values()];
}

/** 构造一次消耗的 receipt 明细行（携带按份额结转的成本） */
export function receiptLine(
  batch: Readonly<Batch>,
  takeQty: number,
): ReceiptLine {
  const costs = splitCosts(batch, takeQty);
  return {
    batch: batch.id,
    item: batch.item,
    quantity: takeQty,
    quality: batch.quality,
    source: batch.source,
    costs,
    cost: sumAmount(costs.map((c) => c.amount)),
    unknown: !!batch.costUnknown,
  };
}

/**
 * 混合产出分摊：把（投入成本 + 加工费）按各产出的实际数量比例分摊。
 * 单一产出时全部归该产出；尾差并入最后一个产出，保证总成本精确闭合。
 */
export function allocateOutputs(
  totalCost: number,
  outputs: { batch: string; quantity: number }[],
): { batch: string; quantity: number; cost: number }[] {
  const totalQty = outputs.reduce((n, o) => n + o.quantity, 0);
  if (totalQty <= 0) return outputs.map((o) => ({ ...o, cost: 0 }));
  let allocated = 0;
  return outputs.map((o, i) => {
    const isLast = i === outputs.length - 1;
    const cost = isLast
      ? totalCost - allocated
      : (totalCost * o.quantity) / totalQty;
    allocated += cost;
    return { ...o, cost };
  });
}

/** 为产出批次构造成本组件链：沿用被消耗批次成本（按来源合并）+ 加工费 */
export function outputCosts(
  inputLines: readonly ReceiptLine[],
  fee: number,
  jobId: string,
  outQty: number,
  totalCost: number,
  allocatedCost: number,
): CostLine[] {
  // 仅当前产出分摊到的比例，用于缩放各输入来源与加工费金额
  const ratio = totalCost > 0 ? allocatedCost / totalCost : 0;
  const inherited: CostLine[] = inputLines.flatMap((l) =>
    l.costs.map((c) => ({
      ...c,
      amount: c.amount * ratio,
      quantity:
        c.quantity !== undefined ? c.quantity * ratio : undefined,
    })),
  );
  const feeLine: CostLine = {
    kind: "fee",
    ref: jobId,
    label: `加工费 ${jobId}`,
    quantity: outQty,
    unitCost: 0,
    amount: fee * ratio,
  };
  return mergeCosts([...inherited, feeLine]);
}

/** 未知成本组件（旧存档迁移批次），金额按 0 计并明确标注 */
export function unknownCostLine(label: string, quantity: number): CostLine {
  return {
    kind: "unknown",
    label,
    quantity,
    unitCost: 0,
    amount: 0,
    unknown: true,
  };
}
