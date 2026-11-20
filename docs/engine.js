/* AP invoice decision engine.
 *
 * One pure module, no DOM and no network, so the same code runs in the browser
 * and under node in tests. Everything the UI shows is produced here.
 *
 * The shape of the decision: an invoice is never "approved" or "rejected" by a
 * single rule. Each rule returns a finding with a severity, and the decision is
 * the worst severity present. That is what makes the output explainable: the
 * reason is the list of findings, not a score nobody can argue with.
 */

export const DECISION = { APPROVE: "AUTO_APPROVE", HOLD: "HOLD_FOR_REVIEW", REJECT: "REJECT" };

// Tolerance is on unit price, not invoice total. A total-only tolerance lets a
// vendor bill 10 extra units at the right price and still pass, which is the
// single most common way an AP tolerance check gets beaten.
export const POLICY = {
  unitPriceTolerancePct: 2.0,
  totalRoundingToleranceAbs: 1.0,   // currency units, for rounding noise only
  taxRateExpected: 18.0,            // GST, used only to sanity-check arithmetic
  requireApprovedVendor: true,
};

const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* Normalising an invoice number is the whole duplicate-detection problem.
 * Vendors re-send the same invoice as "INV-1042", "inv 1042" and "INV/1042".
 * An exact-string duplicate check misses every one of those. */
export function normaliseInvoiceNo(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* Vendor names arrive with and without suffixes. "Acme Industries Pvt Ltd" and
 * "ACME INDUSTRIES PRIVATE LIMITED" are the same vendor and must match, or the
 * approved-vendor check produces false rejections all day. */
export function normaliseVendor(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/\bPRIVATE\b/g, "PVT")
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/[^A-Z0-9]/g, "");
}

function finding(severity, code, message, detail) {
  return { severity, code, message, detail: detail || null };
}

/* ---------- the rules ---------- */

function ruleExtractionComplete(inv) {
  const out = [];
  const required = [
    ["invoiceNo", "invoice number"],
    ["invoiceDate", "invoice date"],
    ["vendorName", "vendor name"],
    ["total", "invoice total"],
  ];
  for (const [k, label] of required) {
    if (inv[k] === null || inv[k] === undefined || inv[k] === "") {
      out.push(finding("REJECT", "MISSING_FIELD",
        `No ${label} could be read from the document.`,
        "Nothing downstream can be trusted without it, so this stops here rather than guessing."));
    }
  }
  if (inv.extraction && inv.extraction.textLayer === false) {
    out.push(finding("REJECT", "NO_TEXT_LAYER",
      "The PDF has no text layer, so this is a scan or a photo.",
      "Reading it needs OCR, which is not wired up. Routing to a human is the honest outcome; " +
      "inventing values from an unreadable document is how wrong payments happen."));
  }
  return out;
}

function ruleVendorApproved(inv, master) {
  if (!POLICY.requireApprovedVendor) return [];
  const v = master.vendors.find(x => normaliseVendor(x.name) === normaliseVendor(inv.vendorName));
  if (!v) {
    return [finding("REJECT", "VENDOR_NOT_APPROVED",
      `"${inv.vendorName}" is not in the approved vendor master.`,
      "Paying an unknown payee is the fraud case this control exists for.")];
  }
  if (v.blocked) {
    return [finding("REJECT", "VENDOR_BLOCKED",
      `${v.name} is blocked: ${v.blockReason}.`, null)];
  }
  return [];
}

function ruleDuplicate(inv, master, history) {
  const key = normaliseInvoiceNo(inv.invoiceNo);
  const vend = normaliseVendor(inv.vendorName);
  const priors = (history || []).filter(h =>
    normaliseInvoiceNo(h.invoiceNo) === key && normaliseVendor(h.vendorName) === vend);
  if (priors.length) {
    const p = priors[0];
    const exact = p.invoiceNo === inv.invoiceNo;
    return [finding("REJECT", "DUPLICATE_INVOICE",
      `Already processed as "${p.invoiceNo}" on ${p.processedAt}.`,
      exact
        ? "Same invoice number, same vendor."
        : `Different formatting ("${p.invoiceNo}" vs "${inv.invoiceNo}") but the same invoice once ` +
          `punctuation and case are stripped. An exact-string duplicate check would have paid this twice.`)];
  }
  return [];
}

function ruleArithmetic(inv) {
  if (!inv.lines || !inv.lines.length) return [];
  const lineSum = money(inv.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
  const expectedTax = money(lineSum * POLICY.taxRateExpected / 100);
  const out = [];
  const stated = inv.subtotal != null ? money(inv.subtotal) : null;
  if (stated != null && Math.abs(stated - lineSum) > POLICY.totalRoundingToleranceAbs) {
    out.push(finding("HOLD", "SUBTOTAL_MISMATCH",
      `Line items sum to ${lineSum}, but the invoice states a subtotal of ${stated}.`,
      "The document disagrees with itself, so neither figure can be relied on."));
  }
  if (inv.tax != null && Math.abs(money(inv.tax) - expectedTax) > POLICY.totalRoundingToleranceAbs) {
    out.push(finding("HOLD", "TAX_MISMATCH",
      `Tax of ${money(inv.tax)} does not match ${POLICY.taxRateExpected}% of ${lineSum} (${expectedTax}).`,
      "Either the rate differs or the taxable base does. Worth a human reading the document."));
  }
  return out;
}

function rulePoMatch(inv, master, history) {
  if (!inv.poRef) {
    return [finding("HOLD", "NO_PO_REFERENCE",
      "No purchase order reference on the invoice.",
      "Without a PO there is nothing to match against, so this needs a buyer to identify it.")];
  }
  const po = master.purchaseOrders.find(p => normaliseInvoiceNo(p.poNumber) === normaliseInvoiceNo(inv.poRef));
  if (!po) {
    return [finding("REJECT", "PO_NOT_FOUND",
      `Purchase order ${inv.poRef} does not exist.`, null)];
  }
  const out = [];
  if (normaliseVendor(po.vendorName) !== normaliseVendor(inv.vendorName)) {
    out.push(finding("REJECT", "PO_VENDOR_MISMATCH",
      `${inv.poRef} belongs to ${po.vendorName}, not ${inv.vendorName}.`, null));
  }

  // Unit price check, per line, against the PO. This is the check a
  // total-based tolerance misses.
  for (const line of (inv.lines || [])) {
    const pl = po.lines.find(x => x.sku === line.sku);
    if (!pl) {
      out.push(finding("HOLD", "LINE_NOT_ON_PO",
        `Line "${line.description || line.sku}" is not on ${po.poNumber}.`, null));
      continue;
    }
    const diffPct = pl.unitPrice === 0 ? 0 : ((line.unitPrice - pl.unitPrice) / pl.unitPrice) * 100;
    if (diffPct > POLICY.unitPriceTolerancePct) {
      out.push(finding("REJECT", "UNIT_PRICE_OVER_TOLERANCE",
        `${line.sku} billed at ${line.unitPrice} against a PO price of ${pl.unitPrice} ` +
        `(${diffPct.toFixed(1)}% over, tolerance ${POLICY.unitPriceTolerancePct}%).`, null));
    }
  }

  // Cumulative consumption: a vendor may split one PO across several invoices,
  // which is legitimate. What is not legitimate is the total of those invoices
  // exceeding the PO. Checking this invoice alone would let the overrun through.
  const priorOnPo = (history || [])
    .filter(h => normaliseInvoiceNo(h.poRef || "") === normaliseInvoiceNo(po.poNumber))
    .filter(h => h.decision !== DECISION.REJECT);
  const priorValue = money(priorOnPo.reduce((a, h) => a + (h.total || 0), 0));
  const cumulative = money(priorValue + (inv.total || 0));
  const poValue = money(po.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) * (1 + POLICY.taxRateExpected / 100));

  if (cumulative - poValue > POLICY.totalRoundingToleranceAbs) {
    out.push(finding("REJECT", "PO_VALUE_EXCEEDED",
      `This invoice takes ${po.poNumber} to ${cumulative} against a PO value of ${poValue}.`,
      priorOnPo.length
        ? `${priorOnPo.length} earlier invoice(s) on this PO already consumed ${priorValue}. ` +
          `Each one was inside the PO on its own; together they are not.`
        : "This single invoice is above the PO value."));
  } else if (priorOnPo.length) {
    out.push(finding("INFO", "PO_SPLIT_BILLING",
      `${po.poNumber} has ${priorOnPo.length} earlier invoice(s) totalling ${priorValue}; ` +
      `cumulative ${cumulative} of ${poValue}.`,
      "Split billing against one PO is normal and is not held on its own."));
  }
  return out;
}

const RULES = [
  ["Read the document", ruleExtractionComplete],
  ["Check the vendor", ruleVendorApproved],
  ["Check for duplicates", ruleDuplicate],
  ["Check the arithmetic", ruleArithmetic],
  ["Match to the purchase order", rulePoMatch],
];

const RANK = { INFO: 0, HOLD: 1, REJECT: 2 };

/* Runs every stage and returns both the decision and the trace the UI renders.
 * The trace is not logging: it is the explanation, and it is built whether or
 * not anyone looks at it. */
export function processInvoice(inv, master, history) {
  const stages = [];
  let all = [];
  let halted = false;

  for (const [name, fn] of RULES) {
    if (halted) {
      stages.push({ name, status: "SKIPPED", findings: [],
        note: "Skipped: the document could not be read, so this check has nothing to run on." });
      continue;
    }
    let findings = [];
    try {
      findings = fn(inv, master, history) || [];
    } catch (err) {
      findings = [finding("HOLD", "RULE_ERROR", `${name} failed to run: ${err.message}`, null)];
    }
    all = all.concat(findings);
    const worst = findings.reduce((a, f) => Math.max(a, RANK[f.severity] ?? 0), 0);
    stages.push({
      name,
      status: findings.length === 0 ? "PASS" : (worst === 2 ? "FAIL" : (worst === 1 ? "WARN" : "PASS")),
      findings,
    });
    // An unreadable document makes every later check meaningless, so stop.
    if (findings.some(f => f.code === "NO_TEXT_LAYER" || f.code === "MISSING_FIELD")) halted = true;
  }

  const worst = all.reduce((a, f) => Math.max(a, RANK[f.severity] ?? 0), 0);
  const decision = worst === 2 ? DECISION.REJECT : (worst === 1 ? DECISION.HOLD : DECISION.APPROVE);

  return {
    decision,
    reasons: all.filter(f => f.severity !== "INFO").map(f => f.message),
    findings: all,
    stages,
    invoice: inv,
    processedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
}
