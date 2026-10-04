import { Chess } from 'chess.js';
import { LESSONS } from '../src/lessons.js';
import { CATALOG, WHITE_DEFENSES, TAG_GROUPS } from '../src/catalog.js';
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
// Openings page: legal moves, known tags, real course ids
const ids = new Set(LESSONS.map((o) => o.id));
const tags = new Set(TAG_GROUPS.flatMap((g) => g.tags));
for (const e of [...CATALOG, ...WHITE_DEFENSES]) {
  const c = new Chess();
  for (const m of e.moves.split(' ')) { try { c.move(m); } catch { console.log('ILLEGAL catalog', e.name, m); ok = false; break; } }
  for (const id of [e.course, ...(e.courses || [])].filter(Boolean)) if (!ids.has(id)) { console.log('UNKNOWN course', e.name, id); ok = false; }
  for (const t of e.tags || []) if (!tags.has(t)) { console.log('UNKNOWN tag', e.name, t); ok = false; }
}
console.log('catalog', CATALOG.length, 'openings,', WHITE_DEFENSES.length, 'defences checked');
console.log(ok ? 'ALL OK' : 'PROBLEMS');
