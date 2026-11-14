import { reactive, readonly } from "vue";
import type {
  Item,
  Plot,
  Tick,
  Notice,
  CostLine,
} from "../../../shared/contracts";
import { crops, grow, ready } from "../lib/crops";

interface LedgerPorts {
  plant: (
    hour: number,
    plotId: number,
    item: Item,
    seedCost: number,
  ) => string;
  harvest: (args: {
    hour: number;
    plotId: number;
    plantingId: string;
    item: Item;
    round: number;
    quantity: number;
    quality: number;
    batchId: string;
    costs: readonly CostLine[];
  }) => void;
}

export function createFields(
  spend: (amount: number) => boolean,
  harvest: (
    item: Item,
    n: number,
    q: number,
    hour: number,
    source: string,
    costs: readonly CostLine[],
    extra: { plotId: number; plantingId: string },
  ) => string,
  ledger: LedgerPorts,
  notice: Notice,
) {
  const state = reactive({
    plots: Array.from({ length: 12 }, (_, id): Plot => ({ id, crop: null })),
    selected: "carrot" as Item,
  });
  return {
    state: readonly(state),
    select: (item: Item) => {
      state.selected = item;
    },
    plant(id: number, hour: number) {
      const plot = state.plots[id],
        seed = crops[state.selected];
      if (!plot || plot.crop || !seed) return;
      if (!spend(seed.cost)) {
        notice("资金不足，交付订单或出售库存后再试");
        return;
      }
      const plantingId = ledger.plant(hour, id, state.selected, seed.cost);
      plot.crop = {
        item: state.selected,
        planted: hour,
        growth: 0,
        water: 70,
        stress: 0,
        harvests: 0,
        plantingId,
        seedCost: seed.cost,
      };
      notice("种下了新的希望");
    },
    water(id: number) {
      const c = state.plots[id]?.crop;
      if (c) c.water = 100;
    },
    harvest(id: number, hour: number) {
      const plot = state.plots[id],
        crop = plot?.crop;
      if (!crop || !ready(crop) || !crop.plantingId) return;
      const def = crops[crop.item]!;
      const round = crop.harvests + 1;
      const quantity = def.yield;
      const quality = crop.stress <= 2 ? 2 : 1;
      // 可重复采收：播种成本由首轮实际收获承担，后续轮只分摊新增投入（当前无新增投入，记 0）
      const costs: CostLine[] =
        round === 1
          ? [
              {
                kind: "plant",
                ref: crop.plantingId,
                label: `田块${id + 1}播种成本（第1轮吸收）`,
                quantity,
                unitCost: def.cost / quantity,
                amount: def.cost,
              },
            ]
          : [
              {
                kind: "plant",
                ref: crop.plantingId,
                label: `田块${id + 1}第${round}轮新增投入`,
                quantity,
                unitCost: 0,
                amount: 0,
              },
            ];
      const source = `田块${id + 1} · 第${round}轮收获`;
      const batchId = harvest(
        crop.item,
        quantity,
        quality,
        hour,
        source,
        costs,
        { plotId: id, plantingId: crop.plantingId },
      );
      ledger.harvest({
        hour,
        plotId: id,
        plantingId: crop.plantingId,
        item: crop.item,
        round,
        quantity,
        quality,
        batchId,
        costs,
      });
      if (crop.harvests < def.repeat) {
        crop.growth = 0;
        crop.harvests++;
        // 首轮已吸收全部播种成本，后续轮在长成本归零
        if (round === 1) crop.seedCost = 0;
      } else plot.crop = null;
      notice("收获已按品质分批入仓");
    },
    tick(tick: Tick) {
      for (const plot of state.plots)
        if (plot.crop)
          plot.crop = grow(plot.crop, tick.weather, tick.to - tick.from);
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, JSON.parse(JSON.stringify(data)));
    },
  };
}
