# Where model ids live in Patron

State on 2026-08-26. Verify with the grep in SKILL.md step 1 - these paths move.

## The four mirrors that must agree

| File | Holds | What breaks if you miss it |
|---|---|---|
| `backend/src/lib/llm/models.ts` | tier constants (`CLAUDE_MAIN_MODELS`, `*_MID_*`, `*_LOW_*`), which feed `ALL_MODELS`; `DEFAULT_MAIN/TITLE/TABULAR_MODEL`; `LEGACY_MODEL_ALIASES` | `resolveModel()` rewrites any id not in `ALL_MODELS` to the fallback - a picker entry missing here is silently swapped for another vendor's model |
| `frontend/src/app/components/assistant/ModelToggle.tsx` | `MODELS[]` (the picker), `ALLOWED_MODEL_IDS`, `DEFAULT_MODEL_ID` | the lawyer's list of choices; also feeds the account settings dropdown (`account/models/page.tsx` imports `MODELS`), so a model missing here has no label there either |
| `backend/src/lib/llm/pricing.ts` | `PRICING` keyed by full id, both native and `openrouter/...` | missing row = `unpriced` = the cost panel shows bare tokens instead of an amount |
| `backend/src/lib/userSettings.ts` | the per-provider low-tier default used for chat titles | a retired id here means title generation calls a model the firm may no longer have access to |

`DEFAULT_MODEL_ID` (frontend) and `DEFAULT_MAIN_MODEL` (backend) are the same value written
twice. Nothing enforces it. Changing one alone means the UI shows one model and the server
runs another.

## Things that need no edit (verified - do not "fix" them)

- `providerForModel()` and `egressForModel()` match on prefixes (`claude`, `gpt-`, `gemini`,
  `openrouter/`, `ollama/`), so a new id in an existing family routes and gets its residency
  flag automatically. `egressForModel` is fail-closed: anything unrecognised is `us-with-dpa`.
- `backend/src/lib/llm/claude.ts` already omits `temperature`. Keep it that way - sampling
  parameters are rejected with a 400 on the Claude 5-series.
- Ollama models never need a price row; `isLocalModel()` short-circuits them to 0.

## Known traps, each one measured

- **`pricingKey()` fallback.** It tries the full id first, then the last segment of an
  OpenRouter slug. The fallback exists for models nobody listed; it cannot rescue a dotted
  slug whose native twin uses dashes. Do not "fix" this by normalising dots to dashes -
  that mangles `gpt-5.5` into `gpt-5-5` and breaks the OpenAI rows that work today.
- **OpenRouter usually returns a real cost** (`usage.cost`), so table errors on that path stay
  hidden until the day it does not. Test the table directly, not through a live call.
- **Opus 5 thinks by default.** On Opus 4.8 omitting `thinking` meant no thinking; on Opus 5
  it runs adaptive anyway, so the "thinking off" path bills more output tokens than it used
  to. Do not switch to `thinking: {type: "disabled"}` to compensate - on Opus 5 that can put a
  tool call into visible text and leak `<thinking>` tags. Lower `output_config.effort` instead.
- **Adding a genuinely new provider is a different job.** It needs an ADR and touches the
  egress registry and the Constitution's vendor-neutrality rule. This skill covers refreshing
  models inside providers Patron already supports.
