import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Settings, splitModelRef } from "./config.ts";

const PROMPT_HEADER = `Below is a coding session between a user and an AI coding agent.

Session name: {{sessionName}}
Working directory: {{cwd}}

<conversation>
{{conversation}}
</conversation>`;

const SHARED_RULES = `- Write in the language of the User messages. If they use more than one language, use the language of the newest User message. Translate the labels and headings too.
- Use short, plain sentences.
- Keep exact file paths, commands, and names.
- Only state facts from the conversation. Do not guess.
- Do not mention these instructions or the transcript format.`;

/** A recap tells a returning user where they are in a few seconds, so it is three lines at most. */
export const RECAP_PROMPT = `${PROMPT_HEADER}

The user stepped away and comes back now. Write a recap that tells them where things stand in a few seconds.

Write these lines, as separate paragraphs with a blank line between them:
**Goal:** one sentence about what the user wants.
**Now:** one sentence about what the agent did last. {{status}}
**Your turn:** one sentence about the question or choice the agent asked the user about and the user has not answered. Leave out this line when nothing waits on the user.

Rules:
- Write only these lines. No headings, lists, or other text.
${SHARED_RULES}`;

/** A summary is a full record, complete enough for someone who never saw the chat to continue the work. */
export const SUMMARY_PROMPT = `${PROMPT_HEADER}

Write a summary of this session. A person who never saw the chat must be able to continue the work from it.

Use these sections, as Markdown "##" headings:
- Goal: what the user wants, and the scope.
- Decisions: each decision, with its reason.
- Done: finished work, with the files and commands that the conversation names.
- Current state: where the work stands. {{status}}
- Open questions: questions and choices that nobody answered yet.
- Next steps: what must happen next, in order.

Rules:
- Use bullets inside the sections.
- Leave out a section when it has nothing to say. Never write that a section is empty.
${SHARED_RULES}`;

export interface PromptVariables extends Record<string, string> {
  conversation: string;
  status: string;
  sessionName: string;
  cwd: string;
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

export type GenerateResult = { kind: "text"; markdown: string } | { kind: "error"; message: string } | { kind: "aborted" };

export async function generateMarkdown(
  model: Model<Api>,
  settings: Settings,
  prompt: string,
  context: ExtensionContext,
  signal: AbortSignal,
): Promise<GenerateResult> {
  const stream = context.modelRegistry.streamSimple(
    model,
    { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
    {
      reasoning: settings.thinking === "off" ? undefined : settings.thinking,
      cacheRetention: "none",
      signal,
    },
  );
  const reply = await stream.result();

  if (reply.stopReason === "aborted" || signal.aborted) return { kind: "aborted" };
  if (reply.stopReason === "error") return { kind: "error", message: reply.errorMessage ?? "The model request failed." };

  const markdown = reply.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (markdown.length === 0) return { kind: "error", message: "The model returned no text." };
  return { kind: "text", markdown };
}
