// Prueba de extremo a extremo: la interfaz real del anfitrión (ui.js) con un DOM mínimo,
// dos clientes que se conectan con net.js y bots, todo sobre un PeerJS simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakePeer } from './fake-peer.js';
import { botAction } from '../src/bots.js';

const realSetTimeout = globalThis.setTimeout;
const tick = (ms = 2) => new Promise((r) => realSetTimeout(r, ms));
const mkStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

const handlers = {};
const app = { innerHTML: '', addEventListener: (t, f) => { handlers[t] = f; } };
Object.assign(globalThis, {
  Peer: FakePeer,
  document: { getElementById: (id) => (id === 'app' ? app : null), activeElement: null },
  location: { search: '?dev', origin: 'http://localhost:8080', pathname: '/', hostname: 'localhost' },
  history: { replaceState() {} },
  localStorage: mkStorage(),
  sessionStorage: mkStorage(),
  confirm: () => true,
});
// Acelera los temporizadores de la interfaz (bots, avisos) para que la prueba sea rápida.
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms ?? 0, 3), ...a);

const html = () => app.innerHTML;
function click(a, data = {}) {
  const el = { dataset: { a, ...data }, disabled: false };
  handlers.click({ target: { closest: () => el } });
}
const attrs = (name, a) => [...html().matchAll(new RegExp(`data-a="${a}"[^>]*data-${name}="([^"]*)"`, 'g'))].map((m) => m[1]);
const has = (a) => html().includes(`data-a="${a}"`);

test('partidas completas jugadas desde la interfaz del anfitrión', async () => {
  const { joinHost } = await import('../src/net.js');
  await import('../src/ui.js');
  assert.match(html(), /Crear partida nueva/);

  handlers.input({ target: { id: 'name', value: 'Ana' } });
  click('create');
  await tick(5);
  assert.match(html(), /Anfitrión · en línea/);
  const code = html().match(/class="bigcode">([A-Z0-9]{5})</)[1];

  // Dos clientes reales (net.js) que juegan con la lógica de bot sobre su vista.
  const clients = ['<b>Beto</b>', 'Carla'].map((name, i) => {
    const c = { name, last: null, errors: [] };
    c.net = joinHost(code, {
      onStatus: () => {},
      onOpen: () => c.net.send({ t: 'hello', name, token: 'token-cliente-' + i }),
      onData: (m) => { if (m.t === 'state') c.last = m; if (m.t === 'error') c.errors.push(m.message); },
      onFatal: (m) => c.errors.push(m),
    });
    return c;
  });
  await tick(10);
  assert.match(html(), /Jugadores \(3\/10\)/);
  assert.ok(html().includes('&lt;b&gt;Beto&lt;/b&gt;'), 'los nombres se escapan');
  assert.ok(!html().includes('<b>Beto</b>'));

  for (let i = 0; i < 3; i++) click('addBot');
  assert.match(html(), /Jugadores \(6\/10\)/);

  for (let game = 0; game < 3; game++) {
    click(game === 0 ? 'start' : 'newGame');
    await tick(5);
    assert.match(html(), /Leyes liberales/);
    assert.match(html(), /Ver mi rol en secreto/, 'cada partida empieza con el rol oculto');
    assert.ok(!/tag role-/.test(html()), 'con el rol oculto no se ve ningún rol en la lista');
    click('toggleRole');
    assert.match(html(), /Tu rol secreto/);

    let steps = 0;
    while (!html().includes('Ganan los')) {
      assert.ok(++steps < 4000, 'la partida no termina');
      if (has('vote')) click('vote', { v: Math.random() < 0.7 ? '1' : '0' });
      else if (has('select')) {
        const vals = attrs('v', 'select');
        click('select', { v: vals[Math.floor(Math.random() * vals.length)] });
        assert.ok(!/data-a="confirm"[^>]*disabled/.test(html()), 'el botón de confirmar se activa');
        click('confirm', { kind: attrs('kind', 'confirm')[0] });
      } else if (has('vetoResp')) click('vetoResp', { v: Math.random() < 0.5 ? '1' : '0' });
      else if (has('ack')) click('ack');
      for (const c of clients) {
        const a = botAction(c.last?.game);
        if (a) c.net.send({ t: 'act', action: a });
      }
      await tick(1);
    }
    assert.match(html(), /Has ganado|Has perdido/);
    assert.match(html(), /Otra partida/);
    for (const c of clients) {
      assert.deepEqual(c.errors, [], `errores del cliente ${c.name}`);
      assert.equal(c.last.game.phase, 'gameover');
    }
  }

  click('toLobby');
  assert.match(html(), /Invita a la gente/);
  const saved = JSON.parse(localStorage.getItem('sh-host'));
  assert.equal(saved.code, code, 'la partida del anfitrión se guarda para reanudarla');
  click('leave');
  assert.match(html(), /Crear partida nueva/);
  assert.equal(localStorage.getItem('sh-host'), null);
  for (const c of clients) c.net.destroy();
});
