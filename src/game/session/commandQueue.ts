import type { Command } from '../../multiplayer/generated/Command';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';

export interface OrderReceipt {
  sequence: number;
  shipId: string;
  command: Command['type'];
  state: 'queued' | 'sent' | 'accepted' | 'rejected' | 'superseded';
  message?: string;
}
const movement = new Set<Command['type']>(['move', 'route', 'hold', 'hold-area', 'escort', 'autonomous']);
function replacementKey(command: Command): string | undefined {
  if (command.type === 'route' && command.append) return;
  if (movement.has(command.type)) return 'movement';
    if (command.type === 'focus' || command.type === 'weapons' || command.type === 'formation-policy' || command.type === 'input') return command.type;
}

/** Local tactical-pause outbox. Nothing changes simulation state before Rust
 * admits the command on resume. Receipts retain superseded and rejected intent. */
export class CommandQueue {
  readonly receipts: OrderReceipt[] = [];
  private pending: CommandEnvelope[] = [];
  // Keep queued/in-flight receipts alive even when display history rotates out.
  private outstanding = new Map<number, OrderReceipt>();
  private sequence = 0;
  constructor(readonly capacity = 128) {}
  get length(): number { return this.pending.length; }
  enqueue(shipId: string, command: Command): boolean {
    const key = replacementKey(command);
    // A replacement move supersedes an entire queued route including appends.
    const replaced = key ? this.pending.filter(c => c.shipId === shipId
      && (replacementKey(c.command) === key || (key === 'movement' && c.command.type === 'route'))) : [];
    if (this.pending.length - replaced.length >= this.capacity) {
      this.record({ sequence: ++this.sequence, shipId, command: command.type, state: 'rejected', message: 'Order queue full. Resume to process orders.' });
      return false;
    }
    for (const old of replaced) this.acknowledge(old.sequence, 'superseded', 'Replaced by a later order.');
    this.pending = this.pending.filter(c => !replaced.includes(c));
    const envelope = { sequence: ++this.sequence, connectionEpoch: 1, shipId, command };
    this.pending.push(envelope);
    if (command.type !== 'input') this.record({ sequence: envelope.sequence, shipId, command: command.type, state: 'queued' });
    return true;
  }
  drain(): CommandEnvelope[] {
    const commands = this.pending.splice(0);
    for (const command of commands) this.acknowledge(command.sequence, 'sent');
    return commands;
  }
  acknowledge(sequence: number, state: OrderReceipt['state'], message?: string): void {
    const receipt = this.outstanding.get(sequence) ?? this.receipts.find(r => r.sequence === sequence);
    if (receipt) { receipt.state = state; receipt.message = message; }
    if (state !== 'queued' && state !== 'sent') this.outstanding.delete(sequence);
  }
  clear(): void {
    for (const sequence of this.outstanding.keys()) this.acknowledge(sequence, 'superseded', 'Session orders cleared.');
    this.pending.length = 0; this.receipts.length = 0;
  }
  private record(receipt: OrderReceipt): void {
    if (receipt.state === 'queued') this.outstanding.set(receipt.sequence, receipt);
    this.receipts.push(receipt);
    if (this.receipts.length > 48) this.receipts.shift();
  }
}
