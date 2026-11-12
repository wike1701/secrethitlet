// Sala del anfitrión: jugadores, reconexiones y reparto de vistas. No sabe nada de PeerJS:
// recibe mensajes con handle(connId, msg) y responde con las funciones send/close que le pasen.
import { createGame, act, viewFor, MIN_PLAYERS, MAX_PLAYERS } from './game.js';
import { botAction } from './bots.js';
import { AVATAR_IDS, isAvatar, defaultAvatar } from './avatars.js';

const NAME_MAX = 20;
const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
const HOST_COMMANDS = new Set(['start', 'newGame', 'toLobby', 'kick', 'addBot']);

export function randomId(len = 12) {
  const a = new Uint32Array(len);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => ID_CHARS[x % ID_CHARS.length]).join('');
}

export function cleanName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

const err = (message) => ({ t: 'error', message });

export class HostRoom {
  /**
   * @param {object} o
   * @param {string} o.code               código de la sala
   * @param {(connId, msg) => void} o.send
   * @param {(connId) => void} [o.close]  cierra una conexión
   * @param {(room) => void} [o.onChange] tras cada cambio (guardar y repintar)
   * @param {(msg) => void} [o.onHostMessage] mensajes para el jugador anfitrión
   * @param {string} [o.hostName]  @param {string} [o.hostToken]  @param {string} [o.hostAvatar]  @param {boolean} [o.dev]
   * @param {number} [o.seed]  solo tests: semillas reproducibles
   * @param {object} [saved]   resultado de serialize() para reanudar
   */
  constructor(o, saved = null) {
    this.sendFn = o.send;
    this.closeFn = o.close ?? (() => {});
    this.onChange = o.onChange ?? (() => {});
    this.onHostMessage = o.onHostMessage ?? (() => {});
    this.seed = o.seed;
    this.conns = new Map(); // connId -> playerId
    if (saved) {
      this.code = saved.code;
      this.dev = !!saved.dev;
      this.hostId = saved.hostId;
      this.game = saved.game;
      this.players = saved.players.map((p) => ({ ...p, avatar: isAvatar(p.avatar) ? p.avatar : defaultAvatar(p.id), connected: p.host || p.bot }));
    } else {
      this.code = o.code;
      this.dev = !!o.dev;
      this.players = [];
      this.game = null;
      this.hostId = this._addPlayer(o.hostName, o.hostToken, { host: true, avatar: o.hostAvatar }).id;
    }
  }

  serialize() {
    return {
      code: this.code,
      dev: this.dev,
      hostId: this.hostId,
      game: this.game,
      players: this.players.map(({ connected, ...p }) => p),
    };
  }

  // Mensaje de estado para un jugador: datos públicos de la sala + su vista privada de la partida.
  publicState(pid) {
    const inGame = this.game && this.game.players.some((p) => p.id === pid);
    return {
      t: 'state',
      room: {
        code: this.code,
        hostId: this.hostId,
        dev: this.dev,
        started: !!this.game,
        players: this.players.map(({ id, name, avatar, connected, bot, host }) => ({ id, name, avatar, connected, bot, host })),
      },
      game: inGame ? viewFor(this.game, pid) : null,
    };
  }

  handle(connId, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') return;
    if (msg.t === 'hello') return this._hello(connId, msg);
    const pid = this.conns.get(connId);
    if (!pid) return this.sendFn(connId, err('Primero tienes que unirte a la sala'));
    if (msg.t === 'act') return this.perform(pid, msg.action);
    if (msg.t === 'avatar') return this.setAvatar(pid, msg.avatar);
    if (msg.t === 'leave') return this._leave(pid, connId);
  }

  disconnect(connId) {
    const pid = this.conns.get(connId);
    if (!pid) return;
    this.conns.delete(connId);
    if ([...this.conns.values()].includes(pid)) return;
    const p = this._player(pid);
    if (p) p.connected = false;
    this._changed();
  }

  hostAct(action) {
    this.perform(this.hostId, action);
  }

  // Cambia el avatar de un jugador (se puede en la sala de espera y durante la partida).
  setAvatar(pid, avatar) {
    const p = this._player(pid);
    if (!p || !isAvatar(avatar)) return this._toPlayer(pid, err('Avatar no válido'));
    if (p.avatar === avatar) return;
    p.avatar = avatar;
    this._changed();
  }

  perform(pid, action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return this._toPlayer(pid, err('Acción no válida'));
    }
    if (HOST_COMMANDS.has(action.type)) {
      if (pid !== this.hostId) return this._toPlayer(pid, err('Solo el anfitrión puede hacer eso'));
      const e = this._command(action);
      if (e) return this._toPlayer(pid, err(e));
      return this._changed();
    }
    if (!this.game) return this._toPlayer(pid, err('La partida no ha empezado'));
    const r = act(this.game, pid, action);
    if (!r.ok) return this._toPlayer(pid, err(r.error));
    this._changed();
  }

  // Hace que un bot actúe (uno cada vez). Devuelve true si alguno ha actuado.
  stepBots() {
    if (!this.game || this.game.phase === 'gameover') return false;
    for (const p of this.players) {
      if (!p.bot) continue;
      const a = botAction(viewFor(this.game, p.id));
      if (a && act(this.game, p.id, a).ok) {
        this._changed();
        return true;
      }
    }
    return false;
  }

  // --- internos ---

  _player(id) {
    return this.players.find((p) => p.id === id);
  }

  _addPlayer(name, token, extra = {}) {
    const base = cleanName(name) || 'Jugador';
    let nm = base;
    for (let i = 2; this.players.some((p) => p.name.toLowerCase() === nm.toLowerCase()); i++) {
      nm = `${base.slice(0, NAME_MAX - 3)} ${i}`;
    }
    const p = { id: randomId(10), token: token ?? null, name: nm, connected: true, bot: false, host: false, ...extra };
    if (!isAvatar(p.avatar)) p.avatar = this._freeAvatar(p.id);
    this.players.push(p);
    return p;
  }

  // Primer avatar que nadie usa (o uno estable según el id si están todos cogidos).
  _freeAvatar(seed) {
    const used = new Set(this.players.map((p) => p.avatar));
    const start = AVATAR_IDS.indexOf(defaultAvatar(seed));
    for (let i = 0; i < AVATAR_IDS.length; i++) {
      const a = AVATAR_IDS[(start + i) % AVATAR_IDS.length];
      if (!used.has(a)) return a;
    }
    return defaultAvatar(seed);
  }

  _hello(connId, msg) {
    const token = typeof msg.token === 'string' && msg.token.length >= 8 && msg.token.length <= 64 ? msg.token : null;
    if (!token) return this._reject(connId, 'Datos de conexión no válidos');
    let p = this.players.find((x) => !x.host && !x.bot && x.token === token);
    if (p) {
      // Reconexión: se descarta la conexión antigua de ese jugador.
      for (const [c, id] of [...this.conns]) {
        if (id === p.id && c !== connId) { this.conns.delete(c); this.closeFn(c); }
      }
    } else {
      if (this.game) return this._reject(connId, 'La partida ya ha empezado');
      if (this.players.length >= MAX_PLAYERS) return this._reject(connId, 'La sala está llena');
      p = this._addPlayer(msg.name, token, { avatar: msg.avatar });
    }
    if (isAvatar(msg.avatar)) p.avatar = msg.avatar;
    p.connected = true;
    this.conns.set(connId, p.id);
    this.sendFn(connId, { t: 'welcome', you: p.id, code: this.code });
    this._changed();
  }

  _reject(connId, message) {
    this.sendFn(connId, { t: 'error', message, fatal: true });
    this.closeFn(connId);
  }

  _leave(pid, connId) {
    this.conns.delete(connId);
    this.closeFn(connId);
    if (!this.game) this.players = this.players.filter((p) => p.id !== pid);
    else { const p = this._player(pid); if (p) p.connected = false; }
    this._changed();
  }

  _remove(pid, reason) {
    for (const [c, id] of [...this.conns]) {
      if (id !== pid) continue;
      this.sendFn(c, { t: 'kicked', message: reason });
      this.conns.delete(c);
      this.closeFn(c);
    }
    this.players = this.players.filter((p) => p.id !== pid);
  }

  _command(a) {
    const running = this.game && this.game.phase !== 'gameover';
    switch (a.type) {
      case 'start':
      case 'newGame': {
        if (running) return 'La partida ya está en curso';
        const n = this.players.length;
        if (n < MIN_PLAYERS || n > MAX_PLAYERS) return `Hacen falta entre ${MIN_PLAYERS} y ${MAX_PLAYERS} jugadores (hay ${n})`;
        const opts = this.seed !== undefined ? { seed: this.seed++ } : {};
        this.game = createGame(this.players.map((p) => ({ id: p.id, name: p.name })), opts);
        return null;
      }
      case 'toLobby':
        if (running) return 'La partida está en curso';
        this.game = null;
        return null;
      case 'kick': {
        if (this.game) return 'Solo se puede expulsar desde la sala de espera';
        const p = this._player(a.target);
        if (!p || p.host) return 'Jugador no válido';
        this._remove(p.id, 'El anfitrión te ha sacado de la sala');
        return null;
      }
      case 'addBot': {
        if (!this.dev) return 'Los bots solo existen en modo desarrollo';
        if (this.game) return 'Solo se pueden añadir bots desde la sala de espera';
        if (this.players.length >= MAX_PLAYERS) return 'La sala está llena';
        const k = this.players.filter((p) => p.bot).length + 1;
        this._addPlayer(`Bot ${k}`, null, { bot: true });
        return null;
      }
      default:
        return 'Orden desconocida';
    }
  }

  _toPlayer(pid, msg) {
    if (pid === this.hostId) return this.onHostMessage(msg);
    for (const [c, id] of this.conns) if (id === pid) this.sendFn(c, msg);
  }

  _changed() {
    for (const [c, pid] of this.conns) this.sendFn(c, this.publicState(pid));
    this.onChange(this);
  }
}
