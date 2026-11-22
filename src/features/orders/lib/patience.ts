import type { Game, Order } from "../../../shared/types";
import { isOrderActive } from "../../../shared/orderlines";
export function patience(g: Game, o: Order) {
  return Math.max(
    0,
    Math.min(1, (o.deadline - g.time) / (o.deadline - o.arrived)),
  );
}
/** 剩余耐心秒数（可能为负，仅用于提示） */
export function remainingSeconds(g: Game, o: Order) {
  return o.deadline - g.time;
}
export function activeOrders(g: Game) {
  return g.orders.filter(isOrderActive);
}
export function settledOrders(g: Game) {
  return g.orders.filter((o) => !isOrderActive(o));
}
