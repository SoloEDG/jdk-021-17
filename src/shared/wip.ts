import type { Game, Order, OrderLine, RecipeId } from "./types";
import { recipes } from "./catalog";
import { isLineOpen } from "./orderlines";
/**
 * 找到订单中尚未安排制作（散份/灶台/出餐台均无对应资源）的开放菜行。
 */
export function claimableLine(
  g: Game,
  orderId: number,
  recipe: RecipeId,
): OrderLine | undefined {
  const order = g.orders.find((o) => o.id === orderId);
  if (!order) return undefined;
  return order.lines.find((l) => {
    if (l.state !== "pending" || l.recipe !== recipe) return false;
    if (g.portions.some((p) => p.lineId === l.id)) return false;
    if (g.stoves.some((s) => s.portion?.lineId === l.id)) return false;
    if (g.dishes.some((d) => d.lineId === l.id)) return false;
    return true;
  });
}
/**
 * 以真实资源（备料台 / 灶台 / 出餐台）为准，重算每道开放菜行的制作状态。
 * 终态（served/cancelled）永不回退，避免用“重新开始”掩盖已发生的工作。
 */
export function syncLineStates(g: Game) {
  for (const o of g.orders) {
    for (const l of o.lines) {
      if (!isLineOpen(l)) continue;
      if (g.dishes.some((d) => d.lineId === l.id)) {
        l.state = "ready";
      } else if (g.stoves.some((s) => s.portion?.lineId === l.id)) {
        l.state = "cooking";
      } else if (g.portions.some((p) => p.lineId === l.id)) {
        l.state = "prepping";
      } else {
        l.state = "pending";
      }
    }
  }
}
/** 释放某菜行占用的所有制作资源，并按规则退回食材或登记作废损耗。 */
export function releaseLineResources(
  g: Game,
  o: Order,
  l: OrderLine,
  wasteLabel: string,
) {
  // 灶台上的份额：先退回备料台再统一处理，保证不丢份额
  for (const s of g.stoves) {
    if (s.portion?.lineId === l.id) {
      const p = s.portion;
      s.portion = null;
      g.portions.push({ ...p });
    }
  }
  // 备料台份额（含刚从灶台退回的）：作废并把食材退回库存，做库存守恒
  const loose = g.portions.filter((p) => p.lineId === l.id);
  for (const p of loose) {
    g.stock[recipes[p.recipe].ingredient]++;
  }
  g.portions = g.portions.filter((p) => p.lineId !== l.id);
  // 已起锅的成品：无法回炉，按作废损耗登记
  const ready = g.dishes.filter((d) => d.lineId === l.id);
  for (const d of ready) {
    g.entries.push({
      id: g.nextId++,
      time: g.time,
      label: `${wasteLabel} · ${recipes[d.recipe].name}`,
      amount: -3,
      kind: "waste",
    });
  }
  g.dishes = g.dishes.filter((d) => d.lineId !== l.id);
  if (g.selectedDish && ready.some((d) => d.id === g.selectedDish)) {
    g.selectedDish = null;
  }
}
/** 断开关联（菜行换菜但资源保留为散份时使用） */
export function detachLineResources(g: Game, lineId: number) {
  for (const p of g.portions) {
    if (p.lineId === lineId) {
      p.lineId = null;
      p.orderId = null;
    }
  }
  for (const s of g.stoves) {
    if (s.portion?.lineId === lineId) {
      s.portion = { ...s.portion, lineId: null, orderId: null };
    }
  }
  for (const d of g.dishes) {
    if (d.lineId === lineId) {
      d.lineId = null;
      d.orderId = null;
    }
  }
}
/** 库存 + 在制资源守恒检查所需的食材折算 */
export function ingredientTotal(g: Game) {
  const total: Record<string, number> = {
    beef: g.stock.beef,
    noodle: g.stock.noodle,
    greens: g.stock.greens,
  };
  const count = (recipe: RecipeId) => {
    total[recipes[recipe].ingredient]++;
  };
  g.portions.forEach((p) => count(p.recipe));
  g.stoves.forEach((s) => s.portion && count(s.portion.recipe));
  g.dishes.forEach((d) => count(d.recipe));
  return total as Record<import("./types").Ingredient, number>;
}
