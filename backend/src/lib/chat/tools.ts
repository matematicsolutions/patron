// Definicje narzedzi OpenAI/Anthropic schemat dla czatu Patrona.
// Wyciagniete z chatTools.ts w ramach refactoru Faza 2.3.

export const PROJECT_EXTRA_TOOLS = [
    {
        type: "function",
        function: {
            name: "list_documents",
            description:
                "List all documents available in the project. Returns each document's ID, filename, and file type. Call this to discover what documents are available before deciding which ones to read.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "fetch_documents",
            description:
                "Read the full text content of multiple documents in a single call. Use this instead of calling read_document repeatedly when you need to read several documents at once.",
            parameters: {
                type: "object",
                properties: {
                    doc_ids: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "Array of document IDs to read (e.g. ['doc-0', 'doc-2'])",
                    },
                },
                required: ["doc_ids"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "replicate_document",
            description:
                "Make byte-for-byte copies of an existing project document as new project documents. Use when the user wants standalone copies to edit (e.g. 'use this NDA as a template', 'give me three drafts I can adapt') without modifying the original. Pass `count` to create multiple copies in a single call rather than calling the tool repeatedly. Returns the new doc_id slugs so you can immediately call edit_document / read_document on them.",
            parameters: {
                type: "object",
                properties: {
                    doc_id: {
                        type: "string",
                        description:
                            "ID of the source document to copy (e.g. 'doc-0').",
                    },
                    count: {
                        type: "integer",
                        description:
                            "How many copies to create. Defaults to 1. Maximum 20.",
                        minimum: 1,
                        maximum: 20,
                    },
                    new_filename: {
                        type: "string",
                        description:
                            "Optional base filename. With count > 1, copies are suffixed (e.g. 'Foo (1).docx', 'Foo (2).docx'). Extension is forced to match the source.",
                    },
                },
                required: ["doc_id"],
            },
        },
    },
];

export const TABULAR_TOOLS = [
    {
        type: "function",
        function: {
            name: "read_table_cells",
            description:
                "Read the extracted cell content from the tabular review. Each cell contains the value extracted for a specific column from a specific document. Pass col_indices and/or row_indices (0-based) to read a subset; omit either to read all columns or all rows.",
            parameters: {
                type: "object",
                properties: {
                    col_indices: {
                        type: "array",
                        items: { type: "integer" },
                        description:
                            "0-based column indices to read (e.g. [0, 2]). Omit to read all columns.",
                    },
                    row_indices: {
                        type: "array",
                        items: { type: "integer" },
                        description:
                            "0-based document (row) indices to read (e.g. [0, 1]). Omit to read all rows.",
                    },
                },
            },
        },
    },
];

export const WORKFLOW_TOOLS = [
    {
        type: "function",
        function: {
            name: "list_workflows",
            description:
                "List all workflows available to the user. Returns each workflow's ID and title. Call this when the user asks to run a workflow, apply a template, or you need to discover what workflows exist.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "read_workflow",
            description:
                "Read the full instructions (prompt) of a workflow by its ID. Call this after list_workflows to load a specific workflow's prompt, then follow those instructions.",
            parameters: {
                type: "object",
                properties: {
                    workflow_id: {
                        type: "string",
                        description: "The workflow ID to read",
                    },
                },
                required: ["workflow_id"],
            },
        },
    },
];

export const TOOLS = [
    {
        type: "function",
        function: {
            name: "search_corpus",
            description:
                "Semantic + keyword search over the user's saved document corpus (RAG). Use this to find relevant passages across documents that are NOT attached to the current chat - e.g. earlier case files, opinions, or rulings the user has uploaded before. Combines vector similarity, exact-term (BM25) and citation-graph signals. Returns the most relevant fragments with their source filename so you can quote and name the source. For documents already attached to this chat, prefer read_document / find_in_document.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Natural-language question or key terms (e.g. a ruling signature like 'III CZP 11/13', a legal concept, or a party name).",
                    },
                    max_results: {
                        type: "integer",
                        description:
                            "Maximum number of fragments to return (default 8).",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "remember",
            description:
                "Save a durable fact, decision, deadline, party detail, or the user's style preference to PATRON's case memory (Bibliotekarz). Use this when you learn something that should persist across future chats about this matter - e.g. 'klient woli pisma w formie bezosobowej', a settled fact, a procedural deadline, a key party. Do NOT save full document text (that is in the corpus) or transient chat details. Memory is scoped to the current case (project) or personal if no case.",
            parameters: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        description:
                            "Memory type: 'fakt-sprawy', 'preferencja', 'decyzja', 'kontakt', 'termin', or 'notatka'.",
                    },
                    title: {
                        type: "string",
                        description: "Short title of the memory (one line).",
                    },
                    body: {
                        type: "string",
                        description:
                            "The memory content. Concise and self-contained; include why it matters.",
                    },
                    slug: {
                        type: "string",
                        description:
                            "Optional stable identifier (kebab-case). Reuse the same slug to UPDATE an existing memory instead of creating a duplicate.",
                    },
                },
                required: ["title", "body"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "recall",
            description:
                "Read PATRON's case memory (Bibliotekarz) for the current matter. Call with no arguments to list saved memories (titles + types), or with a slug to read one in full. Use this at the start of work on a matter to recover what PATRON already knows (facts, decisions, the user's style preferences).",
            parameters: {
                type: "object",
                properties: {
                    slug: {
                        type: "string",
                        description:
                            "Optional slug of a specific memory to read in full. Omit to list all memories in scope.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_document",
            description:
                "Read the full text content of a document attached by the user. Always call this before answering questions about, summarising, or citing from a document.",
            parameters: {
                type: "object",
                properties: {
                    doc_id: {
                        type: "string",
                        description:
                            "The document ID to read (e.g. 'doc-0', 'doc-1')",
                    },
                },
                required: ["doc_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_document_text",
            description:
                "Read a document in bounded windows instead of all at once. Like read_document but returns at most max_chars characters starting at char_offset, plus next_offset and truncated so you can page through long files (umowy, akta na setki stron) without flooding the context. To continue, call again with char_offset set to the previous response's next_offset until next_offset is null. Prefer this over read_document for large documents; use find_in_document for targeted lookups.",
            parameters: {
                type: "object",
                properties: {
                    doc_id: {
                        type: "string",
                        description:
                            "The document ID to read (e.g. 'doc-0', 'doc-1').",
                    },
                    char_offset: {
                        type: "integer",
                        description:
                            "Start offset in characters (default 0). Pass the previous response's next_offset to read the next window.",
                    },
                    max_chars: {
                        type: "integer",
                        description:
                            "Maximum characters to return (default 50000, hard cap 200000).",
                    },
                },
                required: ["doc_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "find_in_document",
            description:
                "Search for specific strings inside a document — a Ctrl+F equivalent. Returns each match with surrounding context so you can locate and quote the exact text without reading the whole document. Matching is case-insensitive and whitespace-tolerant. Use this for targeted lookups (e.g. finding a clause title, party name, or a specific phrase) rather than reading the whole document.",
            parameters: {
                type: "object",
                properties: {
                    doc_id: {
                        type: "string",
                        description:
                            "The document ID to search (e.g. 'doc-0').",
                    },
                    query: {
                        type: "string",
                        description:
                            "The string to search for. Matching is case-insensitive and collapses runs of whitespace, so 'Section 4.2' matches 'section   4.2'.",
                    },
                    max_results: {
                        type: "integer",
                        description:
                            "Maximum number of matches to return (default 20). Use a smaller value for common terms.",
                    },
                    context_chars: {
                        type: "integer",
                        description:
                            "Characters of surrounding context to include on each side of a match (default 80).",
                    },
                },
                required: ["doc_id", "query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "generate_docx",
            description:
                "Generate a Word (.docx) document from structured content. Use this when the user asks you to draft, create, or produce a legal document. Returns a download URL for the generated file.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description:
                            "Document title (used as filename and heading)",
                    },
                    landscape: {
                        type: "boolean",
                        description:
                            "Set to true for landscape page orientation. Default is portrait.",
                    },
                    kancelaria: {
                        type: "boolean",
                        description:
                            "Preset 'styl kancelarii' (polskie pisma): bez tabel (renderowane jako wyliczenia), srodtytuly pogrubione w osobnym wersie, numeracja stron w prawym-dolnym rogu. Uzyj dla pism procesowych / pism do kancelarii.",
                    },
                    sections: {
                        type: "array",
                        description:
                            "List of document sections. Each section may contain a heading, prose content, or a table.",
                        items: {
                            type: "object",
                            properties: {
                                heading: {
                                    type: "string",
                                    description: "Optional section heading",
                                },
                                level: {
                                    type: "integer",
                                    description: "Heading level: 1, 2, or 3",
                                },
                                content: {
                                    type: "string",
                                    description:
                                        "Prose text content (paragraphs separated by double newlines)",
                                },
                                pageBreak: {
                                    type: "boolean",
                                    description:
                                        "Set to true to start this section on a new page. Use for contract signature pages.",
                                },
                                table: {
                                    type: "object",
                                    description:
                                        "Optional table to render in this section",
                                    properties: {
                                        headers: {
                                            type: "array",
                                            items: { type: "string" },
                                            description: "Column header labels",
                                        },
                                        rows: {
                                            type: "array",
                                            items: {
                                                type: "array",
                                                items: { type: "string" },
                                            },
                                            description:
                                                "Array of rows, each row is an array of cell strings matching the headers order",
                                        },
                                    },
                                    required: ["headers", "rows"],
                                },
                            },
                        },
                    },
                },
                required: ["title", "sections"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "edit_document",
            description:
                "Propose edits to a user-attached .docx as tracked changes. Each edit is a precise, minimal substitution of specific words/characters, NOT a whole-line or paragraph replacement. Use read_document first. Anchor each edit with short before/after context so it can be located unambiguously. Returns per-edit annotations the UI will render as Accept/Reject cards and a download link to the edited document.",
            parameters: {
                type: "object",
                properties: {
                    doc_id: {
                        type: "string",
                        description: "Document slug (e.g. 'doc-0').",
                    },
                    edits: {
                        type: "array",
                        description: "List of precise substitutions.",
                        items: {
                            type: "object",
                            properties: {
                                find: {
                                    type: "string",
                                    description:
                                        "Exact substring to replace (keep it as short as possible — ideally just the words/chars being changed).",
                                },
                                replace: {
                                    type: "string",
                                    description:
                                        "Replacement text. Empty string = pure deletion.",
                                },
                                context_before: {
                                    type: "string",
                                    description:
                                        "~40 chars immediately preceding `find`, used to disambiguate.",
                                },
                                context_after: {
                                    type: "string",
                                    description:
                                        "~40 chars immediately following `find`.",
                                },
                                reason: {
                                    type: "string",
                                    description:
                                        "Short explanation shown to the user on the card.",
                                },
                            },
                            required: [
                                "find",
                                "replace",
                                "context_before",
                                "context_after",
                            ],
                        },
                    },
                },
                required: ["doc_id", "edits"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "add_comments",
            description:
                "Attach reviewer comments (margin annotations) to a user-attached .docx, WITHOUT changing its text. Use this when reviewing a document and you want to flag an issue, raise a question, or note a risk about a passage rather than rewrite it - e.g. 'rozwaz czy ten zapis nie jest abuzywny', 'brak klauzuli RODO', 'sprawdz sygnature'. Prefer this over edit_document for observations that should NOT modify the wording. Use read_document first. Anchor each comment with short before/after context so the passage is located unambiguously. A comment whose span overlaps an existing tracked change is rejected - comment a clean span or apply comments before edits. Returns a download link to the commented .docx (opens in Word's review pane).",
            parameters: {
                type: "object",
                properties: {
                    doc_id: {
                        type: "string",
                        description: "Document slug (e.g. 'doc-0').",
                    },
                    comments: {
                        type: "array",
                        description: "List of comments to attach.",
                        items: {
                            type: "object",
                            properties: {
                                find: {
                                    type: "string",
                                    description:
                                        "Exact passage the comment is anchored to (the highlighted span). Keep it as short as needed to be unambiguous.",
                                },
                                context_before: {
                                    type: "string",
                                    description:
                                        "~40 chars immediately preceding `find`, used to disambiguate.",
                                },
                                context_after: {
                                    type: "string",
                                    description:
                                        "~40 chars immediately following `find`.",
                                },
                                text: {
                                    type: "string",
                                    description:
                                        "The comment body shown in Word's review pane.",
                                },
                            },
                            required: [
                                "find",
                                "context_before",
                                "context_after",
                                "text",
                            ],
                        },
                    },
                },
                required: ["doc_id", "comments"],
            },
        },
    },
];
