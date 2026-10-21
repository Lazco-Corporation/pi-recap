import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * Turns a session branch into the transcript that the `/recap` and `/summary` model reads.
 *
 * Only what the user typed and what the agent said is kept.
 * Tool calls, tool results, thinking, images, and extension messages are dropped:
 * they cost tokens and pull the output toward file names instead of what happened.
 *
 * Everything that is left out against the user's expectation comes back as a warning,
 * so the user can tell a thin result from a thin conversation.
 */

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface PreparedConversation {
  /** The transcript that goes into the prompt. */
  text: string;
  /** How many messages the transcript holds. */
  messageCount: number;
  /** What the model does not get, in sentences for the user. Empty when nothing was lost. */
  warnings: string[];
}

/**
 * One huge paste or code dump must not push the rest of the chat out of the budget.
 * The head usually holds the intent and the tail the conclusion, so both are kept.
 * Agent reports with tables run to about 12,000 characters, and this cap keeps them whole.
 */
export const MAX_TURN_CHARS = 20_000;

const SKILL_BLOCK = /^<skill name="([^"]+)" location="[^"]*">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/;
const OMITTED_MARKER = "[…older turns omitted…]";

interface ContentBlock {
  type?: string;
  text?: string;
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part): part is ContentBlock => Boolean(part) && typeof part === "object");
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  return contentBlocks(content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
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

export interface CollectedTurns {
  turns: Turn[];
  /** Turns longer than `MAX_TURN_CHARS`, which keep only their start and end. */
  clippedTurns: number;
  /** User messages with an image. The model never sees images. */
  userMessagesWithImages: number;
}

/** Pull user and assistant text out of a session branch, oldest first. */
export function collectConversation(entries: readonly SessionEntry[]): CollectedTurns {
  const turns: Turn[] = [];
  let clippedTurns = 0;
  let userMessagesWithImages = 0;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = entry.message.content;
    if (role === "user" && contentBlocks(content).some((block) => block.type === "image")) userMessagesWithImages++;
    let text = extractText(content);
    if (role === "user") text = collapseSkillInvocation(text);
    if (text.length === 0) continue;
    if (text.length > MAX_TURN_CHARS) clippedTurns++;
    turns.push({ role, text: clipTurnText(text) });
  }
  return { turns, clippedTurns, userMessagesWithImages };
}

export function collectTurns(entries: readonly SessionEntry[]): Turn[] {
  return collectConversation(entries).turns;
}

/**
 * A progress note such as "Now I check the pods" is short: half of them are under 100 characters, 95% under 350.
 * A report that happens to sit before another agent message, such as a notice from a subagent, is longer and must stay.
 */
export const MIN_KEPT_NOTE_CHARS = 300;

/**
 * Drop a short agent message when another agent message follows it before the next user message.
 * Those are progress notes, and the last agent message of the run reports the result.
 * The run after the newest user message stays whole, because the agent can still be working on it.
 * The notes are about a quarter of all text, so more history fits the budget without them.
 */
export function dropProgressNotes(turns: readonly Turn[]): Turn[] {
  const lastUserIndex = turns.findLastIndex((turn) => turn.role === "user");
  return turns.filter(
    (turn, index) =>
      turn.role === "user" ||
      index > lastUserIndex ||
      turns[index + 1]?.role !== "assistant" ||
      turn.text.length >= MIN_KEPT_NOTE_CHARS,
  );
}

export interface RenderedConversation {
  text: string;
  /** Turns that are in the text whole or clipped, the user turns of the older part not counted. */
  keptTurns: number;
  /** User turns of the older part that are in the text, without the agent replies to them. */
  keptOlderUserTurns: number;
  /** Turns that did not fit the budget. */
  omittedTurns: number;
}

/**
 * A user turn in the older part is kept for what the user asked and decided, not for a pasted log.
 * This cap holds the whole of most user turns and the intent of a paste.
 */
const OLDER_USER_TURN_CHARS = 1_000;

/** The older part can take at most this share of the budget, so the newest turns always get the rest. */
const OLDER_USER_SHARE = 1 / 4;

/** Room for the two markers around the older part, with their joins. */
const MARKER_RESERVE = 170;

/**
 * Render turns as a transcript that fits inside `maxChars`.
 *
 * The first user turn always stays, because it says what the session is for.
 * The rest of the budget fills from the newest turn backwards,
 * because the current state matters most for both a recap and a summary.
 * From the older part that does not fit, the user turns stay without the agent replies,
 * because they hold what the user asked for and decided, at a small cost.
 */
export function renderTurns(allTurns: readonly Turn[], maxChars: number): RenderedConversation {
  const turns = dropProgressNotes(allTurns);
  if (turns.length === 0) return { text: "", keptTurns: 0, keptOlderUserTurns: 0, omittedTurns: 0 };

  const lines = turns.map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.text}`);
  const whole = lines.join("\n\n");
  if (whole.length <= maxChars) return { text: whole, keptTurns: turns.length, keptOlderUserTurns: 0, omittedTurns: 0 };

  const firstUserIndex = turns.findIndex((turn) => turn.role === "user");
  const head = firstUserIndex >= 0 ? clipTurnText(lines[firstUserIndex] ?? "", Math.floor(maxChars / 4)) : "";
  // Two newlines join each pair of parts.
  const cost = (line: string) => line.length + 2;

  // The user turns after the first one, as they would show in the older part.
  const olderUserLine = (index: number) => clipTurnText(lines[index] ?? "", OLDER_USER_TURN_CHARS);
  const userIndexes = turns.map((_, index) => index).filter((index) => index > firstUserIndex && turns[index]?.role === "user");
  const olderUserBudget = Math.min(
    Math.floor(maxChars * OLDER_USER_SHARE),
    userIndexes.reduce((sum, index) => sum + cost(olderUserLine(index)), 0),
  );

  const tail: string[] = [];
  let tailStart = lines.length;
  let used = head.length + MARKER_RESERVE;
  for (let index = lines.length - 1; index > firstUserIndex; index--) {
    const line = lines[index] ?? "";
    if (used + cost(line) > maxChars - olderUserBudget) break;
    tail.unshift(line);
    tailStart = index;
    used += cost(line);
  }

  // The newest turn matters most, so it stays even when it alone is over the budget.
  const newestIndex = lines.length - 1;
  if (tail.length === 0 && newestIndex > firstUserIndex) {
    tail.push(clipTurnText(lines[newestIndex] ?? "", Math.max(200, maxChars - olderUserBudget - used)));
    tailStart = newestIndex;
    used = maxChars - olderUserBudget;
  }

  // The newest user turns of the older part first: they are closest to the current state.
  const olderUser: string[] = [];
  const olderUserCandidates = userIndexes.filter((index) => index < tailStart);
  for (const index of [...olderUserCandidates].reverse()) {
    const line = olderUserLine(index);
    if (used + cost(line) > maxChars) break;
    olderUser.unshift(line);
    used += cost(line);
  }

  const omittedTurns = tailStart - firstUserIndex - 1;
  const allOlderUsersKept = olderUser.length === olderUserCandidates.length;
  const parts = [head];
  if (olderUser.length > 0) {
    parts.push(
      `[…${omittedTurns} older turns omitted. ${allOlderUsersKept ? "The" : "Some of the"} User messages from that part follow, without the Agent replies to them…]`,
      ...olderUser,
      "[…the newest turns follow…]",
    );
  } else {
    parts.push(OMITTED_MARKER);
  }
  parts.push(...tail);

  const keptTurns = tail.length + (head.length > 0 ? 1 : 0);
  return {
    text: parts.filter((part) => part.length > 0).join("\n\n"),
    keptTurns,
    keptOlderUserTurns: olderUser.length,
    omittedTurns: omittedTurns - olderUser.length,
  };
}

export function renderConversation(turns: readonly Turn[], maxChars: number): string {
  return renderTurns(turns, maxChars).text;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The transcript for the prompt, with a warning for each kind of content the model does not get. */
export function prepareConversation(entries: readonly SessionEntry[], maxChars: number): PreparedConversation {
  const collected = collectConversation(entries);
  const rendered = renderTurns(collected.turns, maxChars);
  const warnings: string[] = [];
  if (rendered.omittedTurns > 0) {
    const olderUsers = rendered.keptOlderUserTurns > 0 ? `, ${plural(rendered.keptOlderUserTurns, "older user message")},` : "";
    warnings.push(
      `The conversation is larger than maxInputChars (${maxChars}). The model gets the first message${olderUsers} and the newest ${plural(rendered.keptTurns - 1, "message")}. ${plural(rendered.omittedTurns, "older message")} ${rendered.omittedTurns === 1 ? "is" : "are"} left out.`,
    );
  }
  if (collected.clippedTurns > 0) {
    warnings.push(
      `${plural(collected.clippedTurns, "message")} ${collected.clippedTurns === 1 ? "is" : "are"} longer than ${MAX_TURN_CHARS} characters. The model gets only the start and the end of ${collected.clippedTurns === 1 ? "it" : "them"}.`,
    );
  }
  if (collected.userMessagesWithImages > 0) {
    warnings.push(
      `${plural(collected.userMessagesWithImages, "user message")} ${collected.userMessagesWithImages === 1 ? "contains" : "contain"} images. The model does not see images.`,
    );
  }
  return { text: rendered.text, messageCount: rendered.keptTurns, warnings };
}
