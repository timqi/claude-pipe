# claude-pipe

Personal AI assistant bot for Discord and terminal, powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.

Fork of [georgi/claude-pipe](https://github.com/georgi/claude-pipe).

## Getting started

Requires [Node.js](https://nodejs.org/) 20+ and the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code).

First run starts the onboarding wizard which creates `~/.claude-pipe/settings.json`. After that, the bot starts automatically.

```bash
npm run dev                    # start (first run triggers onboarding)
npm run dev -- --reconfigure   # re-run the wizard
npm run register <app-id>     # register Discord slash commands (once)
```

## Configuration

`~/.claude-pipe/settings.json`:

```json
{
  "channel": "discord",
  "token": "your-bot-token",
  "allowFrom": ["discord-user-id"],
  "model": "claude-sonnet-4-5",
  "workspace": "/path/to/default/workspace",
  "personality": { "name": "Piper", "traits": "friendly, direct, and concise" },
  "transcriptLog": { "enabled": false },
  "logLevel": "verbose"
}
```

- `channel` — `discord` or `cli`
- `token` — Discord bot token
- `allowFrom` — allowed user IDs (required, cannot be empty)
- `model` — Claude model name
- `workspace` — default workspace directory
- `personality` — optional name and traits for the bot
- `transcriptLog` — optional conversation logging (`enabled`, `path`, `maxBytes`, `maxFiles`)
- `logLevel` — `verbose` (default), `status`, or `off`

Per-channel workspaces are managed dynamically via the `/setproj` command.

File attachments sent in Discord messages are automatically downloaded and forwarded to Claude.

Secrets (e.g. Discord token) can also be placed in `~/.claude-pipe/.env`.

## Commands

- `/session` — show, clear, or manage sessions
- `/session newchat` — create a new Discord channel for the current project
- `/session delchat` — delete a Discord channel and its mappings
- `/setproj <path>` — map this chat to `$HOME/code/<path>` and start fresh
- `/lsproj` — list all workspace mappings
- `/workspace` — show or change workspace mappings
- `/model` — show or change model
- `/status` — show bot status
- `/config` — show or change runtime config
- `/reload` — reload settings from disk
- `/stop` — cancel the current in-progress turn
- `/help` — list all commands

### Cron jobs

Schedule recurring prompts on a cron schedule (per-channel):

- `/cron add "<schedule>" <prompt>` — create a cron job
- `/cron list` — list jobs for this channel (`--all` for all channels)
- `/cron edit <id> "<schedule>" [prompt]` — change schedule and/or prompt
- `/cron enable <id>` / `/cron disable <id>` — toggle a job
- `/cron delete <id>` — remove a job

Jobs auto-disable when the target channel is deleted. Cron fire events and turn outputs are logged to `~/.claude-pipe/cronlogs/<project-path>.log`.

## Architecture

Single Node.js process: event bus, pluggable channels, one agent loop.

```
┌─────────┐  ┌─────────┐  ┌────────────────┐
│ Discord │  │   CLI   │  │ Cron Scheduler │
└────┬────┘  └────┬────┘  └───────┬────────┘
     │            │               │
     ▼            ▼               ▼
┌──────────────────────────────────────┐
│            Message Bus               │
│       (inbound / outbound queues)    │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│            Agent Loop                │
│  ┌─────────────┐  ┌──────────────┐  │
│  │  Command     │  │ Claude Code  │  │
│  │  Handler     │  │ CLI Client   │  │
│  └─────────────┘  └──────┬───────┘  │
└───────────────────────────┼──────────┘
                            │
         ┌──────────┬───────┼───────┬──────────┐
         ▼          ▼       ▼       ▼          ▼
   ┌──────────┐┌────────┐┌─────┐┌──────────┐┌────────┐
   │ Session  ││Workspace││Cron ││Transcript││  Cron  │
   │ Store    ││ Store   ││Store││ Logger   ││  Log   │
   └──────────┘└────────┘└─────┘└──────────┘└────────┘
```

## Security

- `allowFrom` controls who can use the bot (empty = reject all)
- Claude runs with `--dangerously-skip-permissions` — the agent has full access to the workspace
- `/setproj` restricts paths to `$HOME/code/`

## Development

```bash
npm run build      # compile TypeScript
npm run test       # run tests (watch mode)
npm run test:run   # run tests once
```
