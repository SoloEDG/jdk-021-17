import type { Game } from "../../../shared/types";
export function totals(g: Game) {
  const sum = (kind: string) =>
    g.entries
      .filter((e) => e.kind === kind)
      .reduce((s, e) => s + e.amount, 0);
  const sales = sum("sale");
  const tips = sum("tip");
  const refunds = sum("refund"); // 负数
  const waste = sum("waste"); // 负数
  const miss = sum("miss"); // 负数
  const supply = sum("supply"); // 负数
  return {
    sales,
    tips,
    refunds,
    waste,
    miss,
    supply,
    /** 营业收入（含小费，扣除退款） */
    revenue: sales + tips + refunds,
    /** 成本与损失（采购、作废、超时） */
    cost: -(waste + miss + supply),
    net: g.entries.reduce((s, e) => s + e.amount, 0),
  };
}
export function grade(g: Game) {
  const n = totals(g).net;
  return n >= 400 ? "S" : n >= 250 ? "A" : n >= 120 ? "B" : "C";
}
