import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadSettings, type Settings } from "./config.ts";
import { collectTurns, renderConversation } from "./conversation.ts";
import { chooseModel, composePrompt, generateMarkdown, type ModelChoice, renderPrompt } from "./generate.ts";
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
    status: ctx.isIdle()
      ? "The agent is idle and waits for the user."
      : "The agent is working on the newest user message right now. Its reply is not in the conversation yet, so say what it is working on.",
    sessionName: ctx.sessionManager.getSessionName() ?? "(none)",
    cwd: ctx.cwd,
    language: settings.language ?? "",
  });

  if (ctx.mode === "tui") await showResultPopup(ctx, command.title, settings, choice, prompt, turns.length);
  else await notifyResult(ctx, settings, choice, prompt, turns.length);
}

async function notifyResult(
  ctx: ExtensionCommandContext,
  settings: Settings,
  choice: ModelChoice,
  prompt: string,
  messageCount: number,
): Promise<void> {
  ctx.ui.notify(`Reading ${messageCount} messages with ${choice.model.id}…`, "info");
  if (choice.warning) ctx.ui.notify(choice.warning, "warning");

  try {
    // RPC has no cancel key for a running command, so the call always runs to the end.
    const result = await generateMarkdown(choice.model, settings, prompt, ctx, new AbortController().signal);
    if (result.kind === "text") ctx.ui.notify(result.markdown, "info");
    else if (result.kind === "error") ctx.ui.notify(result.message, "error");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

async function showResultPopup(
  ctx: ExtensionCommandContext,
  title: string,
  settings: Settings,
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
          const result = await generateMarkdown(choice.model, settings, prompt, ctx, controller.signal);
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
