# Opening Trainer: project context

A chess opening trainer web app (installable PWA) hosted on GitHub Pages.
- Live: https://thecoder289642.github.io/chess-trainer/
- Repo: github.com/thecoder289642/chess-trainer (branch `main`, Pages serves the repo root)
- Owner: Neil (~1300–1400 rapid). Plays 1.e4 (Scotch 3.d4 vs 1...e5) as White; Pirc/KID setup (...d6, ...Nf6, ...g6) as Black.
- Plug and play: any player enters their chess.com and/or Lichess username and everything personalises to their games. Nothing personal is committed to the repo.

## Layout
```
index.html, app.js, app.css, sw.js, manifest.webmanifest   <- what GitHub Pages serves (app.js/app.css are BUILT, commit them)
stockfish-19-lite-single.js/.wasm, icon-*.png, apple-touch-icon.png, .nojekyll
src/main.js      app logic: modes (Overview / Learn / Play), board, sources, settings, overview, learn mode
src/games.js     fetch + parse a player's games (chess.com API, Lichess API, PGN) -> opening trees
src/lessons.js   the opening course library (Learn tab)
src/openings.js  named openings for the Play-mode "Start from" picker
src/engine.js    Stockfish web-worker wrapper (UCI, promise queue)
src/style.css    styles (imports chessground CSS from node_modules)
scripts/build.mjs        esbuild bundle -> app.js/app.css at root, copies stockfish, bumps sw.js cache version
scripts/check-lessons.mjs  validates every lesson line is legal + your moves are consistent per position
scripts/sf-check.cjs       Stockfish sanity check of every lesson line (flags user moves that drop >=0.9 pawns); ONLY=<id> checks one course
```
Everything is FLAT at the root (no `engine/` or `icons/` folders). Paths in code are relative (`stockfish-19-lite-single.js`, `icon-192.png`).

## Commands
- `npm install` then `npm run build` after any change in `src/`. Always commit the rebuilt `app.js`, `app.css`, `sw.js`.
- `npm run check` after editing `src/lessons.js` (must print ALL OK). `npm run check:engine` for a slower Stockfish check (`ONLY=scotch-gambit npm run check:engine` for one course).
- `npm run serve` -> http://localhost:8000 to test locally.

## How it works
- Libraries: chess.js (rules), @lichess-org/chessground (board), @mliebelt/pgn-parser (repertoire PGNs with variations), Stockfish 19 lite single-threaded WASM (no COOP/COEP headers needed).
- Modes:
  - **Overview**: welcome/account card if no games loaded; "Today" spaced-repetition reviews (1/3/7/14/30 days); coverage tables (opponent replies vs your first move as White, and White's first moves vs you as Black) with Lichess frequency, your games + score, and course buttons; "Weak spots" = positions from your games with n>=8 and score <45%, with a Train button (jumps to Play from that position).
  - **Learn**: courses from `src/lessons.js`. "Learn" = guided with arrows; "Practice" = from memory, wrong moves are taken back, arrow after 2 misses. Progress in localStorage `ot.progress` {openingId: {lineIdx: {seen, clean, tries, last}}}. "You play this" tag is computed from the user's games (`youPlay()`).
  - **Course builder** (Learn → "+ Build a course", "Make my own version" on a built-in course, "Edit course" on a custom one): play both sides on the board; suggestions are popular Lichess moves (token needed) and Stockfish top 3 (`engine.topMoves`, MultiPV). "Auto-build" expands breadth-first from the current position, up to 12 lines: opponent = Lichess replies with >=12% share (else engine moves within 0.7 pawns of the best), you = existing course move or engine best. One user move per position is enforced (conflicting lines are replaced after a confirm). Custom courses live in localStorage `ot.customCourses` in the LESSONS shape with `custom: true`; `courses()` = LESSONS + custom everywhere.
  - **Play extras**: engine strength 400–3000 (`engineMove`: >=1320 uses UCI_Elo, below that samples Stockfish's top 5 with a temperature plus occasional random moves, 3000 = unlimited); an "Engine" source plays every move. **Live coach** (`S.coach`, default on) grades each user move with `classify()` before the opponent replies; mistakes/blunders pause the game (Take back / Continue). **Game review** (`startReview`) runs `engine.topMoves` depth 13 on every position, grades moves by win% lost (Lichess curve; inaccuracy >=6, mistake >=12, blunder >=22), shows accuracy, eval graph, key moments, best-line playback and "Try again". Checkmating the engine triggers `celebrate()` (banner + confetti, skipped under prefers-reduced-motion).
  - "Play on from here" (end of a lesson line) / "Play from here" (builder) switch to Play with that line as the start.
  - **Play**: free play / start from an opening. Opponent replies weighted by popularity from a source: Lichess explorer (rating + speed filters), Masters, My games, or a pasted PGN repertoire. When the book ends, Stockfish plays at a set Elo. Moves are flagged as rare / weak / mistake / blunder (explorer stats + engine). Eval bar is off by default (setting).
- Personal data: games are fetched in the browser and stored only in localStorage (`ot.myTrees`, `ot.gamesMeta`), auto-refreshed daily. Settings in `ot.settings`.

## External APIs (all called from the browser; CORS works from github.io)
- Lichess opening explorer `https://explorer.lichess.ovh/{lichess|masters}?fen=...` REQUIRES `Authorization: Bearer <token>` (401 without). A token with no scopes is enough. Users paste it in Settings or open `<site>/#token=lip_...` once per device (read and stripped from the URL by `readTokenFromHash`).
- chess.com games: `https://api.chess.com/pub/player/{user}/games/archives` -> monthly archive URLs -> `games[].pgn` (filter `rules === 'chess'`).
- Lichess games: `https://lichess.org/api/games/user/{user}?moves=true&pgnInJson=false` with `Accept: application/x-ndjson`.

## Rules
- NEVER commit a Lichess token or any personal game data. There must be no `mygames.json` in the repo.
- Lesson lines: the first line of each opening is the main line; the user's move must be identical in every line that reaches the same position (check-lessons enforces this). Keep notes short and practical for ~1000–1600 players. Run both checks before committing.
- Keep it a static site: no backend, no build step on Pages (commit built files).
- Mobile matters: test at 390px width with no horizontal scroll.

## Ideas / roadmap
1. Game review: paste a game link, show where you left your prepared lines and the better move.
2. "General principles" explainers for openings without a course (1...b6, 1.b3, 1.Nc3...).
3. Sync progress across devices (e.g. a free Firebase/Supabase project), keyed by username.
4. Timed drills for rapid/blitz.
5. More courses (e.g. Open Sicilian for 2.Nf3 players, Vienna, Queen's Gambit, Sicilian for Black).
