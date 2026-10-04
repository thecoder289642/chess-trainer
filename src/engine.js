// Thin promise wrapper around the Stockfish web worker (UCI).
export class Engine {
  constructor(url) {
    this.url = url;
    this.queue = Promise.resolve();
    this.ready = null;
    this.failed = false;
  }
  _start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try {
        this.w = new Worker(this.url);
      } catch (e) { this.failed = true; reject(e); return; }
      this.listeners = [];
      this.w.onmessage = (e) => { const line = typeof e.data === 'string' ? e.data : ''; for (const l of [...this.listeners]) l(line); };
      this.w.onerror = (e) => { this.failed = true; reject(e); };
      this._waitFor('uciok', () => this.send('uci'))
        .then(() => this._waitFor('readyok', () => this.send('isready')))
        .then(resolve, reject);
    });
    return this.ready;
  }
  send(cmd) { this.w.postMessage(cmd); }
  _waitFor(token, kick, onLine) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (onLine) onLine(line);
        if (line.startsWith(token)) { this.listeners = this.listeners.filter((x) => x !== fn); resolve(line); }
      };
      this.listeners.push(fn);
      kick();
    });
  }
  // Returns { best: 'e2e4', cp: number (white POV), mate: number|null (white POV) }
  analyse(fen, { depth = 12, movetime = null, elo = null } = {}) {
    const job = this.queue.then(async () => {
      await this._start();
      if (elo) {
        this.send('setoption name UCI_LimitStrength value true');
        this.send('setoption name UCI_Elo value ' + Math.max(1320, Math.min(3190, elo)));
      } else {
        this.send('setoption name UCI_LimitStrength value false');
      }
      await this._waitFor('readyok', () => this.send('isready'));
      const whiteToMove = fen.split(' ')[1] === 'w';
      let cp = 0, mate = null;
      const line = await this._waitFor('bestmove', () => {
        this.send('position fen ' + fen);
        this.send(movetime ? 'go movetime ' + movetime : 'go depth ' + depth);
      }, (l) => {
        const m = l.match(/score (cp|mate) (-?\d+)/);
        if (l.startsWith('info') && m && !l.includes('lowerbound') && !l.includes('upperbound')) {
          if (m[1] === 'cp') { cp = +m[2]; mate = null; } else { mate = +m[2]; cp = mate > 0 ? 10000 : -10000; }
        }
      });
      const best = line.split(' ')[1];
      const sign = whiteToMove ? 1 : -1;
      return { best: best && best !== '(none)' ? best : null, cp: cp * sign, mate: mate === null ? null : mate * sign };
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
