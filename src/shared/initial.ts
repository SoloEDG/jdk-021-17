import type { Game, Order, OrderLine } from "./types";
function line(id: number, recipe: OrderLine["recipe"]): OrderLine {
  return { id, recipe, state: "pending", paid: false };
}
export function createGame(best = 0): Game {
  const orders: Order[] = [
    {
      id: 1,
      guest: "林小姐",
      arrived: 0,
      deadline: 70,
      status: "waiting",
      swapped: false,
      lines: [line(5, "steak"), line(6, "salad")],
    },
    {
      id: 2,
      guest: "周先生",
      arrived: 0,
      deadline: 80,
      status: "waiting",
      swapped: false,
      // 两份同菜：份额必须各自独立追踪
      lines: [line(7, "pasta"), line(8, "pasta")],
    },
    {
      // 旧版单菜数据结构：只有 recipe，靠 normalizeGame 迁移
      id: 3,
      guest: "小陈",
      arrived: 0,
      deadline: 55,
      status: "waiting",
      swapped: false,
      lines: [line(9, "salad")],
      legacy: true,
      recipe: "salad",
    } as Order,
  ];
  return {
    time: 0,
    duration: 180,
    running: false,
    ended: false,
    nextId: 10,
    selectedOrder: null,
    selectedDish: null,
    orders,
    stock: { beef: 5, noodle: 5, greens: 6 },
    portions: [],
    stoves: [
      { id: 1, kind: "pan", portion: null, started: 0 },
      { id: 2, kind: "pan", portion: null, started: 0 },
      { id: 3, kind: "pot", portion: null, started: 0 },
    ],
    dishes: [],
    entries: [],
    combo: 0,
    served: 0,
    missed: 0,
    notice: "准备好了吗？开门迎接第一位客人。",
    best,
  };
}
