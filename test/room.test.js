import test from 'node:test';
import assert from 'node:assert/strict';
import { HostRoom } from '../src/room.js';
import { botAction } from '../src/bots.js';
import { isAvatar } from '../src/avatars.js';

function setup({ dev = true, seed = 1 } = {}) {
  const inbox = new Map();
  const closed = new Set();
  const hostMsgs = [];
  const opts = {
    code: 'ABCDE',
    hostName: 'Ana',
    hostToken: 'host-token-123',
    dev,
    seed,
    send: (c, m) => { if (!inbox.has(c)) inbox.set(c, []); inbox.get(c).push(m); },
    close: (c) => closed.add(c),
    onHostMessage: (m) => hostMsgs.push(m),
  };
  const env = { inbox, closed, hostMsgs, opts, room: new HostRoom(opts) };
  env.msgs = (c) => inbox.get(c) ?? [];
  env.last = (c) => [...env.msgs(c)].reverse().find((m) => m.t === 'state');
  env.errors = (c) => env.msgs(c).filter((m) => m.t === 'error');
  env.join = (c, name, token) => env.room.handle(c, { t: 'hello', name, token });
  return env;
}

test('unirse asigna id, evita nombres repetidos y envía el estado a todos', () => {
  const e = setup();
  e.join('c1', 'Beto', 'token-beto-1');
  e.join('c2', 'beto', 'token-beto-2');
  assert.equal(e.msgs('c1')[0].t, 'welcome');
  const names = e.last('c1').room.players.map((p) => p.name);
  assert.deepEqual(names, ['Ana', 'Beto', 'beto 2']);
  assert.equal(e.last('c2').room.players.length, 3);
});

test('rechaza tokens inválidos, salas llenas y entradas con la partida empezada', () => {
  const e = setup();
  e.join('x', 'Pepe', 'corto');
  assert.ok(e.msgs('x')[0].fatal);
  for (let i = 0; i < 9; i++) e.join('c' + i, 'J' + i, 'token-jugador-' + i);
  e.join('c9', 'Extra', 'token-extra-1');
  assert.equal(e.msgs('c9')[0].message, 'La sala está llena');
  e.room.hostAct({ type: 'start' });
  e.join('tarde', 'Tarde', 'token-tarde-1');
  assert.equal(e.msgs('tarde')[0].message, 'La partida ya ha empezado');
});

test('reconectar con el mismo token recupera al mismo jugador, incluso en partida', () => {
  const e = setup();
  for (let i = 0; i < 4; i++) e.join('c' + i, 'J' + i, 'token-jugador-' + i);
  const id = e.msgs('c1')[0].you;
  e.room.hostAct({ type: 'start' });
  e.room.disconnect('c1');
  assert.equal(e.last('c0').room.players.find((p) => p.id === id).connected, false);
  e.join('c1b', 'Otro nombre', 'token-jugador-1');
  assert.equal(e.msgs('c1b')[0].you, id);
  assert.ok(e.last('c1b').game, 'recibe su vista de la partida');
  assert.equal(e.last('c0').room.players.find((p) => p.id === id).connected, true);
});

test('solo el anfitrión puede empezar y expulsar', () => {
  const e = setup();
  for (let i = 0; i < 4; i++) e.join('c' + i, 'J' + i, 'token-jugador-' + i);
  e.room.handle('c0', { t: 'act', action: { type: 'start' } });
  assert.equal(e.errors('c0').at(-1).message, 'Solo el anfitrión puede hacer eso');
  assert.equal(e.room.game, null);
  const victim = e.msgs('c3')[0].you;
  e.room.hostAct({ type: 'kick', target: victim });
  assert.ok(e.msgs('c3').some((m) => m.t === 'kicked'));
  assert.ok(e.closed.has('c3'));
  assert.equal(e.room.players.length, 4);
  e.room.hostAct({ type: 'start' });
  assert.equal(e.hostMsgs.at(-1).message, 'Hacen falta entre 5 y 10 jugadores (hay 4)');
});

test('los bots solo existen en modo desarrollo', () => {
  const e = setup({ dev: false });
  e.room.hostAct({ type: 'addBot' });
  assert.equal(e.room.players.length, 1);
  assert.match(e.hostMsgs.at(-1).message, /desarrollo/);
});

test('ninguna vista enviada filtra roles ni cartas ajenas', () => {
  const e = setup({ seed: 7 });
  for (let i = 0; i < 6; i++) e.join('c' + i, 'J' + i, 'token-jugador-' + i);
  e.room.hostAct({ type: 'start' });
  const roles = Object.fromEntries(e.room.game.players.map((p) => [p.id, p.role]));
  for (let i = 0; i < 6; i++) {
    const v = e.last('c' + i).game;
    const mine = roles[v.me];
    const seen = v.players.filter((p) => p.role !== null);
    if (mine === 'liberal' || mine === 'hitler') assert.equal(seen.length, 1);
    else assert.equal(seen.length, 3);
    for (const p of seen) assert.equal(p.role, roles[p.id]);
  }
});

test('partidas completas con humanos y bots, guardando y reanudando a mitad', () => {
  for (let g = 0; g < 60; g++) {
    let e = setup({ seed: 100 + g });
    const humans = ['c1', 'c2'];
    e.join('c1', 'Beto', 'token-beto-1');
    e.join('c2', 'Carla', 'token-carla-1');
    const bots = 3 + (g % 6); // de 6 a 10 jugadores en total (contando bots)
    for (let i = 0; i < Math.min(bots, 7); i++) e.room.hostAct({ type: 'addBot' });
    e.room.hostAct({ type: 'start' });
    assert.ok(e.room.game, 'la partida ha empezado');
    let steps = 0;
    while (e.room.game.phase !== 'gameover') {
      assert.ok(++steps < 6000, `partida ${g} no termina`);
      let acted = false;
      const hv = e.room.publicState(e.room.hostId).game;
      const ha = botAction(hv);
      if (ha) { e.room.hostAct(ha); acted = true; }
      for (const c of humans) {
        const a = botAction(e.last(c).game);
        if (a) { e.room.handle(c, { t: 'act', action: a }); acted = true; }
      }
      if (e.room.stepBots()) acted = true;
      assert.ok(acted, `partida ${g}: bloqueada en la fase ${e.room.game.phase}`);
      if (steps === 40) {
        // El anfitrión recarga la página: se reconstruye la sala y los clientes vuelven.
        const saved = JSON.parse(JSON.stringify(e.room.serialize()));
        e.room = new HostRoom(e.opts, saved);
        assert.equal(e.room.players.find((p) => p.id !== e.room.hostId && !p.bot).connected, false);
        e.join('c1', 'Beto', 'token-beto-1');
        e.join('c2', 'Carla', 'token-carla-1');
      }
    }
    assert.equal(e.hostMsgs.filter((m) => m.t === 'error').length, 0, `errores del anfitrión: ${JSON.stringify(e.hostMsgs)}`);
    for (const c of humans) assert.equal(e.errors(c).length, 0, `errores de ${c}: ${JSON.stringify(e.errors(c))}`);
    // Tras la partida: otra con los mismos jugadores, o volver a la sala.
    e.room.hostAct({ type: 'newGame' });
    assert.equal(e.room.game.phase, 'nominate');
  }
});

test('avatares: se respeta el elegido, se corrige el inválido y se puede cambiar', () => {
  const e = setup();
  e.join('c1', 'Beto', 'token-beto-1');
  e.room.handle('c2', { t: 'hello', name: 'Carla', token: 'token-carla-1', avatar: 'detective' });
  e.room.handle('c3', { t: 'hello', name: 'Dani', token: 'token-dani-1', avatar: '<script>' });
  const byName = (n) => e.last('c1').room.players.find((p) => p.name === n);
  assert.equal(byName('Carla').avatar, 'detective');
  assert.ok(isAvatar(byName('Dani').avatar), 'un avatar inválido se sustituye por uno válido');
  assert.ok(isAvatar(byName('Ana').avatar) && isAvatar(byName('Beto').avatar));
  e.room.handle('c1', { t: 'avatar', avatar: 'poeta' });
  assert.equal(byName('Beto').avatar, 'poeta');
  e.room.handle('c1', { t: 'avatar', avatar: 'no-existe' });
  assert.equal(byName('Beto').avatar, 'poeta');
  assert.equal(e.errors('c1').at(-1).message, 'Avatar no válido');
  // Al reconectar con otro avatar elegido, se actualiza.
  e.room.disconnect('c2');
  e.room.handle('c2b', { t: 'hello', name: 'Carla', token: 'token-carla-1', avatar: 'actriz' });
  assert.equal(byName('Carla').avatar, 'actriz');
});

test('los bots reciben avatares distintos y las partidas guardadas sin avatar se reparan', () => {
  const e = setup();
  for (let i = 0; i < 9; i++) e.room.hostAct({ type: 'addBot' });
  const avatars = e.room.players.map((p) => p.avatar);
  assert.equal(new Set(avatars).size, avatars.length, 'nadie repite avatar mientras queden libres');
  const saved = JSON.parse(JSON.stringify(e.room.serialize()));
  for (const p of saved.players) delete p.avatar;
  const r2 = new HostRoom(e.opts, saved);
  assert.ok(r2.players.every((p) => isAvatar(p.avatar)));
});
