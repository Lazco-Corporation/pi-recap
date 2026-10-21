# Custom prompts

You can change the prompt of `/recap` and `/summary` in `~/.pi/agent/recap.json`.
There are two ways: add instructions to the built-in prompt, or replace the full prompt.

## Add instructions

Use these fields to add instructions to the end of the prompt:

| Field | Applies to |
| --- | --- |
| `appendPrompt` | `/recap` and `/summary` |
| `recapAppendPrompt` | `/recap` only |
| `summaryAppendPrompt` | `/summary` only |

Text after the command also adds instructions, for one run only.
For example, `/recap focus on git changes`.

The command adds the instructions in this order: `appendPrompt`, then the field for the command, then the text after the command.

```json
{
  "appendPrompt": "Name the git branch if the conversation shows it.",
  "summaryAppendPrompt": "End with a one-line pull request title."
}
```

## Replace the prompt

Use `recapPrompt` or `summaryPrompt` to replace the built-in prompt.
The prompt can use these variables:

| Variable | Value |
| --- | --- |
| `{{conversation}}` | The conversation text, as `User:` and `Agent:` lines, built by the rules in [What the model reads](../README.md#what-the-model-reads). If the prompt does not have it, the command adds it at the end. |
| `{{status}}` | One or two sentences that say if the agent is idle, or that it works on the newest message now and that this message is in progress |
| `{{sessionName}}` | The session name, or `(none)` |
| `{{cwd}}` | The working directory |
| `{{language}}` | The `language` setting, or empty text |

The command keeps an unknown variable as it is and shows a warning, so a typo shows in the output.

```json
{
  "recapPrompt": "Read this coding session and write one sentence about what to do next.\n\n{{status}}\n\n{{conversation}}"
}
```

The added instructions and the `language` setting also apply to a custom prompt.
