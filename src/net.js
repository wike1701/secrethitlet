// Transporte P2P con PeerJS (WebRTC). El anfitrión registra un id fijo derivado del código de
// sala; los demás se conectan a él. Incluye latidos para detectar conexiones muertas y
// reconexión automática en el cliente.
import { PEER_OPTIONS } from './config.js';

const PREFIX = 'secrethitlet-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 5;
const PING_MS = 4000;
const TIMEOUT_MS = 15000;

export function makeCode() {
  const a = new Uint32Array(CODE_LEN);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
export const normalizeCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
export const isValidCode = (c) => c.length === CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch));

function PeerClass() {
  if (!globalThis.Peer) throw new Error('No se ha podido cargar PeerJS');
  return globalThis.Peer;
}

function safeSend(conn, msg) {
  try { conn.send(msg); } catch (e) { console.warn('No se pudo enviar', e); }
}

const NETWORK_ERRORS = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);

/**
 * Anfitrión. h: { onStatus(s), onData(connId, msg), onClose(connId), onFatal(texto) }
 * Estados: 'connecting' | 'online' | 'reconnecting'
 */
export function startHost(code, h) {
  const Peer = PeerClass();
  const conns = new Map(); // connId -> { conn, last }
  let peer = null;
  let destroyed = false;
  let idRetries = 0;

  function open() {
    h.onStatus('connecting');
    peer = new Peer(PREFIX + code, PEER_OPTIONS);
    peer.on('open', () => { idRetries = 0; h.onStatus('online'); });
    peer.on('connection', (conn) => {
      const id = conn.connectionId;
      conn.on('open', () => conns.set(id, { conn, last: Date.now() }));
      conn.on('data', (d) => {
        const c = conns.get(id);
        if (!c) return;
        c.last = Date.now();
        h.onData(id, d);
      });
      const gone = () => { if (conns.delete(id)) h.onClose(id); };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    peer.on('disconnected', () => {
      // Se perdió el servidor de señalización; las conexiones ya abiertas siguen vivas.
      if (destroyed || peer.destroyed) return;
      h.onStatus('reconnecting');
      setTimeout(() => { if (!destroyed && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
    });
    peer.on('error', (e) => {
      if (destroyed) return;
      if (e.type === 'unavailable-id') {
        // Tras recargar, el servidor puede tardar unos segundos en liberar el id anterior.
        if (idRetries++ < 10) {
          h.onStatus('reconnecting');
          peer.destroy();
          setTimeout(() => { if (!destroyed) open(); }, 3000);
        } else {
          h.onFatal('Ese código de sala ya está en uso. Crea una partida nueva.');
        }
        return;
      }
      if (e.type === 'browser-incompatible') return h.onFatal('Tu navegador no es compatible con WebRTC.');
      if (NETWORK_ERRORS.has(e.type)) return h.onStatus('reconnecting');
      console.warn('PeerJS', e.type, e);
    });
  }
  open();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, c] of conns) {
      if (now - c.last > TIMEOUT_MS) {
        conns.delete(id);
        try { c.conn.close(); } catch {}
        h.onClose(id);
      } else {
        safeSend(c.conn, { t: 'ping' });
      }
    }
    if (peer && !peer.destroyed && peer.open) h.onStatus('online');
  }, PING_MS);

  return {
    send(id, msg) { const c = conns.get(id); if (c) safeSend(c.conn, msg); },
    close(id) {
      const c = conns.get(id);
      if (!c) return;
      conns.delete(id);
      setTimeout(() => { try { c.conn.close(); } catch {} }, 500); // deja salir el último mensaje
    },
    destroy() { destroyed = true; clearInterval(timer); peer?.destroy(); },
  };
}

/**
 * Cliente. h: { onStatus(s), onOpen(), onData(msg), onFatal(texto) }
 * Estados: 'connecting' | 'online' | 'reconnecting' | 'notfound'
 */
export function joinHost(code, h) {
  const Peer = PeerClass();
  let peer = null;
  let conn = null;
  let destroyed = false;
  let retryTimer = null;
  let last = 0;
  let everConnected = false;

  function retry(delay = 2500) {
    if (destroyed || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
  }

  function down(status) {
    conn = null;
    h.onStatus(status ?? (everConnected ? 'reconnecting' : 'connecting'));
    retry();
  }

  function startPeer() {
    peer = new Peer(PEER_OPTIONS);
    peer.on('open', () => connect());
    peer.on('disconnected', () => {
      setTimeout(() => { if (!destroyed && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
    });
    peer.on('error', (e) => {
      if (destroyed) return;
      if (e.type === 'peer-unavailable') { conn = null; h.onStatus(everConnected ? 'reconnecting' : 'notfound'); return retry(4000); }
      if (e.type === 'browser-incompatible') return h.onFatal('Tu navegador no es compatible con WebRTC.');
      if (NETWORK_ERRORS.has(e.type)) { h.onStatus(everConnected ? 'reconnecting' : 'connecting'); return retry(4000); }
      console.warn('PeerJS', e.type, e);
    });
  }

  function connect() {
    if (destroyed) return;
    if (!peer || peer.destroyed) return startPeer();
    if (peer.disconnected) { peer.reconnect(); return retry(5000); }
    if (!peer.open) return retry(2000);
    try { conn?.close(); } catch {}
    const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn = c;
    const timeout = setTimeout(() => {
      if (conn === c && !c.open) { try { c.close(); } catch {} down(); }
    }, 12000);
    c.on('open', () => {
      clearTimeout(timeout);
      if (conn !== c) return;
      last = Date.now();
      everConnected = true;
      h.onStatus('online');
      h.onOpen();
    });
    c.on('data', (d) => {
      if (conn !== c) return;
      last = Date.now();
      if (d && d.t === 'ping') return;
      h.onData(d);
    });
    c.on('close', () => { if (conn === c) down(); });
    c.on('error', () => { if (conn === c) down(); });
  }

  startPeer();

  const timer = setInterval(() => {
    if (!conn?.open) return;
    if (Date.now() - last > TIMEOUT_MS) {
      const c = conn;
      conn = null;
      try { c.close(); } catch {}
      down();
    } else {
      safeSend(conn, { t: 'ping' });
    }
  }, PING_MS);

  return {
    send(msg) { if (conn?.open) safeSend(conn, msg); },
    destroy() { destroyed = true; clearInterval(timer); clearTimeout(retryTimer); peer?.destroy(); },
  };
}
