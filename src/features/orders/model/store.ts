import { reactive, readonly } from "vue";
import type { Item, Order, Notice, Receipt } from "../../../shared/contracts";
import { initialOrders, nextOrder } from "../lib/offers";
interface Ports {
  reserve: (
    owner: string,
    item: Item,
    n: number,
    minQuality?: number,
  ) => string | null;
  consume: (id: string) => Receipt | null;
  release: (id: string) => void;
}
interface LedgerPorts {
  delivery: (args: {
    hour: number;
    orderId: string;
    item: Item;
    quantity: number;
    revenue: number;
    lines: Receipt["lines"];
  }) => void;
}
export function createOrders(
  ports: Ports,
  ledger: LedgerPorts,
  notice: Notice,
  hour: number,
) {
  const state = reactive({
    coins: 180,
    xp: 0,
    delivered: 0,
    serial: 3,
    orders: initialOrders(hour),
  });
  const spend = (n: number) => {
    if (n < 0 || state.coins < n) return false;
    state.coins -= n;
    return true;
  };
  return {
    state: readonly(state),
    spend,
    earn: (n: number) => {
      state.coins += n;
    },
    reserve(id: string) {
      const o = state.orders.find((o) => o.id === id);
      if (!o || o.status !== "open") return;
      const reservation = ports.reserve(
        `order:${id}`,
        o.item,
        o.quantity,
        o.minQuality,
      );
      if (!reservation) {
        notice("可用库存不足，先收获或加工");
        return;
      }
      o.reservation = reservation;
      o.status = "reserved";
      notice("订单已备货，库存已占用");
    },
    deliver(id: string, hour: number) {
      const o = state.orders.find((o) => o.id === id);
      if (!o || o.status !== "reserved" || !o.reservation) return;
      const receipt = ports.consume(o.reservation);
      if (!receipt) {
        ports.release(o.reservation);
        o.status = "open";
        delete o.reservation;
        notice("货物已失效，无法交付");
        return;
      }
      o.status = "delivered";
      state.coins += o.reward;
      // 按真实消耗的份额结转成本，关联合同与输入批次
      ledger.delivery({
        hour,
        orderId: o.id,
        item: o.item,
        quantity: o.quantity,
        revenue: o.reward,
        lines: receipt.lines,
      });
      state.xp += 40 + (receipt.quality > 1 ? 10 : 0);
      state.delivered++;
      state.orders.push(nextOrder(++state.serial, hour));
      notice(
        `交付成功，收入 ¥${o.reward} / 成本 ¥${receipt.cost} / +${40 + (receipt.quality > 1 ? 10 : 0)} 经验`,
      );
    },
    cancel(id: string) {
      const o = state.orders.find((o) => o.id === id);
      if (o?.status === "reserved" && o.reservation) {
        ports.release(o.reservation);
        o.status = "open";
        delete o.reservation;
      }
    },
    tick(hour: number) {
      for (const o of state.orders)
        if (
          (o.status === "open" || o.status === "reserved") &&
          o.deadline <= hour
        ) {
          if (o.reservation) ports.release(o.reservation);
          o.status = "expired";
        }
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, JSON.parse(JSON.stringify(data)));
    },
  };
}
