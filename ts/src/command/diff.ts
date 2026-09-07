import { CassetteReader } from "../core/cassette.js";
import { matchStructural } from "../core/match.js";
import { pairInteractions } from "../core/replayEngine.js";
import { CassetteFrame, DiffChange, DiffReport, Interaction, JsonRpcMessage } from "../core/types.js";

interface ToolSchema {
    required?: string[];
    [key: string]: unknown;
}

function extractTools(frames: CassetteFrame[]): Record<string, ToolSchema> {
    const tools: Record<string, ToolSchema> = {};
    for (const frame of frames) {
        if (frame.dir === "s2c" && frame.msg.result && Array.isArray((frame.msg.result as any).tools)) {
            for (const tool of (frame.msg.result as any).tools) {
                tools[tool.name] = tool.inputSchema ?? {};
            }
        }
    }
    return tools;
}

function diffToolSchemas(v1Tools: Record<string, ToolSchema>, v2Tools: Record<string, ToolSchema>): DiffChange[] {
    const changes: DiffChange[] = [];

    for (const [toolName, v1Schema] of Object.entries(v1Tools)) {
        const v2Schema = v2Tools[toolName];
        if (!v2Schema) {
            changes.push({ severity: "breaking", category: "tool-removed", tool: toolName, message: `tools/list: tool
  removed: ${toolName}` });
            continue;
        }

        const v1Required = v1Schema.required ?? [];
        for (const param of v2Schema.required ?? []) {
            if (!v1Required.includes(param)) {
                changes.push({
                    severity: "breaking",
                    category: "param-now-required",
                    tool: toolName,
                    field: param,
                    message: `tools/list: parameter "${param}" is now required on ${toolName}`,
                });
            }
        }
    }

    for (const toolName of Object.keys(v2Tools)) {
        if (!v1Tools[toolName]) {
            changes.push({ severity: "minor", category: "tool-added", tool: toolName, message: `tools/list: tool
  added: ${toolName}` });
        }
    }

    return changes;
}

/** Finds the v2 interaction whose request is structurally identical (ignoring id) to a given
 *  v1 interaction -- "the same call, replayed against the new server version." */
function findCounterpart(interaction: Interaction, candidates: Interaction[]): Interaction | undefined {
    return candidates.find((candidate) => matchStructural(interaction.request.msg, candidate.request.msg));
}

function describeRequest(msg: JsonRpcMessage): string {
    const toolName = (msg.params as { name?: string } | undefined)?.name;
    return toolName ? `${msg.method}("${toolName}")` : msg.method ?? "unknown request";
}

/** For requests common to both cassettes (same tool, same args, re-recorded against a newer
 *  server), flags a result<->error flip in either direction as breaking, and any top-level
 *  result field present in v1 but missing in v2 as a removed field. */
function diffInteractionOutcomes(v1Interactions: Interaction[], v2Interactions: Interaction[]): DiffChange[] {
    const changes: DiffChange[] = [];
    const consumed = new Set<Interaction>();

    for (const v1 of v1Interactions) {
        const v2 = findCounterpart(v1, v2Interactions.filter((candidate) => !consumed.has(candidate)));
        if (!v2) continue;
        consumed.add(v2);

        const label = describeRequest(v1.request.msg);
        const v1IsError = v1.response.msg.error !== undefined;
        const v2IsError = v2.response.msg.error !== undefined;

        if (v1IsError !== v2IsError) {
            changes.push({
                severity: "breaking",
                category: "result-error-flip",
                message: `${label}: ${v1IsError ? "error" : "result"} in v1 became ${v2IsError ? "error" : "result"}
  in v2`,
            });
            continue; // the flip already explains the whole outcome -- field-level diffing on top would be noise
        }

        if (v1IsError) continue;

        const v1Result = v1.response.msg.result;
        const v2Result = v2.response.msg.result;
        if (typeof v1Result !== "object" || v1Result === null) continue;
        if (typeof v2Result !== "object" || v2Result === null) continue;

        const v2Fields = new Set(Object.keys(v2Result as Record<string, unknown>));
        for (const field of Object.keys(v1Result as Record<string, unknown>)) {
            if (!v2Fields.has(field)) {
                changes.push({ severity: "breaking", category: "field-removed", field, message: `${label}: result
  field "${field}" was removed` });
            }
        }
    }

    return changes;
}

/**
 * Classifies the differences between two cassettes as BREAKING or MINOR: removed tools,
 * newly-required parameters (schema-level), plus, for requests common to both recordings,
 * result<->error flips and removed result fields (behavior-level). Pure: returns a report,
 * the CLI decides exit codes via `--fail-on-breaking`.
 */
export async function diffCassettes(v1Path: string, v2Path: string): Promise<DiffReport> {
    const v1 = await new CassetteReader(v1Path).loadAll();
    const v2 = await new CassetteReader(v2Path).loadAll();

    const changes = [
        ...diffToolSchemas(extractTools(v1.frames), extractTools(v2.frames)),
        ...diffInteractionOutcomes(pairInteractions(v1.frames), pairInteractions(v2.frames)),
    ];

    return {
        changes,
        breakingCount: changes.filter((c) => c.severity === "breaking").length,
        minorCount: changes.filter((c) => c.severity === "minor").length,
    };
}