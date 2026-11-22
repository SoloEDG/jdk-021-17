import type { Game } from "../../../shared/types";
import { syncLineStates } from "../../../shared/wip";
export function plate(g: Game, id: number) {
  const d = g.dishes.find((d) => d.id === id);
  if (!d || d.stage !== "counter") return;
  d.stage = "plated";
  g.selectedDish = id;
  g.notice = "装盘完成，请选中订单后上菜";
}
export function discard(g: Game, id: number) {
  const d = g.dishes.find((d) => d.id === id);
  if (!d) return;
  g.dishes = g.dishes.filter((x) => x.id !== id);
  if (g.selectedDish === id) g.selectedDish = null;
  g.entries.push({
    id: g.nextId++,
    time: g.time,
    label: "丢弃菜品",
    amount: -3,
    kind: "waste",
  });
  // 若属于某道菜行，丢弃后该菜行回到待制作，份额不会凭空消失
  syncLineStates(g);
  g.notice = "已丢弃，浪费成本 ¥3；对应菜行需重新制作";
}
