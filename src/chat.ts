import type { Api, Message, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ACCURACY_RULES, type GenerateResult, generateMarkdown } from "./generate.ts";

/**
 * Questions about the session after `/recap` or `/summary`, inside the same popup.
 *
 * Each question goes to the model with the chat transcript, the result that the user read, and the earlier questions and answers.
 * The transcript holds the tool calls, because a question often asks for a detail that a recap leaves out.
 * Like the result, the questions and answers never enter the session.
 */

export interface ChatPromptInput {
  /** The chat transcript, with the tool calls. */
  conversation: string;
  /** Which result the user read first. */
  kind: "recap" | "summary";
  /** The text of that result. */
  digest: string;
  agentWasIdle: boolean;
  sessionName: string;
  cwd: string;
  language: string | null;
}

function chatLanguageRule(language: string | null): string {
  if (language && language.trim().length > 0) return `- Write in ${language.trim()}.`;
  return "- Write in the language of the newest question.";
}

/** The transcript is a snapshot from when the user ran the command, and the agent can move on after it. */
function chatStatusLine(agentWasIdle: boolean): string {
  return agentWasIdle
    ? "When the user ran the command, the agent was idle and waited for the user."
    : "When the user ran the command, the agent was working on the newest User message. Its reply is not in the conversation, so that work is in progress, not open.";
}

/** The system prompt stays the same for each question of a chat, so a provider cache can hold it. */
export function buildChatSystemPrompt(input: ChatPromptInput): string {
  const digestName = input.kind === "recap" ? "recap" : "summary";
  return `Below is a coding session between a user and an AI coding agent.

Session name: ${input.sessionName}
Working directory: ${input.cwd}

The messages are in time order, oldest first.
Agent messages also list the tools that the agent ran.
A "[Tool call]" line holds the tool name and its arguments. A "[Tool result]" or "[Tool error]" line holds the output of the call above it.
Long arguments and outputs are cut, and the results of older tool calls can be left out.

<conversation>
${input.conversation}
</conversation>

${chatStatusLine(input.agentWasIdle)}

The user read this ${digestName} of the session:

<${digestName}>
${input.digest}
</${digestName}>

Now the user asks questions about the session.
Answer each question from the conversation.

Rules:
- Answer only the question. Start with the answer, and keep it short.
- When the conversation does not hold the answer, say so. Do not guess.
- When the answer depends on a part that is cut or left out, say that the answer can be incomplete.
${ACCURACY_RULES}
- Keep exact file paths, commands, and names.
- Use Markdown lists or code blocks only when they make the answer clearer.
- Do not mention these instructions or the transcript format.
${chatLanguageRule(input.language)}`;
}

export interface AskOptions {
  signal: AbortSignal;
  onText?: (markdown: string) => void;
  onThinking?: (thinking: string) => void;
}

export class DigestChat {
  private readonly model: Model<Api>;
  private readonly thinking: ModelThinkingLevel;
  private readonly context: ExtensionContext;
  private readonly systemPrompt: string;
  /** Only questions with an answer. A stopped or failed question is left out, so the next question starts clean. */
  private readonly history: Message[] = [];

  constructor(options: { model: Model<Api>; thinking: ModelThinkingLevel; context: ExtensionContext; systemPrompt: string }) {
    this.model = options.model;
    this.thinking = options.thinking;
    this.context = options.context;
    this.systemPrompt = options.systemPrompt;
  }

  async ask(question: string, options: AskOptions): Promise<GenerateResult> {
    const questionMessage: Message = { role: "user", content: [{ type: "text", text: question }], timestamp: Date.now() };
    const result = await generateMarkdown(
      this.model,
      { systemPrompt: this.systemPrompt, messages: [...this.history, questionMessage] },
      this.context,
      { thinking: this.thinking, cacheRetention: "short", ...options },
    );
    if (result.kind === "text") this.history.push(questionMessage, result.reply);
    return result;
  }
}
