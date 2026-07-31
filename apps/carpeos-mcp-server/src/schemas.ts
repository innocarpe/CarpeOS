import { schemas, validateConformance } from "@carpeos/schema";

type StandardIssue = {
  readonly message: string;
  readonly path?: readonly PropertyKey[];
};

export type StandardJsonSchema = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: "carpeos";
    readonly validate: (
      value: unknown,
    ) => { value: unknown } | { issues: readonly StandardIssue[] };
    readonly jsonSchema: {
      readonly input: () => Record<string, unknown>;
      readonly output: () => Record<string, unknown>;
    };
  };
};

type McpApiSchema = {
  $defs: Record<string, Record<string, unknown>>;
};

const mcpSchema = schemas.mcpApi as McpApiSchema;

const inputDefByTool = {
  memory_search: "memorySearchInput",
  memory_get: "memoryGetInput",
  memory_context_pack: "memoryContextPackInput",
  memory_trace: "memoryTraceInput",
  memory_timeline: "memoryTimelineInput",
  memory_related: "memoryRelatedInput",
  memory_neighborhood: "memoryNeighborhoodInput",
  memory_capture: "memoryCaptureInput",
  memory_propose_claim: "memoryProposeClaimInput",
} as const;

export function mcpInputSchema(toolName: keyof typeof inputDefByTool): StandardJsonSchema {
  const jsonSchema = mcpSchema.$defs[inputDefByTool[toolName]];
  if (jsonSchema === undefined) {
    throw new Error(`missing MCP schema for ${toolName}`);
  }

  return {
    "~standard": {
      version: 1,
      vendor: "carpeos",
      validate: (value) => {
        const withTool =
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? { ...value, tool: toolName }
            : value;
        const result = validateConformance("mcpApi", withTool);
        if (result.valid) {
          return { value: withTool };
        }
        return { issues: result.errors.map((message) => ({ message })) };
      },
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  };
}
