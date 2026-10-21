import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
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

type PopupState =
  /** `thinking` is the model's reasoning so far. It shows as one line under the spinner. */
  | { kind: "loading"; message: string; thinking: string }
  | { kind: "text"; source: string; markdown: Markdown; streaming: boolean }
  | { kind: "error"; message: string };

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
}

export class ResultPopup implements Component {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly title: string;
  private readonly subtitle: string;
  private readonly onClose: () => void;
  private state: PopupState;
  private warnings: string[];
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private scrollTop = 0;
  private viewportHeight = 0;
  private contentHeight = 0;
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
    this.warnings = [...(options.warnings ?? [])];
    this.state = { kind: "loading", message: options.loadingMessage, thinking: "" };
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.tui.requestRender();
    }, SPINNER_INTERVAL_MS);
  }

  /** Show the model's thinking so far. Only the newest line is drawn, and only while nothing else shows. */
  showThinking(thinking: string): void {
    if (this.state.kind !== "loading") return;
    this.state.thinking = thinking;
    this.tui.requestRender();
  }

  /** Show the text so far while the model still writes. The spinner keeps going under it. */
  showPartialText(markdownText: string): void {
    this.setText(markdownText, true);
  }

  showText(markdownText: string): void {
    this.stopSpinner();
    this.setText(markdownText, false);
  }

  /** A warning that turns up late, for example when the model hits its output limit. */
  addWarning(warning: string): void {
    this.warnings.push(warning);
    this.tui.requestRender();
  }

  private setText(markdownText: string, streaming: boolean): void {
    if (this.state.kind === "text") {
      // The same Markdown object keeps its place, so the scroll position survives each update.
      this.state.markdown.setText(markdownText);
      this.state.source = markdownText;
      this.state.streaming = streaming;
    } else {
      this.state = {
        kind: "text",
        source: markdownText,
        markdown: new Markdown(markdownText, 0, 0, getMarkdownTheme(), undefined, { transform: addEmphasisMarkers }),
        streaming,
      };
      this.scrollTop = 0;
    }
    this.tui.requestRender();
  }

  showError(message: string): void {
    this.stopSpinner();
    this.state = { kind: "error", message };
    this.scrollTop = 0;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    const pageSize = Math.max(1, this.viewportHeight - 1);
    if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "enter") || data === "q") {
      this.onClose();
    } else if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      this.scrollBy(-1);
    } else if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      this.scrollBy(1);
    } else if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.scrollBy(-pageSize);
    } else if (this.keybindings.matches(data, "tui.select.pageDown") || matchesKey(data, "space")) {
      this.scrollBy(pageSize);
    } else if (matchesKey(data, "home") || data === "g") {
      this.scrollBy(-this.contentHeight);
    } else if (matchesKey(data, "end") || data === "G") {
      this.scrollBy(this.contentHeight);
    } else if (data === "c" && this.state.kind === "text" && !this.state.streaming) {
      void this.copy(this.state.source);
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    if (event.type === "wheel") this.scrollBy(event.wheelDelta ?? 0);
    // Clicks inside the popup must not fall through to the chat behind it.
    return { handled: true };
  }

  invalidate(): void {
    if (this.state.kind === "text") this.state.markdown.invalidate();
  }

  dispose(): void {
    this.stopSpinner();
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
  }

  render(width: number): string[] {
    const theme = this.theme;
    const border = (text: string) => theme.fg("border", text);
    const innerWidth = Math.max(1, width - 4);

    const body = this.renderBody(innerWidth);
    const maxBodyRows = Math.max(MIN_BODY_ROWS, Math.floor(this.tui.terminal.rows * HEIGHT_RATIO) - CHROME_ROWS);
    this.contentHeight = body.length;
    this.viewportHeight = Math.min(body.length, maxBodyRows);
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
    lines.push(border(`├${"─".repeat(Math.max(0, width - 2))}┤`));
    lines.push(frameLine(this.renderFooter(innerWidth)));
    lines.push(border(`╰${"─".repeat(Math.max(0, width - 2))}╯`));
    return lines;
  }

  private renderBody(innerWidth: number): string[] {
    const warningLines = this.warnings.flatMap((warning) => wrapTextWithAnsi(this.theme.fg("warning", `! ${warning}`), innerWidth));
    const body = this.renderState(innerWidth);
    return warningLines.length > 0 ? [...warningLines, "", ...body] : body;
  }

  private renderState(innerWidth: number): string[] {
    const theme = this.theme;
    const spinner = theme.fg("accent", SPINNER_FRAMES[this.spinnerFrame] ?? "");
    switch (this.state.kind) {
      case "loading": {
        const lines = wrapTextWithAnsi(`${spinner} ${theme.fg("muted", this.state.message)}`, innerWidth);
        // The newest thought tells the user what the model looks at, while the text is still to come.
        const thought = thinkingLine(this.state.thinking, Math.max(1, innerWidth - 2));
        if (thought.length > 0) lines.push(`  ${theme.fg("dim", thought)}`);
        return lines;
      }
      case "error":
        return wrapTextWithAnsi(theme.fg("error", this.state.message), innerWidth);
      case "text": {
        const lines = this.state.markdown.render(innerWidth).map(removeEmphasisMarkers);
        if (this.state.streaming) lines.push("", spinner);
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
    if (this.state.kind === "loading") return hint("esc", "cancel");
    const streaming = this.state.kind === "text" && this.state.streaming;

    const scrollable = this.contentHeight > this.viewportHeight;
    const position = scrollable
      ? theme.fg("dim", `${this.scrollTop + 1}-${this.scrollTop + this.viewportHeight} of ${this.contentHeight}`)
      : "";
    const separator = theme.fg("dim", "  ·  ");
    const close = hint("esc", streaming ? "cancel" : "close");
    const copy = this.state.kind === "text" && !streaming ? [hint("c", "copy")] : [];
    const scroll = hint("↑↓", "scroll");
    // Hints drop from the least needed, so the scroll position stays visible in a narrow terminal.
    const candidates = scrollable
      ? [[scroll, hint("pgup/pgdn", "page"), ...copy, close], [scroll, ...copy, close], [...copy, close], [close]]
      : [[...copy, close], [close]];
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

  private scrollBy(lines: number): void {
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

  private stopSpinner(): void {
    if (this.spinnerTimer === undefined) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value));
}
