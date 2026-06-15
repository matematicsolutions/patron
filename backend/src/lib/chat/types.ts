// Typy wspoldzielone warstwy czatu Patrona.
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3 (roadmap).

export type DocStore = Map<
    string,
    { storage_path: string; file_type: string; filename: string }
>;

export type WorkflowStore = Map<string, { title: string; prompt_md: string }>;

export type DocIndex = Record<
    string,
    {
        document_id: string;
        filename: string;
        version_id?: string | null;
        version_number?: number | null;
    }
>;

export type TabularCellStore = {
    columns: { index: number; name: string }[];
    documents: { id: string; filename: string }[];
    /** key: `${colIndex}:${docId}` */
    cells: Map<
        string,
        { summary: string; flag?: string; reasoning?: string } | null
    >;
};

export type ToolCall = {
    id: string;
    function: { name: string; arguments: string };
};

export type ChatMessage = {
    role: string;
    content: string | null;
    files?: { filename: string; document_id?: string }[];
    workflow?: { id: string; title: string };
};

/** Reprezentacja jednego cytatu z bloku <CITATIONS> w odpowiedzi LLM. */
export type ParsedCitation = {
    ref: number;
    doc_id: string;
    page: number | string;
    quote: string;
};

/**
 * Adnotacja komentarza recenzenta - wynik runAddComments (ADR-0078).
 * Inaczej niz EditAnnotation: komentarz jest informacyjny (brak accept/reject),
 * zyje w bajtach wersji .docx (comments.xml), nie w osobnej tabeli.
 */
export type CommentAnnotation = {
    kind: "comment";
    comment_id: string;
    document_id: string;
    version_id: string;
    version_number?: number | null;
    anchored_text: string;
    text: string;
    context_before: string;
    context_after: string;
};

/** Adnotacja edycji dokumentu - wynik runEditDocument zapisywany w DB. */
export type EditAnnotation = {
    kind: "edit";
    edit_id: string;
    document_id: string;
    version_id: string;
    version_number?: number | null;
    change_id: string;
    del_w_id?: string;
    ins_w_id?: string;
    deleted_text: string;
    inserted_text: string;
    context_before: string;
    context_after: string;
    reason?: string;
    status: "pending" | "accepted" | "rejected";
};
