import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildChatSystemPrompt } from "../src/chat.ts";
import {
  type ChatTurn,
  collectChatTurns,
  collectTurns,
  renderChatTurns,
  renderTurns,
  TOOL_ARGUMENTS_CHARS,
  TOOL_ERROR_CHARS,
  TOOL_RESULT_CHARS,
} from "../src/conversation.ts";

function messageEntry(message: Record<string, unknown>): SessionEntry {
  return { type: "message", id: "id", parentId: null, timestamp: "", message } as unknown as SessionEntry;
}

function user(text: string): SessionEntry {
  return messageEntry({ role: "user", content: text });
}

function agent(content: unknown[]): SessionEntry {
  return messageEntry({ role: "assistant", content });
}

function toolResult(toolCallId: string, text: string, isError = false): SessionEntry {
  return messageEntry({ role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text }], isError });
}

test("tool calls and their results join the agent message that made them", () => {
  const turns = collectChatTurns([
    user("run the tests"),
    agent([
      { type: "text", text: "Running." },
      { type: "toolCall", id: "a", name: "bash", arguments: { command: "npm test" } },
      { type: "toolCall", id: "b", name: "read", arguments: { path: "x.ts" } },
    ]),
    toolResult("a", "2 failed", true),
    toolResult("b", "file body"),
    agent([{ type: "toolCall", id: "c", name: "bash", arguments: { command: "ls" } }]),
  ]);
  assert.deepEqual(turns, [
    { role: "user", text: "run the tests", tools: [] },
    {
      role: "assistant",
      text: "Running.",
      tools: [
        { call: '[Tool call] bash {"command":"npm test"}', result: "[Tool error] 2 failed" },
        { call: '[Tool call] read {"path":"x.ts"}', result: "[Tool result] file body" },
      ],
    },
    // A call that is still running has no result, and a message with only tool calls still counts.
    { role: "assistant", text: "", tools: [{ call: '[Tool call] bash {"command":"ls"}' }] },
  ]);
});

test("the recap transcript stays free of tool calls", () => {
  const entries = [
    user("go"),
    agent([{ type: "toolCall", id: "a", name: "bash", arguments: {} }]),
    toolResult("a", "out"),
    agent([{ type: "text", text: "Done." }]),
  ];
  assert.deepEqual(collectTurns(entries), [
    { role: "user", text: "go" },
    { role: "assistant", text: "Done." },
  ]);
});

test("long arguments and results keep their start and end", () => {
  const long = (label: string) => `${label}-START${"x".repeat(10_000)}${label}-END`;
  const [, turn] = collectChatTurns([
    user("go"),
    agent([
      { type: "toolCall", id: "a", name: "write", arguments: { content: long("args") } },
      { type: "toolCall", id: "b", name: "bash", arguments: {} },
    ]),
    toolResult("a", long("result")),
    toolResult("b", long("error"), true),
  ]);
  const [write, bash] = turn?.tools ?? [];
  assert.equal(write?.call.length, "[Tool call] write ".length + TOOL_ARGUMENTS_CHARS);
  assert.equal(write?.result?.length, "[Tool result] ".length + TOOL_RESULT_CHARS);
  assert.ok(write?.result?.endsWith("result-END"));
  assert.equal(bash?.result?.length, "[Tool error] ".length + TOOL_ERROR_CHARS);
  assert.ok(bash?.result?.startsWith("[Tool error] error-START"));
});

function chatTurns(count: number): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let index = 0; index < count; index++) {
    turns.push({ role: "user", text: `question ${index}`, tools: [] });
    turns.push({
      role: "assistant",
      text: `answer ${index}`,
      tools: [{ call: `[Tool call] bash ${index}`, result: `[Tool result] ${"r".repeat(200)}` }],
    });
  }
  return turns;
}

test("a transcript that fits keeps every tool call and result", () => {
  const rendered = renderChatTurns(chatTurns(2), 100_000);
  assert.equal(rendered.warnings.length, 0);
  assert.ok(rendered.text.includes("Agent: answer 0\n[Tool call] bash 0\n[Tool result] rrr"));
});

test("older tool results go first, then older tool calls", () => {
  const turns = chatTurns(5);
  const whole = renderChatTurns(turns, 100_000).text.length;

  const withoutOldResults = renderChatTurns(turns, whole - 300);
  assert.equal(withoutOldResults.callsWithoutResult, 2);
  assert.equal(withoutOldResults.omittedCalls, 0);
  assert.ok(withoutOldResults.text.length <= whole - 300);
  assert.ok(withoutOldResults.text.includes("[Tool call] bash 0\n\nUser: question 1"));
  assert.ok(withoutOldResults.text.includes("[Tool call] bash 4\n[Tool result]"));
  assert.match(withoutOldResults.warnings[0] ?? "", /gets the 2 oldest tool calls without their results/);

  const withoutResults = renderChatTurns(turns, whole - 1_100);
  assert.equal(withoutResults.callsWithoutResult + withoutResults.omittedCalls, 5);
  assert.ok(withoutResults.omittedCalls > 0);
  assert.ok(!withoutResults.text.includes("[Tool call] bash 0"));
  assert.ok(withoutResults.text.includes("[Tool call] bash 4"));
});

test("past the tool calls, the recap rules cut the text", () => {
  const turns = chatTurns(40);
  const rendered = renderChatTurns(turns, 300);
  const bare = turns.map(({ role, text }) => ({ role, text }));
  assert.equal(rendered.text, renderTurns(bare, 300).text);
  assert.equal(rendered.omittedCalls, 40);
  assert.match(rendered.warnings[0] ?? "", /gets none of the 40 tool calls/);
});

test("the chat prompt holds the transcript, the result, and the language", () => {
  const prompt = buildChatSystemPrompt({
    conversation: "User: hi $& $1",
    kind: "summary",
    digest: "## Goal\n- hi",
    agentWasIdle: true,
    sessionName: "s",
    cwd: "/w",
    language: "English",
  });
  assert.ok(prompt.includes("<conversation>\nUser: hi $& $1\n</conversation>"));
  assert.ok(prompt.includes("<summary>\n## Goal\n- hi\n</summary>"));
  assert.ok(prompt.includes("- Write in English."));
  assert.ok(prompt.includes("the agent was idle"));
  const unset = buildChatSystemPrompt({ conversation: "", kind: "recap", digest: "", agentWasIdle: false, sessionName: "s", cwd: "/w", language: null });
  assert.ok(unset.includes("language of the newest question"));
  assert.ok(unset.includes("was working on the newest User message"));
});
