import { assetUrl } from '../../assetUrl';
import { expandSnapshot } from '../../multiplayer/snapshotDelta';
import version from '../../generated/naval-version.json';
import { SnapshotSession, readSnapshot, type Snapshot } from './SnapshotSession';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { TeamId } from '../../multiplayer/generated/TeamId';
import type { Command } from '../../multiplayer/generated/Command';
import type { CombatIntent } from '../../simulation/combat';
import type { HelmCommand } from '../../simulation/ship';
import type { TimeOfDayId, WeatherId } from '../../maps/conditions';
export type JoinMode = 'queue' | 'create-invite' | 'join-invite';
export interface MatchMetadata {
  baseline: unknown;
  type: 'matched'; matchId: string; player: number; team: TeamId; connectionEpoch: number;
  version: typeof version; setup: BattleSetup; environment: { timeOfDay: TimeOfDayId; weather: WeatherId };
}
export interface LobbyStatus { message: string; inviteCode?: string; error?: string; }
const storageKey = 'naval-match-ticket-v1';
export function pendingTicket(): boolean { return !!sessionStorage.getItem(storageKey); }
const matchesVersion = (other: typeof version) => Object.entries(version).every(([key, value]) => other[key as keyof typeof version] === value);
/** Owns one tab's reconnect token. A replaced connection never reconnects and
 * takes control back from a newer socket. No token enters a URL or a log. */
export class MatchConnection {
  private socket?: WebSocket; private stopped = false; private timer?: ReturnType<typeof setTimeout>; private heartbeat?: ReturnType<typeof setInterval>;
  private disconnectedAt?: number; private generation = 0; private binary?: ArrayBuffer; private handshake?: ArrayBuffer; private decoding = false;
  private metadata?: MatchMetadata; private session?: RemoteBattleSession;
  private resolve!: (session: RemoteBattleSession) => void; private reject!: (error: Error) => void;
  readonly matched = new Promise<RemoteBattleSession>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  private constructor(private ticket: string, private status: (status: LobbyStatus) => void) { this.connect(); }
  static async join(fleet: string[], mode: JoinMode, inviteCode: string, status: (status: LobbyStatus) => void) {
    const response = await fetch(assetUrl('api/join'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet, mode, inviteCode: inviteCode || null, version }) });
    if (!response.ok) { const body = await response.text(); throw new Error(body || 'Unable to join battle.'); }
    const admission = await response.json() as { ticket: string; inviteCode?: string };
    sessionStorage.setItem(storageKey, admission.ticket);
    return new MatchConnection(admission.ticket, status);
  }
  static resume(status: (status: LobbyStatus) => void) {
    const ticket = sessionStorage.getItem(storageKey); if (!ticket) throw new Error('No battle to reconnect to.');
    return new MatchConnection(ticket, status);
  }
  private connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    const url = new URL(assetUrl('api/socket'), location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socket = new WebSocket(url); socket.binaryType = 'arraybuffer';
    this.binary = undefined; this.handshake = undefined;
    this.status({ message: this.disconnectedAt ? 'Reconnecting to battle…' : 'Connecting…' });
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.send({ type: 'hello', ticket: this.ticket, version });
      this.heartbeat = setInterval(() => this.send({ type: 'ping', nonce: Date.now() >>> 0 }), 5000);
    };
    socket.onmessage = event => {
      if (generation !== this.generation || this.stopped) return;
      if (event.data instanceof ArrayBuffer) { if (new Uint8Array(event.data)[0] === 0) this.handshake = event.data.slice(1); else this.binary = event.data; void this.decode(generation); return; }
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'error') { this.fail(message.message ?? message.code ?? 'Connection rejected.'); return; }
        if (message.type === 'queued') { this.disconnectedAt = undefined; this.status({ message: 'Waiting for an opponent', inviteCode: message.inviteCode }); }
        if (message.type === 'matched') this.acceptMetadata(message);
        if (message.type === 'ack' && this.session) this.session.commandAcknowledged(message.accepted, message.error);
      } catch (error) { this.fail(String(error)); }
    };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      clearInterval(this.heartbeat);
      if (this.stopped) return;
      // The final binary frame may still be decompressing. Its arrival stops retries.
      this.disconnectedAt ??= Date.now();
      if (Date.now() - this.disconnectedAt >= 90_000) { this.fail('Could not reconnect within 90 seconds.'); return; }
      if (this.session) this.session.connectionStatus = 'Reconnecting — the battle continues';
      this.timer = setTimeout(() => this.connect(), 1000);
    };
    socket.onerror = () => socket.close();
  }
  private acceptMetadata(message: MatchMetadata) {
          if (!matchesVersion(message.version)) { this.fail('Game content changed. Reload before joining.'); return; }
          if (this.metadata && (this.metadata.matchId !== message.matchId || this.metadata.team !== message.team)) { this.fail('Battle identity changed.'); return; }
          this.metadata = message; this.disconnectedAt = undefined;
          if (this.session) this.session.reconnected(message);
          this.status({ message: 'Loading both fleets…' });
  }
  private async decode(generation: number) {
    if (this.decoding) return;
    this.decoding = true;
    try {
      while ((this.handshake || this.binary) && !this.stopped) {
        const bytes = (this.handshake ?? this.binary)!; if (this.handshake) this.handshake = undefined; else this.binary = undefined;
        if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Battle snapshot exceeds limit.');
        const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('Expanded snapshot exceeds limit.'); } chunks.push(value); }
        const json = await new Blob(chunks as BlobPart[]).text();
        if (generation !== this.generation || this.stopped) break;
        const message = JSON.parse(json);
        if (message.type === 'matched') { this.acceptMetadata(message); continue; }
        if (!this.metadata) throw new Error('Snapshot arrived before battle metadata.');
        const frame = readSnapshot(expandSnapshot(this.metadata.baseline, message));
        if (!this.session) { this.session = new RemoteBattleSession(this.metadata, this, frame); this.resolve(this.session); }
        else this.session.receive(frame);
        if (frame.phase === 'finished' || frame.phase === 'cancelled') { sessionStorage.removeItem(storageKey); this.stopped = true; clearTimeout(this.timer); clearInterval(this.heartbeat); this.socket?.close(); }
      }
    } catch (error) { this.fail(String(error)); }
    finally { this.decoding = false; if ((this.handshake || this.binary) && !this.stopped) void this.decode(this.generation); }
  }
  send(message: object): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 64 * 1024) return false;
    this.socket.send(JSON.stringify(message)); return true;
  }
  private fail(message: string) {
    this.status({ message, error: message }); if (this.session) this.session.connectionFailed(message);
    this.reject(new Error(message)); this.close(true);
  }
  cancel() { if (!this.metadata) void fetch(assetUrl('api/cancel'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: this.ticket }), keepalive: true }).catch(() => {}); this.send({ type: this.metadata ? 'surrender' : 'cancel' }); this.close(true); this.reject(new Error('Battle cancelled.')); }
  close(forget = false) { this.stopped = true; clearInterval(this.heartbeat); clearTimeout(this.timer); this.socket?.close(); if (forget) sessionStorage.removeItem(storageKey); }
}
export class RemoteBattleSession extends SnapshotSession {
  readonly networked = true;
  private sequence = 0; private sentAt = 0; private ready = false;
  constructor(public metadata: MatchMetadata, private connection: MatchConnection, frame: Snapshot) {
    super(metadata.setup, metadata.team, metadata.player); this.apply(frame);
  }
  connectionFailed(message: string) { this.pending = undefined; this.connectionStatus = message; this.phase = 'cancelled'; }
  receive(frame: Snapshot) { if (frame.loaded?.[this.playerIndex] && this.connectionStatus === 'Restoring battle state…') this.connectionStatus = ''; if (frame.tick >= this.tick) this.pending = frame; }
  loadedAssets() { this.ready = true; this.connection.send({ type: 'ready', version }); }
  reconnected(metadata: MatchMetadata) { this.pending = undefined; this.metadata = metadata; this.sequence = 0; this.loaded = [...(this.loaded ?? [false, false])]; this.loaded[this.playerIndex] = false; this.connectionStatus = 'Restoring battle state…'; if (this.ready) this.loadedAssets(); }
  protected send(shipId: string, command: Command) {
    if (this.phase !== 'running' || !this.loaded?.[this.playerIndex]) return;
    this.connection.send({ type: 'command', envelope: { sequence: ++this.sequence, connectionEpoch: this.metadata.connectionEpoch, shipId, command } });
  }
  advance(dt: number, helm: HelmCommand, intent: CombatIntent, beforeStep?: () => void) {
    // Remote world time keeps moving while menus are open; held input expires.
    this.consume(dt || 1 / 60, beforeStep);
    const now = performance.now();
    if (now - this.sentAt >= 50) { this.input(helm, intent, dt > 0); this.sentAt = now; }
  }
  surrender() { if (this.phase === 'running' || this.phase === 'loading' || this.phase === 'countdown') this.connection.send({ type: 'surrender' }); this.connection.close(true); }
  dispose() { this.connection.close(); }
}
