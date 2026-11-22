import { reactive, onUnmounted } from "vue";
import { createGame } from "../shared/initial";
import { normalizeGame } from "../shared/orderlines";
import { expire, arrive } from "../features/orders";
import { closeShift, saveBest, readBest } from "../features/ledger";
export function useSession() {
  const game = reactive(normalizeGame(createGame(readBest())));
  let last = performance.now(),
    carry = 0;
  const timer = setInterval(() => {
    const now = performance.now(),
      dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!game.running) return;
    carry += dt;
    while (carry >= 0.1 && game.running) {
      carry -= 0.1;
      game.time = Math.min(
        game.duration,
        Math.round((game.time + 0.1) * 10) / 10,
      );
      expire(game);
      if (Math.round(game.time * 10) % 180 === 0) arrive(game);
      if (game.time >= game.duration) {
        closeShift(game);
        saveBest(game);
      }
    }
  }, 50);
  onUnmounted(() => clearInterval(timer));
  function toggle() {
    if (game.ended) return;
    carry = 0;
    last = performance.now();
    game.running = !game.running;
    game.notice = game.running
      ? "营业中，客人已经入座。"
      : "已暂停，所有厨房计时冻结。";
  }
  function restart() {
    const fresh = normalizeGame(createGame(game.best));
    // 逐字段替换，保证嵌套的 lines/portions 等响应式结构一并刷新
    for (const key of Object.keys(fresh) as (keyof typeof fresh)[]) {
      // @ts-expect-error 泛型键赋值在严格模式下无法联合校验
      game[key] = fresh[key];
    }
    carry = 0;
    last = performance.now();
  }
  return { game, toggle, restart };
}
