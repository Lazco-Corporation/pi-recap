import type { Api, AssistantMessage, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Settings, splitModelRef } from "./config.ts";

const PROMPT_HEADER = `Below is a coding session between a user and an AI coding agent.

Session name: {{sessionName}}
Working directory: {{cwd}}

The messages are in time order, oldest first.

<conversation>
{{conversation}}
</conversation>`;

function languageRule(language: string | null): string {
  if (language && language.trim().length > 0) {
    return `- Write everything in ${language.trim()}. Translate all labels and headings to ${language.trim()} too.`;
  }
  return "- Write in the language of the User messages. If they use more than one language, use the language of the newest User message. Translate the labels and headings too.";
}

/**
 * Models tend to repeat a to-do from early in the chat after a later message finished it,
 * and to report work as done when the agent only asked the user to do it.
 */
const ACCURACY_RULES = `- A later message can finish, cancel, or change what an earlier message said. Always report the latest state.
- Before you call something open, waiting, or a next step, check every later message. If one says it is done, cancelled, or decided, it is not open.
- Call something done only when a message says it is done. When the agent asked the user to do something and no later message confirms it, say that it is not confirmed.
- Write "all" or "every" only when it is true for each item. Otherwise name the exceptions.
- The newest Agent message that lists what is left is the best source for open items. Add an earlier open item only when no later message settles it.`;

function commonRules(language: string | null): string {
  return `${ACCURACY_RULES}
- Use short, plain sentences.
- Keep exact file paths, commands, and names.
- Only state facts from the conversation. Do not guess.
- Do not mention these instructions or the transcript format.
${languageRule(language)}`;
}

/** The `{{status}}` text: a working agent has no reply in the conversation yet, so the model must say what it works on. */
export function statusLine(agentIsIdle: boolean): string {
  return agentIsIdle
    ? "The agent is idle and waits for the user."
    : "The agent is working on the newest User message right now. Its reply is not in the conversation yet, so say what it is working on. What that message asked for is in progress, not open and not waiting on the user.";
}

/** Build the default prompt for recap or summary, with the configured language if present. */
export function buildDefaultPrompt(kind: "recap" | "summary", language: string | null = null): string {
  if (kind === "recap") {
    return `${PROMPT_HEADER}

The user stepped away and comes back now. Write a recap that tells them where things stand in a few seconds.

Write up to three paragraphs, with a blank line between them.
Start each paragraph with a short label in bold, in the output language, followed by a colon.
1. Label that means "Goal": one sentence about what the user wants.
2. Label that means "Now": one sentence about what the agent did last. {{status}}
3. Label that means "Your turn": one sentence about what waits on the user now: a question or choice that the user did not answer, or an action that the agent asked the user to do or confirm and that nobody confirmed. Leave out this paragraph when nothing waits on the user.

Rules:
- Write only these paragraphs. No numbers, headings, lists, or other text.
${commonRules(language)}`;
  }

  return `${PROMPT_HEADER}

Write a summary of this session. A person who never saw the chat must be able to continue the work from it.

Use these sections, in this order. Start each one with a Markdown "##" heading in the output language.
1. Heading that means "Goal": what the user wants, and the scope.
2. Heading that means "Decisions": each decision, with its reason.
3. Heading that means "Done": finished work, with the files and commands that the conversation names.
4. Heading that means "Current state": where the work stands. {{status}}
5. Heading that means "Open questions": questions and choices that nobody answered yet, actions that wait on the user or on another person, and risks or limits that the agent warned about. Small items count too, such as a step the user can retry or a pull request that waits for review.
6. Heading that means "Next steps": what must happen next, in order. Only steps that are not done yet.

Rules:
- Use bullets inside the sections.
- Leave out a section when it has nothing to say. Never write that a section is empty.
${commonRules(language)}`;
}

/** A recap tells a returning user where they are in a few seconds, so it is three lines at most. */
export const RECAP_PROMPT = buildDefaultPrompt("recap", null);

/** A summary is a full record, complete enough for someone who never saw the chat to continue the work. */
export const SUMMARY_PROMPT = buildDefaultPrompt("summary", null);

/**
 * Compose the full prompt template, combining the base prompt, language,
 * and any appended prompt instructions.
 */
export function composePrompt(
  kind: "recap" | "summary",
  settings: Settings,
  extraInstructions?: string,
): string {
  let template =
    kind === "recap"
      ? (settings.recapPrompt ?? buildDefaultPrompt("recap", settings.language))
      : (settings.summaryPrompt ?? buildDefaultPrompt("summary", settings.language));

  if (settings.language && (kind === "recap" ? settings.recapPrompt : settings.summaryPrompt)) {
    template += `\n\nLanguage requirement:\n- Write everything in ${settings.language}. Translate all labels and headings to ${settings.language} too.`;
  }

  const additions: string[] = [];
  if (settings.appendPrompt) additions.push(settings.appendPrompt);
  if (kind === "recap" && settings.recapAppendPrompt) additions.push(settings.recapAppendPrompt);
  if (kind === "summary" && settings.summaryAppendPrompt) additions.push(settings.summaryAppendPrompt);
  if (extraInstructions && extraInstructions.trim().length > 0) additions.push(extraInstructions.trim());

  if (additions.length > 0) {
    template += `\n\nAdditional instructions:\n${additions.map((item) => `- ${item}`).join("\n")}`;
  }

  return template;
}

export interface PromptVariables extends Record<string, string> {
  conversation: string;
  status: string;
  sessionName: string;
  cwd: string;
  language: string;
}

/** Placeholders in the template that no variable fills, such as a typo in a custom prompt. */
export function unknownPlaceholders(template: string, variables: PromptVariables): string[] {
  const names = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string);
  return [...new Set(names.filter((name) => variables[name] === undefined))].map((name) => `{{${name}}}`);
}

/** Unknown placeholders stay as they are, so a typo shows up in the output instead of vanishing. */
export function renderPrompt(template: string, variables: PromptVariables): string {
  const filled = template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => variables[name] ?? placeholder);
  // Without the conversation the model would have nothing to read, so a custom prompt that forgot it still gets it.
  if (template.includes("{{conversation}}")) return filled;
  return `${filled}\n\n<conversation>\n${variables.conversation}\n</conversation>`;
}

export interface ModelChoice {
  model: Model<Api>;
  /** Set when the configured model could not be used and the session model stood in. */
  warning?: string;
}

export function chooseModel(settings: Settings, context: ExtensionContext): ModelChoice | undefined {
  const sessionModel = context.model;
  if (settings.model === null) return sessionModel ? { model: sessionModel } : undefined;

  const reference = splitModelRef(settings.model);
  const configured = reference ? context.modelRegistry.find(reference.provider, reference.modelId) : undefined;
  let problem: string | undefined;
  if (!configured) problem = `Model "${settings.model}" was not found.`;
  else if (!context.modelRegistry.hasConfiguredAuth(configured)) problem = `Model "${settings.model}" has no auth.`;
  else return { model: configured };

  return sessionModel ? { model: sessionModel, warning: `${problem} The session model was used.` } : undefined;
}

export type GenerateResult =
  /** `cutOff` is set when the model hit its output limit, so the text can end early. */
  | { kind: "text"; markdown: string; cutOff: boolean }
  | { kind: "error"; message: string }
  | { kind: "aborted" };

export interface GenerateOptions {
  thinking: ModelThinkingLevel;
  signal: AbortSignal;
  /** Called with the whole text so far each time more text arrives. */
  onText?: (markdown: string) => void;
  /** Called with the whole thinking so far each time more thinking arrives. Never called when the model shows no thinking. */
  onThinking?: (thinking: string) => void;
}

function joinBlocks(message: AssistantMessage, type: "text" | "thinking"): string {
  return message.content
    .map((block) => {
      if (type === "text" && block.type === "text") return block.text;
      if (type === "thinking" && block.type === "thinking") return block.thinking;
      return "";
    })
    .filter((part) => part.length > 0)
    .join("\n")
    .trim();
}

export async function generateMarkdown(
  model: Model<Api>,
  prompt: string,
  context: ExtensionContext,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { thinking, signal, onText, onThinking } = options;
  const stream = context.modelRegistry.streamSimple(
    model,
    { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
    {
      reasoning: thinking === "off" ? undefined : thinking,
      cacheRetention: "none",
      signal,
    },
  );
  if (onText || onThinking) {
    for await (const event of stream) {
      if (event.type === "text_delta") onText?.(joinBlocks(event.partial, "text"));
      else if (event.type === "thinking_delta") onThinking?.(joinBlocks(event.partial, "thinking"));
    }
  }
  const reply = await stream.result();

  if (reply.stopReason === "aborted" || signal.aborted) return { kind: "aborted" };
  if (reply.stopReason === "error") return { kind: "error", message: reply.errorMessage ?? "The model request failed." };

  const markdown = joinBlocks(reply, "text");
  if (markdown.length === 0) return { kind: "error", message: "The model returned no text." };
  return { kind: "text", markdown, cutOff: reply.stopReason === "length" };
}
