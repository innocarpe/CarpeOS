#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const protectedPathPatterns = [
  /(^|\/)\.omx(\/|$)/,
  /(^|\/)\.carpeos(\/|$)/,
  /(^|\/)\.wrangler(\/|$)/,
  /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/i,
  /\.(?:jsonl|transcript|pem|key|p12|pfx)$/i,
  /(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars)$/i,
];

const protectedContentPatterns = [
  {
    label: "absolute macOS home path",
    pattern: /\/Users\/[A-Za-z0-9._-]+(?:\/|$)/,
  },
  {
    // Require a non-identifier boundary so prose like "install/home/wrappers"
    // is not treated as an absolute home directory leak (CI false positive).
    label: "absolute Linux home path",
    pattern: /(?:^|[^A-Za-z0-9_])\/home\/[A-Za-z0-9._-]+(?:\/|$)/,
  },
  {
    label: "private key block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    label: "Cloudflare API token",
    pattern: /(?:CLOUDFLARE|CF)_[A-Z0-9_]*(?:TOKEN|KEY)\s*=\s*\S+/i,
  },
  {
    label: "generic secret assignment",
    pattern: /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*["']?[^"'\s]+/i,
  },
];

const cloudflareIdentifierAssignment =
  /^\s*(database_id|account_id|database_name|bucket_name)\s*=\s*(?:"((?:\\.|[^"])*)"|'([^']*)')\s*(?:#.*)?$/i;

const approvedCloudflareIdentifierValues = new Set([
  "00000000-0000-0000-0000-000000000000",
  "00000000-0000-0000-0000-000000000001",
  "carpeos-protected-values",
  "carpeos_sync",
  "d1-database-id-from-cloudflare",
]);

function isClearlySyntheticPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    approvedCloudflareIdentifierValues.has(normalized) ||
    normalized.includes("${") ||
    /(?:^|[-_])(?:example|unit[-_]?test|not[-_]?deployed|test)(?:[-_]|$)/.test(normalized)
  );
}

function cloudflareIdentifierViolation(content) {
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(cloudflareIdentifierAssignment);
    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3];
    if (!isClearlySyntheticPlaceholder(value)) {
      return `contains non-placeholder Cloudflare ${key} assignment`;
    }
  }

  return undefined;
}

const binaryExtensions = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
]);

function gitListFiles(args) {
  const output = execFileSync("git", ["ls-files", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\n").filter(Boolean);
}

function unique(values) {
  return [...new Set(values)].sort();
}

function extensionOf(filePath) {
  const index = filePath.lastIndexOf(".");
  return index === -1 ? "" : filePath.slice(index).toLowerCase();
}

const files = unique([
  ...gitListFiles(["--cached"]),
  ...gitListFiles(["--others", "--exclude-standard"]),
]);

const violations = [];

for (const filePath of files) {
  for (const pattern of protectedPathPatterns) {
    if (pattern.test(filePath)) {
      violations.push(`${filePath}: protected runtime, secret, or transcript path`);
    }
  }

  if (binaryExtensions.has(extensionOf(filePath))) {
    continue;
  }

  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  for (const { label, pattern } of protectedContentPatterns) {
    if (pattern.test(content)) {
      violations.push(`${filePath}: contains ${label}`);
    }
  }

  const cloudflareViolation = cloudflareIdentifierViolation(content);
  if (cloudflareViolation) {
    violations.push(`${filePath}: ${cloudflareViolation}`);
  }
}

if (violations.length > 0) {
  console.error("Public boundary check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Public boundary check passed for ${files.length} public file(s).`);
