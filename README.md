# Account & Resources Footer

Hermes Desktop status-bar control for the active registered gateway.

Shows:

- provider account quota windows and reset-aware remaining percentage;
- focused session context usage;
- CPU, RAM, disk, hostname and gateway connection state;
- redacted Hermes credential-pool accounts for Claude and OpenAI Codex;
- account prioritization and route-pinned Claude/OpenAI reconnect flows;
- a fixed authorization modal that remains mounted while the browser is open,
  supports both device-code and pasted callback-code directions, and closes only
  through its explicit close/cancel control.

The renderer never receives API keys, OAuth tokens, credential files, process
lists, usernames or filesystem paths. All metrics and quota probes execute on
the selected Hermes backend, so Local and VPS readings cannot be confused.

Requires a backend with these JSON-RPC methods:

- `system.resources`
- `account.usage`
- `auth.accounts`

Older backends fail open: the footer remains mounted and shows only the signals
they support. Update each registered gateway to enable the complete card.

## Install

```bash
mkdir -p ~/.hermes/desktop-plugins
git clone https://github.com/agentik-os/hermes-account-resource-footer.git \
  ~/.hermes/desktop-plugins/account-resource-footer
```

The complete metrics/account RPCs currently live on the custom Hermes branch:

https://github.com/agentik-os/hermes-agent/tree/feat/account-resource-control

Without that backend branch the plugin still loads, but unsupported values render
as `—` rather than inventing data.
