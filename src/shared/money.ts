/**
 * 内部核算全程保留浮点精度，避免逐笔取整累积尾差，
 * 导致“单价×数量重算”与流水成本桶无法闭合。取整只用于展示。
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
/** 展示用：保留两位小数的字符串 */
export function fmt(n: number): string {
  return round2(n).toFixed(2);
}
/** 合计一组金额（内部不取整，保持精度闭合） */
export function sumAmount(values: readonly number[]): number {
  return values.reduce((acc, n) => acc + n, 0);
}
