const key = "meadow-post-v1";
export function saveFarm(data: unknown) {
  localStorage.setItem(key, JSON.stringify({ version: 2, data }));
}
export function loadFarm<T>(): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { version: number; data: T };
  // v1 旧存档仍可读入，由 workspace 做期初迁移（余额作期初、旧货成本未知）
  if ((parsed.version !== 1 && parsed.version !== 2) || !parsed.data)
    throw new Error("存档版本不支持");
  return parsed.data;
}
