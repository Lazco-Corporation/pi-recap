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
  | { kind: "loading"; message: string }
  | { kind: "text"; source: string; markdown: Markdown; warning?: string }
  | { kind: "error"; message: string };

export interface ResultPopupOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  /** Shown on the left of the top border. */
  title: string;
  /** Shown on the right of the top border, for example the model id. */
  subtitle: string;
  loadingMessage: string;
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
    this.state = { kind: "loading", message: options.loadingMessage };
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.tui.requestRender();
    }, SPINNER_INTERVAL_MS);
  }

  showText(markdownText: string, warning?: string): void {
    this.stopSpinner();
    this.state = {
      kind: "text",
      source: markdownText,
      markdown: new Markdown(markdownText, 0, 0, getMarkdownTheme(), undefined, { transform: addEmphasisMarkers }),
      warning,
    };
    this.scrollTop = 0;
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
    } else if (data === "c" && this.state.kind === "text") {
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
    const theme = this.theme;
    switch (this.state.kind) {
      case "loading": {
        const spinner = theme.fg("accent", SPINNER_FRAMES[this.spinnerFrame] ?? "");
        return wrapTextWithAnsi(`${spinner} ${theme.fg("muted", this.state.message)}`, innerWidth);
      }
      case "error":
        return wrapTextWithAnsi(theme.fg("error", this.state.message), innerWidth);
      case "text": {
        const lines = this.state.markdown.render(innerWidth).map(removeEmphasisMarkers);
        if (!this.state.warning) return lines;
        return [...wrapTextWithAnsi(theme.fg("warning", this.state.warning), innerWidth), "", ...lines];
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

    const scrollable = this.contentHeight > this.viewportHeight;
    const position = scrollable
      ? theme.fg("dim", `${this.scrollTop + 1}-${this.scrollTop + this.viewportHeight} of ${this.contentHeight}`)
      : "";
    const separator = theme.fg("dim", "  ·  ");
    const close = hint("esc", "close");
    const copy = this.state.kind === "text" ? [hint("c", "copy")] : [];
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
