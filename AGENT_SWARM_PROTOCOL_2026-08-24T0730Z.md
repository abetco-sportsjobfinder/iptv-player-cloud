# AGENT SWARM PROTOCOL — how to orchestrate multi-agent execution on a task

Proven pattern from live use (PRISM TV build: 1 orchestrator + DeepSeek-V4 external reviewer + sequential implementation agents, 30+ shipped commits).

## 1. Roles

| Role | Who | Job |
|---|---|---|
| **Orchestrator** | the agent the human talks to | decompose task, own file assignments, integrate outputs, enforce verification gates, talk to human |
| **External reviewer** | independent model via API (e.g., DeepSeek-V4 on NVIDIA NIM) | design critique, adversarial review, second opinion. NEVER writes shipped code directly |
| **Worker subagents** | same-family agents (Task tool / CLI instances) | isolated file-scoped implementation under strict contracts |

Rule: **one writer per file.** Orchestrator may edit; workers get exactly one file each; conflicts resolved by orchestrator before merge.

## 2. When to use which

- External model: ideation, IA/design, RCA from symptoms, "audit my X" — tasks where independence beats speed.
- Worker subagents: mechanical/parallel implementation where the spec is already exact.
- Neither: anything touching deploy secrets, human decisions, or refusal-boundary topics (constraints propagate — a jailbroken worker's output still fails your verification gate).

## 3. Task contract (every delegation, external or internal)

```
CONTEXT: measured facts + relevant source excerpts (not whole repos) +
         environment constraints (free tiers, broken tooling, deadlines).
DELIVERABLE: exact format requested (diffs, JSON, <=N words).
ACCEPTANCE: how the orchestrator will verify (syntax check, grep markers,
            curl assertions, unit trace).
CONSTRAINTS: inherited refusals + style rules + forbidden actions.
```

## 4. Verification gates (non-negotiable, in order)

1. Syntax gate before anything ships (`node --check` per file — catches nothing about undefined identifiers, so also:)
2. Identifier audit: grep every new identifier for declaration/import.
3. Deploy gate: CI green or API-deploy 200.
4. Live gate: curl/grep served artifacts for feature markers.
5. Human gate: device-level playback/interaction confirmation.

Tonight's live example: gate 2 would have caught two ReferenceErrors that gate 1 passed.

## 5. Failure handling

- Worker output failing a gate: fix forward yourself if trivial (<2 min), else return to worker with the gate log appended to its context.
- External model hallucinating APIs: verify every claimed identifier exists in the actual source before accepting design.
- Orchestrator context overflow: promote decisions into dated docs (COORDINATION/DOCS_INDEX pattern) so any fresh agent resumes cold.

## 6. Artifact discipline

Every swarm output lands as a dated file (`NAME_YYYY-MM-DDTHHMMZ_slug.ext`), indexed in DOCS_INDEX, referenced in the coordination log. Human can audit the entire swarm trail without reading chat.
