# Pixel Agents workspace instructions

## Codex presence completion gate

When the requested office is intended to show Codex work, do not treat a healthy server, an empty rendered office, decorative branding, or responsive layout proof as completion.

- Discover current Codex tasks from an authoritative live Codex session surface and route them through the real agent state/runtime path; do not satisfy this with hard-coded demo characters.
- Completion requires at least one Codex-derived character visible in the rendered office.
- Verify both the backing session evidence and a fresh screenshot containing the character before reporting success.
- If no current Codex session can be adopted, report the office integration as incomplete and name the missing discovery or routing evidence plainly.
- Do not make real Codex sub-agents disappear the instant they complete. Keep every workspace-related real sub-agent session from the previous 24 hours visibly marked `Done`, then remove it automatically when it ages out; never retain completed root sessions or inflate occupancy with fabricated agents.
- Preserve Codex lineage from `parent_thread_id`: place children near their visible parent when seats allow, draw restrained parent-child connectors, and expose the provider-derived task handle for active agents. Nested descendants must remain independently traceable rather than appearing as an unrelated crowd.
- Provider ownership is a hard boundary in the shared store: Claude team discovery/removal must never adopt, dissolve, or delete Codex-owned hierarchy agents, and the same rule applies in reverse.

## Viewer-first control chrome

The normal office view is primarily a passive visual monitor, not an operator dashboard.

- Keep normal viewing mode focused on the office scene. Human controls must be collapsed to one quiet, accessible affordance by default and expand only on explicit interaction.
- Use the largest crisp integer zoom that fits the visible office, company sign, and safe control area. Do not preserve large decorative margins through an arbitrary density cap.
- Keep manual zoom and layout-authoring controls available in edit mode; rely on automatic fit in normal viewing mode.
- Do not show onboarding or configuration callouts over the standalone viewing surface unless they communicate a current blocking state.
- Before completion, verify a fresh normal-mode screenshot shows the office and live agents without persistent button clusters obscuring the scene.

## Commit and push cadence

- After each requested feature or correction is implemented and verified, create a scoped commit and push it to the active remote branch before reporting completion.
- Stage only files owned by that change. Keep generated evidence, runtime logs, dependency-lock changes, and unrelated user work out of the commit unless they are explicitly part of the request.
- If direct work started on the default branch, create a `codex/` feature branch before the first push unless the user explicitly requests a direct default-branch push.
