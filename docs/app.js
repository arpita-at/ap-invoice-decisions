import { processInvoice, DECISION, POLICY } from "./engine.js";
import { MASTER } from "./master.js";
import { normaliseInvoiceNo, normaliseVendor } from "./engine.js";
import { SAMPLES } from "./samples.js";
import { pdfToLines, parseInvoice } from "./extract.js";

const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs";
const WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";
const KEY = "ap-invoice-runs-v1";

const $ = s => document.querySelector(s);
const money = n => n == null ? "-" : Number(n).toLocaleString("en-IN",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));

/* History lives in localStorage so the duplicate and cumulative-PO checks have
 * something to see across runs. Wrapped because storage throws in private mode
 * and the page has to work regardless. */
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = h => { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* ignore */ } };

let pdfjsLib = null;
async function pdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import(PDFJS_SRC);
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  }
  return pdfjsLib;
}

/* ---------- the live run view ---------- */

async function runInvoice(inv, label) {
  $("#runPanel").hidden = false;
  $("#extractPanel").hidden = false;
  $("#comparePanel").hidden = true;
  $("#todo").hidden = true;
  $("#idle").hidden = true;
  $("#prog").firstElementChild.style.right = "100%";
  const ul = $("#run");
  ul.innerHTML = "";
  $("#verdict").className = "verdict running";
  $("#verdict").innerHTML = `<div class="ico">·</div><div><div class="big">Running</div>
    <div class="sm">${esc(label || "")}</div></div>`;

  renderExtract(inv);

  const result = processInvoice(inv, MASTER, load());

  // Stages are revealed one at a time so the run is visible rather than a
  // result appearing fully formed. The decision is already computed; this is
  // presentation, and the demo should say so.
  let step = 0;
  for (const st of result.stages) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="dot RUN">·</div><div class="stage"><b>${esc(st.name)}</b></div>`;
    ul.appendChild(li);
    await wait(380);
    const mark = st.status === "PASS" ? "✓" : st.status === "FAIL" ? "✕"
      : st.status === "SKIPPED" ? "–" : "!";
    li.innerHTML = `<div class="dot ${st.status}">${mark}</div><div class="stage">
      <b>${esc(st.name)}</b>
      ${st.note ? `<div class="note">${esc(st.note)}</div>` : ""}
      ${st.findings.map(f => `<div class="f ${f.severity}">
         <span class="code">${esc(f.code)}</span>
         <div>${esc(f.message)}</div>
         ${f.detail ? `<div class="d">${esc(f.detail)}</div>` : ""}</div>`).join("")}
    </div>`;
    step++;
    $("#prog").firstElementChild.style.right = (100 - (step / result.stages.length) * 100) + "%";
  }

  const words = { AUTO_APPROVE: "Approve for payment", HOLD_FOR_REVIEW: "Hold for review",
                  REJECT: "Do not pay" };
  const icons = { AUTO_APPROVE: "✓", HOLD_FOR_REVIEW: "!", REJECT: "✕" };
  const sub = result.reasons.length
    ? `${result.reasons.length} finding${result.reasons.length > 1 ? "s" : ""}`
    : "Vendor approved, no duplicate, arithmetic consistent, matched to the PO within tolerance.";
  $("#verdict").className = "verdict " + result.decision;
  $("#verdict").innerHTML = `<div class="ico">${icons[result.decision]}</div><div>
    <div class="big">${words[result.decision]}</div>
    <div class="sm">${esc(sub)}</div>
    ${result.reasons.length ? `<div class="chips">${result.reasons
        .map(r => `<span class="chip">${esc(r)}</span>`).join("")}</div>` : ""}</div>`;

  renderTodo(result);
  renderCompare(inv);

  const hist = load();
  hist.unshift({
    invoiceNo: inv.invoiceNo, vendorName: inv.vendorName, poRef: inv.poRef,
    total: inv.total, decision: result.decision,
    reasons: result.reasons, processedAt: result.processedAt,
  });
  save(hist);
  renderDash();
  return result;
}

/* Turns the decision into the sentence an AP clerk would act on. */
function renderTodo(result) {
  const el = $("#todo");
  const first = result.findings.find(f => f.severity === "REJECT")
             || result.findings.find(f => f.severity === "HOLD");
  let title, msg;
  if (result.decision === DECISION.APPROVE) {
    title = "What happens next";
    msg = "<b>Nothing to do.</b> This invoice can go through to payment. Every check passed and " +
          "the trail below is the evidence.";
  } else if (result.decision === DECISION.HOLD) {
    title = "What you need to do";
    msg = "<b>Check this one by hand before paying.</b> " + esc(first ? first.message : "") +
          " Someone has to read the document and confirm the figures.";
  } else {
    title = "What you need to do";
    msg = "<b>Do not pay this.</b> " + esc(first ? first.message : "") +
          " Send it back to the vendor with that reason.";
  }
  el.hidden = false;
  el.innerHTML = `<div><div class="t">${title}</div><div class="m">${msg}</div></div>`;
}

/* Billed against agreed, line by line, so the failing number is visible rather
 * than only described in a finding. */
function renderCompare(inv) {
  if (!inv.poRef || !inv.lines || !inv.lines.length) return;
  const po = MASTER.purchaseOrders.find(p =>
    normaliseInvoiceNo(p.poNumber) === normaliseInvoiceNo(inv.poRef));
  if (!po) return;
  const rows = inv.lines.map(l => {
    const pl = po.lines.find(x => x.sku === l.sku);
    if (!pl) return `<tr><td class="l">${esc(l.sku)}</td><td class="l">${esc(l.description || "")}</td>
      <td>${l.qty}</td><td>${money(l.unitPrice)}</td>
      <td colspan="3" class="bad-cell">not on ${esc(po.poNumber)}</td></tr>`;
    const over = l.unitPrice > pl.unitPrice;
    const diff = pl.unitPrice ? ((l.unitPrice - pl.unitPrice) / pl.unitPrice) * 100 : 0;
    return `<tr>
      <td class="l">${esc(l.sku)}</td><td class="l">${esc(l.description || "")}</td>
      <td>${l.qty}</td>
      <td class="${over ? "bad-cell" : "ok-cell"}">${money(l.unitPrice)}</td>
      <td>${pl.qty}</td><td>${money(pl.unitPrice)}</td>
      <td class="${over ? "bad-cell" : ""}">${diff === 0 ? "same"
        : (diff > 0 ? "+" : "") + diff.toFixed(1) + "%"}</td></tr>`;
  }).join("");
  $("#compare").innerHTML = `<thead><tr>
    <th class="l">SKU</th><th class="l">Description</th>
    <th>Billed qty</th><th>Billed price</th>
    <th>PO qty</th><th>PO price</th><th>Price diff</th></tr></thead><tbody>${rows}</tbody>`;
  $("#comparePanel").hidden = false;
}

function renderExtract(inv) {
  const rows = [
    ["Invoice number", inv.invoiceNo], ["Invoice date", inv.invoiceDate],
    ["Vendor", inv.vendorName], ["Purchase order", inv.poRef],
    ["Currency", inv.currency], ["Subtotal", inv.subtotal == null ? null : money(inv.subtotal)],
    ["Tax", inv.tax == null ? null : money(inv.tax)],
    ["Total", inv.total == null ? null : money(inv.total)],
    ["Text layer", inv.extraction?.textLayer ? "yes" : "no — image only"],
  ];
  $("#extract").innerHTML = rows.map(([k, v]) =>
    `<div class="fld"><div class="k">${esc(k)}</div><div class="v">${
      v == null || v === "" ? "<em>not readable</em>" : esc(v)}</div></div>`).join("");
  const t = $("#extractLines");
  if (!inv.lines || !inv.lines.length) { t.innerHTML = ""; return; }
  t.innerHTML = "<thead><tr><th>SKU</th><th>Description</th><th>Qty</th><th>Unit price</th>"
    + "<th>Amount</th></tr></thead><tbody>"
    + inv.lines.map(l => `<tr><td>${esc(l.sku)}</td><td class="l">${esc(l.description || "")}</td>
        <td>${l.qty}</td><td>${money(l.unitPrice)}</td><td>${money(l.qty * l.unitPrice)}</td></tr>`).join("")
    + "</tbody>";
}

/* ---------- dashboard ---------- */

function renderDash() {
  const h = load();
  const n = d => h.filter(x => x.decision === d).length;
  $("#tiles").innerHTML = [
    ["Runs", h.length, ""], ["Approved", n(DECISION.APPROVE), "ok"],
    ["Held", n(DECISION.HOLD), "warn"], ["Rejected", n(DECISION.REJECT), "bad"],
    ["Value approved", money(h.filter(x => x.decision === DECISION.APPROVE)
      .reduce((a, x) => a + (x.total || 0), 0)), ""],
  ].map(([k, v, c]) => `<div class="tile ${c}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  const t = $("#hist");
  $("#histEmpty").hidden = h.length > 0;
  if (!h.length) { t.innerHTML = ""; return; }
  t.innerHTML = "<thead><tr><th>Invoice</th><th>Vendor</th><th>PO</th><th>Total</th>"
    + "<th>Decision</th><th>Why</th><th>When</th></tr></thead><tbody>"
    + h.map(x => `<tr>
        <td class="l">${esc(x.invoiceNo || "—")}</td>
        <td class="l">${esc(x.vendorName || "—")}</td>
        <td class="l">${esc(x.poRef || "—")}</td>
        <td>${money(x.total)}</td>
        <td><span class="pill ${x.decision}">${x.decision.replace(/_/g, " ")}</span></td>
        <td class="l">${esc((x.reasons || []).join(" · ") || "—")}</td>
        <td>${esc(x.processedAt)}</td></tr>`).join("") + "</tbody>";
}

function renderMaster() {
  $("#vendors").innerHTML = "<thead><tr><th>Vendor</th><th>GSTIN</th><th>Status</th></tr></thead><tbody>"
    + MASTER.vendors.map(v => `<tr><td class="l">${esc(v.name)}</td><td>${esc(v.gstin)}</td>
       <td>${v.blocked ? `<span class="pill REJECT">blocked</span> ${esc(v.blockReason)}` : "approved"}</td></tr>`).join("")
    + "</tbody>";
  $("#pos").innerHTML = "<thead><tr><th>PO</th><th>Vendor</th><th>SKU</th><th>Qty</th>"
    + "<th>Unit price</th><th>Line value</th></tr></thead><tbody>"
    + MASTER.purchaseOrders.flatMap(p => p.lines.map((l, i) => `<tr>
        <td class="l">${i ? "" : esc(p.poNumber)}</td><td class="l">${i ? "" : esc(p.vendorName)}</td>
        <td>${esc(l.sku)}</td><td>${l.qty}</td><td>${money(l.unitPrice)}</td>
        <td>${money(l.qty * l.unitPrice)}</td></tr>`)).join("") + "</tbody>";
}

/* ---------- wiring ---------- */

function showTab(id) {
  for (const [tab, view] of [["tab-run", "view-run"], ["tab-dash", "view-dash"], ["tab-data", "view-data"]]) {
    const on = tab === id;
    $("#" + tab).setAttribute("aria-selected", String(on));
    $("#" + view).hidden = !on;
  }
}
["tab-run", "tab-dash", "tab-data"].forEach(id => $("#" + id).onclick = () => showTab(id));

$("#cases").innerHTML = SAMPLES.map(s => {
  const edge = s.id !== "happy";
  const [head, ...rest] = s.label.split(" - ");
  return `<button class="case" data-id="${s.id}">
    <span class="tag ${edge ? "edge" : "base"}">${edge ? head.replace("Edge ", "E") : "Base"}</span>
    <span><b>${esc(rest.join(" - ") || head)}</b><span>${esc(s.file.split("/").pop())}</span></span>
  </button>`;}).join("");

$("#cases").onclick = async e => {
  const b = e.target.closest(".case");
  if (!b) return;
  const s = SAMPLES.find(x => x.id === b.dataset.id);
  $("#cases").querySelectorAll(".case").forEach(c => c.removeAttribute("aria-current"));
  b.setAttribute("aria-current", "true");
  $("#breaks").hidden = !s.breaks;
  if (s.breaks) $("#breaks").innerHTML = `<strong>What this breaks:</strong> ${esc(s.breaks)}`;
  // The split-PO case needs its earlier invoice on the PO to exist, or there is
  // nothing cumulative to detect. Seed it once if it is not already there.
  if (s.priorHistory) {
    const h = load();
    for (const p of s.priorHistory) {
      if (!h.some(x => x.invoiceNo === p.invoiceNo)) h.push(p);
    }
    save(h);
  }
  // Parse the real PDF rather than using the pre-parsed object, so the demo
  // shows extraction actually happening.
  try {
    const res = await fetch(s.file);
    const blob = await res.blob();
    const lib = await pdfjs();
    const lines = await pdfToLines(new File([blob], s.file), lib);
    await runInvoice(parseInvoice(lines), s.label);
  } catch (err) {
    await runInvoice(structuredClone(s.invoice), s.label + " (bundled parse)");
  }
};

const drop = $("#drop"), file = $("#file");
drop.onclick = () => file.click();
drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = async e => {
  e.preventDefault(); drop.classList.remove("over");
  if (e.dataTransfer.files[0]) await handle(e.dataTransfer.files[0]);
};
file.onchange = async () => { if (file.files[0]) await handle(file.files[0]); };

async function handle(f) {
  $("#breaks").hidden = true;
  const lib = await pdfjs();
  const lines = await pdfToLines(f, lib);
  await runInvoice(parseInvoice(lines), f.name);
}

$("#clear").onclick = () => { save([]); renderDash(); };
$("#seed").onclick = async () => {
  save([]);
  showTab("tab-run");
  for (const s of SAMPLES) {
    $("#cases").querySelector(`[data-id="${s.id}"]`).click();
    await wait(2600);
  }
  showTab("tab-dash");
};

renderDash();
renderMaster();
