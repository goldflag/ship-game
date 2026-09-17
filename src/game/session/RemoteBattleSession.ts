import { loadShipPresets } from '../../ships/presets';
import { bindSessionShips, releaseSessionShips } from '../../ships/sessionShips';
import { currentAccount, onAccountChange } from '../../accounts/session';
import { localShip, isHistoricalShip, type LocalShipRevision } from '../../ships/localShips';
import { savedReference } from '../../ships/constructionCloud';
import type { FleetReference } from '../../multiplayer/generated/FleetReference';
import { assetUrl } from '../../assetUrl';
import { decodeFrameUpdate } from './frameDelta';
import version from '../../generated/naval-version.json';
import { SnapshotSession, type Snapshot } from './SnapshotSession';
import { readSnapshot } from './snapshotCodec';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { TeamId } from '../../multiplayer/generated/TeamId';
import type { Command } from '../../multiplayer/generated/Command';
import type { CombatIntent } from '../../simulation/combat';
import type { HelmCommand } from '../../simulation/ship';
import type { TimeOfDayId, WeatherId } from '../../maps/conditions';
export type JoinMode = 'queue' | 'create-invite' | 'join-invite';
export interface MatchMetadata {
  /** The immutable match baseline: every update is a patch against it, so a
   * slow connection may skip any of them. Normalized by the Rust codec. */
  baseline: Snapshot;
  contentHash: string;
  type: 'matched'; matchId: string; player: number; team: TeamId; connectionEpoch: number;
  version: typeof version; setup: BattleSetup; environment: { timeOfDay: TimeOfDayId; weather: WeatherId };
}
export interface LobbyStatus { message: string; inviteCode?: string; error?: string; }
const storageKey = () => 'naval-match-ticket-v1' + (currentAccount() ? ':' + currentAccount() : '');
const connections = new Set<MatchConnection>();
onAccountChange(() => { connections.forEach(c => c.close()); connections.clear(); });
export function pendingTicket(): boolean { return !!sessionStorage.getItem(storageKey()); }
const matchesVersion = (other: typeof version) => Object.entries(version).every(([key, value]) => other[key as keyof typeof version] === value);
/** Owns one tab's reconnect token. A replaced connection never reconnects and
 * takes control back from a newer socket. No token enters a URL or a log. */
export class MatchConnection {
  private socket?: WebSocket; private stopped = false; private timer?: ReturnType<typeof setTimeout>; private heartbeat?: ReturnType<typeof setInterval>;
  private disconnectedAt?: number; private generation = 0; private binary?: ArrayBuffer; private handshake?: ArrayBuffer; private decoding = false;
  private constructions = new Map<string,LocalShipRevision>();
  private metadata?: MatchMetadata; private session?: RemoteBattleSession;
  private resolve!: (session: RemoteBattleSession) => void; private reject!: (error: Error) => void;
  readonly matched = new Promise<RemoteBattleSession>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  private constructor(private ticket: string, private status: (status: LobbyStatus) => void) { connections.add(this); this.connect(); }
  static async join(fleet: string[], mode: JoinMode, inviteCode: string, status: (status: LobbyStatus) => void) {
    const references: FleetReference[] = fleet.map(id => {
      if (isHistoricalShip(id)) return {kind:'historical',presetId:id};
      const ship=localShip(id), reference=ship && savedReference(ship.source.id);
      if (!ship || !reference || reference.sourceRevision!==ship.source.revision) throw new Error('Save this ship to your account before joining.');
      return {kind:'custom',designId:reference.designId,revisionId:reference.revisionId};
    });
    const response = await fetch(assetUrl('api/join'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fleet:references, mode, inviteCode: inviteCode || null, version }) });
    if (!response.ok) { const body = await response.text(); throw new Error(body || 'Unable to join battle.'); }
    const admission = await response.json() as { ticket: string; inviteCode?: string };
    sessionStorage.setItem(storageKey(), admission.ticket);
    return new MatchConnection(admission.ticket, status);
  }
  static resume(status: (status: LobbyStatus) => void) {
    const ticket = sessionStorage.getItem(storageKey()); if (!ticket) throw new Error('No battle to reconnect to.');
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
        if (message.type === 'matched') void this.acceptMetadata(message).catch(error=>this.fail(String(error)));
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
  private async acceptMetadata(message: MatchMetadata) {
          if (!this.metadata || this.metadata.contentHash!==message.contentHash) {
            const response=await fetch(assetUrl('api/match-content'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:this.ticket}),cache:'no-store'});
            if(!response.ok) throw new Error('Unable to load the selected fleet content.');
            const bytes=await response.arrayBuffer();
            if(bytes.byteLength>128*1024*1024) throw new Error('Match content exceeds limit.');
            const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
            if(hash!==message.contentHash) throw new Error('Match content hash mismatch.');
            const payload=JSON.parse(new TextDecoder().decode(bytes));
            const constructions=new Map<string,LocalShipRevision>();
            for(const artifact of payload.artifacts) {
              const {source,result}=artifact, definition=result.definition;
              if(!definition?.id.startsWith('local-') || definition.contentHash!==result.contentHash || result.sourceId!==source.id || result.revision!==source.revision) throw new Error('Invalid construction artifact');
              constructions.set(definition.id,{source,result,definition});
            }
            for(const ship of message.setup.ships) if(!isHistoricalShip(ship.presetId)&&!constructions.has(ship.presetId)) throw new Error('Missing match ship content');
            if(this.stopped) return;
            this.constructions=constructions;
          }
          if (!matchesVersion(message.version)) { this.fail('Game content changed. Reload before joining.'); return; }
          readSnapshot(message.baseline);
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
        if (message.type === 'matched') { await this.acceptMetadata(message); continue; }
        if (!this.metadata) throw new Error('Snapshot arrived before battle metadata.');
        const frame = decodeFrameUpdate(this.metadata.baseline, message);
        if (!this.session) await loadShipPresets(this.metadata.setup.ships.map(s => s.presetId));
        if (generation !== this.generation || this.stopped) break;
        if (!this.session) { this.session = new RemoteBattleSession(this.metadata, this, frame, this.constructions); this.resolve(this.session); }
        else this.session.receive(frame);
        if (frame.phase === 'finished' || frame.phase === 'cancelled') { sessionStorage.removeItem(storageKey()); this.stopped = true; clearTimeout(this.timer); clearInterval(this.heartbeat); this.socket?.close(); }
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
  close(forget = false) { connections.delete(this); this.stopped = true; clearInterval(this.heartbeat); clearTimeout(this.timer); this.socket?.close(); if (forget) sessionStorage.removeItem(storageKey()); }
}
export class RemoteBattleSession extends SnapshotSession {
  readonly networked = true;
  private sequence = 0; private sentAt = 0; private ready = false;
  constructor(public metadata: MatchMetadata, private connection: MatchConnection, frame: Snapshot, readonly constructionShips: ReadonlyMap<string,LocalShipRevision> = new Map()) {
    super(metadata.setup, metadata.team, metadata.player, new Map([...constructionShips].map(([id,ship])=>[id,ship.definition]))); bindSessionShips(this,constructionShips); this.apply(frame);
  }
  connectionFailed(message: string) { this.pending = undefined; this.connectionStatus = message; this.phase = 'cancelled'; }
  receive(frame: Snapshot) { if (frame.loaded?.[this.playerIndex] && this.connectionStatus === 'Restoring battle state…') this.connectionStatus = ''; if (frame.tick >= this.tick) this.pending = frame; }
  loadedAssets() { this.ready = true; this.connection.send({ type: 'ready', version, contentHash:this.metadata.contentHash }); }
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
  dispose() { this.connection.close(); releaseSessionShips(this); }
}
