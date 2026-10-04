// The Openings page: a browsable catalogue with categories, and a guide to the defences
// a 1.e4 player meets. `course` links an entry to a Learn course in lessons.js.
// Moves are SAN from the start position; scripts/check-lessons.mjs checks they are legal.

export const TAG_GROUPS = [
  { key: 'style', label: 'Style', tags: ['Aggressive', 'Balanced', 'Solid'] },
  { key: 'type', label: 'Type', tags: ['Gambit', 'Tactical', 'Positional', 'System'] },
  { key: 'extra', label: 'Also', tags: ['Trappy', 'Counter-attack', 'Beginner-friendly', 'Theory-heavy'] },
];

export const CATALOG = [
  // ----- as White -----
  { name: 'Scotch Game', side: 'white', moves: 'e4 e5 Nf3 Nc6 d4', tags: ['Aggressive', 'Positional', 'Beginner-friendly'], course: 'scotch', blurb: 'Open the centre at once with 3.d4. Fast development and clear plans.' },
  { name: 'Scotch Gambit', side: 'white', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4', tags: ['Aggressive', 'Gambit', 'Trappy'], course: 'scotch-gambit', blurb: 'Delay taking back on d4 and aim straight at f7.' },
  { name: 'Italian Game (Giuoco Pianissimo)', side: 'white', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3', tags: ['Balanced', 'Positional', 'Beginner-friendly'], course: 'italian', blurb: 'Slow build-up with c3 and d3. Easy to play, rich middlegames.' },
  { name: 'Fried Liver Attack', side: 'white', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7', tags: ['Aggressive', 'Tactical', 'Trappy'], blurb: 'Sacrifice a knight on f7 to drag the king out. Only works if Black recaptures ...Nxd5.' },
  { name: 'Evans Gambit', side: 'white', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4', tags: ['Aggressive', 'Gambit'], blurb: 'Give the b-pawn to gain time for c3 and d4 and a big centre.' },
  { name: 'King’s Gambit', side: 'white', moves: 'e4 e5 f4', tags: ['Aggressive', 'Gambit', 'Theory-heavy'], blurb: 'The romantic classic: open the f-file at the cost of a pawn and some king safety.' },
  { name: 'Danish Gambit', side: 'white', moves: 'e4 e5 d4 exd4 c3', tags: ['Aggressive', 'Gambit', 'Trappy'], blurb: 'Up to two pawns for two bishops raking the board.' },
  { name: 'Vienna Game', side: 'white', moves: 'e4 e5 Nc3', tags: ['Balanced', 'Tactical'], blurb: 'Nc3 first keeps f4 ideas in reserve. Flexible and less theory than the Ruy.' },
  { name: 'Ruy Lopez', side: 'white', moves: 'e4 e5 Nf3 Nc6 Bb5', tags: ['Balanced', 'Positional', 'Theory-heavy'], blurb: 'Pressure on the e5 defender. The most deeply studied 1.e4 e5 opening.' },
  { name: 'Alapin vs Sicilian', side: 'white', moves: 'e4 c5 c3', tags: ['Solid', 'Positional', 'Beginner-friendly'], course: 'alapin', blurb: 'Prepare d4 with c3 and dodge Open Sicilian theory.' },
  { name: 'Smith–Morra Gambit', side: 'white', moves: 'e4 c5 d4 cxd4 c3', tags: ['Aggressive', 'Gambit', 'Trappy'], blurb: 'A pawn for fast development and open lines against the Sicilian.' },
  { name: 'Grand Prix Attack', side: 'white', moves: 'e4 c5 Nc3 Nc6 f4', tags: ['Aggressive', 'System'], blurb: 'f4, Nf3 and a kingside attack against the Sicilian.' },
  { name: 'French: Advance', side: 'white', moves: 'e4 e6 d4 d5 e5', tags: ['Balanced', 'Positional'], course: 'french-adv', blurb: 'Take space with e5 and keep d4 rock solid.' },
  { name: 'Caro-Kann: Advance', side: 'white', moves: 'e4 c6 d4 d5 e5', tags: ['Balanced', 'Positional'], course: 'caro-adv', blurb: 'Space with e5, then the calm Short system.' },
  { name: 'Martian Gambit', side: 'white', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6', tags: ['Aggressive', 'Gambit', 'Trappy'], course: 'martian', blurb: 'A shock knight sacrifice on e6 against the Caro-Kann. Dubious but deadly if Black is careless.' },
  { name: 'Caro-Kann: Fantasy Variation', side: 'white', moves: 'e4 c6 d4 d5 f3', tags: ['Aggressive', 'Tactical'], blurb: 'Support e4 with f3 and keep a big centre. Sharp and offbeat.' },
  { name: '150 Attack (vs Pirc)', side: 'white', moves: 'e4 d6 d4 Nf6 Nc3 g6 Be3', tags: ['Aggressive', 'System'], course: 'vs-pirc', blurb: 'Be3, Qd2, f3, castle long and storm with h4–h5.' },
  { name: 'London System', side: 'white', moves: 'd4 d5 Bf4', tags: ['Solid', 'System', 'Beginner-friendly'], course: 'london', blurb: 'The same setup against everything: d4, Bf4, e3, c3, Nd2.' },
  { name: 'Jobava London', side: 'white', moves: 'd4 d5 Nc3 Nf6 Bf4', tags: ['Aggressive', 'System', 'Trappy'], blurb: 'The London with Nc3: Nb5 and Bxc7 tricks against careless play.' },
  { name: 'Queen’s Gambit', side: 'white', moves: 'd4 d5 c4', tags: ['Balanced', 'Positional'], blurb: 'Offer the c-pawn to deflect Black from the centre. Classical and principled.' },
  { name: 'English Opening', side: 'white', moves: 'c4', tags: ['Balanced', 'Positional'], blurb: 'Control d5 from the side. Often a reversed Sicilian.' },
  { name: 'Réti Opening', side: 'white', moves: 'Nf3 d5 c4', tags: ['Solid', 'Positional'], blurb: 'Hypermodern: let Black have the centre, then undermine it.' },
  // ----- as Black -----
  { name: 'Pirc Defense', side: 'black', moves: 'e4 d6 d4 Nf6 Nc3 g6', tags: ['Balanced', 'Counter-attack'], course: 'pirc', blurb: 'Let White build a centre, then hit it with ...e5 or ...c5.' },
  { name: 'King’s Indian Defense', side: 'black', moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6', tags: ['Aggressive', 'Counter-attack', 'Theory-heavy'], course: 'kid', blurb: 'Concede the centre, then attack on the kingside with ...e5 and ...f5.' },
  { name: 'd6 setup vs 1.c4 / 1.Nf3', side: 'black', moves: 'c4 d6', tags: ['Balanced', 'System'], course: 'flank', blurb: 'Your KID-style setup against the flank openings.' },
  { name: 'Caro-Kann Defense', side: 'black', moves: 'e4 c6', tags: ['Solid', 'Positional'], course: 'caro', blurb: 'Rock-solid: ...d5 with the light bishop getting out before ...e6.' },
  { name: 'French Defense', side: 'black', moves: 'e4 e6', tags: ['Solid', 'Counter-attack'], blurb: 'A pawn chain and counterplay with ...c5 against White’s centre.' },
  { name: 'Scandinavian Defense', side: 'black', moves: 'e4 d5', tags: ['Balanced', 'Beginner-friendly'], blurb: 'Challenge e4 straight away. Simple structures, little theory.' },
  { name: 'Sicilian Najdorf', side: 'black', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', tags: ['Aggressive', 'Counter-attack', 'Theory-heavy'], blurb: 'The sharpest fight against 1.e4, and the most theory.' },
  { name: 'Sicilian Dragon', side: 'black', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', tags: ['Aggressive', 'Tactical', 'Theory-heavy'], blurb: 'Fianchetto and race: opposite-side attacks and the c-file.' },
  { name: 'Petrov Defense', side: 'black', moves: 'e4 e5 Nf3 Nf6', tags: ['Solid', 'Positional'], blurb: 'Counter-attack e4 instead of defending e5. Very drawish at top level.' },
  { name: 'Two Knights Defense', side: 'black', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6', tags: ['Balanced', 'Counter-attack', 'Tactical'], blurb: 'Hit e4 at once against the Italian. Know the Fried Liver.' },
  { name: 'Stafford Gambit', side: 'black', moves: 'e4 e5 Nf3 Nf6 Nxe5 Nc6', tags: ['Aggressive', 'Gambit', 'Trappy'], blurb: 'Pure trap territory after the Petrov. Unsound against a prepared opponent.' },
  { name: 'Englund Gambit', side: 'black', moves: 'd4 e5', tags: ['Aggressive', 'Gambit', 'Trappy'], blurb: 'A cheeky pawn offer against 1.d4 with queen tricks on b2.' },
  { name: 'Albin Countergambit', side: 'black', moves: 'd4 d5 c4 e5', tags: ['Aggressive', 'Gambit', 'Trappy'], blurb: 'Hit back at the Queen’s Gambit; the Lasker Trap underpromotion is famous.' },
  { name: 'Budapest Gambit', side: 'black', moves: 'd4 Nf6 c4 e5', tags: ['Aggressive', 'Gambit', 'Trappy'], blurb: 'Active pieces and traps for a pawn against 1.d4 2.c4.' },
  { name: 'Queen’s Gambit Declined', side: 'black', moves: 'd4 d5 c4 e6', tags: ['Solid', 'Positional'], blurb: 'Hold d5 with ...e6. Classical and trustworthy.' },
  { name: 'Slav Defense', side: 'black', moves: 'd4 d5 c4 c6', tags: ['Solid', 'Positional'], blurb: 'Support d5 with ...c6 and keep the light bishop free.' },
  { name: 'Dutch Defense', side: 'black', moves: 'd4 f5', tags: ['Aggressive', 'Counter-attack'], blurb: 'Grab e4 with the f-pawn and aim for a kingside attack.' },
  { name: 'Nimzo-Indian Defense', side: 'black', moves: 'd4 Nf6 c4 e6 Nc3 Bb4', tags: ['Balanced', 'Positional', 'Theory-heavy'], blurb: 'Pin the c3 knight and fight for e4 with pieces.' },
  { name: 'Alekhine Defense', side: 'black', moves: 'e4 Nf6', tags: ['Aggressive', 'Counter-attack'], blurb: 'Provoke White’s pawns forward, then attack them.' },
  { name: 'Modern Defense', side: 'black', moves: 'e4 g6', tags: ['Balanced', 'Counter-attack'], blurb: 'Fianchetto first and decide on ...d6, ...c6 or ...e5 later.' },
];

// What a 1.e4 player meets, and how to handle it. `courses` link to Learn.
export const WHITE_DEFENSES = [
  { name: '1...e5 (Open Game)', moves: 'e4 e5', courses: ['scotch', 'scotch-gambit', 'italian'],
    text: 'The most common reply. You go 2.Nf3 and 3.d4 (Scotch) or 3...exd4 4.Bc4 (Scotch Gambit). Also know the Petrov (2...Nf6: after 3.Nxe5 d6 retreat 4.Nf3 before anything else), the Philidor (2...d6: just d4 and develop) and the Stafford traps (stay calm with d3 and Be2).' },
  { name: '1...c5 Sicilian', moves: 'e4 c5', courses: ['alapin'],
    text: 'Black fights for d4 from the side and unbalances the game. The Alapin 2.c3 prepares d4 so you avoid Open Sicilian theory. If Black’s queen recaptures on d5, gain time with Nf3, Be2 and Nc3.' },
  { name: '1...e6 French', moves: 'e4 e6', courses: ['french-adv'],
    text: 'Solid, but Black’s light bishop is locked behind e6. Push 3.e5 for space. Black will hit d4 with ...c5, ...Nc6 and ...Qb6, so keep it protected with c3 and Nf3, and watch b2 when the queen reaches b6.' },
  { name: '1...c6 Caro-Kann', moves: 'e4 c6', courses: ['caro-adv', 'martian'],
    text: 'Like the French, but the light bishop gets out with ...Bf5 first. Play 3.e5 and the calm Short system (Nf3, Be2, Be3, castle). For a surprise after 3.Nc3 dxe4 4.Nxe4 Bf5, try the Martian Gambit.' },
  { name: '1...d5 Scandinavian', moves: 'e4 d5', courses: ['scandi'],
    text: 'Take on d5. When the queen recaptures, develop with tempo: Nc3 hits it, then d4, Nf3 and Bc4. Development first; don’t chase the queen with pawns.' },
  { name: '1...d6 / 1...g6 Pirc & Modern', moves: 'e4 d6', courses: ['vs-pirc'],
    text: 'Black lets you build a big centre and plans to attack it later. Take it: d4, Nc3, Be3, Qd2 and f3 (the 150 Attack), castle long and push h4–h5.' },
  { name: '1...Nf6 Alekhine', moves: 'e4 Nf6', courses: ['alekhine'],
    text: 'Black invites e5 to chase the knight around. Kick it with e5 and d4, keep your centre protected and develop; don’t push every pawn just because you can.' },
  { name: 'Rare: 1...Nc6, 1...b6, 1...a6', moves: 'e4 Nc6', courses: [],
    text: 'No theory needed. Take the centre with d4, develop knights before bishops, castle, and punish slow play.' },
];
