// Opening course library. Each line is a full move sequence from the start position.
// The first line of each opening is the main line; the rest are deviations worth knowing.
// Your moves must be the same in every line that reaches the same position (checked at build time).
export const LESSONS = [
  {
    id: 'scotch', name: 'Scotch Game', side: 'white', tag: 'You play this',
    blurb: 'Open the centre straight away with 3.d4 and get fast development.',
    lines: [
      { name: 'Main line: Mieses', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4', note: 'Trade on c6, push e5 to kick the f6 knight, and pin it with Qe2. c4 chases the knight again.' },
      { name: '4...Bc5: Classical', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4', note: 'Black hits d4. Defend it with Be3 and c3, then develop with Bc4.' },
      { name: '4...Qh4: Steinitz', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Qh4 Nc3 Bb4 Be2', note: 'The queen eyes e4. Nc3 and Be2 keep everything defended; Black’s queen is out too early.' },
      { name: '4...Nxd4', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nxd4 Qxd4 d6 Nc3 Nf6 Bg5', note: 'After the trade your queen sits proudly on d4. Develop fast and pin with Bg5.' },
      { name: '3...d6', moves: 'e4 e5 Nf3 Nc6 d4 d6 dxe5 dxe5 Qxd8+ Kxd8 Bc4', note: 'Trading queens costs Black the right to castle. Bc4 hits f7.' },
    ],
  },
  {
    id: 'scotch-gambit', name: 'Scotch Gambit (4.Bc4)', side: 'white', tag: null,
    blurb: 'After 3...exd4, skip Nxd4 and play 4.Bc4: develop fast, aim at f7 and take the pawn back later.',
    lines: [
      { name: 'Main line: 4...Nf6 5.e5', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Nf6 e5 d5 Bb5 Ne4 Nxd4 Bd7 Bxc6 bxc6 O-O', note: 'e5 kicks the knight, ...d5 hits your bishop. Bb5 pins c6, then win the pawn back with Nxd4 and castle.' },
      { name: '5...Ng4', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Nf6 e5 Ng4 O-O Be7 Bf4 f6 Re1', note: 'Just castle. Bf4 and Re1 hold e5; the g4 knight is offside and d4 falls later.' },
      { name: '5...Ne4', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Nf6 e5 Ne4 Qe2 Nc5 O-O Be7 Rd1', note: 'Qe2 attacks the e4 knight. Castle and Rd1 to win back d4 with pressure on the d-file.' },
      { name: '4...Bc5 5.c3 Nf6', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Bc5 c3 Nf6 e5 d5 Bb5 Ne4 cxd4 Bb6 Nc3 O-O Be3', note: 'Same e5 + Bb5 idea as the main line. cxd4 gives you a big centre; Nc3 challenges the e4 knight.' },
      { name: '4...Bc5 5.c3 dxc3?! trap', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Bc5 c3 dxc3 Bxf7+ Kxf7 Qd5+ Kf8 Qxc5+ d6 Qxc3', note: 'Greedy ...dxc3 loses the c5 bishop: Bxf7+ then Qd5+ forks king and bishop.' },
      { name: '4...Bb4+', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Bb4+ c3 dxc3 bxc3 Ba5 O-O Bb6 e5 Nge7 Ba3 O-O', note: 'Block with c3 and recapture with the b-pawn. Castle first, then e5 and Ba3 for strong pressure for the pawn.' },
      { name: '4...d6', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 d6 Nxd4 Nf6 Nc3 Be7 O-O O-O h3', note: 'A quiet reply: just take d4 back. Develop, castle and h3 stops ...Bg4.' },
      { name: '4...Be7', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Be7 Nxd4 d6 Nc3 Nf6 O-O O-O h3', note: 'Same plan: Nxd4, Nc3, castle. Transposes to the 4...d6 line.' },
    ],
  },
  {
    id: 'italian', name: 'Italian Game', side: 'white', tag: null,
    blurb: 'Bc4 aims at f7. The slow c3 + d3 plan gives a solid, easy-to-play position.',
    lines: [
      { name: 'Main line: Giuoco Pianissimo', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 h3', note: 'c3 + d3, castle, Re1, tuck the bishop on b3 and stop ...Bg4 with h3.' },
      { name: '3...Nf6: Two Knights', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7 O-O O-O Re1 d6 c3', note: 'Calm d3 defends e4. Same setup as the main line.' },
      { name: 'Two Knights with ...Bc5', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O O-O', note: 'Transposes to the familiar setup. Castle and play Re1 / h3 next.' },
      { name: '4...d6 (skipping ...Nf6)', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 d6 d4 exd4 cxd4 Bb6 Nc3', note: 'Without pressure on e4 you can grab the centre with d4.' },
      { name: '3...Nd4?! trap', moves: 'e4 e5 Nf3 Nc6 Bc4 Nd4 Nxd4 exd4 O-O', note: 'Do NOT play Nxe5? (…Qg5!). Just trade on d4 and castle.' },
      { name: '2...d6: Philidor', moves: 'e4 e5 Nf3 d6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Be2 O-O O-O', note: 'Against the Philidor, take space with d4 and develop normally.' },
      { name: '2...Nf6: Petrov', moves: 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3', note: 'After Nxe5 d6, retreat Nf3 BEFORE anything else. d4 and Bd3 challenge the e4 knight.' },
      { name: 'Stafford Gambit', moves: 'e4 e5 Nf3 Nf6 Nxe5 Nc6 Nxc6 dxc6 d3 Bc5 Be2', note: 'Stay calm: d3 and Be2 close the traps. Avoid early Bg5 or e5.' },
    ],
  },
  {
    id: 'alapin', name: 'Alapin vs Sicilian', side: 'white', tag: null,
    blurb: '2.c3 prepares d4 so you get a big centre without learning Open Sicilian theory.',
    lines: [
      { name: 'Main line: 2...d5', moves: 'e4 c5 c3 d5 exd5 Qxd5 d4 Nf6 Nf3 e6 Be2 Nc6 O-O cxd4 cxd4 Be7 Nc3 Qd6', note: 'Black’s queen comes out early; develop and gain time by hitting it with Nc3.' },
      { name: '2...Nf6', moves: 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4', note: 'Push e5 to kick the knight, then build the centre and hit d5 with Bc4.' },
      { name: '2...d6', moves: 'e4 c5 c3 d6 d4 Nf6 Bd3 Nc6 Nf3 cxd4 cxd4', note: 'Bd3 protects e4 so you keep the ideal centre.' },
      { name: '2...Nc6', moves: 'e4 c5 c3 Nc6 d4 cxd4 cxd4 d5 exd5 Qxd5 Nf3 e5 Nc3', note: 'Nc3 develops with tempo on the queen.' },
      { name: '2...e6', moves: 'e4 c5 c3 e6 d4 d5 exd5 exd5 Nf3 Nc6 Be2', note: 'A symmetrical position with easy development. Castle next.' },
      { name: '2...g6', moves: 'e4 c5 c3 g6 d4 cxd4 cxd4 d5 e5 Nc6 Nc3', note: 'Lock the centre with e5 and blunt the g7 bishop.' },
    ],
  },
  {
    id: 'french-adv', name: 'French: Advance', side: 'white', tag: null,
    blurb: 'Push e5 for space, support d4 with c3 and Nf3, and cramp Black.',
    lines: [
      { name: 'Main line: 5...Qb6 6.a3', moves: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4 Nbd2 Bd7 Be2', note: 'a3 prepares b4. After ...c4 the knight heads to d2–f1–g3 or e3 later.' },
      { name: '5...Bd7', moves: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Bd7 Be2 Nge7 O-O', note: 'Simple development. Keep the d4 point well protected.' },
      { name: '4...Qb6 early', moves: 'e4 e6 d4 d5 e5 c5 c3 Qb6 Nf3 Bd7 Be2', note: 'Same ideas: Nf3, Be2, castle.' },
    ],
  },
  {
    id: 'caro-adv', name: 'Caro-Kann: Advance', side: 'white', tag: null,
    blurb: 'Space with e5, then the calm Short system: Nf3, Be2, Be3, castle.',
    lines: [
      { name: 'Main line: Short system', moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O', note: 'Be3 protects d4 against ...c5 pressure. Castle and play c3/Nbd2.' },
      { name: '5...Nd7', moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 Nd7 O-O', note: 'Just castle; the plan is c3, Nbd2 and Nh4 to chase the bishop.' },
      { name: '3...c5', moves: 'e4 c6 d4 d5 e5 c5 dxc5 e6 Nf3 Bxc5 Bd3 Nc6 O-O', note: 'Take on c5 and develop quickly. Black has spent two moves on the c-pawn.' },
    ],
  },
  {
    id: 'martian', name: 'Martian Gambit (vs Caro-Kann)', side: 'white', tag: null,
    blurb: 'A surprise knight sacrifice on e6 against the Caro-Kann. Objectively dubious (about −1.2 if Black defends perfectly), but full of traps at club level.',
    lines: [
      { name: 'The trap: 9...Nd7?? 10.Qg6#', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6 fxe6 Bd3 Bxd3 Qxd3 Nd7 Qg6#', note: 'After the sacrifice the e8–h5 diagonal is wide open. Natural development with ...Nd7 walks into mate on g6.' },
      { name: '9...Nf6? 10.Ne5!', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6 fxe6 Bd3 Bxd3 Qxd3 Nf6 Ne5 Qd5 Qg6+ Kd8 Nf7+ Kc8 Nxh8', note: 'Ne5 threatens Qg6+ and Nf7. The king gets chased and you win the h8 rook.' },
      { name: '9...Qd5? 10.Qg6+', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6 fxe6 Bd3 Bxd3 Qxd3 Qd5 Qg6+ Kd8 Ne5 Kc8 Qe8+ Kc7 Qxf8', note: 'Check first, then Ne5 brings the knight in. The f8 bishop falls.' },
      { name: 'Best defence: 9...Qa5+!', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6 fxe6 Bd3 Bxd3 Qxd3 Qa5+ Bd2 Qf5 Qb3 Nd7 Qxb7', note: 'The queen check and ...Qf5 trade off your attack. Grab b7 and fight on: you are about a pawn worse, so only play this gambit for surprise value.' },
      { name: '7...Qd6 (declining)', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6 Qd6 Nxf8 Kxf8 Bd3 Bxd3 Qxd3', note: 'If Black refuses the knight, take the f8 bishop: Black loses the bishop pair and the right to castle.' },
      { name: '6...e6 (no ...h6)', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 e6 Bd3 Nd7 Bxg6 hxg6 Qe2', note: 'No sacrifice needed: trade on g6 and develop. Qe2 eyes e6 and prepares Bd2 and long castling.' },
      { name: '5...e6', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 e6 N5f3 Be7 Ne2 Nf6 Ng3 Bg6 Bd3', note: 'Black blocks the e6 square, so bring the knight back and develop normally.' },
      { name: '5...Nf6', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Nf6 Bd3 Bxd3 Qxd3 h6 N5f3 e6 Ne2', note: 'Trade the light bishops with Bd3 and reroute the knights. A normal Caro-Kann position.' },
    ],
  },
  {
    id: 'scandi', name: 'vs Scandinavian', side: 'white', tag: null,
    blurb: 'Take on d5, then develop with tempo by attacking the queen.',
    lines: [
      { name: 'Main line: 3...Qa5', moves: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2', note: 'Nc3 hits the queen. Bd2 sets up ideas like Nd5 against the queen on a5.' },
      { name: '3...Qd6', moves: 'e4 d5 exd5 Qxd5 Nc3 Qd6 d4 Nf6 Nf3 c6 Bc4 Bf5 O-O', note: 'Same setup: d4, Nf3, Bc4 and castle.' },
      { name: '3...Qd8', moves: 'e4 d5 exd5 Qxd5 Nc3 Qd8 d4 Nf6 Nf3 Bg4 h3 Bxf3 Qxf3', note: 'Ask the bishop with h3; you get the bishop pair.' },
      { name: '3...Qe5+', moves: 'e4 d5 exd5 Qxd5 Nc3 Qe5+ Be2 Bg4 d4 Bxe2 Ngxe2', note: 'Block with Be2; d4 then gains time on the queen.' },
      { name: '2...Nf6', moves: 'e4 d5 exd5 Nf6 d4 Nxd5 Nf3 Bg4 c4 Nb6 Be2', note: 'c4 kicks the knight and grabs space. Be2 breaks the pin.' },
    ],
  },
  {
    id: 'london', name: 'London System', side: 'white', tag: null,
    blurb: 'Same setup against almost everything: d4, Bf4, e3, c3, Nd2, Ngf3, Bd3.',
    lines: [
      { name: 'Main line vs ...d5', moves: 'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O Bd3', note: 'The pyramid c3–d4–e3. Bg3 avoids trading your good bishop.' },
      { name: 'vs King’s Indian setup', moves: 'd4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3', note: 'h3 gives the bishop a retreat square on h2.' },
      { name: '2...c5 early', moves: 'd4 d5 Bf4 c5 e3 Nc6 c3 Qb6 Qb3', note: 'Meet ...Qb6 with Qb3 to protect b2.' },
      { name: '3...Bf5', moves: 'd4 d5 Bf4 Nf6 e3 Bf5 c4 e6 Nc3', note: 'When Black copies you, c4 hits the light squares Black left behind.' },
    ],
  },
  {
    id: 'vs-pirc', name: 'vs Pirc & Modern', side: 'white', tag: null,
    blurb: 'Against ...d6 and ...g6: grab the centre, then Be3, Qd2 and f3 for a kingside attack.',
    lines: [
      { name: 'Main line: 150 Attack', moves: 'e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 O-O f3 c6 h4', note: 'Be3 + Qd2 aims at Bh6 to trade Black’s best bishop; f3 holds e4 and h4–h5 opens the h-file.' },
      { name: '4...c6 early', moves: 'e4 d6 d4 Nf6 Nc3 g6 Be3 c6 Qd2 b5 f3 Nbd7 g4', note: 'Black goes for ...b5 on the queenside. Keep building with f3 and g4.' },
      { name: '1...g6: Modern', moves: 'e4 g6 d4 Bg7 Nc3 d6 Be3 Nf6 Qd2', note: 'Different order, same plan: Be3 and Qd2.' },
      { name: '3...e5', moves: 'e4 d6 d4 Nf6 Nc3 e5 Nf3 Nbd7 Bc4 Be7 O-O O-O', note: 'If Black hits the centre with ...e5, develop normally and aim the bishop at f7.' },
    ],
  },
  {
    id: 'alekhine', name: 'vs Alekhine Defense', side: 'white', tag: null,
    blurb: '1...Nf6 invites you to chase the knight. Take space, but develop first.',
    lines: [
      { name: 'Main line: Modern variation', moves: 'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7 c4 Nb6', note: 'Nf3, Be2 and castle, then c4 kicks the knight again.' },
      { name: '4...g6', moves: 'e4 Nf6 e5 Nd5 d4 d6 Nf3 g6 Bc4 Nb6 Bb3 Bg7 Ng5', note: 'Ng5 hits f7 — Black must be careful with ...e6.' },
      { name: '4...dxe5', moves: 'e4 Nf6 e5 Nd5 d4 d6 Nf3 dxe5 Nxe5 g6 Bc4 c6 O-O Bg7', note: 'Your knight on e5 is strong; develop and castle.' },
      { name: '2...Ne4?!', moves: 'e4 Nf6 e5 Ne4 d3 Nc5 d4 Ne6', note: 'd3 kicks the knight; d4 grabs the centre with tempo.' },
    ],
  },
  {
    id: 'pirc', name: 'Pirc Defense', side: 'black', tag: 'You play this',
    blurb: '...d6, ...Nf6, ...g6, ...Bg7 and castle: let White build a centre, then hit it.',
    lines: [
      { name: 'Main line: Classical', moves: 'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O Bg4 Be3 Nc6', note: 'Pin the f3 knight with ...Bg4 and pressure d4 with ...Nc6 and ...e5.' },
      { name: 'Austrian Attack (4.f4)', moves: 'e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O Bd3 Na6 O-O c5', note: 'Castle first, then strike back with ...c5 before White’s pawns roll.' },
      { name: '150 Attack (Be3 + Qd2)', moves: 'e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 c6 f3 b5', note: 'White wants Bh6 and h4. Counter-attack on the queenside with ...c6 and ...b5.' },
      { name: '2.Nf3', moves: 'e4 d6 Nf3 Nf6 Nc3 g6 d4 Bg7 Be2 O-O O-O Bg4 Be3 Nc6', note: 'Different move order, same Classical position.' },
      { name: '3.Bd3', moves: 'e4 d6 d4 Nf6 Bd3 e5 c3 g6 Nf3 Bg7 O-O O-O', note: 'When e4 is only defended by the bishop, ...e5 hits the centre immediately.' },
    ],
  },
  {
    id: 'kid', name: 'King’s Indian setup vs 1.d4', side: 'black', tag: 'You play this',
    blurb: 'Your Pirc setup against 1.d4: ...d6, ...Nf6, ...g6, ...Bg7, castle, then ...e5.',
    lines: [
      { name: 'Main line: Classical', moves: 'd4 d6 c4 Nf6 Nc3 g6 e4 Bg7 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7', note: 'After d5 the knight goes to e7 and you attack on the kingside with ...Nd7 and ...f5.' },
      { name: 'Sämisch (f3)', moves: 'd4 d6 c4 Nf6 Nc3 g6 e4 Bg7 f3 O-O Be3 e5', note: 'Strike in the centre with ...e5 once you’ve castled.' },
      { name: 'Fianchetto (g3)', moves: 'd4 d6 c4 Nf6 Nc3 g6 g3 Bg7 Bg2 O-O Nf3 Nbd7 O-O e5', note: '...Nbd7 supports ...e5.' },
      { name: 'vs London', moves: 'd4 d6 Nf3 Nf6 Bf4 g6 e3 Bg7 h3 O-O Be2 c5 c3 Nc6 O-O', note: 'Against the London, hit d4 with ...c5 and ...Nc6.' },
      { name: '2.e4 (into the Pirc)', moves: 'd4 d6 e4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O Bg4', note: 'Transposes to your Pirc.' },
    ],
  },
  {
    id: 'flank', name: 'd6 setup vs 1.c4 / 1.Nf3', side: 'black', tag: 'You play this',
    blurb: 'Same ...d6, ...Nf6, ...g6, ...Bg7 setup against the English and Réti.',
    lines: [
      { name: 'Main line vs English', moves: 'c4 d6 Nc3 Nf6 g3 g6 Bg2 Bg7 Nf3 O-O O-O e5 d3 Nc6', note: 'Castle, then ...e5 and ...Nc6 claim the centre.' },
      { name: 'vs Réti (1.Nf3 + g3)', moves: 'Nf3 d6 g3 Nf6 Bg2 g6 O-O Bg7 d3 O-O', note: 'A quiet game. Plan ...e5 and ...Nc6 next.' },
      { name: '1.c4 then d4 & e4', moves: 'c4 d6 d4 Nf6 Nc3 g6 e4 Bg7 Nf3 O-O', note: 'Transposes into your King’s Indian.' },
      { name: '1.Nf3 then c4', moves: 'Nf3 d6 c4 Nf6 Nc3 g6 e4 Bg7 d4 O-O', note: 'Also the King’s Indian.' },
    ],
  },
  {
    id: 'caro', name: 'Caro-Kann Defense', side: 'black', tag: null,
    blurb: 'Solid ...c6 and ...d5. Develop the light bishop before ...e6.',
    lines: [
      { name: 'Main line: Classical', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6', note: 'Bishop out, then ...e6, ...Ngf6, ...Be7 and castle.' },
      { name: 'Advance (3.e5)', moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 O-O Nc6 c3 cxd4 cxd4 Nge7', note: 'Bishop outside the chain, then attack d4 with ...c5 and ...Nc6.' },
      { name: 'Exchange (3.exd5)', moves: 'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7', note: 'Develop actively; ...Bg4 before ...e6.' },
      { name: 'Panov (4.c4)', moves: 'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 Nc6 Nf3 Bg4', note: 'Pressure d4 with the knights and the pin.' },
      { name: 'Two Knights (2.Nc3 3.Nf3)', moves: 'e4 c6 Nc3 d5 Nf3 Bg4 h3 Bxf3 Qxf3 e6 d4 Nf6 Bd3 dxe4', note: 'Give the bishop for the knight and build a solid centre.' },
      { name: 'King’s Indian Attack (2.d3)', moves: 'e4 c6 d3 d5 Nd2 e5 Ngf3 Bd6', note: 'Take the centre with ...e5.' },
    ],
  },
];
