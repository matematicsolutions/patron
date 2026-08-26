---
name: upgrade-llm-models
description: Step-by-step workflow for upgrading which LLM models Patron offers and what they cost - refresh the picker, the tier constants and the PRICING table from live vendor catalogs, retire superseded models without breaking saved choices, and verify. Use this skill whenever the user wants to add, remove, swap or re-price a model; asks whether the model list or the cost table is still current; mentions a newly released Claude / Gemini / GPT / OpenRouter / Ollama model; says a model is missing from the picker; reports that the usage panel shows no amount, "unpriced", or a cost that looks wrong; or edits backend/src/lib/llm/models.ts, backend/src/lib/llm/pricing.ts or ModelToggle.tsx. Also use it before a release when nobody has checked the catalogs in a while, or when a lawyer asks "why are we paying for the old model".
---

# Upgrading models and pricing

Patron lets the firm bring its own model, and it shows the lawyer what each call cost.
Both of those are backed by **hand-maintained lists** - there is no call to any vendor's
models endpoint at runtime. That is a deliberate choice (a picker that changes under the
user is worse than one that lags), but it means the lists go stale silently: nothing
fails, the firm just quietly pays more for a weaker model, or sees no cost at all.

This skill is the routine for refreshing them. It takes 20 minutes and it is mostly
reading catalogs, not writing code.

## Rule zero: never write a model id or a price from memory

Model ids and prices change faster than any training data, and both fail silently when
wrong - a bad id gives the lawyer a mute "Stream error", a bad price gives a confident
wrong number in a cost panel that a firm may bill against. Every id and every rate in
the diff must come from a catalog you fetched **in this session**.

For Anthropic specifics (model ids, removed parameters, thinking defaults), load the
`claude-api` skill rather than recalling them - it is the authority in this environment.

## Step 1 - find the mirrors before touching anything

Model ids live in several files, and a partial edit is worse than none: the picker can
offer a model the backend then silently rewrites to something else. Locate them fresh
rather than trusting this list, because files move:

```bash
grep -rnE '"(claude|gemini|gpt|openrouter/|ollama/)[a-z0-9.\-]+' --include="*.ts" --include="*.tsx" backend/src frontend/src | grep -v "\.test\." | cut -d: -f1 | sort | uniq -c | sort -rn
```

`references/patron-mirrors.md` lists what each mirror is for and what breaks when it is
missed. Read it before the first edit.

## Step 2 - pull the live catalogs

Four sources, one per billing path. The bundled script does the OpenRouter half (it is
the one that needs `jq` gymnastics) and caches the catalog so you fetch once:

```bash
.claude/skills/upgrade-llm-models/scripts/catalog-prices.sh anthropic
.claude/skills/upgrade-llm-models/scripts/catalog-prices.sh google
.claude/skills/upgrade-llm-models/scripts/catalog-prices.sh openai
```

First-party pages (WebFetch), for the models the firm reaches with its own key -
URLs and what to ask for are in `references/catalog-sources.md`.

## Step 3 - decide, with the price in hand

Put the pinned model and the newest one in its tier side by side and apply this:

| Situation | Do |
|---|---|
| Newer, same or lower price | Replace. Retire the old one (step 5). This is the easy case and it happens often. |
| Newer, **higher** price | Additive - offer both, keep the cheaper one as default, and say so. Not your call to spend the firm's money. |
| No newer model in that tier | Change nothing, and say that explicitly. "Already current" is a real answer. |
| Newer, but a governance blocker | Do not ship it. Write the reason in a comment next to where it would have gone. |

A governance blocker is anything that collides with the Constitution or professional
secrecy - the recurring one is **a model that cannot run under zero data retention**
(it 400s for an org configured that way, and ZDR is what a firm under Bar Act art. 6
would be running). Vendor neutrality also applies: refreshing every vendor in the same
pass is part of the job, not a bonus. If you only checked one, say which ones you did not.

## Step 4 - price per billing path, not per model

The cost table is consulted **only when the provider did not return a real cost**, which
in practice means the own-key path. So the rate has to be the rate that path is billed at:

- native id (`claude-opus-5`, `gpt-5.6-sol`) -> that vendor's own price list
- `openrouter/vendor/model` -> the OpenRouter catalog

Key every row by the **full id**. Two traps make this non-optional:

- **Dots vs dashes.** OpenRouter slugs use dots (`anthropic/claude-opus-4.8`) where native
  ids use dashes (`claude-opus-4-8`). A last-segment match never lands, and the model
  falls through as `unpriced` while looking fine.
- **The paths genuinely diverge.** Measured 2026-08-26: OpenRouter sold `gpt-5.6-sol` at
  $2/$10 while OpenAI's own list said $4/$20. Record both and comment that the gap is real,
  or someone will "fix" one to match the other.

Every rate carries `source` + `asOf`. If a price is promotional or has a scheduled change,
put the date in a comment - `asOf` says when you looked, not that a rise is already booked
(Gemini 3.7 Flash: $0.75/$3.75 through 2026-12-31, doubling 2027-01-01).

## Step 5 - retire without breaking anyone

Two things must happen when a model leaves the picker, or you cause silent damage:

1. **Alias the retired id to its successor.** `resolveModel()` falls back to the default for
   ids it does not recognise, so a lawyer whose saved `tabular_model` is the retired model
   would land on a different vendor entirely without being told. Map by role
   (flagship -> flagship, budget -> budget), and cover both the native and `openrouter/` spellings.
2. **Keep its row in `PRICING`.** The usage panel prices historical `llm_route` events, and
   old chats still carry the old id. Deleting the row turns past costs into "unpriced".
   Mark the row legacy in a comment so nobody tidies it away.

## Step 6 - sync every mirror, then verify

Backend tiers, the picker, the pricing table, and the default-model id on **both** sides
must agree. Then, from the repo root:

```bash
npm test --prefix backend  && (cd backend  && npx tsc --noEmit)
npm test --prefix frontend && (cd frontend && npx tsc --noEmit)
```

Expect a test to fail if it used a now-retired id as its example of a valid model. Fix the
test's *intent* - swap in a current id and leave a pointer to the alias tests - rather than
weakening the assertion. Add a row-coverage test for anything new so the next person
cannot add a model without a price.

If `node_modules` was missing and you ran `npm install`, check `git status` and restore any
`package-lock.json` you did not mean to change.

## Step 7 - report what moved, and what did not

Give the price delta per change, flag anything with a scheduled increase, name the models
you deliberately left alone and why, and state the test counts before and after. The value
of this work is the firm knowing what it now pays - a diff alone does not tell them that.

## References

- `references/patron-mirrors.md` - every file that holds a model id, what it is for, what breaks if missed
- `references/catalog-sources.md` - where each price comes from and what to ask a fetch for
- `scripts/catalog-prices.sh` - OpenRouter catalog -> per-Mtok prices for one vendor
