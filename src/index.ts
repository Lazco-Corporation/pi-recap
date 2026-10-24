import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { loadSettings, type Settings, thinkingFor } from "./config.ts";
import { buildChatSystemPrompt, DigestChat } from "./chat.ts";
import { prepareChatConversation, prepareConversation } from "./conversation.ts";
import {
  chooseModel,
  composePrompt,
  type GenerateResult,
  generateMarkdown,
  renderPrompt,
  singlePromptRequest,
  statusLine,
  unknownPlaceholders,
} from "./generate.ts";
import { ResultPopup } from "./popup.ts";

/**
 * `/recap` and `/summary`: the conversation, condensed by a separate model call and shown in a popup.
 *
 * `/recap` is three lines for a user who comes back after a break.
 * `/summary` is a full record that someone else could continue the work from.
 * Neither result enters the session, so the main model sees no extra tokens.
 * After the result, the user can ask questions about the session in the popup. They stay out of the session too.
 *
 * In RPC mode there is no terminal for the popup, so the result goes to the client as a notification.
 */

interface DigestCommand {
  name: string;
  kind: "recap" | "summary";
  description: string;
  /** Popup title. */
  title: string;
}

const DIGEST_COMMANDS: readonly DigestCommand[] = [
  {
    name: "recap",
    kind: "recap",
    description: "Show where this conversation stands, in three lines",
    title: "Recap",
  },
  {
    name: "summary",
    kind: "summary",
    description: "Show a full summary of this conversation",
    title: "Summary",
  },
];

export default function (pi: ExtensionAPI): void {
  for (const command of DIGEST_COMMANDS) {
    pi.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        await runDigestCommand(command, args, ctx);
      },
    });
  }
}

async function runDigestCommand(
  command: DigestCommand,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  // Print and JSON modes have no way to show the result.
  if (!ctx.hasUI) return;

  let settings: Settings;
  try {
    settings = loadSettings(getAgentDir());
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    return;
  }

  // Questions in the popup read the same moment of the session as the result, even when the agent moves on meanwhile.
  const entries = ctx.sessionManager.getBranch();
  const agentWasIdle = ctx.isIdle();
  const conversation = prepareConversation(entries, settings.maxInputChars);
  if (conversation.messageCount === 0) {
    ctx.ui.notify("The conversation is empty.", "info");
    return;
  }

  const choice = chooseModel(settings, ctx);
  if (!choice) {
    ctx.ui.notify("No model is available.", "error");
    return;
  }

  const template = composePrompt(command.kind, settings, args);
  const variables = {
    conversation: conversation.text,
    status: statusLine(agentWasIdle),
    sessionName: ctx.sessionManager.getSessionName() ?? "(none)",
    cwd: ctx.cwd,
    language: settings.language ?? "",
  };
  const unknown = unknownPlaceholders(template, variables);

  // Everything the user did not expect, in the order it happened: the model, the conversation, then the prompt.
  const warnings = [
    ...(choice.warning ? [choice.warning] : []),
    ...conversation.warnings,
    ...(unknown.length > 0 ? [`The prompt has an unknown placeholder: ${unknown.join(", ")}. The model got it as written.`] : []),
  ];

  const job: DigestJob = {
    title: command.title,
    thinking: thinkingFor(command.kind, settings),
    model: choice.model,
    prompt: renderPrompt(template, variables),
    messageCount: conversation.messageCount,
    warnings,
  };
  if (ctx.mode !== "tui") {
    await notifyResult(ctx, job);
    return;
  }

  const sessionName = variables.sessionName;
  const startChat: StartChat = (digest) => {
    const chatConversation = prepareChatConversation(entries, settings.maxInputChars);
    const systemPrompt = buildChatSystemPrompt({
      conversation: chatConversation.text,
      kind: command.kind,
      digest,
      agentWasIdle,
      sessionName,
      cwd: ctx.cwd,
      language: settings.language,
    });
    const chat = new DigestChat({ model: job.model, thinking: job.thinking, context: ctx, systemPrompt });
    return { chat, warnings: chatConversation.warnings };
  };
  await showResultPopup(ctx, job, startChat);
}

interface DigestJob {
  title: string;
  thinking: ModelThinkingLevel;
  model: Model<Api>;
  prompt: string;
  messageCount: number;
  warnings: string[];
}

/** Builds the chat from the result text, the first time the user asks. It also returns what the chat model does not get. */
type StartChat = (digest: string) => { chat: DigestChat; warnings: string[] };

const CUT_OFF_WARNING = "The model stopped at its output limit. The text can end early.";

async function notifyResult(ctx: ExtensionCommandContext, job: DigestJob): Promise<void> {
  ctx.ui.notify(`Reading ${job.messageCount} messages with ${job.model.id}…`, "info");
  for (const warning of job.warnings) ctx.ui.notify(warning, "warning");

  try {
    // RPC has no cancel key for a running command, so the call always runs to the end.
    const result = await generateMarkdown(job.model, singlePromptRequest(job.prompt), ctx, {
      thinking: job.thinking,
      cacheRetention: "none",
      signal: new AbortController().signal,
    });
    if (result.kind === "text") {
      if (result.cutOff) ctx.ui.notify(CUT_OFF_WARNING, "warning");
      ctx.ui.notify(result.markdown, "info");
    } else if (result.kind === "error") {
      ctx.ui.notify(result.message, "error");
    }
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

/** Stream one model reply into the newest block of the popup. Returns the text when the reply is complete. */
async function streamIntoPopup(
  popup: ResultPopup,
  signal: AbortSignal,
  generate: (callbacks: { onThinking: (thinking: string) => void; onText: (markdown: string) => void }) => Promise<GenerateResult>,
): Promise<string | undefined> {
  try {
    const result = await generate({
      onThinking: (thinking) => {
        if (!signal.aborted) popup.showThinking(thinking);
      },
      onText: (markdown) => {
        if (!signal.aborted) popup.showPartialText(markdown);
      },
    });
    if (result.kind === "text") {
      if (result.cutOff) popup.addWarning(CUT_OFF_WARNING);
      popup.showText(result.markdown);
      return result.markdown;
    }
    if (result.kind === "error") popup.showError(result.message);
  } catch (error) {
    if (!signal.aborted) popup.showError(error instanceof Error ? error.message : String(error));
  }
  return undefined;
}

async function showResultPopup(ctx: ExtensionCommandContext, job: DigestJob, startChat: StartChat): Promise<void> {
  // Closing the popup stops every call. Stopping an answer stops only that answer.
  const popupController = new AbortController();
  let answerController: AbortController | undefined;
  let digest: string | undefined;
  let chat: DigestChat | undefined;

  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) => {
      const ask = async (question: string) => {
        if (digest === undefined) return;
        if (!chat) {
          const started = startChat(digest);
          chat = started.chat;
          // The first answer shows what the chat model does not get, under its question.
          for (const warning of started.warnings) popup.addWarning(warning);
        }
        const activeChat = chat;
        const controller = new AbortController();
        answerController = controller;
        const signal = AbortSignal.any([popupController.signal, controller.signal]);
        await streamIntoPopup(popup, signal, (callbacks) => activeChat.ask(question, { signal, ...callbacks }));
        if (controller.signal.aborted && !popupController.signal.aborted) popup.showStopped();
        if (answerController === controller) answerController = undefined;
      };

      const popup = new ResultPopup({
        tui,
        theme,
        keybindings,
        title: job.title,
        subtitle: job.model.id,
        loadingMessage: `Reading ${job.messageCount} messages…`,
        warnings: job.warnings,
        onClose: () => {
          popupController.abort();
          done();
        },
        onAsk: (question) => void ask(question),
        onStopAnswer: () => answerController?.abort(),
      });

      const fillPopup = async () => {
        const signal = popupController.signal;
        digest = await streamIntoPopup(popup, signal, (callbacks) =>
          generateMarkdown(job.model, singlePromptRequest(job.prompt), ctx, {
            thinking: job.thinking,
            cacheRetention: "none",
            signal,
            ...callbacks,
          }),
        );
      };
      void fillPopup();

      return popup;
    },
    { overlay: true, overlayOptions: { width: "80%", minWidth: 40, anchor: "center" } },
  );
}
