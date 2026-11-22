import type { Game, Order, OrderLine } from "../../../shared/types";
import { recipes } from "../../../shared/catalog";
import { servingQuality, servicePair } from "../lib/freshness";
import { findLine, isLineOpen, openLines } from "../../../shared/orderlines";
import { syncLineStates } from "../../../shared/wip";
import { CREDIT_RATE } from "../../orders/lib/swap";
function penalty(g: Game, order: Order, seconds: number, msg: string) {
  order.deadline = Math.max(g.time, order.deadline - seconds);
  g.combo = 0;
  g.notice = msg;
}
/**
 * 选择本道菜应交付的菜行：
 * 1. 显式指定的 lineId（严格匹配，错配返回 undefined 触发耐心惩罚）；
 * 2. 菜品自带关联的菜行（含换菜抵价行，按原菜谱交付）；
 * 3. 同菜谱第一个开放菜行兜底。
 * 换菜后的新要求绝不匹配旧成品：菜谱不同即视为错配，菜品留在出餐台。
 */
function pickLine(
  g: Game,
  order: Order,
  dishRecipe: OrderLine["recipe"],
  explicitLine?: number,
): OrderLine | undefined {
  if (explicitLine !== undefined) {
    const l = findLine(order, explicitLine);
    if (l && isLineOpen(l) && l.recipe === dishRecipe) return l;
    return undefined;
  }
  const dish = g.dishes.find((d) => d.id === g.selectedDish);
  if (dish?.lineId != null) {
    const linked = findLine(order, dish.lineId);
    if (linked && isLineOpen(linked) && linked.recipe === dishRecipe)
      return linked;
  }
  return order.lines.find(
    (l) => isLineOpen(l) && l.recipe === dishRecipe,
  );
}
/** 全单上齐后的满意度：各交付菜品质均值 + 上齐间隔惩罚（间隔越短越好） */
function settleSatisfaction(g: Game, order: Order) {
  const served = order.lines.filter((l) => l.state === "served");
  const pending = order.lines.filter((l) => isLineOpen(l));
  if (served.length === 0 || pending.length > 0) return 0;
  const first = order.firstServedAt ?? g.time;
  const last = order.lastServedAt ?? g.time;
  const span = last - first;
  const avgQuality =
    served.reduce((sum, l) => sum + (l.qualitySnapshot ?? 70), 0) /
    served.length;
  const intervalPenalty = Math.min(25, Math.floor(span * 1.5));
  const satisfaction = Math.max(0, Math.round(avgQuality - intervalPenalty));
  order.satisfaction = satisfaction;
  return satisfaction;
}
export function deliver(g: Game, explicitLine?: number) {
  const { dish, order } = servicePair(g);
  if (!dish || dish.stage !== "plated" || !order) {
    g.notice = "请选择已装盘菜品和已接订单";
    return;
  }
  const line = pickLine(g, order, dish.recipe, explicitLine);
  if (!line) {
    penalty(
      g,
      order,
      10,
      "这道菜不在当前订单要求中（换菜前的成品不能按新要求交付），耐心减少10秒，菜品仍留在出餐台",
    );
    return;
  }
  const q = servingQuality(g, dish);
  if (q < 30) {
    penalty(g, order, 8, "品质低于30，客人拒收，耐心减少8秒");
    return;
  }
  // 逐道确认收入：抵价行按折扣价，普通行按品质计价 + 连击奖励
  const base = line.credit
    ? Math.round(
        recipes[line.originRecipe ?? dish.recipe].price * CREDIT_RATE,
      )
    : Math.round((recipes[dish.recipe].price * q) / 100);
  const comboBonus = line.credit ? 0 : Math.min(10, g.combo * 2);
  const amount = base + comboBonus;
  g.combo++;
  g.served++;
  line.state = "served";
  line.paid = true;
  line.paidAmount = amount;
  line.paidAt = g.time;
  line.qualitySnapshot = q;
  if (order.firstServedAt === undefined) order.firstServedAt = g.time;
  order.lastServedAt = g.time;
  g.entries.push({
    id: g.nextId++,
    time: g.time,
    label: `${order.guest} · ${recipes[dish.recipe].name}${line.credit ? "（抵价）" : ""}`,
    amount,
    kind: "sale",
  });
  g.dishes = g.dishes.filter((d) => d.id !== dish.id);
  g.selectedDish = null;
  // 全部菜行上齐：结算满意度与小费，订单完成
  if (!openLines(order).length) {
    const satisfaction = settleSatisfaction(g, order);
    const tip = Math.round((satisfaction / 100) * 10);
    if (tip > 0) {
      g.entries.push({
        id: g.nextId++,
        time: g.time,
        label: `${order.guest} 满意度小费（${satisfaction}分）`,
        amount: tip,
        kind: "tip",
      });
    }
    order.status = "served";
    g.selectedOrder = null;
    g.notice = `全部上齐 +¥${amount}，满意度 ${satisfaction} 分${tip ? `，小费 ¥${tip}` : ""} · 连续交付 ${g.combo} 道`;
  } else {
    g.notice = `交付成功 +¥${amount}，还差 ${openLines(order).length} 道 · 连续交付 ${g.combo} 道`;
  }
  syncLineStates(g);
}
