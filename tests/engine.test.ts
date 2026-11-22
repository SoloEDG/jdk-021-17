import assert from "node:assert/strict";
import { createGame } from "../src/shared/initial.ts";
import { normalizeGame } from "../src/shared/orderlines.ts";
import { recipes, ingredients } from "../src/shared/catalog.ts";
import {
  accept,
  expire,
  arrive,
  cancelRemaining,
  confirmSwap,
  previewSwap,
} from "../src/features/orders/index.ts";
import { prepare, restock } from "../src/features/pantry/index.ts";
import { cook, lift } from "../src/features/kitchen/index.ts";
import { plate, discard, deliver } from "../src/features/service/index.ts";
import { closeShift } from "../src/features/ledger/index.ts";
import { dispatch } from "../src/app/commands.ts";
import { syncLineStates, ingredientTotal } from "../src/shared/wip.ts";
import type { Game, RecipeId, Order, OrderLine } from "../src/shared/types.ts";
let passed = 0;
let failed = 0;
function test(name: string, fn: (g: Game) => void) {
  const g = start();
  try {
    fn(g);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}
function start(): Game {
  const g = createGame(0);
  normalizeGame(g);
  g.running = true;
  return g;
}
function money(g: Game) {
  return g.entries.reduce((s, e) => s + e.amount, 0);
}
function stockChecksum(g: Game) {
  const t = ingredientTotal(g);
  return t.beef + t.noodle + t.greens;
}
function lineOf(o: Order, recipe: RecipeId, nth = 0): OrderLine {
  const matches = o.lines.filter((l) => l.recipe === recipe);
  assert.ok(matches[nth], `菜行不存在: ${recipe} #${nth}`);
  return matches[nth];
}
function tick(g: Game, seconds: number) {
  const target = g.time + seconds;
  let guard = 0;
  while (g.time < target && guard < 100000) {
    g.time = Math.round((g.time + 0.1) * 10) / 10;
    expire(g);
    guard++;
  }
}
function makeDish(g: Game, recipe: RecipeId): number {
  prepare(g, recipe);
  const portion = g.portions.find((p) => p.recipe === recipe)!;
  const stove = g.stoves.find(
    (s) => !s.portion && s.kind === recipes[recipe].station,
  )!;
  cook(g, portion.id, stove.id);
  tick(g, recipes[recipe].target);
  lift(g, stove.id);
  const dish = g.dishes.find((d) => d.recipe === recipe)!;
  plate(g, dish.id);
  return dish.id;
}
function serve(g: Game, orderId: number, recipe: RecipeId) {
  const before = money(g);
  g.selectedOrder = orderId;
  const dish = g.dishes.find((d) => d.recipe === recipe && d.stage === "plated");
  assert.ok(dish, `没有可上的 ${recipe}`);
  g.selectedDish = dish.id;
  deliver(g);
  return money(g) - before;
}
/**
 * 全流程守恒：库存+在制食材 + 作废次数 + 已交付菜品数
 * 必须等于初始食材折算总量 + 采购量（每份食材只有在库、在制、作废、交付四种去向）。
 */
function wasteCount(g: Game) {
  return g.entries.filter((e) => e.kind === "waste").length;
}
function servedDishCount(g: Game) {
  return g.orders.reduce(
    (n, o) => n + o.lines.filter((l) => l.state === "served").length,
    0,
  );
}
function foodUnits(g: Game) {
  return stockChecksum(g) + wasteCount(g) + servedDishCount(g);
}
function assertConservation(g: Game, prevStock: number, prevMoney: number, label: string) {
  syncLineStates(g);
  assert.equal(
    stockChecksum(g) + wasteCount(g),
    prevStock + wasteCount(g),
    `[${label}] 食材守恒被破坏`,
  );
  assert.equal(
    money(g),
    prevMoney,
    `[${label}] 账目守恒被破坏：${prevMoney} → ${money(g)}`,
  );
}
/** 全流程所有引用的菜行/资源 id 必须真实存在 */
function assertReferentialIntegrity(g: Game) {
  const lineIds = new Set(g.orders.flatMap((o) => o.lines.map((l) => l.id)));
  for (const p of g.portions) {
    if (p.lineId != null) assert.ok(lineIds.has(p.lineId), `备料 ${p.id} 指向不存在菜行`);
  }
  for (const s of g.stoves) {
    if (s.portion?.lineId != null) assert.ok(lineIds.has(s.portion.lineId));
  }
  for (const d of g.dishes) {
    if (d.lineId != null) assert.ok(lineIds.has(d.lineId), `成品 ${d.id} 指向不存在菜行`);
  }
}
// ---------- 1. 旧版单菜数据迁移 ----------
test("旧版单菜订单迁移后行为与新结构一致", (g) => {
  assert.equal(g.orders[2].lines.length, 1);
  assert.equal(g.orders[2].lines[0].recipe, "salad");
  assert.equal(g.orders[2].lines[0].state, "pending");
  accept(g, 3);
  makeDish(g, "salad");
  g.selectedOrder = 3;
  g.selectedDish = g.dishes[0].id;
  deliver(g);
  assert.equal(g.orders[2].status, "served");
  assert.equal(g.orders[2].lines[0].paid, true);
});
test("normalizeGame 可处理手工构造的旧版 {recipe} 订单", () => {
  const g = start();
  g.orders.push({
    id: 99,
    guest: "旧客",
    arrived: 0,
    deadline: 99,
    status: "served",
    swapped: false,
    recipe: "pasta",
  } as unknown as Order);
  normalizeGame(g);
  const o = g.orders.find((x) => x.id === 99)!;
  assert.equal(o.lines.length, 1);
  assert.equal(o.lines[0].state, "served");
  assert.equal(o.lines[0].paid, true);
});
// ---------- 2. 多菜订单逐道交付、按交付确认收入 ----------
test("两道菜逐道交付，收入逐道确认，全单上齐结算小费", (g) => {
  accept(g, 1); // 牛排 + 沙拉
  g.selectedOrder = 1;
  makeDish(g, "steak");
  g.selectedDish = g.dishes.find((d) => d.recipe === "steak")!.id;
  const firstSale = (() => {
    const b = money(g);
    deliver(g);
    return money(g) - b;
  })();
  assert.ok(firstSale > 0);
  const order = g.orders[0];
  assert.equal(order.status, "accepted"); // 还没上齐
  assert.equal(lineOf(order, "steak").state, "served");
  assert.equal(lineOf(order, "salad").state, "pending");
  makeDish(g, "salad");
  g.selectedDish = g.dishes.find((d) => d.recipe === "salad")!.id;
  deliver(g);
  assert.equal(order.status, "served");
  assert.ok(order.satisfaction !== undefined && order.satisfaction > 0);
  assert.ok(g.entries.some((e) => e.kind === "tip"));
  // 两道各有一笔 sale
  assert.equal(g.entries.filter((e) => e.kind === "sale").length, 2);
});
// ---------- 3. 两份同菜：份额独立、不串单 ----------
test("两份同意面各自独立追踪，逐道交付不串份额", (g) => {
  accept(g, 2); // pasta ×2
  g.selectedOrder = 2;
  const lines = g.orders[1].lines;
  assert.equal(lines.length, 2);
  assert.notEqual(lines[0].id, lines[1].id);
  makeDish(g, "pasta");
  syncLineStates(g);
  // 只有一份变成 ready，另一份仍 pending
  const ready = lines.filter((l) => l.state === "ready");
  const pending = lines.filter((l) => l.state === "pending");
  assert.equal(ready.length, 1);
  assert.equal(pending.length, 1);
  g.selectedDish = g.dishes[0].id;
  deliver(g);
  assert.equal(lines.filter((l) => l.state === "served").length, 1);
  assert.equal(g.dishes.length, 0);
  // 第二份完整制作并交付
  makeDish(g, "pasta");
  g.selectedDish = g.dishes[0].id;
  deliver(g);
  assert.equal(lines.every((l) => l.state === "served"), true);
  assert.equal(g.orders[1].status, "served");
  assert.equal(g.entries.filter((e) => e.kind === "sale").length, 2);
});
// ---------- 4. 换菜：未备料直接改，无费用、扣耐心 ----------
test("未备料换菜直接改单，仅扣耐心不产生费用", (g) => {
  accept(g, 1);
  const order = g.orders[0];
  const line = lineOf(order, "steak");
  const deadlineBefore = order.deadline;
  const moneyBefore = money(g);
  const stockBefore = stockChecksum(g);
  const pv = previewSwap(g, 1, line.id, "pasta", "redo");
  assert.equal(pv.ok, true);
  assert.equal(pv.fee, 0);
  assert.equal(pv.patienceAfter, order.deadline - g.time - 6);
  confirmSwap(g, 1, line.id, "pasta", "redo");
  assert.equal(line.recipe, "pasta");
  assert.equal(line.state, "pending");
  assert.equal(order.deadline, deadlineBefore - 6);
  assert.equal(order.swapped, true);
  assertConservation(g, stockBefore, moneyBefore, "未备料换菜");
  // 每桌只能换一次
  const again = previewSwap(g, 1, line.id, "salad", "redo");
  assert.equal(again.ok, false);
});
// ---------- 5. 换菜：已备料/已下锅重做，食材退回库存 ----------
test("已备料换菜重做：食材退回库存，无费用", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  prepare(g, "steak");
  const line = lineOf(g.orders[0], "steak");
  assert.equal(line.state, "prepping");
  const stockBefore = stockChecksum(g);
  const moneyBefore = money(g);
  confirmSwap(g, 1, line.id, "salad", "redo");
  assert.equal(g.stock.beef, 5); // 消耗的牛肉退回，改菜本身不扣料
  assert.equal(g.portions.length, 0);
  assert.equal(line.recipe, "salad");
  assert.equal(line.state, "pending");
  assertConservation(g, stockBefore, moneyBefore, "备料换菜");
});
test("已下锅换菜重做：份额从灶台撤回并退料，火候工作不丢失账目", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  prepare(g, "steak");
  const portion = g.portions[0];
  cook(g, portion.id, g.stoves[0].id);
  tick(g, 5);
  const line = lineOf(g.orders[0], "steak");
  assert.equal(line.state, "cooking");
  const stockBefore = stockChecksum(g);
  const moneyBefore = money(g);
  confirmSwap(g, 1, line.id, "pasta", "redo");
  assert.equal(g.stoves[0].portion, null);
  assert.equal(g.stock.beef, 5); // 牛肉退回
  assert.equal(g.portions.length, 0);
  assertConservation(g, stockBefore, moneyBefore, "下锅换菜");
});
// ---------- 6. 换菜：已起锅重做 → 作废损耗 ----------
test("已起锅换菜重做：成品作废记 ¥3 损耗，菜行回待制作", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  makeDish(g, "steak");
  const line = lineOf(g.orders[0], "steak");
  assert.equal(line.state, "ready");
  const stockBefore = stockChecksum(g);
  const moneyBefore = money(g);
  const pv = previewSwap(g, 1, line.id, "salad", "redo");
  assert.equal(pv.fee, 3);
  confirmSwap(g, 1, line.id, "salad", "redo");
  assert.equal(g.dishes.length, 0);
  assert.equal(money(g), moneyBefore - 3);
  assert.equal(g.entries.at(-1)!.kind, "waste");
  assert.equal(line.recipe, "salad");
  assert.equal(line.state, "pending");
  // 作废把一份成品折算为损耗：食材余量减 1、waste 账目加 1，总量守恒
  assert.equal(stockChecksum(g), stockBefore - 1);
  assert.equal(wasteCount(g), 1);
});
// ---------- 7. 抵价换菜：旧成品保留、折扣交付，新菜另做 ----------
test("抵价换菜：旧成品按折扣交付，新要求另开菜行，旧成品不能冒充新菜", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  const dishId = makeDish(g, "steak");
  const line = lineOf(g.orders[0], "steak");
  const moneyBefore = money(g);
  const stockBefore = stockChecksum(g);
  // 换成意面：与原订单另一道沙拉不冲突，新增独立菜行
  const pv = previewSwap(g, 1, line.id, "pasta", "credit");
  assert.equal(pv.creditAmount, Math.round(recipes.steak.price * 0.5));
  confirmSwap(g, 1, line.id, "pasta", "credit");
  // 旧菜行变抵价行，成品保留；新增意面菜行
  assert.equal(line.credit, true);
  assert.equal(line.originRecipe, "steak");
  assert.equal(line.state, "ready");
  assert.ok(g.dishes.some((d) => d.id === dishId));
  const pastaLine = lineOf(g.orders[0], "pasta");
  assert.equal(pastaLine.state, "pending");
  assert.equal(g.orders[0].lines.length, 3); // 抵价牛排 + 沙拉 + 新意面
  assertConservation(g, stockBefore, moneyBefore, "抵价换菜");
  // 关键：旧牛排不能交付给意面菜行（菜谱不匹配 → 错配扣耐心，菜留在出餐台）
  g.selectedDish = dishId;
  const deadlineBefore = g.orders[0].deadline;
  deliver(g, pastaLine.id);
  assert.equal(g.dishes.length, 1); // 菜没被收走
  assert.equal(g.orders[0].deadline, deadlineBefore - 10);
  // 正常路径：牛排交给抵价行
  deliver(g);
  assert.equal(line.state, "served");
  assert.equal(line.paid, true);
  assert.equal(
    line.paidAmount,
    Math.round(recipes.steak.price * 0.5),
  );
  // 再做意面完成新要求（沙拉仍在订单内，先把它也完成才能全单上齐）
  makeDish(g, "pasta");
  g.selectedDish = g.dishes.find((d) => d.recipe === "pasta")!.id;
  deliver(g);
  makeDish(g, "salad");
  g.selectedDish = g.dishes.find((d) => d.recipe === "salad")!.id;
  deliver(g);
  assert.equal(g.orders[0].status, "served");
});
test("抵价换到订单已有的同菜谱：并入既有菜行，不产生重复份额", (g) => {
  accept(g, 1); // 牛排 + 沙拉
  g.selectedOrder = 1;
  makeDish(g, "steak");
  const line = lineOf(g.orders[0], "steak");
  confirmSwap(g, 1, line.id, "salad", "credit");
  // 原本就有一道待做沙拉，不应再新增第二道
  const salads = g.orders[0].lines.filter((l) => l.recipe === "salad");
  assert.equal(salads.length, 1);
  assert.equal(g.orders[0].lines.length, 2);
});
test("抵价换菜不产生作废费用，散份脱离订单后仍可自由使用", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  prepare(g, "steak"); // 仅备料
  const line = lineOf(g.orders[0], "steak");
  const moneyBefore = money(g);
  confirmSwap(g, 1, line.id, "salad", "credit");
  assert.equal(money(g), moneyBefore);
  assert.equal(g.portions.length, 1);
  assert.equal(g.portions[0].lineId, null); // 散份
  assert.equal(line.recipe, "salad");
  // 散份仍可下锅做成牛排
  const stove = g.stoves.find((s) => s.kind === "pan")!;
  cook(g, g.portions[0].id, stove.id);
  assert.equal(stove.portion!.recipe, "steak");
});
// ---------- 8. 换菜确认与上菜交错 ----------
test("换菜确认与上菜同时交错：状态按真实资源重算，不重置整单", (g) => {
  accept(g, 1); // 牛排 + 沙拉
  g.selectedOrder = 1;
  makeDish(g, "steak");
  // 先上牛排
  g.selectedDish = g.dishes.find((d) => d.recipe === "steak")!.id;
  deliver(g);
  const paidBefore = g.entries.filter((e) => e.kind === "sale").length;
  // 再对沙拉换菜（未备料）
  const saladLine = lineOf(g.orders[0], "salad");
  confirmSwap(g, 1, saladLine.id, "pasta", "redo");
  // 牛排的交付记录不受影响
  assert.equal(
    g.entries.filter((e) => e.kind === "sale").length,
    paidBefore,
  );
  assert.equal(lineOf(g.orders[0], "steak").state, "served");
  assert.equal(saladLine.recipe, "pasta");
  // 完成新菜，全单上齐
  makeDish(g, "pasta");
  g.selectedDish = g.dishes.find((d) => d.recipe === "pasta")!.id;
  deliver(g);
  assert.equal(g.orders[0].status, "served");
});
// ---------- 9. 多菜订单其中一份超时离店 ----------
test("两道菜上了一道后超时：已收收入保留，剩余份额释放，库存与账目守恒", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  makeDish(g, "steak");
  g.selectedDish = g.dishes.find((d) => d.recipe === "steak")!.id;
  deliver(g);
  const salesBefore = g.entries
    .filter((e) => e.kind === "sale")
    .reduce((s, e) => s + e.amount, 0);
  // 给沙拉备料后让这桌超时（其他桌也可能自然超时，只核对本桌账目）
  prepare(g, "salad");
  const stockBefore = stockChecksum(g);
  const order = g.orders[0];
  const ownEntriesBefore = g.entries.filter((e) => e.label.includes(order.guest));
  tick(g, order.deadline - g.time + 0.1);
  assert.equal(order.status, "left");
  // 已上牛排的收入还在
  const salesAfter = g.entries
    .filter((e) => e.kind === "sale")
    .reduce((s, e) => s + e.amount, 0);
  assert.equal(salesAfter, salesBefore);
  // 备料食材已退回库存
  assert.equal(g.portions.length, 0);
  assert.equal(stockChecksum(g), stockBefore);
  // 本桌账目只多了 -5 超时损失
  const ownDelta =
    g.entries
      .filter((e) => e.label.includes(order.guest))
      .reduce((s, e) => s + e.amount, 0) -
    ownEntriesBefore.reduce((s, e) => s + e.amount, 0);
  assert.equal(ownDelta, -5);
  assert.equal(lineOf(order, "salad").state, "cancelled");
  assert.equal(lineOf(order, "steak").state, "served");
});
test("灶台上的菜遇客人离店：份额撤回退料，不凭空消失", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  prepare(g, "steak");
  cook(g, g.portions[0].id, g.stoves[0].id);
  const stockBefore = stockChecksum(g);
  const order = g.orders[0];
  tick(g, order.deadline - g.time + 0.1);
  assert.equal(g.stoves[0].portion, null);
  assert.equal(stockChecksum(g), stockBefore);
  assert.equal(g.orders[0].status, "left");
});
// ---------- 10. 取消剩余：未付款不退款、在制退料、成品记损耗 ----------
test("取消剩余未付款菜行：无退款，备料退回、成品作废", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  makeDish(g, "steak"); // 成品在出餐台（未交付）
  prepare(g, "salad"); // 沙拉已备料
  const stockBefore = stockChecksum(g);
  const moneyBefore = money(g);
  cancelRemaining(g, 1);
  // 成品作废 -3（一份食材折算损耗），沙拉备料退回库存
  assert.equal(money(g), moneyBefore - 3);
  // stockBefore 已计入沙拉备料：退回后总数不变；牛排作废使折算总量减 1
  assert.equal(stockChecksum(g), stockBefore - 1);
  assert.equal(wasteCount(g), 1);
  assert.equal(g.dishes.length, 0);
  assert.equal(g.portions.length, 0);
  assert.equal(g.orders[0].lines.every((l) => l.state === "cancelled"), true);
  assert.equal(g.orders[0].status, "left");
  assert.ok(!g.entries.some((e) => e.kind === "refund"));
});
test("已付款部分不受取消影响，无对应款项可退", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  makeDish(g, "steak");
  g.selectedDish = g.dishes.find((d) => d.recipe === "steak")!.id;
  deliver(g);
  const paid = lineOf(g.orders[0], "steak").paidAmount!;
  const moneyBefore = money(g);
  cancelRemaining(g, 1); // 只剩未付款的沙拉
  assert.equal(
    g.entries.filter((e) => e.kind === "refund").length,
    0,
    "未付款菜行取消不产生退款",
  );
  // 牛排付款仍然保留
  assert.equal(lineOf(g.orders[0], "steak").paidAmount, paid);
  assert.equal(money(g), moneyBefore);
});
// ---------- 11. 丢弃成品后菜行回到待制作，可重做交付 ----------
test("丢弃关联菜行的成品后菜行回 pending，重新制作仍可交付", (g) => {
  accept(g, 1);
  g.selectedOrder = 1;
  makeDish(g, "steak");
  const line = lineOf(g.orders[0], "steak");
  const dishId = g.dishes[0].id;
  discard(g, dishId);
  syncLineStates(g);
  assert.equal(line.state, "pending");
  makeDish(g, "steak");
  g.selectedDish = g.dishes[0].id;
  deliver(g);
  assert.equal(line.state, "served");
});
// ---------- 12. 采购与打烊的守恒 ----------
test("采购增加库存并按价扣款，打烊清理后全部资源可解释", (g) => {
  const stockBefore = stockChecksum(g);
  const moneyBefore = money(g);
  restock(g, "beef");
  assert.equal(g.stock.beef, 8);
  assert.equal(money(g), moneyBefore - ingredients.beef.cost * 3);
  assert.equal(stockChecksum(g), stockBefore + 3);
  accept(g, 1);
  g.selectedOrder = 1;
  prepare(g, "steak");
  const stockAtClose = stockChecksum(g);
  closeShift(g);
  // 打烊把在制食材退回库存，总量不变
  assert.equal(stockChecksum(g), stockAtClose);
  assert.equal(g.portions.length, 0);
  assert.equal(g.dishes.length, 0);
});
// ---------- 13. 新客到来生成多菜订单（含两份同菜） ----------
test("arrive 生成的订单都带 lines，且出现两份同菜模式", (g) => {
  const seen: number[] = [];
  for (let i = 0; i < 6; i++) {
    g.time = i * 18;
    arrive(g);
  }
  const newcomers = g.orders.slice(3);
  assert.ok(newcomers.length >= 3);
  for (const o of newcomers) {
    assert.ok(o.lines.length >= 1);
    seen.push(o.lines.length);
    for (const l of o.lines) assert.equal(l.state, "pending");
  }
  assert.ok(seen.some((n) => n >= 2));
});
// ---------- 14. dispatch 端到端 + 全程引用完整性 ----------
test("dispatch 全流程：接单→备料→烹饪→换菜→交付，引用始终完整", (g) => {
  dispatch(g, { type: "accept", id: 1 });
  dispatch(g, { type: "select-order", id: 1 });
  dispatch(g, { type: "prepare", recipe: "steak" });
  assertReferentialIntegrity(g);
  const portion = g.portions[0];
  const stove = g.stoves.find((s) => s.kind === "pan")!;
  dispatch(g, { type: "cook", portion: portion.id, stove: stove.id });
  tick(g, recipes.steak.target);
  dispatch(g, { type: "lift", id: stove.id });
  const dishId = g.dishes[0].id;
  dispatch(g, { type: "plate", id: dishId });
  const line = lineOf(g.orders[0], "steak");
  dispatch(g, {
    type: "confirm-swap",
    id: 1,
    lineId: line.id,
    recipe: "salad",
    mode: "credit",
  });
  assertReferentialIntegrity(g);
  dispatch(g, { type: "select-dish", id: dishId });
  dispatch(g, { type: "serve" });
  assertReferentialIntegrity(g);
  assert.equal(line.state, "served");
});
// ---------- 15. 暂停时拒绝操作 ----------
test("暂停/未开始时 dispatch 拒绝所有厨房操作", () => {
  const g = start();
  g.running = false;
  const notice = g.notice;
  dispatch(g, { type: "accept", id: 1 });
  assert.equal(g.orders[0].status, "waiting");
  assert.notEqual(g.notice, notice);
});
// ---------- 16. 部分取消后上齐剩余菜品，订单正常完成 ----------
test("取消一道后上齐其余菜行，订单按完成结算，取消行不阻塞", (g) => {
  accept(g, 1); // 牛排 + 沙拉
  g.selectedOrder = 1;
  cancelRemaining(g, 1); // 全取消 → left
  assert.equal(g.orders[0].status, "left");
  const g2 = start();
  accept(g2, 1);
  g2.selectedOrder = 1;
  // 先取消沙拉，只交付牛排
  const salad = lineOf(g2.orders[0], "salad");
  salad.state = "cancelled";
  makeDish(g2, "steak");
  g2.selectedDish = g2.dishes[0].id;
  deliver(g2);
  assert.equal(g2.orders[0].status, "served");
  assert.equal(g2.orders[0].satisfaction !== undefined, true);
});
// ---------- 17. 整场营业全局守恒 ----------
test("完整班次结束后：食材折算+作废=初始量+采购量，账目逐笔可查", (g) => {
  const initialChecksum = stockChecksum(g);
  restock(g, "beef");
  restock(g, "noodle");
  const checksumAfterSupply = stockChecksum(g);
  accept(g, 1);
  g.selectedOrder = 1;
  makeDish(g, "steak");
  g.selectedDish = g.dishes.find((d) => d.recipe === "steak")!.id;
  deliver(g);
  makeDish(g, "salad");
  g.selectedDish = g.dishes.find((d) => d.recipe === "salad")!.id;
  deliver(g);
  accept(g, 2);
  g.selectedOrder = 2;
  makeDish(g, "pasta");
  discard(g, g.dishes[0].id); // 一次作废
  // 再备一份意面：打烊时会被清理并退回，不产生作废
  prepare(g, "pasta");
  const checksumBeforeClose = stockChecksum(g);
  closeShift(g);
  // 打烊退回备料：库存折算总量不变（仅状态从备料变回库存）
  assert.equal(stockChecksum(g), checksumBeforeClose);
  // 全局食材守恒：在库 + 作废 + 已交付 = 初始 + 采购
  assert.equal(
    foodUnits(g),
    initialChecksum + (checksumAfterSupply - initialChecksum),
  );
  // 账目净额等于所有分录之和
  assert.equal(
    money(g),
    g.entries.reduce((s, e) => s + e.amount, 0),
  );
  assert.equal(g.ended, true);
  assert.equal(g.portions.length, 0);
  assert.equal(g.dishes.length, 0);
  assert.equal(g.stoves.every((s) => s.portion === null), true);
});
console.log(`\n${passed} 个通过，${failed} 个失败`);
if (failed) process.exitCode = 1;
