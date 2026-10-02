# pi-recap

**Two commands for pi that show where the conversation stands, in a popup.**

`/recap` shows three lines when you come back after a break.
`/summary` shows a full record of the conversation.
A separate model call writes the text.
The text never goes into the session, so the main model gets no extra tokens.

## Install

```bash
pi install npm:@lazco/pi-recap
```

Then run `/reload` in pi.

## Commands

### `/recap`

Use it when you come back to a session and do not remember where you were.
It shows three lines at most:

- **Goal:** what you want.
- **Now:** what the agent did last, or what it does now.
- **Your turn:** the question that waits on you. The line is left out when nothing waits.

### `/summary`

Use it to hand work to another person or session, or to write a PR or issue text.
It has these sections:

- Goal
- Decisions, each with its reason
- Done
- Current state
- Open questions
- Next steps

A section with nothing to say is left out.

## The popup

| Key | Action |
| --- | --- |
| `↑` `↓` `j` `k`, mouse wheel | Scroll one line |
| `PgUp` `PgDn` `Space` | Scroll one page |
| `Home` `End` `g` `G` | Go to the top or the bottom |
| `c` | Copy the text as Markdown |
| `Esc` `Enter` `q` | Close the popup |

`Esc` during loading also stops the model call.

## What the model reads

The model reads only your messages and the text of the agent replies.
It does not read tool calls, tool results, thinking, or images.
A skill run shows as the command you typed, for example `/skill:<name> <args>`.

When the conversation is longer than `maxInputChars`, the model gets the first user message and the newest messages.
A very long single message keeps its start and its end.

While the agent works, its unfinished reply is not in the conversation.
The recap then only says what the agent works on.

## Settings

The settings file is `~/.pi/agent/recap.json`.
The file is optional.
Each command run reads it again, so an edit applies without `/reload`.

```json
{
  "model": null,
  "thinking": "low",
  "maxInputChars": 120000,
  "recapPrompt": null,
  "summaryPrompt": null
}
```

| Field | Value | Default |
| --- | --- | --- |
| `model` | `"<provider>/<model-id>"`, or `null` for the session model | `null` |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` | `low` |
| `maxInputChars` | The max size of the conversation text, from 1000 to 2000000 | `120000` |
| `recapPrompt` | A custom prompt for `/recap`, or `null` for the built-in prompt | `null` |
| `summaryPrompt` | A custom prompt for `/summary`, or `null` for the built-in prompt | `null` |

If pi cannot find the `model`, or the model has no API key, the command uses the session model and shows a warning.
If the file has bad JSON or a bad field, the command shows an error and stops.

### Prompt variables

A custom prompt can use these variables:

| Variable | Value |
| --- | --- |
| `{{conversation}}` | The conversation text. If the prompt does not have it, the command adds it at the end. |
| `{{status}}` | One sentence that says if the agent is idle or works now |
| `{{sessionName}}` | The session name, or `(none)` |
| `{{cwd}}` | The working directory |

## Development

```sh
bun install
bun run check
bun run test
```

To release, see [AGENTS.md](./AGENTS.md#release).

## License

AGPL-3.0-or-later.
See [LICENSE](./LICENSE).
