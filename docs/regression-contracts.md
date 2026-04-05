# Regression Contracts

This document defines deterministic contracts that protect user-critical behavior from unrelated edits.

## Phase 1 Coverage

| Flow | Contract | Owner Tests | Failure Meaning |
| --- | --- | --- | --- |
| Video export framing/aspect | Export geometry must produce `1080x1920`, and scaling must stay aspect-consistent (no stretch). | `tests/core/creator/export-contracts.test.ts`, `tests/core/creator/export-geometry.test.ts` | Export math drifted, and generated video can look stretched or misframed. |
| Clip trim/clamp | Export clip must remain bounded by source media and maintain valid duration constraints. | `tests/core/creator/clip-windowing.test.ts`, `tests/core/creator/export-prep.test.ts`, `tests/core/creator/clip-editing.test.ts` | Editor/export can request invalid clip windows or produce unstable trim state. |
| Subtitle windowing | Subtitle chunks used for export must overlap selected clip window deterministically. | `tests/core/creator/clip-windowing.test.ts`, `tests/core/creator/export-prep.test.ts` | Burned subtitle timing no longer matches exported clip range. |
| Short lifecycle | Save/edit/export transitions must preserve record identity, timestamps, and status semantics. | `tests/core/creator/short-lifecycle.test.ts` | Stored short project/export records can regress or become inconsistent. |
| Creator AI runtime traces | Every run/eval must preserve provider, model, prompt version, usage, and estimated cost metadata when inferible. | `tests/core/creator/creator-llm-run.test.ts`, `tests/core/creator/creator-ai-evals.test.ts`, `tests/core/creator/llm-runs-workbench.test.ts` | Provider migrations become opaque, model selections drift silently, or AI evals lose auditability. |
| Creator AI feature config | Feature defaults, legacy env fallbacks, and model catalog fallback behavior must remain deterministic. | `tests/core/creator/creator-feature-config.test.ts`, `tests/core/creator/user-ai-settings.test.ts` | A provider/model change can break unrelated features, hide defaults, or strand saved selections. |
| Transcript history updates | Updating one transcript should not mutate unrelated project/transcript records. | `tests/core/transcriber/history-updates.test.ts` | Cross-project collateral mutations were introduced. |
| Progress upsert behavior | Progress items replace by file key and preserve unrelated entries. | `tests/core/transcriber/progress.test.ts` | Progress UI can regress with duplicate/missing updates. |

## Runtime Guardrail

`src/lib/creator/local-render.ts` validates export geometry contracts before invoking FFmpeg:

- If invariants fail, export aborts early with structured diagnostics.
- If invariants pass, summary metrics are persisted in export debug notes.

## Gate Scripts

- `npm run test:contracts`: deterministic contract suite.
- `npm run check:quick`: changed-file eslint + type-check + contract suite.
- `npm run check:strict`: strict creator regression gate for PR pipelines (CI-agnostic).

## Deferred to Phase 2

- Browser visual regression checks (Playwright screenshots/video parity assertions) are intentionally deferred.
