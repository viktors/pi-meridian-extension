# pi-meridian-extension

Use your **Claude Max subscription** through [pi](https://github.com/mariozechner/pi-coding-agent) via [Meridian](https://github.com/rynfar/meridian) — a local proxy that bridges the Anthropic Messages API with Claude Code SDK authentication.

Without this extension, pi's default system prompt triggers an `"You're out of extra usage"` error on Claude Opus 4.6 (and potentially other models) when routed through Meridian. This extension rewrites the system prompt **only for Meridian requests** to avoid that issue, while leaving all other providers untouched.

> **Fork notice.** This is [`viktors/pi-meridian-extension`](https://github.com/viktors/pi-meridian-extension), a fork of [`lnilluv/pi-meridian-extension`](https://github.com/lnilluv/pi-meridian-extension). It **auto-discovers the model catalog from the running Meridian proxy** at session start (so new models like Claude Fable 5 / Sonnet 5 appear without code changes), bundles `@rynfar/meridian` as a dependency so the proxy auto-starts from a plain `npm install`, and keeps a static fallback catalog for when the proxy is briefly down. Consume it as a pi git package: `pi install git:github.com/viktors/pi-meridian-extension@<commit>`.

## What it does

- **Auto-discovers models** from the Meridian proxy's `/v1/models` endpoint at session start — new models appear without editing the extension. Falls back to a static catalog if the proxy is unreachable.
- **Registers a `meridian` provider** with the discovered models plus a static floor (Fable 5, Sonnet 5, Sonnet 4.6, Opus 5/4.6/4.7/4.8, Haiku 4.5). Floor fills gaps when the proxy lags (e.g. Opus 5 before Meridian lists it).
- **Rewrites the system prompt** for Meridian requests to avoid the extra-usage error, preserving project context and working directory
- **Auto-starts Meridian** on session start if the proxy isn't running
- **Adds commands**: `/meridian` (health check), `/meridian start`, `/meridian version`

## Models

The catalog is **discovered at runtime** from the Meridian proxy (GET `/v1/models`), then **unioned with a static floor** so models Meridian routes but has not yet advertised still appear. Each entry's `context_window`, `display_name`, and capabilities (thinking, image input) are mapped directly; the table below is the static floor.

| ID | Name |
| ---- | ------ |
| `meridian/claude-fable-5` | Claude Fable 5 |
| `meridian/claude-sonnet-5` | Claude Sonnet 5 |
| `meridian/claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `meridian/claude-opus-5` | Claude Opus 5 |
| `meridian/claude-opus-4-6` | Claude Opus 4.6 |
| `meridian/claude-opus-4-7` | Claude Opus 4.7 |
| `meridian/claude-opus-4-8` | Claude Opus 4.8 |
| `meridian/claude-haiku-4-5` | Claude Haiku 4.5 |

Use them with `--model`, e.g. `--model meridian/claude-opus-5:high`.

> **maxTokens and pricing are not exposed by `/v1/models`.** The extension fills them from a per-family fallback table (e.g. Fable → 128K output / $10–$50 per M tokens, Sonnet → 64K, Opus 4.x → 32K / $15–$75, Opus 5 → 128K / $5–$25, Haiku → 16K; Sonnet 5 uses its promotional rate). Unknown models get a conservative 32K output and zero cost. Pricing only affects pi's spend display — your Claude subscription via the proxy is unaffected.
>
> Discovery runs once per pi launch (no mid-session refresh). To pick up newly added models, restart pi. For models to appear in Ctrl+P cycling automatically, use a wildcard in `enabledModels`, e.g. `"meridian/claude-*"`.

## Install

From this fork (recommended for `viktors`):

```bash
pi install git:github.com/viktors/pi-meridian-extension
```

`@rynfar/meridian` is declared as a dependency, so pi's clone-time `npm install` provides the `meridian` binary at `node_modules/.bin/meridian` and the extension auto-starts the proxy with no extra setup. (Upstream's npm flow and a global install also still work:)

```bash
pi install npm:pi-meridian-extension   # upstream
npm install -g @rynfar/meridian         # only needed without the bundled dep
```

## Configuration

| Env var | Default | Description |
| --------- | --------- | ------------- |
| `MERIDIAN_BASE_URL` | `http://127.0.0.1:3456` | Meridian proxy URL |
| `MERIDIAN_API_KEY` | `meridian` | Bearer token sent to Meridian. Set this to the same value as the Meridian daemon when upstream API-key auth is enabled. |
| `MERIDIAN_PROFILE` | unset | Optional Meridian profile ID sent as `x-meridian-profile` for multi-profile setups. |

## Subagent Compatibility

When using pi-subagents with custom agent definitions (`.md` files in `~/.pi/agent/agents/`), you must add the meridian extension to each agent's `extensions:` frontmatter. Without this, user-defined agents spawn with `--no-extensions`, which strips all global extensions — including this one — so the `meridian` provider won't be available.

Add the meridian extension path to your agent's frontmatter:

```yaml
---
name: my-agent
extensions: /path/to/other/extension.ts, /opt/homebrew/lib/node_modules/pi-meridian-extension/extensions/index.ts
---
```

> **Note**: This is only needed for user-defined agents with explicit `extensions:` in their frontmatter. Builtin agents (like `delegate`) inherit global extensions automatically.

## Switch to Meridian

After installing, switch your model in pi:

```
/model meridian/claude-opus-5:high
```

Or use it for a single command:

```bash
pi --model meridian/claude-opus-5:high
```

## Commands

- `/meridian` — health check (connection status, runtime version, auth, mode)
- `/meridian start` — start the Meridian daemon if not running
- `/meridian version` — check installed vs latest version, update availability

## How the prompt rewrite works

When `provider === "meridian"`, the extension hooks `before_provider_request` and replaces the full system prompt with a concise version that:

1. Identifies as Claude Code operating through Meridian for pi
2. Preserves your `# Project Context` section from the original prompt
3. Preserves `Current date:` and `Current working directory:` lines
4. Drops pi's heavy default prompt that triggers the extra-usage error

All other providers continue to use pi's default system prompt unchanged.
