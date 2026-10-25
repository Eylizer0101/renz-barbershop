// Admin Analytics – real database insights rendered with locally installed Chart.js.
(function () {
  "use strict";
  const { api, escapeHTML, money } = App;
  const palette = ["#b99a67", "#438a67", "#4d8bb3", "#806ac1", "#d48b3e", "#cb666b", "#624534", "#54a7a0"];
  const formatNumber = n => Number(n || 0).toLocaleString("en-PH");
  const chartMoney = n => money(n);
  const state = { charts: [], token: 0, tab: "overview", data: null, range: "overall", from: "", to: "", paymentMethod: "all", customerType: "all" };

  const dateOptions = [["overall", "Overall"], ["today", "Today"], ["yesterday", "Yesterday"], ["thisWeek", "This Week"], ["lastWeek", "Last Week"], ["thisMonth", "This Month"], ["lastMonth", "Last Month"], ["thisYear", "This Year"], ["lastYear", "Last Year"], ["specific", "Specific Date"], ["range", "Date Range"]];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const manilaToday = () => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const dateLabel = key => key ? new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "Select date";
  const shiftMonth = (year, month, shift) => { const d = new Date(year, month + shift, 1); return [d.getFullYear(), d.getMonth()]; };
  function dateCalendar(year, month, start, end, side) {
    const first = new Date(year, month, 1).getDay();
    const days = Array.from({ length: 42 }, (_, i) => new Date(year, month, i + 1 - first));
    const years = Array.from({ length: new Date().getFullYear() - 1949 }, (_, i) => new Date().getFullYear() - i);
    return `<div class="analytics-calendar" data-calendar="${side}"><div class="analytics-calendar-nav"><button type="button" data-move="-1" aria-label="Previous month">‹</button><div class="analytics-calendar-selects"><select data-calendar-month aria-label="Select month">${monthNames.map((name, i) => `<option value="${i}"${i === month ? " selected" : ""}>${name}</option>`).join("")}</select><select data-calendar-year aria-label="Select year">${years.map(y => `<option value="${y}"${y === year ? " selected" : ""}>${y}</option>`).join("")}</select></div><button type="button" data-move="1" aria-label="Next month">›</button></div><div class="analytics-calendar-week">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => `<span>${d}</span>`).join("")}</div><div class="analytics-calendar-days">${days.map(day => { const value = dateKey(day); const picked = value === start || value === end; const between = start && end && value >= start && value <= end; return `<button type="button" data-pick="${value}" class="analytics-calendar-day${day.getMonth() !== month ? " outside" : ""}${between ? " within" : ""}${picked ? " selected" : ""}" aria-label="${dateLabel(value)}" aria-pressed="${Boolean(picked)}">${day.getDate()}</button>`; }).join("")}</div></div>`;
  }

  // Presentation-only fixtures: never submitted to the backend or stored as shop records.
  function demoAnalytics(range) {
    const labels = range === "today" ? ["9 AM", "11 AM", "1 PM", "3 PM", "5 PM", "7 PM"]
      : range === "yesterday" ? ["9 AM", "11 AM", "1 PM", "3 PM", "5 PM", "7 PM"]
      : ["week", "thisWeek", "lastWeek"].includes(range) ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["month", "thisMonth", "lastMonth", "range", "specific"].includes(range) ? ["Week 1", "Week 2", "Week 3", "Week 4"]
      : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const visits = labels.map((_, i) => Math.round(11 + i * 2.4 + (i % 3) * 6));
    const revenue = labels.map((_, i) => Math.round((2750 + i * 510 + (i % 4) * 920) / 10) * 10);
    const trends = labels.map((label, i) => ({ label, visits: visits[i], revenue: revenue[i],
      inventorySold: 4 + (i * 3) % 11, inventoryChange: 7 - (i * 5) % 13 }));
    const totalVisits = visits.reduce((sum, value) => sum + value, 0);
    const totalRevenue = revenue.reduce((sum, value) => sum + value, 0);
    const served = Math.round(totalVisits * .79);
    const appointments = Math.round(totalVisits * .46);
    const serviceRevenue = Math.round(totalRevenue * .84);
    return {
      range, demo: true,
      totals: { revenue: totalRevenue, visits: totalVisits, served, appointments,
        serviceRevenue, productRevenue: totalRevenue - serviceRevenue },
      averageWaitMinutes: 18,
      inventory: { total: 27, low: 4 },
      trends,
      statuses: { Completed: served, Waiting: Math.round(totalVisits * .09), Serving: 5,
        Cancelled: Math.max(0, totalVisits - served - Math.round(totalVisits * .09) - 5) },
      bookingStatuses: { Confirmed: Math.round(appointments * .65), Pending: Math.round(appointments * .17),
        Completed: Math.round(appointments * .12), Cancelled: Math.round(appointments * .06) },
      methods: { Cash: Math.round(totalRevenue * .54), GCash: Math.round(totalRevenue * .32),
        Card: Math.round(totalRevenue * .14) },
      walkinVisits: totalVisits - appointments, appointmentVisits: appointments,
      topServices: [{ name: "Classic Haircut", count: Math.round(served * .36) },
        { name: "Fade Cut", count: Math.round(served * .26) },
        { name: "Beard Trim", count: Math.round(served * .19) },
        { name: "Haircut + Wash", count: Math.round(served * .12) },
        { name: "Kids Haircut", count: Math.round(served * .07) }],
      topProducts: [{ name: "Hair Wax", quantity: 38 }, { name: "Pomade", quantity: 31 },
        { name: "Shampoo", quantity: 23 }, { name: "Hair Gel", quantity: 17 }],
      byBarber: [{ name: "Barber 1", completed: Math.round(served * .32), revenue: Math.round(serviceRevenue * .32), rating: 4.8 },
        { name: "Barber 2", completed: Math.round(served * .28), revenue: Math.round(serviceRevenue * .28), rating: 4.7 },
        { name: "Barber 3", completed: Math.round(served * .23), revenue: Math.round(serviceRevenue * .23), rating: 4.9 }]
    };
  }
  function destroy() { for (const chart of state.charts) chart.destroy(); state.charts = []; }
  function chartCard(title, subtitle, id, fullWidth = false) {
    return `<article class="card analytics-chart-card"${fullWidth ? ' style="grid-column: 1 / -1"' : ""}><div class="card-heading"><span class="analytics-chart-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l4-5 3 2 5-7"/></svg></span><div><h2>${escapeHTML(title)}</h2><span class="muted">${escapeHTML(subtitle)}</span></div></div><div class="analytics-chart-area" id="wrap-${id}"><canvas id="${id}" aria-label="${escapeHTML(title)}" role="img"></canvas></div></article>`;
  }
  function options(type, percentage = false, currency = false) {
    const circular = type === "doughnut";
    return {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: { display: circular, position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 11, color: "#656b68", font: { size: 10 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${currency ? chartMoney(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed) : formatNumber(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed)}${percentage ? "%" : ""}` } }
      },
      ...(circular ? { cutout: "69%" } : { scales: {
        x: { grid: { display: false }, ticks: { color: "#777", maxRotation: 25, autoSkip: true, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: "#f0ece6" }, ticks: { color: "#777", font: { size: 10 }, callback: value => currency ? "₱" + Number(value).toLocaleString("en-PH") : formatNumber(value) } }
      } })
    };
  }
  function draw(id, type, labels, datasets, currency = false, horizontal = false) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const hasValues = datasets.some(s => s.data.some(value => Number(value) !== 0 && Number.isFinite(Number(value))));
    const wrap = document.getElementById(`wrap-${id}`);
    if (!labels.length || !hasValues) { wrap.innerHTML = '<div class="analytics-empty">No records for the selected period.</div>'; return; }
    const opt = options(type, false, currency);
    if (horizontal && opt.scales) { opt.indexAxis = "y"; opt.scales.x.ticks.callback = value => currency ? "₱" + Number(value).toLocaleString("en-PH") : formatNumber(value); opt.scales.y.ticks.callback = value => labels[value] || value; }
    state.charts.push(new Chart(canvas, { type, data: { labels, datasets }, options: opt }));
  }
  const dataset = (label, data, color = palette[0], fill = false) => ({ label, data, backgroundColor: fill ? color + "2a" : color, borderColor: color, pointBackgroundColor: color, borderWidth: 2.5, tension: .35, fill, borderRadius: 5, maxBarThickness: 38 });
  function pie(id, labels, values) { draw(id, "doughnut", labels, [{ label: "Total", data: values, backgroundColor: palette, borderWidth: 0, hoverOffset: 5 }]); }
  function bars(id, labels, values, currency = false, horizontal = false) {
    const series = dataset(currency ? "Revenue" : "Count", values);
    series.backgroundColor = labels.map((_, i) => palette[i % palette.length]);
    series.borderColor = series.backgroundColor;
    series.borderWidth = 0;
    draw(id, "bar", labels, [series], currency, horizontal);
  }

  // Display calendar buckets as readable dates without changing the real API totals.
  // For one-year monthly views, show the full Jan–Dec axis with zero-valued
  // months where the database has no records; never invent nonzero sales/visits.
  function displayTrends(trends) {
    if (!trends.length || trends.some(row => !/^\d{4}-\d{2}(?:-\d{2})?$/.test(String(row.label)))) return trends;
    const monthly = trends.every(row => /^\d{4}-\d{2}$/.test(row.label));
    const years = [...new Set(trends.map(row => String(row.label).slice(0, 4)))];
    const format = label => {
      const [year, month, day] = label.split("-").map(Number);
      const shortMonth = monthNames[month - 1]?.slice(0, 3) || label;
      if (day) return `${shortMonth} ${day}${years.length > 1 ? `, ${year}` : ""}`;
      return years.length > 1 ? `${shortMonth} ${year}` : shortMonth;
    };
    if (monthly && years.length === 1 && ["overall", "thisYear", "lastYear"].includes(state.range)) {
      const lookup = new Map(trends.map(row => [row.label, row]));
      return Array.from({ length: 12 }, (_, i) => {
        const key = `${years[0]}-${String(i + 1).padStart(2, "0")}`;
        return { ...(lookup.get(key) || { visits: 0, revenue: 0, services: 0, products: 0, inventorySold: 0, inventoryChange: 0 }), label: format(key) };
      });
    }
    return trends.map(row => ({ ...row, label: format(row.label) }));
  }

  function renderTab(body) {
    destroy();
    const d = state.data;
    if (!d) return;
    const trends = d.demo ? (d.trends || []) : displayTrends(d.trends || []);
    const labels = trends.map(x => x.label);
    const stats = d.totals || {};
    const makePie = (id, pairs) => pie(id, pairs.map(x => x[0]), pairs.map(x => x[1]));
    const cards = {
      overview: [
        chartCard("Revenue Trend", "Actual non-voided payments", "revenueTrend"),
        chartCard("Customer Visits", "Queue tickets created during the period", "customerTrend"),
        chartCard("Queue Status", "Current status of visits created in the period", "queueStatus"),
        chartCard("Popular Completed Services", "Based only on completed visits", "popularServices")
      ],
      sales: [
        chartCard("Revenue by Period", "Payment date, not booking date", "salesTrend"),
        chartCard("Payment Methods", "Collected amount per method", "paymentMethods"),
        chartCard("Services vs Products", "Actual non-voided payments", "revenueTypes"),
        chartCard("Most Sold Products", "Based on paid, non-voided product sales", "topProducts")
      ],
      customers: [
        chartCard("Customer Visits Trend", "Ticket count, not unique people", "visitsTrend"),
        chartCard("Walk-in vs Appointment", "Visit source for tickets created in period", "visitSources"),
        chartCard("Appointment Status", "Appointments scheduled in the period", "appointmentStatus"),
        chartCard("Queue Outcomes", "Statuses of created tickets", "customerOutcomes")
      ],
      barbers: [
        chartCard("Completed Visits per Barber", "Served visits assigned to each barber", "barberVisits"),
        chartCard("Service Revenue per Barber", "Paid service transactions attributed by barber name", "barberRevenue"),
        chartCard("Completed Services", "Popular completed haircuts", "barberServices", true)
      ],
      inventory: [
        chartCard("Inventory Units Sold", "Recorded stock sale events", "inventorySold"),
        chartCard("Net Stock Movement", "Inventory additions minus reductions", "stockMovement"),
        chartCard("Stock Level Health", "Current stock snapshot, not historical", "stockHealth"),
        chartCard("Product Sales", "Sold units from non-voided payments", "inventoryProducts")
      ]
    };
    body.querySelector("#analyticsCharts").innerHTML = cards[state.tab].join("");
    const status = d.statuses || {}, products = d.topProducts || [], services = d.topServices || [], barbers = d.byBarber || [];
    if (state.tab === "overview") {
      draw("revenueTrend", "line", labels, [dataset("Revenue", trends.map(x => x.revenue), palette[2], true)], true);
      bars("customerTrend", labels, trends.map(x => x.visits));
      makePie("queueStatus", Object.entries(status).filter(([, v]) => v));
      bars("popularServices", services.map(x => x.name), services.map(x => x.count), false, true);
    } else if (state.tab === "sales") {
      draw("salesTrend", "line", labels, [dataset("Revenue", trends.map(x => x.revenue), palette[4], true)], true);
      makePie("paymentMethods", Object.entries(d.methods || {}).filter(([, v]) => v));
      pie("revenueTypes", ["Services", "Products"], [stats.serviceRevenue, stats.productRevenue]);
      bars("topProducts", products.map(x => x.name), products.map(x => x.quantity), false, true);
    } else if (state.tab === "customers") {
      bars("visitsTrend", labels, trends.map(x => x.visits));
      pie("visitSources", ["Walk-in / Direct", "From Appointment"], [d.walkinVisits, d.appointmentVisits]);
      makePie("appointmentStatus", Object.entries(d.bookingStatuses || {}).filter(([, v]) => v));
      makePie("customerOutcomes", Object.entries(status).filter(([, v]) => v));
    } else if (state.tab === "barbers") {
      bars("barberVisits", barbers.map(x => x.name), barbers.map(x => x.completed));
      bars("barberRevenue", barbers.map(x => x.name), barbers.map(x => x.revenue), true);
      bars("barberServices", services.map(x => x.name), services.map(x => x.count), false, true);
    } else {
      bars("inventorySold", labels, trends.map(x => x.inventorySold));
      draw("stockMovement", "line", labels, [dataset("Net units", trends.map(x => x.inventoryChange), palette[1])]);
      pie("stockHealth", ["Low Stock", "Stock OK"], [d.inventory?.low || 0, Math.max(0, (d.inventory?.total || 0) - (d.inventory?.low || 0))]);
      bars("inventoryProducts", products.map(x => x.name), products.map(x => x.quantity), false, true);
    }
  }

  async function analytics(body, actions) {
    if (typeof Chart === "undefined") { body.innerHTML = '<div class="empty-state">Chart.js could not load. Verify that the dependency is installed and restart the backend.</div>'; return; }
    state.tab = "overview"; state.data = null;
    // The Analytics page already has its own dashboard heading; hide only the duplicate shared page heading.
    const sharedHeading = body.previousElementSibling?.classList.contains("section-heading")
      ? body.previousElementSibling : body.parentElement?.querySelector(":scope > .section-heading");
    if (sharedHeading) sharedHeading.classList.add("hidden");
    actions.innerHTML = "";
    const filtersMarkup = `<div class="analytics-header-filters"><label class="analytics-demo-control" for="analyticsDemoToggle"><span>Dummy Data</span><input id="analyticsDemoToggle" type="checkbox" role="switch" aria-label="Show demo analytics data"><span class="analytics-demo-switch" aria-hidden="true"></span><strong id="analyticsDemoToggleState">OFF</strong></label><div class="analytics-date-filter" id="analyticsDateFilter"><span class="sr-only">Date Range</span><button class="analytics-date-trigger" type="button" id="analyticsDateTrigger" aria-expanded="false" aria-haspopup="true" aria-controls="analyticsDateMenu"><span id="analyticsDateLabel">Overall</span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="analytics-date-menu hidden" id="analyticsDateMenu" role="menu" aria-label="Date range options">${dateOptions.map(([value, label]) => `<button type="button" role="menuitem" data-range="${value}" class="${value === "overall" ? "selected" : ""}">${label}</button>`).join("")}</div></div><label class="analytics-compact-filter"><span class="sr-only">Payment Method</span><select id="analyticsPaymentMethod" aria-label="Payment Method"><option value="all">All Payment Methods</option><option value="cash">Cash</option><option value="gcash">GCash</option><option value="card">Card</option><option value="other">Other</option></select></label><label class="analytics-compact-filter"><span class="sr-only">Customer Type</span><select id="analyticsCustomerType" aria-label="Customer Type"><option value="all">All Customer Types</option><option value="walkin">Walk-in</option><option value="appointment">Appointment</option></select></label></div>`;
    body.innerHTML = `<section class="analytics-dashboard"><section class="analytics-kpis" id="analyticsKpis" aria-live="polite"></section><header class="analytics-heading"><div class="analytics-heading-copy"><div class="analytics-total-line"><h2><strong id="analyticsCustomerTotal">—</strong> Total Customers</h2></div><button type="button" class="analytics-export-btn" id="analyticsExportAll"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></svg> Export All Records</button></div><div class="analytics-header-actions">${filtersMarkup}</div><aside class="analytics-welcome-card" aria-label="Current Philippine date and time"><img class="analytics-welcome-art" src="/images/CashierDashboard/Sun.png" alt="" aria-hidden="true" decoding="async"><div class="analytics-welcome-copy"><span class="analytics-welcome-kicker">Welcome! Today Is</span><strong class="analytics-welcome-day"></strong><span class="analytics-welcome-date"></span><time class="analytics-welcome-time"></time></div></aside></header><nav class="analytics-tabs" id="analyticsTabs" aria-label="Analytics categories">${[["overview","Overview"],["sales","Sales Insights"],["customers","Customer Insights"],["barbers","Barber Performance"],["inventory","Inventory Insights"]].map(([id, label]) => `<button type="button" class="analytics-tab${id === "overview" ? " active" : ""}" data-tab="${id}" aria-pressed="${id === "overview"}">${label}</button>`).join("")}</nav><div id="analyticsCharts" class="analytics-chart-grid"></div><p class="analytics-footnote">Revenue is based on non-voided payments. Visits count queue tickets, not unique people. Inventory levels and barber ratings are current/all-time snapshots.</p></section>`;
    // Protected all-records export: the server rechecks the signed-in admin password.
    const exportButton = body.querySelector("#analyticsExportAll");
    let exportDialog = null;
    function closeExportDialog() {
      if (!exportDialog) return;
      exportDialog.remove(); exportDialog = null;
      document.body.classList.remove("dialog-open");
      exportButton.focus();
    }
    function onExportKeys(event) {
      if (!exportDialog) return;
      if (event.key === "Escape") { event.preventDefault(); closeExportDialog(); return; }
      if (event.key !== "Tab") return;
      const items = [...exportDialog.querySelectorAll("button:not(:disabled),input:not(:disabled)")];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    }
    exportButton.addEventListener("click", () => {
      if (exportDialog) return;
      exportDialog = document.createElement("div");
      exportDialog.className = "analytics-export-backdrop";
      exportDialog.innerHTML = `<form class="analytics-export-modal" role="dialog" aria-modal="true" aria-labelledby="analyticsExportTitle"><div class="analytics-export-modal-head"><div class="analytics-export-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1"/></svg></div><div><h2 id="analyticsExportTitle">Confirm Records Export</h2><p>Enter password to download the full Excel workbook.</p></div><button type="button" class="analytics-export-close" aria-label="Close">×</button></div><label for="analyticsExportPassword">Admin Password</label><div class="analytics-export-password-row"><input id="analyticsExportPassword" type="password" data-has-toggle="true" required autocomplete="current-password" placeholder="Enter your password" maxlength="256"/><button type="button" class="analytics-export-eye" aria-label="Show password" aria-pressed="false">Show</button></div><p class="analytics-export-error" role="alert" aria-live="polite"></p><div class="analytics-export-footer"><button type="button" class="secondary-btn analytics-export-cancel">Cancel</button><button type="submit" class="analytics-export-confirm">Verify &amp; Download</button></div></form>`;
      document.body.appendChild(exportDialog);
      document.body.classList.add("dialog-open");
      exportDialog.querySelector("#analyticsExportPassword").focus();
      exportDialog.addEventListener("click", event => {
        if (event.target === exportDialog || event.target.closest(".analytics-export-close,.analytics-export-cancel")) closeExportDialog();
      });
      exportDialog.querySelector(".analytics-export-eye").addEventListener("click", event => {
        const input = exportDialog.querySelector("#analyticsExportPassword");
        const button = event.currentTarget;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.setAttribute("aria-pressed", String(show));
        button.setAttribute("aria-label", show ? "Hide password" : "Show password");
        button.textContent = show ? "Hide" : "Show";
      });
      exportDialog.addEventListener("keydown", onExportKeys);
      exportDialog.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const dialog = exportDialog;
        const submit = dialog.querySelector(".analytics-export-confirm");
        const password = dialog.querySelector("#analyticsExportPassword").value;
        const errorBox = dialog.querySelector(".analytics-export-error");
        if (!password || submit.disabled) return;
        submit.disabled = true; submit.textContent = "Preparing Excel…"; errorBox.textContent = "";
        try {
          const response = await fetch("/api/reports/export-all", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json", "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            body: JSON.stringify({ password })
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            if (response.status === 401) { window.location.href = "/login.html#expired"; return; }
            throw new Error(data.error || "Export failed. Please try again.");
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `renz-barbershop-all-records-${manilaToday()}.xlsx`;
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          dialog.querySelector("#analyticsExportPassword").value = "";
          closeExportDialog();
          App.toast("All records exported successfully.");
        } catch (error) {
          if (exportDialog === dialog) {
            errorBox.textContent = error.message || "Unable to export records.";
            dialog.querySelector("#analyticsExportPassword").value = "";
            dialog.querySelector("#analyticsExportPassword").focus();
          }
        } finally {
          if (exportDialog === dialog) { submit.disabled = false; submit.textContent = "Verify & Download"; }
        }
      });
    });
    const demoToggle = body.querySelector("#analyticsDemoToggle"), demoToggleState = body.querySelector("#analyticsDemoToggleState");
    const dateTrigger = body.querySelector("#analyticsDateTrigger"), dateMenu = body.querySelector("#analyticsDateMenu"), dateFilter = body.querySelector("#analyticsDateFilter"), dateDisplay = body.querySelector("#analyticsDateLabel");
    state.range = "overall"; state.from = ""; state.to = ""; state.paymentMethod = "all"; state.customerType = "all";
    let selectedDate = "", modal = null, previousFocus = null;
    let modalMode = "", draftStart = "", draftEnd = "", leftYear = 0, leftMonth = 0, rightYear = 0, rightMonth = 0;
    function updateDateDisplay() {
      dateDisplay.textContent = state.range === "specific" && selectedDate ? dateLabel(selectedDate)
        : state.range === "range" && state.from && state.to ? `${dateLabel(state.from)} – ${dateLabel(state.to)}`
        : (dateOptions.find(([value]) => value === state.range)?.[1] || "Overall");
      dateMenu.querySelectorAll("[data-range]").forEach(b => b.classList.toggle("selected", b.dataset.range === state.range));
    }
    function closeMenu() { dateMenu.classList.add("hidden"); dateTrigger.setAttribute("aria-expanded", "false"); }
    function closeDateModal() {
      if (!modal) return;
      modal.remove(); modal = null;
      document.body.classList.remove("analytics-date-dialog-open");
      document.removeEventListener("keydown", handleModalKeys);
      previousFocus?.focus?.(); previousFocus = null;
    }
    function handleModalKeys(event) {
      if (!modal) return;
      if (event.key === "Escape") { event.preventDefault(); closeDateModal(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...modal.querySelectorAll('button:not(:disabled),select:not(:disabled)')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    }
    function renderDateModal() {
      if (!modal) return;
      const single = modalMode === "specific";
      modal.innerHTML = `<div class="analytics-date-dialog" role="dialog" aria-modal="true" aria-labelledby="analyticsDateDialogTitle"><header class="analytics-date-dialog-head"><div><h2 id="analyticsDateDialogTitle">${single ? "Select Specific Date" : "Select Date Range"}</h2><p>${single ? "Choose one date for the analytics report." : "Choose the starting and ending dates for the analytics report."}</p></div><button type="button" class="analytics-date-close" data-close aria-label="Close calendar">×</button></header><section class="analytics-date-preview"><div><small>${single ? "Selected Date" : "Start Date"}</small><strong>${dateLabel(draftStart)}</strong></div>${single ? "" : `<span aria-hidden="true">→</span><div><small>End Date</small><strong>${dateLabel(draftEnd)}</strong></div>`}</section><div class="analytics-date-calendars${single ? " single" : ""}">${dateCalendar(leftYear, leftMonth, draftStart, draftEnd, "left")}${single ? "" : dateCalendar(rightYear, rightMonth, draftStart, draftEnd, "right")}</div><footer class="analytics-date-dialog-footer"><button type="button" class="secondary-btn" data-close>Cancel</button><button type="button" class="analytics-date-apply" data-apply ${!draftStart || (!single && !draftEnd) ? "disabled" : ""}>${single ? "Apply Date" : "Apply Range"}</button></footer></div>`;
    }
    function openDateModal(mode) {
      closeMenu();
      modalMode = mode;
      const today = manilaToday();
      draftStart = mode === "specific" ? (selectedDate || today) : (state.from || today);
      draftEnd = mode === "specific" ? draftStart : (state.to || today);
      const left = new Date(`${draftStart}T12:00:00`);
      leftYear = left.getFullYear(); leftMonth = left.getMonth();
      const right = shiftMonth(leftYear, leftMonth, 1);
      [rightYear, rightMonth] = right;
      previousFocus = document.activeElement;
      modal = document.createElement("div"); modal.className = "analytics-date-backdrop";
      modal.addEventListener("mousedown", e => { if (e.target === modal) closeDateModal(); });
      modal.addEventListener("click", e => {
        if (e.target.closest("[data-close]")) { closeDateModal(); return; }
        if (e.target.closest("[data-apply]")) {
          if (!draftStart || (modalMode === "range" && !draftEnd)) return;
          if (modalMode === "specific") { selectedDate = draftStart; state.from = ""; state.to = ""; }
          else { state.from = draftStart; state.to = draftEnd; selectedDate = ""; }
          state.range = modalMode; closeDateModal(); updateDateDisplay(); load(); return;
        }
        const pick = e.target.closest("[data-pick]");
        if (pick) {
          const value = pick.dataset.pick;
          if (modalMode === "specific") { draftStart = draftEnd = value; }
          else if (!draftStart || draftEnd) { draftStart = value; draftEnd = ""; }
          else if (value < draftStart) { draftEnd = draftStart; draftStart = value; }
          else { draftEnd = value; }
          renderDateModal(); return;
        }
        const move = e.target.closest("[data-move]");
        if (move) {
          const side = move.closest("[data-calendar]").dataset.calendar;
          if (side === "left") [leftYear, leftMonth] = shiftMonth(leftYear, leftMonth, Number(move.dataset.move));
          else [rightYear, rightMonth] = shiftMonth(rightYear, rightMonth, Number(move.dataset.move));
          renderDateModal();
        }
      });
      modal.addEventListener("change", e => {
        if (!e.target.matches("[data-calendar-month], [data-calendar-year]")) return;
        const calendar = e.target.closest("[data-calendar]");
        const month = Number(calendar.querySelector("[data-calendar-month]").value), year = Number(calendar.querySelector("[data-calendar-year]").value);
        if (calendar.dataset.calendar === "left") { leftYear = year; leftMonth = month; }
        else { rightYear = year; rightMonth = month; }
        renderDateModal();
      });
      document.body.appendChild(modal);
      document.body.classList.add("analytics-date-dialog-open");
      document.addEventListener("keydown", handleModalKeys);
      renderDateModal(); modal.querySelector("[data-close]")?.focus();
    }
    dateTrigger.addEventListener("click", () => { const open = dateMenu.classList.toggle("hidden") === false; dateTrigger.setAttribute("aria-expanded", String(open)); });
    dateMenu.addEventListener("click", e => {
      const choice = e.target.closest("[data-range]"); if (!choice) return;
      closeMenu(); const selected = choice.dataset.range;
      if (selected === "specific" || selected === "range") { openDateModal(selected); return; }
      state.range = selected; state.from = ""; state.to = ""; selectedDate = "";
      updateDateDisplay(); load();
    });
    const outsideDateMenu = e => { if (!dateFilter.contains(e.target)) closeMenu(); };
    const escapeDateMenu = e => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", outsideDateMenu);
    document.addEventListener("keydown", escapeDateMenu);
    // Same live Philippine date/time behavior as the Front Desk welcome card.
    const welcome = body.querySelector(".analytics-welcome-card");
    const welcomeArt = welcome.querySelector(".analytics-welcome-art");
    const welcomeDay = welcome.querySelector(".analytics-welcome-day");
    const welcomeDate = welcome.querySelector(".analytics-welcome-date");
    const welcomeTime = welcome.querySelector(".analytics-welcome-time");
    const zone = "Asia/Manila";
    const dayFormat = new Intl.DateTimeFormat("en-PH", { timeZone: zone, weekday: "long" });
    const dateFormat = new Intl.DateTimeFormat("en-PH", { timeZone: zone, month: "long", day: "numeric", year: "numeric" });
    const timeFormat = new Intl.DateTimeFormat("en-PH", { timeZone: zone, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" });
    let shownIcon = "";
    function updateWelcomeClock() {
      if (!welcome.isConnected) return;
      const now = new Date();
      const hour = Number(hourFormat.format(now));
      const icon = hour >= 6 && hour < 18 ? "Sun" : "Moon";
      if (shownIcon !== icon) { welcomeArt.src = `/images/CashierDashboard/${icon}.png`; shownIcon = icon; }
      welcomeDay.textContent = dayFormat.format(now).toUpperCase();
      welcomeDate.textContent = dateFormat.format(now);
      welcomeTime.textContent = timeFormat.format(now);
      welcomeTime.dateTime = now.toISOString();
    }
    updateWelcomeClock();
    const welcomeClockTimer = window.setInterval(updateWelcomeClock, 1000);
    let disposed = false;
    async function load() {
      const token = ++state.token;
      state.data = null;
      body.querySelector("#analyticsCustomerTotal").textContent = "—";
      destroy();
      body.querySelector("#analyticsCharts").innerHTML = "";
      body.querySelector("#analyticsKpis").innerHTML = '<div class="analytics-loading">Loading analytics…</div>';
      const query = new URLSearchParams({ range: state.range });
      if (state.paymentMethod !== "all") query.set("paymentMethod", state.paymentMethod);
      if (state.customerType !== "all") query.set("customerType", state.customerType);
      if (state.range === "specific") query.set("specificDate", selectedDate);
      if (state.range === "range") { query.set("from", state.from); query.set("to", state.to); }
      try {
        // A running older backend silently treats an unknown "overall" range as "today".
        // Do not display those daily totals as if they were all-time records.
        query.set("_", String(Date.now()));
        const data = demoToggle.checked ? demoAnalytics(state.range) : await api(`/api/analytics/insights?${query}`);
        if (disposed || token !== state.token) return;
        if (!demoToggle.checked && state.range === "overall" && data.range !== "overall") {
          throw new Error("Overall / All Time is not supported by the backend currently running. Save the updated backend/routes/analytics.js, restart the Node.js server, then refresh this page.");
        }
        state.data = data;
        const t = data.totals || {};
        body.querySelector("#analyticsCustomerTotal").textContent = formatNumber(t.visits);
        const stats = [["Total Revenue", money(t.revenue)], ["Completed Services", formatNumber(t.served)], ["Average Wait", data.averageWaitMinutes == null ? "—" : `${data.averageWaitMinutes} min`], ["Appointments", formatNumber(t.appointments)], ["Low Stock", formatNumber(data.inventory?.low)]];
        const kpiIcons = ["/images/CashierDashboard/PesoBadge.png", "/images/CashierDashboard/CheckmarkBadge.png", "/images/CashierDashboard/Waiting.png", "/images/customerDashboard/GoldenCalendar.png", "/images/customerDashboard/Shophours.png"];
        body.querySelector("#analyticsKpis").innerHTML = stats.map(([label, value], i) => `<article class="analytics-kpi"><span class="analytics-kpi-icon" aria-hidden="true"><img src="${kpiIcons[i]}" alt="" loading="lazy" decoding="async"></span><strong>${value}</strong><span class="analytics-kpi-label">${label}</span></article>`).join("");
        renderTab(body);
      } catch (error) { if (disposed || token !== state.token) return; destroy(); body.querySelector("#analyticsKpis").innerHTML = `<div class="analytics-error">${escapeHTML(error.message)} <button class="secondary-btn" type="button" id="analyticsRetry">Retry</button></div>`; body.querySelector("#analyticsCharts").innerHTML = ""; body.querySelector("#analyticsRetry")?.addEventListener("click", load); }
    }
    body.querySelector("#analyticsPaymentMethod").addEventListener("change", event => {
      state.paymentMethod = event.target.value;
      load();
    });
    body.querySelector("#analyticsCustomerType").addEventListener("change", event => {
      state.customerType = event.target.value;
      load();
    });
    demoToggle.addEventListener("change", () => {
      demoToggleState.textContent = demoToggle.checked ? "ON" : "OFF";
      body.querySelector(".analytics-dashboard").classList.toggle("analytics-demo-active", demoToggle.checked);
      load();
    });
    body.querySelector("#analyticsTabs").addEventListener("click", event => { const button = event.target.closest("[data-tab]"); if (!button || !state.data) return; state.tab = button.dataset.tab; body.querySelectorAll(".analytics-tab").forEach(b => { b.classList.toggle("active", b === button); b.setAttribute("aria-pressed", String(b === button)); }); renderTab(body); });
    await load();
    return () => { disposed = true; closeExportDialog(); closeDateModal(); document.removeEventListener("mousedown", outsideDateMenu); document.removeEventListener("keydown", escapeDateMenu); window.clearInterval(welcomeClockTimer); ++state.token; destroy(); };
  }
  window.AdminAnalytics = { render: analytics };
})();
