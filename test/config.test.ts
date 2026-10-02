import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSettings, loadSettings, parseSettings, SETTINGS_FILE, SettingsError, splitModelRef } from "../src/config.ts";

function withAgentDir(fileContent: string | undefined, check: (agentDir: string) => void): void {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-recap-"));
  try {
    if (fileContent !== undefined) writeFileSync(join(agentDir, SETTINGS_FILE), fileContent);
    check(agentDir);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}

test("an empty object gives the defaults", () => {
  assert.deepEqual(parseSettings({}), defaultSettings());
});

test("valid fields are kept", () => {
  const input = {
    model: " a/b/c ",
    thinking: "high",
    maxInputChars: 5000.7,
    language: " Traditional Chinese ",
    appendPrompt: " Mention PR # ",
    recapAppendPrompt: " Only 2 lines ",
    summaryAppendPrompt: " Include files ",
    recapPrompt: "r",
    summaryPrompt: "s",
  };
  assert.deepEqual(parseSettings(input), {
    model: "a/b/c",
    thinking: "high",
    maxInputChars: 5000,
    language: "Traditional Chinese",
    appendPrompt: "Mention PR #",
    recapAppendPrompt: "Only 2 lines",
    summaryAppendPrompt: "Include files",
    recapPrompt: "r",
    summaryPrompt: "s",
  });
});

test("maxInputChars is clamped", () => {
  assert.equal(parseSettings({ maxInputChars: 1 }).maxInputChars, 1_000);
  assert.equal(parseSettings({ maxInputChars: 1e12 }).maxInputChars, 2_000_000);
});

for (const input of [
  { model: "no-slash" },
  { model: 3 },
  { thinking: "huge" },
  { maxInputChars: "many" },
  { language: 123 },
  { appendPrompt: false },
  { recapAppendPrompt: {} },
  { summaryAppendPrompt: [] },
  { recapPrompt: 1 },
  { summaryPrompt: false },
  [],
]) {
  test(`rejects ${JSON.stringify(input)}`, () => {
    assert.throws(() => parseSettings(input), SettingsError);
  });
}

test("the model reference splits at the first slash", () => {
  assert.deepEqual(splitModelRef("openrouter/anthropic/claude"), { provider: "openrouter", modelId: "anthropic/claude" });
});

test("a missing file gives the defaults", () => {
  withAgentDir(undefined, (agentDir) => {
    assert.deepEqual(loadSettings(agentDir), defaultSettings());
  });
});

test("a file with a byte order mark loads", () => {
  withAgentDir('\uFEFF{ "thinking": "off" }', (agentDir) => {
    assert.equal(loadSettings(agentDir).thinking, "off");
  });
});

test("broken JSON names the file", () => {
  withAgentDir('{ "model": ', (agentDir) => {
    assert.throws(() => loadSettings(agentDir), (error: unknown) => {
      assert.ok(error instanceof SettingsError);
      assert.match(error.message, new RegExp(SETTINGS_FILE));
      return true;
    });
  });
});
