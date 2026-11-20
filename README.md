# AP invoice decisions — PS-1

A vendor invoice goes in. A decision comes out, with every step that produced it visible.

**Live:** https://arpita-at.github.io/ap-invoice-decisions/
**Built for:** Zamp AI Solutions Analyst case study, PS-1 (invoice processing, PDF to decision).

## The data is synthetic

Vendors, purchase orders and sample invoices are invented for this exercise. The files in
`docs/samples/` are **real PDFs** and are parsed live in the browser by pdf.js — nothing is mocked.
`invoice-scanned.pdf` genuinely has zero extractable characters, which is what makes that edge case
real rather than a flag set by hand.

## The decision model

An invoice is never approved or rejected by one rule. Each rule returns **findings** with a
severity, and the decision is the worst severity present:

| Worst finding | Decision |
|---|---|
| none | `AUTO_APPROVE` |
| `HOLD` | `HOLD_FOR_REVIEW` |
| `REJECT` | `REJECT` |

That is what makes the output explainable. The reason is the list of findings, not a score nobody
can argue with. Every non-approval states at least one reason, and a test asserts it.

Five stages run in order: read the document, check the vendor, check for duplicates, check the
arithmetic, match to the purchase order. If the document cannot be read, the later stages report
**SKIPPED**, not PASS. A pipeline that silently passes checks it never ran is worse than one that
fails loudly.

## Two design decisions worth defending

**Tolerance is on unit price, not invoice total.** A total-based tolerance is the standard
implementation and it is beatable: bill fewer units at an inflated price and the total stays under
the PO. Edge case 3 is exactly that invoice — total under the PO, unit price 10.5% over a 2%
tolerance. A total check passes it; this one does not.

**The duplicate check normalises before comparing.** Vendors re-send the same invoice as
`INV-1042`, `inv 1042`, `INV/1042`. Stripping case and punctuation catches all three. The test
asserts both halves: that the reformatted duplicate is caught, *and* that a plain string comparison
would have missed it.

## The four edge cases

Each one breaks a specific naive implementation.

| # | Case | What it breaks |
|---|---|---|
| 1 | Same invoice, different formatting | An exact-string duplicate check pays it twice |
| 2 | Split billing across one PO | Checking each invoice alone — both are individually inside the PO, together they are over it |
| 3 | Total fine, unit price not | A tolerance applied to the invoice total |
| 4 | Scanned image, no text layer | Any pipeline that assumes a PDF has text |

Edge case 2 is why run history is **state, not a log**: the cumulative check and the duplicate
check both read it.

## Run it

```bash
python3 build/make_samples.py      # regenerate the sample PDFs via headless Chrome
node tests/test_engine.mjs         # 27 checks on the decision logic
python3 -m http.server -d docs 8000
```

No dependencies beyond pdf.js from a CDN. The engine (`docs/engine.js`) is a pure module with no
DOM and no network, so the same code runs in the browser and under node in the tests.

## Layout

```
docs/engine.js     the rules and the decision. pure, testable, no DOM
docs/extract.js    PDF -> invoice fields. leaves a field null rather than guessing
docs/master.js     approved vendors and open POs (passed in, not imported by the engine)
docs/samples.js    the happy path and four edge cases
docs/app.js        live run view, dashboard, wiring
tests/             27 checks, including that a naive implementation would fail each edge case
```
