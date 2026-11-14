import { ref } from "vue";
import { createClock, createEngine } from "../features/clock";
import { createFields } from "../features/fields";
import { createWarehouse } from "../features/warehouse";
import { createWorkshop } from "../features/workshop";
import { createOrders, salePrice } from "../features/orders";
import { createLedger } from "../features/ledger";
import { items } from "../shared/catalog";
import { saveFarm, loadFarm } from "./persistence";
import type { Batch } from "../shared/contracts";

export function createWorkspace() {
  const notices = ref<string[]>(["欢迎回到青禾农场。先备一份胡萝卜订单吧。"]);
  const notice = (message: string) => {
    notices.value = [message, ...notices.value].slice(0, 12);
  };
  const clock = createClock();
  const ledger = createLedger();
  const warehouse = createWarehouse(() => clock.state.hour, notice);
  const orders = createOrders(
    warehouse,
    {
      delivery: (args) => ledger.delivery(args),
    },
    notice,
    clock.state.hour,
  );
  const fields = createFields(
    orders.spend,
    (item, n, q, hour, source, costs, extra) =>
      warehouse.add(item, n, q, hour, source, costs, {
        plotId: extra.plotId,
        plantingId: extra.plantingId,
      }),
    {
      plant: (hour, plotId, item, seedCost) =>
        ledger.plant(hour, plotId, item, seedCost),
      harvest: (args) => ledger.harvest(args),
    },
    notice,
  );
  const workshop = createWorkshop(
    { ...warehouse, spend: orders.spend },
    {
      enqueue: (args) => ledger.processingEnqueue(args),
      consume: (entryId, lines) => ledger.processingConsume(entryId, lines),
      claim: (entryId, outputs) => ledger.processingClaim(entryId, outputs),
      fail: (entryId, at) => ledger.processingFail(entryId, at),
      feeLoss: (hour, jobId, fee) => ledger.feeLoss(hour, jobId, fee),
    },
    notice,
  );

  // 库存腐坏 -> 台账损失（保留来源批次，即使该批货物已耗尽也可在流水里查看）
  warehouse.onSpoil((report) => {
    ledger.spoilage({ hour: clock.state.hour, ...report });
  });

  const engine = createEngine(
    () => clock.state.hour,
    clock.setHour,
    (t) => {
      warehouse.tick(t.to);
      fields.tick(t);
      workshop.tick(t.to);
      orders.tick(t.to);
    },
  );

  /** 期初建账：新游戏的初始现金与旧货（成本未知，金额按 0 并单列） */
  const seedOpening = () => {
    warehouse.addLegacy("carrot", 8, 2, "期初存货 · 胡萝卜");
    warehouse.addLegacy("berry", 6, 2, "期初存货 · 蓝莓");
    warehouse.addLegacy("corn", 8, 1, "期初存货 · 玉米");
    ledger.opening(
      clock.state.hour,
      orders.state.coins,
      0,
      0,
      "新农场期初余额（初始存货成本未知，按 0 计）",
    );
  };
  seedOpening();

  /** 旧存档迁移：旧余额作为期初现金，旧货成本注明未知 */
  const migrateLegacy = (data: Record<string, any>) => {
    const unknownBatches: Batch[] = (data.warehouse?.batches ?? []).filter(
      (b: Batch) => b.unitCost === undefined,
    );
    const unknownQty = unknownBatches.reduce((n, b) => n + b.quantity, 0);
    ledger.opening(
      data.clock?.hour ?? clock.state.hour,
      data.orders?.coins ?? orders.state.coins,
      0,
      0,
      `旧存档迁移：期初现金 ¥${data.orders?.coins ?? 0}，${unknownQty} 份旧货成本未知`,
    );
  };

  const snapshot = () => ({
    version: 2,
    clock: clock.snapshot(),
    warehouse: warehouse.snapshot(),
    fields: fields.snapshot(),
    workshop: workshop.snapshot(),
    orders: orders.snapshot(),
    ledger: ledger.snapshot(),
  });

  return {
    clock,
    warehouse,
    fields,
    workshop,
    orders,
    ledger,
    engine,
    notices,
    sell(id: string) {
      const sold = warehouse.sell(id, 1);
      if (!sold) return;
      const revenue = salePrice(items[sold.item].value);
      orders.earn(revenue);
      ledger.sale({
        hour: clock.state.hour,
        item: sold.item,
        quantity: sold.quantity,
        revenue,
        costs: sold.costs,
        unitCost: sold.unitCost,
        batchIds: [sold.batchId],
        unknown: sold.unknown,
      });
      notice(`出售${items[sold.item].name} 1 份 · 收入 ¥${revenue} · 成本 ¥${sold.cost}`);
    },
    save() {
      try {
        saveFarm(snapshot());
        notice("已保存到本机");
      } catch {
        notice("保存失败，本机空间不足");
      }
    },
    load() {
      try {
        const data = loadFarm<Record<string, any>>();
        if (!data) {
          notice("还没有本机存档");
          return;
        }
        const payload = (data as any).data ?? data;
        clock.restore(payload.clock);
        warehouse.restore(payload.warehouse);
        fields.restore(payload.fields);
        workshop.restore(payload.workshop);
        orders.restore(payload.orders);
        // 读档先清空新游戏期初，避免与存档余额重复累计
        ledger.reset();
        if (payload.ledger) {
          ledger.restore(payload.ledger);
        } else {
          // v1 旧存档：余额作为期初，旧货成本未知
          migrateLegacy(payload);
        }
        notice("已恢复保存时刻");
      } catch {
        notice("存档损坏，无法恢复");
      }
    },
  };
}
