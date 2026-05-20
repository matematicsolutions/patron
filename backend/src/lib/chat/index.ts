// Barrel - publiczne API warstwy czatu Patrona.
// Konsumenci (routes/chat.ts, routes/projectChat.ts) importuja z "../lib/chatTools",
// ktore z kolei re-eksportuje wszystko stad. To pozwala stopniowo wyciagac
// kolejne kawalki monolitu bez psucia callsite'ow.

export * from "./types";
export * from "./prompts";
export * from "./tools";
export * from "./citations";
export * from "./messages";
export * from "./pdf";
export * from "./persistence";
export * from "./docx-generate";
export * from "./docx-edit";
export * from "./tool-dispatch";
export * from "./stream";
