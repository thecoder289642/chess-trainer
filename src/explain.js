// Engine-based move explanations, in the spirit of chess.com's game review coach: no AI,
// just Stockfish's verdict plus rules about the position (material, hanging pieces, threats,
// development, king safety). `analyse(fen, n)` must resolve to Stockfish's top n moves,
// best first: [{ uci, pv: [uci...], cp (White's view), mate }].
import { Chess } from 'chess.js';

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const HOME = { w: ['b1', 'g1', 'c1', 'f1'], b: ['b8', 'g8', 'c8', 'f8'] };
const other = (c) => (c === 'w' ? 'b' : 'w');
const sideName = (c) => (c === 'w' ? 'White' : 'Black');
const uciOf = (m) => m.from + m.to + (m.promotion || '');

// Lichess's eval-to-winning-chances curve, and the move grades built on it.
export const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
export function classify(beforeCp, afterCp, mover, isBest) {
  const s = mover === 'white' ? 1 : -1;
  const loss = Math.max(0, winPct(beforeCp * s) - winPct(afterCp * s));
  const cls = isBest ? 'best' : loss < 2 ? 'excellent' : loss < 6 ? 'good' : loss < 12 ? 'inaccuracy' : loss < 22 ? 'mistake' : 'blunder';
  return { cls, loss };
}

function material(ch, color) {
  let n = 0;
  for (const row of ch.board()) for (const p of row) if (p) n += (p.color === color ? 1 : -1) * VAL[p.type];
  return n;
}
function describeMaterial(n) {
  return { 1: 'a pawn', 2: 'about two pawns’ worth of material', 3: 'a piece', 4: 'a piece and a pawn', 5: 'a rook', 6: 'a rook and a pawn', 9: 'the queen' }[n] || `${n} points of material`;
}
export function plyLabel(fen, san) {
  const [, turn, , , , full] = fen.split(' ');
  return `${full}${turn === 'w' ? '.' : '...'}${san}`;
}
function sansFromUci(fen, ucis, max) {
  const c = new Chess(fen); const out = [];
  for (const u of ucis.slice(0, max)) { try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; } }
  return out;
}
export function lineText(fen, sans) {
  const c = new Chess(fen);
  return sans.map((s, i) => { const t = i === 0 || c.turn() === 'w' ? plyLabel(c.fen(), s) : s; c.move(s); return t; }).join(' ');
}

// Every legal move named in free text ("why not Bc4?", "nxd4 vs bc4"), in order.
export function findMoves(fen, text) {
  const legal = new Chess(fen).moves();
  const norm = (s) => s.replace(/[+#!?x]/g, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
  const byNorm = new Map(legal.map((s) => [norm(s), s]));
  const out = [];
  for (const raw of text.match(/\b(?:O-O-O|O-O|0-0-0|0-0|[KQRBNkqrbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBNqrbn])?)/g) || []) {
    const t = norm(raw).replace(/=?([qrbn])$/, (_, p) => '=' + p.toUpperCase());
    const tries = [t, t[0].toUpperCase() + t.slice(1)]; // "nf3" -> "Nf3"; "b4" stays a pawn move first
    for (const x of tries) { const san = byNorm.get(x); if (san && !out.includes(san)) { out.push(san); break; } }
  }
  return out;
}

// Plain facts about a move: what it does, what it threatens, whether it leaves something loose.
function moveFacts(fen, san) {
  const c = new Chess(fen); const me = c.turn(); const opp = other(me);
  const full = +fen.split(' ')[5];
  const m = c.move(san);
  const facts = [];
  if (c.isCheckmate()) return ['delivers checkmate'];
  if (m.flags.includes('k') || m.flags.includes('q')) facts.push('castles, tucking the king away and connecting the rooks');
  if (m.captured) facts.push(`captures the ${NAME[m.captured]} on ${m.to}`);
  if ((m.piece === 'n' || m.piece === 'b') && HOME[me].includes(m.from)) facts.push('develops a piece');
  if (m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to) && !m.captured) facts.push('takes space in the centre');
  if (m.piece === 'q' && full <= 8 && !m.captured) facts.push('brings the queen out early, where it can be chased with tempo');
  if (m.piece === 'k' && !m.flags.includes('k') && !m.flags.includes('q') && full <= 15) facts.push('moves the king and gives up castling');
  if (c.inCheck()) facts.push('gives check');
  // a piece left where it can be taken for free or by something cheaper
  if (m.piece !== 'k') {
    const att = c.attackers(m.to, opp);
    if (att.length) {
      const cheapest = Math.min(...att.map((s) => VAL[c.get(s).type]));
      if (!c.attackers(m.to, me).length || cheapest < VAL[m.piece]) facts.push(`leaves the ${NAME[m.piece]} on ${m.to} where it can be taken`);
    }
  }
  // threats: what this side could do next if it moved again
  if (!c.inCheck()) {
    const t = new Chess(c.fen());
    if (t.setTurn(me)) {
      const mates = t.moves({ verbose: true }).filter((x) => { const y = new Chess(t.fen()); y.move(x.san); return y.isCheckmate(); });
      if (mates.length) facts.push(`threatens mate with ${mates[0].san.replace('#', '')}`);
      else {
        const wins = t.moves({ verbose: true }).filter((x) => x.from === m.to && x.captured && x.captured !== 'k')
          .filter((x) => VAL[x.captured] > VAL[x.piece] || !t.attackers(x.to, opp).length || (() => { const y = new Chess(t.fen()); y.move(x.san); return !y.attackers(x.to, opp).length; })())
          .sort((a, b) => VAL[b.captured] - VAL[a.captured]);
        if (wins.length) facts.push(`attacks the ${NAME[wins[0].captured]} on ${wins[0].to}`);
      }
    }
  }
  return facts;
}

const evalOf = (r) => (r ? r.cp : 0);

// Material after the engine's line has settled: at the last move that wasn't a capture,
// so a line cut off in the middle of a trade doesn't count as winning or losing material.
function settledMaterial(fen, sans, color) {
  const c = new Chess(fen); let settled = material(c, color);
  for (const s of sans) { const m = c.move(s); if (!m.captured) settled = material(c, color); }
  return settled;
}

// Explains one move in the position `fen`. Returns everything the UI needs.
export async function explainMove(fen, san, analyse) {
  const start = new Chess(fen); const me = start.turn(); const opp = other(me);
  const mover = me === 'w' ? 'white' : 'black';
  const top = await analyse(fen, 3);
  const best = top[0];
  const c = new Chess(fen); const mv = c.move(san); const after = c.fen();
  let afterTop = null, afterCp;
  if (c.isCheckmate()) afterCp = me === 'w' ? 10000 : -10000;
  else if (c.isDraw()) afterCp = 0;
  else { afterTop = (await analyse(after, 1))[0]; afterCp = evalOf(afterTop); }
  const isBest = !!best && best.uci === uciOf(mv);
  const beforeCp = best ? best.cp : afterCp;
  const { cls, loss } = classify(beforeCp, afterCp, mover, isBest);
  const reasons = moveFacts(fen, mv.san);

  // what the engine expects next
  const line = [mv.san, ...(afterTop ? sansFromUci(after, afterTop.pv, 7) : [])];
  const fullLine = [mv.san, ...(afterTop ? sansFromUci(after, afterTop.pv, 16) : [])];
  const startMat = material(start, me);
  const net = settledMaterial(fen, fullLine, me) - startMat;
  const sound = ['best', 'excellent', 'good'].includes(cls);
  if (afterTop?.mate != null && (afterTop.mate > 0) === (me === 'w')) reasons.push('leads to a forced mate');
  else if (afterTop?.mate != null) reasons.push(`allows a forced mate by ${sideName(opp)}`);
  else if (net <= -1 && sound) reasons.push(`gives up ${describeMaterial(-net)} for activity, and the engine says it is worth it`);
  else if (net <= -1) {
    const lp = new Chess(after); let key = null;
    for (const s of line.slice(1)) { const fenNow = lp.fen(); const x = lp.move(s); if (x.color === opp && x.captured) { key = plyLabel(fenNow, x.san); break; } }
    reasons.push(`${sideName(opp)} wins ${describeMaterial(-net)}${key ? ` (starting with ${key})` : ''}`);
  } else if (net >= 1 && !mv.captured) {
    reasons.push(startMat < 0 ? `wins back ${describeMaterial(Math.min(net, -startMat))} in the main line` : `wins ${describeMaterial(net)} in the main line`);
  }
  // drop "can be taken" when the engine line shows it isn't actually lost
  const loose = reasons.findIndex((r) => r.startsWith('leaves the'));
  if (loose !== -1 && (net > -1 || sound)) reasons.splice(loose, 1);

  let bestSan = null, bestReasons = [], bestLine = null;
  if (best && !isBest) {
    bestSan = new Chess(fen).move({ from: best.uci.slice(0, 2), to: best.uci.slice(2, 4), promotion: best.uci[4] }).san;
    bestReasons = moveFacts(fen, bestSan).filter((r) => !r.startsWith('leaves the')).slice(0, 2);
    bestLine = sansFromUci(fen, best.pv, 8);
    const bnet = settledMaterial(fen, sansFromUci(fen, best.pv, 16), me) - startMat;
    const bestCaptures = /^captures/.test(bestReasons[0] || '');
    if (bnet >= 1 && !bestCaptures) bestReasons.push(startMat < 0 ? `wins back ${describeMaterial(Math.min(bnet, -startMat))}` : `wins ${describeMaterial(bnet)}`);
  }
  return { fen, san: mv.san, label: plyLabel(fen, mv.san), mover, cls, loss, before: beforeCp, after: afterCp, reasons, line, bestSan, bestReasons, bestLine,
    alternatives: top.slice(0, 3).map((t) => ({ san: sansFromUci(fen, [t.uci], 1)[0], cp: t.cp })) };
}
