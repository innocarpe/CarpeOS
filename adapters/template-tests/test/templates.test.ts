import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const adaptersRoot = resolve(import.meta.dirname, "..", "..");
const allowedEvents = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "PreCompact",
  "Stop",
  "SessionEnd",
]);

describe("provider hook templates", () => {
  it.each([
    ["codex", "codex/hooks.json.example"],
    ["claude", "claude/settings.json.example"],
    ["grok", "grok/hooks.json.example"],
    ["deepseek-build", "deepseek-build/hooks.json.example"],
  ] as const)("keeps the %s template parseable and provider-specific", (provider, relativePath) => {
    const template = readJson(relativePath);
    const hooks = template.hooks as Record<string, HookGroup[]>;
    const providerId = provider === "deepseek-build" ? "deepseek_build" : provider;
    expect(Object.keys(hooks).length).toBeGreaterThan(0);
    for (const [eventName, groups] of Object.entries(hooks)) {
      expect(allowedEvents.has(eventName)).toBe(true);
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook.type).toBe("command");
          expect(hook.command).toBe(
            `carpeos capture-hook --provider ${providerId} --fail-open --quiet`,
          );
          expect(hook.command).not.toMatch(/\/Users\/|\/home\//i);
          expect(hook.timeout).toBeGreaterThan(0);
          expect(hook.timeout).toBeLessThanOrEqual(10);
          if (provider === "claude") {
            expect(hook.async).toBe(true);
          } else {
            expect(hook).not.toHaveProperty("async");
          }
        }
      }
    }
  });

  it("keeps Codex notify separate from lifecycle hooks", () => {
    const notify = readFileSync(resolve(adaptersRoot, "codex/notify.toml.example"), "utf8");
    expect(notify).toContain('"--input", "argv"');
    expect(notify).toContain('"--fail-open"');
    expect(notify).toContain('"--quiet"');
    expect(notify).not.toContain("[hooks");
  });

  it("documents current official provider references and public boundaries", () => {
    const readme = readFileSync(resolve(adaptersRoot, "README.md"), "utf8");
    expect(readme).toContain("https://learn.chatgpt.com/docs/hooks");
    expect(readme).toContain("https://code.claude.com/docs/en/hooks");
    expect(readme).toContain("https://docs.x.ai/build/features/hooks");
    expect(readme).toContain("DeepSeek Build");
    expect(readme).toContain("Gajae Code");
    expect(readme).toContain("Deep Code");
    expect(readme).toContain("Reasonix");
    expect(readme).toContain("Remote sync");
    expect(readme).not.toMatch(/\/Users\/|\/home\//);
  });

  it("ships a GJC TypeScript capture hook example without local absolute paths", () => {
    const text = readFileSync(resolve(adaptersRoot, "gjc/carpeos-capture.ts.example"), "utf8");
    expect(text).toContain("__CARPEOS_BIN__");
    expect(text).toContain('--provider", "gjc"');
    expect(text).toContain("session_start");
    expect(text).toContain("session_shutdown");
    expect(text).not.toMatch(/\/Users\/|\/home\//);
  });
});

type HookGroup = {
  hooks: Array<{
    type: string;
    command: string;
    timeout: number;
    async?: boolean;
  }>;
};

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(adaptersRoot, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}
