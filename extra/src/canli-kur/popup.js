const CURRENCY_ITEMS = [
  { key: "USD", name: "USD", backupKey: "USD" },
  { key: "EUR", name: "EUR", backupKey: "EUR" },
  { key: "GBP", name: "GBP", backupKey: "GBP" },
  { key: "CHF", name: "CHF", backupKey: "CHF" },
  { key: "CAD", name: "CAD", backupKey: "CAD" },
  { key: "JPY", name: "JPY", backupKey: "JPY" },
];

const GOLD_ITEMS = [
  {
    key: "GRAM",
    name: "Gram Altın",
    sourceKeys: ["gram-altin", "GRA", "GRAMALTIN", "Gram Altın"],
    backupKey: "GA",
  },
  {
    key: "CEYREK",
    name: "Çeyrek Altın",
    sourceKeys: ["ceyrek-altin", "CEYREKALTIN", "Çeyrek Altın"],
    backupKey: "C",
  },
  {
    key: "YARIM",
    name: "Yarım Altın",
    sourceKeys: ["yarim-altin", "YARIMALTIN", "Yarım Altın"],
    backupKey: "Y",
  },
  {
    key: "TAM",
    name: "Tam Altın",
    sourceKeys: ["tam-altin", "TAMALTIN", "Tam Altın"],
    backupKey: "T",
  },
  {
    key: "CUMHURIYET",
    name: "Cumhuriyet Altını",
    sourceKeys: [
      "cumhuriyet-altini",
      "CUMHURIYETALTINI",
      "Cumhuriyet Altını",
    ],
    backupKey: "CMR",
  },
  {
    key: "ATA",
    name: "Ata Altın",
    sourceKeys: ["ata-altin", "ATAALTIN", "Ata Altın"],
    backupKey: "ATA",
  },
  {
    key: "AYAR22",
    name: "22 Ayar Bilezik",
    sourceKeys: ["22-ayar-bilezik", "22AYARBILEZIK", "22 Ayar Bilezik"],
    backupKey: "22",
  },
];

const ALL_ITEMS = [
  ...CURRENCY_ITEMS.map((item) => ({ ...item, sourceKeys: [item.key] })),
  ...GOLD_ITEMS,
];

function parseMarketNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;

  let cleaned = String(value)
    .trim()
    .replace(/[%$₺\s]/g, "")
    .replace(/^\+/, "");
  if (!cleaned) return null;

  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  if (comma > dot) cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) cleaned = cleaned.replace(",", ".");

  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const buying = parseMarketNumber(entry.Buying ?? entry["Alış"] ?? entry.alis);
  const selling = parseMarketNumber(
    entry.Selling ?? entry["Satış"] ?? entry.satis,
  );
  if (buying == null || selling == null) return null;
  return {
    Buying: buying,
    Selling: selling,
    Change: parseMarketNumber(
      entry.Change ?? entry["Değişim"] ?? entry.degisim ?? entry.oran,
    ),
  };
}

function firstEntry(data, keys) {
  for (const key of keys) {
    const entry = normalizeEntry(data?.[key]);
    if (entry) return entry;
  }
  return null;
}

function normalizeTruncgil(payload) {
  const data = payload?.Rates ?? payload;
  const rates = {};
  for (const item of ALL_ITEMS) {
    const entry = firstEntry(data, item.sourceKeys);
    if (entry) rates[item.key] = entry;
  }
  return {
    rates,
    updatedAt:
      payload?.Update_Date ??
      payload?.UpdateDate ??
      payload?.["Güncelleme Tarihi"] ??
      "",
  };
}

function normalizeGenelPara(currencyPayload, goldPayload) {
  const rates = {};
  for (const item of CURRENCY_ITEMS) {
    const entry = normalizeEntry(currencyPayload?.data?.[item.backupKey]);
    if (entry) rates[item.key] = entry;
  }
  for (const item of GOLD_ITEMS) {
    const entry = normalizeEntry(goldPayload?.data?.[item.backupKey]);
    if (entry) rates[item.key] = entry;
  }
  return { rates, updatedAt: "" };
}

function missingRateKeys(rates) {
  return ALL_ITEMS.filter((item) => !rates[item.key]).map((item) => item.key);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchTruncgil() {
  const payload = await fetchJson("https://finans.truncgil.com/today.json");
  return normalizeTruncgil(payload);
}

async function fetchGenelPara() {
  const [currencyPayload, goldPayload] = await Promise.all([
    fetchJson(
      "https://api.genelpara.com/json/?list=doviz&sembol=USD,EUR,GBP,CHF,CAD,JPY",
    ),
    fetchJson(
      "https://api.genelpara.com/json/?list=altin&sembol=GA,C,Y,T,CMR,ATA,22",
    ),
  ]);
  return normalizeGenelPara(currencyPayload, goldPayload);
}

async function loadRates() {
  let primary = { rates: {}, updatedAt: "" };
  let primaryError = null;
  try {
    primary = await fetchTruncgil();
  } catch (error) {
    primaryError = error;
  }

  const primaryMissing = missingRateKeys(primary.rates);
  if (!primaryMissing.length) {
    return { ...primary, source: "Trunçgil", fallback: false, missing: [] };
  }

  try {
    const backup = await fetchGenelPara();
    const rates = { ...backup.rates, ...primary.rates };
    const missing = missingRateKeys(rates);
    if (missing.length === ALL_ITEMS.length) throw new Error("empty response");
    return {
      rates,
      updatedAt: primary.updatedAt,
      source: primaryError ? "GenelPara" : "Trunçgil + GenelPara",
      fallback: true,
      missing,
    };
  } catch (backupError) {
    const missing = missingRateKeys(primary.rates);
    if (missing.length < ALL_ITEMS.length) {
      return {
        ...primary,
        source: "Trunçgil",
        fallback: false,
        missing,
      };
    }
    throw new Error(
      `Trunçgil: ${primaryError?.message || "empty response"}; GenelPara: ${backupError.message}`,
    );
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const currencyTable = document.getElementById("doviz-table");
    const goldTable = document.getElementById("altin-table");
    const status = document.getElementById("data-status");
    const amount1 = document.getElementById("amount1");
    const amount2 = document.getElementById("amount2");
    const currency1 = document.getElementById("currency1");
    const currency2 = document.getElementById("currency2");
    let ratesTRY = { TRY: 1 };
    let ignoreEvent = false;

    const numberFormatter = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
      useGrouping: true,
    });

    function formatNumber(value) {
      return Number.isFinite(value) ? numberFormatter.format(value) : "—";
    }

    function parseAmount(value) {
      if (!value) return 0;
      const cleaned = String(value)
        .replace(/\./g, "")
        .replace(/,/g, ".")
        .replace(/[^0-9.\-]/g, "");
      const number = Number.parseFloat(cleaned);
      return Number.isFinite(number) ? number : 0;
    }

    function formatInput(input) {
      const cursor = input.selectionStart ?? input.value.length;
      const oldValue = input.value;
      const parsed = parseAmount(oldValue);
      const formatted = parsed ? numberFormatter.format(parsed) : "";
      if (formatted !== oldValue) {
        input.value = formatted;
        const nextCursor = Math.max(0, cursor + formatted.length - oldValue.length);
        input.setSelectionRange(nextCursor, nextCursor);
      }
    }

    function convert(amount, fromCurrency, toCurrency) {
      if (!ratesTRY[fromCurrency] || !ratesTRY[toCurrency]) return 0;
      const amountTRY =
        fromCurrency === "TRY" ? amount : amount * ratesTRY[fromCurrency];
      return toCurrency === "TRY"
        ? amountTRY
        : amountTRY / ratesTRY[toCurrency];
    }

    function convertFromFirst() {
      if (ignoreEvent) return;
      ignoreEvent = true;
      formatInput(amount1);
      const result = convert(
        parseAmount(amount1.value),
        currency1.value,
        currency2.value,
      );
      amount2.value = result ? numberFormatter.format(result) : "";
      ignoreEvent = false;
    }

    function convertFromSecond() {
      if (ignoreEvent) return;
      ignoreEvent = true;
      formatInput(amount2);
      const result = convert(
        parseAmount(amount2.value),
        currency2.value,
        currency1.value,
      );
      amount1.value = result ? numberFormatter.format(result) : "";
      ignoreEvent = false;
    }

    function initConverter() {
      const codes = [...CURRENCY_ITEMS.map((item) => item.key), "TRY"];
      for (const select of [currency1, currency2]) {
        select.replaceChildren(
          ...codes.map((code) => {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = code;
            return option;
          }),
        );
      }
      currency1.value = "USD";
      currency2.value = "TRY";
      amount1.addEventListener("input", convertFromFirst);
      amount2.addEventListener("input", convertFromSecond);
      currency1.addEventListener("change", convertFromFirst);
      currency2.addEventListener("change", convertFromSecond);
      amount1.addEventListener("blur", () => formatInput(amount1));
      amount2.addEventListener("blur", () => formatInput(amount2));
    }

    function createRow(item, rate) {
      const row = document.createElement("tr");
      const values = rate
        ? [
            item.name,
            formatNumber(rate.Buying),
            formatNumber(rate.Selling),
            rate.Change == null ? "—" : `%${formatNumber(rate.Change)}`,
          ]
        : [item.name, "—", "—", "—"];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }
      if (!rate) row.classList.add("unavailable");
      return row;
    }

    function populateTable(body, items, rates) {
      body.replaceChildren(
        ...items.map((item) => createRow(item, rates[item.key])),
      );
    }

    function setStatus(message, type = "") {
      status.textContent = message;
      status.className = `data-status ${type}`.trim();
    }

    initConverter();
    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.tab;
        document
          .querySelectorAll(".tab-btn")
          .forEach((item) => item.classList.toggle("active", item === button));
        document
          .querySelectorAll(".tab-content")
          .forEach((item) => item.classList.toggle("active", item.id === target));
      });
    });

    loadRates()
      .then((result) => {
        populateTable(currencyTable, CURRENCY_ITEMS, result.rates);
        populateTable(goldTable, GOLD_ITEMS, result.rates);
        for (const item of CURRENCY_ITEMS) {
          const selling = result.rates[item.key]?.Selling;
          if (Number.isFinite(selling)) ratesTRY[item.key] = selling;
        }
        convertFromFirst();

        const missingText = result.missing.length
          ? ` • ${result.missing.length} değer eksik`
          : "";
        const updatedText = result.updatedAt ? ` • ${result.updatedAt}` : "";
        setStatus(
          `Kaynak: ${result.source}${updatedText}${missingText}`,
          result.fallback || result.missing.length ? "warning" : "",
        );
      })
      .catch((error) => {
        console.error("Fiyatlar alınamadı:", error);
        populateTable(currencyTable, CURRENCY_ITEMS, {});
        populateTable(goldTable, GOLD_ITEMS, {});
        setStatus("Fiyatlar şu anda alınamıyor. Lütfen tekrar deneyin.", "error");
      });
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    ALL_ITEMS,
    loadRates,
    missingRateKeys,
    normalizeGenelPara,
    normalizeTruncgil,
    parseMarketNumber,
  };
}
