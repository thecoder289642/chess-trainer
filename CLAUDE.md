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
src/catalog.js   Openings page: CATALOG (tagged by style/type/extra, optional course link) + WHITE_DEFENSES guide
src/sync.js      device sync through one private GitHub Gist: find/create/read/write + mergeDocs()
src/engine.js    Stockfish web-worker wrapper (UCI, promise queue; analyse() and topMoves() with MultiPV + PV)
src/ai.js        "Ask why" coach: Claude (@anthropic-ai/sdk, browser, user's own key) with analyze_position / show_line tools
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
  - **Engine check in lessons**: at each user move Stockfish's top 3 (depth 14, cached per FEN in `lessonEngine`) are shown with a verdict on the course move (top / fine <=0.3 / playable <=0.8 / costly) and a blue arrow when the engine's best differs. Hidden in Practice until the first try or a hint; in Practice an engine-approved alternative (within 0.25 of best) isn't counted as a mistake.
  - **Ask why** (lesson card): questions go to `claude-opus-5-5` (effort medium, streaming, server-side refusal fallback `fallbacks: "default"`) straight from the browser with the user's Anthropic API key (`S.aiKey`, Settings). Context = course, line, moves so far, course move, Stockfish top 3. Tools run in the browser: `analyze_position` (Stockfish depth 15) and `show_line` (adds a ▶ button that plays the line on the board; "Back to the lesson" restores it). Manual streaming tool loop in `CoachChat.ask`; a failed turn is dropped from history.
  - **Openings** tab: filterable catalogue (side, style, type, extras, has-course, search) with Learn / Play it / Build a course, plus the "defences you need to know as White" guide. `npm run check` validates catalogue moves, tags and course links.
  - **Device sync** (Settings): a GitHub fine-grained token with only Gists read/write; the app finds or creates a private gist `opening-trainer-sync.json`. Synced: custom courses (newest `updated` wins, deletions are tombstones in `deleted`), progress (per line, newest `last` wins), settings in `SYNCED_SETTINGS` (`settingsT`; first run counts non-default settings as changed) and the repertoire (`repT`). The gist wins ties. Pushes 3 s after a change; pulls on start, on focus and every 2 min. Tokens/keys are never synced. `#sync=<token>` link sets up a phone (read on load and on hashchange, then stripped).
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
- NEVER commit a Lichess token, an Anthropic API key, a GitHub token, or any personal game data. Never add secrets to the synced document. There must be no `mygames.json` in the repo.
- Lesson lines: the first line of each opening is the main line; the user's move must be identical in every line that reaches the same position (check-lessons enforces this). Keep notes short and practical for ~1000–1600 players. Run both checks before committing.
- Keep it a static site: no backend, no build step on Pages (commit built files).
- Mobile matters: test at 390px width with no horizontal scroll.

## Ideas / roadmap
1. Game review: paste a game link, show where you left your prepared lines and the better move.
2. "General principles" explainers for openings without a course (1...b6, 1.b3, 1.Nc3...).
3. Sync progress across devices (e.g. a free Firebase/Supabase project), keyed by username.
4. Timed drills for rapid/blitz.
5. More courses (e.g. Open Sicilian for 2.Nf3 players, Vienna, Queen's Gambit, Sicilian for Black).
