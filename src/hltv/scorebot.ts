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
 * Wire protocol (observed on hltv.org, 2026-09):
 *   GET  /socket.io/?EIO=4&transport=polling&t=x      -> 0{"sid":...}
 *   POST /socket.io/?...&sid=<sid>  body "40"          -> 40{"sid":...}
 *   POST body 42["readyForScores","{\"token\":\"\",\"listIds\":[..]}"]
 *   POST body 42["readyForMatch","{\"token\":\"\",\"listId\":\"<id>\"}"]
 *   GET  long-poll -> engine.io packets (\x1e-separated); "2" means ping -> POST "3"
 */
export class ScorebotClient {
  public static debug = false;
  private sid: string | null = null;
  private running = false;
  private generation = 0;
  private scoreIds = new Set<number>();
  private focusMatch: number | null = null;
  private listeners = new Map<number, Set<ScorebotListener>>();
  private latestScores = new Map<number, ScoreFrame>();
  private recentLog: LogItem[] = [];
  private freshSession = false;

  public getLatestScore(matchId: number): ScoreFrame | undefined {
    return this.latestScores.get(matchId);
  }

  public getRecentLog(): LogItem[] {
    return this.recentLog;
  }

  public subscribeScores(matchId: number, listener: ScorebotListener): void {
    this.addListener(matchId, listener);
    if (!this.scoreIds.has(matchId)) {
      this.scoreIds.add(matchId);
      this.reconnect(false);
    }
  }

  public subscribeMatch(matchId: number, listener: ScorebotListener): void {
    this.addListener(matchId, listener);
    if (this.focusMatch !== matchId) {
      this.focusMatch = matchId;
      this.reconnect(false);
    }
    if (!this.scoreIds.has(matchId)) {
      this.scoreIds.add(matchId);
      this.reconnect(false);
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
      if (this.scoreIds.has(matchId) && !this.hasLocalInterest(matchId)) {
        this.scoreIds.delete(matchId);
        if (this.focusMatch === matchId) {
          this.focusMatch = null;
        }
        this.reconnect(false);
      }
    }
  }

  private hasLocalInterest(matchId: number): boolean {
    return this.listeners.has(matchId);
  }

  private addListener(matchId: number, listener: ScorebotListener): void {
    let set = this.listeners.get(matchId);
    if (!set) {
      set = new Set();
      this.listeners.set(matchId, set);
    }
    set.add(listener);
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (!this.running) {
      this.reconnect(true);
    }
  }

  private reconnect(full: boolean): void {
    if (full) {
      this.running = true;
      void this.loop(this.generation);
    } else if (this.running && this.sid) {
      // subscription set changed mid-session; send the new list on the live socket
      void this.sendSubscriptions();
    }
  }

  private async loop(gen: number): Promise<void> {
    let backoff = 2000;
    while (this.running && gen === this.generation) {
      try {
        if (!this.sid) {
          await this.handshake();
          await this.post('40');
          await this.sendSubscriptions();
          this.freshSession = true;
        }
        const body = await this.longPoll();
        backoff = 2000;
        if (ScorebotClient.debug) {
          console.log(`[scorebot] poll: ${body.slice(0, 160)}`);
        }
        for (const packet of splitPackets(body)) {
          await this.handlePacket(packet);
        }
      } catch (e) {
        if (ScorebotClient.debug) {
          console.log(`[scorebot] loop error: ${String(e).split('\n')[0]}`);
        }
        this.sid = null;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  private onConnected(): void {
    // replay the freshest known scores to a brand-new listener set is not
    // possible server-side; listeners read latestScores on attach instead.
  }

  private async handshake(): Promise<void> {
    const r = await engine.contextFetch(`${SCOREBOT_URL}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, undefined, 15000);
    if (r.status !== 200 || !r.body.startsWith('0')) {
      throw new Error(`scorebot handshake failed: ${r.status}`);
    }
    const info = JSON.parse(r.body.slice(1)) as { sid: string };
    this.sid = info.sid;
  }

  private async post(body: string): Promise<void> {
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

  private async longPoll(): Promise<string> {
    if (!this.sid) {
      throw new Error('scorebot not connected');
    }
    // engine.io pings every ~25s, so a healthy long-poll returns within that window
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

  private async sendSubscriptions(): Promise<void> {
    if (!this.sid || (!this.scoreIds.size && this.focusMatch === null)) {
      return;
    }
    const ids = [...this.scoreIds];
    if (ids.length) {
      await this.post(`42["readyForScores","${escapeJson(JSON.stringify({ token: '', listIds: ids }))}"]`);
    }
    if (this.focusMatch !== null) {
      await this.post(`42["readyForMatch","${escapeJson(JSON.stringify({ token: '', listId: String(this.focusMatch) }))}"]`);
    }
  }

  private async handlePacket(packet: string): Promise<void> {
    if (packet === '2') {
      await this.post('3');
      return;
    }
    if (packet.startsWith('40') || packet.startsWith('0')) {
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
      if (typeof frame?.listId !== 'number') {
        return;
      }
      this.latestScores.set(frame.listId, frame);
      for (const l of this.listeners.get(frame.listId) ?? []) {
        l.onScore?.(frame);
      }
      return;
    }
    if (ev.name === 'log') {
      const payload = typeof ev.payload === 'string' ? safeJsonParse(ev.payload) : ev.payload;
      const items = (payload as { log?: LogItem[] })?.log;
      if (!Array.isArray(items)) {
        return;
      }
      // A fresh session replays the full history — signal a reset so the UI
      // replaces its log view instead of duplicating it.
      const reset = this.freshSession;
      this.freshSession = false;
      this.recentLog = items.slice(-200);
      if (this.focusMatch !== null) {
        for (const l of this.listeners.get(this.focusMatch) ?? []) {
          l.onLog?.(items, reset);
        }
      }
      return;
    }
    // Player-level live state (TERRORIST/CT arrays) arrives on other event
    // names; forward anything shaped like a match state to the focused match.
    if (this.focusMatch !== null && ev.payload && typeof ev.payload === 'object') {
      const p = ev.payload as Record<string, unknown>;
      if ('TERRORIST' in p || 'CT' in p || 'ctTeamName' in p) {
        for (const l of this.listeners.get(this.focusMatch) ?? []) {
          l.onPlayerState?.(p);
        }
      }
    }
  }

  public shutdown(): void {
    this.running = false;
    this.generation++;
    this.sid = null;
    this.listeners.clear();
    this.scoreIds.clear();
    this.focusMatch = null;
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
