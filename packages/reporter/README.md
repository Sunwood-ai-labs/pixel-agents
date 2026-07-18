# Pixel Agents Reporter

Lightweight per-PC telemetry client for Pixel Agents Hub. It reports task, status, activity, progress, parent linkage, and heartbeat freshness through the authenticated Remote Agent API. It never receives or executes commands.

```bash
cd packages/reporter
npm install
export PIXEL_AGENTS_URL='http://hub-host:3100'
export PIXEL_AGENTS_REMOTE_API_TOKEN='<dedicated token>'
npm exec pixel-agents-reporter -- report --config config.example.json
```

For a one-shot update, omit `interval` from the config. Service managers such as systemd can run the command continuously and restart it if the PC reboots. Keep the config free of tokens; supply the bearer token through a protected environment file.
