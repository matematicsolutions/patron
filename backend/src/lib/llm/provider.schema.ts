// Zod schemas dla multi-provider LLM abstraction (ADR-0014 T1).
//
// Schema jest **wtórna** wzgledem typow w `provider.ts` - typy sa zrodlem
// prawdy dla TypeScripta, schema jest dla runtime validation w punktach
// granicznych (HTTP endpoints, deserializacja audit log, deserializacja
// sesji JSONL z ADR-0015).
//
// Konwencja: kazdy typ T z `provider.ts` ma odpowiadajacy `TSchema`. `z.infer<
// typeof TSchema>` powinien byc strukturalnie zgodny z T (testowane w
// `provider.test.ts`).

import { z } from "zod";

import type {
    Capabilities,
    ChatChunk,
    ChatRequest,
    ChatResponse,
    CostEstimate,
    DataClassification,
    EgressFlag,
    Message,
    ProviderId,
    RequiredCapabilities,
    RouterDecision,
    ToolCall,
    ToolDefinition,
} from "./provider";

export const ProviderIdSchema = z.enum([
    "anthropic",
    "gemini",
    "ollama",
    "openai",
]) satisfies z.ZodType<ProviderId>;

export const EgressFlagSchema = z.enum([
    "no-egress",
    "eu-only",
    "us-with-dpa",
]) satisfies z.ZodType<EgressFlag>;

export const DataClassificationSchema = z.enum([
    "public",
    "internal",
    "client_general",
    "attorney_client_privileged",
]) satisfies z.ZodType<DataClassification>;

export const CapabilitiesSchema = z.object({
    egress: EgressFlagSchema,
    toolCalling: z.boolean(),
    vision: z.boolean(),
    contextWindow: z.number().int().positive(),
    structuredOutput: z.boolean(),
    streaming: z.boolean(),
    reasoning: z.boolean(),
}) satisfies z.ZodType<Capabilities>;

export const MessageSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    toolCallId: z.string().optional(),
}) satisfies z.ZodType<Message>;

export const ToolDefinitionSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<ToolDefinition>;

export const ToolCallSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<ToolCall>;

export const RequiredCapabilitiesSchema = z.object({
    toolCalling: z.boolean().optional(),
    vision: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    streaming: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    minContextWindow: z.number().int().positive().optional(),
}) satisfies z.ZodType<RequiredCapabilities>;

/**
 * Walidacja krzyzowa: `attorney_client_privileged` wymaga `caseId` i
 * `pseudonimSessionId` (sygnalizujemy ze warstwa pseudonim juz przeszla).
 * Klasyfikacje powyzej `public` wymagaja `pseudonimSessionId`.
 */
export const ChatRequestSchema = z
    .object({
        model: z.string().min(1),
        systemPrompt: z.string().optional(),
        messages: z.array(MessageSchema).min(1),
        tools: z.array(ToolDefinitionSchema).optional(),
        dataClassification: DataClassificationSchema.optional(),
        requiredCapabilities: RequiredCapabilitiesSchema.optional(),
        maxTokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        enableThinking: z.boolean().optional(),
        caseId: z.string().optional(),
        pseudonimSessionId: z.string().optional(),
    })
    .superRefine((req, ctx) => {
        const classification = req.dataClassification ?? "internal";
        if (classification === "attorney_client_privileged") {
            if (!req.caseId) {
                ctx.addIssue({
                    code: "custom",
                    path: ["caseId"],
                    message:
                        "attorney_client_privileged wymaga caseId (Konstytucja Art. 5)",
                });
            }
            if (!req.pseudonimSessionId) {
                ctx.addIssue({
                    code: "custom",
                    path: ["pseudonimSessionId"],
                    message:
                        "attorney_client_privileged wymaga pseudonimSessionId (ADR-0003)",
                });
            }
        } else if (
            classification === "client_general" &&
            !req.pseudonimSessionId
        ) {
            ctx.addIssue({
                code: "custom",
                path: ["pseudonimSessionId"],
                message:
                    "client_general wymaga pseudonimSessionId (ADR-0003 pre-LLM pseudonimizacja)",
            });
        }
    }) satisfies z.ZodType<ChatRequest>;

export const ChatResponseSchema = z.object({
    providerId: ProviderIdSchema,
    model: z.string().min(1),
    content: z.string(),
    toolCalls: z.array(ToolCallSchema),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    latencyMs: z.number().nonnegative(),
    costPln: z.number().nonnegative(),
    auditEventId: z.string().optional(),
    reasoning: z.string().optional(),
}) satisfies z.ZodType<ChatResponse>;

export const ChatChunkSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("content"), delta: z.string() }),
    z.object({ type: z.literal("reasoning"), delta: z.string() }),
    z.object({ type: z.literal("reasoning_end") }),
    z.object({ type: z.literal("tool_call_start"), call: ToolCallSchema }),
    z.object({ type: z.literal("done"), response: ChatResponseSchema }),
]) satisfies z.ZodType<ChatChunk>;

export const CostEstimateSchema = z.object({
    providerId: ProviderIdSchema,
    model: z.string().min(1),
    tokensInEstimate: z.number().int().nonnegative(),
    tokensOutEstimate: z.number().int().nonnegative(),
    costPlnEstimate: z.number().nonnegative(),
    outputMultiplier: z.number().positive(),
}) satisfies z.ZodType<CostEstimate>;

const RejectedProviderSchema = z.object({
    providerId: ProviderIdSchema,
    reason: z.enum([
        "egress_classification_mismatch",
        "missing_capability",
        "circuit_breaker_open",
        "rate_limit_exceeded",
        "cost_limit_exceeded",
    ]),
});

export const RouterDecisionSchema = z.object({
    primary: ProviderIdSchema,
    fallbackChain: z.array(ProviderIdSchema),
    rejectedProviders: z.array(RejectedProviderSchema),
    decisionMs: z.number().nonnegative(),
}) satisfies z.ZodType<RouterDecision>;

/**
 * Pomocnicze parsery - dla call-sites w punktach granicznych. Rzuca
 * `z.ZodError` przy niezgodnosci.
 */
export const parseChatRequest = (input: unknown): ChatRequest =>
    ChatRequestSchema.parse(input);

export const parseChatResponse = (input: unknown): ChatResponse =>
    ChatResponseSchema.parse(input);

export const parseRouterDecision = (input: unknown): RouterDecision =>
    RouterDecisionSchema.parse(input);
