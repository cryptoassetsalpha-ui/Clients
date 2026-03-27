
let recipients = [];
let stopRequested = false;
let isRunning = false;

const $ = (id) => document.getElementById(id);

function log(msg) {
  const box = $("log");
  const now = new Date().toLocaleTimeString();
  box.textContent += `[${now}] ${msg}\n`;
  box.scrollTop = box.scrollHeight;
}

function setStatus(msg) {
  $("statusText").textContent = msg;
}

function setWallet(msg) {
  $("walletText").textContent = msg;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tronAvailable() {
  return !!(window.tronWeb && window.tronWeb.defaultAddress);
}

function getReadyTronWeb() {
  if (!tronAvailable()) {
    throw new Error("TronLink not detected. Open this page in TronLink browser or Chrome with TronLink extension.");
  }
  return window.tronWeb;
}

async function connectWallet() {
  try {
    if (window.tronLink && typeof window.tronLink.request === "function") {
      await window.tronLink.request({ method: "tron_requestAccounts" });
      await sleep(600);
    }
  } catch (e) {
    log("Wallet popup closed or denied.");
  }

  const tronWeb = getReadyTronWeb();
  const addr = tronWeb.defaultAddress?.base58;
  if (!addr) throw new Error("Wallet address not available.");
  setWallet(addr);
  setStatus("Wallet connected");
  log(`Connected wallet: ${addr}`);
  return tronWeb;
}

async function refreshWallet() {
  try {
    const tronWeb = getReadyTronWeb();
    const addr = tronWeb.defaultAddress?.base58 || "Not connected";
    setWallet(addr);
    setStatus(addr === "Not connected" ? "Wallet not connected" : "Wallet ready");
    if (addr !== "Not connected") log(`Wallet detected: ${addr}`);
  } catch (e) {
    setWallet("Not connected");
    setStatus("TronLink missing");
    log(e.message);
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error("CSV is empty");
  const header = lines[0].split(",").map(x => x.trim().toLowerCase());
  if (header[0] !== "address" || header[1] !== "amount") {
    throw new Error("CSV header must be exactly: address,amount");
  }

  return lines.slice(1).map((line, idx) => {
    const parts = line.split(",");
    return {
      index: idx + 1,
      address: (parts[0] || "").trim(),
      amount: (parts[1] || "").trim(),
      valid: null,
      result: "pending",
      txid: "",
      error: ""
    };
  });
}

function toBaseUnits(amountStr, decimals) {
  const clean = String(amountStr).trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error(`Invalid amount: ${amountStr}`);
  const [whole, frac = ""] = clean.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
  return combined;
}

function validationHtml(v) {
  if (v === true) return '<span class="ok">Valid</span>';
  if (v === false) return '<span class="bad">Invalid</span>';
  return '<span class="warn">Unchecked</span>';
}

function resultHtml(r) {
  if (r === "success") return '<span class="ok">Success</span>';
  if (r === "failed") return '<span class="bad">Failed</span>';
  if (r === "running") return '<span class="warn">Running</span>';
  return '<span class="warn">Pending</span>';
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTable() {
  const tbody = $("tbody");
  tbody.innerHTML = "";

  let total = 0;
  let success = 0;
  let failed = 0;
  let validated = 0;
  let unchecked = 0;

  recipients.forEach((r, idx) => {
    total += Number(r.amount || 0);
    if (r.result === "success") success += 1;
    if (r.result === "failed") failed += 1;
    if (r.valid === true || r.valid === false) validated += 1;
    if (r.valid === null) unchecked += 1;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(r.address)}</td>
      <td>${escapeHtml(String(r.amount))}</td>
      <td>${validationHtml(r.valid)}</td>
      <td>${resultHtml(r.result)}</td>
      <td>${r.txid ? `<a href="https://tronscan.org/#/transaction/${r.txid}" target="_blank" rel="noreferrer">${r.txid.slice(0, 14)}...</a>` : "-"}</td>
      <td>${escapeHtml(r.error || "-")}</td>
    `;
    tbody.appendChild(tr);
  });

  $("rowsText").textContent = String(recipients.length);
  $("totalText").textContent = total.toLocaleString();
  $("successText").textContent = String(success);
  $("failedText").textContent = String(failed);
  $("validatedText").textContent = String(validated);
  $("uncheckedText").textContent = String(unchecked);
}

function setBusy(flag) {
  isRunning = flag;
  const ids = ["connectBtn","refreshBtn","sampleBtn","loadBtn","validateBtn","startBtn","retryFailedBtn","csvFile"];
  ids.forEach(id => {
    const el = $(id);
    if (el) el.disabled = flag;
  });
  $("stopBtn").disabled = !flag;
}

async function loadCsvFromInput() {
  const file = $("csvFile").files?.[0];
  if (!file) throw new Error("Please choose a CSV file first.");
  const text = await file.text();
  recipients = parseCSV(text);
  renderTable();
  setStatus("CSV loaded");
  log(`Loaded ${recipients.length} row(s) from CSV.`);
}

async function validateRows() {
  if (!recipients.length) throw new Error("Load CSV first.");
  const tronWeb = await connectWallet();
  let invalid = 0;

  recipients = recipients.map(r => {
    const ok = tronWeb.isAddress(r.address) && Number(r.amount) > 0;
    if (!ok) invalid += 1;
    return {
      ...r,
      valid: ok,
      result: ok ? r.result : "failed",
      error: ok ? r.error : "Invalid address or amount"
    };
  });

  renderTable();
  if (invalid) {
    setStatus(`Found ${invalid} invalid row(s)`);
    log(`Validation complete. Invalid rows: ${invalid}`);
  } else {
    setStatus("All rows valid");
    log("Validation complete. All rows valid.");
  }
}

async function runRows(rowsToRun, retryOnly = false) {
  const tronWeb = await connectWallet();
  const contractAddress = $("contractAddress").value.trim();
  const decimals = Number($("decimals").value || 6);
  const delayMs = Number($("delayMs").value || 2200);
  const feeLimit = Number($("feeLimit").value || 100000000);
  const batchSize = Math.max(1, Number($("batchSize").value || 100));

  if (!tronWeb.isAddress(contractAddress)) throw new Error("Invalid token contract address.");
  if (!rowsToRun.length) throw new Error(retryOnly ? "No failed rows to retry." : "No rows to send.");

  setBusy(true);
  stopRequested = false;
  setStatus(retryOnly ? "Retry running" : "Airdrop running");
  log(`Using contract: ${contractAddress}`);

  try {
    const contract = await tronWeb.contract().at(contractAddress);
    let processed = 0;

    for (let i = 0; i < rowsToRun.length; i++) {
      if (stopRequested) {
        setStatus("Stopped");
        log("Stopped by user.");
        break;
      }

      const row = rowsToRun[i];
      row.result = "running";
      row.error = "";
      renderTable();

      try {
        const baseAmount = toBaseUnits(row.amount, decimals);
        log(`Sending ${row.amount} AEDT to ${row.address}`);
        const txid = await contract.transfer(row.address, baseAmount).send({
          feeLimit: feeLimit,
          callValue: 0,
          shouldPollResponse: true
        });
        row.txid = txid;
        row.result = "success";
        row.error = "";
        log(`Success: ${txid}`);
      } catch (err) {
        row.result = "failed";
        row.error = err?.message || String(err);
        log(`Failed for ${row.address}: ${row.error}`);
      }

      processed += 1;
      renderTable();

      if (processed % batchSize === 0 && i < rowsToRun.length - 1) {
        log(`Batch checkpoint reached: ${processed} processed.`);
      }

      if (i < rowsToRun.length - 1) {
        await sleep(delayMs);
      }
    }

    if (!stopRequested) {
      setStatus(retryOnly ? "Retry completed" : "Completed");
      log(retryOnly ? "Retry completed." : "Airdrop completed.");
    }
  } finally {
    setBusy(false);
  }
}

function downloadCsv(filename, rows) {
  const header = "address,amount,validation,result,txid,error\n";
  const body = rows.map(r => {
    const vals = [
      r.address,
      r.amount,
      r.valid === true ? "valid" : r.valid === false ? "invalid" : "unchecked",
      r.result || "",
      r.txid || "",
      (r.error || "").replaceAll(",", ";").replaceAll("\n", " ")
    ];
    return vals.join(",");
  }).join("\n");

  const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

window.addEventListener("load", async () => {
  $("sampleBtn").addEventListener("click", () => {
    const sample = "address,amount\nTV3nb5HYFe2xBEmyb3ETe93UGkjAhWyzrs,12.5\nTQeNNo5zVarhdKm5EiJSekfNXg6H1tRN4n,8\n";
    const blob = new Blob([sample], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sample_airdrop.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  });

  $("loadBtn").addEventListener("click", async () => {
    try {
      await loadCsvFromInput();
      alert("CSV loaded successfully.");
    } catch (err) {
      log(err.message);
      setStatus("CSV load failed");
      alert(err.message);
    }
  });

  $("validateBtn").addEventListener("click", async () => {
    try {
      await validateRows();
      alert("Validation complete.");
    } catch (err) {
      log(err.message);
      setStatus("Validation failed");
      alert(err.message);
    }
  });

  $("connectBtn").addEventListener("click", async () => {
    try {
      await connectWallet();
      alert("TronLink connected successfully.");
    } catch (err) {
      log(err.message);
      setStatus("Connection failed");
      alert(err.message);
    }
  });

  $("refreshBtn").addEventListener("click", refreshWallet);

  $("startBtn").addEventListener("click", async () => {
    try {
      if (!recipients.length) throw new Error("Load CSV first.");
      if (recipients.some(r => r.valid !== true)) throw new Error("Validate rows first. Invalid or unchecked rows found.");
      await runRows(recipients.filter(r => r.valid === true), false);
      alert("Airdrop flow finished. Check log and export CSV if needed.");
    } catch (err) {
      log(err.message);
      setStatus("Start failed");
      alert(err.message);
    }
  });

  $("retryFailedBtn").addEventListener("click", async () => {
    try {
      const failedRows = recipients.filter(r => r.result === "failed" && r.valid === true);
      await runRows(failedRows, true);
      alert("Retry flow finished.");
    } catch (err) {
      log(err.message);
      setStatus("Retry failed");
      alert(err.message);
    }
  });

  $("stopBtn").addEventListener("click", () => {
    stopRequested = true;
    log("Stop requested.");
    setStatus("Stopping...");
  });

  $("exportSuccessBtn").addEventListener("click", () => {
    downloadCsv("success_rows.csv", recipients.filter(r => r.result === "success"));
  });

  $("exportFailBtn").addEventListener("click", () => {
    downloadCsv("failed_rows.csv", recipients.filter(r => r.result === "failed"));
  });

  $("exportAllBtn").addEventListener("click", () => {
    downloadCsv("all_rows_status.csv", recipients);
  });

  $("clearLogBtn").addEventListener("click", () => {
    $("log").textContent = "";
  });

  $("stopBtn").disabled = true;
  await refreshWallet();
  renderTable();

  if (!tronAvailable()) {
    log("TronLink not detected on page load.");
  }
});
