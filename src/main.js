import { Chess } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import { parse as parsePgn } from '@mliebelt/pgn-parser';
import { OPENINGS } from './openings.js';
import { Engine } from './engine.js';
import { LESSONS } from './lessons.js';
import { classify, explainMove, findMoves, winPct } from './explain.js';
import { CATALOG, TAG_GROUPS, WHITE_DEFENSES } from './catalog.js';
import { emptyDoc, findOrCreateGist, mergeDocs, readGist, writeGist } from './sync.js';
import { buildTrees, fetchChessCom, fetchLichess, gamesFromPgnText, guessPgnPlayer } from './games.js';

// ---------- settings ----------
const DEFAULTS = {
  source: 'lichess', ratings: [1200, 1400, 1600], speeds: ['blitz', 'rapid', 'classical'],
  token: '', engineElo: 1500, engineAfterBook: true, flagMoves: true, hideStatsMyTurn: false, showEval: false, mode: 'overview', chesscomUser: '', lichessUser: '',
  colorPref: 'white', sound: true, coach: true, syncToken: '', syncGist: '',
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('ot.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ot.' + k, JSON.stringify(v)); } catch {} },
};
const S = Object.assign({}, DEFAULTS, store.get('settings', {}));
// Settings that follow you between devices (never tokens or keys).
const SYNCED_SETTINGS = ['source', 'ratings', 'speeds', 'engineElo', 'engineAfterBook', 'flagMoves', 'hideStatsMyTurn', 'showEval', 'chesscomUser', 'lichessUser', 'colorPref', 'sound', 'coach'];
const syncedSettings = () => Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, S[k]]));
let syncApplying = false;
const saveSettings = () => {
  store.set('settings', S);
  const h = JSON.stringify(syncedSettings());
  if (!syncApplying && h !== store.get('settingsHash', null)) { store.set('settingsHash', h); store.set('settingsT', Date.now()); scheduleSync(); }
};

// One-tap device setup: open the app with #token=lip_xxx (Lichess) or #sync=<GitHub token> once;
// it is saved locally and removed from the address bar.
function readTokenFromHash() {
  const m = location.hash.match(/token=([A-Za-z0-9_]+)/);
  const sy = location.hash.match(/sync=([A-Za-z0-9_]+)/);
  if (m) { S.token = m[1]; store.set('settings', S); }
  if (sy) { S.syncToken = sy[1]; S.syncGist = ''; store.set('settings', S); }
  if (m || sy) history.replaceState(null, '', location.pathname + location.search);
  return { lichess: !!m, sync: !!sy };
}
readTokenFromHash();

const SOURCES = {
  lichess: { label: 'Lichess', short: 'Lichess players' },
  masters: { label: 'Masters', short: 'Masters games' },
  mine: { label: 'My games', short: 'My games' },
  rep: { label: 'Repertoire', short: 'My repertoire' },
  engine: { label: 'Engine', short: 'Engine only' },
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
let customCourses = store.get('customCourses', []);
let deletedCourses = store.get('deletedCourses', {});
const courses = () => [...LESSONS, ...customCourses];
const courseById = (id) => courses().find((x) => x.id === id);

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
  if (S.mode === 'learn') return learnView.screen === 'build' ? builderMove(orig, dest) : lessonUserMove(orig, dest);
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
  coach = null; cg.setAutoShapes([]);
  if (game.isCheckmate()) celebrate();
  syncBoard(); renderAll();
  if (S.flagMoves) checkUserMove(beforeFen, res, ply, gen);
  if (game.isGameOver()) return;
  if (S.coach) coachMove(beforeFen, res, ply, gen);
  else setTimeout(() => opponentMove(gen), 380);
}

async function opponentMove(gen) {
  if (gen !== busy || isUserTurn() || game.isGameOver()) return;
  setStatus('thinking');
  let stats = null, err = null;
  if (!outOfBook && S.source !== 'engine') {
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
      if (S.source !== 'engine') toast(err ? err.message + (S.engineAfterBook ? ' — engine takes over' : '') : `Out of book (${SOURCES[S.source].short})${S.engineAfterBook ? ' — engine takes over' : ''}`, err ? 'warn' : 'info');
    }
    if (!S.engineAfterBook && S.source !== 'engine') { setStatus('ended'); renderAll(); return; }
    try {
      const uci = await engineMove(game.fen());
      if (gen !== busy) return;
      if (uci) playMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }, 'engine');
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
    if (!S.coach) showWarning(ply);
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

  // engine check (the live coach does its own)
  if (S.coach) return;
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
  outOfBook = false; lastOpening = null; evalWhite = null; moveNotes = []; coach = null; review = null; cg.setAutoShapes([]);
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
  if (review) return;
  busy++; coach = null;
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
  else if (coach?.pending) t = 'Checking your move…';
  else if (coach?.waiting) t = `${CLS[coach.cls].label}! Take back or continue`;
  else if (statusMode === 'ended') t = 'Line finished — undo or start a new game';
  else t = isUserTurn() ? `Your move (${userColor})` : 'Opponent to move';
  const src = outOfBook || S.source === 'engine' ? (S.engineAfterBook || S.source === 'engine' ? engineLabel() : 'Out of book') : SOURCES[S.source].short;
  s.innerHTML = '';
  s.append(el('span', { class: 'dot ' + (isUserTurn() ? 'you' : 'them') }), el('span', {}, t), el('span', { class: 'pill' }, src));
}

function renderMoves() {
  const box = $('#moves');
  box.innerHTML = '';
  const R = review;
  const h = R ? R.hist.map((x) => x.san) : game.history();
  const startNo = 1;
  for (let i = 0; i < h.length; i += 2) {
    const row = el('div', { class: 'mrow' }, el('span', { class: 'mno' }, startNo + i / 2 + '.'));
    for (const j of [i, i + 1]) {
      if (j >= h.length) break;
      if (R) {
        const P = R.done ? R.plies[j] : null;
        row.append(el('span', { class: `mv rv-${P ? P.cls : 'none'}${R.idx === j + 1 ? ' cur' : ''}`, title: P ? CLS[P.cls].label : '', onclick: () => reviewGoto(j + 1) }, h[j] + (P ? CLS[P.cls].sym : '')));
        continue;
      }
      const n = moveNotes[j] || {};
      const sym = { rare: '?!', offrep: '?!', weak: '?!', mistake: '?', blunder: '??' }[n.flag] || '';
      row.append(el('span', { class: `mv by-${n.by || ''} f-${n.flag || 'none'}`, title: (n.notes || []).map((x) => x.text).join('\n'), onclick: () => n.flag && showWarning(j) }, h[j] + sym));
    }
    box.append(row);
  }
  const cur = box.querySelector('.cur');
  if (cur) box.scrollTop = cur.offsetTop - box.offsetTop - box.clientHeight / 2; else box.scrollTop = box.scrollHeight;
}

async function renderStats() {
  const box = $('#stats');
  const fen = game.fen();
  const myTurn = isUserTurn();
  const head = $('#statsHead');
  head.textContent = `${SOURCES[S.source].short} · ${myTurn ? 'your options' : 'their likely replies'}`;
  if (S.source === 'engine') { head.textContent = 'Engine only'; $('#opening').textContent = detectOpening() || lastOpening || 'Starting position'; box.innerHTML = ''; box.append(el('div', { class: 'muted' }, `Stockfish plays every move (strength ${eloText(S.engineElo)}). Change it above.`)); return; }
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
  const R = S.mode === 'play' && review?.done ? review : null;
  const show = S.mode === 'play' && (S.showEval || !!R);
  $('#evalbar').hidden = !show;
  if (!show) { lastEvalFen = null; return; }
  if (R) { lastEvalFen = null; return drawEval(R.evals[R.idx]); }
  if (game.isGameOver() || fen === lastEvalFen) return;
  lastEvalFen = fen;
  try {
    const r = await engine.analyse(fen, { depth: 11 });
    if (fen !== game.fen()) return;
    evalWhite = r;
    drawEval(r.cp, r.mate);
  } catch { txt.textContent = '—'; }
}
function drawEval(cpWhite, mate = null) {
  const bar = $('#evalfill'), txt = $('#evaltxt');
  const cp = Math.max(-800, Math.min(800, cpWhite));
  bar.style.height = (50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1)) + '%';
  bar.parentElement.classList.toggle('flip', userColor === 'black');
  txt.textContent = mate !== null ? '#' + mate : evalText(cpWhite);
}

function renderAll() {
  document.body.classList.toggle('mode-learn', S.mode === 'learn');
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === S.mode);
  $('#playPanel').hidden = S.mode !== 'play' || !!review;
  $('#reviewBtn').textContent = review ? 'Exit review' : 'Review';
  $('#reviewPanel').hidden = S.mode !== 'play' || !review;
  $('#learnPanel').hidden = S.mode !== 'learn';
  $('#overviewPanel').hidden = S.mode !== 'overview';
  $('#openingsPanel').hidden = S.mode !== 'openings';
  document.body.classList.toggle('mode-overview', S.mode === 'overview' || S.mode === 'openings');
  renderEval();
  if (S.mode === 'overview') { renderOverview(); return; }
  if (S.mode === 'openings') { renderOpenings(); return; }
  if (S.mode === 'learn') { renderLearn(); renderMoves(); return; }
  if (review) { renderReview(); renderMoves(); return; }
  renderStatus(); renderMoves(); renderStats(); renderSourceTabs(); renderStrength(); renderCoach(); renderResult();
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
  $('#tokenIn').value = S.token; $('#syncIn').value = S.syncToken || ''; renderSyncStatus();
  $('#ccIn').value = S.chesscomUser || ''; $('#liIn').value = S.lichessUser || '';
  $('#gamesStatus').textContent = gamesMeta ? `${gamesMeta.count} games (${gamesMeta.who}), updated ${new Date(gamesMeta.updated).toLocaleDateString()}` : 'No games loaded yet.';
  $('#eloIn').value = S.engineElo; $('#eloOut').textContent = eloText(S.engineElo); $('#coachSet').checked = S.coach;
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
  $('#eloIn').addEventListener('input', (e) => { setElo(+e.target.value); $('#eloOut').textContent = eloText(S.engineElo); });
  $('#coachSet').addEventListener('change', (e) => { S.coach = e.target.checked; saveSettings(); });
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
      store.set('repTree', repTree); store.set('repInfo', repInfo); store.set('repT', Date.now()); scheduleSync();
      $('#repStatus').textContent = `Loaded: ${r.games} chapter(s), ${r.positions} positions`;
      $('#repIn').value = '';
      toast('Repertoire saved on this device');
    } catch (e) { $('#repStatus').textContent = 'Couldn\'t read that PGN: ' + e.message; }
  });
  $('#repFile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) $('#repIn').value = await f.text(); });
  $('#repClear').addEventListener('click', () => { repTree = null; repInfo = null; store.set('repTree', null); store.set('repInfo', null); store.set('repT', Date.now()); scheduleSync(); $('#repStatus').textContent = 'No repertoire loaded'; });
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
const saveProgress = () => { store.set('progress', progress); scheduleSync(); };

function setMode(m, initial) {
  preview = null; busy++; lesson = null; builder = null; review = null; coach = null; hideWarning(); cg.setAutoShapes([]);
  S.mode = m; saveSettings();
  if (m === 'overview' || m === 'openings') { game = new Chess(); moveNotes = []; renderAll(); window.scrollTo(0, 0); return; }
  if (m === 'learn') { learnView = { screen: 'home', id: null }; game = new Chess(); moveNotes = []; userColor = 'white'; syncBoard(); renderAll(); }
  else newGame({ drill });
}

function openOpening(id) { busy++; lesson = null; cg.setAutoShapes([]); learnView = { screen: 'opening', id }; const o = courseById(id); userColor = o.side; game = new Chess(); moveNotes = []; syncBoard(); renderAll(); }

function pickPracticeLine(o) {
  const w = o.lines.map((_, i) => (mastered(o, i) ? 1 : 3) * (i === 0 ? 2 : 1) * (lesson && lesson.idx === i && o.lines.length > 1 ? 0.25 : 1));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}
function nextLearnLine(o) { const i = o.lines.findIndex((_, i) => !prog(o, i).seen); return i === -1 ? 0 : i; }

function startLine(o, idx, kind) {
  const gen = ++busy; preview = null;
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
    L.wrongHere = 0; L.showCourse = false; L.hinted = false;
    if (L.kind === 'learn') showArrow(); else drawLessonArrows();
    renderAll();
    loadLessonEngine(L);
  }
}
function showArrow() { if (lesson) { lesson.showCourse = true; drawLessonArrows(); } }

// ---------- Engine check in lessons ----------
// At each of your moves Stockfish's top choices are shown next to the course move, so a course
// built from your own habits can't quietly teach a bad move. Hidden in Practice until you've tried.
const lessonEngine = new Map(); // fen -> null (pending) | { top: [{ uci, san, cp }], courseSan, courseCp, side }
async function loadLessonEngine(L) {
  const fen = game.fen();
  if (lessonEngine.has(fen)) return;
  lessonEngine.set(fen, null);
  const course = new Chess(fen).move(L.moves[L.ply]);
  const top = await engine.topMoves(fen, { depth: 14, n: 3 }).catch(() => []);
  let courseCp = top.find((t) => t.uci === uciOf(course))?.cp;
  if (courseCp === undefined) {
    const c = new Chess(fen); c.move(course.san);
    courseCp = c.isCheckmate() ? (sideOf(fen) === 'white' ? 10000 : -10000) : (await engine.analyse(c.fen(), { depth: 12 }).catch(() => ({ cp: 0 }))).cp;
  }
  lessonEngine.set(fen, { top: top.map((t) => ({ ...t, san: sanOf(fen, t.uci) })), courseSan: course.san, courseCp, side: sideOf(fen) });
  if (lesson === L && game.fen() === fen) { drawLessonArrows(); renderAll(); }
}
const engineVisible = (L) => L.kind === 'learn' || L.wrongHere > 0 || L.hinted;
function drawLessonArrows() {
  const L = lesson; if (!L || L.done || sideOf(game.fen()) !== userColor) return;
  const shapes = [];
  const m = expectedMove();
  if (L.showCourse) shapes.push({ orig: m.from, dest: m.to, brush: 'green' });
  const E = lessonEngine.get(game.fen());
  const best = E?.top[0];
  if (best && engineVisible(L) && best.uci !== uciOf(m)) shapes.push({ orig: best.uci.slice(0, 2), dest: best.uci.slice(2, 4), brush: 'blue' });
  cg.setAutoShapes(shapes);
}
// The course move's cost against the engine's best, in pawns, from your side.
function courseLoss(E) { const s = E.side === 'white' ? 1 : -1; return Math.max(0, ((E.top[0]?.cp ?? E.courseCp) - E.courseCp) * s) / 100; }
function lessonEngineCard(L, o) {
  const E = lessonEngine.get(game.fen());
  const box = el('div', { class: 'lengine' }, el('div', { class: 'label' }, 'Engine check'));
  if (!engineVisible(L)) { box.append(el('div', { class: 'muted' }, 'Hidden while you practise. It appears after your first try.')); return box; }
  if (!E) { box.append(el('div', { class: 'muted' }, 'Stockfish is thinking…')); return box; }
  if (!E.top.length) { box.append(el('div', { class: 'muted' }, 'No engine result for this position.')); return box; }
  box.append(el('div', { class: 'etop' }, ...E.top.map((t, i) => el('span', { class: 'chip' + (i === 0 ? ' best' : '') + (t.san === E.courseSan ? ' course' : '') },
    `${i === 0 ? '★ ' : ''}${t.san} ${evalText(t.cp)}`))));
  const loss = courseLoss(E);
  const isBest = E.top[0].san === E.courseSan;
  if (isBest) box.append(el('div', { class: 'everdict good' }, `✓ ${E.courseSan} is the engine’s top move.`));
  else if (loss <= 0.3) box.append(el('div', { class: 'everdict good' }, `✓ ${E.courseSan} is fine (${loss.toFixed(1)} below ${E.top[0].san}, the blue arrow).`));
  else if (loss <= 0.8) box.append(el('div', { class: 'everdict ok' }, `${E.courseSan} is playable, but the engine prefers ${E.top[0].san} (blue arrow) by ${loss.toFixed(1)} pawns.`));
  else box.append(el('div', { class: 'everdict bad' }, `${E.courseSan} costs about ${loss.toFixed(1)} pawns. The engine plays ${E.top[0].san} (blue arrow).`,
    o.custom ? el('button', { class: 'btn small', onclick: () => openBuilder(o.id) }, 'Edit course') : null));
  return box;
}

function lessonUserMove(orig, dest) {
  const L = lesson;
  if (preview) { endPreview(); return; }
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
  const E = lessonEngine.get(game.fen());
  const s = sideOf(game.fen()) === 'white' ? 1 : -1;
  const asGood = tried && E?.top.find((t) => t.uci === uciOf(tried) && (t.cp - E.top[0].cp) * s >= -25);
  if (asGood) { // an engine-approved alternative: no penalty, but the course move is the one to learn
    L.msg = { kind: 'info', text: `${tried.san} is ${asGood === E.top[0] ? 'the engine’s top move' : 'as good as the engine’s best'} too! Your course plays ${exp.san} here (green arrow), so play that to continue.` };
    L.showCourse = true; L.wrongHere = Math.max(L.wrongHere, 1); drawLessonArrows();
    setTimeout(() => { if (lesson === L) syncBoard(); }, 250);
    renderAll();
    return;
  }
  L.mistakes++; L.wrongHere++;
  L.msg = { kind: 'bad', text: `${tried ? tried.san : 'That'} isn't the move here.` + (L.wrongHere >= 2 || L.kind === 'learn' ? ` The move is ${exp.san} (arrow).` : ' Try again.') };
  if (L.wrongHere >= 2 || L.kind === 'learn') showArrow(); else drawLessonArrows();
  tick(true);
  setTimeout(() => { if (lesson === L) syncBoard(); }, 250);
  renderAll();
}

function lessonDone() {
  const L = lesson; L.done = true;
  const p = prog(L.o, L.idx);
  p.seen = true; p.tries++; p.last = Date.now();
  if (L.kind === 'practice' && L.mistakes === 0) { p.clean++; celebrate(false); }
  if (L.kind === 'practice' && L.mistakes > 0) p.clean = 0;
  saveProgress();
  cg.setAutoShapes([]);
  renderAll();
}

function lessonHint() { if (lesson && !lesson.done && sideOf(game.fen()) === userColor) { lesson.mistakes++; lesson.hinted = true; lesson.msg = { kind: 'info', text: 'Hint shown (counts as a slip).' }; showArrow(); renderAll(); } }

function renderLearn() {
  const box = $('#learnPanel');
  box.innerHTML = '';
  if (learnView.screen === 'home') return renderLearnHome(box);
  if (learnView.screen === 'build') return renderBuilder(box);
  const o = courseById(learnView.id);
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
  box.append(el('div', { class: 'card buildcard' },
    el('div', {}, el('div', { class: 'label' }, 'Your own course'),
      el('div', { class: 'muted' }, 'Play out the lines you actually play. Popular Lichess replies and engine moves are suggested, or let it auto-build the tree for you.')),
    el('button', { class: 'btn primary', onclick: () => openBuilder() }, '+ Build a course')));
  for (const side of ['white', 'black']) {
    const list = el('div', { class: 'card olist' }, el('div', { class: 'label' }, side === 'white' ? 'As White' : 'As Black'));
    for (const o of courses().filter((x) => x.side === side)) {
      list.append(el('button', { class: 'oitem', onclick: () => openOpening(o.id) },
        el('div', { class: 'otop' }, el('b', {}, o.name), o.custom ? el('span', { class: 'tag mine' }, 'Your course') : youPlay(o) ? el('span', { class: 'tag' }, 'You play this') : null),
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
      el('button', { class: 'btn', onclick: () => startLine(o, pickPracticeLine(o), 'practice') }, 'Practice (no hints)')),
    el('div', { class: 'row gap' }, o.custom
      ? [el('button', { class: 'btn small', onclick: () => openBuilder(o.id) }, 'Edit course'), el('button', { class: 'btn small ghost', onclick: () => deleteCourse(o) }, 'Delete')]
      : el('button', { class: 'btn small', onclick: () => openBuilder(null, o), title: 'Copy these lines into your own course and change them' }, 'Make my own version')));
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
  if (yourTurn) card.append(lessonEngineCard(L, o));
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
      el('button', { class: 'btn ghost', onclick: () => startLine(o, L.idx, L.kind) }, 'Repeat'),
      el('button', { class: 'btn ghost', onclick: () => playOn(L.moves, o.side, `${o.name}: ${line.name}`), title: 'Keep playing this position against popular Lichess moves, then the engine' }, 'Play on from here')));
  } else {
    card.append(el('div', { class: 'row gap' },
      L.kind === 'practice' ? el('button', { class: 'btn small', onclick: lessonHint }, 'Hint') : null,
      el('button', { class: 'btn small ghost', onclick: () => startLine(o, L.idx, L.kind) }, 'Restart line')));
  }
  card.append(askCard(L, o));
  box.append(card);
}


// ---------- Explain a move (engine, no AI) ----------
// Like chess.com's coach: type or tap a move and get Stockfish's verdict plus plain reasons
// (material, hanging pieces, threats, development), with lines to watch on the board.
let ask = null; // { L, items: [{ q, hist, results, note, error, pending }], busy, draft, focused }
let preview = null; // { line: { label, moves }, token }
const askState = (L) => (ask && ask.L === L ? ask : (ask = { L, items: [], busy: false, draft: '', focused: false }));
const analyseForExplain = (fen, n) => engine.topMoves(fen, { depth: 14, n });
const sentence = (s) => s[0].toUpperCase() + s.slice(1) + '.';

async function askSend(L, o, q) {
  const A = askState(L);
  q = q.trim();
  if (!q || A.busy) return;
  const fen = game.fen();
  let sans = findMoves(fen, q).slice(0, 2);
  let note = '';
  if (!sans.length) {
    const myTurn = !L.done && sideOf(fen) === userColor;
    const fallback = myTurn ? expectedMove().san : lessonEngine.get(fen)?.top[0]?.san;
    if (!fallback) { A.items.push({ q, hist: game.history(), results: [], note: 'I couldn’t find a legal move in that. Try something like “Nxd4” or “Bc4 vs Nxd4”.' }); renderAll(); return; }
    sans = [fallback];
    note = `No move named, so here’s ${myTurn ? 'the course move' : 'the engine’s choice'}.`;
  }
  A.busy = true; A.draft = '';
  const item = { q, hist: game.history(), results: [], note, pending: true };
  A.items.push(item);
  renderAll();
  try { for (const san of sans) item.results.push(await explainMove(fen, san, analyseForExplain)); }
  catch { item.error = 'The engine couldn’t analyse this position.'; }
  item.pending = false; A.busy = false;
  if (lesson === L) renderAll();
}

function previewLine(ln) {
  const token = {}; preview = { line: ln, token };
  const hist = game.history();
  let k = 0; while (k < hist.length && k < ln.moves.length && hist[k] === ln.moves[k]) k++;
  const c = new Chess(); for (let i = 0; i < k; i++) c.move(ln.moves[i]);
  cg.setAutoShapes([]);
  cg.set({ fen: c.fen(), lastMove: undefined, check: false, turnColor: sideOf(c.fen()), movable: { color: undefined, dests: new Map() } });
  renderAll();
  let i = k;
  const step = () => {
    if (preview?.token !== token || i >= ln.moves.length) return;
    let m; try { m = c.move(ln.moves[i++]); } catch { return; }
    cg.set({ fen: c.fen(), lastMove: [m.from, m.to], turnColor: sideOf(c.fen()), check: c.inCheck() ? sideOf(c.fen()) : false });
    tick(!!m.captured);
    setTimeout(step, 750);
  };
  setTimeout(step, 450);
}
function endPreview() { preview = null; syncBoard(); drawLessonArrows(); renderAll(); }

function explainResult(r, hist) {
  const box = el('div', { class: 'xres cls-' + r.cls },
    el('div', { class: 'ct' }, el('span', { class: 'cbadge' }, CLS[r.cls].sym || '✓'), `${r.label}${CLS[r.cls].sym}`, el('b', {}, CLS[r.cls].label)),
    el('div', { class: 'muted' }, `Eval ${evalText(r.before)} → ${evalText(r.after)}`));
  const reasons = r.reasons.length ? r.reasons : [r.cls === 'best' || r.cls === 'excellent' ? 'a sound move that keeps the balance' : 'nothing tactical, it just isn’t the most useful move here'];
  box.append(el('ul', { class: 'xreasons' }, ...reasons.map((x) => el('li', {}, sentence(x)))));
  if (r.bestSan) box.append(el('div', { class: 'xbetter' }, `Better was ${r.bestSan}`, r.bestReasons.length ? `: it ${r.bestReasons.join(' and ')}.` : '.'));
  const lines = [{ label: `Line after ${r.san}`, moves: [...hist, ...r.line] }];
  if (r.bestSan) lines.push({ label: `Best: ${r.bestSan}`, moves: [...hist, ...r.bestLine] });
  box.append(el('div', { class: 'asklines' }, ...lines.map((ln) =>
    el('button', { class: 'chip askline' + (preview?.line.label === ln.label && preview?.line.moves.join() === ln.moves.join() ? ' on' : ''), onclick: () => previewLine(ln), title: 'Play this line on the board' }, '▶ ' + ln.label))));
  return box;
}

function askCard(L, o) {
  const A = askState(L);
  const box = el('div', { class: 'askbox' }, el('div', { class: 'label' }, 'Explain a move'));
  if (preview) box.append(el('div', { class: 'lmsg info askprev' }, `Showing: ${preview.line.label}`, el('button', { class: 'btn small', onclick: endPreview }, 'Back to the lesson')));
  const list = el('div', { class: 'asklist' });
  for (const it of A.items) {
    list.append(el('div', { class: 'askq' }, it.q));
    const a = el('div', { class: 'aska' + (it.error ? ' err' : '') });
    if (it.note) a.append(el('div', { class: 'muted' }, it.note));
    if (it.error) a.append(el('div', {}, it.error));
    for (const r of it.results) a.append(explainResult(r, it.hist));
    if (it.results.length === 2) {
      const [x, y] = it.results; const s = x.mover === 'white' ? 1 : -1;
      const diff = ((x.after - y.after) * s) / 100;
      a.append(el('div', { class: 'xcompare' }, Math.abs(diff) < 0.15 ? `${x.san} and ${y.san} are about equal.` : `${diff > 0 ? x.san : y.san} is better by about ${Math.abs(diff).toFixed(1)}.`));
    }
    if (it.pending) a.append(el('div', { class: 'muted' }, 'Stockfish is checking…'));
    if (a.childNodes.length) list.append(a);
  }
  if (A.items.length) box.append(list);
  const E = lessonEngine.get(game.fen());
  const myTurn = !L.done && sideOf(game.fen()) === userColor;
  const sugg = [];
  if (myTurn && (L.kind === 'learn' || L.wrongHere > 0 || L.hinted)) {
    const exp = expectedMove().san;
    sugg.push([`Why ${exp}?`, exp]);
    if (E?.top[0] && E.top[0].san !== exp) sugg.push([`${exp} vs ${E.top[0].san}`, `${exp} vs ${E.top[0].san}`]);
  } else if (E?.top[0]) sugg.push([`Why ${E.top[0].san}?`, E.top[0].san]);
  if (sugg.length && !A.items.length) box.append(el('div', { class: 'chips asksugg' }, ...sugg.map(([t, q]) => el('button', { class: 'chip', disabled: A.busy ? '' : null, onclick: () => askSend(L, o, q) }, t))));
  const input = el('input', { type: 'text', class: 'binput', placeholder: 'Type a move, e.g. Nxd4 or “Bc4 vs Nxd4”', maxlength: '120', 'aria-label': 'Move to explain' });
  input.value = A.draft;
  input.addEventListener('input', (e) => { A.draft = e.target.value; });
  input.addEventListener('focus', () => { A.focused = true; });
  input.addEventListener('blur', () => { A.focused = false; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') askSend(L, o, input.value); });
  box.append(el('div', { class: 'askrow' }, input, el('button', { class: 'btn primary', disabled: A.busy ? '' : null, onclick: () => askSend(L, o, input.value) }, A.busy ? '…' : 'Explain')));
  if (A.focused) setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
  return box;
}

// ---------- Course builder ----------
// Build your own course by playing moves for both sides. Saved in localStorage `ot.customCourses`
// in the same shape as LESSONS, so Learn / Practice / reviews work on it unchanged.
let builder = null; // { id, name, side, lines: [{ name, moves, note }], path: [san], sugg, auto, dirty }
const saveCustom = () => { store.set('customCourses', customCourses); store.set('deletedCourses', deletedCourses); scheduleSync(); };
const plyLabel = (i, san) => `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}${san}`;

function openBuilder(id, copyFrom, start) {
  busy++; lesson = null; hideWarning();
  const o = id ? customCourses.find((c) => c.id === id) : copyFrom;
  builder = { id: id || null, name: id ? o.name : copyFrom ? 'My ' + copyFrom.name : start ? 'My ' + start.name : '', side: o ? o.side : start ? start.side : 'white',
    lines: o ? o.lines.map((l) => ({ name: l.name, moves: l.moves, note: l.note || '' })) : [], path: [], sugg: null, auto: null, dirty: !!copyFrom };
  learnView = { screen: 'build', id: null };
  builderGoto(start ? start.path : []);
  window.scrollTo(0, 0);
}

// Your move per position and the replies already covered, for a set of lines.
function courseTree(lines, side) {
  const user = new Map(), opp = new Map();
  for (const l of lines) {
    const c = new Chess();
    for (const m of l.moves.split(' ')) {
      const k = fenKey(c.fen()); const mine = sideOf(c.fen()) === side;
      let r; try { r = c.move(m); } catch { break; }
      if (mine) { if (!user.has(k)) user.set(k, r); } else { if (!opp.has(k)) opp.set(k, new Set()); opp.get(k).add(r.san); }
    }
  }
  return { user, opp };
}

function builderGoto(path) {
  const B = builder;
  B.path = path;
  game = new Chess(); moveNotes = [];
  for (const m of path) { game.move(m); moveNotes.push({ flag: null, by: sideOf(game.fen()) === B.side ? 'book' : 'user', notes: [] }); }
  userColor = B.side;
  builderSync(); renderAll();
  loadBuilderSuggestions();
}

function builderSync() {
  const B = builder;
  const h = game.history({ verbose: true }); const last = h[h.length - 1]; const turn = sideOf(game.fen());
  cg.set({ fen: game.fen(), turnColor: turn, orientation: B.side, check: game.inCheck() ? turn : false, lastMove: last ? [last.from, last.to] : undefined,
    movable: { color: game.isGameOver() ? undefined : turn, dests: dests(game) } });
  const yours = turn === B.side && courseTree(B.lines, B.side).user.get(fenKey(game.fen()));
  cg.setAutoShapes(yours ? [{ orig: yours.from, dest: yours.to, brush: 'green' }] : []);
}

function builderMove(orig, dest) {
  const piece = game.get(orig);
  const promo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
  let res = null; try { res = new Chess(game.fen()).move({ from: orig, to: dest, promotion: promo }); } catch {}
  if (!res) { builderSync(); return; }
  tick(!!res.captured);
  builderGoto([...builder.path, res.san]);
}

function loadBuilderSuggestions() {
  const B = builder; const fen = game.fen();
  B.sugg = { fen, lichess: null, engine: null, err: null };
  if (game.isGameOver()) return;
  const live = () => builder === B && B.sugg.fen === fen && game.fen() === fen;
  if (!S.token) B.sugg.err = new SourceError('Add your Lichess token in Settings to see popular moves', 'auth');
  else getStats('lichess', fen).then((st) => { if (live()) { B.sugg.lichess = st; renderAll(); } })
    .catch((e) => { if (live()) { B.sugg.err = e; renderAll(); } });
  engine.topMoves(fen, { depth: 12, n: 3 }).then((r) => { if (live()) { B.sugg.engine = r; renderAll(); } })
    .catch(() => { if (live()) { B.sugg.engine = []; renderAll(); } });
}

// Does line `l` play a different move than `path` does, in a position where it's your move?
function conflictsWith(l, path, side) {
  const mine = new Map(); const c = new Chess();
  for (const m of path) { const k = fenKey(c.fen()); const isMine = sideOf(c.fen()) === side; const r = c.move(m); if (isMine) mine.set(k, r.san); }
  const d = new Chess();
  for (const m of l.moves.split(' ')) {
    const k = fenKey(d.fen()); let r; try { r = d.move(m); } catch { return false; }
    if (mine.has(k) && mine.get(k) !== r.san) return true;
  }
  return false;
}

// Removes lines that disagree with `path` about your move, after asking. Returns false if cancelled.
function resolveConflicts(path, { quiet = false } = {}) {
  const B = builder;
  const bad = B.lines.filter((l) => conflictsWith(l, path, B.side));
  if (!bad.length) return true;
  if (quiet) return false;
  const tree = courseTree(bad, B.side); const c = new Chess(); let msg = '';
  for (const m of path) { const k = fenKey(c.fen()); const r = c.move(m); const was = tree.user.get(k); if (was && was.san !== r.san) { msg = `Your course plays ${was.san} here, not ${r.san}.`; break; } }
  if (!confirm(`${msg} You can only have one move per position.\n\nReplace it? ${bad.length} line${bad.length > 1 ? 's' : ''} using the old move will be removed.`)) return false;
  B.lines = B.lines.filter((l) => !bad.includes(l)); B.dirty = true;
  return true;
}

function autoName(path) {
  const B = builder;
  if (!B.lines.length) return 'Main line';
  let d = 0;
  for (const l of B.lines) { const m = l.moves.split(' '); let i = 0; while (i < m.length && i < path.length && m[i] === path[i]) i++; d = Math.max(d, i); }
  if (d >= path.length) d = path.length - 1;
  return plyLabel(d, path[d]) + (path[d + 1] ? ' ' + plyLabel(d + 1, path[d + 1]) : '');
}

function builderSaveLine(path, name, note, { quiet = false } = {}) {
  const B = builder; const moves = path.join(' ');
  if (!path.length) return { skip: 'empty' };
  if (B.lines.some((l) => l.moves === moves || l.moves.startsWith(moves + ' '))) { if (!quiet) toast('That line is already in the course'); return { skip: 'covered' }; }
  if (!resolveConflicts(path, { quiet })) return { skip: 'conflict' };
  // A shorter line this one extends is replaced by it (keeping its name).
  const prefix = B.lines.find((l) => moves.startsWith(l.moves + ' '));
  const line = { name: name || prefix?.name || autoName(path), moves, note: note || prefix?.note || '' };
  if (prefix) B.lines[B.lines.indexOf(prefix)] = line; else B.lines.push(line);
  B.dirty = true;
  return { ok: true };
}

// Grows the tree from the current position: the most popular replies for your opponent
// (Lichess at your rating, or the engine's top moves without a token) and the engine's best move for you.
async function builderAuto(plies) {
  const B = builder;
  if (B.auto) return;
  if (!resolveConflicts(B.path)) return;
  const MAX = 12; const leaves = [];
  const userPos = courseTree(B.lines, B.side).user;
  { const c = new Chess(); for (const m of B.path) { const k = fenKey(c.fen()); const isMine = sideOf(c.fen()) === B.side; const r = c.move(m); if (isMine) userPos.set(k, r); } }
  const say = (t) => { B.auto = t; if (builder === B) renderAll(); };
  // Your move here: the course's, else the engine's best.
  const yourMove = async (fen) => {
    let san = userPos.get(fenKey(fen))?.san;
    if (!san) {
      const top = await engine.topMoves(fen, { depth: 13, n: 1 }).catch(() => []);
      if (!top[0]) return null;
      san = sanOf(fen, top[0].uci); userPos.set(fenKey(fen), { san });
    }
    return san;
  };
  // Their likely replies: popular at your rating, else the engine's near-equal top moves. [] = stop here.
  const theirMoves = async (fen) => {
    if (S.token) try {
      const st = await getStats('lichess', fen);
      if (st.total >= 30) return st.moves.filter((m) => m.n / st.total >= 0.12).sort((a, b) => b.n - a.n).slice(0, 3).map((m) => m.san);
      if (st.total > 0) return []; // the book has run dry: end the line here
    } catch {}
    const top = await engine.topMoves(fen, { depth: 12, n: 3 }).catch(() => []);
    return top.filter((t) => Math.abs(t.cp - top[0].cp) <= 70).map((t) => sanOf(fen, t.uci));
  };
  // Breadth-first, so the line budget is shared fairly between early branches.
  let frontier = [[...B.path]];
  for (let left = plies; left > 0 && frontier.length && builder === B; left--) {
    const next = [];
    for (let i = 0; i < frontier.length; i++) {
      if (builder !== B) return;
      const path = frontier[i];
      const c = new Chess(); for (const m of path) c.move(m);
      if (c.isGameOver()) { leaves.push(path); continue; }
      say(`Exploring ${pgnText(path.join(' ')) || 'the start'}…`);
      const fen = c.fen();
      const sans = sideOf(fen) === B.side ? [await yourMove(fen)].filter(Boolean) : await theirMoves(fen);
      const room = Math.max(1, MAX - leaves.length - next.length - (frontier.length - i - 1));
      if (!sans.length) leaves.push(path);
      else for (const san of sans.slice(0, room)) next.push([...path, san]);
    }
    frontier = next;
  }
  if (builder !== B) return;
  leaves.push(...frontier);
  let added = 0;
  for (const p of leaves) if (builderSaveLine(p, '', '', { quiet: true }).ok) added++;
  B.auto = null;
  toast(added ? `Added ${added} line${added > 1 ? 's' : ''} — check them below` : 'No new lines found from here');
  builderSync(); renderAll();
}

function builderSaveCourse() {
  const B = builder;
  if (!B.lines.length) { toast('Save at least one line first', 'warn'); return; }
  const id = B.id || 'my-' + Date.now().toString(36);
  const old = customCourses.find((c) => c.id === id);
  const course = { id, name: (B.name || '').trim() || `My ${B.side} course`, side: B.side, tag: null, custom: true, updated: Date.now(),
    blurb: `Your own course: ${B.lines.length} line${B.lines.length > 1 ? 's' : ''}.`, lines: B.lines };
  if (old && progress[id]) { // keep progress for lines that didn't change
    const np = {}; B.lines.forEach((l, i) => { const j = old.lines.findIndex((x) => x.moves === l.moves); if (j !== -1 && progress[id][j]) np[i] = progress[id][j]; });
    progress[id] = np; saveProgress();
  }
  customCourses = old ? customCourses.map((c) => (c.id === id ? course : c)) : [...customCourses, course];
  saveCustom(); builder = null;
  toast('Course saved');
  openOpening(id);
}

function deleteCourse(o) {
  if (!confirm(`Delete "${o.name}" and its progress?`)) return;
  customCourses = customCourses.filter((c) => c.id !== o.id); deletedCourses[o.id] = Date.now(); saveCustom();
  delete progress[o.id]; saveProgress();
  learnView = { screen: 'home' }; renderAll();
}

function leaveBuilder() {
  if (builder?.dirty && !confirm('Leave without saving the course?')) return;
  const id = builder?.id; builder = null;
  if (id) openOpening(id); else { learnView = { screen: 'home' }; game = new Chess(); moveNotes = []; syncBoard(); renderAll(); }
}

// Keep playing a position in Play mode: popular Lichess replies, then the engine.
function playOn(moves, side, name) {
  S.mode = 'play'; S.colorPref = side; saveSettings();
  busy++; lesson = null; builder = null; cg.setAutoShapes([]);
  newGame({ drill: { name, moves } });
  window.scrollTo(0, 0);
}

function renderBuilder(box) {
  const B = builder;
  const turn = sideOf(game.fen()); const mine = turn === B.side;
  const tree = courseTree(B.lines, B.side); const k = fenKey(game.fen());
  const yours = mine ? tree.user.get(k) : null; const covered = !mine ? tree.opp.get(k) : null;
  setStatusText(B.auto ? 'Auto-building…' : game.isGameOver() ? 'Game over' : mine ? 'Your move: what do you play here?' : 'Their move: what might they play?', mine ? 'you' : '');

  const name = el('input', { type: 'text', class: 'binput', placeholder: 'Course name, e.g. My Scotch Gambit', value: B.name });
  name.addEventListener('input', (e) => { B.name = e.target.value; B.dirty = true; });
  box.append(el('div', { class: 'card' },
    el('button', { class: 'back', onclick: leaveBuilder }, '← All openings'),
    el('h2', { class: 'otitle' }, B.id ? 'Edit course' : 'Build a course'),
    name,
    el('div', { class: 'seg3 bside', role: 'group', 'aria-label': 'Your side' }, ...['white', 'black'].map((s) =>
      el('button', { class: B.side === s ? 'on' : '', disabled: B.lines.length && B.side !== s ? '' : null, title: B.lines.length ? 'Remove all lines to change side' : '', onclick: () => { B.side = s; builderGoto(B.path); } }, `I play ${s}`))),
    el('div', { class: 'muted' }, 'Move pieces for both sides on the board. Save each line you want to learn; the green arrow shows your course move.')));

  // Position + suggestions
  const pos = el('div', { class: 'card' },
    el('div', { class: 'label' }, 'Position'),
    el('div', { class: 'mono bpath' }, B.path.length ? pgnText(B.path.join(' ')) : 'Starting position'),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn small', disabled: B.path.length ? null : '', onclick: () => builderGoto(B.path.slice(0, -1)) }, '◀ Back'),
      el('button', { class: 'btn small ghost', disabled: B.path.length ? null : '', onclick: () => builderGoto([]) }, 'Start'),
      el('button', { class: 'btn small ghost', disabled: B.path.length ? null : '', onclick: () => playOn(B.path, B.side, B.name || 'My course'), title: 'Play this position against popular Lichess moves, then the engine' }, 'Play from here')));
  if (yours) pos.append(el('div', { class: 'lmsg info' }, `In your course you play ${yours.san} here.`));
  if (covered?.size) pos.append(el('div', { class: 'muted' }, `Replies already in your course: ${[...covered].join(', ')}`));
  const sg = B.sugg && B.sugg.fen === game.fen() ? B.sugg : null;
  const play = (san) => { if (!B.auto) builderGoto([...B.path, san]); };
  if (!game.isGameOver()) {
    pos.append(el('div', { class: 'label sub' }, `Popular moves (Lichess ${S.ratings[0]}–${S.ratings[S.ratings.length - 1] + 200})`));
    if (!sg || (!sg.lichess && !sg.err)) pos.append(el('div', { class: 'muted' }, 'Loading…'));
    else if (sg.err) pos.append(el('div', { class: 'muted' }, sg.err.message), sg.err.kind === 'auth' ? el('button', { class: 'btn small', onclick: openSettings }, 'Open settings') : '');
    else if (!sg.lichess.moves.length) pos.append(el('div', { class: 'muted' }, 'No games from this position.'));
    else {
      const st = sg.lichess; const tbl = el('div', { class: 'stbl' });
      for (const m of [...st.moves].sort((a, b) => b.n - a.n).slice(0, 6)) {
        tbl.append(el('div', { class: 'sr clickable', onclick: () => play(m.san), title: 'Play ' + m.san },
          el('span', { class: 'san' }, m.san, yours?.san === m.san || covered?.has(m.san) ? ' ✓' : ''),
          el('span', { class: 'cnt' }, `${Math.round((m.n / st.total) * 100)}%`, el('small', {}, fmt(m.n))), wdlBar(m)));
      }
      pos.append(tbl);
    }
    pos.append(el('div', { class: 'label sub' }, 'Engine (Stockfish)'));
    if (!sg || !sg.engine) pos.append(el('div', { class: 'muted' }, 'Thinking…'));
    else {
      const row = el('div', { class: 'row gap' });
      for (const t of sg.engine) {
        const san = sanOf(game.fen(), t.uci);
        const ev = t.mate !== null ? '#' + t.mate : (t.cp >= 0 ? '+' : '') + (t.cp / 100).toFixed(1);
        row.append(el('button', { class: 'chip', onclick: () => play(san), title: 'Evaluation from White’s side' }, `${san}  ${ev}`));
      }
      pos.append(row);
    }
  }
  box.append(pos);

  // Save / auto-build
  const lname = el('input', { type: 'text', class: 'binput', placeholder: B.path.length ? 'Line name: ' + autoName(B.path) : 'Line name' });
  const lnote = el('input', { type: 'text', class: 'binput', placeholder: 'Note to show while learning (optional)' });
  const depth = el('select', { class: 'binput small' }, ...[[6, 'next 3 moves'], [10, 'next 5 moves'], [14, 'next 7 moves']].map(([v, t]) => el('option', { value: v }, t)));
  depth.value = '10';
  const hasMine = B.path.some((_, i) => (i % 2 === 0) === (B.side === 'white'));
  box.append(el('div', { class: 'card' },
    el('div', { class: 'label' }, 'Add to course'),
    lname, lnote,
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', disabled: hasMine && !B.auto ? null : '', onclick: () => { if (builderSaveLine(B.path, lname.value.trim(), lnote.value.trim()).ok) { toast('Line saved'); builderSync(); renderAll(); } } }, 'Save this line'),
      hasMine ? null : el('span', { class: 'muted' }, 'Play at least one of your moves first.')),
    el('div', { class: 'label sub' }, 'Or let the computer build it'),
    el('div', { class: 'muted' }, 'From this position: the most common replies at your rating (or the engine’s top moves), and the engine’s best move for you, up to 12 lines.'),
    el('div', { class: 'row gap' }, depth,
      el('button', { class: 'btn', disabled: B.auto ? '' : null, onclick: () => builderAuto(+depth.value) }, 'Auto-build from here')),
    B.auto ? el('div', { class: 'lmsg info' }, B.auto) : null));

  // Lines
  const list = el('div', { class: 'card' }, el('div', { class: 'label' }, `Lines (${B.lines.length})`));
  if (!B.lines.length) list.append(el('div', { class: 'muted' }, 'No lines yet. The first line you save is the main line.'));
  B.lines.forEach((l, i) => {
    list.append(el('div', { class: 'litem bline' + (i === 0 ? ' main' : '') + (l.moves === B.path.join(' ') ? ' on' : '') },
      el('button', { class: 'bopen', onclick: () => builderGoto(l.moves.split(' ')), title: 'Show this line on the board' }, el('b', {}, l.name), el('small', {}, pgnText(l.moves))),
      el('button', { class: 'bdel', title: 'Remove line', 'aria-label': 'Remove ' + l.name, onclick: () => { B.lines.splice(i, 1); B.dirty = true; builderSync(); renderAll(); } }, '✕')));
  });
  box.append(list);
  box.append(el('div', { class: 'row gap' },
    el('button', { class: 'btn primary', disabled: B.lines.length && !B.auto ? null : '', onclick: builderSaveCourse }, 'Save course'),
    el('button', { class: 'btn ghost', onclick: leaveBuilder }, 'Cancel')));
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
  for (const o of courses()) o.lines.forEach((l, i) => {
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
    e5: ['scotch', 'scotch-gambit', 'italian'], c5: ['alapin'], e6: ['french-adv'], c6: ['caro-adv', 'martian'], d5: ['scandi'], d6: ['vs-pirc'], g6: ['vs-pirc'], Nf6: ['alekhine'] },
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
  const started = courses().filter((o) => o.lines.some((_, i) => prog(o, i).seen));
  const totalLines = courses().reduce((s, o) => s + o.lines.length, 0);
  const mast = courses().reduce((s, o) => s + masteredCount(o), 0);
  const today = el('div', { class: 'card span2 today' },
    el('div', {}, el('div', { class: 'label' }, 'Today'),
      el('div', { class: 'big' }, due.length ? `${due.length} line${due.length > 1 ? 's' : ''} to review` : started.length ? 'Nothing due — learn something new' : 'Start with an opening below'),
      el('div', { class: 'muted' }, `${mast} of ${totalLines} lines mastered across ${courses().length} openings. Lines come back for review after 1, 3, 7, 14 and 30 days.`)),
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
    const rows = [...sans].map((san) => ({ san, mine: mine.get(san), lc: lcMap?.get(san), courses: (cov.map[san] || []).map((id) => courseById(id)) }))
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

// ---------- Engine strength ----------
// 1320+ uses Stockfish's own UCI_Elo; below that it picks among its top moves with some
// randomness (and the odd random move), since Stockfish can't limit itself further.
const ELO_PRESETS = [[600, 'Beginner'], [1000, 'Casual'], [1400, 'Club'], [1800, 'Strong'], [2200, 'Expert'], [3000, 'Max']];
const eloText = (e) => (e >= 3000 ? 'Max' : '~' + e);
const engineLabel = () => `Engine (${eloText(S.engineElo)})`;
function eloName(e) {
  if (e >= 3000) return 'Full strength Stockfish';
  if (e < 700) return 'Beginner: misses simple tactics, sometimes hangs pieces';
  if (e < 1100) return 'Casual player: knows the basics, still blunders';
  if (e < 1500) return 'Club player: solid, makes the odd mistake';
  if (e < 1900) return 'Strong club player';
  if (e < 2300) return 'Expert';
  return 'Master';
}
function setElo(v) { S.engineElo = Math.max(400, Math.min(3000, v)); saveSettings(); renderStrength(); renderStatus(); }
function initStrength() {
  $('#eloQuick').addEventListener('input', (e) => setElo(+e.target.value));
  $('#coachIn').addEventListener('change', (e) => { S.coach = e.target.checked; saveSettings(); if (!S.coach && coach?.waiting) coachContinue(); });
  $('#eloPresets').append(...ELO_PRESETS.map(([v, t]) => el('button', { 'data-elo': v, onclick: () => setElo(v) }, t)));
}
function renderStrength() {
  $('#eloQuick').value = S.engineElo;
  $('#eloQuickOut').textContent = eloText(S.engineElo);
  $('#eloName').textContent = eloName(S.engineElo) + (S.source === 'engine' ? '' : '. Plays when the book runs out.');
  for (const b of document.querySelectorAll('[data-elo]')) b.classList.toggle('on', +b.dataset.elo === S.engineElo);
  $('#coachIn').checked = S.coach;
}
async function engineMove(fen) {
  const elo = S.engineElo;
  if (elo >= 3000) return (await engine.analyse(fen, { movetime: 900 })).best;
  if (elo >= 1320) return (await engine.analyse(fen, { movetime: 600, elo })).best;
  const legal = new Chess(fen).moves({ verbose: true });
  if (Math.random() < (1320 - elo) / 3000) return uciOf(legal[Math.floor(Math.random() * legal.length)]);
  const top = await engine.topMoves(fen, { depth: 5 + Math.round((elo - 400) / 230), n: 5 });
  if (!top.length) return null;
  const s = sideOf(fen) === 'white' ? 1 : -1;
  const temp = 30 + (1320 - elo) / 4; // centipawns: higher = more willing to pick worse moves
  const w = top.map((t) => Math.exp(((t.cp - top[0].cp) * s) / temp));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) { r -= w[i]; if (r <= 0) return top[i].uci; }
  return top[0].uci;
}

// ---------- Move classification (shared by the coach and game review) ----------
const CLS = {
  best: { label: 'Best move', sym: '★' }, excellent: { label: 'Excellent', sym: '!' }, good: { label: 'Good', sym: '' },
  book: { label: 'Book move', sym: '' }, inaccuracy: { label: 'Inaccuracy', sym: '?!' }, mistake: { label: 'Mistake', sym: '?' }, blunder: { label: 'Blunder', sym: '??' },
};
const BAD = ['inaccuracy', 'mistake', 'blunder'];
const evalText = (cp) => (Math.abs(cp) >= 9000 ? (cp > 0 ? '+M' : '−M') : (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1));
const accuracy = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

// ---------- Live coach ----------
// After each of your moves the engine judges it before the opponent replies. The verdict stays in
// its own card until your next move; after a mistake or blunder the opponent waits for you.
let coach = null; // { ply, san, pending, cls, loss, bestSan, bestUci, before, after, waiting, gen }
async function coachMove(beforeFen, res, ply, gen) {
  const C = coach = { ply, san: res.san, pending: true, gen };
  renderAll();
  let top, after;
  try {
    [top] = await engine.topMoves(beforeFen, { depth: 12, n: 1 });
    after = game.isGameOver() ? null : await engine.analyse(fenAfterPly(ply), { depth: 12 });
  } catch { if (coach === C) { coach = null; renderAll(); setTimeout(() => opponentMove(gen), 200); } return; }
  if (coach !== C || gen !== busy) return;
  const isBest = !!top && top.uci === uciOf(res);
  const afterCp = after ? after.cp : 0;
  const { cls, loss } = classify(top ? top.cp : afterCp, afterCp, sideOf(beforeFen), isBest);
  Object.assign(C, { pending: false, cls, loss, before: top ? top.cp : afterCp, after: afterCp, bestUci: top?.uci, bestSan: top && !isBest ? sanOf(beforeFen, top.uci) : null, waiting: cls === 'mistake' || cls === 'blunder' });
  if (BAD.includes(cls)) { // mark it in the move list too
    const n = moveNotes[ply];
    if (n) { const map = { inaccuracy: 'weak', mistake: 'mistake', blunder: 'blunder' }; n.flag = map[cls]; n.notes.push({ text: `${CLS[cls].label}. Best was ${C.bestSan}.`, sev: cls === 'blunder' ? 4 : cls === 'mistake' ? 3 : 2 }); }
  }
  renderAll();
  if (!C.waiting) setTimeout(() => opponentMove(gen), 250);
}
function coachContinue() {
  if (!coach?.waiting) return;
  coach.waiting = false; cg.setAutoShapes([]);
  renderAll();
  opponentMove(busy);
}
function renderCoach() {
  const box = $('#coach');
  const C = coach;
  const n = C ? moveNotes[C.ply] : null;
  const bookNotes = (n?.notes || []).filter((x) => !/^(Inaccuracy|Mistake|Blunder)\./.test(x.text));
  if (!S.coach || !C) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = '';
  const moveNo = `${Math.floor(C.ply / 2) + 1}${C.ply % 2 ? '…' : '.'}`;
  if (C.pending) { box.className = 'coach'; box.append(el('div', { class: 'ct' }, `${moveNo} ${C.san}`), el('div', { class: 'muted' }, 'Checking your move…')); return; }
  box.className = 'coach cls-' + C.cls;
  box.append(el('div', { class: 'ct' }, el('span', { class: 'cbadge' }, CLS[C.cls].sym || '✓'), `${moveNo} ${C.san}${CLS[C.cls].sym}`, el('b', {}, CLS[C.cls].label)));
  const evalLine = `Eval ${evalText(C.before)} → ${evalText(C.after)}`;
  if (C.cls === 'best') box.append(el('div', {}, 'That’s the engine’s top choice. ', el('span', { class: 'muted' }, evalLine)));
  else if (!BAD.includes(C.cls)) box.append(el('div', {}, `Fine move. ${C.bestSan ? 'The engine slightly prefers ' + C.bestSan + '.' : ''} `, el('span', { class: 'muted' }, evalLine)));
  else box.append(el('div', {}, `Better was ${C.bestSan}. `, el('span', { class: 'muted' }, `${evalLine} (gave away ${Math.round(C.loss)}% winning chances)`)));
  for (const b of bookNotes) box.append(el('div', { class: 'muted' }, b.text));
  if (C.waiting) {
    box.append(el('div', { class: 'row gap' },
      el('button', { class: 'btn small primary', onclick: () => { const u = C.bestUci; undo(); if (u) cg.setAutoShapes([{ orig: u.slice(0, 2), dest: u.slice(2, 4), brush: 'green' }]); } }, 'Take back & show best'),
      el('button', { class: 'btn small', onclick: undo }, 'Take back'),
      el('button', { class: 'btn small ghost', onclick: coachContinue }, 'Continue anyway')));
  }
}

// ---------- Result + celebration ----------
function renderResult() {
  const box = $('#result');
  const over = game.isGameOver() && game.history().length > 0;
  box.hidden = !over;
  if (!over) return;
  const won = game.isCheckmate() && sideOf(game.fen()) !== userColor;
  const text = game.isCheckmate() ? (won ? 'You won by checkmate!' : 'Checkmate. You lost this one.') : game.isStalemate() ? 'Draw by stalemate' : 'Draw';
  box.className = 'card result' + (won ? ' won' : '');
  box.innerHTML = '';
  box.append(el('div', { class: 'big' }, won ? '🏆 ' : '', text),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', onclick: startReview }, 'Game review'),
      el('button', { class: 'btn', onclick: () => newGame({ drill }) }, 'New game')));
}

function fanfare() {
  if (!S.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.12;
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? 0.5 : 0.16));
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.55);
    });
  } catch {}
}

// Confetti over the page; `big` adds the "You won!" banner and a fanfare.
function celebrate(big = true) {
  if (big) {
    fanfare();
    const b = el('div', { class: 'winbanner', role: 'status' }, el('div', { class: 'wtrophy' }, '🏆'), el('b', {}, 'You won!'), el('small', {}, 'Checkmate'));
    document.querySelector('.boardwrap').append(b);
    setTimeout(() => b.classList.add('out'), 2300);
    setTimeout(() => b.remove(), 2800);
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = el('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(cv);
  const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const colors = ['#7fb069', '#e2b04a', '#6aa7e0', '#e0675a', '#f3efe6', '#c49bd8'];
  const ps = Array.from({ length: big ? 180 : 70 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.25, y: H * 0.4, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5,
    s: 6 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35, c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const life = big ? 3400 : 2200; const t0 = performance.now();
  const frame = (t) => {
    const dt = t - t0;
    x.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.globalAlpha = Math.max(0, 1 - dt / life);
      x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
    }
    if (dt < life) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- Game review ----------
// Stockfish looks at every position of the game, then each move is graded by how much
// winning chance it gave away (like chess.com's review). Step through, see the better move,
// watch the engine's line, or retry the position.
let review = null; // { hist, fens, by, color, evals[], best[], plies[], idx, done, pv }
async function startReview() {
  const hist = game.history({ verbose: true });
  if (hist.length < 2) { toast('Play a few moves first'); return; }
  busy++; coach = null; hideWarning(); cg.setAutoShapes([]);
  const R = review = { hist, fens: [startFen, ...hist.map((h) => h.after)], by: hist.map((_, i) => moveNotes[i]?.by), color: userColor, evals: [], best: [], plies: [], idx: hist.length, done: false, pv: null };
  renderAll(); reviewShow();
  for (let i = 0; i < R.fens.length; i++) {
    if (review !== R) return;
    const c = new Chess(R.fens[i]);
    if (c.isCheckmate()) { R.evals[i] = sideOf(R.fens[i]) === 'white' ? -10000 : 10000; R.best[i] = null; }
    else if (c.isDraw()) { R.evals[i] = 0; R.best[i] = null; }
    else {
      const [t] = await engine.topMoves(R.fens[i], { depth: 13, n: 1 }).catch(() => []);
      if (review !== R) return;
      R.evals[i] = t ? t.cp : (R.evals[i - 1] ?? 0); R.best[i] = t || null;
    }
    renderReview();
  }
  R.plies = R.hist.map((h, i) => {
    const mover = sideOf(R.fens[i]); const best = R.best[i];
    const isBest = !!best && best.uci === uciOf(h);
    let { cls, loss } = classify(R.evals[i], R.evals[i + 1], mover, isBest);
    if ((R.by[i] === 'drill' || R.by[i] === 'book') && loss < 6) cls = 'book';
    return { san: h.san, mover, cls, loss, best, bestSan: best && !isBest ? sanOf(R.fens[i], best.uci) : null };
  });
  R.done = true;
  R.idx = 0;
  const firstBad = R.plies.findIndex((P) => P.mover === R.color && BAD.includes(P.cls));
  R.idx = firstBad === -1 ? R.hist.length : firstBad + 1;
  renderAll(); reviewShow();
}
function exitReview() {
  if (!review) return;
  review = null; cg.setAutoShapes([]);
  syncBoard(); renderAll();
}
function reviewGoto(i) {
  const R = review; if (!R) return;
  R.idx = Math.max(0, Math.min(R.hist.length, i)); R.pv = null;
  reviewShow(); renderAll();
}
function reviewShow() {
  const R = review; const fen = R.fens[R.idx]; const p = R.idx - 1; const h = R.hist[p];
  const turn = sideOf(fen);
  cg.set({ fen, orientation: R.color, turnColor: turn, check: new Chess(fen).inCheck() ? turn : false, lastMove: h ? [h.from, h.to] : undefined, movable: { color: undefined, dests: new Map() } });
  const P = R.done ? R.plies[p] : null;
  const shapes = [];
  if (P && BAD.includes(P.cls)) shapes.push({ orig: h.from, dest: h.to, brush: 'red' });
  if (P && P.bestSan) shapes.push({ orig: P.best.uci.slice(0, 2), dest: P.best.uci.slice(2, 4), brush: 'green' });
  cg.setAutoShapes(shapes);
}
// Plays the engine's best line from before the current move, one move at a time.
function reviewPlayBest() {
  const R = review; const p = R.idx - 1; const P = R.plies[p];
  if (!P?.best?.pv) return;
  const c = new Chess(R.fens[p]);
  const pv = R.pv = { sans: [], start: p, done: false };
  cg.setAutoShapes([]);
  const moves = P.best.pv.slice(0, 8);
  let k = 0;
  const step = () => {
    if (review !== R || R.pv !== pv) return;
    if (k >= moves.length) { pv.done = true; renderReview(); return; }
    const u = moves[k++]; let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { pv.done = true; renderReview(); return; }
    cg.set({ fen: c.fen(), lastMove: [m.from, m.to], turnColor: sideOf(c.fen()), check: c.inCheck() ? sideOf(c.fen()) : false });
    tick(!!m.captured);
    pv.sans.push(m.san); renderReview();
    setTimeout(step, 800);
  };
  renderReview();
  setTimeout(step, 250);
}
function reviewRetry() {
  const R = review; const p = R.idx - 1;
  playOn(R.hist.slice(0, p).map((h) => h.san), R.color, `Retry move ${Math.floor(p / 2) + 1}`);
  toast('Find a better move than ' + R.hist[p].san);
}
function sanLine(sans, startPly) {
  return sans.map((s, i) => { const ply = startPly + i; return ply % 2 === 0 ? `${ply / 2 + 1}.${s}` : i === 0 ? `${Math.floor(ply / 2) + 1}…${s}` : s; }).join(' ');
}
function evalGraph(R) {
  const W = 300, H = 64, n = R.evals.length;
  const X = (i) => (n > 1 ? (i / (n - 1)) * W : 0);
  const Y = (cp) => H - (winPct(Math.max(-1500, Math.min(1500, cp))) / 100) * H;
  const pts = R.evals.map((cp, i) => `${X(i).toFixed(1)},${Y(cp).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'egraph'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Evaluation over the game; click to jump to a move');
  const add = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
  add('rect', { x: 0, y: 0, width: W, height: H, class: 'eg-bg' });
  add('polygon', { points: `0,${H} ${pts} ${W},${H}`, class: 'eg-white' });
  add('line', { x1: 0, x2: W, y1: H / 2, y2: H / 2, class: 'eg-mid' });
  add('line', { x1: X(R.idx), x2: X(R.idx), y1: 0, y2: H, class: 'eg-cur' });
  R.plies.forEach((P, i) => { if (P.cls === 'mistake' || P.cls === 'blunder') add('circle', { cx: X(i + 1), cy: Y(R.evals[i + 1]), r: 3.2, class: 'eg-dot rv-' + P.cls }); });
  svg.addEventListener('click', (e) => { const r = svg.getBoundingClientRect(); reviewGoto(Math.round(((e.clientX - r.left) / r.width) * (n - 1))); });
  return svg;
}
function renderReview() {
  const R = review; const box = $('#reviewPanel');
  box.innerHTML = '';
  if (!R.done) {
    const done = R.evals.length, total = R.fens.length;
    setStatusText('Analysing your game…');
    box.append(el('div', { class: 'card' },
      el('button', { class: 'back', onclick: exitReview }, '← Back to game'),
      el('h2', { class: 'otitle' }, 'Game review'),
      el('div', { class: 'muted' }, `Stockfish is checking every move (${done} of ${total})…`),
      el('div', { class: 'pbar' }, el('span', { style: `width:${(done / total) * 100}%` }))));
    return;
  }
  const side = (who) => R.plies.filter((P) => (P.mover === R.color) === (who === 'you'));
  const acc = (who) => { const ps = side(who).filter((P) => P.cls !== 'book'); return ps.length ? Math.round(ps.reduce((a, P) => a + accuracy(P.loss), 0) / ps.length) : null; };
  const count = (who, c) => side(who).filter((P) => P.cls === c).length;
  // summary
  const sum = el('div', { class: 'card' },
    el('button', { class: 'back', onclick: exitReview }, '← Back to game'),
    el('h2', { class: 'otitle' }, 'Game review'),
    el('div', { class: 'accrow' },
      el('div', {}, el('small', {}, 'You'), el('b', {}, acc('you') ?? '—', acc('you') !== null ? '%' : '')),
      el('div', {}, el('small', {}, 'Opponent'), el('b', {}, acc('them') ?? '—', acc('them') !== null ? '%' : ''))),
    el('div', { class: 'muted' }, 'Accuracy: how close your moves were to the engine’s best.'),
    evalGraph(R));
  const tbl = el('div', { class: 'rvtbl' }, el('span', {}, ''), el('small', {}, 'You'), el('small', {}, 'Them'));
  for (const c of ['best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder']) {
    tbl.append(el('span', { class: 'rvname rv-' + c }, (CLS[c].sym ? CLS[c].sym + ' ' : '') + CLS[c].label), el('b', {}, count('you', c)), el('b', { class: 'muted' }, count('them', c)));
  }
  sum.append(tbl);
  box.append(sum);
  // current move
  const p = R.idx - 1; const P = R.plies[p];
  const cur = el('div', { class: 'card rvcur' + (P ? ' cls-' + P.cls : '') });
  const nav = el('div', { class: 'row gap rvnav' },
    el('button', { class: 'btn small', onclick: () => reviewGoto(0), 'aria-label': 'First move' }, '⏮'),
    el('button', { class: 'btn small', onclick: () => reviewGoto(R.idx - 1), 'aria-label': 'Previous move' }, '◀'),
    el('button', { class: 'btn small', onclick: () => reviewGoto(R.idx + 1), 'aria-label': 'Next move' }, '▶'),
    el('button', { class: 'btn small', onclick: () => reviewGoto(R.hist.length), 'aria-label': 'Last move' }, '⏭'));
  if (!P) cur.append(el('div', { class: 'ct' }, 'Starting position'), el('div', { class: 'muted' }, 'Use ▶ or the arrow keys to step through the game.'));
  else {
    const who = P.mover === R.color ? 'You' : 'Opponent';
    cur.append(el('div', { class: 'ct' }, el('span', { class: 'cbadge' }, CLS[P.cls].sym || '✓'), `${sanLine([P.san], p)}${CLS[P.cls].sym}`, el('b', {}, CLS[P.cls].label)));
    const line = `Eval ${evalText(R.evals[p])} → ${evalText(R.evals[p + 1])}`;
    let text;
    if (P.cls === 'best') text = `${who} found the engine’s top move.`;
    else if (P.cls === 'book') text = 'A normal opening move.';
    else if (BAD.includes(P.cls)) text = `${who} gave away ${Math.round(P.loss)}% winning chances. Best was ${P.bestSan} (green arrow).`;
    else text = P.bestSan ? `Fine. The engine slightly preferred ${P.bestSan}.` : 'Fine.';
    cur.append(el('div', {}, text), el('div', { class: 'muted' }, line));
    if (R.pv) cur.append(el('div', { class: 'mono pvline' }, 'Best line: ', sanLine(R.pv.sans, R.pv.start) || '…'));
    cur.append(el('div', { class: 'row gap' },
      P.bestSan && !R.pv ? el('button', { class: 'btn small primary', onclick: reviewPlayBest }, 'Show best line') : null,
      R.pv ? el('button', { class: 'btn small', onclick: () => reviewGoto(R.idx) }, R.pv.done ? 'Back to the game' : 'Stop') : null,
      P.mover === R.color && BAD.includes(P.cls) ? el('button', { class: 'btn small', onclick: reviewRetry, title: 'Play from the position before this move' }, 'Try again') : null));
  }
  cur.append(nav);
  box.append(cur);
  // key moments
  const keys = R.plies.map((P, i) => ({ P, i })).filter(({ P }) => BAD.includes(P.cls));
  const km = el('div', { class: 'card' }, el('div', { class: 'label' }, 'Key moments'));
  if (!keys.length) km.append(el('div', { class: 'muted' }, 'No inaccuracies, mistakes or blunders. Clean game!'));
  else km.append(el('div', { class: 'chips' }, ...keys.map(({ P, i }) =>
    el('button', { class: `chip rvchip rv-${P.cls}${R.idx === i + 1 ? ' on' : ''}`, onclick: () => reviewGoto(i + 1), title: (P.mover === R.color ? 'You: ' : 'Opponent: ') + CLS[P.cls].label },
      (P.mover === R.color ? '' : '⟂ ') + sanLine([P.san], i) + CLS[P.cls].sym))));
  box.append(km);
  setStatusText(P ? `Move ${Math.floor(p / 2) + 1}: ${CLS[P.cls].label.toLowerCase()}` : 'Game review', P && P.mover === R.color ? 'you' : '');
}

// ---------- Device sync ----------
// Courses, progress, settings and the repertoire live in one private gist (src/sync.js).
// `var` so saveSettings can call scheduleSync before this section has run.
var syncTimer = null, syncRun = null, syncAgain = false, syncReady = false, syncLastErr = '';
var syncInfo = { state: 'off', msg: '' };
function localDoc() {
  return { v: 1, courses: customCourses, deleted: deletedCourses, progress, settings: syncedSettings(), settingsT: store.get('settingsT', 0),
    rep: repTree ? { tree: repTree, info: repInfo } : null, repT: store.get('repT', 0) };
}
function applyDoc(d) {
  syncApplying = true;
  customCourses = d.courses; store.set('customCourses', customCourses);
  deletedCourses = d.deleted; store.set('deletedCourses', deletedCourses);
  progress = d.progress; store.set('progress', progress);
  if (d.settings) {
    Object.assign(S, d.settings); store.set('settings', S);
    store.set('settingsT', d.settingsT); store.set('settingsHash', JSON.stringify(syncedSettings()));
  }
  repTree = d.rep?.tree || null; repInfo = d.rep?.info || null;
  store.set('repTree', repTree); store.set('repInfo', repInfo); store.set('repT', d.repT);
  syncApplying = false;
}
function scheduleSync() {
  if (!syncReady || !S.syncToken || syncApplying) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 3000);
}
function setSyncInfo(state, msg = '') { syncInfo = { state, msg }; renderSyncStatus(); }
function renderSyncStatus() {
  const e = $('#syncStatus'); if (!e) return;
  const last = store.get('syncLast', 0);
  e.textContent = !S.syncToken ? 'Sync is off.'
    : syncInfo.state === 'syncing' ? 'Syncing…'
    : syncInfo.state === 'error' ? 'Sync problem: ' + syncInfo.msg
    : last ? `Synced ${new Date(last).toLocaleString()}` : 'Sync is on.';
}
async function syncNow({ manual = false } = {}) {
  if (!S.syncToken) return;
  if (syncRun) { syncAgain = true; return syncRun; }
  syncRun = (async () => {
    setSyncInfo('syncing');
    try {
      if (!S.syncGist) { S.syncGist = await findOrCreateGist(S.syncToken, localDoc()); store.set('settings', S); }
      const remote = (await readGist(S.syncToken, S.syncGist)) || emptyDoc();
      const merged = mergeDocs(remote, localDoc()); // remote first: the shared copy wins ties
      const mj = JSON.stringify(merged);
      if (mj !== JSON.stringify(mergeDocs(localDoc(), emptyDoc()))) { applyDoc(merged); if (!builder && !lesson && !review) renderAll(); }
      if (mj !== JSON.stringify(mergeDocs(remote, emptyDoc()))) await writeGist(S.syncToken, S.syncGist, merged);
      store.set('syncLast', Date.now()); syncLastErr = '';
      setSyncInfo('idle');
      if (manual) toast('Synced');
    } catch (e) {
      setSyncInfo('error', e.message);
      if (manual || e.message !== syncLastErr) toast(e.message, 'warn');
      syncLastErr = e.message;
    } finally {
      syncRun = null;
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    }
  })();
  return syncRun;
}
function initSync() {
  syncReady = true;
  if (store.get('settingsHash', null) === null) { // first run with sync code: settings changed from the defaults count as real changes
    store.set('settingsHash', JSON.stringify(syncedSettings()));
    const defaults = Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, DEFAULTS[k]]));
    if (!store.get('settingsT', 0) && JSON.stringify(defaults) !== JSON.stringify(syncedSettings())) store.set('settingsT', 1);
  }
  $('#syncIn').addEventListener('change', (e) => {
    S.syncToken = e.target.value.trim(); S.syncGist = ''; store.set('settings', S);
    if (S.syncToken) syncNow({ manual: true }); else setSyncInfo('off');
  });
  $('#syncNowBtn').addEventListener('click', () => { S.syncToken = $('#syncIn').value.trim(); store.set('settings', S); if (S.syncToken) syncNow({ manual: true }); });
  $('#syncOffBtn').addEventListener('click', () => { S.syncToken = ''; S.syncGist = ''; store.set('settings', S); $('#syncIn').value = ''; setSyncInfo('off'); toast('Sync turned off on this device'); });
  $('#syncLinkBtn').addEventListener('click', async () => {
    if (!S.syncToken) { toast('Paste your sync token first', 'warn'); return; }
    const link = `${location.origin}${location.pathname}#sync=${S.syncToken}`;
    try { await navigator.clipboard.writeText(link); toast('Setup link copied. Open it once on your phone, and keep it private like a password.'); }
    catch { toast('Couldn’t copy. Paste the token into Settings on your phone instead.', 'warn'); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  // the setup link opened while the app is already running only changes the hash
  window.addEventListener('hashchange', () => {
    const got = readTokenFromHash();
    if (got.sync) { toast('Sync turned on for this device'); syncNow({ manual: true }); }
    else if (got.lichess) { cache.clear(); toast('Lichess token saved'); }
  });
  if (S.syncToken && !store.get('syncLast', 0)) toast('Sync turned on for this device');
  setInterval(() => { if (!document.hidden) syncNow(); }, 120000);
  if (S.syncToken) syncNow();
}

// ---------- Openings page ----------
let opFilter = { q: '', side: 'all', tags: [], courseOnly: false };
function catalogMatches(e) {
  if (opFilter.side !== 'all' && e.side !== opFilter.side) return false;
  if (opFilter.courseOnly && !e.course) return false;
  if (opFilter.tags.some((t) => !e.tags.includes(t))) return false;
  const q = opFilter.q.trim().toLowerCase();
  return !q || e.name.toLowerCase().includes(q) || e.blurb.toLowerCase().includes(q) || pgnText(e.moves).toLowerCase().includes(q);
}
const tagGroupOf = (t) => TAG_GROUPS.find((g) => g.tags.includes(t))?.key || 'extra';
function learnCourse(id) { setMode('learn'); openOpening(id); window.scrollTo(0, 0); }
function buildFrom(e) { setMode('learn'); openBuilder(null, null, { name: e.name, side: e.side, path: e.moves.split(' ') }); }
function opButtons(e, courses) {
  return el('div', { class: 'row gap' },
    ...courses.map((id) => { const o = courseById(id); return o ? el('button', { class: 'btn small primary', onclick: () => learnCourse(id) }, 'Learn: ' + shortName(o)) : null; }),
    el('button', { class: 'btn small', onclick: () => playOn(e.moves.split(' '), e.side || 'white', e.name) }, 'Play it'),
    e.side ? el('button', { class: 'btn small ghost', onclick: () => buildFrom(e), title: 'Start your own course from this position' }, 'Build a course') : null);
}
function renderOpeningsList(list) {
  list.innerHTML = '';
  const hits = CATALOG.filter(catalogMatches);
  if (!hits.length) { list.append(el('div', { class: 'muted' }, 'No openings match. Try removing a filter.')); return; }
  for (const e of hits) {
    list.append(el('div', { class: 'card opcard' },
      el('div', { class: 'optop' }, el('b', {}, e.name), el('span', { class: 'kind ' + (e.side === 'white' ? 'learn' : 'practice') }, e.side === 'white' ? 'White' : 'Black')),
      el('div', { class: 'mono opmoves' }, pgnText(e.moves)),
      el('div', { class: 'optags' }, ...e.tags.map((t) => el('span', { class: 'optag g-' + tagGroupOf(t) }, t))),
      el('div', { class: 'opblurb' }, e.blurb),
      opButtons(e, e.course ? [e.course] : [])));
  }
}
function renderOpenings() {
  const box = $('#openingsPanel');
  box.innerHTML = '';
  // defences guide
  if (opFilter.side !== 'black') {
    const guide = el('details', { class: 'card span2 dguide', open: innerWidth > 860 ? '' : null }, el('summary', {}, el('span', { class: 'label' }, 'As White (1.e4): defences you need to know')));
    const grid = el('div', { class: 'dgrid' });
    for (const d of WHITE_DEFENSES) {
      grid.append(el('div', { class: 'dcard' }, el('b', {}, d.name), el('p', {}, d.text), opButtons({ name: d.name, moves: d.moves, side: 'white' }, d.courses)));
    }
    guide.append(grid);
    box.append(guide);
  }
  // filters
  const search = el('input', { type: 'search', class: 'binput', placeholder: 'Search openings or moves…', 'aria-label': 'Search openings' });
  search.value = opFilter.q;
  const list = el('div', { class: 'oplist' });
  search.addEventListener('input', (e) => { opFilter.q = e.target.value; renderOpeningsList(list); });
  const chip = (label, on, onclick, extra = '') => el('button', { class: 'chip' + (on ? ' on' : '') + extra, onclick, 'aria-pressed': on ? 'true' : 'false' }, label);
  const filters = el('div', { class: 'card span2 opfilters' },
    el('h2', { class: 'otitle' }, 'Openings'),
    el('div', { class: 'muted' }, `${CATALOG.length} openings with their style and character. Tap a filter to narrow the list; filters combine.`),
    search,
    el('div', { class: 'seg3 opside', role: 'group', 'aria-label': 'Side' }, ...[['all', 'All'], ['white', 'As White'], ['black', 'As Black']].map(([v, t]) =>
      el('button', { class: opFilter.side === v ? 'on' : '', onclick: () => { opFilter.side = v; renderOpenings(); } }, t))),
    ...TAG_GROUPS.map((g) => el('div', { class: 'opgroup' }, el('span', { class: 'label' }, g.label),
      el('div', { class: 'chips' }, ...g.tags.map((t) => chip(t, opFilter.tags.includes(t), () => {
        opFilter.tags = opFilter.tags.includes(t) ? opFilter.tags.filter((x) => x !== t) : [...opFilter.tags, t]; renderOpenings();
      }, ' g-' + g.key))))),
    el('div', { class: 'chips' }, chip('Has a course', opFilter.courseOnly, () => { opFilter.courseOnly = !opFilter.courseOnly; renderOpenings(); }),
      opFilter.tags.length || opFilter.courseOnly || opFilter.q ? el('button', { class: 'btn small ghost', onclick: () => { opFilter = { q: '', side: opFilter.side, tags: [], courseOnly: false }; renderOpenings(); } }, 'Clear filters') : null));
  box.append(filters);
  const wrap = el('div', { class: 'span2' }, list);
  box.append(wrap);
  renderOpeningsList(list);
}

// ---------- wire up ----------
document.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
  S.source = b.dataset.src; saveSettings(); outOfBook = false; renderAll();
  if (!isUserTurn() && !game.isGameOver()) opponentMove(++busy);
}));
document.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => { S.colorPref = b.dataset.color; saveSettings(); newGame({ drill }); }));
$('#newBtn').addEventListener('click', () => newGame({ drill }));
$('#undoBtn').addEventListener('click', undo);
$('#reviewBtn').addEventListener('click', () => (review ? exitReview() : startReview()));
initStrength();
$('#drillBtn').addEventListener('click', openDrill);
$('#setBtn').addEventListener('click', openSettings);
$('#flipBtn').addEventListener('click', () => cg.toggleOrientation());
$('#closeDrill').addEventListener('click', () => $('#drill').close());
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || S.mode !== 'play') return;
  if (review) {
    if (e.key === 'ArrowLeft') reviewGoto(review.idx - 1);
    if (e.key === 'ArrowRight') reviewGoto(review.idx + 1);
    if (e.key === 'Escape') exitReview();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'u') undo();
  if (e.key === 'n') newGame({ drill });
});
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
initSettings();
initSync();
loadMyTree().then(() => {
  if (S.mode === 'overview') renderOverview();
  if (gamesMeta && !gamesMeta.pgn && Date.now() - gamesMeta.updated > 864e5 && (S.chesscomUser || S.lichessUser)) importGames({ quiet: true });
});
setMode(S.mode, true);
if (S.mode === 'play' && !S.token && S.source === 'lichess') setTimeout(() => toast('Tip: add your Lichess token in Settings for live Lichess data', 'info'), 800);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
