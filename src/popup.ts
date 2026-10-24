import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  Input,
  Markdown,
  matchesKey,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { addEmphasisMarkers, removeEmphasisMarkers } from "./emphasis.ts";

/**
 * The overlay for `/recap` and `/summary`: a framed box that shows a spinner, then the text or an error.
 * After the text, the user can ask questions about the session, and each answer shows under its question.
 *
 * Scrolling is done here rather than with `ScrollView`, because `ScrollView` gets its
 * viewport from the fullscreen layout engine, and an overlay must also work in regular mode.
 */

/** Share of the terminal height the popup may take. Matches the `80%` overlay width. */
const HEIGHT_RATIO = 0.8;
/** Top border, blank, blank, separator, footer, bottom border. */
const CHROME_ROWS = 6;
const MIN_BODY_ROWS = 3;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
const NOTICE_DURATION_MS = 1_500;
const ANSWER_LOADING_MESSAGE = "Answering…";
const STOPPED_MESSAGE = "Stopped.";

type BlockState =
  /** `thinking` is the model's reasoning so far. It shows as one line under the spinner. */
  | { kind: "loading"; message: string; thinking: string }
  | { kind: "text"; source: string; markdown: Markdown; streaming: boolean }
  | { kind: "error"; message: string };

/** The first block is the result of the command. Each later block is a question and its answer. */
interface Block {
  /** Undefined for the result of the command. */
  question?: string;
  state: BlockState;
  /** For the first block, they show at the top of the popup. For an answer, they show under its question. */
  warnings: string[];
  /** Set when the user stopped the answer. What came before the stop stays. */
  stopped: boolean;
}

/** The newest line of the model's thinking, cut to one row. Empty when there is no thinking yet. */
export function thinkingLine(thinking: string, width: number): string {
  const line = thinking
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .at(-1);
  return line ? truncateToWidth(line, width, "…") : "";
}

export interface ResultPopupOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  /** Shown on the left of the top border. */
  title: string;
  /** Shown on the right of the top border, for example the model id. */
  subtitle: string;
  loadingMessage: string;
  /** What the model does not get, or what went wrong on the way. Shown above the body in every state. */
  warnings?: readonly string[];
  onClose: () => void;
  /** Called with each question. Without it, the popup takes no questions. */
  onAsk?: (question: string) => void;
  /** Called when the user stops the answer that the model writes now. */
  onStopAnswer?: () => void;
}

export class ResultPopup implements Component, Focusable {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly title: string;
  private readonly subtitle: string;
  private readonly onClose: () => void;
  private readonly onAsk: ((question: string) => void) | undefined;
  private readonly onStopAnswer: (() => void) | undefined;
  private readonly blocks: Block[];
  private readonly input: Input;
  private inputOpen = false;
  private hasFocus = false;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private scrollTop = 0;
  private viewportHeight = 0;
  private contentHeight = 0;
  /** The block whose question stays at the top of the view while its answer grows, until the user scrolls. */
  private pinnedBlock: number | undefined;
  /** The body row where each block starts, from the last render. */
  private blockStartRows: number[] = [];
  /** A short message, such as "Copied", that replaces the key hints for a moment. */
  private notice: { text: string; isError: boolean } | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ResultPopupOptions) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.title = options.title;
    this.subtitle = options.subtitle;
    this.onClose = options.onClose;
    this.onAsk = options.onAsk;
    this.onStopAnswer = options.onStopAnswer;
    this.blocks = [
      {
        state: { kind: "loading", message: options.loadingMessage, thinking: "" },
        warnings: [...(options.warnings ?? [])],
        stopped: false,
      },
    ];
    this.input = new Input({
      prompt: this.theme.fg("accent", "› "),
      placeholder: "Ask about this session",
      placeholderStyle: (text) => this.theme.fg("dim", text),
    });
    this.input.onSubmit = (value) => this.submitQuestion(value);
    this.input.onEscape = () => this.closeInput();
    this.startSpinner();
  }

  get focused(): boolean {
    return this.hasFocus;
  }

  /** The TUI sets this. The input shows the hardware cursor only while the popup has the focus. */
  set focused(value: boolean) {
    this.hasFocus = value;
    this.input.focused = value && this.inputOpen;
  }

  private get newestBlock(): Block {
    return this.blocks[this.blocks.length - 1] as Block;
  }

  /** True while the model reads or writes the newest block. */
  private get busy(): boolean {
    const block = this.newestBlock;
    if (block.stopped) return false;
    return block.state.kind === "loading" || (block.state.kind === "text" && block.state.streaming);
  }

  /** Questions need the result as context, so the input opens only after the result is complete. */
  private get canAsk(): boolean {
    const first = this.blocks[0]?.state;
    return this.onAsk !== undefined && first?.kind === "text" && !first.streaming;
  }

  /** Show the model's thinking so far. Only the newest line is drawn, and only while nothing else shows. */
  showThinking(thinking: string): void {
    const state = this.newestBlock.state;
    if (state.kind !== "loading") return;
    state.thinking = thinking;
    this.tui.requestRender();
  }

  /** Show the text so far while the model still writes. The spinner keeps going under it. */
  showPartialText(markdownText: string): void {
    this.setText(markdownText, true);
  }

  showText(markdownText: string): void {
    this.setText(markdownText, false);
    this.stopSpinner();
  }

  /** A warning that turns up late, for example when the model hits its output limit. It goes to the newest block. */
  addWarning(warning: string): void {
    this.newestBlock.warnings.push(warning);
    this.tui.requestRender();
  }

  showError(message: string): void {
    this.stopSpinner();
    this.newestBlock.state = { kind: "error", message };
    if (this.blocks.length === 1) this.scrollTop = 0;
    this.tui.requestRender();
  }

  /** The user stopped the answer. The text so far stays, with a note under it. */
  showStopped(): void {
    this.stopSpinner();
    const block = this.newestBlock;
    block.stopped = true;
    if (block.state.kind === "text") block.state.streaming = false;
    this.tui.requestRender();
  }

  private setText(markdownText: string, streaming: boolean): void {
    const block = this.newestBlock;
    if (block.state.kind === "text") {
      // The same Markdown object keeps its place, so the scroll position survives each update.
      block.state.markdown.setText(markdownText);
      block.state.source = markdownText;
      block.state.streaming = streaming;
    } else {
      block.state = {
        kind: "text",
        source: markdownText,
        markdown: new Markdown(markdownText, 0, 0, getMarkdownTheme(), undefined, { transform: addEmphasisMarkers }),
        streaming,
      };
      if (this.blocks.length === 1) this.scrollTop = 0;
    }
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (this.inputOpen) {
      this.input.handleInput(data);
      this.tui.requestRender();
      return;
    }

    const pageSize = Math.max(1, this.viewportHeight - 1);
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      // Esc on an answer stops only the answer. The result and the earlier answers stay.
      if (this.busy && this.blocks.length > 1) this.onStopAnswer?.();
      else this.onClose();
    } else if (matchesKey(data, "enter") || data === "q") {
      this.onClose();
    } else if (matchesKey(data, "tab")) {
      if (this.canAsk) this.openInput();
    } else if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      this.scrollByUser(-1);
    } else if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      this.scrollByUser(1);
    } else if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.scrollByUser(-pageSize);
    } else if (this.keybindings.matches(data, "tui.select.pageDown") || matchesKey(data, "space")) {
      this.scrollByUser(pageSize);
    } else if (matchesKey(data, "home") || data === "g") {
      this.scrollByUser(-this.contentHeight);
    } else if (matchesKey(data, "end") || data === "G") {
      this.scrollByUser(this.contentHeight);
    } else if (data === "c") {
      const text = this.copyableText();
      if (text !== undefined) void this.copy(text);
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    if (event.type === "wheel") this.scrollByUser(event.wheelDelta ?? 0);
    // Clicks inside the popup must not fall through to the chat behind it.
    return { handled: true };
  }

  invalidate(): void {
    for (const block of this.blocks) if (block.state.kind === "text") block.state.markdown.invalidate();
    this.input.invalidate();
  }

  dispose(): void {
    this.stopSpinner();
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
  }

  private openInput(): void {
    this.inputOpen = true;
    this.input.focused = this.hasFocus;
    this.tui.requestRender();
  }

  /** The typed text stays, so a question that the user backs out of is not lost. */
  private closeInput(): void {
    this.inputOpen = false;
    this.input.focused = false;
    this.tui.requestRender();
  }

  private submitQuestion(value: string): void {
    const question = value.trim();
    if (question.length === 0 || !this.canAsk) return;
    // The user can write the next question while an answer streams, but the chat takes one question at a time.
    if (this.busy) {
      this.showNotice("Wait for the answer to end, or press esc twice to stop it.", false);
      return;
    }
    this.input.setValue("");
    this.closeInput();
    this.blocks.push({
      question,
      state: { kind: "loading", message: ANSWER_LOADING_MESSAGE, thinking: "" },
      warnings: [],
      stopped: false,
    });
    this.pinnedBlock = this.blocks.length - 1;
    this.startSpinner();
    this.tui.requestRender();
    this.onAsk?.(question);
  }

  /** The newest complete text: the newest answer, or the result when there is no answer yet. */
  private copyableText(): string | undefined {
    for (let index = this.blocks.length - 1; index >= 0; index--) {
      const state = this.blocks[index]?.state;
      if (state?.kind === "text" && !state.streaming) return state.source;
    }
    return undefined;
  }

  render(width: number): string[] {
    const theme = this.theme;
    const border = (text: string) => theme.fg("border", text);
    const innerWidth = Math.max(1, width - 4);

    const body = this.renderBody(innerWidth);
    const chromeRows = CHROME_ROWS + (this.inputOpen ? 1 : 0);
    const maxBodyRows = Math.max(MIN_BODY_ROWS, Math.floor(this.tui.terminal.rows * HEIGHT_RATIO) - chromeRows);
    this.contentHeight = body.length;
    this.viewportHeight = Math.min(body.length, maxBodyRows);
    if (this.pinnedBlock !== undefined) this.scrollTop = this.blockStartRows[this.pinnedBlock] ?? this.scrollTop;
    this.scrollTop = clamp(this.scrollTop, 0, this.contentHeight - this.viewportHeight);
    const visible = body.slice(this.scrollTop, this.scrollTop + this.viewportHeight);
    const thumb = this.scrollThumb();

    const frameLine = (content: string, rightEdge = border("│")) =>
      `${border("│")} ${truncateToWidth(content, innerWidth, "", true)} ${rightEdge}`;
    const blank = frameLine("");

    const lines = [this.renderTopBorder(width), blank];
    visible.forEach((line, row) => {
      const onThumb = thumb !== undefined && row >= thumb.start && row < thumb.start + thumb.size;
      lines.push(frameLine(line, onThumb ? theme.fg("accent", "┃") : border("│")));
    });
    lines.push(blank);
    if (this.inputOpen) lines.push(frameLine(this.input.render(innerWidth)[0] ?? ""));
    lines.push(border(`├${"─".repeat(Math.max(0, width - 2))}┤`));
    lines.push(frameLine(this.renderFooter(innerWidth)));
    lines.push(border(`╰${"─".repeat(Math.max(0, width - 2))}╯`));
    return lines;
  }

  private renderBody(innerWidth: number): string[] {
    const lines: string[] = [];
    this.blockStartRows = [];
    for (const block of this.blocks) {
      if (block.question !== undefined) lines.push("");
      this.blockStartRows.push(lines.length);
      lines.push(...this.renderBlock(block, innerWidth));
    }
    return lines;
  }

  private renderBlock(block: Block, innerWidth: number): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    if (block.question !== undefined) {
      // The question looks like a user message in the pi chat, so the answer below it reads as the reply.
      const questionLines = wrapTextWithAnsi(block.question, Math.max(1, innerWidth - 2));
      for (const line of questionLines) {
        const padded = ` ${line}${" ".repeat(Math.max(0, innerWidth - 2 - visibleWidth(line)))} `;
        lines.push(theme.bg("userMessageBg", theme.fg("userMessageText", padded)));
      }
      lines.push("");
    }
    const warningLines = block.warnings.flatMap((warning) => wrapTextWithAnsi(theme.fg("warning", `! ${warning}`), innerWidth));
    if (warningLines.length > 0) lines.push(...warningLines, "");
    lines.push(...this.renderState(block, innerWidth));
    return lines;
  }

  private renderState(block: Block, innerWidth: number): string[] {
    const theme = this.theme;
    const spinner = theme.fg("accent", SPINNER_FRAMES[this.spinnerFrame] ?? "");
    const state = block.state;
    switch (state.kind) {
      case "loading": {
        if (block.stopped) return [theme.fg("muted", STOPPED_MESSAGE)];
        const lines = wrapTextWithAnsi(`${spinner} ${theme.fg("muted", state.message)}`, innerWidth);
        // The newest thought tells the user what the model looks at, while the text is still to come.
        const thought = thinkingLine(state.thinking, Math.max(1, innerWidth - 2));
        if (thought.length > 0) lines.push(`  ${theme.fg("dim", thought)}`);
        return lines;
      }
      case "error":
        return wrapTextWithAnsi(theme.fg("error", state.message), innerWidth);
      case "text": {
        const lines = state.markdown.render(innerWidth).map(removeEmphasisMarkers);
        if (state.streaming) lines.push("", spinner);
        else if (block.stopped) lines.push("", theme.fg("muted", STOPPED_MESSAGE));
        return lines;
      }
    }
  }

  private renderTopBorder(width: number): string {
    const theme = this.theme;
    const title = theme.fg("accent", theme.bold(` ${this.title} `));
    const subtitle = theme.fg("muted", ` ${this.subtitle} `);
    // "╭─" + title + fill + subtitle + "─╮"
    const fixedWidth = 4 + visibleWidth(title);
    const showSubtitle = fixedWidth + visibleWidth(subtitle) + 1 <= width;
    const fill = Math.max(0, width - fixedWidth - (showSubtitle ? visibleWidth(subtitle) : 0));
    const border = (text: string) => theme.fg("border", text);
    return truncateToWidth(
      `${border("╭─")}${title}${border("─".repeat(fill))}${showSubtitle ? subtitle : ""}${border("─╮")}`,
      width,
      "",
    );
  }

  private renderFooter(innerWidth: number): string {
    const theme = this.theme;
    const hint = (keys: string, action: string) => `${theme.fg("dim", keys)} ${theme.fg("muted", action)}`;
    const separator = theme.fg("dim", "  ·  ");
    if (this.inputOpen) {
      if (this.notice) return theme.fg(this.notice.isError ? "error" : "muted", truncateToWidth(this.notice.text, innerWidth, "…"));
      const send = this.busy ? hint("enter", "send after the answer") : hint("enter", "send");
      return truncateToWidth([send, hint("esc", "back")].join(separator), innerWidth, "…");
    }
    if (this.blocks.length === 1 && this.newestBlock.state.kind === "loading") return hint("esc", "cancel");

    const scrollable = this.contentHeight > this.viewportHeight;
    const position = scrollable
      ? theme.fg("dim", `${this.scrollTop + 1}-${this.scrollTop + this.viewportHeight} of ${this.contentHeight}`)
      : "";
    const answering = this.busy && this.blocks.length > 1;
    const close = hint("esc", answering ? "stop" : this.busy ? "cancel" : "close");
    const ask = this.canAsk ? [hint("tab", answering ? "ask next" : "ask")] : [];
    const copy = this.copyableText() !== undefined && !this.busy ? [hint("c", "copy")] : [];
    const scroll = hint("↑↓", "scroll");
    // Hints drop from the least needed, so the scroll position stays visible in a narrow terminal.
    const candidates = scrollable
      ? [
          [scroll, hint("pgup/pgdn", "page"), ...ask, ...copy, close],
          [scroll, ...ask, ...copy, close],
          [...ask, ...copy, close],
          [...ask, close],
          [close],
        ]
      : [[...ask, ...copy, close], [...ask, close], [close]];
    const notice = this.notice
      ? theme.fg(this.notice.isError ? "error" : "success", truncateToWidth(this.notice.text, innerWidth, "…"))
      : undefined;
    for (const candidate of candidates) {
      const hints = notice ?? candidate.join(separator);
      const gap = innerWidth - visibleWidth(hints) - visibleWidth(position);
      if (gap >= 2) return position.length > 0 ? `${hints}${" ".repeat(gap)}${position}` : hints;
    }
    return notice ?? close;
  }

  /** Where the thumb sits on the right edge, in viewport rows. Undefined when everything fits. */
  private scrollThumb(): { start: number; size: number } | undefined {
    if (this.contentHeight <= this.viewportHeight || this.viewportHeight === 0) return undefined;
    const size = Math.max(1, Math.round((this.viewportHeight * this.viewportHeight) / this.contentHeight));
    const maxScrollTop = this.contentHeight - this.viewportHeight;
    const start = Math.round((this.scrollTop / maxScrollTop) * (this.viewportHeight - size));
    return { start, size };
  }

  /** A scroll by the user ends the pin, so the view stays where the user put it. */
  private scrollByUser(lines: number): void {
    this.pinnedBlock = undefined;
    const next = clamp(this.scrollTop + lines, 0, this.contentHeight - this.viewportHeight);
    if (next === this.scrollTop) return;
    this.scrollTop = next;
    this.tui.requestRender();
  }

  private async copy(text: string): Promise<void> {
    try {
      await copyToClipboard(text);
      this.showNotice("Copied to the clipboard.", false);
    } catch (error) {
      this.showNotice(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  private showNotice(text: string, isError: boolean): void {
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    this.notice = { text, isError };
    this.noticeTimer = setTimeout(() => {
      this.notice = undefined;
      this.noticeTimer = undefined;
      this.tui.requestRender();
    }, NOTICE_DURATION_MS);
    this.tui.requestRender();
  }

  private startSpinner(): void {
    if (this.spinnerTimer !== undefined) return;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.tui.requestRender();
    }, SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer === undefined) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value));
}
