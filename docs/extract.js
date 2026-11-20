/* Turns a real PDF into the invoice object the engine consumes.
 *
 * Deliberately conservative: a field it cannot read with confidence is left
 * null rather than guessed. The engine then rejects on MISSING_FIELD, which is
 * the correct outcome. Silently inventing a total is how an automated AP
 * process pays the wrong number.
 */

const num = s => {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) ? v : null;
};

/* pdf.js gives text items with coordinates. Grouping by y and sorting by x
 * rebuilds the visual lines, which is what the labels and values sit on.
 * Reading items in raw order scrambles two-column rows. */
export async function pdfToLines(file, pdfjsLib) {
  const buf = await file.arrayBuffer();
  // isEvalSupported:false closes CVE-2024-4367, an XSS through a crafted PDF.
  // This process exists to open documents sent in by outsiders, so that is
  // the actual threat model, not a theoretical one.
  const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);        // bucket by baseline
      const key = Math.round(y / 3) * 3;            // tolerate sub-pixel drift
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])                  // top of page first
      .forEach(([, items]) => {
        lines.push(items.sort((a, b) => a.x - b.x).map(i => i.s).join(" ")
          .replace(/\s+/g, " ").trim());
      });
  }
  return lines;
}

const after = (lines, label) => {
  const re = new RegExp(label, "i");
  for (const l of lines) {
    if (re.test(l)) {
      const v = l.replace(re, "").replace(/^[\s:·.-]+/, "").trim();
      if (v) return v;
    }
  }
  return null;
};

export function parseInvoice(lines) {
  const text = lines.join("\n");
  const hasText = text.replace(/\s/g, "").length > 20;
  if (!hasText) {
    return {
      invoiceNo: null, invoiceDate: null, vendorName: null, poRef: null,
      currency: null, subtotal: null, tax: null, total: null, lines: [],
      extraction: { textLayer: false, source: "image-only", rawLines: [] },
    };
  }

  // The vendor sits on the line under the TAX INVOICE heading in this layout.
  let vendorName = null;
  const hdr = lines.findIndex(l => /tax invoice/i.test(l));
  if (hdr >= 0 && lines[hdr + 1]) vendorName = lines[hdr + 1].trim();

  const items = [];
  for (const l of lines) {
    // SKU, description, qty, unit price, amount - all on one rebuilt row.
    const m = l.match(/^([A-Z]{3}-[A-Z0-9]+)\s+(.+?)\s+([\d,]+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/);
    if (m) {
      items.push({ sku: m[1], description: m[2].trim(), qty: num(m[3]), unitPrice: num(m[4]) });
    }
  }

  return {
    invoiceNo: after(lines, /invoice\s*number/i),
    invoiceDate: after(lines, /invoice\s*date/i),
    vendorName,
    poRef: after(lines, /purchase\s*order/i),
    currency: after(lines, /^currency/i),
    subtotal: num(after(lines, /^subtotal/i)),
    tax: num(after(lines, /gst\s*\d+%?/i)),
    total: num(after(lines, /^total/i)),
    lines: items,
    extraction: { textLayer: true, source: "pdf-text", rawLines: lines },
  };
}
