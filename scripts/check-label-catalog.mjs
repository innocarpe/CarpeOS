#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = join(repoRoot, ".github", "labels.json");

const expectedVersion = 1;
const allowedTopLevelKeys = new Set(["labels", "policy", "sizeBands", "version"]);
const allowedGroups = new Set([
  "area",
  "community",
  "milestone",
  "resolution",
  "size",
  "status",
  "type",
]);

const expectedCardinality = {
  type: "exactly-one",
  area: "one-or-more",
  size: "exactly-one",
  status: "exactly-one",
  milestone: "exactly-one",
};
const failures = [];

function fail(message) {
  failures.push(message);
}

function readCatalog() {
  try {
    return JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (error) {
    fail(`Unable to parse ${catalogPath}: ${error.message}`);
    return null;
  }
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateTopLevelKeys(catalog) {
  const unsupportedKeys = Object.keys(catalog).filter((key) => !allowedTopLevelKeys.has(key));
  if (unsupportedKeys.length > 0) {
    fail(`catalog has unsupported top-level key(s): ${unsupportedKeys.join(", ")}.`);
  }
}

function validateSizeBands(sizeBands, sizeLabelNames) {
  if (!Array.isArray(sizeBands)) {
    fail("sizeBands must be an array.");
    return;
  }

  if (sizeBands.length === 0) {
    fail("sizeBands must contain at least one band.");
  }

  const bandNames = [];
  const seenBandNames = new Set();
  let expectedMin = 0;
  for (const [index, band] of sizeBands.entries()) {
    if (typeof band !== "object" || band === null || Array.isArray(band)) {
      fail(`sizeBands[${index}] must be an object.`);
      continue;
    }

    if (typeof band.name !== "string" || band.name.trim() === "") {
      fail(`sizeBands[${index}].name must be a nonempty string.`);
    } else {
      bandNames.push(band.name);
      if (seenBandNames.has(band.name)) {
        fail(`sizeBands contains duplicate name ${band.name}.`);
      }
      seenBandNames.add(band.name);
    }

    if (!Number.isInteger(band.min) || band.min < 0) {
      fail(`sizeBands[${index}].min must be a non-negative integer.`);
      continue;
    }

    if (band.min !== expectedMin) {
      fail(`sizeBands[${index}] must start at ${expectedMin}.`);
    }

    if (band.max !== null && (!Number.isInteger(band.max) || band.max < band.min)) {
      fail(`sizeBands[${index}].max must be null or an integer >= min.`);
      continue;
    }

    if (band.max === null) {
      if (index !== sizeBands.length - 1) {
        fail(`sizeBands[${index}] uses open-ended max before the final band.`);
      }
      expectedMin = Number.POSITIVE_INFINITY;
    } else {
      expectedMin = band.max + 1;
    }
  }

  const finalBand = sizeBands.at(-1);
  if (finalBand?.max !== null) {
    fail("sizeBands must end with an open-ended band.");
  }

  if (!sameArray(sorted(bandNames), sorted(sizeLabelNames))) {
    fail("sizeBands names must exactly match labels in the size group.");
  }
}

function validatePolicy(policy, labelsByGroup) {
  const cardinality = policy?.pullRequest?.cardinality;
  if (typeof cardinality !== "object" || cardinality === null || Array.isArray(cardinality)) {
    fail("policy.pullRequest.cardinality must be an object.");
    return;
  }

  for (const [group, rule] of Object.entries(expectedCardinality)) {
    if (cardinality[group] !== rule) {
      fail(`policy.pullRequest.cardinality.${group} must be ${rule}.`);
    }
    if ((labelsByGroup.get(group)?.length ?? 0) === 0) {
      fail(`policy.pullRequest.cardinality.${group} must be backed by catalog labels.`);
    }
  }

  const actualGroups = Object.keys(cardinality);
  const expectedGroups = Object.keys(expectedCardinality);
  const extraGroups = actualGroups.filter((group) => !expectedGroups.includes(group));
  if (extraGroups.length > 0) {
    fail(`policy.pullRequest.cardinality has unsupported group(s): ${extraGroups.join(", ")}.`);
  }
}

function validateLabel(label, index) {
  if (typeof label !== "object" || label === null || Array.isArray(label)) {
    fail(`labels[${index}] must be an object.`);
    return null;
  }

  const { name, color, description, group } = label;
  if (typeof name !== "string" || name.trim() === "") {
    fail(`labels[${index}].name must be a nonempty string.`);
  }

  if (typeof color !== "string" || !/^[0-9a-f]{6}$/.test(color)) {
    fail(`${name || `labels[${index}]`} color must be lowercase 6-digit hex.`);
  }

  if (typeof description !== "string" || description.trim() === "") {
    fail(`${name || `labels[${index}]`} description must be nonempty.`);
  }

  if (typeof group !== "string" || !allowedGroups.has(group)) {
    fail(`${name || `labels[${index}]`} group must be one of ${sorted(allowedGroups).join(", ")}.`);
  }

  if (typeof name === "string" && name.includes(":")) {
    const namespace = name.slice(0, name.indexOf(":"));
    if (namespace !== group) {
      fail(`${name} namespace must match group ${group}.`);
    }
  } else if (group !== "community" && group !== "resolution") {
    fail(
      `${name || `labels[${index}]`} without a namespace must use community or resolution group.`,
    );
  }

  return typeof name === "string" ? name : null;
}

function validateLabels(labels) {
  if (!Array.isArray(labels)) {
    fail("labels must be an array.");
    return new Map();
  }

  const labelsByGroup = new Map([...allowedGroups].map((group) => [group, []]));
  const names = [];
  const seen = new Set();
  const duplicates = new Set();

  for (const [index, label] of labels.entries()) {
    const name = validateLabel(label, index);
    if (name === null) {
      continue;
    }

    names.push(name);
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);

    if (allowedGroups.has(label.group)) {
      labelsByGroup.get(label.group).push(name);
    }
  }

  if (duplicates.size > 0) {
    fail(`labels contain duplicate name(s): ${sorted(duplicates).join(", ")}.`);
  }

  for (const group of allowedGroups) {
    if (labelsByGroup.get(group).length === 0) {
      fail(`labels must include at least one ${group} label.`);
    }
  }

  return labelsByGroup;
}

const catalog = readCatalog();

if (catalog !== null) {
  validateTopLevelKeys(catalog);

  if (catalog.version !== expectedVersion) {
    fail(`version must be ${expectedVersion}.`);
  }

  const labelsByGroup = validateLabels(catalog.labels);
  validatePolicy(catalog.policy, labelsByGroup);
  validateSizeBands(catalog.sizeBands, labelsByGroup.get("size") ?? []);
}

if (failures.length > 0) {
  console.error("Label catalog check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Label catalog check passed for ${catalog.labels.length} label(s).`);
