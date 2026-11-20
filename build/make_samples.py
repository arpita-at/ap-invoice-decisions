#!/usr/bin/env python3
"""Render the sample invoices to real PDFs with headless Chrome.

Four carry a text layer. The fifth is rasterised to a PNG and embedded as an
image, so it genuinely has no extractable text; that is what makes the scanned
edge case real rather than a flag we set by hand.
"""
import base64, json, os, subprocess, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "docs", "samples")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;color:#111;margin:0;padding:26px 30px}
h1{font-size:19pt;margin:0 0 2px}
.v{color:#444;margin:0 0 14px}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border-bottom:1px solid #ccc;padding:6px 4px;text-align:right}
th:first-child,td:first-child{text-align:left}
th{font-size:9pt;text-transform:uppercase;color:#555}
.meta td{border:none;padding:2px 0}
.tot{font-weight:bold;font-size:12pt}
.rt{text-align:right}
"""

def html(inv):
    rows = "".join(
        f"<tr><td>{l['sku']} &nbsp; {l['description']}</td><td>{l['qty']}</td>"
        f"<td>{l['unitPrice']:,.2f}</td><td>{l['qty']*l['unitPrice']:,.2f}</td></tr>"
        for l in inv["lines"])
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<h1>TAX INVOICE</h1>
<p class="v">{inv['vendorName']}</p>
<table class="meta">
<tr><td>Invoice Number</td><td class="rt">{inv['invoiceNo']}</td></tr>
<tr><td>Invoice Date</td><td class="rt">{inv['invoiceDate']}</td></tr>
<tr><td>Purchase Order</td><td class="rt">{inv['poRef']}</td></tr>
<tr><td>Currency</td><td class="rt">{inv['currency']}</td></tr>
</table>
<table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
<tbody>{rows}</tbody></table>
<table class="meta">
<tr><td class="rt">Subtotal</td><td class="rt">{inv['subtotal']:,.2f}</td></tr>
<tr><td class="rt">GST 18%</td><td class="rt">{inv['tax']:,.2f}</td></tr>
<tr><td class="rt tot">Total</td><td class="rt tot">{inv['total']:,.2f}</td></tr>
</table>
<p style="color:#666;font-size:9pt;margin-top:22px">
Synthetic document produced for a case study. Not a real invoice.</p>
</body></html>"""


def to_pdf(doc, dest, extra=None):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(doc); p = f.name
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    *(extra or []), f"--print-to-pdf={dest}", "file://" + p],
                   check=True, capture_output=True)
    os.unlink(p)


def to_png(doc, dest_png):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(doc); p = f.name
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--window-size=840,1100",
                    f"--screenshot={dest_png}", "file://" + p], check=True, capture_output=True)
    os.unlink(p)


def main():
    samples = json.load(open(os.path.join(HERE, "build", "samples.json")))
    for s in samples:
        inv = s["invoice"]
        dest = os.path.join(OUT, s["out"])
        if s["id"] == "scanned":
            # Rasterise, then wrap the image in a PDF. No text survives, which
            # is the whole point of this case.
            png = dest.replace(".pdf", ".png")
            to_png(html(s["render"]), png)
            b64 = base64.b64encode(open(png, "rb").read()).decode()
            os.remove(png)
            wrapper = ("<!doctype html><html><head><meta charset='utf-8'>"
                       "<style>@page{margin:0}body{margin:0}img{width:100%;display:block;"
                       "filter:grayscale(1) contrast(1.08)}</style></head>"
                       f"<body><img src='data:image/png;base64,{b64}'></body></html>")
            to_pdf(wrapper, dest)
        else:
            to_pdf(html(inv), dest)
        print("wrote", os.path.basename(dest))


if __name__ == "__main__":
    main()
