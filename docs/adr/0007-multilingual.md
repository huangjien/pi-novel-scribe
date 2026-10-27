# ADR-0007: Multilingual support — en + zh

**Status:** Accepted
**Date:** 2026-09-14
**Authors:** pi-novel-scribe (Phase 9, scoped by user request)
**Decisions:** Q17 (Wiki path config, retrofitted), Q19 (i18n scope), Q20 (override chain)

## Context

The pi-novel-scribe extension shipped v0.1 with English-only surface:
- Tool descriptions, `promptSnippet`, `promptGuidelines`, and tool `label` are English.
- Agent prompt templates (`prompts/director.md`, `writer.md`, …) are English-only.
- No `language` field on chapter frontmatter.
- No `language` key in `.pi/settings.json`.
- No way for the author to tell the Writer "draft this chapter in Chinese."
- The wiki tool surfaces `language` per candidate but doesn't filter or hint the LLM.
- `findNextChapter`, `composeSceneContext`, `composePlanRequest`, `composeCriticContext` don't carry language.

User asked for a "big feature" that goes beyond display:
> "not only display Chinese, but also using Chinese prompt/scenes/character etc."

Concretely: Chinese characters should be able to _write a novel in Chinese_ end-to-end — author types in Chinese, the LLM drafts Chinese prose, the critic reviews in Chinese, the UI messages are in Chinese, and the wiki surfaces Chinese archetypes.

## Decision

### 1. Scope: full i18n surface

Per user pick. v0.2 covers:
- `language` field on chapter frontmatter
- `language` key in `.pi/settings.json`
- `/novel write --lang=zh` per-command override
- Localized tool descriptions / promptSnippet / promptGuidelines / label / error messages
- Localized agent prompt templates (`prompts/zh/*.md`)
- Localized status enum display (`已起草` ↔ `drafted`; **keys stay English** for machine-readability)
- `wiki_search` filters candidates by language, hints the LLM during rerank
- Auto-detect language from prose content on chapter write

### 2. Languages: en + zh, hardcoded

Per user pick. A `Language` type union (`"en" | "zh"`). Anything else throws.
Future extension (v0.3+) can swap the union for a registry. No registry now.

### 3. Override chain (single resolution path)

```
command flag → chapter frontmatter → settings.json → auto-detect → fallback ("en")
```

- The command flag `/novel write --lang=zh` always wins.
- Per-chapter `language: zh` in frontmatter overrides settings (lets authors write mixed-language novels).
- Settings.json `language: zh` is the project default.
- If none of the above is set, sample the chapter body or the existing frontmatter content; if the CJK character ratio > 30%, default to `zh`; otherwise `en`.
- Final fallback: `en` (canonical, machine-friendly).

### 4. Canonical keys stay English

The 10-status enum keeps its English keys in frontmatter and in code:

```yaml
status: drafted # NOT 已起草
```

The **display** name is localized (`已起草` in zh, `Drafted` in en). Code that reads `frontmatter.status` continues to work unchanged. A `STATUS_DISPLAY` lookup table provides localized labels for tool output messages.

### 5. New module: `extensions/i18n/`

```
extensions/i18n/
  language.ts          # Language type, validate, normalize, isCjk
  resolve.ts           # resolveLanguage(ctx, opts): Language
  detect.ts            # detectLanguage(text): Language | null  (CJK ratio heuristic)
  strings/
    en.ts              # UI strings (tool descriptions, snippet, guidelines, status names, errors)
    zh.ts              # ditto, in Chinese
  index.ts             # public surface
```

Public API:

```ts
type Language = "en" | "zh"

function resolveLanguage(
	ctx: ExtensionContext,
	opts?: { chapterPath?: string; flag?: Language },
): Language

function detectLanguage(text: string): Language | null // null = can't decide

interface ToolStrings {
	readonly description: string
	readonly promptSnippet: string
	readonly promptGuidelines: readonly string[]
	readonly label: string
}

function toolStrings(lang: Language, toolName: string): ToolStrings
function statusDisplay(lang: Language, status: WorkflowStatus): string
function errorMessage(lang: Language, key: string, vars?: Record<string, string>): string
```

### 6. Per-language agent prompts

`prompts/<lang>/<agent>.md` mirrors the English `prompts/<agent>.md`. The agent loads the localized template at execute time:

```
prompts/
  director.md       # en
  planner.md        # en
  writer.md         # en
  critic.md         # en
  continuity.md     # en
  zh/
    director.md     # zh
    planner.md      # zh
    writer.md       # zh
    critic.md       # zh
    continuity.md   # zh
```

Falls back to `prompts/<agent>.md` (English) if the localized file is missing — never silently miss.

### 7. Context packets carry language

`composeSceneContext`, `composePlanRequest`, `composeCriticContext` each add `language: Language` to their output. The Writer/Critic/Planner inject `"Working language: <lang>"` near the top of the LLM prompt.

### 8. Wiki search

`searchWiki(ctx, query, { language, ... })`:
- If `language` is set: prefer candidates whose row `language === language`. Fall back to the other language if there are fewer than 5 matching candidates.
- The rerank prompt is augmented with a line `"Working language: <lang>"` and a hint that candidates from the other language are reference material, not primary matches.
- The `language` parameter is optional and defaults to the resolved project language.

### 9. Auto-detect heuristic

`detectLanguage(text)`:
1. Count CJK code points (U+4E00–U+9FFF, U+3400–U+4DBF).
2. Count total letters (regex `\p{L}`).
3. If `cjk / (cjk + letters) > 0.30`, return `"zh"`.
4. If `cjk / (cjk + letters) > 0` and `<= 0.30`, return `null` (mixed — let the user pick).
5. Otherwise return `"en"`.

`null` is treated as "no signal" — caller falls through to the next override in the chain.

### 10. Where language is **not** applied

- Frontmatter status keys stay English (machine canonical).
- The novel repo's filename scheme stays English (`0001.md`).
- Internal pi tool names stay English (`delegate_to_writer`, `wiki_search`).
- CLI flag style (`--lang=zh`) follows git-style convention.

## Consequences

**Positive**
- A Chinese author can `/novel write --lang=zh` and get a fully-localized writing flow end-to-end.
- Mixed-language novels (e.g., a Chinese novel with English titles) work via per-chapter `language` frontmatter override.
- Wiki search surfaces both Chinese and English archetypes; the LLM picks the best fit per chapter language.

**Negative**
- Doubles the size of agent prompt templates (we ship both `prompts/*.md` and `prompts/zh/*.md`).
- Tool registration grows an i18n lookup per tool; ~6 call sites updated.
- New failure mode: a chapter in a third language (Japanese, Korean, etc.) gets `_en_` defaults. Document this clearly.

**Costs**
- ~5 prompt files to author in Chinese (~3 hours of translation work).
- ~6 source files updated, ~4 new source files added.
- ~10 new tests.

## Alternatives considered

- **Locale-coded wiki DB**: store one DB per language instead of one mixed DB. Rejected — over-engineered for v0.2; the row-level `language` column already supports filtering.
- **Translated frontmatter keys**: e.g., `状态: 已起草` in Chinese chapter frontmatter. Rejected — kills canonical machine-readability; ruins round-trip with English-only tooling.
- **Skill-based language switch**: declare a `zh` skill that swaps prompts at runtime. Rejected — skills are content, not config; confuses the per-language loader concept.

## Test plan

- `tests/i18n.test.ts`:
  - `resolveLanguage`: command flag wins > frontmatter > settings > auto-detect > fallback
  - `detectLanguage`: pure-CJK returns zh; pure-latin returns en; mixed returns null
  - `toolStrings`: returns the correct strings for en and zh for every tool
  - `statusDisplay`: returns the correct localized status name
- `tests/context-i18n.test.ts`:
  - All three context packets include `language: Language` and surface it in their JSON payload
- `tests/writer-i18n.test.ts` (extend `tool-writer.test.ts`):
  - Writer loads `prompts/zh/writer.md` when language is zh; falls back to en otherwise
  - The LLM prompt contains `Working language: zh`
- `tests/wiki-language.test.ts`:
  - `wiki_search` filters candidates by language; mixed-language result falls back gracefully
