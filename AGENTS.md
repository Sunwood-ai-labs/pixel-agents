# Pixel Agents workspace instructions

## Codex presence completion gate

When the requested office is intended to show Codex work, do not treat a healthy server, an empty rendered office, decorative branding, or responsive layout proof as completion.

- Discover current Codex tasks from an authoritative live Codex session surface and route them through the real agent state/runtime path; do not satisfy this with hard-coded demo characters.
- Completion requires at least one Codex-derived character visible in the rendered office.
- Verify both the backing session evidence and a fresh screenshot containing the character before reporting success.
- If no current Codex session can be adopted, report the office integration as incomplete and name the missing discovery or routing evidence plainly.
- Do not make real Codex sub-agents disappear the instant they complete. Keep every workspace-related real sub-agent session from the previous 24 hours visibly marked `Done`, then remove it automatically when it ages out; never retain completed root sessions or inflate occupancy with fabricated agents.
- Preserve Codex lineage from `parent_thread_id`: place children in the same nearby desk island when seats allow, identify each lineage with a stable shared-color pixel frame plus a visible `T1`/`T2` group label, and expose the provider-derived task handle for active agents. Do not draw parent-child connector lines; nested descendants must remain traceable through the shared desk frame and group label.
- Treat each parent/child/grandchild lineage as a physical-section tenant: reserve one section for the lineage, keep its assigned seats and idle wandering paths inside that section, and spread distinct active roots across the least-used seat-capable sections before reusing one. Resolve both `leadAgentId` and native Codex `parentAgentId`; a shared color frame without physical section confinement is not sufficient proof.
- Provider ownership is a hard boundary in the shared store: Claude team discovery/removal must never adopt, dissolve, or delete Codex-owned hierarchy agents, and the same rule applies in reverse.
- Remote-PC integration is telemetry/control-plane only by default: use a dedicated Remote API bearer token, keep the Claude hook token private, make every unauthenticated standalone WebSocket client read-only (including loopback and reverse-proxy connections), and never add arbitrary command execution without a separate signed worker/queue design.

## Viewer-first control chrome

The normal office view is primarily a passive visual monitor, not an operator dashboard.

- Keep normal viewing mode focused on the office scene. Human controls must be collapsed to one quiet, accessible affordance by default and expand only on explicit interaction.
- Use the largest crisp integer zoom that fits the visible office, company sign, and safe control area. Do not preserve large decorative margins through an arbitrary density cap.
- When the user asks to widen, expand, copy, or duplicate existing office sections, preserve the section as the unit of expansion: clone its tiles, walls, colors, furniture, seats, and decorations together. Do not substitute denser seating or moving agents within the original section count. Completion evidence must visibly show the increased number of full sections.
- When copied sections should form one office, connect every adjacent section with a visible walkable opening that matches the existing doorway scale. Verify connectivity with the real tile-map pathfinder as well as a screenshot; visual adjacency alone is not proof that agents can cross the boundary.
- For this office, the user's `2x4` target means four sections across and two rows down (eight total), as explicitly clarified by `横4列、縦2行`. Do not reinterpret it as two columns by four rows. Completion requires a fresh normal-view screenshot where four sections are visibly countable across and two rows are visibly countable down; JSON zone counts or layout tests alone are insufficient.
- Keep manual zoom and layout-authoring controls available in edit mode; rely on automatic fit in normal viewing mode.
- Do not show onboarding or configuration callouts over the standalone viewing surface unless they communicate a current blocking state.
- Before completion, verify a fresh normal-mode screenshot shows the office and live agents without persistent button clusters obscuring the scene.

## Commit and push cadence

- After each requested feature or correction is implemented and verified, create a scoped commit and push it to the active remote branch before reporting completion.
- Stage only files owned by that change. Keep generated evidence, runtime logs, dependency-lock changes, and unrelated user work out of the commit unless they are explicitly part of the request.
- If direct work started on the default branch, create a `codex/` feature branch before the first push unless the user explicitly requests a direct default-branch push.

## Fork and repository rename safety

- For GitHub operations on this fork, never rely on `gh` repository auto-detection because package metadata and the `upstream` remote can cause it to select `pixel-agents-hq/pixel-agents`. Pass the exact `OWNER/REPO` explicitly for every view, edit, API, rename, and Actions query.
- Before a rename or metadata mutation, verify the target owner, repository name, fork parent, default branch, and `origin` URL. Afterward, update `origin` and verify the new repository identity, tracked branch SHA, and `git ls-remote` result before reporting completion.
- Keep the repository identity (`pixel-agents-hub`) separate from the compatible product, extension, configuration namespace, and CLI name (`pixel-agents`) unless the user explicitly requests a breaking product rename.
