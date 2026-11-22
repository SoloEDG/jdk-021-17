<script setup lang="ts">
import type { Game, Command, RecipeId, SwapMode } from "../../../shared/types";
import { activeOrders, settledOrders } from "../lib/patience";
import OrderCard from "./OrderCard.vue";
defineProps<{ game: Game }>();
const emit = defineEmits<{ command: [cmd: Command] }>();
function onSwap(payload: {
  id: number;
  lineId: number;
  recipe: RecipeId;
  mode: SwapMode;
}) {
  emit("command", { type: "confirm-swap", ...payload });
}
</script>
<template>
  <section class="orders-section">
    <div class="section-heading">
      <div>
        <span class="eyebrow">01 / FRONT OF HOUSE</span>
        <h2>
          今日订单 <span class="count">{{ activeOrders(game).length }}</span>
        </h2>
      </div>
      <span class="muted">
        接单后可逐道上菜 · 每桌可换一次菜 · 每 18 秒迎来新客
      </span>
    </div>
    <div class="tickets">
      <OrderCard
        v-for="o in activeOrders(game)"
        :key="o.id"
        :order="o"
        :game="game"
        @accept="(id) => emit('command', { type: 'accept', id })"
        @select="(id) => emit('command', { type: 'select-order', id })"
        @swap="onSwap"
        @cancel="(id) => emit('command', { type: 'cancel-lines', id })"
      />
      <div v-if="!activeOrders(game).length" class="empty">
        餐厅暂时安静，整理一下厨房吧。
      </div>
    </div>
    <div v-if="settledOrders(game).length" class="settled">
      <span class="eyebrow">已结账单（每道制作与付款状态）</span>
      <div class="settled-list">
        <OrderCard
          v-for="o in settledOrders(game)"
          :key="o.id"
          :order="o"
          :game="game"
          @accept="() => {}"
          @select="() => {}"
          @swap="() => {}"
          @cancel="() => {}"
        />
      </div>
    </div>
  </section>
</template>
