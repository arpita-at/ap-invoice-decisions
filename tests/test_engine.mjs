/* Checks that fail if the decision logic breaks. Run: node tests/test_engine.mjs */
import { processInvoice, DECISION, normaliseInvoiceNo, normaliseVendor, POLICY } from "../docs/engine.js";
import { MASTER } from "../docs/master.js";
import { SAMPLES } from "../docs/samples.js";

let pass = 0;
const ok = (cond, name) => {
  if (!cond) { console.error("FAIL:", name); process.exitCode = 1; }
  else { pass++; }
};
const S = id => SAMPLES.find(s => s.id === id);
const run = (s, hist) => processInvoice(structuredClone(s.invoice), MASTER, hist || []);
const has = (r, code) => r.findings.some(f => f.code === code);

// 1. Happy path approves, and approves for the right reason: nothing fired.
{
  const r = run(S("happy"));
  ok(r.decision === DECISION.APPROVE, "happy path approves");
  ok(r.reasons.length === 0, "happy path has no reasons");
  ok(r.stages.every(st => st.status !== "SKIPPED"), "happy path runs every stage");
}

// 2. Normalisation is what catches the reformatted duplicate.
{
  ok(normaliseInvoiceNo("ACM-9001") === normaliseInvoiceNo("acm 9001"), "invoice no normalises");
  ok(normaliseInvoiceNo("INV/1042") === normaliseInvoiceNo("inv-1042"), "slash and dash normalise alike");
  ok(normaliseVendor("Acme Industries Pvt Ltd") === normaliseVendor("ACME INDUSTRIES PRIVATE LIMITED"),
     "vendor suffixes normalise");
  ok(normaliseVendor("Acme Industries") !== normaliseVendor("Nova Components"),
     "different vendors stay different");
}

// 3. Edge 1: duplicate is caught despite different formatting, and would NOT be
//    caught by a naive exact-string check. Both halves matter.
{
  const first = run(S("happy"));
  const hist = [{ ...S("happy").invoice, decision: first.decision, processedAt: "2026-11-04 09:00" }];
  const r = run(S("dup-format"), hist);
  ok(r.decision === DECISION.REJECT, "reformatted duplicate rejected");
  ok(has(r, "DUPLICATE_INVOICE"), "duplicate finding raised");
  const naive = hist.some(h => h.invoiceNo === S("dup-format").invoice.invoiceNo);
  ok(naive === false, "a plain string check would have missed it");
}

// 4. Edge 2: each invoice is inside the PO alone; cumulatively they are not.
{
  const s = S("po-split");
  const alone = run(s, []);
  ok(!has(alone, "PO_VALUE_EXCEEDED"), "invoice alone is within the PO");
  const r = run(s, s.priorHistory);
  ok(r.decision === DECISION.REJECT, "cumulative overrun rejected");
  ok(has(r, "PO_VALUE_EXCEEDED"), "PO value exceeded raised");
}

// 5. Edge 3: a total-based tolerance passes it; the unit-price rule does not.
{
  const s = S("unit-price");
  const r = run(s);
  ok(has(r, "UNIT_PRICE_OVER_TOLERANCE"), "unit price over tolerance raised");
  ok(r.decision === DECISION.REJECT, "overbilled unit price rejected");
  const po = MASTER.purchaseOrders.find(p => p.poNumber === "PO-2026-0412");
  const poValue = po.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) * (1 + POLICY.taxRateExpected / 100);
  ok(s.invoice.total < poValue, "the total alone is under the PO, so a total check would pass it");
}

// 6. Edge 4: an unreadable document stops the run instead of guessing.
{
  const r = run(S("scanned"));
  ok(r.decision === DECISION.REJECT, "scanned image rejected");
  ok(has(r, "NO_TEXT_LAYER"), "no text layer raised");
  ok(r.stages.some(st => st.status === "SKIPPED"), "later stages skipped, not silently passed");
  ok(!r.stages.some(st => st.status === "PASS" && st.name === "Match to the purchase order"),
     "PO match never reports a pass on an unreadable document");
}

// 7. Vendor controls.
{
  const inv = structuredClone(S("happy").invoice);
  inv.vendorName = "Orbit Facilities Services";
  inv.invoiceNo = "ORB-1";
  ok(has(processInvoice(inv, MASTER, []), "VENDOR_BLOCKED"), "blocked vendor caught");
  const inv2 = structuredClone(S("happy").invoice);
  inv2.vendorName = "Ghost Supplies Pvt Ltd";
  inv2.invoiceNo = "GHO-1";
  ok(has(processInvoice(inv2, MASTER, []), "VENDOR_NOT_APPROVED"), "unknown vendor caught");
}

// 8. Severity drives the decision: a HOLD alone must not become a REJECT.
{
  const inv = structuredClone(S("happy").invoice);
  inv.invoiceNo = "ACM-9999";
  inv.poRef = null;                       // no PO -> HOLD, not REJECT
  const r = processInvoice(inv, MASTER, []);
  ok(r.decision === DECISION.HOLD, "a hold-level finding yields HOLD");
  ok(has(r, "NO_PO_REFERENCE"), "missing PO reference raised");
}

// 9. The payable total must reconcile to its own components. Without this the
//    invoice can state any total it likes and still pass every other check.
{
  const inv = structuredClone(S("happy").invoice);
  inv.invoiceNo = "ACM-TOT";
  inv.total = inv.subtotal + inv.tax + 5000;   // lines and tax fine, total inflated
  const r = processInvoice(inv, MASTER, []);
  ok(has(r, "TOTAL_MISMATCH"), "inflated total caught");
  ok(r.decision !== DECISION.APPROVE, "an unreconciled total is not approved");
}

// 10. Nothing to reconcile against is a gap, not a pass.
{
  const inv = structuredClone(S("happy").invoice);
  inv.invoiceNo = "ACM-NOLINES";
  inv.lines = [];
  const r = processInvoice(inv, MASTER, []);
  ok(has(r, "NO_LINE_ITEMS"), "missing line items raised");
  ok(r.decision !== DECISION.APPROVE, "no silent pass when there is nothing to check");
}
{
  const inv = structuredClone(S("happy").invoice);
  inv.invoiceNo = "ACM-NOTAX";
  inv.tax = null;
  const r = processInvoice(inv, MASTER, []);
  ok(has(r, "INCOMPLETE_TOTALS"), "unreadable tax raised");
}

// 9. Every finding is explainable: no decision without a stated reason.
{
  for (const s of SAMPLES) {
    const r = run(s, s.priorHistory || []);
    if (r.decision !== DECISION.APPROVE) {
      ok(r.reasons.length > 0, `${s.id}: a non-approval states at least one reason`);
    }
  }
}

console.log(`${pass} checks passed`);
