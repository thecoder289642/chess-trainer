import { Chess } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import { parse as parsePgn } from '@mliebelt/pgn-parser';
import { OPENINGS } from './openings.js';
import { Engine } from './engine.js';
import { LESSONS } from './lessons.js';
import { buildTrees, fetchChessCom, fetchLichess, gamesFromPgnText, guessPgnPlayer } from './games.js';

// ---------- settings ----------
const DEFAULTS = {
  source: 'lichess', ratings: [1200, 1400, 1600], speeds: ['blitz', 'rapid', 'classical'],
  token: '', engineElo: 1500, engineAfterBook: true, flagMoves: true, hideStatsMyTurn: false, showEval: false, mode: 'overview', chesscomUser: '', lichessUser: '',
  colorPref: 'white', sound: true,
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('ot.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ot.' + k, JSON.stringify(v)); } catch {} },
};
const S = Object.assign({}, DEFAULTS, store.get('settings', {}));
const saveSettings = () => store.set('settings', S);

// One-tap device setup: open the app with #token=lip_xxx once; it is saved locally and removed from the address bar.
(function readTokenFromHash() {
  const m = location.hash.match(/token=([A-Za-z0-9_]+)/);
  if (m) { S.token = m[1]; saveSettings(); history.replaceState(null, '', location.pathname + location.search); }
})();

const SOURCES = {
  lichess: { label: 'Lichess', short: 'Lichess players' },
  masters: { label: 'Masters', short: 'Masters games' },
  mine: { label: 'My games', short: 'My games' },
  rep: { label: 'Repertoire', short: 'My repertoire' },
};

// ---------- state ----------
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

let game = new Chess();
let userColor = 'white';
let startFen = game.fen();
let drill = null; // { name, moves[] }
let moveNotes = []; // per ply: { flag: 'rare'|'weak'|'mistake'|'blunder'|'offrep'|null, by: 'user'|'book'|'engine' }
let outOfBook = false;
let lastOpening = null;
let busy = 0; // generation counter to cancel pending replies after undo/new game
let currentStats = null;
let evalWhite = null;
let myTree = null;
let repTree = store.get('repTree', null);
let repInfo = store.get('repInfo', null);

const engine = new Engine('stockfish-19-lite-single.js');
const cache = new Map();

const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const sideOf = (fen) => (fen.split(' ')[1] === 'w' ? 'white' : 'black');
const isUserTurn = () => sideOf(game.fen()) === userColor;

// ---------- data sources ----------
let gamesMeta = store.get('gamesMeta', null);
async function loadMyTree() {
  if (myTree) return myTree;
  myTree = store.get('myTrees', null) || { white: {}, black: {} };
  return myTree;
}
const hasGames = () => !!gamesMeta && gamesMeta.count > 0;

let importing = false;
async function importGames({ quiet = false } = {}) {
  if (importing) return;
  const cc = (S.chesscomUser || '').trim(), li = (S.lichessUser || '').trim();
  if (!cc && !li) { if (!quiet) toast('Add a chess.com or Lichess username first', 'warn'); return; }
  importing = true;
  const status = (t) => { for (const e of document.querySelectorAll('.importStatus')) e.textContent = t; };
  status('Loading your games…');
  const all = []; const errs = [];
  if (cc) { try { all.push(...await fetchChessCom(cc, { onProgress: status })); } catch (e) { errs.push(e.message); } }
  if (li) { try { all.push(...await fetchLichess(li, { token: S.token, onProgress: status })); } catch (e) { errs.push(e.message); } }
  importing = false;
  if (!all.length) { status(errs.join(' · ') || 'No standard games found.'); if (!quiet) toast(errs[0] || 'No games found', 'warn'); return; }
  const { trees, used } = buildTrees(all);
  myTree = trees; store.set('myTrees', trees);
  gamesMeta = { count: used, white: all.filter((g) => g.color === 'white').length, black: all.filter((g) => g.color === 'black').length, updated: Date.now(), who: [cc && 'chess.com: ' + cc, li && 'Lichess: ' + li].filter(Boolean).join(' · ') };
  store.set('gamesMeta', gamesMeta);
  ovLichess = {};
  status(`${used} games loaded (${gamesMeta.white} as White, ${gamesMeta.black} as Black)` + (errs.length ? ' · ' + errs.join(' · ') : ''));
  if (!quiet) toast(`Loaded ${used} of your games`);
  renderAll();
}
function importPgnGames(text) {
  const name = guessPgnPlayer(text);
  const games = gamesFromPgnText(text, name);
  if (!games.length) { toast('No games found in that PGN', 'warn'); return; }
  const { trees, used } = buildTrees(games);
  myTree = trees; store.set('myTrees', trees);
  gamesMeta = { count: used, white: games.filter((g) => g.color === 'white').length, black: games.filter((g) => g.color === 'black').length, updated: Date.now(), who: 'PGN: ' + name, pgn: true };
  store.set('gamesMeta', gamesMeta);
  toast(`Loaded ${used} games for ${name}`);
  renderAll();
}

class SourceError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }

async function fetchExplorer(kind, fen) {
  const params = new URLSearchParams({ variant: 'standard', fen, moves: '15', topGames: '0', recentGames: '0' });
  if (kind === 'lichess') { params.set('ratings', S.ratings.join(',')); params.set('speeds', S.speeds.join(',')); }
  const url = `https://explorer.lichess.ovh/${kind}?${params}`;
  if (cache.has(url)) return cache.get(url);
  const headers = S.token ? { Authorization: 'Bearer ' + S.token } : {};
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { res = await fetch(url, { headers }); } catch (e) { throw new SourceError('Can\'t reach Lichess (offline?)', 'network'); }
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (res.status === 401 || res.status === 403) throw new SourceError(S.token ? 'Lichess rejected your token — check it in Settings' : 'Add your Lichess token in Settings to use live data', 'auth');
  if (!res.ok) throw new SourceError('Lichess explorer error ' + res.status, 'http');
  const j = await res.json();
  const out = {
    moves: j.moves.map((m) => ({ san: m.san, w: m.white, d: m.draws, b: m.black })),
    opening: j.opening ? `${j.opening.eco} ${j.opening.name}` : null,
  };
  cache.set(url, out);
  return out;
}

function fromMine(fen) {
  const node = (myTree?.[userColor] || {})[fenKey(fen)];
  return { moves: (node || []).map(([, san, w, d, b]) => ({ san, w, d, b })), opening: null };
}
function fromRep(fen) {
  const node = (repTree || {})[fenKey(fen)];
  return { moves: node ? Object.entries(node).map(([san, n]) => ({ san, w: 0, d: 0, b: 0, rep: n })) : [], opening: null };
}

async function getStats(source, fen) {
  let r;
  if (source === 'lichess' || source === 'masters') r = await fetchExplorer(source, fen);
  else if (source === 'mine') { await loadMyTree(); r = fromMine(fen); }
  else r = fromRep(fen);
  const moves = r.moves.map((m) => ({ ...m, n: m.w + m.d + m.b }));
  const total = moves.reduce((s, m) => s + m.n, 0);
  return { source, moves, total, opening: r.opening };
}

const minGames = { lichess: 8, masters: 3, mine: 1, rep: 0 };

function pickWeighted(stats) {
  let cands;
  if (stats.source === 'rep') cands = stats.moves.map((m) => ({ m, wt: m.weight || 1 }));
  else {
    const floor = stats.total * 0.01;
    cands = stats.moves.filter((m) => m.n > 0 && m.n >= floor).map((m) => ({ m, wt: m.n }));
  }
  const sum = cands.reduce((s, c) => s + c.wt, 0);
  if (!sum) return null;
  let r = Math.random() * sum;
  for (const c of cands) { r -= c.wt; if (r <= 0) return c.m; }
  return cands[cands.length - 1].m;
}

const scoreFor = (m, color) => (m.n ? ((color === 'white' ? m.w : m.b) + m.d / 2) / m.n : null);

// ---------- board ----------
function dests(ch) {
  const d = new Map();
  for (const m of ch.moves({ verbose: true })) { if (!d.has(m.from)) d.set(m.from, []); d.get(m.from).push(m.to); }
  return d;
}
const cg = Chessground($('#board'), {
  fen: game.fen(), orientation: userColor, coordinates: true,
  movable: { free: false, color: userColor, showDests: true, events: { after: onUserBoardMove } },
  draggable: { enabled: true, showGhost: true }, highlight: { lastMove: true, check: true },
  animation: { enabled: true, duration: 180 }, premovable: { enabled: false },
});

function syncBoard() {
  const h = game.history({ verbose: true });
  const last = h[h.length - 1];
  const turn = sideOf(game.fen());
  cg.set({
    fen: game.fen(), turnColor: turn, orientation: userColor, check: game.inCheck() ? turn : false,
    lastMove: last ? [last.from, last.to] : undefined,
    movable: { color: isUserTurn() && !game.isGameOver() ? userColor : undefined, dests: isUserTurn() ? dests(game) : new Map() },
  });
}

// ---------- sounds ----------
let actx = null;
function tick(capture) {
  if (!S.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = capture ? 220 : 330;
    g.gain.setValueAtTime(0.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.18, actx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.09);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.1);
  } catch {}
}

// ---------- game flow ----------
function playMove(move, by) {
  let res = null; try { res = game.move(move); } catch { res = null; }
  if (!res) return null;
  moveNotes[game.history().length - 1] = { flag: null, by, notes: [] };
  tick(!!res.captured);
  return res;
}

async function onUserBoardMove(orig, dest) {
  if (S.mode === 'learn') return lessonUserMove(orig, dest);
  const before = game.fen();
  const piece = game.get(orig);
  const promo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
  const res = playMove({ from: orig, to: dest, promotion: promo }, 'user');
  if (!res) { syncBoard(); return; }
  afterUserMove(before, res);
}

function playUserSan(san) {
  if (!isUserTurn() || game.isGameOver()) return;
  const before = game.fen();
  const res = playMove(san, 'user');
  if (!res) return;
  afterUserMove(before, res);
}

function afterUserMove(beforeFen, res) {
  const ply = game.history().length - 1;
  const gen = ++busy;
  syncBoard(); renderAll();
  if (S.flagMoves) checkUserMove(beforeFen, res, ply, gen);
  if (!game.isGameOver()) setTimeout(() => opponentMove(gen), 380);
}

async function opponentMove(gen) {
  if (gen !== busy || isUserTurn() || game.isGameOver()) return;
  setStatus('thinking');
  let stats = null, err = null;
  if (!outOfBook) {
    try { stats = await getStats(S.source, game.fen()); } catch (e) { err = e; }
    if (gen !== busy) return;
    if (stats && stats.source === 'rep' && stats.moves.length > 1 && S.token) {
      // weight repertoire choices by real-world popularity when we can
      try {
        const lc = await getStats('lichess', game.fen());
        for (const m of stats.moves) m.weight = (lc.moves.find((x) => x.san === m.san)?.n || 0) + 1;
      } catch {}
      if (gen !== busy) return;
    }
  }
  let pick = null;
  if (stats && stats.total >= minGames[stats.source] && (stats.source !== 'rep' || stats.moves.length)) pick = pickWeighted(stats);
  if (pick) {
    playMove(pick.san, 'book');
    if (stats.opening) lastOpening = stats.opening;
  } else {
    if (!outOfBook) {
      outOfBook = true;
      toast(err ? err.message + (S.engineAfterBook ? ' — engine takes over' : '') : `Out of book (${SOURCES[S.source].short})${S.engineAfterBook ? ' — engine takes over' : ''}`, err ? 'warn' : 'info');
    }
    if (!S.engineAfterBook) { setStatus('ended'); renderAll(); return; }
    try {
      const r = await engine.analyse(game.fen(), { movetime: 700, elo: S.engineElo });
      if (gen !== busy) return;
      if (r.best) playMove({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] }, 'engine');
    } catch { toast('Engine failed to load', 'warn'); setStatus('ended'); renderAll(); return; }
  }
  syncBoard(); setStatus(); renderAll();
}

// Judge the user's move from the book stats and the engine.
async function checkUserMove(beforeFen, res, ply, gen) {
  const note = moveNotes[ply];
  const mover = sideOf(beforeFen);
  const add = (flag, text, sev) => {
    if (moveNotes[ply] !== note) return; // move was undone
    note.notes.push({ text, sev });
    const rank = { offrep: 1, rare: 1, weak: 2, mistake: 3, blunder: 4 };
    if (!note.flag || rank[flag] > rank[note.flag]) note.flag = flag;
    renderAll();
    showWarning(ply);
  };

  // repertoire check
  if (S.source === 'rep') {
    const r = fromRep(beforeFen);
    if (r.moves.length && !r.moves.some((m) => m.san === res.san)) add('offrep', `Not in your repertoire. Expected: ${r.moves.map((m) => m.san).join(', ')}`, 1);
  }

  // popularity / results check (use the active explorer source, else Lichess if we have a token, else my games)
  const ref = S.source === 'masters' ? 'masters' : (S.source === 'lichess' || S.token) ? 'lichess' : 'mine';
  try {
    const st = await getStats(ref, beforeFen);
    if (st.total >= 50) {
      const mine = st.moves.find((m) => m.san === res.san);
      const share = mine ? mine.n / st.total : 0;
      const pop = st.moves.filter((m) => m.n >= Math.max(10, st.total * 0.05)).sort((a, b) => b.n - a.n);
      const alts = pop.filter((m) => m.san !== res.san).slice(0, 3).map((m) => `${m.san} (${Math.round((m.n / st.total) * 100)}%)`).join(', ');
      if (!mine || share < 0.03) {
        add('rare', `${res.san} is rare here — ${mine ? (share * 100).toFixed(1) + '%' : 'almost nobody'} of ${SOURCES[ref].short.toLowerCase()} play it. Popular: ${alts}`, 1);
      } else if (mine.n >= 20) {
        const myScore = scoreFor(mine, mover);
        const best = pop.filter((m) => m.san !== res.san && m.n >= 20).map((m) => ({ m, s: scoreFor(m, mover) })).sort((a, b) => b.s - a.s)[0];
        if (best && myScore < best.s - 0.07 && myScore < 0.5) add('weak', `${res.san} scores ${Math.round(myScore * 100)}% for ${mover}; ${best.m.san} scores ${Math.round(best.s * 100)}%.`, 2);
      }
    }
  } catch {}

  // engine check
  try {
    const a = await engine.analyse(beforeFen, { depth: 12 });
    if (moveNotes[ply] !== note) return;
    const b = await engine.analyse(fenAfterPly(ply), { depth: 12 });
    const sign = mover === 'white' ? 1 : -1;
    const clamp = (x) => Math.max(-1500, Math.min(1500, x));
    const drop = clamp(a.cp * sign) - clamp(b.cp * sign);
    if (a.best && uciOf(res) !== a.best) {
      const bestSan = sanOf(beforeFen, a.best);
      if (drop >= 250) add('blunder', `Blunder: loses about ${(drop / 100).toFixed(1)} pawns. Engine best: ${bestSan}`, 4);
      else if (drop >= 120) add('mistake', `Mistake: costs about ${(drop / 100).toFixed(1)} pawns. Engine best: ${bestSan}`, 3);
    }
  } catch {}
}
const uciOf = (m) => m.from + m.to + (m.promotion || '');
function sanOf(fen, uci) { try { const c = new Chess(fen); return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; } }
function fenAfterPly(ply) {
  const c = new Chess(startFen);
  const h = game.history();
  for (let i = 0; i <= ply; i++) c.move(h[i]);
  return c.fen();
}

function newGame(opts = {}) {
  busy++;
  outOfBook = false; lastOpening = null; evalWhite = null; moveNotes = [];
  const pref = S.colorPref;
  userColor = pref === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : pref;
  drill = opts.drill || null;
  game = new Chess();
  if (drill) {
    for (const m of drill.moves) { game.move(m); moveNotes.push({ flag: null, by: 'drill', notes: [] }); }
    lastOpening = drill.name;
  }
  startFen = new Chess().fen();
  hideWarning();
  syncBoard(); setStatus(); renderAll();
  if (!isUserTurn()) setTimeout(() => opponentMove(busy), 450);
}

function undo() {
  busy++;
  const minPly = drill ? drill.moves.length : 0;
  if (game.history().length <= minPly) return;
  // take back to the previous position where it's the user's turn
  do { game.undo(); moveNotes.pop(); } while (game.history().length > minPly && !isUserTurn());
  if (!isUserTurn() && game.history().length === minPly) { /* user can't move from here; let the opponent reply again */ }
  outOfBook = false;
  hideWarning(); syncBoard(); setStatus(); renderAll();
  if (!isUserTurn()) setTimeout(() => opponentMove(busy), 400);
}

// ---------- UI rendering ----------
let statusMode = null;
function setStatus(mode) { statusMode = mode || null; renderStatus(); }
function renderStatus() {
  const s = $('#status');
  let t;
  if (game.isCheckmate()) t = `Checkmate — ${sideOf(game.fen()) === userColor ? 'you lost' : 'you won'}`;
  else if (game.isDraw()) t = 'Draw';
  else if (statusMode === 'thinking') t = 'Opponent is thinking…';
  else if (statusMode === 'ended') t = 'Line finished — undo or start a new game';
  else t = isUserTurn() ? `Your move (${userColor})` : 'Opponent to move';
  const src = outOfBook ? (S.engineAfterBook ? `Engine (~${S.engineElo})` : 'Out of book') : SOURCES[S.source].short;
  s.innerHTML = '';
  s.append(el('span', { class: 'dot ' + (isUserTurn() ? 'you' : 'them') }), el('span', {}, t), el('span', { class: 'pill' }, src));
}

function renderMoves() {
  const box = $('#moves');
  box.innerHTML = '';
  const h = game.history();
  const startNo = 1;
  for (let i = 0; i < h.length; i += 2) {
    const row = el('div', { class: 'mrow' }, el('span', { class: 'mno' }, startNo + i / 2 + '.'));
    for (const j of [i, i + 1]) {
      if (j >= h.length) break;
      const n = moveNotes[j] || {};
      const sym = { rare: '?!', offrep: '?!', weak: '?!', mistake: '?', blunder: '??' }[n.flag] || '';
      row.append(el('span', { class: `mv by-${n.by || ''} f-${n.flag || 'none'}`, title: (n.notes || []).map((x) => x.text).join('\n'), onclick: () => n.flag && showWarning(j) }, h[j] + sym));
    }
    box.append(row);
  }
  box.scrollTop = box.scrollHeight;
}

async function renderStats() {
  const box = $('#stats');
  const fen = game.fen();
  const myTurn = isUserTurn();
  const head = $('#statsHead');
  head.textContent = `${SOURCES[S.source].short} · ${myTurn ? 'your options' : 'their likely replies'}`;
  if (myTurn && S.hideStatsMyTurn) { box.innerHTML = ''; box.append(el('div', { class: 'muted' }, 'Hidden on your turn (Settings) — make your move.')); return; }
  box.innerHTML = '';
  box.append(el('div', { class: 'muted' }, 'Loading…'));
  let st;
  try { st = await getStats(S.source, fen); } catch (e) { if (fen !== game.fen()) return; box.innerHTML = ''; box.append(el('div', { class: 'err' }, e.message), e.kind === 'auth' ? el('button', { class: 'btn small', onclick: openSettings }, 'Open settings') : ''); return; }
  if (fen !== game.fen()) return;
  currentStats = st;
  if (st.opening) lastOpening = st.opening;
  $('#opening').textContent = lastOpening || detectOpening() || 'Starting position';
  box.innerHTML = '';
  if (!st.moves.length && S.source === 'mine' && !hasGames()) { box.append(el('div', { class: 'muted' }, 'Load your games first (Overview tab or Settings).')); return; }
  if (!st.moves.length) { box.append(el('div', { class: 'muted' }, S.source === 'rep' ? (repTree ? 'No repertoire moves here.' : 'No repertoire loaded — paste a PGN in Settings.') : 'No games from this position.')); return; }
  const isRep = st.source === 'rep';
  const rows = [...st.moves].sort((a, b) => (isRep ? b.rep - a.rep : b.n - a.n)).slice(0, 10);
  const tbl = el('div', { class: 'stbl' });
  tbl.append(el('div', { class: 'sh' }, el('span', {}, 'Move'), el('span', {}, isRep ? '' : 'Games'), el('span', {}, isRep ? '' : 'White / Draw / Black')));
  for (const m of rows) {
    const pct = st.total ? Math.round((m.n / st.total) * 100) : null;
    const bar = isRep ? el('span', { class: 'muted' }, 'repertoire') : wdlBar(m);
    tbl.append(el('div', { class: 'sr' + (myTurn ? ' clickable' : ''), onclick: () => myTurn && playUserSan(m.san), title: myTurn ? 'Play ' + m.san : '' },
      el('span', { class: 'san' }, m.san),
      el('span', { class: 'cnt' }, isRep ? '' : `${pct}%`, isRep ? '' : el('small', {}, fmt(m.n))),
      bar));
  }
  box.append(tbl);
  box.append(el('div', { class: 'muted foot' }, isRep ? '' : `${fmt(st.total)} games in this position`));
}
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
function wdlBar(m) {
  const t = m.n || 1, w = (m.w / t) * 100, d = (m.d / t) * 100, b = (m.b / t) * 100;
  const seg = (cls, v) => el('span', { class: 'seg ' + cls, style: `width:${v}%` }, v >= 14 ? Math.round(v) + '%' : '');
  return el('span', { class: 'wdl' }, seg('w', w), seg('d', d), seg('b', b));
}

function detectOpening() {
  const h = game.history();
  let best = null;
  for (const o of OPENINGS) if (o.moves.length <= h.length && o.moves.every((m, i) => h[i] === m) && (!best || o.moves.length > best.moves.length)) best = o;
  return best ? best.name : null;
}

let lastEvalFen = null;
async function renderEval() {
  const fen = game.fen();
  const bar = $('#evalfill'), txt = $('#evaltxt');
  const show = S.mode === 'play' && S.showEval;
  $('#evalbar').hidden = !show;
  if (!show) { lastEvalFen = null; return; }
  if (game.isGameOver() || fen === lastEvalFen) return;
  lastEvalFen = fen;
  try {
    const r = await engine.analyse(fen, { depth: 11 });
    if (fen !== game.fen()) return;
    evalWhite = r;
    const cp = Math.max(-800, Math.min(800, r.cp));
    const pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
    bar.style.height = pct + '%';
    bar.parentElement.classList.toggle('flip', userColor === 'black');
    txt.textContent = r.mate !== null ? '#' + r.mate : (r.cp >= 0 ? '+' : '') + (r.cp / 100).toFixed(1);
  } catch { txt.textContent = '—'; }
}

function renderAll() {
  document.body.classList.toggle('mode-learn', S.mode === 'learn');
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === S.mode);
  $('#playPanel').hidden = S.mode !== 'play';
  $('#learnPanel').hidden = S.mode !== 'learn';
  $('#overviewPanel').hidden = S.mode !== 'overview';
  document.body.classList.toggle('mode-overview', S.mode === 'overview');
  renderEval();
  if (S.mode === 'overview') { renderOverview(); return; }
  if (S.mode === 'learn') { renderLearn(); renderMoves(); return; }
  renderStatus(); renderMoves(); renderStats(); renderSourceTabs();
}

function renderSourceTabs() {
  for (const b of document.querySelectorAll('[data-src]')) b.classList.toggle('on', b.dataset.src === S.source);
  for (const b of document.querySelectorAll('[data-color]')) b.classList.toggle('on', b.dataset.color === S.colorPref);
  $('#drillName').textContent = drill ? drill.name : 'Free play';
}

// ---------- warnings & toasts ----------
function showWarning(ply) {
  const n = moveNotes[ply];
  if (!n || !n.flag) return;
  const box = $('#warn');
  box.className = 'warn sev-' + Math.max(...n.notes.map((x) => x.sev));
  box.innerHTML = '';
  box.append(el('div', { class: 'wt' }, `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'} ${game.history()[ply] || ''}`),
    ...n.notes.map((x) => el('div', {}, x.text)),
    el('div', { class: 'wbtns' }, el('button', { class: 'btn small', onclick: () => { hideWarning(); if (ply === game.history().length - 1 || ply === game.history().length - 2) undo(); } }, 'Undo'), el('button', { class: 'btn small ghost', onclick: hideWarning }, 'Keep playing')));
  box.hidden = false;
}
function hideWarning() { $('#warn').hidden = true; }
let toastT;
function toast(msg, kind = 'info') { const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4200); }

// ---------- repertoire import ----------
function buildRepTree(pgnText) {
  const games = parsePgn(pgnText, { startRule: 'games' });
  const tree = {};
  let lines = 0;
  const walk = (fen, moves) => {
    let c = new Chess(fen);
    for (const mv of moves) {
      const posFen = c.fen();
      for (const v of mv.variations || []) walk(posFen, v);
      const san = mv.notation.notation;
      let r;
      try { r = c.move(san); } catch { return; }
      const k = fenKey(posFen);
      tree[k] ||= {};
      tree[k][r.san] = (tree[k][r.san] || 0) + 1;
    }
    lines++;
  };
  for (const g of games) {
    const fen = g.tags?.FEN || new Chess().fen();
    walk(fen, g.moves);
  }
  return { tree, lines, positions: Object.keys(tree).length, games: games.length };
}

// ---------- settings dialog ----------
function openSettings() {
  const d = $('#settings');
  $('#tokenIn').value = S.token;
  $('#ccIn').value = S.chesscomUser || ''; $('#liIn').value = S.lichessUser || '';
  $('#gamesStatus').textContent = gamesMeta ? `${gamesMeta.count} games (${gamesMeta.who}), updated ${new Date(gamesMeta.updated).toLocaleDateString()}` : 'No games loaded yet.';
  $('#eloIn').value = S.engineElo; $('#eloOut').textContent = S.engineElo;
  $('#afterBook').checked = S.engineAfterBook; $('#flagIn').checked = S.flagMoves; $('#hideIn').checked = S.hideStatsMyTurn; $('#evalIn').checked = S.showEval; $('#soundIn').checked = S.sound;
  for (const b of d.querySelectorAll('[data-rating]')) b.classList.toggle('on', S.ratings.includes(+b.dataset.rating));
  for (const b of d.querySelectorAll('[data-speed]')) b.classList.toggle('on', S.speeds.includes(b.dataset.speed));
  $('#repStatus').textContent = repInfo ? `Loaded: ${repInfo.games} chapter(s), ${repInfo.positions} positions` : 'No repertoire loaded';
  d.showModal();
}
function initSettings() {
  const d = $('#settings');
  d.querySelectorAll('[data-rating]').forEach((b) => b.addEventListener('click', () => {
    const r = +b.dataset.rating; const on = S.ratings.includes(r);
    if (on && S.ratings.length === 1) return;
    S.ratings = on ? S.ratings.filter((x) => x !== r) : [...S.ratings, r].sort((a, c) => a - c);
    b.classList.toggle('on', !on); saveSettings(); cache.clear();
  }));
  d.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    const s = b.dataset.speed; const on = S.speeds.includes(s);
    if (on && S.speeds.length === 1) return;
    S.speeds = on ? S.speeds.filter((x) => x !== s) : [...S.speeds, s];
    b.classList.toggle('on', !on); saveSettings(); cache.clear();
  }));
  $('#ccIn').addEventListener('change', (e) => { S.chesscomUser = e.target.value.trim(); saveSettings(); });
  $('#liIn').addEventListener('change', (e) => { S.lichessUser = e.target.value.trim(); saveSettings(); });
  $('#gamesLoad').addEventListener('click', () => { S.chesscomUser = $('#ccIn').value.trim(); S.lichessUser = $('#liIn').value.trim(); saveSettings(); importGames(); });
  $('#gamesFile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) importPgnGames(await f.text()); e.target.value = ''; });
  $('#tokenIn').addEventListener('change', (e) => { S.token = e.target.value.trim(); saveSettings(); cache.clear(); });
  $('#eloIn').addEventListener('input', (e) => { S.engineElo = +e.target.value; $('#eloOut').textContent = S.engineElo; saveSettings(); });
  $('#afterBook').addEventListener('change', (e) => { S.engineAfterBook = e.target.checked; saveSettings(); });
  $('#flagIn').addEventListener('change', (e) => { S.flagMoves = e.target.checked; saveSettings(); });
  $('#hideIn').addEventListener('change', (e) => { S.hideStatsMyTurn = e.target.checked; saveSettings(); });
  $('#evalIn').addEventListener('change', (e) => { S.showEval = e.target.checked; saveSettings(); });
  $('#soundIn').addEventListener('change', (e) => { S.sound = e.target.checked; saveSettings(); });
  $('#repLoad').addEventListener('click', () => {
    const txt = $('#repIn').value.trim();
    if (!txt) return;
    try {
      const r = buildRepTree(txt);
      if (!r.positions) throw new Error('no moves found');
      repTree = r.tree; repInfo = { games: r.games, positions: r.positions };
      store.set('repTree', repTree); store.set('repInfo', repInfo);
      $('#repStatus').textContent = `Loaded: ${r.games} chapter(s), ${r.positions} positions`;
      $('#repIn').value = '';
      toast('Repertoire saved on this device');
    } catch (e) { $('#repStatus').textContent = 'Couldn\'t read that PGN: ' + e.message; }
  });
  $('#repFile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) $('#repIn').value = await f.text(); });
  $('#repClear').addEventListener('click', () => { repTree = null; repInfo = null; store.set('repTree', null); store.set('repInfo', null); $('#repStatus').textContent = 'No repertoire loaded'; });
  $('#closeSettings').addEventListener('click', () => { d.close(); renderAll(); });
  d.addEventListener('close', () => renderAll());
}

// ---------- drill picker ----------
function openDrill() {
  const d = $('#drill');
  const list = $('#drillList');
  const q = $('#drillSearch');
  const draw = () => {
    list.innerHTML = '';
    const term = q.value.toLowerCase();
    list.append(el('button', { class: 'ditem', onclick: () => { d.close(); newGame(); } }, el('b', {}, 'Free play'), el('small', {}, 'Start from the initial position')));
    for (const o of OPENINGS.filter((o) => o.name.toLowerCase().includes(term))) {
      const c = new Chess(); const parts = [];
      o.moves.forEach((m, i) => { if (i % 2 === 0) parts.push(i / 2 + 1 + '.'); parts.push(m); c.move(m); });
      list.append(el('button', { class: 'ditem', onclick: () => { d.close(); newGame({ drill: o }); } }, el('b', {}, o.name), el('small', {}, parts.join(' '))));
    }
  };
  q.value = ''; q.oninput = draw; draw();
  d.showModal();
}


// ---------- Learn mode ----------
// progress: { [openingId]: { [lineIdx]: { seen: bool, clean: number, tries: number } } }
let progress = store.get('progress', {});
let lesson = null; // { o, idx, kind: 'learn'|'practice', moves[], ply, mistakes, wrongHere, done }
let learnView = { screen: 'home', id: null };
const lineMoves = (l) => l.moves.split(' ');
const prog = (o, i) => ((progress[o.id] ||= {})[i] ||= { seen: false, clean: 0, tries: 0 });
const mastered = (o, i) => prog(o, i).clean >= 1;
const masteredCount = (o) => o.lines.filter((_, i) => mastered(o, i)).length;
const saveProgress = () => store.set('progress', progress);

function setMode(m, initial) {
  busy++; lesson = null; hideWarning(); cg.setAutoShapes([]);
  S.mode = m; saveSettings();
  if (m === 'overview') { game = new Chess(); moveNotes = []; renderAll(); window.scrollTo(0, 0); return; }
  if (m === 'learn') { learnView = { screen: 'home', id: null }; game = new Chess(); moveNotes = []; userColor = 'white'; syncBoard(); renderAll(); }
  else newGame({ drill });
}

function openOpening(id) { busy++; lesson = null; cg.setAutoShapes([]); learnView = { screen: 'opening', id }; const o = LESSONS.find((x) => x.id === id); userColor = o.side; game = new Chess(); moveNotes = []; syncBoard(); renderAll(); }

function pickPracticeLine(o) {
  const w = o.lines.map((_, i) => (mastered(o, i) ? 1 : 3) * (i === 0 ? 2 : 1) * (lesson && lesson.idx === i && o.lines.length > 1 ? 0.25 : 1));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}
function nextLearnLine(o) { const i = o.lines.findIndex((_, i) => !prog(o, i).seen); return i === -1 ? 0 : i; }

function startLine(o, idx, kind) {
  const gen = ++busy;
  hideWarning(); cg.setAutoShapes([]);
  userColor = o.side;
  game = new Chess(); moveNotes = [];
  lesson = { o, idx, kind, moves: lineMoves(o.lines[idx]), ply: 0, mistakes: 0, wrongHere: 0, done: false, msg: null, gen, queue: startLine.queue || null };
  startLine.queue = null;
  learnView = { screen: 'lesson', id: o.id };
  syncBoard(); renderAll();
  lessonContinue();
}

function expectedMove() { const c = new Chess(game.fen()); return c.move(lesson.moves[lesson.ply]); }

function lessonContinue() {
  const L = lesson; if (!L) return;
  if (L.ply >= L.moves.length) return lessonDone();
  if (sideOf(game.fen()) !== userColor) {
    cg.setAutoShapes([]);
    setTimeout(() => {
      if (lesson !== L || L.gen !== busy) return;
      playMove(L.moves[L.ply], 'book'); L.ply++;
      syncBoard(); renderAll(); lessonContinue();
    }, L.ply === 0 ? 600 : 550);
  } else {
    L.wrongHere = 0;
    if (L.kind === 'learn') showArrow();
    renderAll();
  }
}
function showArrow() { const m = expectedMove(); cg.setAutoShapes([{ orig: m.from, dest: m.to, brush: 'green' }]); }

function lessonUserMove(orig, dest) {
  const L = lesson;
  if (!L || L.done) { syncBoard(); return; }
  const piece = game.get(orig);
  const promo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
  const exp = expectedMove();
  const isRight = exp.from === orig && exp.to === dest || (exp.san === 'O-O' && orig === exp.from && (dest === 'h1' || dest === 'h8')) || (exp.san === 'O-O-O' && orig === exp.from && (dest === 'a1' || dest === 'a8'));
  if (isRight) {
    playMove(exp.san, 'user'); L.ply++; L.msg = null;
    cg.setAutoShapes([]); syncBoard(); renderAll(); lessonContinue();
    return;
  }
  // wrong: show it briefly, then take it back
  let tried = null;
  try { tried = new Chess(game.fen()).move({ from: orig, to: dest, promotion: promo }); } catch {}
  L.mistakes++; L.wrongHere++;
  L.msg = { kind: 'bad', text: `${tried ? tried.san : 'That'} isn't the move here.` + (L.wrongHere >= 2 || L.kind === 'learn' ? ` The move is ${exp.san} (arrow).` : ' Try again.') };
  if (L.wrongHere >= 2 || L.kind === 'learn') showArrow();
  tick(true);
  setTimeout(() => { if (lesson === L) syncBoard(); }, 250);
  renderAll();
}

function lessonDone() {
  const L = lesson; L.done = true;
  const p = prog(L.o, L.idx);
  p.seen = true; p.tries++; p.last = Date.now();
  if (L.kind === 'practice' && L.mistakes === 0) p.clean++;
  if (L.kind === 'practice' && L.mistakes > 0) p.clean = 0;
  saveProgress();
  cg.setAutoShapes([]);
  renderAll();
}

function lessonHint() { if (lesson && !lesson.done && sideOf(game.fen()) === userColor) { lesson.mistakes++; lesson.msg = { kind: 'info', text: 'Hint shown (counts as a slip).' }; showArrow(); renderAll(); } }

function renderLearn() {
  const box = $('#learnPanel');
  box.innerHTML = '';
  if (learnView.screen === 'home') return renderLearnHome(box);
  const o = LESSONS.find((x) => x.id === learnView.id);
  if (learnView.screen === 'opening') return renderOpening(box, o);
  return renderLesson(box, o);
}

function progressBar(o) {
  const n = masteredCount(o), t = o.lines.length;
  return el('div', { class: 'pbar', title: `${n} of ${t} lines mastered` }, el('span', { style: `width:${(n / t) * 100}%` }));
}

function renderLearnHome(box) {
  setStatusText('Pick an opening to learn');
  box.append(el('div', { class: 'card' }, el('div', { class: 'label' }, 'Learn an opening'),
    el('div', { class: 'muted' }, 'Each opening has a main line plus the deviations you’ll meet. Learn them with arrows, then practise from memory.')));
  for (const side of ['white', 'black']) {
    const list = el('div', { class: 'card olist' }, el('div', { class: 'label' }, side === 'white' ? 'As White' : 'As Black'));
    for (const o of LESSONS.filter((x) => x.side === side)) {
      list.append(el('button', { class: 'oitem', onclick: () => openOpening(o.id) },
        el('div', { class: 'otop' }, el('b', {}, o.name), youPlay(o) ? el('span', { class: 'tag' }, 'You play this') : null),
        el('small', {}, `${o.lines.length} lines · ${masteredCount(o)} mastered`), progressBar(o)));
    }
    box.append(list);
  }
}

function renderOpening(box, o) {
  setStatusText(`${o.name} — you play ${o.side}`);
  const first = nextLearnLine(o);
  const head = el('div', { class: 'card' },
    el('button', { class: 'back', onclick: () => { learnView = { screen: 'home' }; renderAll(); } }, '← All openings'),
    el('h2', { class: 'otitle' }, o.name), el('div', { class: 'muted' }, o.blurb), progressBar(o),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', onclick: () => startLine(o, first, 'learn') }, o.lines.every((_, i) => prog(o, i).seen) ? 'Review lines' : 'Learn'),
      el('button', { class: 'btn', onclick: () => startLine(o, pickPracticeLine(o), 'practice') }, 'Practice (no hints)')));
  box.append(head);
  const list = el('div', { class: 'card' }, el('div', { class: 'label' }, 'Lines'));
  o.lines.forEach((l, i) => {
    const p = prog(o, i);
    const st = mastered(o, i) ? '✓' : p.seen ? '◐' : '';
    list.append(el('button', { class: 'litem' + (i === 0 ? ' main' : ''), onclick: () => startLine(o, i, 'learn') },
      el('span', { class: 'lst ' + (mastered(o, i) ? 'ok' : p.seen ? 'half' : '') }, st),
      el('span', {}, el('b', {}, l.name), el('small', {}, pgnText(l.moves)))));
    if (i === 0 && o.lines.length > 1) list.append(el('div', { class: 'label sub' }, 'Also know'));
  });
  box.append(list);
  box.append(el('div', { class: 'muted legend' }, '✓ mastered (practised with no mistakes) · ◐ learned'));
}

function pgnText(moves) { return moves.split(' ').map((m, i) => (i % 2 ? m : `${i / 2 + 1}.${m}`)).join(' '); }

function setStatusText(t, cls) {
  const s = $('#status'); s.innerHTML = '';
  s.append(el('span', { class: 'dot ' + (cls || '') }), el('span', {}, t));
}

function renderLesson(box, o) {
  const L = lesson; const line = o.lines[L.idx];
  const total = L.moves.length;
  const yourTurn = !L.done && sideOf(game.fen()) === userColor;
  setStatusText(L.done ? 'Line complete' : yourTurn ? (L.kind === 'learn' ? 'Your move — follow the arrow' : 'Your move — from memory') : 'Opponent is moving…', yourTurn ? 'you' : '');
  const card = el('div', { class: 'card' },
    el('button', { class: 'back', onclick: () => openOpening(o.id) }, '← ' + o.name),
    el('div', { class: 'lhead' }, el('span', { class: 'kind ' + L.kind }, L.kind === 'learn' ? 'Learning' : 'Practice'), el('b', {}, L.kind === 'practice' && !L.done ? 'Which line will they play?' : line.name)),
    el('div', { class: 'pbar thin' }, el('span', { style: `width:${(L.ply / total) * 100}%` })),
    L.kind === 'learn' || L.done ? el('p', { class: 'note' }, line.note) : null);
  if (L.msg && !L.done) card.append(el('div', { class: 'lmsg ' + L.msg.kind }, L.msg.text));
  if (L.done) {
    const clean = L.mistakes === 0;
    card.append(el('div', { class: 'lmsg ' + (clean ? 'good' : 'info') },
      L.kind === 'practice' ? (clean ? 'Perfect — line mastered!' : `Done with ${L.mistakes} slip${L.mistakes > 1 ? 's' : ''}. Practise it again to master it.`) : 'Line learned. Now try it from memory.'));
    const nextIdx = o.lines.findIndex((_, i) => i > L.idx && !prog(o, i).seen);
    const dueLeft = L.queue ? dueLines().filter((d) => !(d.o === o && d.i === L.idx)) : [];
    if (L.queue && dueLeft.length) card.append(el('div', { class: 'row gap' }, el('button', { class: 'btn primary', onclick: () => practiceDue() }, `Next due line (${dueLeft.length} left)`)));
    else if (L.queue) card.append(el('div', { class: 'lmsg good' }, 'All due lines done for today \u2014 nice work!'));
    card.append(el('div', { class: 'row gap' },
      L.kind === 'learn' && nextIdx !== -1 ? el('button', { class: 'btn primary', onclick: () => startLine(o, nextIdx, 'learn') }, 'Next line: ' + o.lines[nextIdx].name) : null,
      el('button', { class: 'btn' + (L.kind === 'practice' || nextIdx === -1 ? ' primary' : ''), onclick: () => startLine(o, pickPracticeLine(o), 'practice') }, L.kind === 'practice' ? 'Next practice line' : 'Practice'),
      el('button', { class: 'btn ghost', onclick: () => startLine(o, L.idx, L.kind) }, 'Repeat')));
  } else {
    card.append(el('div', { class: 'row gap' },
      L.kind === 'practice' ? el('button', { class: 'btn small', onclick: lessonHint }, 'Hint') : null,
      el('button', { class: 'btn small ghost', onclick: () => startLine(o, L.idx, L.kind) }, 'Restart line')));
  }
  box.append(card);
}


// ---------- Overview ----------
// An opening is "yours" if your own games follow its main line for a few moves.
function youPlay(o) {
  const tree = myTree?.[o.side]; if (!tree) return false;
  const c = new Chess(); let depth = 0;
  for (const m of lineMoves(o.lines[0]).slice(0, 8)) {
    const node = tree[fenKey(c.fen())]; const e = node && node.find((x) => x[1] === m);
    if (!e || e[2] + e[3] + e[4] < 4) break;
    c.move(m); depth++;
  }
  return depth >= Math.min(5, lineMoves(o.lines[0]).length);
}
const DAY = 864e5;
const intervalFor = (clean) => [0, 1, 3, 7, 14, 30][Math.min(clean, 5)] * DAY;
function dueLines() {
  const out = [];
  const now = Date.now();
  for (const o of LESSONS) o.lines.forEach((l, i) => {
    const p = prog(o, i);
    if (p.seen && now - (p.last || 0) >= intervalFor(p.clean)) out.push({ o, i, p });
  });
  return out.sort((a, b) => a.p.clean - b.p.clean || (a.p.last || 0) - (b.p.last || 0));
}
function practiceDue() {
  const d = dueLines();
  if (!d.length) return;
  if (S.mode !== 'learn') { S.mode = 'learn'; saveSettings(); }
  startLine.queue = true;
  startLine(d[0].o, d[0].i, 'practice');
  window.scrollTo(0, 0);
}

// Which course covers each opponent reply
const COVER_WHITE = {
  d4: { map: { d5: ['london'], Nf6: ['london'], e6: ['london'] },
    names: { d5: '1...d5', Nf6: '1...Nf6 (Indian)', e6: '1...e6', f5: '1...f5 Dutch', c5: '1...c5 Benoni', d6: '1...d6', g6: '1...g6' } },
};
function coverFor(side) {
  if (side === 'black') return COVER.black;
  const node = (myTree?.white || {})[fenKey(new Chess().fen())] || [];
  const top = [...node].sort((a, b) => (b[2] + b[3] + b[4]) - (a[2] + a[3] + a[4]))[0];
  const first = top ? top[1] : 'e4';
  if (first === 'e4') return COVER.white;
  const extra = COVER_WHITE[first] || { map: {}, names: {} };
  return { label: `When you play 1.${first}, Black replies\u2026`, start: [first], map: extra.map, names: extra.names };
}
const COVER = {
  white: { label: 'When you play 1.e4, Black replies…', start: ['e4'], map: {
    e5: ['scotch', 'italian'], c5: ['alapin'], e6: ['french-adv'], c6: ['caro-adv'], d5: ['scandi'], d6: ['vs-pirc'], g6: ['vs-pirc'], Nf6: ['alekhine'] },
    names: { e5: '1...e5 (Open Game)', c5: '1...c5 Sicilian', e6: '1...e6 French', c6: '1...c6 Caro-Kann', d5: '1...d5 Scandinavian', d6: '1...d6 Pirc', g6: '1...g6 Modern', Nf6: '1...Nf6 Alekhine', Nc6: '1...Nc6 Nimzowitsch', b6: '1...b6 Owen', f5: '1...f5', a6: '1...a6', h6: '1...h6', d6x: '' } },
  black: { label: 'As Black, White opens with…', start: [], map: {
    e4: ['pirc'], d4: ['kid'], c4: ['flank'], Nf3: ['flank'] },
    names: { e4: '1.e4', d4: '1.d4', c4: '1.c4 English', Nf3: '1.Nf3 Réti', g3: '1.g3', b3: '1.b3', f4: '1.f4 Bird', g4: '1.g4', b4: '1.b4', e3: '1.e3', d3: '1.d3', Nc3: '1.Nc3' } },
};
let ovLichess = {};
async function loadOvLichess() {
  if (!S.token) return;
  for (const side of ['white', 'black']) {
    if (ovLichess[side]) continue;
    const c = new Chess(); for (const m of coverFor(side).start) c.move(m);
    try { const st = await getStats('lichess', c.fen()); ovLichess[side] = st; if (S.mode === 'overview') renderOverview(); } catch {}
  }
}

function weakSpots() {
  if (!myTree) return [];
  const out = [];
  for (const color of ['white', 'black']) {
    const tree = myTree[color];
    const seen = new Set();
    const walk = (c, path) => {
      const k = fenKey(c.fen());
      if (seen.has(k) || path.length > 14) return; seen.add(k);
      const node = tree[k]; if (!node) return;
      const oppTurn = sideOf(c.fen()) !== color;
      for (const [, san, w, d, b] of node) {
        const n = w + d + b;
        const score = ((color === 'white' ? w : b) + d / 2) / n;
        const nc = new Chess(c.fen()); nc.move(san);
        const np = [...path, san];
        if (n >= 8 && score < 0.45 && np.length >= 2) out.push({ color, path: np, n, score, oppMove: oppTurn });
        if (n >= 2) walk(nc, np);
      }
    };
    walk(new Chess(), []);
  }
  // keep the deepest-but-meaningful: drop spots whose parent has a similar score with ~same games
  out.sort((a, b) => a.score - b.score || b.n - a.n);
  const res = [];
  for (const s of out) {
    const pre = (x, y) => y.join(' ').startsWith(x.join(' '));
    if (res.some((r) => r.color === s.color && (pre(r.path, s.path) || pre(s.path, r.path)))) continue;
    res.push(s);
    if (res.length >= 6) break;
  }
  return res;
}

function trainFrom(spot) {
  S.mode = 'play'; S.colorPref = spot.color; saveSettings();
  busy++; lesson = null; cg.setAutoShapes([]);
  newGame({ drill: { name: 'From your games', moves: spot.path } });
  window.scrollTo(0, 0);
}

function renderOverview() {
  const box = $('#overviewPanel');
  box.innerHTML = '';
  if (!hasGames()) box.append(accountCard(true));
  // 1. Today
  const due = dueLines();
  const started = LESSONS.filter((o) => o.lines.some((_, i) => prog(o, i).seen));
  const totalLines = LESSONS.reduce((s, o) => s + o.lines.length, 0);
  const mast = LESSONS.reduce((s, o) => s + masteredCount(o), 0);
  const today = el('div', { class: 'card span2 today' },
    el('div', {}, el('div', { class: 'label' }, 'Today'),
      el('div', { class: 'big' }, due.length ? `${due.length} line${due.length > 1 ? 's' : ''} to review` : started.length ? 'Nothing due — learn something new' : 'Start with an opening below'),
      el('div', { class: 'muted' }, `${mast} of ${totalLines} lines mastered across ${LESSONS.length} openings. Lines come back for review after 1, 3, 7, 14 and 30 days.`)),
    due.length ? el('button', { class: 'btn primary', onclick: practiceDue }, 'Practice due lines') : null);
  box.append(today);
  if (due.length) {
    const list = el('div', { class: 'duelist' });
    for (const d of due.slice(0, 8)) list.append(el('button', { class: 'chip', onclick: () => { S.mode = 'learn'; saveSettings(); startLine(d.o, d.i, 'practice'); window.scrollTo(0, 0); } }, `${d.o.name}: ${d.o.lines[d.i].name}`));
    today.append(list);
  }

  // 2. Coverage per colour
  for (const side of ['white', 'black']) {
    const cov = coverFor(side);
    const c = new Chess(); for (const m of cov.start) c.move(m);
    const node = (myTree?.[side] || {})[fenKey(c.fen())] || [];
    const mine = new Map(node.map(([, san, w, d, b]) => [san, { n: w + d + b, score: ((side === 'white' ? w : b) + d / 2) / (w + d + b) }]));
    const lc = ovLichess[side];
    const lcMap = lc ? new Map(lc.moves.map((m) => [m.san, m.n / lc.total])) : null;
    const sans = new Set([...Object.keys(cov.map), ...mine.keys(), ...(lc ? lc.moves.filter((m) => m.n / lc.total > 0.02).map((m) => m.san) : [])]);
    const rows = [...sans].map((san) => ({ san, mine: mine.get(san), lc: lcMap?.get(san), courses: (cov.map[san] || []).map((id) => LESSONS.find((o) => o.id === id)) }))
      .sort((a, b) => (b.lc ?? 0) - (a.lc ?? 0) || (b.mine?.n ?? 0) - (a.mine?.n ?? 0)).slice(0, 10);
    const card = el('div', { class: 'card' }, el('div', { class: 'label' }, cov.label));
    const tbl = el('div', { class: 'cov' });
    tbl.append(el('div', { class: 'ch' }, el('span', {}, 'Opening'), el('span', {}, lcMap ? 'Lichess' : ''), el('span', {}, 'Your games'), el('span', {}, 'Course')));
    for (const r of rows) {
      const courseCell = r.courses.length
        ? el('span', { class: 'cc' }, ...r.courses.map((o) => { const m = masteredCount(o), t = o.lines.length; const st = m === t ? 'done' : o.lines.some((_, i) => prog(o, i).seen) ? 'wip' : 'new'; return el('button', { class: 'cbtn ' + st, onclick: () => { S.mode = 'learn'; saveSettings(); openOpening(o.id); window.scrollTo(0, 0); }, title: o.name }, st === 'new' ? 'Learn ' + shortName(o) : `${shortName(o)} ${m}/${t}`); }))
        : el('span', { class: 'muted' }, 'General principles');
      tbl.append(el('div', { class: 'cr' + (r.courses.length && r.courses.every((o) => masteredCount(o) === 0 && !o.lines.some((_, i) => prog(o, i).seen)) && (r.mine?.n || 0) >= 10 ? ' gap' : '') },
        el('span', { class: 'cn' }, cov.names[r.san] || r.san),
        el('span', { class: 'num' }, r.lc !== undefined ? Math.round(r.lc * 100) + '%' : ''),
        el('span', { class: 'num' }, r.mine ? `${r.mine.n} · ` : '—', r.mine ? el('b', { class: r.mine.score >= 0.55 ? 'sg' : r.mine.score < 0.45 ? 'sb' : '' }, Math.round(r.mine.score * 100) + '%') : null),
        courseCell));
    }
    card.append(tbl);
    card.append(el('div', { class: 'muted foot' }, (lcMap ? 'Lichess % = how often players at your rating play it. ' : S.token ? 'Loading Lichess frequencies… ' : 'Add your Lichess token in Settings to see how often each is played. ') + 'Your games = times you faced it · your score.'));
    box.append(card);
  }

  // 3. Weak spots from your games
  const spots = weakSpots();
  const wcard = el('div', { class: 'card span2' }, el('div', { class: 'label' }, 'Weak spots in your games'),
    el('div', { class: 'muted' }, 'Positions you reached often but scored badly from. Train them against real Lichess replies.'));
  if (!spots.length) wcard.append(el('div', { class: 'muted' }, myTree ? 'No clear weak spots found.' : 'Loading your games…'));
  for (const s of spots) {
    wcard.append(el('div', { class: 'spot' },
      el('div', {}, el('span', { class: 'kind ' + (s.color === 'white' ? 'learn' : 'practice') }, 'as ' + s.color), ' ',
        el('span', { class: 'mono' }, pgnText(s.path.join(' '))),
        el('div', { class: 'muted' }, `${s.n} games · you scored ${Math.round(s.score * 100)}%` + (s.oppMove ? ` after they played ${s.path[s.path.length - 1]}` : ` after your ${s.path[s.path.length - 1]}`))),
      el('button', { class: 'btn small', onclick: () => trainFrom(s) }, 'Train')));
  }
  box.append(wcard);
  loadOvLichess();
}
function accountCard(welcome) {
  const cc = el('input', { type: 'text', placeholder: 'chess.com username', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const li = el('input', { type: 'text', placeholder: 'Lichess username', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  cc.value = S.chesscomUser || ''; li.value = S.lichessUser || '';
  const go = () => { S.chesscomUser = cc.value.trim(); S.lichessUser = li.value.trim(); saveSettings(); importGames(); };
  for (const i of [cc, li]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return el('div', { class: 'card span2 welcome' },
    el('div', { class: 'label' }, welcome ? 'Welcome' : 'Your accounts'),
    welcome ? el('div', { class: 'big' }, 'Load your games to personalise everything') : null,
    el('div', { class: 'muted' }, 'Enter your username on either site (or both). Your games are downloaded straight into this browser to find the openings you play, how you score, and your weak spots. Nothing is uploaded anywhere.'),
    el('div', { class: 'acct' }, cc, li, el('button', { class: 'btn primary', onclick: go }, 'Load my games')),
    el('div', { class: 'muted importStatus' }, ''),
    welcome ? el('div', { class: 'muted' }, 'For live Lichess move statistics, also add a free Lichess token in Settings (\u2699).') : null);
}
const shortName = (o) => o.name.replace(/^vs /, '').replace(/: .*/, '').replace(/ setup.*| vs .*/, '').replace(' Defense', '').replace(' Game', '');

// ---------- wire up ----------
document.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
  S.source = b.dataset.src; saveSettings(); outOfBook = false; renderAll();
  if (!isUserTurn() && !game.isGameOver()) opponentMove(++busy);
}));
document.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => { S.colorPref = b.dataset.color; saveSettings(); newGame({ drill }); }));
$('#newBtn').addEventListener('click', () => newGame({ drill }));
$('#undoBtn').addEventListener('click', undo);
$('#drillBtn').addEventListener('click', openDrill);
$('#setBtn').addEventListener('click', openSettings);
$('#flipBtn').addEventListener('click', () => cg.toggleOrientation());
$('#closeDrill').addEventListener('click', () => $('#drill').close());
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || S.mode !== 'play') return;
  if (e.key === 'ArrowLeft' || e.key === 'u') undo();
  if (e.key === 'n') newGame({ drill });
});
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
initSettings();
loadMyTree().then(() => {
  if (S.mode === 'overview') renderOverview();
  if (gamesMeta && !gamesMeta.pgn && Date.now() - gamesMeta.updated > 864e5 && (S.chesscomUser || S.lichessUser)) importGames({ quiet: true });
});
setMode(S.mode, true);
if (S.mode === 'play' && !S.token && S.source === 'lichess') setTimeout(() => toast('Tip: add your Lichess token in Settings for live Lichess data', 'info'), 800);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
