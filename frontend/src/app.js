import { TeachingScene } from "./scene.js";

const elements = {
  select: document.querySelector("#case-select"),
  sourceBadge: document.querySelector("#source-badge"),
  title: document.querySelector("#case-title"),
  status: document.querySelector("#case-status"),
  pdk: document.querySelector("#case-pdk"),
  stage: document.querySelector("#case-stage"),
  objectList: document.querySelector("#object-list"),
  layout: document.querySelector("#layout-view"),
  inspector: document.querySelector("#inspector-content"),
  explode: document.querySelector("#explode-range"),
  modelScale: document.querySelector("#model-scale"),
  runButton: document.querySelector("#run-button"),
  runMessage: document.querySelector("#run-message"),
};

let catalog = null;
let activeCase = null;
let selectedId = null;
const visibleLayers = new Set(["M1", "M2", "VIA1"]);
const scene = new TeachingScene(document.querySelector("#model-view"), selectEntity);

async function boot() {
  try {
    catalog = await requestJson("/api/cases");
    populateCasePicker();
    await loadCase(catalog.cases[0].id);
  } catch (error) {
    elements.title.textContent = "案例加载失败";
    elements.inspector.textContent = `无法读取教学服务：${error.message}`;
  }
}

function populateCasePicker() {
  for (const caseSummary of catalog.cases) {
    const option = document.createElement("option");
    option.value = caseSummary.id;
    option.textContent = caseSummary.title;
    elements.select.append(option);
  }
}

async function loadCase(caseId) {
  activeCase = await requestJson(`/api/cases/${encodeURIComponent(caseId)}`);
  selectedId = null;
  elements.select.value = activeCase.id;
  elements.title.textContent = activeCase.title;
  elements.pdk.textContent = `工艺：${activeCase.pdk}`;
  elements.stage.textContent = `阶段：${activeCase.stage}`;
  elements.status.textContent = activeCase.availability === "ready" ? "可浏览" : "等待环境核验";
  elements.status.classList.toggle("pending", activeCase.availability !== "ready");
  elements.sourceBadge.textContent = activeCase.sourceLabel;
  elements.sourceBadge.className = `source-badge ${activeCase.sourceKind}`;
  elements.explode.value = "0";
  elements.modelScale.textContent = "教学展开 × 1.0";
  elements.runMessage.textContent = "";
  scene.setCase(activeCase);
  renderObjectList();
  renderLayout();
  renderCaseInspector();
  elements.runButton.disabled = activeCase.availability !== "ready";
}

function renderObjectList() {
  elements.objectList.replaceChildren();
  if (activeCase.entities.length === 0) {
    elements.objectList.textContent = "该案例尚无可展示的真实对象。";
    return;
  }
  activeCase.entities.forEach((entity) => {
    const button = document.createElement("button");
    button.className = `object-button ${entity.id === selectedId ? "selected" : ""}`;
    button.type = "button";
    button.dataset.entityId = entity.id;
    button.innerHTML = `<strong>${entity.name}</strong><small>${entity.role} · ${entity.layer}</small>`;
    button.addEventListener("click", () => selectEntity(entity.id));
    elements.objectList.append(button);
  });
}

function renderLayout() {
  const svgNamespace = "http://www.w3.org/2000/svg";
  elements.layout.replaceChildren();
  const grid = document.createElementNS(svgNamespace, "path");
  grid.setAttribute("d", "M 0 30 H 270 M 0 60 H 270 M 0 90 H 270 M 30 0 V 132 M 60 0 V 132 M 90 0 V 132 M 120 0 V 132 M 150 0 V 132 M 180 0 V 132 M 210 0 V 132 M 240 0 V 132");
  grid.setAttribute("class", "layout-grid");
  elements.layout.append(grid);
  const row = document.createElementNS(svgNamespace, "rect");
  row.setAttribute("x", "7"); row.setAttribute("y", "37"); row.setAttribute("width", "248"); row.setAttribute("height", "51"); row.setAttribute("rx", "2"); row.setAttribute("class", "layout-row");
  elements.layout.append(row);
  activeCase.entities.forEach((entity) => {
    const entityGroup = document.createElementNS(svgNamespace, "g");
    entityGroup.dataset.entityId = entity.id;
    const rectangle = document.createElementNS(svgNamespace, "rect");
    rectangle.setAttribute("x", String(entity.x)); rectangle.setAttribute("y", String(entity.y));
    rectangle.setAttribute("width", String(entity.width)); rectangle.setAttribute("height", String(entity.height));
    rectangle.setAttribute("fill", entity.color); rectangle.setAttribute("rx", entity.type === "via" ? "2" : "1");
    rectangle.setAttribute("class", `layout-entity ${entity.id === selectedId ? "selected" : ""}`);
    rectangle.classList.toggle("dimmed", !visibleLayers.has(entity.layer));
    rectangle.addEventListener("click", () => selectEntity(entity.id));
    entityGroup.append(rectangle);
    if (entity.type !== "net" || entity.height > 5) {
      const label = document.createElementNS(svgNamespace, "text");
      label.textContent = entity.name;
      label.setAttribute("x", String(entity.x + entity.width / 2));
      label.setAttribute("y", String(entity.y + entity.height / 2 + 2.5));
      label.setAttribute("class", "layout-label");
      entityGroup.append(label);
    }
    elements.layout.append(entityGroup);
  });
}

function selectEntity(entityId) {
  selectedId = entityId;
  scene.setSelection(entityId);
  renderObjectList();
  renderLayout();
  const entity = activeCase.entities.find((item) => item.id === entityId);
  if (!entity) return;
  elements.inspector.innerHTML = `
    <h3>${entity.name}</h3>
    <p>${entity.explanation}</p>
    <dl class="metadata">
      <div><dt>稳定 ID</dt><dd>${entity.id}</dd></div>
      <div><dt>类型</dt><dd>${entity.type}</dd></div>
      <div><dt>角色</dt><dd>${entity.role}</dd></div>
      <div><dt>网络</dt><dd>${entity.net}</dd></div>
      <div><dt>图层</dt><dd>${entity.layer}</dd></div>
      <div><dt>来源</dt><dd>${activeCase.sourceLabel}</dd></div>
    </dl>`;
}

function renderCaseInspector() {
  elements.inspector.innerHTML = `<h3>${activeCase.title}</h3><p>${activeCase.description}</p><p>从二维或三维中选择对象，查看其教学角色和来源边界。</p>`;
}

document.querySelectorAll("[data-layer]").forEach((control) => {
  control.addEventListener("change", () => {
    if (control.checked) visibleLayers.add(control.dataset.layer);
    else visibleLayers.delete(control.dataset.layer);
    scene.setLayers(visibleLayers);
    renderLayout();
  });
});

elements.select.addEventListener("change", () => loadCase(elements.select.value));
elements.explode.addEventListener("input", () => {
  const amount = Number(elements.explode.value);
  scene.setExplode(amount);
  elements.modelScale.textContent = `教学展开 × ${(1 + amount / 100).toFixed(1)}`;
});
elements.runButton.addEventListener("click", async () => {
  try {
    const result = await requestJson("/api/runs", "POST");
    elements.runMessage.textContent = result.message ?? "运行请求未完成。";
  } catch (error) {
    elements.runMessage.textContent = error.message;
  }
});

/**
 * 运行期只访问同源教学服务。这里使用 XMLHttpRequest，避免将案例加载
 * 绑定到某个浏览器的 Fetch 支持细节；真实 ORFS 请求仍由后端受约束处理。
 */
function requestJson(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);
    request.responseType = "json";
    request.onload = () => {
      const payload = request.response ?? safeParse(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        resolve(payload);
        return;
      }
      reject(new Error(payload?.message ?? payload?.error ?? `请求失败（HTTP ${request.status}）`));
    };
    request.onerror = () => reject(new Error("无法连接教学服务"));
    request.send();
  });
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

boot();
