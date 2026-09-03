# Documents

What the project is doing and why, kept next to the code so the two cannot drift.

| | |
| --- | --- |
| [ROADMAP.md](ROADMAP.md) | Where this is going, in phases, with what "done" means for each |
| [CONFORMANCE.md](CONFORMANCE.md) | How a chip is verified: what 100 % means, the oracles, the corpus, the harness, the sheet |
| [SCORE.md](SCORE.md) | The portable score - one song, many machines. A draft |
| [DECISIONS.md](DECISIONS.md) | Decisions taken, with the reasoning, so they are not re-litigated by accident |
| [chips/](chips/) | One conformance sheet per chip. [TEMPLATE.md](chips/TEMPLATE.md) is the blank one, [2a03.md](chips/2a03.md) is the NES |

The package's own [README](../packages/chipvoice/README.md) covers the API. The
documents here are about the project: what it is trying to be, how it checks that
it got there, and what it decided along the way.

Small, local decisions live as comments in the code next to what they decide.
Project-level ones live in DECISIONS.md. If a comment and a document disagree, the
comment is closer to the code and probably newer; fix the document.
