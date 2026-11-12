// Detecta qué acaba de pasar comparando dos vistas de la partida (la anterior y la nueva).
// Es lógica pura: la interfaz la usa para decidir sonidos y animaciones.

const isFresh = (g) => !g.lastVote && g.liberal + g.fascist === 0 && g.tracker === 0 && g.players.every((p) => p.alive);

// Devuelve una lista ordenada de eventos { type, ... }.
export function detectEvents(prev, next) {
  if (!next) return [];
  const ev = [];
  const over = next.phase === 'gameover';
  if (!prev || prev.phase === 'gameover') {
    // Partida nueva. Si entramos a mitad (reconexión o reanudar), no anunciamos nada viejo.
    if (!over && isFresh(next)) ev.push({ type: 'president', id: next.presidentId, first: true });
    return ev;
  }

  if (next.phase === 'vote' && prev.phase !== 'vote') ev.push({ type: 'voteCall' });

  const voteEnded = prev.phase === 'vote' && next.phase !== 'vote' && next.lastVote;
  if (voteEnded) {
    ev.push({ type: 'voteResult', passed: next.lastVote.passed });
    if (next.lastVote.passed && next.chancellorId) ev.push({ type: 'chancellor', id: next.chancellorId });
  }

  if (next.phase === 'presidentDiscard' && prev.phase !== 'presidentDiscard') ev.push({ type: 'draw3' });

  const chaos = prev.phase === 'vote' || prev.phase === 'vetoDecision';
  if (next.liberal > prev.liberal) ev.push({ type: 'policy', side: 'liberal', chaos });
  if (next.fascist > prev.fascist) ev.push({ type: 'policy', side: 'fascist', chaos });

  if (next.phase === 'powerAck' && prev.phase !== 'powerAck' && next.powerTrack[next.fascist - 1] === 'peek') {
    ev.push({ type: 'draw3', peek: true });
  }

  const wasAlive = new Set(prev.players.filter((p) => p.alive).map((p) => p.id));
  for (const p of next.players) if (!p.alive && wasAlive.has(p.id)) ev.push({ type: 'execute', id: p.id });

  if (over) {
    const me = next.players.find((p) => p.id === next.me);
    const won = next.winner === 'liberal' ? me?.role === 'liberal' : me?.role !== 'liberal';
    ev.push({ type: 'gameover', winner: next.winner, won });
  } else if (next.presidentId !== prev.presidentId) {
    ev.push({ type: 'president', id: next.presidentId });
  }
  return ev;
}
