# Patron: a tutorial for Counsel

**Step by step, from first launch to a finished pleading.**
Matches the June 2026 installer. You do not need any technical background. If you can work with documents in Word, you can use Patron.

---

## Table of contents

1. [What Patron is (in one paragraph)](#1-what-patron-is)
2. [First launch](#2-first-launch)
3. [Screen map: three panels](#3-screen-map)
4. [Step 1: Create a case and upload the files](#4-step-1-create-a-case-and-upload-the-files)
5. [Step 2: Chat with the case files](#5-step-2-chat-with-the-case-files)
6. [Step 3: Search case law and legislation](#6-step-3-case-law-and-legislation)
7. [Step 4: Working with documents and EDITING them](#7-step-4-editing-documents)
8. [Step 5: A table from a batch of contracts (Tabular review)](#8-step-5-a-table-from-contracts)
9. [Step 6: Workflows (repeatable tasks)](#9-step-6-workflows)
10. [Step 7: Choosing an AI model](#10-step-7-choosing-a-model)
11. [Skill library](#11-skill-library)
12. [Common questions and problems](#12-faq)
13. [Cheat sheet: ready-made prompts](#13-cheat-sheet)

---

## 1. What Patron is

Patron is your legal assistant installed **on your own computer** (a desktop app, like Word). You upload the case files (contracts, statements of claim, judgments, scans) and it:

- **reads them for you** and answers your questions, citing sources from your own documents,
- **searches case law** (Supreme Court, common courts, the Supreme Administrative Court) and **legislation** (Journal of Laws, EU law) across a full set of built-in databases,
- **proposes changes to documents** as tracked changes (Word's track-changes), which you accept with a single click,
- **refines your pleadings** (review, devil's advocate, language editing).

Patron does not make legal decisions and does not replace your judgment. It is a tool: faster reading of the file, and a first draft that you check in any case.

---

## 2. First launch

1. Start **PATRON** (the desktop icon or the Start menu). You will see a loading screen, then, after a dozen or so seconds, the main window. No account or sign-in is needed. Patron is single-user and local, so the case files, the databases and the chat history stay on your computer.
2. **Add an AI model key.** This is the one step without which the assistant will not answer. Open **Account → Models and API keys** and paste the key from your provider (for example Libra/Anthropic, or Gemini/OpenAI). Save it. From that moment chat, document editing and tables all work. Details: [Step 7](#10-step-7-choosing-a-model).
3. **Internet and file conversion.** A cloud model and live case-law search (SAOS, NSA, ISAP, KRS, EUR-Lex) need an internet connection. The EU law database and search across your own documents also work offline. If you see a conversion error when uploading older `.doc` files, ask your administrator to install LibreOffice (it is free).

> **Tip:** Patron addresses you as "Counsel". It talks to you in English, but it drafts pleadings in Polish, because they are filed with Polish courts. Not sure where to start? Ask it directly in the chat: **"What can you do?"** or **"How do I start?"**, and it will walk you through its features step by step. If you cannot see something, expand the left panel (**Explorer**).

---

## 3. Screen map

The assistant screen is split into **three vertical panels**:

| Panel | Name | What it is for |
|---|---|---|
| **left** | **Explorer** | the list of cases (projects) and documents; this is where you upload files |
| **middle** | **Document viewer** | the content of the document you clicked; this is where tracked changes appear |
| **right** | **Assistant** | the chat, where you ask questions and give instructions |

You can collapse the left panel ("Collapse explorer") and expand it again when you need room for the viewer.

---

## 4. Step 1: Create a case and upload the files

**Rule 1: one case = one project.** Do not mix files from different cases. Patron searches every document in the project for each question you ask.

### 4.1. Create a project
1. In the left panel, click **+ New project** (or "New case", shortcut **Ctrl+N**).
2. Give it a descriptive name, e.g. `Kowalski v. Nowak-Bud, claim 2026`.

### 4.2. Upload documents: three ways

- **Drag and drop:** select the files or folder in Windows Explorer and drop them onto the panel (you will see "Drop to upload").
- **Upload documents:** the button in the left panel, then choose files (PDF, DOCX, DOC).
- **Import the case folder** (the fastest option with many files): give the path to the directory, e.g. `C:\Cases\Kowalski-2026`. Patron will pull in all the files at once, scan them for security, and index them.

What happens under the hood (you do not have to do anything): Patron recognises the document's editorial structure (articles, paragraphs, points), runs OCR on scans, and the full text goes into search. Paper scans and files with no text layer will work too.

> **Rule 2: upload ALL the case files before your first question.** The fuller the file, the more accurate the answers. Documents added later will not retroactively change earlier answers.

---

## 5. Step 2: Chat with the case files

In the right panel (**Assistant**), type your question and send it. Patron picks the most relevant passages from the whole file itself (you do not need to paste any text).

**Ask specific questions.** Instead of "what is in the contract", write:
- "What obligations does the Ordering Party have under §5 of contract no. 3?"
- "List every payment deadline and contractual penalty in this contract."
- "Are there grounds for a limitation defence? Point to the dates in the file."
- "What are the inconsistencies between the main contract and annex no. 2?"

### Read the colour badge next to citations
Every citation from your documents gets a reliability marker:

- 🟢 **green:** a verbatim citation, found in your case files. You can use it in a pleading with the source given.
- 🟡 **yellow:** a possible reworking or paraphrase. Check it against the original.
- 🔴 **red:** not found in the file. **Do not cite it without checking by hand.** It may be wording that only sounds like a citation.

> **Rule 3: before you paste a citation into a pleading, look at the badge.** It is your anti-hallucination filter.

---

## 6. Step 3: Case law and legislation

Patron comes with **a full set of built-in legal databases** (they work straight after installation, with no setup):

| Database | What you will find |
|---|---|
| **SAOS** | judgments of the common courts, the Supreme Court, the Constitutional Tribunal and the National Appeals Chamber (NAC) |
| **NSA** | case law of the Supreme Administrative Court and the 16 regional administrative courts (CBOSA) |
| **ISAP** | Polish legislation: the Journal of Laws and Monitor Polski |
| **KRS** | entity data from the National Court Register |
| **EUR-Lex** | EU law and CJEU case law |
| **EU-Compliance** | GDPR, the AI Act, DORA, NIS2, eIDAS 2.0, the CRA (offline) |

Just ask in plain language, and Patron will reach for the right database itself:

- "Find Supreme Court judgments on compensation for the infringement of personal interests. Give the case reference numbers."
  → Patron returns real judgments from the SAOS database, e.g. **I CSK 90/15**, **III CSK 217/15**, **IV CSK 270/15**, with dates and links.
- "Show me Article 415 of the Civil Code."
- "What is the definition of a high-risk AI system in the AI Act?"
- "Check the management board of Nowak-Bud sp. z o.o. in the KRS."

> **Remember:** the databases are quick access and a prompt. Before you cite a provision in a pleading, check its current wording in the official source, because legislation changes.

---

## 7. Step 4: Editing documents

This is the heart of the daily work. Patron edits documents in three ways. All of them end in a file you open in Word.

### 7A. Ask for a change, review the tracked changes, accept

This is the most convenient mode for individual fixes in a contract or pleading.

1. In the Explorer, **click a DOCX document**. It appears in the middle panel (**Document viewer**).
2. In the Assistant, write what you want, **naming the place**:
   - "Propose a change to §4. I want to limit the contractor's liability to actual damage, excluding lost profits."
   - "Add a clause to §3 designating the court with jurisdiction for the Ordering Party's registered office."
   - "Redraft §7 so that the notice period is 3 months, taking effect at the end of the month."
3. Patron replies with **change cards**. Each card shows:
   - text being **added** in green,
   - text being **removed** in red with strikethrough,
   - a short **rationale** for the change.
4. Each card gives you three buttons:
   - **Accept:** Patron applies the change and creates a **new version** of the document (genuine Word tracked changes),
   - **Reject:** the change disappears,
   - **Open:** preview the change in the context of the whole document.
5. Once you have accepted, download the finished file (the download icon next to the document) and open it in Word. You will see the changes as a review awaiting final acceptance.

> You can accept changes one by one or in bulk. Every acceptance saves a new version, and the old versions stay in the history, so you lose nothing.

### 7B. Refine a whole pleading: "Response draft" (review, devil's advocate, language)

This is the mode for a whole pleading, or a longer passage you want to strengthen.

1. Open the **Response draft** panel (the ✨ icon under the assistant's reply, or from the menu).
2. In the **Pleading text** field, paste your working text.
3. Choose the perspective for the devil's advocate (**"from whose perspective"**):
   - **Opposing party:** how the other side's counsel will attack it,
   - **The court:** what the bench will ask about,
   - **Prosecutor:** the prosecution angle.
4. Click **Refine pleading**. Patron runs the text through three stages:
   - **Reviewer:** flags gaps in logic and weak authorities, and strengthens the argument,
   - **Devil's advocate:** anticipates and rebuts counter-arguments from the chosen perspective,
   - **Write plainly:** removes the "AI style" while keeping the legal precision.
5. You get a **Finished draft** (which you can copy) and an expandable **"How the draft was built"** section that shows what each stage changed.

> **Rule 4: the pipeline works best on finished text, not on an empty prompt.** Write your own version, paste it, and ask for it to be strengthened. Then add your own edit, and a second pass if needed.

### 7C. Round-trip: edit in Word, return to Patron

If you prefer to work in Word:

1. Download the document from Patron.
2. In Word, make **your own changes with track changes on**, add comments, and wherever you want Patron to do something, write an instruction in a comment in the format `[PATRON: write the instruction here]`.
3. Upload the file again (as a new version). Patron reads your tracked changes, comments and `[PATRON: ...]` instructions, and learns your editing style.

### 7D. Versions and downloads
- Every accepted change = a new version (the history is kept).
- Download a single file with the download icon, or download the whole project as a ZIP.

---

## 8. Step 5: A table from a batch of contracts

When you have **many similar documents** (e.g. 30 leases) and want to compare them in a table, use **Tabular review**.

1. Go to **Tabular reviews → + Create new**.
2. Add columns, either from the ready legal presets (Parties, Subject matter, Contractual penalty, Governing law, Notice period…) or your own, e.g. "GDPR clause: yes/no".
3. Click **Generate**. The table fills in as it streams: Patron searches each document and enters the result.
4. Each cell has a reliability badge (🟢/🟡/🔴). 🔴 means check by hand; click the cell to see the source.
5. Export to Excel for the client or the team.

> The point: you review a batch of contracts in one pass instead of opening them one by one, and every cell points back to its source.

---

## 9. Step 6: Workflows

Save a repeatable task (e.g. "Lease analysis", "Due diligence review") once as a **workflow** and run it on new cases with a single click.

- Start with the built-in workflows.
- Your own: **Workflows → New**, type the instructions step by step, then save.
- You can share a workflow with colleagues, so the whole firm runs due diligence off the same checklist.

---

## 10. Step 7: Choosing a model

Patron is **vendor-neutral**, so you choose the model. It is a single setting in **Account → Models and API keys**, and changing it does not require a reinstall.

- **A cloud model (e.g. Libra / Claude, Gemini)** gives the strongest editing and reasoning. This is the ordinary working choice for a firm. The content of your query then goes to the provider you chose.
- **A local model (Ollama)** works without internet, at zero cost. It needs a one-off install of Ollama and downloading the model to your computer.

You can mix them: a cheaper or local model to explore the file, a stronger one for the final pleading. You can check usage and costs in **Account → Usage** (with a filter by case).

**Privileged matters and the cloud.** In the desktop version, you, the lawyer on your own machine, are the host of the data, so your choice of a cloud model is informed consent. Patron lets you work with any model, including on matters marked as privileged. **Every** flow of data to the model is recorded in an immutable audit log (proof of due diligence, AI Act art. 12), and personal data is masked before it is sent. If the firm wants a stricter regime (e.g. privileged matters on a local model only), the administrator can set that. By default nothing blocks you.

---

## 11. Skill library

The **Skill library** is a set of "skills" that Patron applies when refining pleadings:

- **Built-in** (always on): **Reviewer**, **Devil's advocate**, **Write plainly**.
- **Installed** (your own): you enable, disable and import additional stages from a file.

The built-in ones need no configuration. They work in the "Response draft" panel.

---

## 12. FAQ

**The assistant does not answer, or the chat returns an error (especially right after installation).**
The most common cause is no model key. Open **Account → Models and API keys** and add a key (e.g. Libra/Anthropic). The second cause is no internet with a cloud model. Also check in **Account → Models** that the selected model is one you hold a key for.

**Do my case files leave for the cloud?**
Only if you chose a cloud model; then the content of your query goes to that provider. With a local model, everything stays on your computer. Files, the databases and the chat history are always stored locally.

**Patron wrote something that is not in the file.**
Check the badge: 🔴 means unverified. Models can "fill in the blanks". The badge and your own check are the final filter, and Patron does not replace it.

**DOCX/PDF conversion does not work.**
Converting documents needs LibreOffice on the computer. If something is missing, raise it with the firm's administrator.

**How do I export a pleading with comments to Word?**
Ask for the changes as tracked changes (Step 4A), accept the ones you want, and download the DOCX. In Word you will see a review awaiting final acceptance.

**Does Patron check whether a statute is current?**
The databases give quick access to the text, but they can lag behind the Journal of Laws. Verify the current wording in the official source before you draft.

**Does Patron make legal decisions?**
No. The legal assessment, the signature and the professional responsibility are yours.

---

## 13. Cheat sheet: ready-made prompts

**Chat with the case files**
- "List every deadline and contractual penalty in this contract."
- "What inconsistencies are there between document A and document B?"
- "Is there a limitation issue? Point to the dates in the file."

**Case law and legislation**
- "Find Supreme Court judgments on [topic]. Give the case reference numbers."
- "Show Article [X] of the [code]."
- "Check [company name] in the KRS."

**Editing a document (after clicking a DOCX file)**
- "Propose a change to §[X]: [what you want], as tracked changes."
- "Add a clause [description] to §[X]."
- "Redraft §[X]: [new text or aim]."

**Refining a pleading**
- The "Response draft" panel, paste the text, choose the perspective, then "Refine pleading".

---

*Patron is a tool that supports a lawyer's work. Every pleading is checked and signed by Counsel before it is sent. This document reflects the state of the app as of June 2026.*
