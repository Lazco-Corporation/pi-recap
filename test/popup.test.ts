import assert from "node:assert/strict";
import { test } from "node:test";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { ResultPopup, thinkingLine } from "../src/popup.ts";

test("the thinking line is the newest non-empty line, cut to the width", () => {
  assert.equal(thinkingLine("", 40), "");
  assert.equal(thinkingLine("First thought.\n\nSecond thought.\n", 40), "Second thought.");
  const long = thinkingLine(`short\n${"x".repeat(100)}`, 20);
  assert.equal(visibleWidth(long), 20);
  assert.ok(long.includes("…"));
});

function plainTheme(): Theme {
  return { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
}

const ESCAPE = "\x1b";

function createPopup(rows = 40) {
  initTheme("dark");
  const events: string[] = [];
  const popup = new ResultPopup({
    tui: { requestRender() {}, terminal: { rows } } as unknown as TUI,
    theme: plainTheme(),
    keybindings: { matches: (data: string, id: string) => id === "tui.select.cancel" && data === ESCAPE } as unknown as KeybindingsManager,
    title: "Recap",
    subtitle: "model",
    loadingMessage: "Reading 3 messages…",
    onClose: () => events.push("close"),
    onAsk: (question) => events.push(`ask ${question}`),
    onStopAnswer: () => events.push("stop"),
  });
  return { popup, events, screen: () => popup.render(60).join("\n") };
}

function type(popup: ResultPopup, text: string): void {
  for (const character of text) popup.handleInput(character);
}

test("tab opens the input only after the result is complete", () => {
  const { popup, events, screen } = createPopup();
  popup.handleInput("\t");
  assert.ok(!screen().includes("enter send"));
  popup.showPartialText("Goal");
  popup.handleInput("\t");
  assert.ok(!screen().includes("enter send"));
  popup.showText("Goal: test");
  assert.ok(screen().includes("tab ask"));
  popup.handleInput("\t");
  assert.ok(screen().includes("enter send"));
  assert.ok(screen().includes("sk about this session"));
  assert.deepEqual(events, []);
  popup.dispose();
});

test("a question shows above its answer, and q types into the input instead of closing", () => {
  const { popup, events, screen } = createPopup();
  popup.showText("Goal: test");
  popup.handleInput("\t");
  type(popup, "why q");
  popup.handleInput("\r");
  assert.deepEqual(events, ["ask why q"]);
  assert.ok(screen().includes("Answering…"));
  assert.ok(screen().includes("esc stop"));
  popup.showText("Because.");
  const lines = screen().split("\n");
  const question = lines.findIndex((line) => line.includes("why q"));
  const answer = lines.findIndex((line) => line.includes("Because."));
  assert.ok(question > 0 && answer > question);
  popup.dispose();
});

test("esc backs out of the input, then stops an answer, then closes", () => {
  const { popup, events, screen } = createPopup();
  popup.showText("Goal: test");
  popup.handleInput("\t");
  type(popup, "draft");
  popup.handleInput(ESCAPE);
  assert.ok(!screen().includes("enter send"));
  assert.deepEqual(events, []);

  // The draft stays when the input opens again.
  popup.handleInput("\t");
  assert.ok(screen().includes("draft"));
  popup.handleInput("\r");
  popup.showPartialText("Half");
  popup.handleInput(ESCAPE);
  assert.deepEqual(events, ["ask draft", "stop"]);
  popup.showStopped();
  assert.ok(screen().includes("Half"));
  assert.ok(screen().includes("Stopped."));

  popup.handleInput(ESCAPE);
  assert.deepEqual(events, ["ask draft", "stop", "close"]);
  popup.dispose();
});

test("an empty question is not sent", () => {
  const { popup, events } = createPopup();
  popup.showText("Goal: test");
  popup.handleInput("\t");
  type(popup, "   ");
  popup.handleInput("\r");
  assert.deepEqual(events, []);
  popup.dispose();
});

test("a new question stays at the top of the view while its answer grows", () => {
  const { popup, screen } = createPopup(20);
  popup.showText(Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n\n"));
  popup.handleInput("\t");
  type(popup, "pinned question");
  popup.handleInput("\r");
  popup.showText(Array.from({ length: 30 }, (_, index) => `answer ${index}`).join("\n\n"));
  const body = screen().split("\n").slice(2);
  assert.ok(body[0]?.includes("› pinned question"));
  popup.dispose();
});

test("the next question can be written while an answer streams, and goes out after it", () => {
  const { popup, events, screen } = createPopup();
  popup.showText("Goal: test");
  popup.handleInput("\t");
  type(popup, "first");
  popup.handleInput("\r");
  assert.ok(screen().includes("tab ask next"));
  popup.handleInput("\t");
  type(popup, "second");
  assert.ok(screen().includes("send after the answer"));
  popup.handleInput("\r");
  assert.deepEqual(events, ["ask first"]);
  assert.ok(screen().includes("Wait for the answer to end"));
  popup.showText("One.");
  popup.handleInput("\r");
  assert.deepEqual(events, ["ask first", "ask second"]);
  popup.dispose();
});

test("a stop before any text ends the answer, so the next question can go out", () => {
  const { popup, events, screen } = createPopup();
  popup.showText("Goal: test");
  popup.handleInput("\t");
  type(popup, "first");
  popup.handleInput("\r");
  popup.handleInput(ESCAPE);
  popup.showStopped();
  assert.ok(screen().includes("Stopped."));
  assert.ok(screen().includes("tab ask  ·"));
  assert.ok(screen().includes("esc close"));
  popup.handleInput("\t");
  type(popup, "second");
  popup.handleInput("\r");
  assert.deepEqual(events, ["ask first", "stop", "ask second"]);
  popup.dispose();
});

// A release after a drag copies to the system clipboard, so the test never lets go of a real selection.
test("a drag selects body text and a click clears it", () => {
  const { popup, screen } = createPopup();
  popup.showText("Goal: select me");
  screen();
  const mouse = (type: "press" | "drag" | "release", x: number, y: number) =>
    popup.handleMouse({ type, button: "left", x, y, screenX: x, screenY: y, width: 60, height: 10, shift: false, alt: false, ctrl: false });
  // The body starts at row 2 and column 2 of the popup.
  assert.deepEqual(mouse("press", 8, 2), { capture: true });
  mouse("drag", 13, 2);
  assert.ok(screen().includes("\x1b[7mselect\x1b[27m"));
  mouse("press", 8, 2);
  mouse("release", 8, 2);
  assert.ok(!screen().includes("\x1b[7m"));
  popup.dispose();
});

test("one rule sets the questions apart from the result, not one per question", () => {
  const { popup, screen } = createPopup();
  popup.showText("Goal: test");
  for (const question of ["first", "second"]) {
    popup.handleInput("\t");
    type(popup, question);
    popup.handleInput("\r");
    popup.showText(`answer to ${question}`);
  }
  const lines = screen().split("\n");
  const rules = lines.map((line, index) => (line.includes("────") && line.startsWith("│") ? index : -1)).filter((index) => index >= 0);
  assert.equal(rules.length, 1);
  const goal = lines.findIndex((line) => line.includes("Goal: test"));
  const first = lines.findIndex((line) => line.includes("› first"));
  assert.ok(goal < (rules[0] ?? -1) && (rules[0] ?? -1) < first);
  popup.dispose();
});
