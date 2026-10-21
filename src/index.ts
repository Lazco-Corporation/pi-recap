import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { loadSettings, type Settings, thinkingFor } from "./config.ts";
import { collectTurns, renderConversation } from "./conversation.ts";
import { chooseModel, composePrompt, generateMarkdown, type ModelChoice, renderPrompt, statusLine } from "./generate.ts";
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

  const turns = collectTurns(ctx.sessionManager.getBranch());
  if (turns.length === 0) {
    ctx.ui.notify("The conversation is empty.", "info");
    return;
  }

  const choice = chooseModel(settings, ctx);
  if (!choice) {
    ctx.ui.notify("No model is available.", "error");
    return;
  }

  const prompt = renderPrompt(composePrompt(command.kind, settings, args), {
    conversation: renderConversation(turns, settings.maxInputChars),
    status: statusLine(ctx.isIdle()),
    sessionName: ctx.sessionManager.getSessionName() ?? "(none)",
    cwd: ctx.cwd,
    language: settings.language ?? "",
  });

  const thinking = thinkingFor(command.kind, settings);
  if (ctx.mode === "tui") await showResultPopup(ctx, command.title, thinking, choice, prompt, turns.length);
  else await notifyResult(ctx, thinking, choice, prompt, turns.length);
}

async function notifyResult(
  ctx: ExtensionCommandContext,
  thinking: ModelThinkingLevel,
  choice: ModelChoice,
  prompt: string,
  messageCount: number,
): Promise<void> {
  ctx.ui.notify(`Reading ${messageCount} messages with ${choice.model.id}…`, "info");
  if (choice.warning) ctx.ui.notify(choice.warning, "warning");

  try {
    // RPC has no cancel key for a running command, so the call always runs to the end.
    const result = await generateMarkdown(choice.model, prompt, ctx, { thinking, signal: new AbortController().signal });
    if (result.kind === "text") ctx.ui.notify(result.markdown, "info");
    else if (result.kind === "error") ctx.ui.notify(result.message, "error");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

async function showResultPopup(
  ctx: ExtensionCommandContext,
  title: string,
  thinking: ModelThinkingLevel,
  choice: ModelChoice,
  prompt: string,
  messageCount: number,
): Promise<void> {
  const controller = new AbortController();

  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) => {
      const popup = new ResultPopup({
        tui,
        theme,
        keybindings,
        title,
        subtitle: choice.model.id,
        loadingMessage: `Reading ${messageCount} messages…`,
        onClose: () => {
          controller.abort();
          done();
        },
      });

      const fillPopup = async () => {
        try {
          const result = await generateMarkdown(choice.model, prompt, ctx, {
            thinking,
            signal: controller.signal,
            onText: (markdown) => {
              if (!controller.signal.aborted) popup.showPartialText(markdown, choice.warning);
            },
          });
          if (result.kind === "text") popup.showText(result.markdown, choice.warning);
          else if (result.kind === "error") popup.showError(result.message);
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
