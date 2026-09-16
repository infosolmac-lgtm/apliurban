const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const STATUS_LABELS = {
  unassigned: "Sin asignar",
  pending_start: "Pendiente",
  in_production: "En producción",
  paused: "Pausada",
  finished: "Terminada",
  picked_up: "Recogida",
};
const LOCATION_LABELS = { nave1: "Nave 1", nave2: "Nave 2", recogida: "Recogida" };
const TYPE_LABELS = { spa_cover: "Cubierta SPA", custom_tarp: "Lona a medida" };

let workers = [];
let orders = [];
let currentDetailOrder = null;
let newOrderDigits = "";
let newOrderType = null;

/* ---------- navegación ---------- */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
document.querySelectorAll("[data-back]").forEach(btn => {
  btn.addEventListener("click", () => showScreen("screen-" + btn.dataset.back));
});

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
}

/* ---------- carga de datos ---------- */
async function loadWorkers() {
  const { data, error } = await sb.from("workers").select("id,name,active").eq("active", true);
  if (error) { toast("Error cargando trabajadores"); return; }
  workers = data;
}

async function loadOrders() {
  const { data, error } = await sb
    .from("orders")
    .select("id,order_number,client,work_type,status,current_location,current_holder_id,paused_at,created_at,updated_at,workers!current_holder_id(name)")
    .neq("status", "picked_up")
    .order("order_number");
  if (error) { toast("Error: " + error.message); console.error("loadOrders error:", error); return; }
  orders = data;
  renderOrderList();
}

function workerName(id) {
  const w = workers.find(w => w.id === id);
  return w ? w.name : null;
}

function pauseMinutes(pausedAt) {
  if (!pausedAt) return 0;
  return Math.floor((Date.now() - new Date(pausedAt).getTime()) / 60000);
}

/* ---------- render lista principal ---------- */
function renderOrderList() {
  const container = document.getElementById("order-list");
  const groups = { nave1: [], nave2: [], recogida: [] };
  orders.forEach(o => groups[o.current_location].push(o));

  document.getElementById("summary").textContent = `${orders.length} órdenes activas`;

  let html = "";
  for (const loc of ["nave1", "nave2", "recogida"]) {
    const list = groups[loc];
    html += `<p class="section-label">${LOCATION_LABELS[loc]}: ${list.length} OT</p>`;
    if (list.length === 0) {
      html += `<p style="font-size:13px;color:var(--text-secondary);margin:0 0 10px 2px;">Sin órdenes aquí</p>`;
    }
    list.forEach(o => {
      const holder = o.workers ? o.workers.name : null;
      const sub = holder || (o.status === "unassigned" ? "Sin asignar" : "");
      const isPaused = o.status === "paused";
      const rowClass = isPaused ? "order-row order-row-paused" : "order-row";
      const statusHtml = isPaused
        ? `<span class="status-tag status-paused">⏸ ${pauseMinutes(o.paused_at)}m</span>`
        : `<span class="status-tag status-${o.status}"><span class="status-dot"></span>${STATUS_LABELS[o.status]}</span>`;
      html += `
        <div class="${rowClass}" data-id="${o.id}">
          <div class="order-row-left">
            <span class="order-num">${o.order_number[0]} ${o.order_number.slice(1)}</span>
            <span class="order-sub">${sub}</span>
          </div>
          ${statusHtml}
        </div>`;
    });
  }
  container.innerHTML = html;
  container.querySelectorAll(".order-row").forEach(row => {
    row.addEventListener("click", () => openDetail(row.dataset.id));
  });
}

/* ---------- detalle de orden ---------- */
async function openDetail(id) {
  const { data: order, error } = await sb
    .from("orders")
    .select("*, workers!current_holder_id(name)")
    .eq("id", id).single();
  if (error) { toast("No se pudo abrir la orden"); return; }
  currentDetailOrder = order;
  renderDetail(order);
  showScreen("screen-detail");
}

function renderDetail(o) {
  const holder = o.workers ? o.workers.name : "Sin asignar";
  let actions = "";
  let boxClass = "detail-timer-box";
  let statusLine = "";

  if (o.status === "unassigned" || o.status === "finished") {
    actions = `<button class="primary-btn" id="act-deliver">Pasar orden</button>`;
  }
  if (o.status === "pending_start") {
    actions = `
      <button class="primary-btn" id="act-start">Iniciar</button>
      <button class="secondary-btn" id="act-deliver">Pasar orden</button>`;
  }
  if (o.status === "in_production") {
    actions = `
      <div class="dual-btn-row">
        <button class="pause-btn" id="act-pause">⏸ Pausar</button>
        <button class="finish-btn" id="act-finish">Finalizar</button>
      </div>`;
  }
  if (o.status === "paused") {
    boxClass = "detail-timer-box paused-box";
    statusLine = `<p class="paused-label">⏸ Pausada · ${pauseMinutes(o.paused_at)}m</p>`;
    actions = `
      <div class="dual-btn-row">
        <button class="resume-btn" id="act-resume">▶ Reanudar</button>
        <button class="finish-btn-alt" id="act-finish">Finalizar</button>
      </div>`;
  }
  if (o.status === "finished") {
    actions = `<button class="secondary-btn" id="act-control">Control final y recogida (Juan)</button>`;
  }

  document.getElementById("detail-content").innerHTML = `
    <div class="${boxClass}">
      <p class="detail-order-num">${o.order_number[0]} ${o.order_number.slice(1)}</p>
      ${statusLine}
      ${actions}
    </div>
    <span class="detail-type-badge">${TYPE_LABELS[o.work_type]}</span>
    <table class="detail-fields">
      <tr><td>Cliente</td><td>${o.client || "—"}</td></tr>
      <tr><td>Ubicación</td><td>${LOCATION_LABELS[o.current_location]}</td></tr>
      <tr><td>Responsable</td><td>${holder}</td></tr>
      <tr><td>Estado</td><td>${STATUS_LABELS[o.status]}</td></tr>
    </table>
  `;

  const startBtn = document.getElementById("act-start");
  if (startBtn) startBtn.addEventListener("click", () => handleStart(o));
  const finishBtn = document.getElementById("act-finish");
  if (finishBtn) finishBtn.addEventListener("click", () => handleFinish(o));
  const deliverBtn = document.getElementById("act-deliver");
  if (deliverBtn) deliverBtn.addEventListener("click", () => handleDeliver(o));
  const controlBtn = document.getElementById("act-control");
  if (controlBtn) controlBtn.addEventListener("click", () => handleControl(o));
  const pauseBtn = document.getElementById("act-pause");
  if (pauseBtn) pauseBtn.addEventListener("click", () => handlePause(o));
  const resumeBtn = document.getElementById("act-resume");
  if (resumeBtn) resumeBtn.addEventListener("click", () => handleResume(o));
}

/* ---------- modal PIN reutilizable ---------- */
let pinBuffer = "";
let pinResolve = null;

function askPin(workerNameLabel) {
  return new Promise(resolve => {
    pinResolve = resolve;
    pinBuffer = "";
    document.getElementById("pin-worker-name").textContent = workerNameLabel || "";
    document.getElementById("pin-error").classList.add("hidden");
    updatePinDots();
    document.getElementById("modal-pin").classList.remove("hidden");
  });
}
function closePinModal(result) {
  document.getElementById("modal-pin").classList.add("hidden");
  if (pinResolve) { pinResolve(result); pinResolve = null; }
}
function updatePinDots() {
  document.querySelectorAll("#modal-pin .dot").forEach((d, i) => {
    d.classList.toggle("filled", i < pinBuffer.length);
  });
}
function buildKeypad(container, onDigit, onBack, onCheck) {
  container.innerHTML = "";
  const keys = ["1","2","3","4","5","6","7","8","9","back","0","check"];
  keys.forEach(k => {
    const btn = document.createElement("button");
    if (k === "back") { btn.className = "key-back"; btn.textContent = "⌫"; btn.addEventListener("click", onBack); }
    else if (k === "check") { btn.className = "key-check"; btn.textContent = "✓"; btn.addEventListener("click", onCheck); }
    else { btn.textContent = k; btn.addEventListener("click", () => onDigit(k)); }
    container.appendChild(btn);
  });
}
buildKeypad(document.getElementById("keypad-pin"),
  (d) => { if (pinBuffer.length < 4) { pinBuffer += d; updatePinDots(); } },
  () => { pinBuffer = pinBuffer.slice(0, -1); updatePinDots(); },
  () => {
    if (pinBuffer.length !== 4) return;
    closePinModal(pinBuffer);
  }
);
document.querySelectorAll('#modal-pin [data-modal-cancel]').forEach(b =>
  b.addEventListener("click", () => closePinModal(null))
);

function pinModalError(msg) {
  const el = document.getElementById("pin-error");
  el.textContent = msg;
  el.classList.remove("hidden");
  pinBuffer = "";
  updatePinDots();
}

/* ---------- modal seleccionar trabajador ---------- */
let workerResolve = null;
function askWorker(title, filterFn) {
  return new Promise(resolve => {
    workerResolve = resolve;
    document.getElementById("worker-modal-title").textContent = title;
    const list = document.getElementById("worker-list");
    const filtered = filterFn ? workers.filter(filterFn) : workers;
    list.innerHTML = filtered.map(w =>
      `<button class="worker-item" data-id="${w.id}">${w.name}</button>`
    ).join("");
    list.querySelectorAll(".worker-item").forEach(btn => {
      btn.addEventListener("click", () => {
        document.getElementById("modal-worker").classList.add("hidden");
        workerResolve(btn.dataset.id);
        workerResolve = null;
      });
    });
    document.getElementById("modal-worker").classList.remove("hidden");
  });
}
document.querySelectorAll('#modal-worker [data-modal-cancel]').forEach(b =>
  b.addEventListener("click", () => {
    document.getElementById("modal-worker").classList.add("hidden");
    if (workerResolve) { workerResolve(null); workerResolve = null; }
  })
);

/* ---------- acciones de orden ---------- */
async function handleStart(o) {
  const workerId = await askWorker("¿Quién inicia el trabajo?");
  if (!workerId) return;
  const pin = await askPin(workerName(workerId));
  if (!pin) return;
  const { error } = await sb.rpc("start_order", { p_order_id: o.id, p_worker_id: workerId, p_pin: pin });
  if (error) { toast(error.message.includes("PIN") ? "PIN incorrecto" : "No se pudo iniciar"); return; }
  toast("Trabajo iniciado");
  await loadOrders(); openDetail(o.id);
}

async function handleFinish(o) {
  const workerId = await askWorker("¿Quién finaliza el trabajo?");
  if (!workerId) return;
  const pin = await askPin(workerName(workerId));
  if (!pin) return;
  const { error } = await sb.rpc("finish_order", { p_order_id: o.id, p_worker_id: workerId, p_pin: pin });
  if (error) { toast(error.message.includes("PIN") ? "PIN incorrecto" : "No se pudo finalizar"); return; }
  toast("Trabajo finalizado");
  await loadOrders(); openDetail(o.id);
}

async function handlePause(o) {
  const pin = await askPin(o.workers ? o.workers.name : "");
  if (!pin) return;
  const { error } = await sb.rpc("pause_order", { p_order_id: o.id, p_worker_id: o.current_holder_id, p_pin: pin });
  if (error) { toast(error.message.includes("PIN") ? "PIN incorrecto" : "No se pudo pausar"); return; }
  toast("Orden pausada");
  await loadOrders(); openDetail(o.id);
}

async function handleResume(o) {
  const pin = await askPin(o.workers ? o.workers.name : "");
  if (!pin) return;
  const { error } = await sb.rpc("resume_order", { p_order_id: o.id, p_worker_id: o.current_holder_id, p_pin: pin });
  if (error) { toast(error.message.includes("PIN") ? "PIN incorrecto" : "No se pudo reanudar"); return; }
  toast("Orden reanudada");
  await loadOrders(); openDetail(o.id);
}

async function handleDeliver(o) {
  const fromId = await askWorker("¿Quién entrega la orden?");
  if (!fromId) return;
  const toId = await askWorker("¿A quién se entrega?", w => w.id !== fromId);
  if (!toId) return;
  const pin = await askPin(workerName(fromId));
  if (!pin) return;
  const location = toId ? (workerName(toId) === "Kevin" || workerName(toId) === "Elmer" ? "nave2" : "nave1") : o.current_location;
  const { error } = await sb.rpc("deliver_order", {
    p_order_id: o.id, p_from_worker_id: fromId, p_to_worker_id: toId, p_pin: pin, p_location: location
  });
  if (error) { toast(error.message.includes("PIN") ? "PIN incorrecto" : "No se pudo entregar"); return; }
  toast("Orden entregada");
  await loadOrders(); openDetail(o.id);
}

async function handleControl(o) {
  const juan = workers.find(w => w.name === "Juan");
  const pin = await askPin("Juan");
  if (!pin) return;
  const { error } = await sb.rpc("control_and_pickup_order", { p_order_id: o.id, p_worker_id: juan.id, p_pin: pin });
  if (error) { toast(error.message.includes("Solo Juan") ? "Solo Juan puede hacer esto" : "PIN incorrecto"); return; }
  toast("Orden entregada al cliente");
  await loadOrders(); showScreen("screen-main");
}

/* ---------- nueva orden ---------- */
document.getElementById("btn-new-order").addEventListener("click", () => {
  newOrderDigits = ""; newOrderType = null;
  document.getElementById("input-client").value = "";
  document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("new-order-step2").classList.add("hidden");
  updateNewOrderDisplay();
  showScreen("screen-new-order");
});

function updateNewOrderDisplay() {
  const padded = newOrderDigits.padEnd(4, "_").split("").join(" ");
  document.getElementById("new-order-digits").textContent = padded;
  if (newOrderDigits.length === 4) {
    document.getElementById("new-order-step2").classList.remove("hidden");
  } else {
    document.getElementById("new-order-step2").classList.add("hidden");
  }
}
buildKeypad(document.getElementById("keypad-neworder"),
  (d) => { if (newOrderDigits.length < 4) { newOrderDigits += d; updateNewOrderDisplay(); } },
  () => { newOrderDigits = newOrderDigits.slice(0, -1); updateNewOrderDisplay(); },
  () => {} // check no se usa aquí, se avanza automático a los 4 dígitos
);
document.querySelectorAll(".type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    newOrderType = btn.dataset.type;
    checkNewOrderReady();
  });
});
document.getElementById("input-client").addEventListener("input", checkNewOrderReady);
function checkNewOrderReady() {
  const client = document.getElementById("input-client").value.trim();
  document.getElementById("btn-continue-neworder").disabled = !(client && newOrderType);
}

document.getElementById("btn-continue-neworder").addEventListener("click", async () => {
  const client = document.getElementById("input-client").value.trim();
  const creatorId = await askWorker("¿Quién crea la orden?", w => w.name === "Jorge" || w.name === "Juan");
  if (!creatorId) return;
  const pin = await askPin(workerName(creatorId));
  if (!pin) return;
  const fullNumber = "1" + newOrderDigits;
  const { error } = await sb.rpc("create_order", {
    p_order_number: fullNumber, p_client: client, p_work_type: newOrderType,
    p_worker_id: creatorId, p_pin: pin
  });
  if (error) {
    toast("Error: " + error.message);
    console.error("create_order error:", error);
    return;
  }
  toast("Orden creada");
  await loadOrders();
  showScreen("screen-main");
});

/* ---------- reportes (solo Juan) ---------- */
document.getElementById("btn-reports").addEventListener("click", async () => {
  const juan = workers.find(w => w.name === "Juan");
  const pin = await askPin("Juan — acceso a reportes");
  if (!pin) return;
  const { data: ok, error } = await sb.rpc("verify_pin", { p_worker_id: juan.id, p_pin: pin, p_required_name: "Juan" });
  if (error || !ok) { toast("PIN incorrecto"); return; }
  currentReportPeriod = "daily";
  currentReportDate = new Date();
  showScreen("screen-reports");
  renderReportRange();
  loadReport();
});

let currentReportPeriod = "daily";
let currentReportDate = new Date();

document.querySelectorAll(".report-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".report-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentReportPeriod = tab.dataset.period;
    currentReportDate = new Date();
    renderReportRange();
    loadReport();
  });
});

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7), year: d.getUTCFullYear() };
}

function renderReportRange() {
  const el = document.getElementById("report-range-picker");
  let label = "";
  if (currentReportPeriod === "daily") {
    label = currentReportDate.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } else if (currentReportPeriod === "weekly") {
    const { week, year } = getISOWeek(currentReportDate);
    label = `Semana ${week}, ${year}`;
  } else {
    label = currentReportDate.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  }
  el.innerHTML = `
    <button id="range-prev">‹</button>
    <span class="report-range-label">${label}</span>
    <button id="range-next">›</button>
  `;
  document.getElementById("range-prev").addEventListener("click", () => { shiftReportRange(-1); });
  document.getElementById("range-next").addEventListener("click", () => { shiftReportRange(1); });
}
function shiftReportRange(dir) {
  const d = new Date(currentReportDate);
  if (currentReportPeriod === "daily") d.setDate(d.getDate() + dir);
  else if (currentReportPeriod === "weekly") d.setDate(d.getDate() + dir * 7);
  else d.setMonth(d.getMonth() + dir);
  currentReportDate = d;
  renderReportRange();
  loadReport();
}

function getRangeBounds() {
  const d = new Date(currentReportDate);
  let start, end;
  if (currentReportPeriod === "daily") {
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  } else if (currentReportPeriod === "weekly") {
    const day = d.getDay() || 7;
    start = new Date(d); start.setDate(d.getDate() - day + 1); start.setHours(0,0,0,0);
    end = new Date(start); end.setDate(start.getDate() + 7);
  } else {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return { start, end };
}

async function loadReport() {
  const { start, end } = getRangeBounds();
  const { data: events, error } = await sb
    .from("order_events")
    .select("order_id, event_type, from_worker_id, occurred_at")
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", end.toISOString())
    .order("occurred_at");
  if (error) { toast("Error cargando reporte"); return; }

  const createdOrders = new Set(events.filter(e => e.event_type === "created").map(e => e.order_id));
  const finishedOrders = new Set(events.filter(e => e.event_type === "finished").map(e => e.order_id));

  const workTimeByWorker = {};
  const byOrder = {};
  events.forEach(e => { (byOrder[e.order_id] ||= []).push(e); });
  Object.values(byOrder).forEach(evList => {
    for (let i = 0; i < evList.length; i++) {
      if (evList[i].event_type === "started") {
        const next = evList.slice(i + 1).find(e => e.event_type === "finished");
        if (next) {
          const ms = new Date(next.occurred_at) - new Date(evList[i].occurred_at);
          const name = workerName(evList[i].from_worker_id) || "Desconocido";
          workTimeByWorker[name] = (workTimeByWorker[name] || 0) + ms;
        }
      }
    }
  });

  function fmt(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  let html = `<div class="metric-grid">
    <div class="metric-card"><div class="m-label">Órdenes creadas</div><div class="m-value">${createdOrders.size}</div></div>
    <div class="metric-card"><div class="m-label">Órdenes terminadas</div><div class="m-value">${finishedOrders.size}</div></div>
  </div>`;

  html += `<p class="section-label">Tiempo trabajado por persona</p>`;
  const entries = Object.entries(workTimeByWorker).sort((a,b) => b[1]-a[1]);
  if (entries.length === 0) {
    html += `<p style="font-size:13px;color:var(--text-secondary);">Sin datos en este periodo</p>`;
  } else {
    entries.forEach(([name, ms]) => {
      html += `<div class="worker-stat-row"><span>${name}</span><span>${fmt(ms)}</span></div>`;
    });
  }
  document.getElementById("report-content").innerHTML = html;
}

/* ---------- init ---------- */
(async function init() {
  await loadWorkers();
  await loadOrders();
  setInterval(() => {
    if (document.getElementById("screen-main").classList.contains("active")) {
      renderOrderList();
    }
    if (document.getElementById("screen-detail").classList.contains("active") && currentDetailOrder) {
      renderDetail(currentDetailOrder);
    }
  }, 30000);

  sb.channel("orders-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (payload) => {
      await loadOrders();
      if (
        document.getElementById("screen-detail").classList.contains("active") &&
        currentDetailOrder &&
        payload.new && payload.new.id === currentDetailOrder.id
      ) {
        openDetail(currentDetailOrder.id);
      }
    })
    .subscribe();
})();
