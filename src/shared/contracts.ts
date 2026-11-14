export type Item = "carrot" | "corn" | "berry" | "jam" | "flour";
export type Weather = "sun" | "rain" | "wind";

/** 一条成本来源：可指向田块、输入批次、加工任务或合同 */
export interface CostLine {
  /** 来源种类：田间播种 / 输入批次 / 加工费 / 期初未知 */
  kind: "plant" | "batch" | "fee" | "unknown";
  /** 引用对象 id，如 p3（田块）/ b7（批次）/ j2（任务） */
  ref?: string;
  /** 可展示的来源名称 */
  label: string;
  /** 该来源被吸收的数量（田间成本按整轮、批次按实际消耗量） */
  quantity?: number;
  /** 单位成本（fee 时为 0，金额直接放 amount） */
  unitCost: number;
  /** 该来源贡献的成本金额 */
  amount: number;
  /** 来源成本本身未知（旧存档迁移），金额按 0 计并单独标注 */
  unknown?: boolean;
}

export interface Crop {  item: Item;
  planted: number;
  growth: number;
  water: number;
  stress: number;
  harvests: number;
  /** 播种流水 id，用于全程追溯到田块与该轮播种 */
  plantingId?: string;
  /** 本轮播种成本（首轮收获前为在长成本，收获后被吸收清零） */
  seedCost?: number;
}
export interface Plot {
  id: number;
  crop: Crop | null;
}
export interface ReceiptLine {
  batch: string;
  item: Item;
  quantity: number;
  quality: number;
  /** 该被消耗批次的来源说明（保留兼容旧用法） */
  source: string;
  /** 该次实际结转的成本组件（按真实消耗份额切分） */
  costs: readonly CostLine[];
  /** 该次消耗的成本金额 */
  cost: number;
  /** 是否含成本未知部分（旧批次） */
  unknown: boolean;
}
export interface Receipt {
  quality: number;
  sources: readonly string[];
  quantity: number;
  /** 按真实消耗批次列出的明细，成本可逐批追溯 */
  lines: readonly ReceiptLine[];
  /** 整笔结转总成本 */
  cost: number;
  /** 是否含成本未知部分 */
  unknown: boolean;
}
export interface Batch {
  id: string;
  item: Item;
  quantity: number;
  quality: number;
  source: string;
  expires: number;
  /** 单位成本（含全部成本组件后按数量摊得） */
  unitCost: number;
  /** 成本组件链，逐份可追溯到田块/输入批次/加工任务/合同 */
  costs: readonly CostLine[];
  /** 成本中含未知来源（旧存档批次），金额按 0 计 */
  costUnknown?: boolean;
  /** 产出该批次的加工任务（若来自工坊） */
  jobId?: string;
  /** 产出该批次的田块（若来自田间收获） */
  plotId?: number;
  /** 关联播种流水（田间收获） */
  plantingId?: string;
}
export interface Allocation {
  batch: string;
  quantity: number;
}
export interface Reservation {
  id: string;
  owner: string;
  allocations: Allocation[];
}
export interface Job {
  id: string;
  recipe: string;
  reservation: string;
  receipt?: Receipt;
  finish: number;
  status: "queued" | "ready" | "claimed" | "failed";
  /** 对应加工流水 id */
  entryId?: string;
  /** 已支付的加工费 */
  fee?: number;
}
export interface Order {
  id: string;
  item: Item;
  quantity: number;
  reward: number;
  minQuality: number;
  deadline: number;
  status: "open" | "reserved" | "delivered" | "expired";
  reservation?: string;
}
export interface Tick {
  from: number;
  to: number;
  weather: Weather;
}
export type Notice = (message: string) => void;
