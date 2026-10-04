// Fetch a player's own games from chess.com / Lichess and turn them into opening trees.
// Tree format: { white: { fenKey: [[uci, san, w, d, b], ...] }, black: {...} }
// w/d/b are game results (white win / draw / black win), like the Lichess explorer.
import { Chess } from 'chess.js';

const MAX_PLIES = 30;
const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

function sansFromPgn(pgn) {
  const body = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, '').replace(/\{[^}]*\}/g, ' ').replace(/\([^()]*\)/g, ' ').replace(/\$\d+/g, ' ');
  return body.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}

// games: [{ color: 'white'|'black', result: '1-0'|'0-1'|'1/2-1/2', sans: [...] }]
export function buildTrees(games) {
  const raw = { white: {}, black: {} };
  let used = 0;
  for (const g of games) {
    const tree = raw[g.color];
    const c = new Chess();
    let ok = true;
    for (let i = 0; i < g.sans.length && i < MAX_PLIES; i++) {
      const k = fenKey(c.fen());
      let m;
      try { m = c.move(g.sans[i]); } catch { ok = false; break; }
      const node = (tree[k] ||= {});
      const e = (node[m.san] ||= [m.from + m.to, m.san, 0, 0, 0]);
      if (g.result === '1-0') e[2]++; else if (g.result === '0-1') e[4]++; else e[3]++;
    }
    if (ok) used++;
  }
  const out = { white: {}, black: {} };
  for (const color of ['white', 'black']) {
    for (const [k, node] of Object.entries(raw[color])) {
      const arr = Object.values(node);
      if (arr.reduce((s, a) => s + a[2] + a[3] + a[4], 0) >= 2) out[color][k] = arr;
    }
  }
  return { trees: out, used };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchChessCom(username, { maxGames = 800, maxMonths = 12, onProgress } = {}) {
  const user = username.trim().toLowerCase();
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  if (res.status === 404) throw new Error(`chess.com user "${username}" not found`);
  if (!res.ok) throw new Error('chess.com error ' + res.status);
  const archives = ((await res.json()).archives || []).slice(-maxMonths).reverse();
  const games = [];
  for (const url of archives) {
    onProgress?.(`chess.com: ${games.length} games…`);
    let r = await fetch(url);
    if (r.status === 429) { await sleep(2000); r = await fetch(url); }
    if (!r.ok) continue;
    const j = await r.json();
    for (const g of (j.games || []).reverse()) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      const color = g.white?.username?.toLowerCase() === user ? 'white' : g.black?.username?.toLowerCase() === user ? 'black' : null;
      if (!color) continue;
      if (/\[FEN /.test(g.pgn) && !/\[SetUp "0"\]/.test(g.pgn)) continue; // skip games from custom positions
      const result = (g.pgn.match(/\[Result "([^"]+)"/) || [])[1] || '*';
      games.push({ color, result, sans: sansFromPgn(g.pgn), site: 'chess.com', time: g.end_time });
      if (games.length >= maxGames) return games;
    }
  }
  return games;
}

export async function fetchLichess(username, { maxGames = 800, token, onProgress } = {}) {
  const user = username.trim();
  const params = new URLSearchParams({ max: String(maxGames), moves: 'true', pgnInJson: 'false', clocks: 'false', evals: 'false', opening: 'false', perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence' });
  const headers = { Accept: 'application/x-ndjson' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?${params}`, { headers });
  if (res.status === 404) throw new Error(`Lichess user "${username}" not found`);
  if (!res.ok) throw new Error('Lichess error ' + res.status);
  const text = await res.text();
  const games = [];
  const lower = user.toLowerCase();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let g; try { g = JSON.parse(line); } catch { continue; }
    if (g.variant !== 'standard' || g.initialFen || !g.moves) continue;
    const wn = g.players?.white?.user?.name?.toLowerCase();
    const bn = g.players?.black?.user?.name?.toLowerCase();
    const color = wn === lower ? 'white' : bn === lower ? 'black' : null;
    if (!color) continue;
    const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
    games.push({ color, result, sans: g.moves.split(' '), site: 'lichess', time: g.createdAt });
  }
  onProgress?.(`Lichess: ${games.length} games`);
  return games;
}

// PGN file of your own games: pick the colour by matching the player name
export function gamesFromPgnText(text, name) {
  const lower = name.trim().toLowerCase();
  const chunks = text.replace(/\r/g, '').split(/\n(?=\[Event )/);
  const games = [];
  for (const g of chunks) {
    const w = (g.match(/\[White "([^"]*)"/) || [])[1]?.toLowerCase();
    const b = (g.match(/\[Black "([^"]*)"/) || [])[1]?.toLowerCase();
    const color = w === lower ? 'white' : b === lower ? 'black' : null;
    if (!color) continue;
    const result = (g.match(/\[Result "([^"]+)"/) || [])[1] || '*';
    games.push({ color, result, sans: sansFromPgn(g), site: 'pgn' });
  }
  return games;
}

// Most frequent player name in a PGN (to guess who "you" are)
export function guessPgnPlayer(text) {
  const counts = {};
  for (const m of text.matchAll(/\[(?:White|Black) "([^"]+)"/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
