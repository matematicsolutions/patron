// Fasada warstwy czatu Patrona po refaktorze Faza 2.3 (iteracje 1+2).
// Caly silnik zostal rozbity na moduly w ./chat/. Ten plik istnieje wylacznie
// po to, zeby istniejace callsite'y (`from "../lib/chatTools"`) nadal dzialaly.
//
// Mapa modulow:
//   chat/types.ts           - typy wspoldzielone (DocStore, DocIndex, ChatMessage, ...)
//   chat/prompts.ts         - SYSTEM_PROMPT, citationReminder
//   chat/tools.ts           - definicje schemat narzedzi OpenAI (TOOLS, WORKFLOW_TOOLS, ...)
//   chat/citations.ts       - parser bloku <CITATIONS> + resolwery dokumentow
//   chat/messages.ts        - buildMessages, enrichWithPriorEvents
//   chat/pdf.ts             - extractPdfText
//   chat/persistence.ts     - buildDocContext, buildProjectDocContext, buildWorkflowStore, extractAnnotations
//   chat/docx-generate.ts   - generateDocx
//   chat/docx-edit.ts       - loadCurrentVersionBytes, runEditDocument
//   chat/tool-dispatch.ts   - runToolCalls + helpery (readDocumentContent, findInDocumentContent, normalize*)
//   chat/stream.ts          - runLLMStream + AssistantEvent

export * from "./chat";
