# Arpita — read this before the demo

This is the Zamp case study, PS-1. You will run it live in the interview and they will ask why you
made each choice. Nothing below is a script to memorise; it is the reasoning, so you can answer a
question I did not anticipate.

Live link: https://arpita-at.github.io/ap-invoice-decisions/

---

## What the thing actually does

An AP clerk receives a vendor invoice as a PDF. Today they open it, find the matching PO in a
spreadsheet, check the numbers line up, and decide: pay it, hold it, or reject it. This automates
that, and shows its working.

Five stages, in this order:

1. **Read the document** — pdf.js pulls the text layer out of the PDF. If a required field is
   missing, or there is no text layer at all, it stops here.
2. **Check the vendor** — is this payee on the approved list, and are they blocked?
3. **Check for duplicates** — have we already processed this invoice?
4. **Check the arithmetic** — do the line items sum to the stated subtotal, and does the tax match?
5. **Match to the purchase order** — right vendor, right unit prices, and does the PO have room?

## The one idea to lead with

**An invoice is never approved or rejected by a single rule.** Every rule returns *findings*, each
with a severity: INFO, HOLD, or REJECT. The decision is simply the worst severity present.

Why that matters: the output is explainable by construction. When someone asks "why was this
rejected", the answer is the list of findings, not "the model scored it 0.31". In AP that matters
because a rejection goes back to a vendor who will argue with it.

## The two choices they will probe

### 1. Tolerance is on unit price, not invoice total

Most AP tolerance checks compare the invoice total to the PO total and allow a few percent. That
is beatable. A vendor bills **fewer units at an inflated price** — the total stays under the PO, so
the check passes, and you have overpaid per unit.

Edge case 3 is that invoice. 40 filter cartridges at 1,050 against a PO price of 950. The total is
49,560 against a PO worth 263,140, so a total-based check waves it through. The unit price is
10.5% over a 2% tolerance, so this one rejects it.

If they ask "what would you add next": per-line *quantity* against PO quantity, which this does not
do yet. Say that. Naming the gap is better than defending a hole.

### 2. The duplicate check normalises before comparing

Vendors re-send the same invoice as `INV-1042`, `inv 1042`, `INV/1042`. Comparing strings catches
none of them. The code strips case and punctuation first, on both the invoice number and the
vendor name, then compares.

This is the same idea as your **dupe-agent** repo — invoice-number formatting variance is one of
the four duplicate patterns there. Say that out loud; it is true and it connects the case study to
work you already did.

## Why history is state, not a log

Edge case 2 is the one worth being proud of. Nova Components bills 31,720 against PO-2026-0455,
then later 47,554. Each invoice on its own is inside the PO. Together they are over it.

A process that checks each invoice in isolation approves both and overspends the PO. So the
cumulative check reads prior invoices on the same PO out of run history. That makes history
**state the decision depends on**, not an audit log you write and never read.

This is the same shape as **grir-agent**: grouping postings by PO line and netting them, rather
than looking at each posting alone.

## Why the scanned invoice is rejected, not guessed

`invoice-scanned.pdf` has zero extractable characters — check it, `pdftotext` returns nothing. OCR
is not wired up. The honest output is to stop and route to a human with the reason stated.

If asked why not add OCR: it was a scope choice for one week. Adding Tesseract would produce
low-confidence text, and low-confidence text in an AP process means paying a wrong number. A clean
hand-off beats a confident guess. Also note the later stages show **SKIPPED**, not PASS — a
pipeline that reports a pass on a check it never ran is worse than one that fails loudly.

## If something breaks live

- Nothing is server-side. If a run misbehaves, click **Clear history** on the Dashboard and re-run.
- The sample buttons fetch and parse the real PDF each time. If the CDN is slow, the first run takes
  a second or two longer.
- History lives in this browser only. Clearing it is safe and resets every scenario.

## Honest answer if they ask how you built it

You used AI tooling throughout — their own guidance says to, and says there is no extra credit for
doing it manually. What they are testing is whether you can explain the design decisions and run it.
So: yes, AI-assisted build, and here is why unit-price tolerance beats total tolerance. That answer
is strong. Pretending otherwise is not, and is the one thing that would sink this.

## Run the tests in front of them if it comes up

```bash
node tests/test_engine.mjs     # 27 checks
```

Check 3 is the one to point at: it asserts the reformatted duplicate is caught **and** that a plain
string comparison would have missed it. The test encodes the design decision, not just the output.
