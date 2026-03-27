let recipients = [];
let stopRequested = false;

const el = (id) => document.getElementById(id);
const logBox = el("log");

function log(msg) {
  const now = new Date().toLocaleTimeString();
  logBox.textContent += `[${now}] ${msg}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function setStatus(msg) {
  el("statusText").textContent = msg;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s => s.trim().toLowerCase());
  if (header[0] !== "address" || header[1] !== "amount") {
    throw new Error("CSV header must be: address,amount");
  }
  return lines.slice(1).map((line, idx) => {
    const parts = line.split(",");
    return {
      index: idx + 1,
      address: (parts[0] || "").trim(),
      amount: (parts[1] || "").trim(),
      valid: null,
      txid: ""
    };
  });
}

function renderTable() {
  const tbody = el("tbody");
  tbody.innerHTML = "";
  let total = 0;
  recipients.forEach((r, i) => {
    total += Number(r.amount || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${r.address}</td>
      <td>${r.amount}</td>
      <td class="${r.valid === true ? 'ok' : r.valid === false ? 'bad' : ''}">
        ${r.valid === true ? 'Valid' : r.valid === false ? 'Invalid' : 'Unchecked'}
      </td>
      <td>${r.txid ? `<a href="https://tronscan.org/#/transaction/${r.txid}" target="_blank" rel="noreferrer">${r.txid.slice(0, 12)}...</a>` : '-'}</td>
    `;
    tbody.appendChild(tr);
  });
  el("rowsText").textContent = String(recipients.length);
  el("totalText").textContent = total.toLocaleString();
}

function toBaseUnits(amountStr, decimals) {
  const [whole, frac = ""] = String(amountStr).trim().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
  return combined;
}

async function ensureTronLink() {
  if (!window.tronWeb || !window.tronWeb.defaultAddress?.base58) {
    throw new Error("TronLink not connected. Open this page inside TronLink browser or connect extension first.");
  }
  return window.tronWeb;
}

async function connectWallet() {
  if (window.tronLink?.request) {
    try {
      await window.tronLink.request({ method: "tron_requestAccounts" });
    } catch (e) {}
  }
  const tronWeb = await ensureTronLink();
  el("walletText").textContent = tronWeb.defaultAddress.base58;
  setStatus("Wallet connected");
  log(`Connected wallet: ${tronWeb.defaultAddress.base58}`);
}

async function validateAddresses() {
  const tronWeb = await ensureTronLink();
  recipients = recipients.map(r => ({
    ...r,
    valid: tronWeb.isAddress(r.address) && Number(r.amount) > 0
  }));
  renderTable();
  const invalid = recipients.filter(r => !r.valid).length;
  setStatus(invalid ? `Found ${invalid} invalid row(s)` : "All rows valid");
  log(invalid ? `Validation complete. Invalid rows: ${invalid}` : "Validation complete. All rows valid.");
}

async function startAirdrop() {
  stopRequested = false;
  const tronWeb = await ensureTronLink();
  const contractAddress = el("contractAddress").value.trim();
  const decimals = Number(el("decimals").value || 6);
  const delayMs = Number(el("delayMs").value || 2500);
  const feeLimit = Number(el("feeLimit").value || 100000000);

  if (!tronWeb.isAddress(contractAddress)) {
    throw new Error("Invalid token contract address");
  }
  if (!recipients.length) {
    throw new Error("Upload CSV first");
  }
  if (recipients.some(r => r.valid !== true)) {
    throw new Error("Please validate addresses first and fix invalid rows");
  }

  const contract = await tronWeb.contract().at(contractAddress);
  setStatus("Airdrop running");
  log("Airdrop started");

  for (let i = 0; i < recipients.length; i++) {
    if (stopRequested) {
      setStatus("Stopped by user");
      log("Airdrop stopped");
      return;
    }

    const r = recipients[i];
    try {
      log(`Sending ${r.amount} tokens to ${r.address}`);
      const amountUnits = toBaseUnits(r.amount, decimals);

      const txid = await contract.transfer(r.address, amountUnits).send({
        feeLimit,
        shouldPollResponse: true
      });

      r.txid = txid;
      renderTable();
      log(`Success: ${txid}`);
      await sleep(delayMs);
    } catch (err) {
      log(`Failed for ${r.address}: ${err.message || err}`);
    }
  }

  setStatus("Completed");
  log("Airdrop completed");
}

el("connectBtn").addEventListener("click", async () => {
  try { await connectWallet(); } catch (e) { log(e.message); setStatus("Connection failed"); }
});

el("csvFile").addEventListener("change", async (evt) => {
  const file = evt.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    recipients = parseCSV(text);
    renderTable();
    setStatus("CSV loaded");
    log(`Loaded ${recipients.length} recipient rows`);
  } catch (e) {
    recipients = [];
    renderTable();
    setStatus("CSV error");
    log(e.message);
  }
});

el("sampleBtn").addEventListener("click", () => {
  const blob = new Blob(
    ["address,amount\nTV3nb5HYFe2xBEmyb3ETe93UGkjAhWyzrs,12.5\nTQeNNo5zVarhdKm5EiJSekfNXg6H1tRN4n,8\n"],
    { type: "text/csv" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sample_airdrop.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

el("validateBtn").addEventListener("click", async () => {
  try { await validateAddresses(); } catch (e) { log(e.message); setStatus("Validation failed"); }
});

el("startBtn").addEventListener("click", async () => {
  try { await startAirdrop(); } catch (e) { log(e.message); setStatus("Start failed"); }
});

el("stopBtn").addEventListener("click", () => {
  stopRequested = true;
});

window.addEventListener("load", async () => {
  if (window.tronWeb?.defaultAddress?.base58) {
    try { await connectWallet(); } catch {}
  }
});
