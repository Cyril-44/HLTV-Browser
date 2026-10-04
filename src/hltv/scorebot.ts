import { engine } from './engine';
import { ScoreFrame, LogItem } from './types';

const SCOREBOT_URL = 'https://scorebot-lb.hltv.org';

export interface ScorebotListener {
  onScore?: (frame: ScoreFrame) => void;
  onLog?: (items: LogItem[], reset: boolean) => void;
  onPlayerState?: (state: unknown) => void;
}

interface RawEvent {
  name: string;
  payload: unknown;
}

/**
 * Minimal Engine.IO v4 + Socket.IO client speaking the polling transport over
 * the browser engine (page-context fetch carries Cloudflare clearance).
 *
 * Wire protocol (observed on hltv.org):
 *   GET  /socket.io/?EIO=4&transport=polling&t=x      -> 0{"sid":...}
 *   POST /socket.io/?...&sid=<sid>  body "40"          -> 40{"sid":...}
 *   POST body 42["readyForScores","{\"token\":\"\",\"listIds\":[..]}"]
 *   POST body 42["readyForMatch","{\"token\":\"\",\"listId\":\"<id>\"}"]
 *   GET  long-poll -> engine.io packets (\x1e-separated); "2" means ping -> POST "3"
 */

/** Shared packet plumbing for one socket.io polling session. */
class PollingSession {
  protected sid: string | null = null;
  protected running = true;
  protected generation = 0;

  protected async handshake(): Promise<void> {
    const r = await engine.contextFetch(`${SCOREBOT_URL}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, undefined, 15000);
    if (r.status !== 200 || !r.body.startsWith('0')) {
      throw new Error(`scorebot handshake failed: ${r.status}`);
    }
    this.sid = (JSON.parse(r.body.slice(1)) as { sid: string }).sid;
  }

  protected async post(body: string): Promise<void> {
    if (!this.sid) {
      throw new Error('scorebot not connected');
    }
    const r = await engine.contextFetch(
      `${SCOREBOT_URL}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${this.sid}`,
      { method: 'POST', body },
      15000,
    );
    if (r.status !== 200) {
      throw new Error(`scorebot post failed: ${r.status}`);
    }
  }

  /** engine.io pings every ~25s, so a healthy long-poll returns within that window */
  protected async longPoll(): Promise<string> {
    if (!this.sid) {
      throw new Error('scorebot not connected');
    }
    const r = await engine.contextFetch(
      `${SCOREBOT_URL}/socket.io/?EIO=4&transport=polling&t=${Date.now()}&sid=${this.sid}`,
      undefined,
      30000,
    );
    if (r.status !== 200) {
      throw new Error(`scorebot poll failed: ${r.status}`);
    }
    return r.body;
  }

  protected stop(): void {
    this.running = false;
    this.generation++;
    this.sid = null;
  }
}

/** Scores-only shared client: many match ids, no log stream (tree views). */
class ScorebotClient extends PollingSession {
  public static debug = false;
  private scoreIds = new Set<number>();
  private listeners = new Map<number, Set<ScorebotListener>>();
  private latestScores = new Map<number, ScoreFrame>();

  public getLatestScore(matchId: number): ScoreFrame | undefined {
    return this.latestScores.get(matchId);
  }

  public subscribeScores(matchId: number, listener: ScorebotListener): void {
    let set = this.listeners.get(matchId);
    if (!set) {
      set = new Set();
      this.listeners.set(matchId, set);
    }
    set.add(listener);
    if (!this.scoreIds.has(matchId)) {
      this.scoreIds.add(matchId);
      this.resubscribe();
    }
    if (!this.running) {
      this.running = true;
      void this.loop(this.generation);
    }
  }

  public unsubscribe(matchId: number, listener: ScorebotListener): void {
    const set = this.listeners.get(matchId);
    if (!set) {
      return;
    }
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(matchId);
      if (this.scoreIds.has(matchId)) {
        this.scoreIds.delete(matchId);
        this.resubscribe();
      }
    }
  }

  private resubscribe(): void {
    if (this.sid) {
      void this.post(`42["readyForScores","${escapeJson(JSON.stringify({ token: '', listIds: [...this.scoreIds] }))}"]`).catch(() => {
        this.sid = null;
      });
    }
  }

  private async loop(gen: number): Promise<void> {
    let backoff = 2000;
    while (this.running && gen === this.generation) {
      try {
        if (!this.sid) {
          await this.handshake();
          await this.post('40');
          await this.post(`42["readyForScores","${escapeJson(JSON.stringify({ token: '', listIds: [...this.scoreIds] }))}"]`);
        }
        const body = await this.longPoll();
        backoff = 2000;
        for (const packet of splitPackets(body)) {
          await this.handlePacket(packet);
        }
      } catch {
        this.sid = null;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  private async handlePacket(packet: string): Promise<void> {
    if (packet === '2') {
      await this.post('3').catch(() => undefined);
      return;
    }
    if (!packet.startsWith('42')) {
      return;
    }
    const ev = parseSocketIoEvent(packet);
    if (ev?.name === 'score') {
      const frame = ev.payload as ScoreFrame;
      if (typeof frame?.listId !== 'number') {
        return;
      }
      this.latestScores.set(frame.listId, frame);
      for (const l of this.listeners.get(frame.listId) ?? []) {
        l.onScore?.(frame);
      }
    }
  }
}

/**
 * Dedicated session per open match detail page: its own socket, subscribed to
 * exactly one match (readyForScores + readyForMatch). Log and player-state
 * events therefore cannot leak between simultaneously open match pages.
 */
export class ScorebotMatchSession extends PollingSession {
  private listener: ScorebotListener;
  private freshSession = false;
  private recentLog: LogItem[] = [];

  public constructor(private matchId: number, listener: ScorebotListener) {
    super();
    this.listener = listener;
    void this.loop(this.generation);
  }

  /** Backlog received so far (used when the panel needs a re-render). */
  public getRecentLog(): LogItem[] {
    return this.recentLog;
  }

  public close(): void {
    this.stop();
  }

  private async loop(gen: number): Promise<void> {
    let backoff = 2000;
    while (this.running && gen === this.generation) {
      try {
        if (!this.sid) {
          await this.handshake();
          await this.post('40');
          const payload = escapeJson(JSON.stringify({ token: '', listIds: [this.matchId] }));
          await this.post(`42["readyForScores","${payload}"]`);
          const focus = escapeJson(JSON.stringify({ token: '', listId: String(this.matchId) }));
          await this.post(`42["readyForMatch","${focus}"]`);
          this.freshSession = true;
        }
        const body = await this.longPoll();
        let backoffReset = false;
        for (const packet of splitPackets(body)) {
          await this.handlePacket(packet);
          backoffReset = true;
        }
        if (backoffReset) {
          backoff = 2000;
        }
      } catch {
        this.sid = null;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  private async handlePacket(packet: string): Promise<void> {
    if (packet === '2') {
      await this.post('3').catch(() => undefined);
      return;
    }
    if (!packet.startsWith('42')) {
      return;
    }
    const ev = parseSocketIoEvent(packet);
    if (!ev) {
      return;
    }
    if (ev.name === 'score') {
      const frame = ev.payload as ScoreFrame;
      if (typeof frame?.listId === 'number' && frame.listId === this.matchId) {
        this.listener.onScore?.(frame);
      }
      return;
    }
    if (ev.name === 'log') {
      const payload = typeof ev.payload === 'string' ? safeJsonParse(ev.payload) : ev.payload;
      const items = (payload as { log?: LogItem[] })?.log;
      if (!Array.isArray(items)) {
        return;
      }
      const reset = this.freshSession;
      this.freshSession = false;
      this.recentLog = items.slice(-400);
      this.listener.onLog?.(items, reset);
      return;
    }
    // player-level live state (TERRORIST/CT arrays) — belongs to our match
    if (ev.payload && typeof ev.payload === 'object') {
      const p = ev.payload as Record<string, unknown>;
      if ('TERRORIST' in p || 'CT' in p || 'ctTeamName' in p) {
        this.listener.onPlayerState?.(p);
      }
    }
  }
}

function splitPackets(body: string): string[] {
  return body.split('\x1e').filter(Boolean);
}

function parseSocketIoEvent(packet: string): RawEvent | null {
  try {
    const parsed = JSON.parse(packet.slice(2)) as [string, unknown];
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      return { name: parsed[0], payload: parsed[1] };
    }
  } catch {
    return null;
  }
  return null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function escapeJson(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const scorebot = new ScorebotClient();
