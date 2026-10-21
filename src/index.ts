import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { loadSettings, type Settings, thinkingFor } from "./config.ts";
import { prepareConversation } from "./conversation.ts";
import { chooseModel, composePrompt, generateMarkdown, renderPrompt, statusLine, unknownPlaceholders } from "./generate.ts";
import { ResultPopup } from "./popup.ts";

/**
 * `/recap` and `/summary`: the conversation, condensed by a separate model call and shown in a popup.
 *
 * `/recap` is three lines for a user who comes back after a break.
 * `/summary` is a full record that someone else could continue the work from.
 * Neither result enters the session, so the main model sees no extra tokens.
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

  const conversation = prepareConversation(ctx.sessionManager.getBranch(), settings.maxInputChars);
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
    status: statusLine(ctx.isIdle()),
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
  if (ctx.mode === "tui") await showResultPopup(ctx, job);
  else await notifyResult(ctx, job);
}

interface DigestJob {
  title: string;
  thinking: ModelThinkingLevel;
  model: Model<Api>;
  prompt: string;
  messageCount: number;
  warnings: string[];
}

const CUT_OFF_WARNING = "The model stopped at its output limit. The text can end early.";

async function notifyResult(ctx: ExtensionCommandContext, job: DigestJob): Promise<void> {
  ctx.ui.notify(`Reading ${job.messageCount} messages with ${job.model.id}…`, "info");
  for (const warning of job.warnings) ctx.ui.notify(warning, "warning");

  try {
    // RPC has no cancel key for a running command, so the call always runs to the end.
    const result = await generateMarkdown(job.model, job.prompt, ctx, {
      thinking: job.thinking,
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

async function showResultPopup(ctx: ExtensionCommandContext, job: DigestJob): Promise<void> {
  const controller = new AbortController();

  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) => {
      const popup = new ResultPopup({
        tui,
        theme,
        keybindings,
        title: job.title,
        subtitle: job.model.id,
        loadingMessage: `Reading ${job.messageCount} messages…`,
        warnings: job.warnings,
        onClose: () => {
          controller.abort();
          done();
        },
      });

      const fillPopup = async () => {
        try {
          const result = await generateMarkdown(job.model, job.prompt, ctx, {
            thinking: job.thinking,
            signal: controller.signal,
            onThinking: (thinking) => {
              if (!controller.signal.aborted) popup.showThinking(thinking);
            },
            onText: (markdown) => {
              if (!controller.signal.aborted) popup.showPartialText(markdown);
            },
          });
          if (result.kind === "text") {
            if (result.cutOff) popup.addWarning(CUT_OFF_WARNING);
            popup.showText(result.markdown);
          } else if (result.kind === "error") {
            popup.showError(result.message);
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          popup.showError(error instanceof Error ? error.message : String(error));
        }
      };
      void fillPopup();

      return popup;
    },
    { overlay: true, overlayOptions: { width: "80%", minWidth: 40, anchor: "center" } },
  );
}
