import { eastAsianWidthType } from "get-east-asian-width";

/**
 * Makes `*` emphasis work in Chinese, Japanese, and Korean text.
 *
 * CommonMark does not end the bold in `**目標：**你想`. A closing `**` after a punctuation mark
 * must have a space or a punctuation mark after it, and CJK text puts no space between words.
 * The same rule breaks `這是**「重點」**文字` and `**스크립트(script)**는`.
 *
 * The CJK-friendly amendment to CommonMark fixes these cases:
 * https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md
 * The pi Markdown parser follows plain CommonMark and takes no plugins. So `addEmphasisMarkers`
 * puts an invisible WORD JOINER next to each `*` run that the two rules see differently,
 * which makes the parser see a letter there instead of a punctuation mark.
 * `removeEmphasisMarkers` takes the WORD JOINER out of the rendered lines.
 *
 * Only `*` runs change. For `_` runs, the amendment keeps the CommonMark result, and `~~` in pi
 * does not use the flanking rules at all.
 */

const MARKER = "\u2060";

interface Neighbor {
  /** The character as the parser sees it, or undefined at the start or end of the text. */
  char: string | undefined;
  whitespace: boolean;
  nonCjkPunctuation: boolean;
  /** A CJK character, also with a variation selector after it, or an ideographic variation selector. */
  cjk: boolean;
}

/** Adds a WORD JOINER next to each `*` run whose flanking differs between CommonMark and the CJK-friendly rules. */
export function addEmphasisMarkers(markdown: string): string {
  if (!markdown.includes("*")) return markdown;
  const output: string[] = [];
  const lines = markdown.split("\n");
  let fence: { char: string; length: number } | undefined;
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.length > 0) output.push(markProse(prose.join("\n")));
    prose = [];
  };
  for (const line of lines) {
    if (fence !== undefined) {
      output.push(line);
      if (isClosingFence(line, fence)) fence = undefined;
      continue;
    }
    const opening = FENCE_PATTERN.exec(line);
    if (opening?.[1] !== undefined) {
      flushProse();
      output.push(line);
      fence = { char: opening[1][0] ?? "`", length: opening[1].length };
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return output.join("\n");
}

export function removeEmphasisMarkers(line: string): string {
  return line.replaceAll(MARKER, "");
}

/** A fence may sit inside a block quote or a list item, so any indent and `>` prefix counts. */
const FENCE_PATTERN = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/;

function isClosingFence(line: string, fence: { char: string; length: number }): boolean {
  const match = /^[ \t]*(?:>[ \t]*)*(`+|~+)[ \t]*$/.exec(line);
  return match?.[1] !== undefined && match[1][0] === fence.char && match[1].length >= fence.length;
}

/** Text outside fenced code blocks. Code spans and backslash escapes stay as they are. */
function markProse(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      result += text.slice(index, index + 2);
      index += 2;
    } else if (char === "`") {
      const end = codeSpanEnd(text, index);
      result += text.slice(index, end);
      index = end;
    } else if (char === "*") {
      let end = index;
      while (text[end] === "*") end++;
      const [before, after] = markerPlacement(neighborBefore(text, index), neighborAfter(text, end));
      result += `${before ? MARKER : ""}${text.slice(index, end)}${after ? MARKER : ""}`;
      index = end;
    } else {
      result += char;
      index++;
    }
  }
  return result;
}

/** The index after the code span that starts at `start`, or after the backtick run when nothing closes it. */
function codeSpanEnd(text: string, start: number): number {
  let runEnd = start;
  while (text[runEnd] === "`") runEnd++;
  const runLength = runEnd - start;
  let search = runEnd;
  while (search < text.length) {
    const next = text.indexOf("`", search);
    if (next < 0) break;
    let closeEnd = next;
    while (text[closeEnd] === "`") closeEnd++;
    if (closeEnd - next === runLength) return closeEnd;
    search = closeEnd;
  }
  return runEnd;
}

/**
 * Where a WORD JOINER must go so that the parser gets the CJK-friendly flanking.
 * Returns [before the run, after the run]. A WORD JOINER can only turn a neighbor into a letter,
 * so when no placement matches, the run stays as it is.
 */
function markerPlacement(before: Neighbor, after: Neighbor): [boolean, boolean] {
  const wanted = cjkFriendlyFlanking(before, after);
  const placements: [boolean, boolean][] = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ];
  for (const [markBefore, markAfter] of placements) {
    const parsed = commonMarkFlanking(markBefore ? MARKER : before.char, markAfter ? MARKER : after.char);
    if (parsed.left === wanted.left && parsed.right === wanted.right) return [markBefore, markAfter];
  }
  return [false, false];
}

interface Flanking {
  left: boolean;
  right: boolean;
}

/** The amended definitions of left-flanking and right-flanking delimiter runs. */
function cjkFriendlyFlanking(before: Neighbor, after: Neighbor): Flanking {
  return {
    left:
      !after.whitespace &&
      (!after.nonCjkPunctuation || before.whitespace || before.nonCjkPunctuation || before.cjk),
    right:
      !before.whitespace &&
      (!before.nonCjkPunctuation || after.whitespace || after.nonCjkPunctuation || after.cjk),
  };
}

/** The flanking that the parser computes from the two characters next to the run. */
function commonMarkFlanking(before: string | undefined, after: string | undefined): Flanking {
  return {
    left: !isWhitespace(after) && (!isParserPunctuation(after) || isWhitespace(before) || isParserPunctuation(before)),
    right: !isWhitespace(before) && (!isParserPunctuation(before) || isWhitespace(after) || isParserPunctuation(after)),
  };
}

function neighborBefore(text: string, index: number): Neighbor {
  const char = codePointBefore(text, index);
  if (char === undefined || isWhitespace(char)) return { char, whitespace: true, nonCjkPunctuation: false, cjk: false };
  if (isIdeographicVariationSelector(char)) {
    return { char, whitespace: false, nonCjkPunctuation: false, cjk: true };
  }
  // A variation selector belongs to the character before it.
  const selector = isVariationSelector(char) ? char : undefined;
  const base = selector === undefined ? char : codePointBefore(text, index - char.length);
  if (base === undefined || isWhitespace(base)) {
    return { char, whitespace: false, nonCjkPunctuation: false, cjk: false };
  }
  const punctuation = isPunctuation(base);
  const cjk = isCjk(base);
  const fullwidthPunctuation =
    punctuation && selector === "\uFE01" && eastAsianWidthType(base.codePointAt(0) ?? 0) === "ambiguous";
  return { char, whitespace: false, nonCjkPunctuation: punctuation && !cjk && !fullwidthPunctuation, cjk };
}

function neighborAfter(text: string, index: number): Neighbor {
  const codePoint = text.codePointAt(index);
  const char = codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
  if (isWhitespace(char)) return { char, whitespace: true, nonCjkPunctuation: false, cjk: false };
  const cjk = char !== undefined && isCjk(char);
  return { char, whitespace: false, nonCjkPunctuation: char !== undefined && isPunctuation(char) && !cjk, cjk };
}

function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  const high = index >= 2 ? text.charCodeAt(index - 2) : 0;
  const isPair = low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff;
  return text.slice(isPair ? index - 2 : index - 1, index);
}

/** The start and the end of the text count as whitespace. */
function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /^\s$/u.test(char);
}

function isPunctuation(char: string): boolean {
  return /^[\p{P}\p{S}]$/u.test(char);
}

/** With GitHub Flavored Markdown on, the parser counts `~` next to a `*` run as a letter. */
function isParserPunctuation(char: string | undefined): boolean {
  return char !== undefined && char !== "~" && isPunctuation(char);
}

/** East Asian Width W, F, or H that is not an emoji, or any Hangul character. */
function isCjk(char: string): boolean {
  if (/^\p{Script=Hangul}$/u.test(char)) return true;
  const width = eastAsianWidthType(char.codePointAt(0) ?? 0);
  return (width === "wide" || width === "fullwidth" || width === "halfwidth") && !/^\p{Emoji_Presentation}$/u.test(char);
}

/** U+FE00 to U+FE0E. U+FE0F asks for the emoji form, so it does not count. */
function isVariationSelector(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  return codePoint >= 0xfe00 && codePoint <= 0xfe0e;
}

function isIdeographicVariationSelector(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  return codePoint >= 0xe0100 && codePoint <= 0xe01ef;
}
