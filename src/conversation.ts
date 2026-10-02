import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * Turns a session branch into the transcript that the `/recap` and `/summary` model reads.
 *
 * Only what the user typed and what the agent said is kept.
 * Tool calls, tool results, thinking, images, and extension messages are dropped:
 * they cost tokens and pull the output toward file names instead of what happened.
 */

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/**
 * One huge paste or code dump must not push the rest of the chat out of the budget.
 * The head usually holds the intent and the tail the conclusion, so both are kept.
 */
const MAX_TURN_CHARS = 8_000;

const SKILL_BLOCK = /^<skill name="([^"]+)" location="[^"]*">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/;

interface TextBlock {
  type?: string;
  text?: string;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const block = part as TextBlock;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

/** A skill run stores the whole skill file in the user message. The user only typed the command and its arguments. */
function collapseSkillInvocation(text: string): string {
  const match = text.match(SKILL_BLOCK);
  if (!match) return text;
  const [, name, userArguments] = match;
  return userArguments ? `/skill:${name} ${userArguments.trim()}` : `/skill:${name}`;
}

export function clipTurnText(text: string, maxChars: number = MAX_TURN_CHARS): string {
  if (text.length <= maxChars) return text;
  const marker = "\n[…cut…]\n";
  const headLength = Math.floor((maxChars - marker.length) * (2 / 3));
  const tailLength = maxChars - marker.length - headLength;
  return `${text.slice(0, headLength)}${marker}${text.slice(text.length - tailLength)}`;
}

/** Pull user and assistant text out of a session branch, oldest first. */
export function collectTurns(entries: readonly SessionEntry[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;
    let text = extractText(entry.message.content);
    if (role === "user") text = collapseSkillInvocation(text);
    if (text.length > 0) turns.push({ role, text: clipTurnText(text) });
  }
  return turns;
}

/**
 * Render turns as a transcript that fits inside `maxChars`.
 *
 * The first user turn always stays, because it says what the session is for.
 * The rest of the budget fills from the newest turn backwards,
 * because the current state matters most for both a recap and a summary.
 */
export function renderConversation(turns: readonly Turn[], maxChars: number): string {
  if (turns.length === 0) return "";

  const lines = turns.map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.text}`);
  const whole = lines.join("\n\n");
  if (whole.length <= maxChars) return whole;

  const firstUserIndex = turns.findIndex((turn) => turn.role === "user");
  const head = firstUserIndex >= 0 ? clipTurnText(lines[firstUserIndex] ?? "", Math.floor(maxChars / 4)) : "";
  const omittedMarker = "[…older turns omitted…]";

  const tail: string[] = [];
  let used = head.length + omittedMarker.length + 4;
  for (let index = lines.length - 1; index > firstUserIndex; index--) {
    const line = lines[index] ?? "";
    // Two newlines join each pair of turns.
    const cost = line.length + 2;
    if (used + cost > maxChars) break;
    tail.unshift(line);
    used += cost;
  }

  // The newest turn matters most, so it stays even when it alone is over the budget.
  const newestIndex = lines.length - 1;
  if (tail.length === 0 && newestIndex > firstUserIndex) {
    tail.push(clipTurnText(lines[newestIndex] ?? "", Math.max(200, maxChars - used)));
  }

  return [head, omittedMarker, ...tail].filter((part) => part.length > 0).join("\n\n");
}
