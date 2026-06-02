/**
 * PATRON API client — all requests to the Node.js backend.
 * Attaches the Supabase auth token for user authentication.
 */

import { supabase } from "@/lib/supabase";
import { IS_LOCAL_MODE, LOCAL_TOKEN } from "@/lib/localMode";
import type {
    AssistantEvent,
    PATRONChat,
    PATRONChatDetailOut,
    PATRONCitationAnnotation,
    PATRONDocument,
    PATRONFolder,
    PATRONMessage,
    PATRONProject,
    PATRONWorkflow,
    TabularReview,
    TabularReviewDetailOut,
} from "@/app/components/shared/types";

// Server-side shape before mapping
interface ServerMessage {
    id: string;
    chat_id: string;
    role: "user" | "assistant";
    content: string | AssistantEvent[] | null;
    files?: { filename: string; document_id?: string }[] | null;
    workflow?: { id: string; title: string } | null;
    annotations?: PATRONCitationAnnotation[] | null;
    created_at: string;
}
interface ServerChatDetailOut {
    chat: PATRONChat;
    messages: ServerMessage[];
}

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

async function getAuthHeader(): Promise<Record<string, string>> {
    // Tryb local (single-user desktop): statyczny token, backend sqlite bypassuje.
    if (IS_LOCAL_MODE) return { Authorization: `Bearer ${LOCAL_TOKEN}` };
    const {
        data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const authHeaders = await getAuthHeader();
    const { headers: initHeaders, ...restInit } = init ?? {};
    const response = await fetch(`${API_BASE}${path}`, {
        cache: "no-store",
        ...restInit,
        headers: {
            Accept: "application/json",
            ...authHeaders,
            ...(initHeaders as Record<string, string> | undefined),
        },
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `API error: ${response.status}`);
    }

    if (
        response.status === 204 ||
        response.headers.get("content-length") === "0"
    ) {
        return undefined as T;
    }

    return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<PATRONProject[]> {
    return apiRequest<PATRONProject[]>("/projects");
}

export async function createProject(
    name: string,
    cm_number?: string,
    shared_with?: string[],
): Promise<PATRONProject> {
    return apiRequest<PATRONProject>("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cm_number, shared_with }),
    });
}

export async function deleteAccount(): Promise<void> {
    return apiRequest<void>("/user/account", { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Biblioteka umiejetnosci (ADR-0094)
// ---------------------------------------------------------------------------

export interface SkillEntry {
    id: string;
    name: string;
    description: string;
    version: string;
    surface: string;
    source: string;
    egress: "no-egress" | "cloud-allowed";
    publisher: string | null;
    signed: boolean;
    builtin: boolean;
    enabled: boolean;
}

export interface SkillsList {
    builtin: SkillEntry[];
    installed: SkillEntry[];
}

export async function listSkills(): Promise<SkillsList> {
    return apiRequest<SkillsList>("/skills");
}

export async function importSkill(manifest: unknown): Promise<SkillEntry> {
    return apiRequest<SkillEntry>("/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest }),
    });
}

export async function setSkillEnabled(
    id: string,
    enabled: boolean,
    confirmEgress?: boolean,
): Promise<SkillEntry> {
    return apiRequest<SkillEntry>(`/skills/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, confirm_egress: confirmEgress }),
    });
}

export async function removeSkill(id: string): Promise<void> {
    return apiRequest<void>(`/skills/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
}

export interface UserProfile {
    displayName: string | null;
    organisation: string | null;
    messageCreditsUsed: number;
    creditsResetDate: string;
    creditsRemaining: number;
    tier: string;
    tabularModel: string;
    apiKeyStatus: ApiKeyStatus;
}

export async function getUserProfile(): Promise<UserProfile> {
    return apiRequest<UserProfile>("/user/profile");
}

export async function updateUserProfile(payload: {
    displayName?: string | null;
    organisation?: string | null;
    tabularModel?: string;
}): Promise<UserProfile> {
    return apiRequest<UserProfile>("/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export type ApiKeyProvider = "claude" | "gemini" | "openai";
export type ApiKeySource = "user" | "env" | null;
export type ApiKeyState = Record<
    ApiKeyProvider,
    {
        configured: boolean;
        source: ApiKeySource;
    }
>;

export type ApiKeyStatus = Record<ApiKeyProvider, boolean> & {
    sources?: Partial<Record<ApiKeyProvider, ApiKeySource>>;
};

export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
    return apiRequest<ApiKeyStatus>("/user/api-keys");
}

export async function saveApiKey(
    provider: ApiKeyProvider,
    apiKey: string | null,
): Promise<ApiKeyStatus> {
    return apiRequest<ApiKeyStatus>(`/user/api-keys/${provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
    });
}

export async function getProject(projectId: string): Promise<PATRONProject> {
    return apiRequest<PATRONProject>(`/projects/${projectId}`);
}

export async function updateProject(
    projectId: string,
    payload: {
        name?: string;
        cm_number?: string;
        shared_with?: string[];
    },
): Promise<PATRONProject> {
    return apiRequest<PATRONProject>(`/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function deleteProject(projectId: string): Promise<void> {
    await apiRequest(`/projects/${projectId}`, { method: "DELETE" });
}

export interface ProjectPeople {
    owner: {
        user_id: string;
        email: string | null;
        display_name: string | null;
    };
    members: { email: string; display_name: string | null }[];
}

export async function getProjectPeople(
    projectId: string,
): Promise<ProjectPeople> {
    return apiRequest<ProjectPeople>(`/projects/${projectId}/people`);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function createProjectFolder(
    projectId: string,
    name: string,
    parentFolderId?: string | null,
): Promise<PATRONFolder> {
    return apiRequest<PATRONFolder>(`/projects/${projectId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name,
            parent_folder_id: parentFolderId ?? null,
        }),
    });
}

export async function renameProjectFolder(
    projectId: string,
    folderId: string,
    name: string,
): Promise<PATRONFolder> {
    return apiRequest<PATRONFolder>(
        `/projects/${projectId}/folders/${folderId}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        },
    );
}

export async function deleteProjectFolder(
    projectId: string,
    folderId: string,
): Promise<void> {
    await apiRequest(`/projects/${projectId}/folders/${folderId}`, {
        method: "DELETE",
    });
}

export async function moveSubfolderToFolder(
    projectId: string,
    folderId: string,
    parentFolderId: string | null,
): Promise<PATRONFolder> {
    return apiRequest<PATRONFolder>(
        `/projects/${projectId}/folders/${folderId}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parent_folder_id: parentFolderId }),
        },
    );
}

export async function moveDocumentToFolder(
    projectId: string,
    documentId: string,
    folderId: string | null,
): Promise<PATRONDocument> {
    return apiRequest<PATRONDocument>(
        `/projects/${projectId}/documents/${documentId}/folder`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_id: folderId }),
        },
    );
}

export async function renameProjectDocument(
    projectId: string,
    documentId: string,
    filename: string,
): Promise<PATRONDocument> {
    return apiRequest<PATRONDocument>(
        `/projects/${projectId}/documents/${documentId}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename }),
        },
    );
}

export async function addDocumentToProject(
    projectId: string,
    documentId: string,
): Promise<PATRONDocument> {
    return apiRequest<PATRONDocument>(
        `/projects/${projectId}/documents/${documentId}`,
        { method: "POST" },
    );
}

export interface PATRONDocumentVersion {
    id: string;
    version_number: number | null;
    source: string;
    created_at: string;
    display_name: string | null;
}

export async function listDocumentVersions(documentId: string): Promise<{
    current_version_id: string | null;
    versions: PATRONDocumentVersion[];
}> {
    return apiRequest(`/single-documents/${documentId}/versions`);
}

export async function uploadDocumentVersion(
    documentId: string,
    file: File,
    displayName?: string,
): Promise<PATRONDocumentVersion> {
    const authHeaders = await getAuthHeader();
    const form = new FormData();
    form.append("file", file);
    if (displayName) form.append("display_name", displayName);
    const response = await fetch(
        `${API_BASE}/single-documents/${documentId}/versions`,
        {
            method: "POST",
            headers: { ...authHeaders },
            body: form,
        },
    );
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<PATRONDocumentVersion>;
}

export async function renameDocumentVersion(
    documentId: string,
    versionId: string,
    displayName: string | null,
): Promise<PATRONDocumentVersion> {
    return apiRequest<PATRONDocumentVersion>(
        `/single-documents/${documentId}/versions/${versionId}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: displayName }),
        },
    );
}

export async function uploadProjectDocument(
    projectId: string,
    file: File,
): Promise<PATRONDocument> {
    const authHeaders = await getAuthHeader();
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(
        `${API_BASE}/projects/${projectId}/documents`,
        {
            method: "POST",
            headers: { ...authHeaders },
            body: form,
        },
    );
    if (!response.ok) throw new Error(await extractUploadError(response));
    return response.json() as Promise<PATRONDocument>;
}

// Wyciaga czytelny komunikat z odpowiedzi bledu uploadu. Dla skanu
// bezpieczenstwa (ADR-0020, 422 blocked) backend zwraca { detail, security }.
async function extractUploadError(response: Response): Promise<string> {
    const raw = await response.text();
    try {
        const body = JSON.parse(raw) as { detail?: string };
        if (body.detail) return body.detail;
    } catch {
        // nie-JSON - zwracamy surowy tekst
    }
    return raw || `HTTP ${response.status}`;
}

export async function uploadStandaloneDocument(
    file: File,
): Promise<PATRONDocument> {
    const authHeaders = await getAuthHeader();
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_BASE}/single-documents`, {
        method: "POST",
        headers: { ...authHeaders },
        body: form,
    });
    if (!response.ok) throw new Error(await extractUploadError(response));
    return response.json() as Promise<PATRONDocument>;
}

export async function listStandaloneDocuments(): Promise<PATRONDocument[]> {
    return apiRequest<PATRONDocument[]>("/single-documents");
}

export async function deleteDocument(documentId: string): Promise<void> {
    await apiRequest(`/single-documents/${documentId}`, { method: "DELETE" });
}

export async function getDocumentUrl(
    documentId: string,
    versionId?: string | null,
): Promise<{ url: string; filename: string; version_id: string | null }> {
    const qs = versionId ? `?version_id=${encodeURIComponent(versionId)}` : "";
    return apiRequest(`/single-documents/${documentId}/url${qs}`);
}

export async function downloadDocumentsZip(
    documentIds: string[],
): Promise<Blob> {
    const authHeaders = await getAuthHeader();
    const response = await fetch(`${API_BASE}/single-documents/download-zip`, {
        method: "POST",
        cache: "no-store",
        headers: {
            "Content-Type": "application/json",
            ...authHeaders,
        },
        body: JSON.stringify({ document_ids: documentIds }),
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `API error: ${response.status}`);
    }
    return response.blob();
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function createChat(payload?: {
    project_id?: string;
}): Promise<{ id: string }> {
    return apiRequest<{ id: string }>("/chat/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
    });
}

export async function listChats(options?: { limit?: number }): Promise<PATRONChat[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return apiRequest<PATRONChat[]>(`/chat${query ? `?${query}` : ""}`);
}

export async function listProjectChats(projectId: string): Promise<PATRONChat[]> {
    return apiRequest<PATRONChat[]>(`/projects/${projectId}/chats`);
}

export async function getChat(chatId: string): Promise<PATRONChatDetailOut> {
    const raw = await apiRequest<ServerChatDetailOut>(`/chat/${chatId}`);
    const messages: PATRONMessage[] = raw.messages.map((m) => {
        if (m.role === "user") {
            return {
                role: "user",
                content: typeof m.content === "string" ? m.content : "",
                files: m.files ?? undefined,
                workflow: m.workflow ?? undefined,
            };
        }
        const events = Array.isArray(m.content)
            ? (m.content as AssistantEvent[])
            : undefined;
        // Rozdziel mieszane annotations: dokumentowe (type: "citation_data")
        // vs MCP (type: "mcp_citation"). Edit annotations (type: "edit_data")
        // wedruja do events, nie pokazujemy ich tutaj.
        const rawAnns = ((m.annotations ?? []) as unknown) as Array<
            Record<string, unknown> & { type?: string }
        >;
        const docCitations = rawAnns.filter(
            (a) => !a.type || a.type === "citation_data",
        );
        const mcpCitations = rawAnns
            .filter((a) => a.type === "mcp_citation")
            .map((a) => {
                // Strip discriminator pole `type` przed castem do PATRONMcpCitation.
                const { type: _t, ...rest } = a;
                return rest as unknown as import("@/app/components/shared/types").PATRONMcpCitation;
            });
        return {
            role: "assistant",
            content:
                events
                    ?.filter((e) => e.type === "content")
                    .map((e) => (e as { type: "content"; text: string }).text)
                    .join("") ?? "",
            annotations: docCitations.length
                ? (docCitations as unknown as PATRONCitationAnnotation[])
                : undefined,
            mcpCitations: mcpCitations.length ? mcpCitations : undefined,
            events,
        };
    });
    return { chat: raw.chat, messages };
}

export async function renameChat(chatId: string, title: string): Promise<void> {
    await apiRequest(`/chat/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
    });
}

export async function deleteChat(chatId: string): Promise<void> {
    await apiRequest(`/chat/${chatId}`, { method: "DELETE" });
}

export async function generateChatTitle(
    chatId: string,
    message: string,
): Promise<{ title: string }> {
    return apiRequest<{ title: string }>(`/chat/${chatId}/generate-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });
}

export async function streamChat(payload: {
    messages: {
        role: string;
        content: string;
        files?: { filename: string; document_id?: string }[];
        workflow?: { id: string; title: string };
    }[];
    chat_id?: string;
    project_id?: string;
    model?: string;
    signal?: AbortSignal;
}): Promise<Response> {
    const { signal, ...body } = payload;
    const authHeaders = await getAuthHeader();
    return fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...authHeaders,
        },
        body: JSON.stringify(body),
        signal,
    });
}

type StreamChatMessage = {
    role: string;
    content: string;
    files?: { filename: string; document_id?: string }[];
    workflow?: { id: string; title: string };
};

export async function streamProjectChat(payload: {
    projectId: string;
    messages: StreamChatMessage[];
    chat_id?: string;
    model?: string;
    displayed_doc?: { filename: string; document_id: string };
    attached_documents?: { filename: string; document_id: string }[];
    signal?: AbortSignal;
}): Promise<Response> {
    const { projectId, signal, ...body } = payload;
    const authHeaders = await getAuthHeader();
    return fetch(`${API_BASE}/projects/${projectId}/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...authHeaders,
        },
        body: JSON.stringify(body),
        signal,
    });
}

// ---------------------------------------------------------------------------
// Draft odpowiedzi - pipeline obrony (Invisible AI, ADR-0058)
// ---------------------------------------------------------------------------

export type DefenseStage = "recenzent" | "adwokat" | "pisz-po-ludzku";
export type AdwokatMode = "strona-przeciwna" | "sad" | "prokurator";

export interface DraftStageResult {
    // Wbudowany etap (enum) albo id custom skilla z paczki (ADR-0096).
    stage: DefenseStage | string;
    mode?: AdwokatMode;
    // Etykieta wyswietlana dla custom skilla (nazwa z manifestu).
    label?: string;
    output: string;
}

export interface DraftRefineResult {
    final: string;
    stages: DraftStageResult[];
}

export async function refineDraft(payload: {
    text: string;
    stages?: DefenseStage[];
    adwokat_mode?: AdwokatMode;
    model?: string;
    context?: string;
}): Promise<DraftRefineResult> {
    return apiRequest<DraftRefineResult>("/draft/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

// ---------------------------------------------------------------------------
// Folder Sprawy - import lokalnego katalogu (ADR-0056, desktop-only)
// ---------------------------------------------------------------------------

export interface FolderIngestEntry {
    file: string;
    httpStatus: number;
    documentId?: string;
}

export interface FolderIngestResult {
    folder: string;
    total: number;
    indexed: number;
    results: FolderIngestEntry[];
}

export async function ingestCaseFolder(
    path: string,
    projectId?: string | null,
): Promise<FolderIngestResult> {
    return apiRequest<FolderIngestResult>("/folders/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, project_id: projectId ?? null }),
    });
}

// ---------------------------------------------------------------------------
// Tabular Review
// ---------------------------------------------------------------------------

export async function listTabularReviews(
    projectId?: string,
): Promise<TabularReview[]> {
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return apiRequest<TabularReview[]>(`/tabular-review${qs}`);
}

export async function createTabularReview(payload: {
    title?: string;
    document_ids: string[];
    columns_config: { index: number; name: string; prompt: string }[];
    workflow_id?: string;
    project_id?: string;
}): Promise<TabularReview> {
    return apiRequest<TabularReview>("/tabular-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function getTabularReview(
    reviewId: string,
): Promise<TabularReviewDetailOut> {
    return apiRequest<TabularReviewDetailOut>(`/tabular-review/${reviewId}`);
}

export async function updateTabularReview(
    reviewId: string,
    payload: {
        title?: string;
        columns_config?: { index: number; name: string; prompt: string }[];
        document_ids?: string[];
        project_id?: string | null;
        shared_with?: string[];
    },
): Promise<TabularReview> {
    return apiRequest<TabularReview>(`/tabular-review/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function getTabularReviewPeople(
    reviewId: string,
): Promise<ProjectPeople> {
    return apiRequest<ProjectPeople>(`/tabular-review/${reviewId}/people`);
}

export async function generateTabularColumnPrompt(
    title: string,
    options?: { format?: string; documentName?: string; tags?: string[] },
): Promise<{ prompt: string; source: "preset" | "llm" | "fallback" }> {
    return apiRequest<{
        prompt: string;
        source: "preset" | "llm" | "fallback";
    }>("/tabular-review/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title,
            format: options?.format,
            documentName: options?.documentName,
            tags: options?.tags,
        }),
    });
}

export async function uploadReviewDocument(
    reviewId: string,
    file: File,
    options?: {
        projectId?: string;
        documentIds?: string[];
        columnsConfig?: { index: number; name: string; prompt: string }[];
    },
): Promise<PATRONDocument> {
    const uploaded = options?.projectId
        ? await uploadProjectDocument(options.projectId, file)
        : await uploadStandaloneDocument(file);

    await updateTabularReview(reviewId, {
        columns_config: options?.columnsConfig,
        document_ids: [...(options?.documentIds ?? []), uploaded.id],
    });

    return uploaded;
}

export async function deleteTabularReview(reviewId: string): Promise<void> {
    await apiRequest(`/tabular-review/${reviewId}`, { method: "DELETE" });
}

export async function streamTabularGeneration(
    reviewId: string,
): Promise<Response> {
    const authHeaders = await getAuthHeader();
    return fetch(`${API_BASE}/tabular-review/${reviewId}/generate`, {
        method: "POST",
        headers: { ...authHeaders },
    });
}

export async function streamTabularChat(
    reviewId: string,
    messages: { role: string; content: string }[],
    chat_id?: string | null,
    signal?: AbortSignal,
    context?: { reviewTitle?: string | null; projectName?: string | null },
): Promise<Response> {
    const authHeaders = await getAuthHeader();
    return fetch(`${API_BASE}/tabular-review/${reviewId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
            messages,
            chat_id: chat_id ?? undefined,
            review_title: context?.reviewTitle ?? undefined,
            project_name: context?.projectName ?? undefined,
        }),
        signal: signal ?? undefined,
    });
}

export interface TRCitationAnnotation {
    type: "tabular_citation";
    ref: number;
    col_index: number;
    row_index: number;
    col_name: string;
    doc_name: string;
    quote: string;
}

interface RawTRMessage {
    id: string;
    chat_id: string;
    role: "user" | "assistant";
    content: string | AssistantEvent[] | null;
    annotations?: TRCitationAnnotation[] | null;
    created_at: string;
}

export interface TRDisplayMessage {
    role: "user" | "assistant";
    content: string;
    events?: AssistantEvent[];
    annotations?: TRCitationAnnotation[];
}

export interface TRChat {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
}

export function mapTRMessages(raw: RawTRMessage[]): TRDisplayMessage[] {
    return raw.map((m) => {
        if (m.role === "user") {
            return {
                role: "user" as const,
                content: typeof m.content === "string" ? m.content : "",
            };
        }
        const events = Array.isArray(m.content)
            ? (m.content as AssistantEvent[])
            : undefined;
        const content =
            events
                ?.filter((e) => e.type === "content")
                .map((e) => (e as { type: "content"; text: string }).text)
                .join("") ?? "";
        return {
            role: "assistant" as const,
            content,
            events,
            annotations: m.annotations ?? undefined,
        };
    });
}

export async function getTabularChats(reviewId: string): Promise<TRChat[]> {
    return apiRequest<TRChat[]>(`/tabular-review/${reviewId}/chats`);
}

export async function getTabularChatMessages(
    reviewId: string,
    chatId: string,
): Promise<RawTRMessage[]> {
    return apiRequest<RawTRMessage[]>(
        `/tabular-review/${reviewId}/chats/${chatId}/messages`,
    );
}

export async function deleteTabularChat(
    reviewId: string,
    chatId: string,
): Promise<void> {
    await apiRequest(`/tabular-review/${reviewId}/chats/${chatId}`, {
        method: "DELETE",
    });
}

export async function regenerateTabularCell(
    reviewId: string,
    documentId: string,
    columnIndex: number,
): Promise<{
    summary: string;
    flag: "green" | "grey" | "yellow" | "red";
    reasoning: string;
}> {
    return apiRequest(`/tabular-review/${reviewId}/regenerate-cell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            document_id: documentId,
            column_index: columnIndex,
        }),
    });
}

export async function clearTabularCells(
    reviewId: string,
    documentIds: string[],
): Promise<void> {
    await apiRequest(`/tabular-review/${reviewId}/clear-cells`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_ids: documentIds }),
    });
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

type WorkflowType = PATRONWorkflow["type"];

export async function listWorkflows(
    type: WorkflowType,
): Promise<PATRONWorkflow[]> {
    return apiRequest<PATRONWorkflow[]>(`/workflows?type=${type}`);
}

export async function getWorkflow(workflowId: string): Promise<PATRONWorkflow> {
    return apiRequest<PATRONWorkflow>(`/workflows/${workflowId}`);
}

export async function createWorkflow(payload: {
    title: string;
    type: "assistant" | "tabular";
    prompt_md?: string;
    columns_config?: { index: number; name: string; prompt: string }[];
    practice?: string | null;
}): Promise<PATRONWorkflow> {
    return apiRequest<PATRONWorkflow>("/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function updateWorkflow(
    workflowId: string,
    payload: {
        title?: string;
        prompt_md?: string;
        columns_config?: { index: number; name: string; prompt: string }[];
        practice?: string | null;
    },
): Promise<PATRONWorkflow> {
    return apiRequest<PATRONWorkflow>(`/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
    await apiRequest(`/workflows/${workflowId}`, { method: "DELETE" });
}

export async function listHiddenWorkflows(): Promise<string[]> {
    return apiRequest<string[]>("/workflows/hidden");
}

export async function hideWorkflow(workflowId: string): Promise<void> {
    await apiRequest("/workflows/hidden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_id: workflowId }),
    });
}

export async function unhideWorkflow(workflowId: string): Promise<void> {
    await apiRequest(`/workflows/hidden/${workflowId}`, { method: "DELETE" });
}

export async function shareWorkflow(
    workflowId: string,
    payload: { emails: string[]; allow_edit: boolean },
): Promise<void> {
    await apiRequest<void>(`/workflows/${workflowId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function listWorkflowShares(workflowId: string): Promise<
    {
        id: string;
        shared_with_email: string;
        allow_edit: boolean;
        created_at: string;
    }[]
> {
    return apiRequest(`/workflows/${workflowId}/shares`);
}

export async function deleteWorkflowShare(
    workflowId: string,
    shareId: string,
): Promise<void> {
    await apiRequest(`/workflows/${workflowId}/shares/${shareId}`, {
        method: "DELETE",
    });
}

// --- Panel zuzycia i kosztow AI (ADR-0076) - reader nad /api/usage -------------

export interface UsageSummary {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costRealUsd: number;
    costEstimatedUsd: number;
    unpricedCalls: number;
}

export interface UsageGroup extends UsageSummary {
    key: string;
}

export interface UsageResponse<T> {
    from: string;
    until: string;
    count: number;
    data: T;
}

export async function getUsageSummary(): Promise<UsageResponse<UsageSummary>> {
    return apiRequest(`/api/usage/summary`);
}

export async function getUsageByModel(): Promise<UsageResponse<UsageGroup[]>> {
    return apiRequest(`/api/usage/by-model`);
}

export async function getUsageByCase(): Promise<UsageResponse<UsageGroup[]>> {
    return apiRequest(`/api/usage/by-case`);
}

export async function getUsageTimeseries(): Promise<UsageResponse<UsageGroup[]>> {
    return apiRequest(`/api/usage/timeseries`);
}
