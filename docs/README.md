# Documents

What the project is doing and why, kept next to the code so the two cannot drift.

| | |
| --- | --- |
| [ROADMAP.md](ROADMAP.md) | Where this is going, in phases, with what "done" means for each |
| [DEMO.md](DEMO.md) | The playable library demo: agreed product spec, V1 scope, build order and acceptance criteria |
| [AUDIT-2026-09-05.md](AUDIT-2026-09-05.md) | Project audit: reproduced defects, architecture, frontend and recommended priorities (French) |
| [CONFORMANCE.md](CONFORMANCE.md) | How a chip is verified: what 100 % means, the oracles, the corpus, the harness, the sheet |
| [SCORE.md](SCORE.md) | The portable score - one song, many machines. A draft |
| [DECISIONS.md](DECISIONS.md) | Decisions taken, with the reasoning, so they are not re-litigated by accident |
| [BACKLOG.md](BACKLOG.md) | The tickets, kept current at the start and end of every pull request, and a log of the discoveries that changed the plan |
| [chips/](chips/) | One conformance sheet per chip. [TEMPLATE.md](chips/TEMPLATE.md) is the blank one, [2a03.md](chips/2a03.md) is the NES; its parity numbers are written by the harness |

The package's own [README](../packages/chipvoice/README.md) covers the API. The
documents here are about the project: what it is trying to be, how it checks that
it got there, and what it decided along the way.

Small, local decisions live as comments in the code next to what they decide.
Project-level ones live in DECISIONS.md. If a comment and a document disagree, the
comment is closer to the code and probably newer; fix the document.

- [V1 demo evaluation](evals/DEMO-2026-09-05.md): production screenshots, audio evidence, regressions and deferred device checks.
