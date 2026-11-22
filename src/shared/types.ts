export type RecipeId = "steak" | "pasta" | "salad";
export type Ingredient = "beef" | "noodle" | "greens";
export interface Recipe {
  id: RecipeId;
  name: string;
  icon: string;
  ingredient: Ingredient;
  station: "pan" | "pot";
  target: number;
  price: number;
}
export type OrderStatus = "waiting" | "accepted" | "served" | "left";
/**
 * 一道菜在订单中的生命周期：
 * pending 未备料 / prepping 已备料未下锅 / cooking 已下锅 /
 * ready 已起锅成菜 / served 已交付收款 / cancelled 取消或作废
 */
export type LineState =
  | "pending"
  | "prepping"
  | "cooking"
  | "ready"
  | "served"
  | "cancelled";
export interface OrderLine {
  id: number;
  recipe: RecipeId;
  state: LineState;
  paid: boolean;
  paidAmount?: number;
  paidAt?: number;
  /** 换菜抵价：原菜谱，成品按原价折扣交付 */
  originRecipe?: RecipeId;
  credit?: boolean;
  /** 交付瞬间的上桌品质（含失温惩罚），用于全单满意度结算 */
  qualitySnapshot?: number;
  note?: string;
}
export interface Order {
  id: number;
  guest: string;
  arrived: number;
  deadline: number;
  status: OrderStatus;
  lines: OrderLine[];
  /** 每位客人接单后只能换一次菜 */
  swapped: boolean;
  firstServedAt?: number;
  lastServedAt?: number;
  satisfaction?: number;
  /** 旧版单菜数据迁移后保留，便于排查 */
  legacy?: boolean;
  /** @deprecated 旧版字段，由 lines 取代，仅用于迁移 */
  recipe?: RecipeId;
}
export interface Portion {
  id: number;
  recipe: RecipeId;
  preparedAt: number;
  /** 分配到的订单/菜行，未分配为 null（散份仍可自由下锅） */
  orderId: number | null;
  lineId: number | null;
}
export interface Stove {
  id: number;
  kind: "pan" | "pot";
  portion: Portion | null;
  started: number;
}
export interface Dish {
  id: number;
  recipe: RecipeId;
  quality: number;
  cookedAt: number;
  stage: "counter" | "plated";
  orderId: number | null;
  lineId: number | null;
}
export type EntryKind =
  | "sale"
  | "waste"
  | "miss"
  | "supply"
  | "refund"
  | "tip";
export interface Entry {
  id: number;
  time: number;
  label: string;
  amount: number;
  kind: EntryKind;
}
export interface Game {
  time: number;
  duration: number;
  running: boolean;
  ended: boolean;
  nextId: number;
  selectedOrder: number | null;
  selectedDish: number | null;
  orders: Order[];
  stock: Record<Ingredient, number>;
  portions: Portion[];
  stoves: Stove[];
  dishes: Dish[];
  entries: Entry[];
  combo: number;
  served: number;
  missed: number;
  notice: string;
  best: number;
}
export type SwapMode = "credit" | "redo";
export type Command =
  | { type: "accept"; id: number }
  | { type: "select-order"; id: number }
  | { type: "prepare"; recipe: RecipeId }
  | { type: "cook"; portion: number; stove: number }
  | { type: "lift"; id: number }
  | { type: "plate"; id: number }
  | { type: "select-dish"; id: number }
  | { type: "serve"; lineId?: number }
  | { type: "discard"; id: number }
  | { type: "restock"; ingredient: Ingredient }
  | {
      type: "confirm-swap";
      id: number;
      lineId: number;
      recipe: RecipeId;
      mode: SwapMode;
    }
  | { type: "cancel-lines"; id: number };
