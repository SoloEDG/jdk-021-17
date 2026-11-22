import type {
  Game,
  Order,
  OrderLine,
  RecipeId,
  SwapMode,
} from "../../../shared/types";
import { recipes } from "../../../shared/catalog";
import { findLine, isLineOpen, makeLine } from "../../../shared/orderlines";
import {
  detachLineResources,
  releaseLineResources,
  syncLineStates,
} from "../../../shared/wip";
/** 换菜固定扣减的耐心（秒） */
export const SWAP_PATIENCE_COST = 6;
/** 抵价交付时按原菜价的折扣率 */
export const CREDIT_RATE = 0.5;
export interface SwapPreview {
  ok: boolean;
  reason?: string;
  stage: OrderLine["state"];
  mode: SwapMode;
  /** 本次操作直接产生的费用（作废损耗），正数 */
  fee: number;
  /** 确认后剩余耐心秒数 */
  patienceAfter: number;
  /** 抵价模式下成品可抵扣的金额 */
  creditAmount: number;
  detail: string;
}
function stageOf(g: Game, o: Order, l: OrderLine): OrderLine["state"] {
  syncLineStates(g);
  return l.state;
}
export function previewSwap(
  g: Game,
  orderId: number,
  lineId: number,
  recipe: RecipeId,
  mode: SwapMode,
): SwapPreview {
  const fail = (reason: string): SwapPreview => ({
    ok: false,
    reason,
    stage: "pending",
    mode,
    fee: 0,
    patienceAfter: 0,
    creditAmount: 0,
    detail: reason,
  });
  const o = g.orders.find((x) => x.id === orderId);
  if (!o) return fail("订单不存在");
  if (o.status !== "accepted") return fail("只能对已接订单换菜");
  if (o.swapped) return fail("这桌已经换过一次菜，不能再换");
  const l = findLine(o, lineId);
  if (!l || !isLineOpen(l)) return fail("这道菜已结束，无法更换");
  if (l.recipe === recipe) return fail("新菜与原菜相同，无需更换");
  const stage = stageOf(g, o, l);
  const patienceAfter = o.deadline - g.time - SWAP_PATIENCE_COST;
  const base = {
    ok: true as const,
    stage,
    mode,
    patienceAfter,
  };
  if (mode === "redo") {
    // 未备料直接改；备料/下锅的食材退回库存不收费；已起锅成品作废按损耗记账
    const fee = stage === "ready" ? 3 : 0;
    const detail =
      stage === "ready"
        ? `已起锅的${recipes[l.recipe].name}作废重做，损耗 ¥3，食材需重新备料`
        : stage === "pending"
          ? "尚未备料，直接改单，无额外费用"
          : "食材退回库存，按新菜重新备料，无额外费用";
    return { ...base, fee, creditAmount: 0, detail };
  }
  // 抵价模式：保留已完成的工作，原菜成品按折扣交付
  const creditAmount =
    stage === "ready"
      ? Math.round(recipes[l.recipe].price * CREDIT_RATE)
      : 0;
  const detail =
    stage === "ready"
      ? `原${recipes[l.recipe].name}继续制作，按 ¥${creditAmount} 抵价交付，另做新菜${recipes[recipe].name}`
      : stage === "cooking"
        ? "锅中份额保留为散份，新菜需另行备料下锅"
        : stage === "prepping"
          ? "已备食材保留为散份，新菜需另行备料"
          : "尚未备料，直接改单，无额外费用";
  return { ...base, fee: 0, creditAmount, detail };
}
export function confirmSwap(
  g: Game,
  orderId: number,
  lineId: number,
  recipe: RecipeId,
  mode: SwapMode,
): SwapPreview {
  const preview = previewSwap(g, orderId, lineId, recipe, mode);
  if (!preview.ok) {
    g.notice = preview.reason ?? "无法换菜";
    return preview;
  }
  const o = g.orders.find((x) => x.id === orderId)!;
  const l = findLine(o, lineId)!;
  o.deadline = Math.max(g.time, o.deadline - SWAP_PATIENCE_COST);
  o.swapped = true;
  if (mode === "redo") {
    if (l.state === "ready") {
      // 成品作废：登记损耗并释放资源；备料/下锅的食材退回库存
      releaseLineResources(g, o, l, "换菜作废");
    } else if (l.state === "prepping" || l.state === "cooking") {
      releaseLineResources(g, o, l, "换菜撤料");
    }
    l.recipe = recipe;
    l.state = "pending";
    l.note = `换菜重做 → ${recipes[recipe].name}`;
    syncLineStates(g);
    g.notice = `已改为${recipes[recipe].name}，${preview.detail}`;
    return preview;
  }
  // 抵价模式
  if (l.state === "ready") {
    // 原菜行转为抵价行：仍交付给这桌，但不再匹配新菜要求
    l.credit = true;
    l.originRecipe = l.recipe;
    l.note = `抵价交付 · 原${recipes[l.recipe].name}`;
    // 若订单里已有同菜谱、尚未开始制作的菜行，则并入它，避免重复份额
    const existing = o.lines.find(
      (x) =>
        x.id !== l.id &&
        x.recipe === recipe &&
        !x.credit &&
        isLineOpen(x) &&
        x.state === "pending" &&
        !g.portions.some((p) => p.lineId === x.id) &&
        !g.stoves.some((s) => s.portion?.lineId === x.id) &&
        !g.dishes.some((d) => d.lineId === x.id),
    );
    if (!existing) {
      const fresh = makeLine(g, recipe, {
        note: `换菜新做 · ${recipes[recipe].name}`,
      });
      o.lines.push(fresh);
    }
  } else if (l.state === "prepping" || l.state === "cooking") {
    // 已投入的份额脱离订单成为散份，不浪费但也不冲抵
    detachLineResources(g, l.id);
    l.recipe = recipe;
    l.state = "pending";
    l.note = `换菜 → ${recipes[recipe].name}，原食材留作散份`;
  } else {
    l.recipe = recipe;
    l.state = "pending";
    l.note = `换菜 → ${recipes[recipe].name}`;
  }
  syncLineStates(g);
  g.notice = `换菜已确认，${preview.detail}`;
  return preview;
}
