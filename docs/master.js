/* The procurement side: approved vendors and open purchase orders.
 * Seeded, not real. In production this is an ERP read; the engine does not
 * care where it comes from, which is why it takes it as an argument. */
export const MASTER = {
  vendors: [
    { name: "Acme Industries Pvt Ltd",   gstin: "29AABCA1234F1Z5", blocked: false },
    { name: "Nova Components Limited",   gstin: "29AACCN9876K1Z2", blocked: false },
    { name: "Orbit Facilities Services", gstin: "29AADCO5555P1Z9", blocked: true,
      blockReason: "payment hold pending GST registration review" },
    { name: "Vertex Packaging Pvt Ltd",  gstin: "29AAECV4444M1Z1", blocked: false },
  ],
  purchaseOrders: [
    { poNumber: "PO-2026-0412", vendorName: "Acme Industries Pvt Ltd",
      lines: [
        { sku: "CMP-100", description: "Compressor unit, 2HP", qty: 10, unitPrice: 18500 },
        { sku: "FLT-220", description: "Inline filter cartridge", qty: 40, unitPrice: 950 },
      ] },
    { poNumber: "PO-2026-0455", vendorName: "Nova Components Limited",
      lines: [
        { sku: "BRG-7", description: "Bearing assembly", qty: 200, unitPrice: 310 },
      ] },
    { poNumber: "PO-2026-0501", vendorName: "Vertex Packaging Pvt Ltd",
      lines: [
        { sku: "BOX-A4", description: "Corrugated carton A4", qty: 5000, unitPrice: 22 },
      ] },
  ],
};
