<script setup lang="ts">
import type { Game } from "../../../shared/types";
import { totals } from "../lib/totals";
defineProps<{ game: Game }>();
const t = totals;
</script>
<template>
  <section class="ledger">
    <div>
      <span class="eyebrow">05 / TODAY'S TAKINGS</span>
      <h2>营业手账</h2>
    </div>
    <div class="ledger-stat">
      <small>营业收入（含小费/退款）</small><b>¥{{ t(game).revenue }}</b>
    </div>
    <div class="ledger-stat">
      <small>采购 / 作废 / 超时</small><b class="red">−¥{{ t(game).cost }}</b>
    </div>
    <div class="ledger-stat">
      <small>已上菜品 / 离店客数</small
      ><b
        >{{ game.served }} <span class="muted">/ {{ game.missed }}</span></b
      >
    </div>
    <div class="ledger-stat">
      <small>历史最佳</small><b>¥{{ game.best }}</b>
    </div>
    <div class="receipt">
      <div v-for="e in game.entries.slice(-4).reverse()" :key="e.id">
        <span>{{ e.label }}</span
        ><b :class="{ red: e.amount < 0 }">{{
          e.amount >= 0 ? "+" : ""
        }}{{ e.amount }}</b>
      </div>
      <span v-if="!game.entries.length" class="muted"
        >第一笔收入，马上就来。</span
      >
    </div>
  </section>
</template>
