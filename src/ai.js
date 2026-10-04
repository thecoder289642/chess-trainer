// "Ask why" coach: Claude answers questions about the lesson position, checking its claims
// with the in-browser Stockfish (analyze_position) and handing the student lines to watch on
// the board (show_line). Runs entirely in the browser with the user's own Anthropic API key.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are a friendly chess coach inside an opening-trainer app. The student is roughly 1000-1600 rated and is learning an opening line on a board next to this chat.

Explain the ideas behind moves in plain language: plans, pawn structure, piece activity, king safety, and the concrete tactics that make a move good or bad. Use the analyze_position tool (Stockfish running in the student's browser) to check evaluations and concrete lines before you state them; never make up engine numbers or variations. Evaluations are in pawns from White's point of view.

When a concrete line helps, call show_line so it appears as a button the student can click to watch on the board. Prefer two or three short, well-chosen lines over many.

Keep answers short: a few sentences or a short list, under about 150 words. Plain text only; no tables or headings. Write moves in standard algebraic notation with move numbers (e.g. 4...Nf6 5.e5).`;

const TOOLS = [
  {
    name: 'analyze_position',
    description: 'Run Stockfish on the position reached after the given moves and return its top candidate moves, each with an evaluation and its main line. Use it to check any claim about which move is better or what happens after a move.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        moves: { type: 'string', description: 'Every move from the standard starting position in SAN, space separated, without move numbers, e.g. "e4 e5 Nf3 Nc6 d4 exd4 Bc4". Use an empty string for the starting position.' },
        lines: { type: 'integer', minimum: 1, maximum: 3, description: 'How many candidate moves to return (default 3).' },
      },
      required: ['moves'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_line',
    description: 'Show the student a line as a button below your answer; clicking it plays the moves out on their board. Give the whole line from the starting position.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short button label, e.g. "Why 5.Nxd4 is better".' },
        moves: { type: 'string', description: 'Every move from the standard starting position in SAN, space separated, without move numbers.' },
      },
      required: ['label', 'moves'],
      additionalProperties: false,
    },
  },
];

// Inputs stream eagerly, so the API doesn't validate them: check the shape here.
function validInput(name, input) {
  if (!input || typeof input !== 'object' || typeof input.moves !== 'string') return false;
  if (name === 'analyze_position') return input.lines === undefined || (Number.isInteger(input.lines) && input.lines >= 1 && input.lines <= 3);
  if (name === 'show_line') return typeof input.label === 'string' && input.label.length > 0;
  return false;
}

export class CoachChat {
  constructor() { this.messages = []; }

  // Sends one question and runs the tool loop until Claude answers.
  // runTool(name, input) -> Promise<string>; onText(fullTextSoFar) streams the answer.
  // Returns { text, refused }.
  async ask({ apiKey, question, context, runTool, onText }) {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const start = this.messages.length;
    this.messages.push({ role: 'user', content: `${context}\n\nStudent's question: ${question}` });
    let text = '';
    let jsonRetries = 0;
    try {
      for (let turn = 0; turn < 10; turn++) {
        const before = text;
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 32000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM,
          tools: TOOLS,
          messages: this.messages,
        });
        stream.on('text', (delta) => { text += delta; onText(text); });
        let message;
        try {
          message = await stream.finalMessage();
          jsonRetries = 0;
        } catch (err) {
          if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
          text = before; onText(text); // a tool input arrived as unparseable JSON: re-issue the turn
          continue;
        }
        if (message.stop_reason === 'refusal') return { text, refused: true };
        if (message.stop_reason === 'pause_turn') { this.messages.push({ role: 'assistant', content: message.content }); continue; }
        const uses = message.content.filter((b) => b.type === 'tool_use');
        this.messages.push({ role: 'assistant', content: message.content });
        if (message.stop_reason !== 'tool_use' || !uses.length) return { text, refused: false };
        const results = [];
        for (const u of uses) {
          if (!validInput(u.name, u.input)) {
            results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(u.input) }) });
            continue;
          }
          try { results.push({ type: 'tool_result', tool_use_id: u.id, content: await runTool(u.name, u.input) }); }
          catch (e) { results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: String(e.message || e) }); }
        }
        this.messages.push({ role: 'user', content: results });
        if (text && !text.endsWith('\n')) { text += '\n\n'; onText(text); }
      }
      return { text, refused: false };
    } catch (err) {
      this.messages.length = start; // drop the unanswered turn so the history stays valid
      throw err;
    }
  }
}

// A short, user-facing message for an API failure.
export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Your Anthropic API key was rejected. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key isn’t allowed to use this model.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Anthropic (offline?).';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  return 'Something went wrong: ' + (err?.message || err);
}
