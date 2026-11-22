import type { Game } from "../../../shared/types";
import { totals } from "../lib/totals";
import { openLines } from "../../../shared/orderlines";
import { releaseLineResources, syncLineStates } from "../../../shared/wip";
export function closeShift(g: Game) {
  g.running = false;
  g.ended = true;
  // 打烊时仍在制作的订单：释放资源并标记取消，账目不再追加
  for (const o of g.orders) {
    for (const l of openLines(o)) {
      releaseLineResources(g, o, l, "打烊清理");
      l.state = "cancelled";
    }
    if (o.status === "accepted" || o.status === "waiting") o.status = "left";
  }
  g.portions = [];
  g.dishes = [];
  g.stoves.forEach((s) => (s.portion = null));
  g.selectedOrder = null;
  g.selectedDish = null;
  syncLineStates(g);
  g.best = Math.max(g.best, totals(g).net);
  g.notice = "午市结束，辛苦了，主厨！";
}
export function saveBest(g: Game) {
  try {
    localStorage.setItem("lunch-rush-best", String(g.best));
  } catch {
    g.notice = "浏览器存储不可用，本局结算仍然有效";
  }
}
export function readBest() {
  try {
    const v = Number(localStorage.getItem("lunch-rush-best"));
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  } catch {
    return 0;
  }
}
