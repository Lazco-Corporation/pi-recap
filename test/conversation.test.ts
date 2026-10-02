import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { clipTurnText, collectTurns, renderConversation, type Turn } from "../src/conversation.ts";

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

test("over budget, the first user turn and the newest turns are kept", () => {
  const rendered = renderConversation(turns, 1_000);
  assert.ok(rendered.length <= 1_000);
  assert.ok(rendered.startsWith("User: first goal"));
  assert.ok(rendered.includes("[…older turns omitted…]"));
  assert.ok(rendered.includes("turn 49"));
  assert.ok(!rendered.includes("turn 0 "));
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
