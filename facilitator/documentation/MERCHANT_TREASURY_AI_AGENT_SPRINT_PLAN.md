# RailBridge Merchant Treasury OS — AI-Agent Sprint Delivery Plan

For hackathon demo-first delivery, use `MERCHANT_TREASURY_MVP_V1_DEMO_PLAN.md` with `MERCHANT_TREASURY_MVP_V1_DEMO_SPEC.md`.

## 1) Goal

Convert the existing tech spec into an execution model where **AI agents** implement the platform iteratively with human review gates.

This delivery plan preserves RailBridge as the x402 facilitator of merchant payment revenue and adds Merchant Treasury OS capabilities as the chain-abstracted management layer on top.

Current implementation wave is USDC-only for settlement, policy, balance, consolidation, and payout paths.

This plan assumes:
- AI agents write code, tests, migrations, and docs.
- Humans approve architecture/security decisions and production release gates.
- Work is shipped in short, verifiable slices.

---

## 2) Delivery Operating Model (AI-first)

## 2.1 Agent roles

1. **Planner Agent**
   - Converts spec sections into implementation tickets.
   - Defines acceptance criteria + test matrix per ticket.

2. **Builder Agent**
   - Implements code + migrations + API contracts.
   - Adds/updates tests.

3. **Verifier Agent**
   - Runs lint/tests/replay checks/reconciliation checks.
   - Performs negative-path validation.

4. **Reviewer Agent**
   - Enforces architecture constraints and coding standards.
   - Validates backward compatibility and security checklist.

5. **Release Agent**
   - Generates release notes, migration checklist, rollback steps.

> One AI can play multiple roles in sequence, but roles should stay logically separated in PR workflow.

## 2.2 Definition of Ready (DoR) per ticket

A ticket is ready only if it has:
- Scope (files/services touched)
- Input/output contract
- Error cases
- Telemetry requirements
- Acceptance tests (unit + integration)

## 2.3 Definition of Done (DoD) per ticket

- Code implemented
- Tests added and passing
- Migrations reversible
- Observability added (logs/metrics)
- Docs updated
- Replay/idempotency validated where applicable

## 2.4 Single-agent execution rules

One AI agent owns the full implementation path end-to-end and must keep cross-domain context in every ticket.

1. Before starting a ticket, the agent must restate:
   - what was completed in prior tickets
   - what assumptions from prior phases are now dependencies
   - what invariants must remain true (`idempotency`, `ledger correctness`, `auth isolation`)
2. The same agent performs planner, builder, verifier, reviewer, and release responsibilities in sequence for each ticket.
3. The agent must avoid local optimizations that break downstream phases (for example API shortcuts that reduce ledger traceability).
4. The agent can start the next ticket only after DoD is satisfied for the current ticket.
5. Any schema or custody-risk change still requires human approval per safety gates.

---

## 3) Sprint-by-Sprint Plan (AI Agent Execution)

Each sprint is one week. One agent executes the full path in order.

## 3.1 End-to-end context checklist (run before each sprint)

- Re-read current implementation state vs `MERCHANT_TREASURY_TECH_SPEC.md`.
- Confirm architecture alignment with `ARCHITECTURE.md`.
- Confirm production constraints with `PRODUCTION_CHECKLIST.md`.
- Verify x402 facilitator path remains source of merchant revenue events.
- Verify no change weakens tenancy isolation, auditability, or replay safety.

## 3.2 Sequential sprint board (single-agent)

## Sprint 0.5 — Merchant Identity + Custody Foundation

### Outcome
Web2 auth and custodial account primitives exist before exposing treasury controls.

### Execution steps
1. Finalize auth scope matrix (`admin`, `finance`, `readonly`) and account-tenancy rules.
2. Implement merchant user/account/wallet migrations.
3. Implement auth middleware with merchant/account-scoped claims.
4. Add secure signer adapter interface using key references (no private keys in DB).
5. Verify cross-merchant isolation and role-based failure paths.
6. Document migration and rollback notes.

### Exit criteria
- unauthorized cross-merchant and cross-account access is blocked
- write actions require correct role and pass audit logging requirements

---

## Sprint 1 — Event Backbone + Outbox

### Outcome
Reliable event emission from verify/settle lifecycle with idempotent consumption support.

### Execution steps
1. Define canonical event schema + versioning rules.
2. Add outbox table + write path from verify/settle pipeline.
3. Build outbox relay worker with retries.
4. Build replay CLI (basic) for local/dev validation.
5. Run duplicate/out-of-order/partial-failure simulations.
6. Publish event contract changelog and relay runbook.

### Exit criteria
- replayed event does not create duplicate state updates
- event lag metrics visible

---

## Sprint 2 — Ledger MVP (Treasury Truth)

### Outcome
Double-entry ledger and derived balances available for merchant read APIs.

### Execution steps
1. Define ledger account code map and invariants.
2. Implement ledger tables and journal writer.
3. Implement invariant validator (`sum(debit) == sum(credit)`).
4. Implement balance projector/materializer.
5. Add replay determinism checks and reconciliation drift checks.
6. Draft reconciliation and drift response runbook.

### Exit criteria
- `sum(debit) == sum(credit)` per event group
- balance query deterministic after replay

---

## Sprint 3 — Policy Engine MVP

### Outcome
Merchant settlement behavior is controlled via policy (not hardcoded flow).

### Execution steps
1. Define policy schema v1 and validation matrix.
2. Implement policy storage and read/update API internals.
3. Implement decision function (bridge/no-bridge, destination network/asset).
4. Integrate balance availability checks into policy decision path.
5. Verify policy changes only affect new settlements.
6. Document policy versioning and fallback behavior.

### Exit criteria
- policy updates are versioned and auditable
- unsupported network/asset rejected with clear errors

---

## Sprint 4 — Merchant Treasury APIs

### Outcome
Merchant can access balances, settlements, and policy through stable APIs.

### Execution steps
1. Finalize OpenAPI for balances, settlements, policy, consolidations, payouts.
2. Implement account-scoped read APIs over derived data.
3. Add cursor pagination and filtering.
4. Enforce auth scope and account tenancy checks on all endpoints.
5. Run contract tests against OpenAPI examples + auth negative-path tests.
6. Update API examples and release notes.

### Exit criteria
- APIs return lifecycle + failure reasons consistently
- API examples and tests stay in sync

---

## Sprint 5 — Gas Treasury + Ops Reliability

### Outcome
Operational gas abstraction and fee attribution are available.

### Execution steps
1. Define gas health model and refill thresholds.
2. Implement gas balance monitors by network.
3. Implement refill workflow hooks.
4. Add per-merchant gas fee attribution in settlement/bridge paths.
5. Simulate low-gas and route degradation scenarios.
6. Finalize alarms and incident response runbook.

### Exit criteria
- low-gas condition detected before settlement failures
- gas costs attributed per settlement/bridge event

## 3.3 Assignment command template

Use this instruction format when assigning an AI:

"You are the single implementation agent for RailBridge Merchant Treasury OS. Execute the next ready ticket in sequence, keep end-to-end context from prior tickets, and follow Sections 2.2, 2.3, and 2.4."

---

## 4) AI Agent PR Workflow Template

For every ticket/PR:

1. Planner agent creates `Implementation Plan` section:
   - assumptions
   - changed files
   - tests to add
2. Builder agent commits smallest possible slice.
3. Verifier agent runs:
   - unit tests
   - integration tests
   - replay/idempotency tests (if event-driven changes)
4. Reviewer agent blocks merge if:
   - missing invariants
   - no rollback notes for migration
   - missing metrics/logging

---

## 5) Prompt Contracts (Reusable)

## 5.1 Planner prompt skeleton

"Given `MERCHANT_TREASURY_TECH_SPEC.md`, break down `<ticket-id>` into exact code changes, DB migration steps, failure modes, and test cases. Output checklist + acceptance criteria."

## 5.2 Builder prompt skeleton

"Implement `<ticket-id>` exactly. Keep API contracts unchanged unless stated. Add tests for happy path + failure path + idempotency path."

## 5.3 Verifier prompt skeleton

"Run and report all relevant checks. Then create adversarial cases (duplicate event, out-of-order event, partial failure) and verify invariants."

## 5.4 Reviewer prompt skeleton

"Review for architecture drift, security risk, migration safety, and observability completeness. Provide block/approve decision with reason."

---

## 6) Governance & Safety Gates (Human-in-the-loop)

Require human approval for:
- Schema-breaking migrations
- New custody/private-key handling logic
- Policy engine behavior that impacts merchant funds routing
- Production rollout/rollback strategy

AI agents can propose; humans approve critical financial-risk decisions.

---

## 7) KPI-by-Sprint Validation

- Sprint 1: event delivery success rate, consumer retry success, lag P95.
- Sprint 2: ledger invariant pass rate, reconciliation drift.
- Sprint 3: policy evaluation correctness rate.
- Sprint 4: API correctness + latency P95.
- Sprint 5: gas incident rate and preemptive refill success rate.

---

## 8) First 10 AI Tickets (sequential execution queue)

| Order | Ticket | Depends on | Scope |
| --- | --- | --- | --- |
| 1 | `AI-TREASURY-001` | none | event envelope types + schema validation |
| 2 | `AI-TREASURY-002` | `AI-TREASURY-001` | outbox migration + repository |
| 3 | `AI-TREASURY-003` | `AI-TREASURY-002` | merchant users/accounts/wallets migrations |
| 4 | `AI-TREASURY-004` | `AI-TREASURY-003` | auth middleware + role scope enforcement |
| 5 | `AI-TREASURY-005` | `AI-TREASURY-004` | emit `payment.verified` / `payment.settled_source` |
| 6 | `AI-TREASURY-006` | `AI-TREASURY-005` | outbox relay worker + retries |
| 7 | `AI-TREASURY-007` | `AI-TREASURY-006` | ledger tables + invariant checker |
| 8 | `AI-TREASURY-008` | `AI-TREASURY-007` | balance projector + replay command |
| 9 | `AI-TREASURY-009` | `AI-TREASURY-008` | account-scoped balances/settlements/policy APIs |
| 10 | `AI-TREASURY-010` | `AI-TREASURY-009` | consolidation trigger API + gas monitor hooks |

Execution rule: do not start ticket `N+1` until ticket `N` passes DoD and verification checks.
