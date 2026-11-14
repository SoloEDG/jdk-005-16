<script setup lang="ts">
import { levelFor, progressFor } from "../lib/economy";
import { fmt } from "../../../shared/money";
defineProps<{
  coins: number;
  xp: number;
  delivered: number;
  realizedProfit: number;
  inventoryCost: number;
}>();
</script>
<template>
  <div class="economy">
    <div>
      <small>农场资金</small><strong>◈ {{ coins }} <em>G</em></strong>
    </div>
    <div>
      <small>已实现利润</small
      ><strong :class="{ neg: realizedProfit < 0 }"
        >¥{{ fmt(realizedProfit) }}</strong
      >
    </div>
    <div>
      <small>库存资产</small><strong>¥{{ fmt(inventoryCost) }}</strong>
    </div>
    <div>
      <small>经营等级</small><strong>Lv.{{ levelFor(xp) }}</strong
      ><progress :value="progressFor(xp)" max="100"></progress>
    </div>
    <div>
      <small>累计交付</small><strong>{{ delivered }} <em>单</em></strong>
    </div>
  </div>
</template>
