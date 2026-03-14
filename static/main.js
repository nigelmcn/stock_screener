let cachedData = null;
let selectedTicker = null;

// sort state for RS table
let sortKey = "RS";
let sortAsc = false;

document.addEventListener("DOMContentLoaded", () => {
  const startInput = document.getElementById("start-date");
  const endInput = document.getElementById("end-date");
  const refreshButton = document.getElementById("refresh-button");

  refreshButton.addEventListener("click", () => {
    fetchData(startInput.value, endInput.value);
  });

  document.querySelectorAll("#rs-table thead th[data-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = true;
      }
      renderTable();
      setDefaultSelectionAndRenderCharts();
    });
  });

  fetchData(startInput.value, endInput.value);
});

function fetchData(startDate, endDate) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = "Loading...";
  axios
    .get("/api/data", { params: { start_date: startDate, end_date: endDate } })
    .then((response) => {
      cachedData = response.data;
      statusEl.textContent =
        "Loaded range: " + cachedData.start_date + " to " + cachedData.end_date;
      renderTable();
      setDefaultSelectionAndRenderCharts();
    })
    .catch((error) => {
      console.error(error);
      statusEl.textContent = "Error loading data: " + error;
    });
}

function getSortedRows() {
  if (!cachedData || !cachedData.rs_table) return [];
  const rs = [...cachedData.rs_table];

  rs.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === undefined || bv === undefined) return 0;

    if (typeof av === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    } else {
      return sortAsc ? av - bv : bv - av;
    }
  });

  return rs;
}

function renderTable() {
  const table = document.getElementById("rs-table");
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  const rows = getSortedRows();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.dataset.ticker = row.Ticker;

    // highlight QQQ (orange) and SPY (green) to match charts
    if (row.Ticker === "QQQ") {
      tr.style.backgroundColor = "#fff3e0"; // light orange
      tr.style.fontWeight = "bold";
    } else if (row.Ticker === "SPY") {
      tr.style.backgroundColor = "#e8f5e9"; // light green
      tr.style.fontWeight = "bold";
    }

    const cols = [
      row.Ticker,
      row.OpenPrice.toFixed ? row.OpenPrice.toFixed(2) : row.OpenPrice,
      row.ClosePrice.toFixed ? row.ClosePrice.toFixed(2) : row.ClosePrice,
      (row.StockReturn * 100).toFixed(2),
      (row.PctVsQQQ * 100).toFixed(2),
      (row.PctVsSPY * 100).toFixed(2),
    ];

    cols.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });

    tr.addEventListener("click", () => {
      selectedTicker = row.Ticker;
      clearRowSelection();
      tr.classList.add("selected-row");
      renderRelativeChart();
      renderDeviationChart();
    });

    tbody.appendChild(tr);
  });
}

function clearRowSelection() {
  document
    .querySelectorAll(".selected-row")
    .forEach((el) => el.classList.remove("selected-row"));
}

function setDefaultSelectionAndRenderCharts() {
  const rows = getSortedRows();
  if (rows.length > 0) {
    selectedTicker = rows[0].Ticker;
  } else {
    selectedTicker = null;
  }

  clearRowSelection();
  if (selectedTicker) {
    const selector = "tr[data-ticker='" + selectedTicker + "']";
    const row = document.querySelector(selector);
    if (row) row.classList.add("selected-row");
  }

  renderRelativeChart();
  renderDeviationChart();
}

// helper to align stock and both indexes on common dates
function alignSeriesMulti(stockDates, stockVals, idxDates, qqqVals, spyVals) {
  const idxMap = {};
  idxDates.forEach((d, i) => {
    idxMap[d] = { qqq: qqqVals[i], spy: spyVals[i] };
  });
  const dates = [];
  const sVals = [];
  const iValsQQQ = [];
  const iValsSPY = [];
  stockDates.forEach((d, i) => {
    const rec = idxMap[d];
    if (rec !== undefined) {
      dates.push(d);
      sVals.push(stockVals[i]);
      iValsQQQ.push(rec.qqq);
      iValsSPY.push(rec.spy);
    }
  });
  return { dates, sVals, iValsQQQ, iValsSPY };
}

// chart 1: stock vs QQQ vs SPY % change
function renderRelativeChart() {
  if (!cachedData || !selectedTicker) return;
  const ph = cachedData.price_history[selectedTicker];
  if (!ph) return;
  const idx = cachedData.index;

  const { dates, sVals, iValsQQQ, iValsSPY } = alignSeriesMulti(
    ph.dates,
    ph.values,
    idx.dates,
    idx.QQQ,
    idx.SPY,
  );
  if (dates.length === 0) return;

  const stock0 = sVals[0];
  const qqq0 = iValsQQQ[0];
  const spy0 = iValsSPY[0];

  const stockPct = sVals.map((v) => (v / stock0 - 1) * 100);
  const qqqPct = iValsQQQ.map((v) => (v / qqq0 - 1) * 100);
  const spyPct = iValsSPY.map((v) => (v / spy0 - 1) * 100);

  const markerStyle = { size: 4 };

  const stockTrace = {
    x: dates,
    y: stockPct,
    mode: "lines+markers",
    marker: markerStyle,
    name: selectedTicker,
  };
  const qqqTrace = {
    x: dates,
    y: qqqPct,
    mode: "lines+markers",
    marker: markerStyle,
    name: "QQQ",
    line: { color: "#fb8c00" },
  };
  const spyTrace = {
    x: dates,
    y: spyPct,
    mode: "lines+markers",
    marker: markerStyle,
    name: "SPY",
    line: { color: "#43a047" },
  };

  const layout = {
    margin: { l: 40, r: 10, t: 30, b: 40 },
    xaxis: {
      type: "date",
      tickformat: "%Y-%m-%d",
      title: "",
    },
    yaxis: { title: "% Change from Start" },
    legend: {
      orientation: "h",
      x: 0,
      y: 1.15,
    },
  };

  Plotly.newPlot(
    "price-chart-relative",
    [stockTrace, qqqTrace, spyTrace],
    layout,
    { responsive: true },
  );
}

// chart 2: cumulative and daily % deviation vs QQQ and SPY
function renderDeviationChart() {
  if (!cachedData || !selectedTicker) return;
  const ph = cachedData.price_history[selectedTicker];
  if (!ph) return;
  const idx = cachedData.index;

  const { dates, sVals, iValsQQQ, iValsSPY } = alignSeriesMulti(
    ph.dates,
    ph.values,
    idx.dates,
    idx.QQQ,
    idx.SPY,
  );
  if (dates.length === 0) return;

  const stock0 = sVals[0];
  const qqq0 = iValsQQQ[0];
  const spy0 = iValsSPY[0];

  const stockPct = sVals.map((v) => (v / stock0 - 1) * 100);
  const qqqPct = iValsQQQ.map((v) => (v / qqq0 - 1) * 100);
  const spyPct = iValsSPY.map((v) => (v / spy0 - 1) * 100);

  const devQQQ = stockPct.map((v, i) => v - qqqPct[i]);
  const devSPY = stockPct.map((v, i) => v - spyPct[i]);

  const dailyDevQQQ = [0];
  const dailyDevSPY = [0];
  for (let i = 1; i < dates.length; i++) {
    const stockDay = stockPct[i] - stockPct[i - 1];
    const qqqDay = qqqPct[i] - qqqPct[i - 1];
    const spyDay = spyPct[i] - spyPct[i - 1];
    dailyDevQQQ.push(stockDay - qqqDay);
    dailyDevSPY.push(stockDay - spyDay);
  }

  const markerStyle = { size: 4 };

  const cumQQQTrace = {
    x: dates,
    y: devQQQ,
    mode: "lines+markers",
    marker: markerStyle,
    name: "Cumulative vs QQQ",
    yaxis: "y1",
    line: { color: "#fb8c00" },
  };
  const cumSPYTrace = {
    x: dates,
    y: devSPY,
    mode: "lines+markers",
    marker: markerStyle,
    name: "Cumulative vs SPY",
    yaxis: "y1",
    line: { color: "#43a047" },
  };

  const dailyQQQTrace = {
    x: dates,
    y: dailyDevQQQ,
    type: "bar",
    name: "Daily diff vs QQQ",
    yaxis: "y2",
    opacity: 0.4,
    marker: { color: "#fb8c00" },
  };
  const dailySPYTrace = {
    x: dates,
    y: dailyDevSPY,
    type: "bar",
    name: "Daily diff vs SPY",
    yaxis: "y2",
    opacity: 0.4,
    marker: { color: "#43a047" },
  };

  const layout = {
    barmode: "group",
    margin: { l: 40, r: 40, t: 30, b: 40 },
    xaxis: {
      type: "date",
      tickformat: "%Y-%m-%d",
      title: "",
    },
    yaxis: {
      title: "Cumulative % deviation",
      side: "left",
    },
    yaxis2: {
      title: "Daily % deviation",
      overlaying: "y",
      side: "right",
      titlefont: { size: 11 },
      tickfont: { size: 11 },
    },
    legend: {
      orientation: "h",
      x: 0,
      y: 1.15,
    },
  };

  Plotly.newPlot(
    "deviation-chart",
    [cumQQQTrace, cumSPYTrace, dailyQQQTrace, dailySPYTrace],
    layout,
    { responsive: true },
  );
}
