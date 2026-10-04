const init = require('stockfish');
const { Chess } = require('chess.js');
(async () => {
  const { LESSONS } = await import('../src/lessons.js');
  let waiter = null; let lastScore = 0;
  const engine = await init(require('path').resolve('node_modules/stockfish/bin/stockfish-19-lite-single.js'));
  engine.listener = (l) => onLine(l);
  function onLine(l) { const m = l.match(/score cp (-?\d+)/); const mt = l.match(/score mate (-?\d+)/); if (m) lastScore = +m[1]; if (mt) lastScore = +mt[1] > 0 ? 5000 : -5000; if (l.startsWith('bestmove') && waiter) { const w = waiter; waiter = null; w(lastScore); } }
  const evalFen = (fen) => new Promise((r) => { waiter = r; engine.sendCommand('position fen ' + fen); engine.sendCommand('go depth 14'); });
  for (const o of LESSONS.filter((x) => !process.env.ONLY || x.id === process.env.ONLY)) for (const l of o.lines) {
    const c = new Chess(); const bad = [];
    for (const m of l.moves.split(' ')) {
      const mover = c.turn() === 'w' ? 'white' : 'black';
      const before = await evalFen(c.fen());
      c.move(m);
      const after = -(await evalFen(c.fen()));
      if (mover === o.side && before - after >= 90) bad.push(`${m} (${before}->${after})`);
    }
    const fin = await evalFen(c.fen()); const finW = c.turn() === 'w' ? fin : -fin;
    console.log(o.id.padEnd(10), l.name.padEnd(32), 'final(white POV)', finW, bad.length ? 'DROPS: ' + bad.join(', ') : '');
  }
  process.exit(0);
})();
