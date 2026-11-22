import type { Game, Order, OrderLine, RecipeId } from "./types";
export function findOrder(g: Game, id: number): Order | undefined {
  return g.orders.find((o) => o.id === id);
}
export function findLine(
  o: Order,
  lineId: number,
): OrderLine | undefined {
  return o.lines.find((l) => l.id === lineId);
}
/** 仍需要厨房工作的菜行 */
export function isLineOpen(l: OrderLine): boolean {
  return (
    l.state === "pending" ||
    l.state === "prepping" ||
    l.state === "cooking" ||
    l.state === "ready"
  );
}
export function isOrderActive(o: Order): boolean {
  return o.status === "waiting" || o.status === "accepted";
}
export function openLines(o: Order): OrderLine[] {
  return o.lines.filter(isLineOpen);
}
export function paidLines(o: Order): OrderLine[] {
  return o.lines.filter((l) => l.paid);
}
export function makeLine(
  g: Game,
  recipe: RecipeId,
  extra: Partial<OrderLine> = {},
): OrderLine {
  return {
    id: g.nextId++,
    recipe,
    state: "pending",
    paid: false,
    ...extra,
  };
}
/**
 * 旧版单菜订单（只有 recipe 字段、没有 lines）就地迁移为一行菜的订单。
 * 迁移不改变任何食材、账目与状态，保证旧存档继续工作。
 */
export function normalizeGame(g: Game): Game {
  for (const o of g.orders) {
    if (!Array.isArray(o.lines)) {
      const oldRecipe = (o as Order & { recipe?: RecipeId }).recipe;
      if (oldRecipe) {
        o.lines = [
          {
            id: g.nextId++,
            recipe: oldRecipe,
            state:
              o.status === "served"
                ? "served"
                : o.status === "left"
                  ? "cancelled"
                  : "pending",
            paid: o.status === "served",
          },
        ];
        o.swapped = false;
        o.legacy = true;
      } else {
        o.lines = o.lines ?? [];
        o.swapped = o.swapped ?? false;
      }
    }
    o.swapped = o.swapped ?? false;
    for (const l of o.lines) l.paid = l.paid ?? false;
  }
  for (const p of g.portions) {
    p.orderId = p.orderId ?? null;
    p.lineId = p.lineId ?? null;
  }
  for (const d of g.dishes) {
    d.orderId = d.orderId ?? null;
    d.lineId = d.lineId ?? null;
  }
  return g;
}
