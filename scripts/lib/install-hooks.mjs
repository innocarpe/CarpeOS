/**
 * Capture-hook install helpers for multi-host agent configs.
 * Merges CarpeOS entries without wiping user hooks; rewrites commands to an
 * absolute carpeos wrapper path (prefer ~/.local/bin/carpeos).
 *
 * Hosts with lifecycle capture install:
 *   claude, codex, grok, deepseek-build (JSON hooks), gjc (TypeScript hook plugin)
 * MCP-only hosts (no lifecycle merge here — see install-core registerHostMcp):
 *   deepcode, reasonix
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/** Hosts that receive capture lifecycle install. */
export const HOOK_HOSTS = ["claude", "codex", "grok", "gjc", "deepseek-build"];

/** All setup hosts (hooks and/or MCP). */
export const SETUP_HOSTS = [
  "claude",
  "codex",
  "grok",
  "gjc",
  "deepcode",
  "reasonix",
  "deepseek-build",
];

export const CAPTURE_HOOK_MARKER = "capture-hook --provider";

/** @type {Record<string, string>} */
const HOST_ALIASES = {
  gajae: "gjc",
  "gajae-code": "gjc",
  dsb: "deepseek-build",
  deepseek_build: "deepseek-build",
  "deep-code": "deepcode",
};

/**
 * Canonical host id from user input.
 * @param {string} host
 */
export function normalizeHostId(host) {
  const key = String(host || "")
    .trim()
    .toLowerCase();
  return HOST_ALIASES[key] ?? key;
}

/**
 * capture-hook --provider id for a setup host.
 * @param {string} host
 */
export function hostToProvider(host) {
  const h = normalizeHostId(host);
  if (h === "deepseek-build") return "deepseek_build";
  return h;
}

/**
 * Default user-layer config path per host (not CarpeOS home).
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [env]
 */
export function defaultHookConfigPath(host, env = process.env) {
  const userHome = env.HOME?.trim() || homedir();
  const h = normalizeHostId(host);
  if (h === "claude") {
    return join(userHome, ".claude", "settings.json");
  }
  if (h === "codex") {
    return join(userHome, ".codex", "hooks.json");
  }
  if (h === "grok") {
    return join(userHome, ".grok", "hooks.json");
  }
  if (h === "deepseek-build") {
    // Grok-derived; product path prepared for DeepSeek Build hooks layer.
    return join(userHome, ".deepseek-build", "hooks.json");
  }
  if (h === "gjc") {
    return join(userHome, ".gjc", "agent", "hooks", "carpeos-capture.ts");
  }
  throw new Error(`unsupported hook host: ${host}`);
}

/**
 * Resolve directory that holds adapter templates.
 * Supports git checkout (adapters/) and npm package (dist/setup/hooks/).
 * @param {string} [repoOrPackageRoot]
 * @param {string} [fromUrl]
 */
export function resolveHooksTemplateDir(repoOrPackageRoot, fromUrl = import.meta.url) {
  if (repoOrPackageRoot) {
    const fromAdapters = join(repoOrPackageRoot, "adapters");
    if (existsSync(join(fromAdapters, "codex", "hooks.json.example"))) {
      return fromAdapters;
    }
    const fromDist = join(repoOrPackageRoot, "dist", "setup", "hooks");
    if (existsSync(join(fromDist, "codex", "hooks.json.example"))) {
      return fromDist;
    }
    const fromSetup = join(repoOrPackageRoot, "setup", "hooks");
    if (existsSync(join(fromSetup, "codex", "hooks.json.example"))) {
      return fromSetup;
    }
  }
  // scripts/lib -> scripts -> repo root /adapters
  const here = dirname(fileURLToPath(fromUrl));
  const repoAdapters = resolve(here, "../../adapters");
  if (existsSync(join(repoAdapters, "codex", "hooks.json.example"))) {
    return repoAdapters;
  }
  // dist/setup/install-hooks.mjs sibling hooks/
  const sibling = resolve(here, "hooks");
  if (existsSync(join(sibling, "codex", "hooks.json.example"))) {
    return sibling;
  }
  throw new Error("capture-hook templates not found (adapters/ or dist/setup/hooks/)");
}

/**
 * @param {string} host
 * @param {string} templateDir
 */
export function loadHookTemplate(host, templateDir) {
  const h = normalizeHostId(host);
  if (h === "claude") {
    const path = join(templateDir, "claude", "settings.json.example");
    return JSON.parse(readFileSync(path, "utf8"));
  }
  if (h === "codex") {
    const path = join(templateDir, "codex", "hooks.json.example");
    return JSON.parse(readFileSync(path, "utf8"));
  }
  if (h === "grok") {
    const path = join(templateDir, "grok", "hooks.json.example");
    return JSON.parse(readFileSync(path, "utf8"));
  }
  if (h === "deepseek-build") {
    const path = join(templateDir, "deepseek-build", "hooks.json.example");
    return JSON.parse(readFileSync(path, "utf8"));
  }
  if (h === "gjc") {
    const path = join(templateDir, "gjc", "carpeos-capture.ts.example");
    return { kind: "gjc_ts", source: readFileSync(path, "utf8") };
  }
  throw new Error(`unsupported hook host: ${host}`);
}

/**
 * Absolute-safe capture-hook command string for a host provider.
 * @param {string} binDir
 * @param {string} providerOrHost - provider id or setup host id
 */
export function captureHookCommand(binDir, providerOrHost) {
  const bin = resolve(binDir, "carpeos");
  const quoted = shellQuotePath(bin);
  const provider = hostToProvider(providerOrHost);
  return `${quoted} capture-hook --provider ${provider} --fail-open --quiet`;
}

/**
 * Absolute carpeos binary path (unquoted).
 * @param {string} binDir
 */
export function carpeosBinPath(binDir) {
  return resolve(binDir, "carpeos");
}

/**
 * @param {string} value
 */
export function shellQuotePath(value) {
  // Always single-quote for shell safety (spaces, special chars).
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {unknown} command
 * @param {string} provider
 */
export function isCarpeosCaptureCommand(command, provider) {
  if (typeof command !== "string") {
    return false;
  }
  const normalized = command.replace(/['"]/g, " ");
  const providerId = hostToProvider(provider);
  return (
    normalized.includes("capture-hook") &&
    (normalized.includes(`--provider ${providerId}`) ||
      normalized.includes(`--provider=${providerId}`) ||
      normalized.includes(`--provider ${provider}`) ||
      normalized.includes(`--provider=${provider}`))
  );
}

/**
 * Rewrite template hook commands to absolute binDir carpeos.
 * @param {object} template
 * @param {string} host
 * @param {string} binDir
 */
export function materializeHookTemplate(template, host, binDir) {
  if (template && template.kind === "gjc_ts") {
    const bin = carpeosBinPath(binDir);
    const source = String(template.source || "").replaceAll("__CARPEOS_BIN__", bin);
    return { kind: "gjc_ts", source, provider: hostToProvider(host) };
  }
  const command = captureHookCommand(binDir, host);
  const clone = structuredClone(template);
  const hooksRoot = clone.hooks;
  if (!hooksRoot || typeof hooksRoot !== "object") {
    return clone;
  }
  for (const eventName of Object.keys(hooksRoot)) {
    const groups = hooksRoot[eventName];
    if (!Array.isArray(groups)) {
      continue;
    }
    for (const group of groups) {
      if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) {
        continue;
      }
      for (const entry of group.hooks) {
        if (entry && typeof entry === "object" && entry.type === "command") {
          entry.command = command;
        }
      }
    }
  }
  return clone;
}

/**
 * Deep-merge CarpeOS hook entries into an existing host config object.
 * Preserves non-CarpeOS hook groups/entries; upserts CarpeOS commands per event.
 *
 * @param {object} existing - full host file object (may be empty)
 * @param {object} carpeosTemplate - materialized template (absolute commands)
 * @param {string} host
 * @returns {{ merged: object, changed: boolean, events: string[] }}
 */
export function mergeHostHooks(existing, carpeosTemplate, host) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? structuredClone(existing)
      : {};
  if (!base.hooks || typeof base.hooks !== "object" || Array.isArray(base.hooks)) {
    base.hooks = {};
  }

  const templateHooks = carpeosTemplate?.hooks;
  if (!templateHooks || typeof templateHooks !== "object") {
    return { merged: base, changed: false, events: [] };
  }

  /** @type {string[]} */
  const events = [];
  let changed = false;

  for (const eventName of Object.keys(templateHooks)) {
    const templateGroups = templateHooks[eventName];
    if (!Array.isArray(templateGroups) || templateGroups.length === 0) {
      continue;
    }
    // Use first template group as the CarpeOS payload for this event.
    const templateGroup = structuredClone(templateGroups[0]);
    const templateEntries = Array.isArray(templateGroup.hooks) ? templateGroup.hooks : [];
    const provider = hostToProvider(host);
    const carpeosEntries = templateEntries.filter(
      (entry) =>
        entry && entry.type === "command" && isCarpeosCaptureCommand(entry.command, provider),
    );
    if (carpeosEntries.length === 0) {
      continue;
    }

    events.push(eventName);
    const existingGroups = Array.isArray(base.hooks[eventName]) ? base.hooks[eventName] : [];
    /** @type {object[]} */
    const nextGroups = [];

    let upserted = false;
    for (const group of existingGroups) {
      if (!group || typeof group !== "object") {
        nextGroups.push(group);
        continue;
      }
      const hooks = Array.isArray(group.hooks) ? group.hooks : [];
      const nonCarpeos = hooks.filter(
        (entry) => !(entry && isCarpeosCaptureCommand(entry.command, host)),
      );
      const hadCarpeos = nonCarpeos.length !== hooks.length;
      if (hadCarpeos && !upserted) {
        // Replace prior CarpeOS entries in this group with the new command payload.
        const nextGroup = { ...group, hooks: [...nonCarpeos, ...carpeosEntries] };
        nextGroups.push(nextGroup);
        upserted = true;
        changed = true;
      } else if (hadCarpeos && upserted) {
        // Drop duplicate CarpeOS-only groups; keep leftover user hooks if any.
        if (nonCarpeos.length > 0) {
          nextGroups.push({ ...group, hooks: nonCarpeos });
          changed = true;
        } else {
          changed = true;
        }
      } else {
        nextGroups.push(group);
      }
    }

    if (!upserted) {
      nextGroups.push({ hooks: carpeosEntries, ...stripHooksKey(templateGroup) });
      changed = true;
    }

    // Detect no-op when already identical single command.
    if (!configsEqual(base.hooks[eventName], nextGroups)) {
      base.hooks[eventName] = nextGroups;
      changed = true;
    }
  }

  // Preserve template description for codex when file was empty.
  if (
    typeof carpeosTemplate.description === "string" &&
    (base.description === undefined || base.description === "")
  ) {
    base.description = carpeosTemplate.description;
    changed = true;
  }

  return { merged: base, changed, events };
}

/**
 * Remove only CarpeOS capture-hook entries; leave user hooks intact.
 * @param {object} existing
 * @param {string} host
 */
export function uninstallHostHooks(existing, host) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? structuredClone(existing)
      : {};
  if (!base.hooks || typeof base.hooks !== "object") {
    return { merged: base, changed: false, events: [] };
  }

  /** @type {string[]} */
  const events = [];
  let changed = false;

  for (const eventName of Object.keys(base.hooks)) {
    const groups = base.hooks[eventName];
    if (!Array.isArray(groups)) {
      continue;
    }
    /** @type {object[]} */
    const nextGroups = [];
    for (const group of groups) {
      if (!group || typeof group !== "object") {
        nextGroups.push(group);
        continue;
      }
      const hooks = Array.isArray(group.hooks) ? group.hooks : [];
      const nonCarpeos = hooks.filter(
        (entry) => !(entry && isCarpeosCaptureCommand(entry.command, host)),
      );
      if (nonCarpeos.length !== hooks.length) {
        changed = true;
        events.push(eventName);
      }
      if (nonCarpeos.length > 0) {
        nextGroups.push({ ...group, hooks: nonCarpeos });
      }
    }
    if (nextGroups.length === 0) {
      delete base.hooks[eventName];
    } else {
      base.hooks[eventName] = nextGroups;
    }
  }

  return { merged: base, changed, events: [...new Set(events)] };
}

/**
 * Probe installed hook status for one host.
 * @param {{
 *   host: string,
 *   configPath: string,
 *   binDir: string,
 *   exists?: typeof existsSync,
 *   readFile?: typeof readFileSync,
 * }} input
 */
export function probeHostHooks(input) {
  const exists = input.exists ?? existsSync;
  const readFile = input.readFile ?? readFileSync;
  const host = normalizeHostId(input.host);
  const expected = captureHookCommand(input.binDir, host);

  if (!exists(input.configPath)) {
    return {
      host,
      status: "not_installed",
      config_path: input.configPath,
      detail: "config file missing",
    };
  }

  // GJC TypeScript plugin path
  if (host === "gjc" || input.configPath.endsWith(".ts")) {
    let text = "";
    try {
      text = readFile(input.configPath, "utf8");
    } catch (error) {
      return {
        host,
        status: "failed",
        config_path: input.configPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const hasCapture = text.includes("capture-hook") && text.includes("gjc");
    const hasAbs = text.includes(carpeosBinPath(input.binDir));
    if (!hasCapture) {
      return {
        host,
        status: "not_installed",
        config_path: input.configPath,
        detail: "file present but no CarpeOS capture hook",
      };
    }
    return {
      host,
      status: hasAbs ? "ok" : "stale_path",
      config_path: input.configPath,
      entries: 1,
      command: expected,
      kind: "gjc_ts",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFile(input.configPath, "utf8"));
  } catch (error) {
    return {
      host: input.host,
      status: "error",
      config_path: input.configPath,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const hooksRoot = parsed?.hooks;
  if (!hooksRoot || typeof hooksRoot !== "object") {
    return {
      host: input.host,
      status: "not_installed",
      config_path: input.configPath,
      detail: "no hooks object",
    };
  }

  let carpeosCount = 0;
  let absoluteCount = 0;
  let bareCount = 0;
  for (const eventName of Object.keys(hooksRoot)) {
    const groups = hooksRoot[eventName];
    if (!Array.isArray(groups)) {
      continue;
    }
    for (const group of groups) {
      const entries = Array.isArray(group?.hooks) ? group.hooks : [];
      for (const entry of entries) {
        if (!entry || !isCarpeosCaptureCommand(entry.command, input.host)) {
          continue;
        }
        carpeosCount += 1;
        const cmd = String(entry.command);
        if (cmd.includes(expected) || cmd.includes(resolve(input.binDir, "carpeos"))) {
          absoluteCount += 1;
        } else if (/\bcarpeos\b/.test(cmd) && !cmd.includes("/")) {
          bareCount += 1;
        }
      }
    }
  }

  if (carpeosCount === 0) {
    return {
      host: input.host,
      status: "not_installed",
      config_path: input.configPath,
      detail: "no CarpeOS capture-hook entries",
    };
  }

  if (absoluteCount > 0 && bareCount === 0) {
    return {
      host: input.host,
      status: "installed",
      config_path: input.configPath,
      entries: carpeosCount,
      command: expected,
    };
  }

  if (bareCount > 0 && absoluteCount === 0) {
    return {
      host: input.host,
      status: "stale_path",
      config_path: input.configPath,
      entries: carpeosCount,
      detail: "CarpeOS hooks use PATH-based carpeos; re-run hooks install for absolute wrapper",
      expected_command: expected,
    };
  }

  return {
    host: input.host,
    status: "partial",
    config_path: input.configPath,
    entries: carpeosCount,
    absolute: absoluteCount,
    bare: bareCount,
    expected_command: expected,
  };
}

/**
 * Install hooks for one or more hosts (merge into existing configs).
 * @param {{
 *   hosts: string[],
 *   binDir: string,
 *   templateDir: string,
 *   userHome?: string,
 *   env?: NodeJS.ProcessEnv,
 *   dryRun?: boolean,
 *   pathForHost?: (host: string) => string,
 *   exists?: typeof existsSync,
 *   readFile?: typeof readFileSync,
 *   writeFile?: typeof writeFileSync,
 *   mkdir?: typeof mkdirSync,
 *   chmod?: typeof chmodSync,
 *   copyFile?: typeof copyFileSync,
 *   rename?: typeof renameSync,
 *   log?: (msg: string) => void,
 * }} options
 */
export function installCaptureHooks(options) {
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? readFileSync;
  const writeFile = options.writeFile ?? writeFileSync;
  const mkdir = options.mkdir ?? mkdirSync;
  const chmod = options.chmod ?? chmodSync;
  const copyFile = options.copyFile ?? copyFileSync;
  const log = options.log ?? ((msg) => process.stdout.write(`${msg}\n`));
  const env = options.env ?? process.env;

  /** @type {object[]} */
  const results = [];

  for (const rawHost of options.hosts) {
    const host = normalizeHostId(rawHost);
    if (!HOOK_HOSTS.includes(host)) {
      results.push({
        host,
        status: "skipped",
        reason:
          host === "deepcode" || host === "reasonix"
            ? "mcp-only host (no lifecycle hooks merge; use setup run --register-mcp)"
            : "unsupported host",
      });
      continue;
    }
    const configPath = options.pathForHost?.(host) ?? defaultHookConfigPath(host, env);
    const template = loadHookTemplate(host, options.templateDir);
    const materialized = materializeHookTemplate(template, host, options.binDir);
    const command = captureHookCommand(options.binDir, host);

    // GJC: TypeScript hook plugin file (not JSON merge).
    if (materialized && materialized.kind === "gjc_ts") {
      const body = `${materialized.source}\n`;
      let existing = "";
      if (exists(configPath)) {
        try {
          existing = readFile(configPath, "utf8");
        } catch (error) {
          results.push({
            host,
            status: "failed",
            config_path: configPath,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
      const changed = existing !== body;
      if (options.dryRun) {
        results.push({
          host,
          status: "dry_run",
          config_path: configPath,
          would_change: changed,
          events: ["session_start", "turn_end", "tool_result", "session_shutdown"],
          command,
          kind: "gjc_ts",
        });
        continue;
      }
      if (!changed) {
        results.push({
          host,
          status: "unchanged",
          config_path: configPath,
          command,
          kind: "gjc_ts",
        });
        continue;
      }
      mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
      if (exists(configPath)) {
        try {
          copyFile(configPath, `${configPath}.carpeos-bak`);
        } catch {
          // best-effort
        }
      }
      writeFile(configPath, body, { encoding: "utf8", mode: 0o600 });
      try {
        chmod(configPath, 0o600);
      } catch {
        // ignore
      }
      log(`Installed GJC capture hook → ${configPath}`);
      results.push({
        host,
        status: "installed",
        config_path: configPath,
        events: ["session_start", "turn_end", "tool_result", "session_shutdown"],
        command,
        kind: "gjc_ts",
      });
      continue;
    }

    let existing = {};
    if (exists(configPath)) {
      try {
        existing = JSON.parse(readFile(configPath, "utf8"));
      } catch (error) {
        results.push({
          host,
          status: "failed",
          config_path: configPath,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    const { merged, changed, events } = mergeHostHooks(existing, materialized, host);

    if (options.dryRun) {
      results.push({
        host,
        status: "dry_run",
        config_path: configPath,
        would_change: changed,
        events,
        command,
      });
      continue;
    }

    if (!changed && exists(configPath)) {
      results.push({
        host,
        status: "unchanged",
        config_path: configPath,
        events,
        command,
      });
      continue;
    }

    mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    if (exists(configPath)) {
      const backupPath = `${configPath}.carpeos-bak`;
      try {
        copyFile(configPath, backupPath);
      } catch {
        // best-effort backup
      }
    }
    const tmpPath = `${configPath}.carpeos-tmp`;
    const body = `${JSON.stringify(merged, null, 2)}\n`;
    writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
    try {
      chmod(tmpPath, 0o600);
    } catch {
      // ignore
    }
    // Atomic replace where possible
    try {
      renameSync(tmpPath, configPath);
    } catch {
      writeFile(configPath, body, { encoding: "utf8", mode: 0o600 });
      try {
        chmod(configPath, 0o600);
      } catch {
        // ignore
      }
    }
    log(`Installed capture hooks for ${host} → ${configPath}`);
    results.push({
      host,
      status: "installed",
      config_path: configPath,
      events,
      command,
      backup: exists(`${configPath}.carpeos-bak`) ? `${configPath}.carpeos-bak` : undefined,
    });
  }

  return { results };
}

/**
 * Uninstall CarpeOS capture hooks only.
 * @param {Parameters<typeof installCaptureHooks>[0]} options
 */
export function uninstallCaptureHooks(options) {
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? readFileSync;
  const writeFile = options.writeFile ?? writeFileSync;
  const chmod = options.chmod ?? chmodSync;
  const log = options.log ?? ((msg) => process.stdout.write(`${msg}\n`));
  const env = options.env ?? process.env;

  /** @type {object[]} */
  const results = [];

  for (const rawHost of options.hosts) {
    const host = normalizeHostId(rawHost);
    if (!HOOK_HOSTS.includes(host)) {
      results.push({ host, status: "skipped", reason: "unsupported host" });
      continue;
    }
    const configPath = options.pathForHost?.(host) ?? defaultHookConfigPath(host, env);

    if (!exists(configPath)) {
      results.push({
        host,
        status: "absent",
        config_path: configPath,
      });
      continue;
    }

    // GJC TypeScript hook: delete CarpeOS file when it is ours.
    if (host === "gjc") {
      let text = "";
      try {
        text = readFile(configPath, "utf8");
      } catch (error) {
        results.push({
          host,
          status: "failed",
          config_path: configPath,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const isOurs =
        text.includes("capture-hook") && text.includes("--provider") && text.includes("gjc");
      if (options.dryRun) {
        results.push({
          host,
          status: "dry_run",
          config_path: configPath,
          would_change: isOurs,
        });
        continue;
      }
      if (!isOurs) {
        results.push({ host, status: "unchanged", config_path: configPath });
        continue;
      }
      try {
        unlinkSync(configPath);
      } catch {
        writeFile(configPath, "// carpeos capture hook removed\n", { encoding: "utf8" });
      }
      log(`Removed GJC capture hook (${configPath})`);
      results.push({ host, status: "uninstalled", config_path: configPath });
      continue;
    }

    let existing;
    try {
      existing = JSON.parse(readFile(configPath, "utf8"));
    } catch (error) {
      results.push({
        host,
        status: "failed",
        config_path: configPath,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const { merged, changed, events } = uninstallHostHooks(existing, host);
    if (options.dryRun) {
      results.push({
        host,
        status: "dry_run",
        config_path: configPath,
        would_change: changed,
        events,
      });
      continue;
    }
    if (!changed) {
      results.push({
        host,
        status: "unchanged",
        config_path: configPath,
      });
      continue;
    }
    const body = `${JSON.stringify(merged, null, 2)}\n`;
    writeFile(configPath, body, { encoding: "utf8", mode: 0o600 });
    try {
      chmod(configPath, 0o600);
    } catch {
      // ignore
    }
    log(`Removed CarpeOS capture hooks from ${host} (${configPath})`);
    results.push({
      host,
      status: "uninstalled",
      config_path: configPath,
      events,
    });
  }

  return { results };
}

/**
 * Doctor-style probe for multiple hosts.
 * @param {{
 *   hosts?: string[],
 *   binDir: string,
 *   env?: NodeJS.ProcessEnv,
 *   pathForHost?: (host: string) => string,
 *   exists?: typeof existsSync,
 *   readFile?: typeof readFileSync,
 * }} input
 */
export function doctorCaptureHooks(input) {
  const hosts = input.hosts ?? HOOK_HOSTS;
  const env = input.env ?? process.env;
  const probes = hosts.map((host) =>
    probeHostHooks({
      host,
      configPath: input.pathForHost?.(host) ?? defaultHookConfigPath(host, env),
      binDir: input.binDir,
      exists: input.exists,
      readFile: input.readFile,
    }),
  );
  return {
    ok: true,
    probes,
    summary: probes.map((p) => `${p.host}:${p.status}`).join(", "),
  };
}

/**
 * Parse --register-hooks / --hosts style host list.
 * @param {string} spec
 * @returns {{ hosts: string[] | undefined, skip: boolean }}
 */
export function parseHookHostsSpec(spec) {
  const value = String(spec || "auto").trim();
  if (value === "none" || value === "off" || value === "false") {
    return { hosts: [], skip: true };
  }
  if (value === "auto") {
    return { hosts: undefined, skip: false };
  }
  const hosts = value
    .split(",")
    .map((h) => normalizeHostId(h.trim()))
    .filter(Boolean);
  for (const h of hosts) {
    if (!HOOK_HOSTS.includes(h) && !SETUP_HOSTS.includes(h)) {
      throw new Error(
        `invalid hook host "${h}" (allowed: auto, none, ${SETUP_HOSTS.join(", ")}, aliases: gajae,dsb)`,
      );
    }
  }
  // MCP-only hosts are accepted in the list but skipped at install time.
  return { hosts, skip: false };
}

/**
 * Detect whether a setup host binary (or home install) is present.
 * @param {string} host
 * @param {(cmd: string) => boolean} commandExistsFn
 * @param {NodeJS.ProcessEnv} [env]
 */
export function hostIsPresent(host, commandExistsFn, env = process.env) {
  const h = normalizeHostId(host);
  if (h === "deepseek-build") {
    if (commandExistsFn("deepseek-build") || commandExistsFn("dsb")) return true;
    const home = env.HOME?.trim() || homedir();
    return (
      existsSync(join(home, ".deepseek-build", "bin", "deepseek-build")) ||
      existsSync(join(home, ".deepseek-build", "bin", "dsb"))
    );
  }
  if (h === "gjc") {
    return commandExistsFn("gjc") || commandExistsFn("gajae");
  }
  if (h === "deepcode") {
    return commandExistsFn("deepcode");
  }
  if (h === "reasonix") {
    return commandExistsFn("reasonix");
  }
  return commandExistsFn(h);
}

/**
 * Resolve which hosts to touch for hooks install when spec is auto.
 * Prefer hosts that exist on PATH / known home bins; if none, install core JSON hosts.
 * @param {(cmd: string) => boolean} commandExistsFn
 * @param {string[] | undefined} hostList
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveHookHosts(commandExistsFn, hostList, env = process.env) {
  if (Array.isArray(hostList) && hostList.length > 0) {
    return hostList.map(normalizeHostId);
  }
  const detected = HOOK_HOSTS.filter((h) => hostIsPresent(h, commandExistsFn, env));
  return detected.length > 0 ? detected : ["claude", "codex", "grok"];
}

function stripHooksKey(group) {
  const { hooks: _hooks, ...rest } = group;
  return rest;
}

function configsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
