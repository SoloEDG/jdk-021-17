import type { Game, RecipeId, Ingredient } from "../../../shared/types";
import { recipes, ingredients } from "../../../shared/catalog";
import { preparationIssue } from "../lib/availability";
import { claimableLine, syncLineStates } from "../../../shared/wip";
/**
 * 备料：优先分配给当前选中订单的待做菜行，其次任意已接订单的匹配菜行，
 * 都没有则成为散份（旧行为保留）。两份同菜各占一个菜行，不会串份额。
 */
export function prepare(g: Game, r: RecipeId) {
  const issue = preparationIssue(g, r);
  if (issue) {
    g.notice = issue;
    return;
  }
  let orderId: number | null = null;
  let lineId: number | null = null;
  const selected = g.orders.find((o) => o.id === g.selectedOrder);
  if (selected) {
    const l = claimableLine(g, selected.id, r);
    if (l) {
      orderId = selected.id;
      lineId = l.id;
    }
  }
  if (lineId === null) {
    for (const o of g.orders.filter((o) => o.status === "accepted")) {
      const l = claimableLine(g, o.id, r);
      if (l) {
        orderId = o.id;
        lineId = l.id;
        break;
      }
    }
  }
  g.stock[recipes[r].ingredient]--;
  g.portions.push({
    id: g.nextId++,
    recipe: r,
    preparedAt: g.time,
    orderId,
    lineId,
  });
  syncLineStates(g);
  g.notice = lineId
    ? `${recipes[r].name} 备料完成并分配到 #${String(orderId).padStart(3, "0")} 订单`
    : `${recipes[r].name} 备料完成（散份），可送入灶台`;
}
export function restock(g: Game, i: Ingredient) {
  if (g.stock[i] >= 12) {
    g.notice = "库存充足，上限12份";
    return;
  }
  g.stock[i] = Math.min(12, g.stock[i] + 3);
  g.entries.push({
    id: g.nextId++,
    time: g.time,
    label: `采购${ingredients[i].name} ×3`,
    amount: -ingredients[i].cost * 3,
    kind: "supply",
  });
  g.notice = "已购入3份食材，费用计入账本";
}
