# Where each price comes from

Four catalogs, because the row's `source` has to match the path that is billed.
All are public pages with no client data in the request.

## First-party (the "own key" path)

| Vendor | URL | Ask the fetch for |
|---|---|---|
| Anthropic | `https://platform.claude.com/docs/en/about-claude/models/overview.md` | every current model's API id, context window, input/output price per MTok. The `.md` suffix matters; the pricing page 404s without it. Legacy tiers are linked but no longer priced here - take those from the OpenRouter mirror. |
| Google | `https://ai.google.dev/gemini-api/docs/pricing` | paid-tier input/output per 1M for each Gemini tier, **plus any promotional footnote and its end date**. Ask about the footnote explicitly - Gemini 3.7 Flash's $0.75/$3.75 is promotional and doubles on 2027-01-01. |
| OpenAI | `https://developers.openai.com/api/docs/pricing` | input/output per 1M for the current GPT family. `platform.openai.com/docs/pricing` 301s here. Also fetch the models page to learn what the names mean - the 5.6 family is named sol / terra / luna, not by size. |

Watch for context-tiered pricing: Gemini Pro is priced for prompts <= 200k (higher above),
gpt-5.5 for context < 272k. Patron feeds long documents, so note the tier in a comment.

## OpenRouter (the "one Operator key" path)

`https://openrouter.ai/api/v1/models` - public JSON, no key. Use the bundled script; it
caches the catalog so the whole refresh costs one request.

Prices are per token: multiply by 1e6 for per-MTok. Ignore `:batch` and `-fast` variants -
Patron uses neither. This catalog is also the only reliable source for **exact slugs**;
a guessed slug reaches the lawyer as a mute "Stream error", which is a real pilot bug this
repo already hit once.

## Sanity checks worth doing

- Compare each first-party rate against its OpenRouter mirror. They usually match exactly.
  When they do not, that is a finding worth telling the user about (it may mean a route is
  half price), not a number to reconcile away.
- If a newer model is *cheaper* than the one it replaces, double-check you read the right
  row - but do not disbelieve it. Measured 2026-08-26: Sonnet 5 at $2/$10 vs Sonnet 4.6 at
  $3/$15, and gpt-5.6-luna at $0.20/$1.20 vs gpt-5.4-mini at $0.75/$4.50.
