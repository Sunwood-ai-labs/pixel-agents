#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { ReporterClient } from './client.js';

const { command, options } = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

try {
  const fileConfig = options.config ? JSON.parse(await readFile(options.config, 'utf8')) : {};
  const config = { ...fileConfig, ...withoutUndefined(options) };
  const serverUrl = config.server ?? process.env.PIXEL_AGENTS_URL;
  const token = process.env.PIXEL_AGENTS_REMOTE_API_TOKEN;
  const client = new ReporterClient({ serverUrl, token });

  if (command === 'list') {
    print(await client.list());
  } else if (command === 'delete') {
    requireIdentity(config);
    print(await client.remove(config.host, config.agent));
  } else if (command === 'report') {
    requireIdentity(config);
    const update = makeUpdate(config);
    const intervalSeconds = numberOption(config.interval, 'interval');
    if (intervalSeconds !== undefined && intervalSeconds < 5) {
      throw new TypeError('interval must be at least 5 seconds');
    }
    print(await client.publish(config.host, config.agent, update));
    if (intervalSeconds !== undefined) {
      const timer = setInterval(async () => {
        try {
          print(await client.publish(config.host, config.agent, update));
        } catch (error) {
          console.error(error.message);
        }
      }, intervalSeconds * 1000);
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
          clearInterval(timer);
          process.exit(0);
        });
      }
    }
  } else {
    throw new TypeError(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function makeUpdate(config) {
  const current = numberOption(config.current, 'current');
  const total = numberOption(config.total, 'total');
  if ((current === undefined) !== (total === undefined)) {
    throw new TypeError('current and total must be provided together');
  }
  return withoutUndefined({
    displayName: config.name ?? config.agent,
    task: config.task ?? 'Remote task',
    status: config.status ?? 'active',
    activity: config.activity,
    heartbeatTtlSeconds: numberOption(config.ttl, 'ttl'),
    progress:
      current === undefined ? undefined : withoutUndefined({ current, total, unit: config.unit }),
    parent: config.parent
      ? { hostId: config.parentHost ?? config.host, agentId: config.parent }
      : undefined,
  });
}

function requireIdentity(config) {
  if (!config.host || !config.agent) throw new TypeError('--host and --agent are required');
}

function numberOption(value, label) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a number`);
  return number;
}

function parseArgs(argv) {
  const options = {};
  let command = 'report';
  let index = 0;
  if (argv[0] && !argv[0].startsWith('--')) {
    command = argv[0];
    index = 1;
  }
  while (index < argv.length) {
    const flag = argv[index++];
    if (flag === '--help') {
      options.help = true;
      continue;
    }
    if (!flag.startsWith('--')) throw new TypeError(`unexpected argument: ${flag}`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index++];
    if (value === undefined || value.startsWith('--'))
      throw new TypeError(`${flag} requires a value`);
    options[key] = value;
  }
  return { command, options };
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`pixel-agents-reporter [report|list|delete] [options]

Required environment:
  PIXEL_AGENTS_URL
  PIXEL_AGENTS_REMOTE_API_TOKEN

Report/delete identity:
  --host ID --agent ID

Report options:
  --name TEXT --task TEXT --status active|waiting|done --activity TEXT
  --current N --total N [--unit TEXT] [--parent ID] [--parent-host ID]
  --ttl SECONDS [--interval SECONDS] [--config FILE]

The Reporter publishes telemetry only. It does not accept or execute remote commands.`);
}
