export class TtlCache<T> {
  private store = new Map<string, { expires: number; value: T }>();
  private inflight = new Map<string, Promise<T>>();

  constructor(private ttlMs: number, private clock: () => number = () => Date.now()) {}

  public get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (hit && hit.expires > this.clock()) {
      return hit.value;
    }
    return undefined;
  }

  public set(key: string, value: T): void {
    this.store.set(key, { expires: this.clock() + this.ttlMs, value });
  }

  public async wrap(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    const p = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  public clear(): void {
    this.store.clear();
  }
}
