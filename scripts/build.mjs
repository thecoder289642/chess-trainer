// Bundles src/ into app.js + app.css at the repo root (GitHub Pages serves the root).
import { build } from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', outfile: 'app.js' });
await build({ entryPoints: ['src/style.css'], bundle: true, minify: true, outfile: 'app.css' });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) copyFileSync('node_modules/stockfish/bin/' + f, f);
// bump the service-worker cache so installed apps pick up the new build
const sw = readFileSync('sw.js', 'utf8').replace(/const VERSION = 'ot-[^']*'/, `const VERSION = 'ot-${Date.now().toString(36)}'`);
writeFileSync('sw.js', sw);
console.log('built app.js, app.css; bumped sw.js cache version');
