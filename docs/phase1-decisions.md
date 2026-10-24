# 工程裁决（按发生顺序）

逐条保留执行者依据设计和证据作出的裁决及代价。英文原文来自持久化执行账本，避免摘要掩盖改动；它们不构成live授权。

1. Ruling: use this root feature branch in place, protecting the existing user files — user explicitly requests work in this directory, and source Pi is untracked — cost: isolation is branch/commits and baseline archive rather than a second worktree.

2. Ruling: normalize only plan task headings to Task N for skill scripts — original numeric headings cannot be extracted — no implementation scope change.

3. Ruling: keep pi excluded via local Git info/exclude and record a source hash manifest — its .git was removed before this run, so do not claim a freshly verified upstream checkout or alter user source — cost: source provisioning must preserve the manifest.

4. Task 0: Ruling: runtime.local.json provides an explicitly configured local runtime fallback, always verified by native imports/version checks — avoids relying on shell activation; env overrides fail closed.

5. Task 0: Ruling: Pi source JS adapter with typed declarations avoids typechecking unused upstream provider SDKs — no upstream source changes; adapter behavior must be covered by integration tests.

6. Ruling: deadlines kill the Worker and report outcome unknown; no transparent retry — a native operation cannot safely be interrupted in-process — caller must discard candidate, cost: restarting Worker for timed-out reads too.

7. Task 3: Ruling: accept cardinal planar sketch bases with explicit origin, no free rotation/reversed flag in first whitelist — meets limited planar support without topological face references — unsupported orientations must be explicit failures; arbitrary oriented parts remain out of scope.

8. Ruling: candidate success seals its write session; prepare retries with identical criteria return same package — prevents mutation after validation and before commit — cost: subsequent edits require a new candidate/revision.

9. Ruling: SQLite FULL/WAL HEAD/result/event transaction is sole visibility switch; immutable complete file directory is fsynced and renamed first — real SIGKILL tested during stage metadata write, after rename, after DB commit — cost: unreferenced packages are quarantined on restart, not automatically replayed.

10. Ruling: missing/corrupt formal files mark the document corrupt and fail closed; never silently roll HEAD back — lost committed bytes cannot be inferred safely — cost: operator backup restoration is required for true data loss; no power-loss guarantee claimed.

11. Ruling: idempotency fingerprint includes baseRevision plus canonical request content, excluding generated candidate ID — same operation retry must resolve original result, but changed intent must reject — cost: clients must use a fresh operationId for an intentional retry after failure.

12. Ruling: one exclusive Supervisor lease per data directory plus one serialized job queue; each candidate gets a fresh native process — avoids cross-candidate in-memory state and stale responses — cost: ~0.2s startup per job. Only read/verify reconciliation occurs before lease; orphan quarantine occurs after ownership is acquired to avoid racing an active publisher.

13. Ruling: native Worker and verifier share a killable process group; a non-CAD watchdog terminates it if Gateway parent exits; persisted PID start time and command identity protect startup reaping — no task side effects replayed — cost: Linux /proc is part of this local UDS runtime contract.

14. Ruling: successful commit atomically records job outcome with HEAD/result/event in SQLite; cancellation is checked before synchronous commit, after commit returns committed fact — prevents a late success/cancel message rewriting persisted truth — cost: no pause/resume; cancellation requires a new job.

15. Ruling: require a shared bearer access key even on loopback; WebSocket credential travels as subprotocol, never URL query; validate explicit Origin allowlist — avoids an unauthenticated CAD endpoint — cost: local UI needs the locally generated access key; provider keys remain server-only.

16. Ruling: initially replay persisted SQLite events via a bounded local polling hub rather than adding a message broker — single Gateway/Worker needs no new infrastructure — cost: ~40ms notification latency; retention/scale policy remains later work.

17. Task 8: Ruling: completed/interrupted jobs preserve conversation and usage summaries, but no automatic tool-call replay; before each provider request inject latest formal snapshot and reject revision drift — avoids reconstructing stale CAD writes — cost: historical chat is not a replay program; new intent uses current feature/parameter summary.

18. Task 8: Ruling: explicitly enabled fake mode recognizes only documented fixed samples and named edits; same Pi adapter supports injected providers but application never auto-loads personal auth/keys — demonstrates orchestration only, not Text-to-CAD model quality — cost: unsupported/ambiguous fake prompts fail until authorized live provider is configured.

19. Task 8: Ruling: GLB mesh bounds use configured 0.1mm tessellation tolerance plus float allowance, while native dimensions remain 1e-6mm and volume max(1e-6,expected*1e-9) — ring's tessellated extremum differs by 0.0031mm from BRep, reproduced in actual export — cost: preview is approximate, never a geometric manufacturing authority. Added actual binary vertex/index range/finite checks, not just accessor metadata.

20. Task 10: Ruling: property edits submit explicit stable feature.parameter text through the same bounded Pi/candidate/validation job, rather than adding a second geometry/criteria authority in React — follows the existing job API and keeps formal CAS mandatory — cost: current explicit fake supports only documented sample families; arbitrary supported-profile part edits require authorized live-provider qualification. UI labels this boundary and never treats an assistant message as commit.

21. Task 11: Ruling: prepare one explicitly configured Pi openai-completions-compatible evaluation adapter, isolated from product startup, without selecting/authorizing any real provider — satisfies runnable opt-in preparation with a real local protocol test — cost: other protocols require their own adapter/qualification; approved prices and provider billing cap remain external and cannot be inferred from local keys. Pricing template intentionally blank; redirects/retries disallowed; no artifact upload route.

22. Task 11: Ruling: no task-done “Task 11 complete” line until live authorization and real evaluation exist — authorized preparation can complete independently but cannot satisfy the plan's live gate — cost: phase-one product qualification remains open. Offline pass always records modelQualityQualified=false.

23. Task 11: Ruling: keep the plan workspace and local fault-test artifacts until handoff rather than deleting diagnostic evidence mechanically — user requested actual commands/evidence and protection of existing data — cost: local disk retention; it is git-ignored, not production state. Full durable decisions/report are copied to tracked docs before completion.

24. Final: Ruling: Linux kernel flock held by parent fd over a persistent owner inode is authoritative; JSON is atomic fsync/rename diagnostic only — actual same-description child-flock probe and real concurrent/kill tests verify ownership without new daemons — cost: Linux util-linux /usr/bin/flock is now an explicit doctor-verified dependency; local filesystems only, do not remove/replace the inode.

25. Final: Ruling: corrupted historical diagnostic leases fail closed with actionable manual inspection rather than guessing which PID to kill — atomic publication prevents new partial public JSON in tested crash/write windows — cost: historical corruption requires stopping all Gateways and manual recovery; no unattended repair of ambiguous ownership.

26. Final: Ruling: independent eval native process builds a fixed reference body and checks both directed BRep differences; benchmark naming contract is explicit in model-visible input — bbox/volume/name-only checks miss moved holes or falsely reject unannounced IDs — cost: stricter coordinate/naming benchmark and additional native startup per positive attempt, not a general CAD semantic equivalence engine.

27. Final: Ruling: declined live ability/real success rate remains pending — authorization explicitly absent — cost: cannot call phase-one model quality accepted from fake evidence.

28. Final: Ruling: declined hardware GPU, other browsers and desktop platforms remain unqualified — evidence is actual Chrome with software WebGL only — cost: deployment/browser compatibility requires its own qualification.

29. Final: Ruling: declined power-loss, hardware storage faults and network-filesystem guarantees remain unqualified — actual evidence covers process death and software file errors on local FS — cost: production storage certification/backup drills remain outside this result.

30. Final: Ruling: declined public multi-tenant, arbitrary Python/upload execution and STEP editing remain excluded — follows phase-one restricted scope, no exposed route for these — cost: those use cases need later design/testing rather than inference from present tools.

31. Final: Ruling: declined natural-language rejection quality requires human/live review; current negative gate proves no commit/pollution only — failed job cannot by itself prove a helpful refusal — cost: language UX/semantic correctness remains pending.

32. Final: Ruling: finish on the authorized local feature branch without merge/push/PR or another confirmation menu — user requested implementation with no remote publication and no per-task stopping, and supplied no integration authorization — cost: integration remains the user's later choice; all commits and review evidence retained.

## Deferred minors

- Final: minor (deferred): TS schema.properties inherited constructor/toString/__proto__ fields pass TS while Python rejects — final native boundary still prevents mutation; entrance strictness/cross-language consistency remain imperfect. Do not claim those special keys are rejected at the TS entrance; add Object.hasOwn/shared negatives in a later scoped change.
