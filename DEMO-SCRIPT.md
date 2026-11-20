# 5-minute demo narration

Record your screen, run the steps in this order, read these lines in your own words. Do not read it
flat — the aim is that it sounds like you explaining your own build, because it is going to be you
defending it live a week later.

Total target: 4:30 to 5:00. Timings are a guide.

---

**[0:00 – 0:25] Open on the Run tab, nothing clicked yet.**

> This is an AP invoice process for problem statement one. A vendor invoice goes in as a PDF, and a
> decision comes out — pay, hold, or do not pay — with every step that produced it visible. The
> vendors, purchase orders and invoices are synthetic, but these are real PDFs and they get parsed
> live in the browser.

**[0:25 – 1:15] Click the base case, "clean invoice, matches PO".**

> Here is the happy path. It reads the PDF text layer, pulls out the invoice number, date, vendor,
> PO reference and the line items. Then five stages run in order: read the document, check the
> vendor is approved, check we have not already paid this, check the arithmetic on the document
> agrees with itself, and match it to the purchase order. Everything passes, so it is approved for
> payment. Below you can see exactly what was read off the document.

**[1:15 – 2:00] Click edge case 1, "same invoice, different formatting".**

> First edge case. This is the same invoice coming back, but the vendor has written the number as
> lowercase "acm 9001" instead of "ACM-9001", and the vendor name in full rather than abbreviated.
> A duplicate check that compares strings sees two different invoices and pays it twice. This one
> strips case and punctuation first, on both the number and the vendor name, so it catches it. That
> is the single most common way a duplicate slips through an ERP.

**[2:00 – 2:50] Click edge case 2, "split billing that exceeds the PO".**

> Second edge case, and this is the one I would defend hardest. Nova Components billed this PO
> twice. The first invoice was thirty-one thousand, this one is forty-seven. Each invoice on its
> own is inside the purchase order, so a process that checks invoices one at a time approves both
> and overspends the PO. This one reads prior invoices on the same PO out of run history and checks
> the cumulative figure. That is why the history here is state the decision depends on, not a log.

**[2:50 – 3:40] Click edge case 3, "total looks fine, unit price is not".**

> Third edge case. Most AP tolerance checks compare the invoice total to the PO total and allow a
> couple of percent. That is beatable: bill fewer units at a higher price, and the total stays
> under the PO. This invoice is forty-nine thousand against a PO worth two hundred and sixty-three
> thousand, so a total-based check passes it. But the filter cartridges are billed at 1,050 against
> a PO price of 950 — ten and a half percent over a two percent tolerance. So the tolerance here is
> applied per unit price, not to the total.

**[3:40 – 4:15] Click edge case 4, "scanned image, nothing to read".**

> Last edge case. This PDF is a scan — it has no text layer at all, zero extractable characters. I
> have not wired up OCR, so the honest output is to stop and route it to a person with the reason
> stated. Notice the later stages say skipped, not passed. A process that reports a pass on a check
> it never ran is worse than one that fails loudly.

**[4:15 – 4:50] Switch to the Dashboard tab.**

> And this is every invoice the process has seen: what was decided, and why, in one line each. Two
> approved, four rejected, and the value actually cleared for payment. This is the view an AP lead
> would work from, and it is also what makes the duplicate and cumulative-PO checks possible.

**[4:50 – 5:00] Close.**

> Happy to walk through any of the rules in the code. Thanks for watching.
