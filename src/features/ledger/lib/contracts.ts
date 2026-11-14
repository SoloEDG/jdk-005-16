import type { CostLine, Item, ReceiptLine } from "../../../shared/contracts";

/** 流水类型：覆盖播种、收获、加工、出售、交付、腐坏、费用损失、期初 */
export type EntryType =
  | "opening"
  | "plant"
  | "harvest"
  | "processing"
  | "sale"
  | "delivery"
  | "spoilage"
  | "fee-loss";

interface BaseEntry {
  id: string;
  type: EntryType;
  hour: number;
  /** 关联田块 */
  plotId?: number;
  /** 关联输入批次（加工/出售/交付/腐坏按实际消耗） */
  batchIds?: readonly string[];
  /** 关联加工任务 */
  jobId?: string;
  /** 关联合同（订单） */
  orderId?: string;
  /** 关联播种流水 */
  plantingId?: string;
  memo: string;
}

/** 期初余额（读档/新游戏） */
export interface OpeningEntry extends BaseEntry {
  type: "opening";
  cash: number;
  inventoryCost: number;
  unknownCost: number;
}

/** 播种：现金流出，成本进入田间在长成本，待首轮收获吸收 */
export interface PlantEntry extends BaseEntry {
  type: "plant";
  item: Item;
  seedCost: number;
  cashDelta: number;
}

/** 收获：在长成本转入库存；可重复采收仅首轮承担播种成本，后续轮新增投入为 0 */
export interface HarvestEntry extends BaseEntry {
  type: "harvest";
  item: Item;
  round: number;
  quantity: number;
  quality: number;
  batchId: string;
  /** 本轮吸收的成本（首轮=播种成本，后续轮=新增投入，通常为 0） */
  cost: number;
  costs: readonly CostLine[];
  unknown?: boolean;
}

/** 加工：加工费现金流出 + 被消耗批次成本，混合产出按实际数量分摊 */
export interface ProcessingEntry extends BaseEntry {
  type: "processing";
  recipe: string;
  output: Item;
  outputQuantity: number;
  fee: number;
  inputCost: number;
  inputLines: readonly ReceiptLine[];
  /** 产出批次 id（领取后回填） */
  outputBatchId?: string;
  outputs?: readonly { batch: string; quantity: number; cost: number }[];
  /** 加工在哪个环节终止：queued 失败（原料腐坏）/ ready 后变质 */
  failedAt?: "queued" | "ready";
  /** 终止时损失的在制品成本与加工费 */
  lostInputCost?: number;
  lostFee?: number;
  unknown?: boolean;
}

/** 现货出售：按真实消耗份额结转成本 */
export interface SaleEntry extends BaseEntry {
  type: "sale";
  item: Item;
  quantity: number;
  revenue: number;
  cost: number;
  unitCost: number;
  costs: readonly CostLine[];
  unknown?: boolean;
}

/** 订单交付：按真实消耗份额结转成本 */
export interface DeliveryEntry extends BaseEntry {
  type: "delivery";
  item: Item;
  quantity: number;
  revenue: number;
  cost: number;
  lines: readonly ReceiptLine[];
  unknown?: boolean;
}

/** 库存腐坏：对应批次剩余成本转为损失 */
export interface SpoilageEntry extends BaseEntry {
  type: "spoilage";
  item: Item;
  quantity: number;
  cost: number;
  costs: readonly CostLine[];
  unknown?: boolean;
}

/** 加工费损失（任务失败且原料未被消耗时，已付加工费无法收回） */
export interface FeeLossEntry extends BaseEntry {
  type: "fee-loss";
  fee: number;
}

export type LedgerEntry =
  | OpeningEntry
  | PlantEntry
  | HarvestEntry
  | ProcessingEntry
  | SaleEntry
  | DeliveryEntry
  | SpoilageEntry
  | FeeLossEntry;

/** 台账累计桶：随每条流水实时维护，绝不靠打开面板重算 */
export interface LedgerTotals {
  /** 期初现金（读档余额作为期初） */
  openingCash: number;
  /** 现金流入合计 */
  cashIn: number;
  /** 现金流出合计 */
  cashOut: number;
  /** 累计播种支出 */
  seedSpend: number;
  /** 累计加工费支出 */
  feeSpend: number;
  /** 累计销售收入 */
  saleRevenue: number;
  /** 累计交付收入 */
  deliveryRevenue: number;
  /** 累计结转销售成本（出售） */
  saleCogs: number;
  /** 累计结转交付成本 */
  deliveryCogs: number;
  /** 累计腐坏损失（成本口径） */
  spoilageLoss: number;
  /** 累计加工费损失 */
  feeLoss: number;
  /** 累计加工在制品报废损失 */
  wipLoss: number;
  /** 成本未知部分的金额（始终为 0 计值，单独披露数量影响） */
  unknownCost: number;
}

/** 经营账核对视图 */
export interface LedgerReport {
  cash: number;
  inventoryCost: number;
  /** 田间在长成本（已播种未收获吸收） */
  growingCost: number;
  /** 加工在制品成本（已投料未产出） */
  wipCost: number;
  realizedProfit: number;
  totalLoss: number;
  totals: LedgerTotals;
  /** 恒等式核对结果 */
  checks: { label: string; ok: boolean; detail: string }[];
}
