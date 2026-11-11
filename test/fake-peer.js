// Imitación en memoria de PeerJS para probar net.js y la interfaz sin red real.
const peers = new Map();
let seq = 0;

class Emitter {
  constructor() { this._h = {}; }
  on(e, f) { (this._h[e] ??= []).push(f); return this; }
  emit(e, ...a) { for (const f of this._h[e] ?? []) f(...a); }
}

class FakeConn extends Emitter {
  constructor(peerId, opts) {
    super();
    this.peer = peerId;
    this.connectionId = 'dc_' + ++seq;
    this.open = false;
    this.other = null;
    this.serialization = opts?.serialization;
  }
  send(m) {
    if (!this.open) throw new Error('conexión cerrada');
    const data = JSON.parse(JSON.stringify(m)); // como con serialization: 'json'
    const o = this.other;
    queueMicrotask(() => { if (o.open) o.emit('data', data); });
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
    const o = this.other;
    if (o?.open) { o.open = false; queueMicrotask(() => o.emit('close')); }
  }
}

export class FakePeer extends Emitter {
  constructor(id, opts) {
    super();
    if (typeof id !== 'string') id = 'anon-' + ++seq;
    this.id = id;
    this.open = false;
    this.destroyed = false;
    this.disconnected = false;
    queueMicrotask(() => {
      if (peers.has(id)) {
        const e = new Error('id ocupado');
        e.type = 'unavailable-id';
        return this.emit('error', e);
      }
      peers.set(id, this);
      this.open = true;
      this.emit('open', id);
    });
  }
  connect(id, opts) {
    const local = new FakeConn(id, opts);
    queueMicrotask(() => {
      const target = peers.get(id);
      if (!target || target.destroyed) {
        const e = new Error('no existe');
        e.type = 'peer-unavailable';
        return this.emit('error', e);
      }
      const remote = new FakeConn(this.id, opts);
      remote.connectionId = local.connectionId;
      local.other = remote;
      remote.other = local;
      target.emit('connection', remote);
      queueMicrotask(() => {
        local.open = remote.open = true;
        remote.emit('open');
        local.emit('open');
      });
    });
    return local;
  }
  reconnect() { this.disconnected = false; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    if (peers.get(this.id) === this) peers.delete(this.id);
  }
}
