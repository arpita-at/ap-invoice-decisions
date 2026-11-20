/* The happy path plus four edge cases.
 *
 * These are the parsed form of the sample PDFs in docs/samples/. The app can
 * run either: drop a PDF in and it is parsed live, or load one of these to
 * demonstrate a case quickly. Both go through the same engine.
 *
 * Each edge case was chosen because it breaks a specific naive implementation,
 * which is the point: they are not "what if a field is blank".
 */
export const SAMPLES = [
  {
    id: "happy",
    label: "Happy path - clean invoice, matches PO",
    file: "samples/invoice-happy.pdf",
    breaks: null,
    invoice: {
      invoiceNo: "ACM-9001", invoiceDate: "2026-11-04",
      vendorName: "Acme Industries Pvt Ltd", poRef: "PO-2026-0412",
      currency: "INR", subtotal: 185000, tax: 33300, total: 218300,
      lines: [{ sku: "CMP-100", description: "Compressor unit, 2HP", qty: 10, unitPrice: 18500 }],
      extraction: { textLayer: true, source: "pdf-text" },
    },
  },
  {
    id: "dup-format",
    label: "Edge 1 - same invoice, different formatting",
    file: "samples/invoice-duplicate.pdf",
    breaks: "An exact-string duplicate check. 'ACM-9001' and 'acm 9001' are the same invoice; " +
            "a string comparison pays it twice.",
    invoice: {
      invoiceNo: "acm 9001", invoiceDate: "2026-11-06",
      vendorName: "ACME INDUSTRIES PRIVATE LIMITED", poRef: "PO-2026-0412",
      currency: "INR", subtotal: 185000, tax: 33300, total: 218300,
      lines: [{ sku: "CMP-100", description: "Compressor unit, 2HP", qty: 10, unitPrice: 18500 }],
      extraction: { textLayer: true, source: "pdf-text" },
    },
  },
  {
    id: "po-split",
    label: "Edge 2 - split billing that exceeds the PO",
    file: "samples/invoice-split.pdf",
    breaks: "Checking each invoice against the PO on its own. Both invoices are individually " +
            "inside PO-2026-0455; together they are over it.",
    invoice: {
      invoiceNo: "NOV-5540", invoiceDate: "2026-11-10",
      vendorName: "Nova Components Limited", poRef: "PO-2026-0455",
      currency: "INR", subtotal: 40300, tax: 7254, total: 47554,
      lines: [{ sku: "BRG-7", description: "Bearing assembly", qty: 130, unitPrice: 310 }],
      extraction: { textLayer: true, source: "pdf-text" },
    },
    // Loaded into history first so the cumulative check has something to see.
    priorHistory: [{
      invoiceNo: "NOV-5521", vendorName: "Nova Components Limited", poRef: "PO-2026-0455",
      total: 31720, decision: "AUTO_APPROVE", processedAt: "2026-11-02 10:14",
    }],
  },
  {
    id: "unit-price",
    label: "Edge 3 - total looks fine, unit price is not",
    file: "samples/invoice-unitprice.pdf",
    breaks: "A tolerance applied to the invoice total. Fewer units at an inflated price keeps the " +
            "total under the PO, so a total-based check passes an overbill.",
    invoice: {
      invoiceNo: "ACM-9102", invoiceDate: "2026-11-12",
      vendorName: "Acme Industries Pvt Ltd", poRef: "PO-2026-0412",
      currency: "INR", subtotal: 42000, tax: 7560, total: 49560,
      lines: [{ sku: "FLT-220", description: "Inline filter cartridge", qty: 40, unitPrice: 1050 }],
      extraction: { textLayer: true, source: "pdf-text" },
    },
  },
  {
    id: "scanned",
    label: "Edge 4 - scanned image, nothing to read",
    file: "samples/invoice-scanned.pdf",
    breaks: "Any pipeline that assumes a PDF has text. This one has none, so the honest output is " +
            "a route to a human, not a guess.",
    invoice: {
      invoiceNo: null, invoiceDate: null, vendorName: null, poRef: null,
      currency: null, subtotal: null, tax: null, total: null, lines: [],
      extraction: { textLayer: false, source: "image-only" },
    },
  },
];
