import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  clipTurnText,
  collectTurns,
  dropProgressNotes,
  prepareConversation,
  renderConversation,
  renderTurns,
  type Turn,
} from "../src/conversation.ts";

function messageEntry(role: string, content: unknown): SessionEntry {
  return { type: "message", id: "id", parentId: null, timestamp: "", message: { role, content } } as unknown as SessionEntry;
}

test("only user and assistant text is kept", () => {
  const entries = [
    messageEntry("system", "prompt"),
    messageEntry("user", "fix the bug"),
    messageEntry("assistant", [
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "Looking." },
      { type: "toolCall", name: "read", arguments: {} },
    ]),
    messageEntry("toolResult", [{ type: "text", text: "file body" }]),
    messageEntry("assistant", [{ type: "toolCall", name: "bash", arguments: {} }]),
    messageEntry("custom", "extension note"),
    { type: "label", id: "l", parentId: null, timestamp: "" } as unknown as SessionEntry,
  ];
  assert.deepEqual(collectTurns(entries), [
    { role: "user", text: "fix the bug" },
    { role: "assistant", text: "Looking." },
  ]);
});

test("a skill run collapses to the command the user typed", () => {
  const skill = '<skill name="git-commit" location="/x/SKILL.md">\nlong skill body\n</skill>\n\nonly the docs';
  const bare = '<skill name="git-commit" location="/x/SKILL.md">\nlong skill body\n</skill>';
  assert.deepEqual(collectTurns([messageEntry("user", skill), messageEntry("user", bare)]), [
    { role: "user", text: "/skill:git-commit only the docs" },
    { role: "user", text: "/skill:git-commit" },
  ]);
});

test("a clipped turn keeps the head and the tail", () => {
  const clipped = clipTurnText(`START${"x".repeat(1000)}END`, 100);
  assert.equal(clipped.length, 100);
  assert.ok(clipped.startsWith("START"));
  assert.ok(clipped.endsWith("END"));
  assert.ok(clipped.includes("[…cut…]"));
});

test("progress notes before the last agent message of a run are dropped", () => {
  const conversation: Turn[] = [
    { role: "user", text: "fix it" },
    { role: "assistant", text: "I read the file." },
    { role: "assistant", text: "Now I run the tests." },
    { role: "assistant", text: "Done: the tests pass." },
    { role: "user", text: "ship it" },
    { role: "assistant", text: "I open the PR." },
    { role: "assistant", text: "The PR is merged." },
    { role: "user", text: "thanks" },
  ];
  assert.deepEqual(
    dropProgressNotes(conversation).map((turn) => turn.text),
    ["fix it", "Done: the tests pass.", "ship it", "The PR is merged.", "thanks"],
  );
  assert.ok(!renderConversation(conversation, 10_000).includes("Now I run the tests."));
});

test("the run after the newest user turn keeps every message, because it may still be in progress", () => {
  const conversation: Turn[] = [
    { role: "user", text: "fix it" },
    { role: "assistant", text: "I read the file." },
    { role: "assistant", text: "Now I run the tests." },
  ];
  assert.deepEqual(dropProgressNotes(conversation), conversation);
});

const turns: Turn[] = [
  { role: "user", text: "first goal" },
  ...Array.from(
    { length: 50 },
    (_, index): Turn => ({ role: index % 2 ? "user" : "assistant", text: `turn ${index} ${"y".repeat(80)}` }),
  ),
];

test("the whole conversation is kept when it fits", () => {
  assert.equal(renderConversation(turns.slice(0, 2), 10_000), `User: first goal\n\nAgent: ${turns[1]?.text}`);
});

test("over budget, the first user turn, the older user turns, and the newest turns are kept", () => {
  const rendered = renderTurns(turns, 1_000);
  assert.ok(rendered.text.length <= 1_000);
  assert.ok(rendered.text.startsWith("User: first goal"));
  assert.match(rendered.text, /\[…\d+ older turns omitted\. Some of the User messages from that part follow, without the Agent replies to them…\]/);
  assert.ok(rendered.text.includes("[…the newest turns follow…]"));
  assert.ok(rendered.text.includes("turn 49"));
  assert.ok(!rendered.text.includes("turn 0 "));
  // The older part holds user turns only, and the newest turns hold both roles.
  const olderPart = rendered.text.split("[…the newest turns follow…]")[0] ?? "";
  assert.ok(olderPart.includes("User: turn 4"));
  assert.ok(!olderPart.includes("Agent:"));
  assert.ok(rendered.keptOlderUserTurns > 0);
  assert.equal(rendered.keptTurns + rendered.keptOlderUserTurns + rendered.omittedTurns, turns.length);
});

test("over budget with no older user turns, the old marker is used", () => {
  const oneRun: Turn[] = [{ role: "user", text: "goal" }, ...Array.from({ length: 20 }, (): Turn => ({ role: "assistant", text: "z".repeat(100) }))];
  const rendered = renderTurns(oneRun, 800);
  assert.ok(rendered.text.includes("[…older turns omitted…]"));
  assert.equal(rendered.keptOlderUserTurns, 0);
  assert.ok(rendered.text.length <= 800);
});

test("when every older user turn fits, the marker says so", () => {
  const rendered = renderTurns(turns, 4_000);
  assert.match(rendered.text, /\[…\d+ older turns omitted\. The User messages from that part follow/);
  assert.ok(rendered.text.length <= 4_000);
});

test("the newest turn is kept even when it alone is over budget", () => {
  const rendered = renderConversation(
    [
      { role: "user", text: "goal" },
      { role: "assistant", text: "z".repeat(5_000) },
    ],
    1_000,
  );
  assert.ok(rendered.includes("Agent: zzz"));
  assert.ok(rendered.length <= 1_100);
});

function userImageEntry(text: string): SessionEntry {
  return messageEntry("user", [
    { type: "image", data: "...", mimeType: "image/png" },
    ...(text ? [{ type: "text", text }] : []),
  ]);
}

test("prepareConversation reports what the model does not get", () => {
  const entries = [
    messageEntry("user", "goal"),
    messageEntry("assistant", "a".repeat(21_000)),
    userImageEntry("look at this"),
    messageEntry("assistant", "I see text only."),
    userImageEntry(""),
    messageEntry("assistant", "done"),
  ];
  const prepared = prepareConversation(entries, 120_000);
  assert.equal(prepared.messageCount, 5);
  assert.deepEqual(prepared.warnings, [
    "1 message is longer than 20000 characters. The model gets only the start and the end of it.",
    "2 user messages contain images. The model does not see images.",
  ]);
});

test("prepareConversation counts the messages that fit the budget", () => {
  const entries = [messageEntry("user", "first goal")];
  for (let index = 0; index < 40; index++) {
    entries.push(messageEntry("user", `question ${index} ${"q".repeat(100)}`));
    entries.push(messageEntry("assistant", `answer ${index} ${"a".repeat(100)}`));
  }
  const prepared = prepareConversation(entries, 1_500);
  assert.ok(prepared.text.includes("older turns omitted"));
  assert.ok(prepared.messageCount < 81);
  assert.equal(prepared.warnings.length, 1);
  assert.match(prepared.warnings[0] ?? "", /^The conversation is larger than maxInputChars \(1500\)\. The model gets the first message, \d+ older user messages, and the newest \d+ messages\. \d+ older messages are left out\.$/);
});

test("prepareConversation gives no warning when nothing is lost", () => {
  const prepared = prepareConversation([messageEntry("user", "hi"), messageEntry("assistant", "hello")], 120_000);
  assert.deepEqual(prepared.warnings, []);
  assert.equal(prepared.messageCount, 2);
});

test("a long report before a short notice stays, a short note is dropped", () => {
  const report = `Report: ${"r".repeat(400)}`;
  const conversation: Turn[] = [
    { role: "user", text: "go" },
    { role: "assistant", text: "Now I look." },
    { role: "assistant", text: report },
    { role: "assistant", text: "A subagent finished. Nothing changed." },
    { role: "user", text: "ok" },
  ];
  assert.deepEqual(
    dropProgressNotes(conversation).map((turn) => turn.text),
    ["go", report, "A subagent finished. Nothing changed.", "ok"],
  );
});
