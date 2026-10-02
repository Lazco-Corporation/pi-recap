import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

/**
 * The `recap.json` file in the agent directory. It configures both `/recap` and `/summary`.
 *
 * The file is read on every command run, so an edit applies at once without `/reload`.
 * A missing file means defaults. A broken file is an error, never a silent default,
 * because the user ran the command and must see why it did not do what they set up.
 */

export const SETTINGS_FILE = "recap.json";

const THINKING_LEVELS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface Settings {
  /** `"provider/modelId"`, or null to use the model the session runs. */
  model: string | null;
  thinking: ModelThinkingLevel;
  /** Cap on the conversation text handed to the model. */
  maxInputChars: number;
  /**
   * Output language, for example "Traditional Chinese", "zh-TW", or "English".
   * If null, the model uses the language of the newest user message.
   */
  language: string | null;
  /**
   * Additional prompt text appended to both `/recap` and `/summary`.
   */
  appendPrompt: string | null;
  /**
   * Additional prompt text appended only to `/recap`.
   */
  recapAppendPrompt: string | null;
  /**
   * Additional prompt text appended only to `/summary`.
   */
  summaryAppendPrompt: string | null;
  /**
   * Custom prompts with `{{conversation}}`, `{{status}}`, `{{sessionName}}`, and `{{cwd}}`, or null for the default.
   */
  recapPrompt: string | null;
  summaryPrompt: string | null;
}

export function defaultSettings(): Settings {
  return {
    model: null,
    thinking: "low",
    maxInputChars: 120_000,
    language: null,
    appendPrompt: null,
    recapAppendPrompt: null,
    summaryAppendPrompt: null,
    recapPrompt: null,
    summaryPrompt: null,
  };
}

export class SettingsError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelField(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SettingsError('"model" must be text or null');
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (splitModelRef(trimmed) === undefined) {
    throw new SettingsError('"model" must look like "provider/modelId"');
  }
  return trimmed;
}

function thinkingField(value: unknown, fallback: ModelThinkingLevel): ModelThinkingLevel {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !THINKING_LEVELS.includes(value as ModelThinkingLevel)) {
    throw new SettingsError(`"thinking" must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  return value as ModelThinkingLevel;
}

function maxInputCharsField(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SettingsError('"maxInputChars" must be a number');
  return Math.min(2_000_000, Math.max(1_000, Math.floor(value)));
}

function promptField(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SettingsError(`"${field}" must be text or null`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseSettings(input: unknown): Settings {
  if (!isPlainObject(input)) throw new SettingsError("the file must hold a JSON object");
  const fallback = defaultSettings();
  return {
    model: modelField(input.model),
    thinking: thinkingField(input.thinking, fallback.thinking),
    maxInputChars: maxInputCharsField(input.maxInputChars, fallback.maxInputChars),
    language: promptField(input.language, "language"),
    appendPrompt: promptField(input.appendPrompt, "appendPrompt"),
    recapAppendPrompt: promptField(input.recapAppendPrompt, "recapAppendPrompt"),
    summaryAppendPrompt: promptField(input.summaryAppendPrompt, "summaryAppendPrompt"),
    recapPrompt: promptField(input.recapPrompt, "recapPrompt"),
    summaryPrompt: promptField(input.summaryPrompt, "summaryPrompt"),
  };
}

/** Split `"provider/modelId"`. The model id may itself hold slashes. */
export function splitModelRef(reference: string): { provider: string; modelId: string } | undefined {
  const slash = reference.indexOf("/");
  if (slash <= 0 || slash === reference.length - 1) return undefined;
  return { provider: reference.slice(0, slash), modelId: reference.slice(slash + 1) };
}

export function loadSettings(agentDir: string): Settings {
  const path = join(agentDir, SETTINGS_FILE);
  if (!existsSync(path)) return defaultSettings();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new SettingsError(`${path} is not valid JSON`);
  }

  try {
    return parseSettings(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SettingsError(`${path}: ${detail}`);
  }
}
