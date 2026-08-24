# Patron: a tutorial for Counsel (US edition)

**Step by step, from first launch to a finished draft.**
Matches the July 2026 installer. You do not need any technical background. If you can work with documents in Word, you can use Patron.

---

## Table of contents

1. [What Patron is (in one paragraph)](#1-what-patron-is)
2. [First launch](#2-first-launch)
3. [Screen map: three panels](#3-screen-map)
4. [Step 1: Create a matter and upload the files](#4-step-1-create-a-matter-and-upload-the-files)
5. [Step 2: Chat with the case files](#5-step-2-chat-with-the-case-files)
6. [Step 3: Federal law and case law](#6-step-3-federal-law-and-case-law)
7. [Step 4: Working with documents and EDITING them](#7-step-4-editing-documents)
8. [Step 5: A table from a batch of contracts (Tabular review)](#8-step-5-a-table-from-contracts)
9. [Step 6: Workflows (repeatable tasks)](#9-step-6-workflows)
10. [Step 7: Choosing an AI model](#10-step-7-choosing-a-model)
11. [Skill library](#11-skill-library)
12. [Common questions and problems](#12-faq)
13. [Cheat sheet: ready-made prompts](#13-cheat-sheet)

---

## 1. What Patron is

Patron is your legal assistant installed **on your own computer** (a desktop app, like Word). You upload the matter files (contracts, pleadings, correspondence, scans) and it:

- **reads them for you** and answers your questions, citing sources from your own documents,
- **searches US federal law and case law** (Congress.gov, GovInfo, the Federal Register, eCFR, and CourtListener) through a bundled connector,
- **proposes changes to documents** as tracked changes (Word's track-changes), which you accept with a single click,
- **refines your drafts** (review, devil's advocate, language editing).

Patron does not make legal decisions and does not replace your judgment. It is a tool: faster reading of the file, and a first draft that you check in any case.

---

## 2. First launch

1. Start **PATRON** (the desktop icon or the Start menu). You will see a loading screen, then, after a dozen or so seconds, the main window. No account or sign-in is needed. Patron is single-user and local, so the matter files, the databases, and the chat history stay on your computer.
2. **Add an AI model key.** This is the one step without which the assistant will not answer. Open **Account → Models and API keys** and paste the key from your provider (for example Libra/Anthropic, or Gemini/OpenAI). Save it. From that moment chat, document editing, and tables all work. Details: [Step 7](#10-step-7-choosing-a-model).
3. **Internet and file conversion.** A cloud model and live legal search (Congress.gov, GovInfo, the Federal Register, eCFR, CourtListener) need an internet connection. Search across your own documents also works offline. If you see a conversion error when uploading older `.doc` files, ask your administrator to install LibreOffice (it is free).

> **Tip:** Patron addresses you as "Counsel". Not sure where to start? Ask it directly in the chat: **"What can you do?"** or **"How do I start?"**, and it will walk you through its features step by step. If you cannot see something, expand the left panel (**Explorer**).

---

## 3. Screen map

The assistant screen is split into **three vertical panels**:

| Panel | Name | What it is for |
|---|---|---|
| **left** | **Explorer** | the list of matters (projects) and documents; this is where you upload files |
| **middle** | **Document viewer** | the content of the document you clicked; this is where tracked changes appear |
| **right** | **Assistant** | the chat, where you ask questions and give instructions |

You can collapse the left panel ("Collapse explorer") and expand it again when you need room for the viewer.

---

## 4. Step 1: Create a matter and upload the files

**Rule 1: one matter = one project.** Do not mix files from different matters. Patron searches every document in the project for each question you ask.

### 4.1. Create a project
1. In the left panel, click **+ New project** (or "New matter", shortcut **Ctrl+N**).
2. Give it a descriptive name, e.g. `Doe v. Acme Corp, 2026`, and fill in the **Case ref.** - it appears later as its own column in the matter list.

### 4.2. Upload documents: three ways

- **Drag and drop:** select the files or folder in Windows Explorer and drop them onto the panel (you will see "Drop to upload").
- **Upload documents:** the button in the left panel, then choose files (PDF, DOCX, DOC).
- **Import the matter folder** (the fastest option with many files): give the path to the directory, e.g. `C:\Matters\Doe-2026`. Patron will pull in all the files at once, scan them for security, and index them.

What happens under the hood (you do not have to do anything): Patron recognises the document's editorial structure (sections, paragraphs, exhibits), runs OCR on scans, and the full text goes into search. Paper scans and files with no text layer will work too.

> **Rule 2: upload ALL the matter files before your first question.** The fuller the file, the more accurate the answers. Documents added later will not retroactively change earlier answers.

---

## 5. Step 2: Chat with the case files

In the right panel (**Assistant**), type your question and send it. Patron picks the most relevant passages from the whole file itself (you do not need to paste any text).

**Ask specific questions.** Instead of "what is in the contract", write:
- "What obligations does the vendor have under Section 5 of this agreement?"
- "List every payment deadline and liquidated-damages clause in this contract."
- "Is there a statute-of-limitations issue? Point to the dates in the file."
- "What are the inconsistencies between the master agreement and Exhibit B?"

### Read the colour badge next to citations
Every citation from your documents gets a reliability marker:

- 🟢 **green:** a verbatim citation, found in your matter files. You can use it in a filing with the source given.
- 🟡 **yellow:** a possible reworking or paraphrase. Check it against the original.
- 🔴 **red:** not found in the file. **Do not cite it without checking by hand.** It may be wording that only sounds like a citation.

> **Rule 3: before you paste a citation into a filing, look at the badge.** It is your anti-hallucination filter.

---

## 6. Step 3: Federal law and case law

The US edition of Patron comes with **one bundled connector for US federal law and case law** (works right after installation, no setup):

| Source | What you will find |
|---|---|
| **Congress.gov** | the federal legislative process - bills as they move through committees and floor votes (not enacted law) |
| **GovInfo** | enacted federal law as published packages - the US Code, Statutes at Large, CFR annual editions, Federal Register issues |
| **Federal Register** | full-text search over federal-register documents, including executive orders and other presidential documents |
| **eCFR** | the CURRENT Code of Federal Regulations, section by section, with amendment history |
| **CourtListener** | full-text case-law search - its main strength here is STATE case law (California, New York, Texas, and others); it is not a comprehensive federal case-law index |

Everything else is **not** bundled in this edition. EU law and connectors for other jurisdictions (including the Polish ones: SAOS, NSA, ISAP, KRS) are downloaded separately from the **MateMatic Boutique** (matematicsolutions.com/boutique) and connected to the app. Once installed, you turn them on in **Account → Connectors**.

Ask in plain language, and Patron will reach for the right tool itself:

- "Find the current text of 15 CFR § 744.3."
- "Search Federal Register documents on export controls from the last year."
- "Look up California Supreme Court case law on trade secrets."
- "What is the status of H.R. 1, 118th Congress?"

> **Remember:** this connector does not cover all-50-states legislation (only federal statutes and regulations), and CourtListener's coverage of federal case law specifically is thin - it is strongest for state courts. Before you cite a provision or a case in a filing, verify the current text and the citation in the official source, because both law and its status can change.

---

## 7. Step 4: Editing documents

This is the heart of the daily work. Patron edits documents in three ways. All of them end in a file you open in Word.

### 7A. Ask for a change, review the tracked changes, accept

This is the most convenient mode for individual fixes in a contract or filing.

1. In the Explorer, **click a DOCX document**. It appears in the middle panel (**Document viewer**).
2. In the Assistant, write what you want, **naming the place**:
   - "Propose a change to Section 4. I want to limit the contractor's liability to direct damages, excluding consequential damages."
   - "Add a forum-selection clause to Section 3 designating the courts of Delaware."
   - "Redraft Section 7 so the notice period is 90 days, effective at the end of the month."
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

### 7B. Refine a whole draft: "Response draft" (review, devil's advocate, language)

This is the mode for a whole brief or motion, or a longer passage you want to strengthen.

1. Open the **Response draft** panel (the ✨ icon under the assistant's reply, or from the menu).
2. In the **Draft text** field, paste your working text.
3. Choose the perspective for the devil's advocate (**"from whose perspective"**):
   - **Opposing counsel:** how the other side will attack it,
   - **The court:** what the bench will ask about,
   - **Regulator:** the enforcement angle.
4. Click **Refine draft**. Patron runs the text through three stages:
   - **Reviewer:** flags gaps in logic and weak authorities, and strengthens the argument,
   - **Devil's advocate:** anticipates and rebuts counter-arguments from the chosen perspective,
   - **Write plainly:** removes the "AI style" while keeping legal precision.
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

When you have **many similar documents** (e.g. 30 vendor agreements) and want to compare them in a table, use **Tabular review**.

1. Go to **Tabular reviews → + Create new**.
2. Add columns, either from the ready legal presets (Parties, Subject matter, Liquidated damages, Governing law, Notice period…) or your own, e.g. "Arbitration clause: yes/no".
3. Click **Generate**. The table fills in as it streams: Patron searches each document and enters the result.
4. Each cell has a reliability badge (🟢/🟡/🔴). 🔴 means check by hand; click the cell to see the source.
5. Export to Excel for the client or the team.

> The point: you review a batch of contracts in one pass instead of opening them one by one, and every cell points back to its source.

---

## 9. Step 6: Workflows

Save a repeatable task (e.g. "Vendor agreement review", "Due diligence review") once as a **workflow** and run it on new matters with a single click.

- Start with the built-in workflows.
- Your own: **Workflows → New**, type the instructions step by step, then save.
- You can share a workflow with colleagues, so the whole firm runs due diligence off the same checklist.

---

## 10. Step 7: Choosing a model

Patron is **vendor-neutral**, so you choose the model. There are **two** settings in **Account → Models and API keys**: the model for the conversation and a separate **Tabular review model**. Tables usually get a cheaper model - there is a lot of work and every field is short. Changing either does not require a reinstall.

- **A cloud model (e.g. Libra / Claude, Gemini)** gives the strongest editing and reasoning. This is the ordinary working choice for a firm. The content of your query then goes to the provider you chose.
- **A local model (Ollama)** works without internet, at zero cost. It needs a one-off install of Ollama and downloading the model to your computer.

You can mix them: a cheaper or local model to explore the file, a stronger one for the final draft. You can check usage and costs in **Account → Usage** (with a filter by matter).

**Privileged matters and the cloud.** In the desktop version, you, the attorney on your own machine, are the host of the data, so your choice of a cloud model is informed consent. Patron lets you work with any model, including on matters marked as privileged. **Every** flow of data to the model is recorded in an immutable audit log, and personal data is masked before it is sent. If the firm wants a stricter regime (e.g. privileged matters on a local model only), the administrator can set that. By default nothing blocks you.

Patron itself is built around the EU/Polish GDPR-oriented governance model documented in its constitution (self-hosted, audit-first, human-in-the-loop) - it does not claim any US-specific privacy certification, because there is no single US federal equivalent to point to. That governance model is a reasonable baseline for confidentiality even when used from a US practice; it is not a substitute for your own conflicts and confidentiality review under your state's rules of professional conduct.

---

## 11. Skill library

The **Skill library** is a set of "skills" that Patron applies when refining drafts:

- **Built-in** (always on): **Reviewer**, **Devil's advocate**, **Write plainly**.
- **Installed** (your own): you enable, disable, and import additional stages from a file.

The built-in ones need no configuration. They work in the "Response draft" panel.

---

## 12. FAQ

**The assistant does not answer, or the chat returns an error (especially right after installation).**
The most common cause is no model key. Open **Account → Models and API keys** and add a key (e.g. Libra/Anthropic). The second cause is no internet with a cloud model. Also check in **Account → Models** that the selected model is one you hold a key for.

**Do my matter files leave for the cloud?**
Only if you chose a cloud model; then the content of your query goes to that provider. With a local model, everything stays on your computer. Files, the databases, and the chat history are always stored locally.

**Patron wrote something that is not in the file.**
Check the badge: 🔴 means unverified. Models can "fill in the blanks". The badge and your own check are the final filter, and Patron does not replace it.

**DOCX/PDF conversion does not work.**
Converting documents needs LibreOffice on the computer. If something is missing, raise it with the firm's administrator.

**How do I export a draft with comments to Word?**
Ask for the changes as tracked changes (Step 4A), accept the ones you want, and download the DOCX. In Word you will see a review awaiting final acceptance.

**Does Patron check whether a statute or regulation is current?**
The bundled connector gives quick access to federal text (US Code, CFR, Federal Register), but it can lag or the underlying source can be amended. Verify the current wording in the official source before you draft. Patron also does not carry state legislation - if your matter turns on a state statute, you will need a separate source for it.

**Does Patron cover state law?**
Only indirectly, through CourtListener case law search, which is strongest for state courts. It does not carry the statutes of any individual state's legislature. Federal law (US Code, CFR, Federal Register, Congress.gov bills) is the bundled connector's core coverage.

**Does Patron make legal decisions?**
No. The legal assessment, the signature, and the professional responsibility are yours.

---

## 13. Cheat sheet: ready-made prompts

**Chat with the matter files**
- "List every deadline and liquidated-damages clause in this contract."
- "What inconsistencies are there between document A and document B?"
- "Is there a statute-of-limitations issue? Point to the dates in the file."

**Federal law and case law**
- "Find the current text of [title] U.S.C. § [section]."
- "Search the Federal Register for documents on [topic]."
- "Look up [state] case law on [topic]."
- "What is the status of [bill number], [congress]th Congress?"

**Editing a document (after clicking a DOCX file)**
- "Propose a change to Section [X]: [what you want], as tracked changes."
- "Add a clause [description] to Section [X]."
- "Redraft Section [X]: [new text or aim]."

**Refining a draft**
- The "Response draft" panel: paste the text, choose the perspective, then "Refine draft".

---

*Patron is a tool that supports an attorney's work. Every filing is checked and signed by Counsel before it is sent. This document reflects the state of the app as of July 2026.*
