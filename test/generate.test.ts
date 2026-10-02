import assert from "node:assert/strict";
import { test } from "node:test";
import { RECAP_PROMPT, renderPrompt, SUMMARY_PROMPT } from "../src/generate.ts";

const variables = { conversation: "User: hi", status: "idle", sessionName: "s", cwd: "/w" };

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
