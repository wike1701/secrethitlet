// Efectos de sonido sintetizados con Web Audio (sin archivos). Si el navegador no tiene
// AudioContext (o estamos en Node, en las pruebas), todo esto no hace nada.

const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
let ctx = null;
let master = null;
let muted = (() => { try { return globalThis.localStorage?.getItem('sh-mute') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function toggleMute() {
  muted = !muted;
  try { globalThis.localStorage?.setItem('sh-mute', muted ? '1' : '0'); } catch {}
  return muted;
}

// Llamar desde un gesto del usuario (clic o tecla): los navegadores solo dejan sonar audio después de uno.
export function unlock() {
  if (!AC) return;
  try {
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

function env(g, t, peak, attack, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(freq, at, dur, { type = 'sine', gain = 0.3, attack = 0.01, slide, filter } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  env(g, t, gain, attack, dur);
  let node = o;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf = null;
function noise(at, dur, { gain = 0.3, type = 'lowpass', freq = 1000, q = 1, attack = 0.003 } = {}) {
  const t = ctx.currentTime + at;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, gain, attack, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const N = { C3: 130.81, D3: 146.83, F3: 174.61, Ab3: 207.65, A3: 220, Bb3: 233.08, C4: 261.63, Eb4: 311.13, E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };

const SOUNDS = {
  roleLiberal() {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.09, 1.4 - i * 0.09, { type: 'triangle', gain: 0.18 }));
  },
  roleFascist() {
    [N.A3, N.C4, N.E4].forEach((f, i) => tone(f, i * 0.12, 1.6, { type: 'sawtooth', gain: 0.12, filter: 900, attack: 0.05 }));
    tone(55, 0, 1.2, { gain: 0.35, slide: 45 });
  },
  roleHitler() {
    tone(73.4, 0, 2, { gain: 0.45, slide: 50 });
    noise(0, 0.6, { gain: 0.25, freq: 200 });
    [N.D3, N.F3, N.Ab3, N.C4 * 0.5 * 1.06].forEach((f, i) => tone(f, 0.15 + i * 0.1, 1.8, { type: 'sawtooth', gain: 0.1, filter: 700, attack: 0.08 }));
  },
  voteCall() {
    [0, 0.28].forEach((at) => { tone(N.A4 * 2, at, 0.9, { gain: 0.15 }); tone(N.A4 * 3, at, 0.6, { gain: 0.05 }); });
  },
  voteCast() {
    noise(0, 0.05, { gain: 0.3, type: 'bandpass', freq: 2500, q: 2 });
    tone(620, 0, 0.08, { type: 'square', gain: 0.06 });
  },
  votePass() {
    tone(N.G4, 0, 0.25, { type: 'triangle', gain: 0.2 });
    tone(N.C5, 0.18, 0.5, { type: 'triangle', gain: 0.22 });
  },
  voteFail() {
    tone(N.Eb4, 0, 0.3, { type: 'sawtooth', gain: 0.1, filter: 1200 });
    tone(N.Bb3, 0.22, 0.6, { type: 'sawtooth', gain: 0.12, filter: 900 });
  },
  chancellor() {
    [[N.G4, 0, 0.15], [N.C5, 0.13, 0.15], [N.E5, 0.26, 0.15], [N.G5, 0.39, 0.8]].forEach(([f, at, d]) => {
      tone(f, at, d, { type: 'square', gain: 0.07, filter: 2500 });
      tone(f, at, d, { type: 'triangle', gain: 0.12 });
    });
  },
  president() {
    tone(N.C3, 0, 1.6, { gain: 0.25 });
    tone(N.C4, 0, 1.4, { gain: 0.15 });
    tone(N.G4, 0.02, 1.2, { gain: 0.1 });
    tone(N.C5 * 1.5, 0.02, 0.6, { gain: 0.04 });
  },
  policyLiberal() {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.07, 0.5, { gain: 0.16 }));
    noise(0, 0.15, { gain: 0.12, type: 'bandpass', freq: 3000 });
  },
  policyFascist() {
    tone(90, 0, 0.6, { gain: 0.5, slide: 40 });
    noise(0, 0.25, { gain: 0.3, freq: 400 });
    tone(N.A3, 0.05, 1, { type: 'sawtooth', gain: 0.1, filter: 600 });
    tone(N.C4, 0.05, 1, { type: 'sawtooth', gain: 0.08, filter: 600 });
  },
  draw3() {
    [0, 0.16, 0.32].forEach((at) => noise(at, 0.13, { gain: 0.22, type: 'bandpass', freq: 3200, q: 0.8, attack: 0.02 }));
  },
  execute() {
    noise(0, 0.45, { gain: 0.9, freq: 1800, attack: 0.001 });
    tone(140, 0, 0.5, { gain: 0.6, slide: 35 });
    noise(0.05, 1.2, { gain: 0.08, freq: 500 });
  },
  victory() {
    [[N.C5, 0, 0.2], [N.E5, 0.18, 0.2], [N.G5, 0.36, 0.2], [N.C6, 0.54, 1.2]].forEach(([f, at, d]) => {
      tone(f, at, d, { type: 'triangle', gain: 0.2 });
      tone(f / 2, at, d, { type: 'sine', gain: 0.1 });
    });
  },
  defeat() {
    [[N.G4, 0, 0.45], [N.Eb4, 0.4, 0.45], [N.C4, 0.8, 1.4]].forEach(([f, at, d]) => {
      tone(f, at, d, { type: 'sawtooth', gain: 0.1, filter: 1000, attack: 0.04 });
    });
    tone(65, 0.8, 1.6, { gain: 0.3 });
  },
};

// Reproduce un sonido, opcionalmente con retraso en segundos.
export function play(name, delay = 0) {
  if (muted || !ctx || !SOUNDS[name]) return;
  const run = () => { try { if (ctx.state !== 'closed') SOUNDS[name](); } catch {} };
  if (delay > 0) setTimeout(run, delay * 1000); else run();
}

// Reproduce varios sonidos seguidos, separados `gap` segundos.
export function queue(names, gap = 0.7) {
  names.forEach((n, i) => play(n, i * gap));
}
