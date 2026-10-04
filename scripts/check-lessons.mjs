import { Chess } from 'chess.js';
import { LESSONS } from '../src/lessons.js';
let ok = true;
for (const o of LESSONS) {
  const userMove = new Map();
  for (const l of o.lines) {
    const c = new Chess();
    for (const m of l.moves.split(' ')) {
      const turn = c.turn() === 'w' ? 'white' : 'black';
      const k = c.fen().split(' ').slice(0, 4).join(' ');
      let r; try { r = c.move(m); } catch { console.log('ILLEGAL', o.id, l.name, m); ok = false; break; }
      if (turn === o.side) {
        if (userMove.has(k) && userMove.get(k) !== r.san) { console.log('CONFLICT', o.id, l.name, 'pos', k, userMove.get(k), 'vs', r.san); ok = false; }
        userMove.set(k, r.san);
      }
      if (r.san !== m) console.log('SAN differs', o.id, m, r.san);
    }
  }
  console.log(o.id, o.lines.length, 'lines ok');
}
console.log(ok ? 'ALL OK' : 'PROBLEMS');
