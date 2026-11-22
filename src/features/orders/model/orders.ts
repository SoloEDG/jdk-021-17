import type { Game, Order, RecipeId } from "../../../shared/types";
import { activeOrders } from "../lib/patience";
import {
  makeLine,
  openLines,
  paidLines,
} from "../../../shared/orderlines";
import { releaseLineResources, syncLineStates } from "../../../shared/wip";
const GUESTS = ["阿宁", "许小姐", "赵先生", "晓晴", "老周", "米粒"];
const MENU: RecipeId[] = ["steak", "pasta", "salad"];
export function accept(g: Game, id: number) {
  const o = g.orders.find((o) => o.id === id);
  if (o?.status !== "waiting") return;
  o.status = "accepted";
  g.selectedOrder = id;
  g.notice = `已接单（${o.lines.length} 道菜），请逐道备料并留意客人耐心。`;
}
/**
 * 超时离店：已交付部分的收入保留，未交付菜行释放制作资源。
 * 不重置整单，只结算尚未完成的部分，保证已发生的工作和收入不被掩盖。
 */
export function expire(g: Game) {
  for (const o of activeOrders(g)) {
    if (g.time < o.deadline) continue;
    const unfinished = openLines(o);
    for (const l of unfinished) {
      releaseLineResources(g, o, l, "客离作废");
      l.state = "cancelled";
    }
    const gotPaid = paidLines(o).length;
    o.status = "left";
    g.missed++;
    g.combo = 0;
    if (g.selectedOrder === o.id) g.selectedOrder = null;
    g.entries.push({
      id: g.nextId++,
      time: g.time,
      label: `${o.guest} 等待超时（已上 ${gotPaid}/${o.lines.length} 道）`,
      amount: -5,
      kind: "miss",
    });
    g.notice = `${o.guest} 离店，已上菜品收入保留，损失 ¥5`;
    syncLineStates(g);
  }
}
/**
 * 玩家主动取消剩余未交付菜行：
 * 未付款的直接取消（在制食材退回库存、成品记作废损耗）；
 * 已付款的菜行原路退款，金额记为 refund。
 */
export function cancelRemaining(g: Game, id: number) {
  const o = g.orders.find((o) => o.id === id);
  if (!o || o.status !== "accepted") return;
  const open = openLines(o);
  if (!open.length) {
    g.notice = "没有可取消的剩余菜品";
    return;
  }
  let refund = 0;
  let refundCount = 0;
  for (const l of open) {
    if (l.paid && l.paidAmount) {
      refund += l.paidAmount;
      refundCount++;
      l.paid = false;
      g.entries.push({
        id: g.nextId++,
        time: g.time,
        label: `${o.guest} 退菜退款`,
        amount: -l.paidAmount,
        kind: "refund",
      });
    }
    releaseLineResources(g, o, l, "取消剩余");
    l.state = "cancelled";
  }
  if (!openLines(o).length && !paidLines(o).length) o.status = "left";
  if (g.selectedOrder === o.id && o.status !== "accepted") {
    g.selectedOrder = null;
  }
  syncLineStates(g);
  g.notice = refundCount
    ? `已取消剩余菜品，退款 ¥${refund}（仅退已付款部分）`
    : "已取消剩余未付款菜品，未收款无需退款";
}
export function arrive(g: Game) {
  if (g.time >= 150 || activeOrders(g).length >= 6) return;
  const seq = Math.floor(g.time / 18);
  const pick = (k: number) => MENU[(seq + k) % 3];
  // 约三分之一的新客点多道菜，其中偶发两份同菜
  const patterns: RecipeId[][] = [
    [pick(0)],
    [pick(0), pick(1)],
    [pick(0), pick(0)],
    [pick(1), pick(2)],
    [pick(2)],
  ];
  const recipes = patterns[seq % patterns.length];
  const order: Order = {
    id: g.nextId++,
    guest: GUESTS[seq % GUESTS.length],
    arrived: g.time,
    deadline: g.time + 60 + (seq % 3) * 5,
    status: "waiting",
    swapped: false,
    lines: recipes.map((r) => makeLine(g, r)),
  };
  g.orders.push(order);
}
