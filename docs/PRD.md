# CarpeOS product requirements (by major)

One PRD file per **major** version. Do not rewrite older majors in place; add
`PRD-vN.md` when the next major thesis is fixed.

| Major | Thesis (one line) | PRD | DoD |
| --- | --- | --- | --- |
| **1.0** | Does the loop run? | [PRD-v1.md](PRD-v1.md) | [product-1.0.0.md](maintainers/product-1.0.0.md) |
| **2.0** | Is this worth remembering? | [PRD-v2.md](PRD-v2.md) | [product-2.0.0.md](maintainers/product-2.0.0.md) |
| **3.0** | Can it be found and used? | [PRD-v3.md](PRD-v3.md) | [product-3.0.0.md](maintainers/product-3.0.0.md) |

Minors do **not** get a new PRD file. They extend the current major via a
maintainer DoD (and ADRs as needed). Active minor design:

| Minor | Thesis (one line) | DoD | ADR |
| --- | --- | --- | --- |
| **3.1** | Can accepted knowledge leave CarpeOS safely (OKF export)? | [product-3.1.0.md](maintainers/product-3.1.0.md) | [0014](adr/0014-okf-export-projection.md) |

**PRD** = durable product requirements snapshot for that major’s thesis and scope.  
**DoD** = living gates, freeze evidence, and release policy for maintainers.

## How to extend

1. Land the major’s thesis in a maintainer DoD (`product-N.0.0.md`) and ADRs as needed.
2. Add `docs/PRD-vN.md` with: status, thesis table, problem, goals, non-goals,
   requirements, architecture snapshot, success criteria, residuals.
3. Link the new row in this index.
4. Open a docs PR (Conventional Commit: `docs: add PRD vN …`).
