<script setup lang="ts">
import { computed, ref } from "vue";
import type { Order, Game, RecipeId, SwapMode, OrderLine } from "../../../shared/types";
import { recipes, recipeList } from "../../../shared/catalog";
import { patience } from "../lib/patience";
import { previewSwap, SWAP_PATIENCE_COST } from "../index";
import { openLines, paidLines } from "../../../shared/orderlines";
const props = defineProps<{ order: Order; game: Game }>();
const emit = defineEmits<{
  accept: [id: number];
  select: [id: number];
  swap: [
    payload: { id: number; lineId: number; recipe: RecipeId; mode: SwapMode },
  ];
  cancel: [id: number];
}>();
const swappingLine = ref<number | null>(null);
const targetRecipe = ref<RecipeId>("steak");
const mode = ref<SwapMode>("redo");
const STATE_LABEL: Record<OrderLine["state"], string> = {
  pending: "待备料",
  prepping: "已备料",
  cooking: "烹饪中",
  ready: "待上桌",
  served: "已上",
  cancelled: "已取消",
};
function startSwap(l: OrderLine) {
  swappingLine.value = l.id;
  targetRecipe.value = recipeList.find((r) => r.id !== l.recipe)!.id;
  mode.value = "redo";
}
function closeSwap() {
  swappingLine.value = null;
}
const preview = computed(() => {
  if (swappingLine.value == null) return null;
  return previewSwap(
    props.game,
    props.order.id,
    swappingLine.value,
    targetRecipe.value,
    mode.value,
  );
});
function confirm() {
  if (swappingLine.value == null || !preview.value?.ok) return;
  emit("swap", {
    id: props.order.id,
    lineId: swappingLine.value,
    recipe: targetRecipe.value,
    mode: mode.value,
  });
  swappingLine.value = null;
}
const openCount = computed(() => openLines(props.order).length);
const paidCount = computed(() => paidLines(props.order).length);
</script>
<template>
  <article
    class="ticket"
    :class="{
      selected: game.selectedOrder === order.id,
      urgent: patience(game, order) < 0.25,
      done: order.status === 'served' || order.status === 'left',
    }"
  >
    <div class="ticket-top">
      <b>#{{ String(order.id).padStart(3, "0") }}</b>
      <span v-if="order.status === 'accepted' || order.status === 'waiting'">
        {{ Math.max(0, Math.ceil(order.deadline - game.time)) }}s
      </span>
      <span v-else class="muted">
        {{ order.status === "served" ? "已完成" : "已离店" }}
      </span>
    </div>
    <div class="ticket-guest">
      {{ order.guest }}
      <i v-if="order.swapped" title="已换过一次菜">换</i>
      <i v-if="order.legacy" title="旧版单菜订单迁移">旧</i>
    </div>
    <ul class="line-list">
      <li
        v-for="l in order.lines"
        :key="l.id"
        class="line-row"
        :class="['st-' + l.state, { credit: l.credit }]"
      >
        <span class="line-icon">{{ recipes[l.recipe].icon }}</span>
        <div class="line-info">
          <b>
            {{ recipes[l.recipe].name }}
            <em v-if="l.credit">抵价</em>
          </b>
          <small>
            {{ STATE_LABEL[l.state] }} ·
            <template v-if="l.paid">已付 ¥{{ l.paidAmount }}</template>
            <template v-else>¥{{ recipes[l.recipe].price }}</template>
          </small>
        </div>
        <button
          v-if="
            order.status === 'accepted' &&
            !order.swapped &&
            ['pending', 'prepping', 'cooking', 'ready'].includes(l.state)
          "
          class="tiny soft swap-btn"
          @click="startSwap(l)"
        >
          换菜
        </button>
      </li>
    </ul>
    <div v-if="order.status === 'accepted' || order.status === 'waiting'" class="patience">
      <i :style="{ width: patience(game, order) * 100 + '%' }"></i>
    </div>
    <div v-if="order.satisfaction !== undefined" class="muted satisfaction">
      满意度 {{ order.satisfaction }} 分 · 已付 {{ paidCount }} 道
    </div>

    <!-- 换菜确认面板：先展示费用与剩余耐心，确认后才生效 -->
    <div v-if="swappingLine !== null && preview" class="swap-panel">
      <div class="swap-title">顾客临时换菜 <small>每桌仅一次</small></div>
      <label class="swap-field">
        换成
        <select v-model="targetRecipe">
          <option
            v-for="r in recipeList.filter(
              (r) =>
                r.id !==
                order.lines.find((x) => x.id === swappingLine)?.recipe,
            )"
            :key="r.id"
            :value="r.id"
          >
            {{ r.icon }} {{ r.name }}
          </option>
        </select>
      </label>
      <div class="swap-modes">
        <button
          class="tiny"
          :class="{ active: mode === 'redo' }"
          @click="mode = 'redo'"
        >
          作废重做
        </button>
        <button
          class="tiny"
          :class="{ active: mode === 'credit' }"
          @click="mode = 'credit'"
        >
          继续制作抵价
        </button>
      </div>
      <p v-if="!preview.ok" class="swap-error">{{ preview.reason }}</p>
      <template v-else>
        <p class="swap-detail">{{ preview.detail }}</p>
        <ul class="swap-math">
          <li>
            制作阶段
            <b>{{
              { pending: "未备料", prepping: "已备料", cooking: "已下锅", ready: "已起锅", served: "", cancelled: "" }[preview.stage]
            }}</b>
          </li>
          <li>
            本次费用
            <b :class="{ red: preview.fee > 0 }">
              {{ preview.fee > 0 ? "−¥" + preview.fee : "¥0" }}
            </b>
          </li>
          <li v-if="preview.creditAmount > 0">
            抵价金额
            <b>+¥{{ preview.creditAmount }}</b>
          </li>
          <li>
            耐心扣减
            <b class="red">−{{ SWAP_PATIENCE_COST }}s</b>
          </li>
          <li>
            确认后剩余
            <b :class="{ red: preview.patienceAfter < 10 }">
              {{ Math.max(0, Math.ceil(preview.patienceAfter)) }}s
            </b>
          </li>
        </ul>
      </template>
      <div class="swap-actions">
        <button class="tiny soft" @click="closeSwap">再想想</button>
        <button class="tiny" :disabled="!preview.ok" @click="confirm">
          确认换菜
        </button>
      </div>
    </div>

    <div v-if="order.status === 'waiting'" class="ticket-actions">
      <button @click="emit('accept', order.id)">接单</button>
    </div>
    <div v-else-if="order.status === 'accepted'" class="ticket-actions">
      <button class="soft" @click="emit('select', order.id)">
        {{ game.selectedOrder === order.id ? "已选为上菜目标" : "选择上菜目标" }}
      </button>
      <button
        v-if="openCount > 0"
        class="soft cancel-btn"
        @click="emit('cancel', order.id)"
      >
        取消剩余 {{ openCount }} 道
      </button>
    </div>
  </article>
</template>
