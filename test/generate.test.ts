import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings } from "../src/config.ts";
import { buildDefaultPrompt, composePrompt, RECAP_PROMPT, renderPrompt, SUMMARY_PROMPT } from "../src/generate.ts";

const variables = { conversation: "User: hi", status: "idle", sessionName: "s", cwd: "/w", language: "zh-TW" };

test("known placeholders are filled and unknown ones are kept", () => {
  assert.equal(renderPrompt("{{status}} {{cwd}} {{nope}} {{conversation}}", variables), "idle /w {{nope}} User: hi");
});

test("the conversation is appended when the template forgot it", () => {
  assert.equal(renderPrompt("Recap please.", variables), "Recap please.\n\n<conversation>\nUser: hi\n</conversation>");
});

test("a $ in the conversation is not treated as a replace pattern", () => {
  assert.equal(renderPrompt("{{conversation}}", { ...variables, conversation: "cost $& $1" }), "cost $& $1");
});

for (const [name, template] of [
  ["recap", RECAP_PROMPT],
  ["summary", SUMMARY_PROMPT],
] as const) {
  test(`the default ${name} prompt has no unfilled placeholder`, () => {
    assert.doesNotMatch(renderPrompt(template, variables), /\{\{\w+\}\}/);
  });
}

test("buildDefaultPrompt sets the language rule when language is provided", () => {
  const recap = buildDefaultPrompt("recap", "Traditional Chinese");
  assert.ok(recap.includes("Write everything in Traditional Chinese."));
  assert.ok(!recap.includes("language of the User messages"));

  const summary = buildDefaultPrompt("summary", "Traditional Chinese");
  assert.ok(summary.includes("Write everything in Traditional Chinese."));
});

test("composePrompt appends appendPrompt, command-specific append, and args", () => {
  const settings = {
    ...defaultSettings(),
    language: "Japanese",
    appendPrompt: "Note the git commit hash.",
    recapAppendPrompt: "Two lines maximum.",
  };
  const prompt = composePrompt("recap", settings, "Focus on files.");
  assert.ok(prompt.includes("Write everything in Japanese."));
  assert.ok(prompt.includes("- Note the git commit hash."));
  assert.ok(prompt.includes("- Two lines maximum."));
  assert.ok(prompt.includes("- Focus on files."));
});

