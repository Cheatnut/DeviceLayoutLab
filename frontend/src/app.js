import { renderTeachingViews } from "./teaching.js";
import { TeachingScene } from "./scene.js";
import { initializeLibrary } from "./library.js";

const elements = {
  group: document.querySelector("#case-group-select"),
  select: document.querySelector("#case-select"),
  sourceBadge: document.querySelector("#source-badge"),
  title: document.querySelector("#case-title"),
  status: document.querySelector("#case-status"),
  stage: document.querySelector("#case-stage"),
  objectList: document.querySelector("#object-list"),
  visibilityControls: document.querySelector("#visibility-controls"),
  layout: document.querySelector("#layout-view"),
  inspector: document.querySelector("#inspector-content"),
};

let catalog = null;
let activeCase = null;
let selectedId = null;
let caseRequestVersion = 0;
const visibleLayers = new Set();
const visibleEntities = new Set();
const scene = new TeachingScene(document.querySelector("#model-view"), selectEntity);

// 左栏切换对象选择与工艺库；右栏对象说明、对象可见性和材料图层控制始终独立保留。
function showPanel(panel) {
  const isLibrary = panel === "library";
  document.querySelector("#objects-section").hidden = isLibrary;
  document.querySelector("#library-section").hidden = !isLibrary;
  elements.inspector.hidden = isLibrary;
  document.querySelector("#library-detail").hidden = !isLibrary;
  document.querySelector("#inspector-title").textContent = isLibrary ? "库单元说明" : "对象说明";
  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.panel === panel));
  });
}

function setSidebarCollapsed(collapsed) {
  document.querySelector(".workspace").classList.toggle("sidebar-collapsed", collapsed);
  setPanelInert(document.querySelector("#sidebar-content"), document.querySelector("#sidebar-toggle"), collapsed);
  const toggle = document.querySelector("#sidebar-toggle");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", collapsed ? "展开左侧边栏" : "收起左侧边栏");
  toggle.title = `${toggle.getAttribute("aria-label")}（Ctrl+B）`;
  toggle.textContent = collapsed ? "›" : "‹";
}

// 折叠内容保留在布局中完成过渡，但即时禁用交互及无障碍焦点。
function setPanelInert(content, toggle, collapsed) {
  if (collapsed && content.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  content.inert = collapsed;
  content.setAttribute("aria-hidden", String(collapsed));
}

function toggleInspector() {
  const toggle = document.querySelector("#inspector-toggle");
  const collapsed = toggle.getAttribute("aria-expanded") === "true";
  document.querySelector(".workspace").classList.toggle("inspector-collapsed", collapsed);
  setPanelInert(document.querySelector("#inspector-body"), toggle, collapsed);
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", collapsed ? "展开右侧边栏" : "收起右侧边栏");
  toggle.title = `${toggle.getAttribute("aria-label")}（Ctrl+L）`;
  toggle.textContent = collapsed ? "‹" : "›";
}

function toggleSidebar() {
  setSidebarCollapsed(document.querySelector("#sidebar-toggle").getAttribute("aria-expanded") === "true");
}
document.querySelector("#sidebar-toggle").addEventListener("click", toggleSidebar);
document.querySelector("#inspector-toggle").addEventListener("click", toggleInspector);

// 固定页面只把画布滚轮切换为缩放，并锁住文档滚动；不改变工作台布局或侧栏位置。
let pagePinned = false;
function setPagePinned(pinned) {
  // 固定只改变滚轮用途，不移动整页视口，侧栏因此始终留在原来的屏幕位置。
  pagePinned = pinned;
  document.documentElement.classList.toggle("page-pinned", pinned);
  scene.setZoomEnabled(pinned);
  const button = document.querySelector("#model-pin");
  button.setAttribute("aria-pressed", String(pinned));
  button.setAttribute("aria-label", pinned ? "取消固定页面" : "固定页面");
  button.title = pinned ? "取消固定页面（Esc）" : "固定页面，滚轮缩放三维";
  document.querySelector("#model-hint").textContent = pinned
    ? "中键拖动旋转 · 画布滚轮缩放 · Esc 取消固定"
    : "中键拖动旋转 · 滚轮上下浏览 · 左键选择对象";
}
document.querySelector("#model-pin").addEventListener("click", () => setPagePinned(!pagePinned));
document.querySelector("#model-reset").addEventListener("click", () => scene.resetView());
for (const [id, option] of [["model-grid", "grid"], ["model-labels", "labels"]]) {
  const button = document.getElementById(id);
  button.addEventListener("click", () => {
    const visible = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(visible));
    scene.setDisplay(option, visible);
  });
}
for (const button of document.querySelectorAll("[data-diagram-text]")) {
  button.addEventListener("click", () => {
    const svg = document.getElementById(button.dataset.diagramText);
    const visible = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", `${visible ? "隐藏" : "显示"}${button.dataset.diagramText === "layout-view" ? "单元版图" : button.dataset.diagramText === "stick-view" ? "棍图" : button.dataset.diagramText === "positional-view" ? "位置对应电路" : "整理后电路"}文字`);
    button.title = `${visible ? "隐藏" : "显示"}文字`;
    svg.classList.toggle("text-hidden", !visible);
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pagePinned) setPagePinned(false);
  // 不影响输入框、可编辑文案及浏览器其它组合键；长按只切换一次。
  const shortcut = event.key.toLowerCase();
  if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && ["b", "l"].includes(shortcut)
      && !event.target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) {
    event.preventDefault();
    if (!event.repeat) (shortcut === "b" ? toggleSidebar : toggleInspector)();
  }
});
document.querySelectorAll("[data-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    showPanel(button.dataset.panel);
    setSidebarCollapsed(false);
  });
});

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
  elements.group.replaceChildren();
  for (const group of catalog.groups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.title;
    elements.group.append(option);
  }
  elements.group.value = catalog.cases[0].groupId;
  populateGroupCases();
}

function populateGroupCases() {
  elements.select.replaceChildren();
  for (const caseSummary of catalog.cases.filter((item) => item.groupId === elements.group.value)) {
    const option = document.createElement("option");
    option.value = caseSummary.id;
    option.textContent = caseSummary.title;
    elements.select.append(option);
  }
}

async function loadCase(caseId) {
  const version = ++caseRequestVersion;
  let loaded;
  try {
    loaded = await requestJson(`/api/cases/${encodeURIComponent(caseId)}`);
  } catch (error) {
    if (version !== caseRequestVersion) return;
    if (!activeCase) {
      elements.title.textContent = "案例加载失败";
      elements.inspector.textContent = `无法读取教学服务：${error.message}`;
      return;
    }
    // 失败时回到当前展示的案例，防止下拉框标题与画布内容不一致。
    elements.group.value = activeCase.groupId;
    populateGroupCases();
    elements.select.value = activeCase.id;
    elements.inspector.textContent = `案例切换失败：${error.message}`;
    return;
  }
  // 快速切换时只应用最后一次请求，较晚返回的旧请求不得覆盖新场景。
  if (version !== caseRequestVersion) return;
  activeCase = loaded;
  selectedId = null;
  elements.select.value = activeCase.id;
  elements.title.textContent = activeCase.title;
  elements.stage.textContent = `阶段：${activeCase.stage}`;
  elements.status.textContent = activeCase.availability === "ready" ? "可浏览" : "等待环境核验";
  elements.status.classList.toggle("pending", activeCase.availability !== "ready");
  elements.sourceBadge.textContent = activeCase.sourceLabel;
  elements.sourceBadge.className = `source-badge ${activeCase.sourceKind}`;
  renderVisibilityControls();
  renderLayerControls();
  renderObjectList();
  scene.setCase(activeCase);
  scene.setLayers(visibleLayers);
  scene.setEntityVisibility(visibleEntities);
  renderLayout();
  renderCaseInspector();
}

function renderObjectList() {
  elements.objectList.replaceChildren();
  const entities = (activeCase.entities ?? []).filter(entity => entity.list !== false);
  if (entities.length === 0) {
    elements.objectList.textContent = "该案例暂无可选对象。";
    return;
  }
  for (const entity of entities) {
    const button = document.createElement("button");
    button.className = `object-button ${entity.id === selectedId ? "selected" : ""}`;
    button.type = "button";
    button.dataset.entityId = entity.id;
    const name = document.createElement("strong");
    name.textContent = entity.name;
    button.append(name);
    if (entity.role && entity.role !== entity.name) {
      const role = document.createElement("small");
      role.textContent = entity.role;
      button.append(role);
    }
    button.addEventListener("click", () => selectEntity(entity.id));
    elements.objectList.append(button);
  }
}

function visibilityGroups(entities) {
  const definitions = [
    ["P衬底", "NMOS 所在的衬底与隔离场区", entity => entity.id === "substrate" || entity.layer === "FIELD"],
    ["N-well", "PMOS 所在的 N 型阱区", entity => entity.id === "nwell"],
    ["P衬底接触", "把 P 衬底连接到 GND", entity => entity.id === "substrate-tap"],
    ["N阱接触", "把 N 阱连接到 VDD", entity => entity.id === "well-tap"],
    ["P型有源区", "PMOS 源极、漏极与沟道区域", entity => entity.id === "paa"],
    ["N型有源区", "NMOS 源极、漏极与沟道区域", entity => entity.id === "naa"],
    ["VDD", "正电源轨及其连接", entity => entity.layer === "M1" && entity.net === "VDD"],
    ["GND", "接地轨及其连接", entity => entity.layer === "M1" && entity.net === "GND"],
    ["多晶硅", "输入栅极与栅氧结构", entity => ["POLY", "OXIDE"].includes(entity.layer)],
    ["接触孔", "连接有源区与金属层的孔", entity => entity.layer === "CONTACT"],
    ["M1金属连线", "信号网络连线，不含 VDD 与 GND", entity => entity.layer === "M1" && !["VDD", "GND"].includes(entity.net)],
  ];
  return definitions.map(([name, note, matches]) => ({
    name, note, ids: entities.filter(matches).map(entity => entity.id),
  }));
}

function renderVisibilityControls() {
  const controls = elements.visibilityControls;
  controls.replaceChildren();
  const heading = document.createElement("p");
  heading.className = "visibility-heading";
  heading.textContent = "显示对象";
  controls.append(heading);
  const entities = activeCase.entities ?? [];
  const groups = visibilityGroups(entities);
  visibleEntities.clear();
  entities.forEach(entity => visibleEntities.add(entity.id));
  for (const group of groups) {
    const label = document.createElement("label");
    label.className = "visibility-entry";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = group.ids.length > 0;
    input.disabled = group.ids.length === 0;
    input.setAttribute("aria-label", `显示${group.name}`);
    const text = document.createElement("span");
    text.className = "visibility-entry-text";
    const name = document.createElement("strong");
    name.textContent = group.name;
    const note = document.createElement("small");
    note.textContent = group.note;
    text.append(name, note);
    label.append(input, text);
    controls.append(label);
    input.addEventListener("change", () => {
      for (const id of group.ids) {
        if (input.checked) visibleEntities.add(id);
        else visibleEntities.delete(id);
      }
      scene.setEntityVisibility(visibleEntities);
      renderLayout();
    });
  }
}

function renderLayout() {
  renderTeachingViews(activeCase, selectedId, visibleLayers, visibleEntities, selectEntity);
}

function renderLayerControls() {
  const controls = document.querySelector("#layer-controls");
  controls.replaceChildren();
  visibleLayers.clear();
  const heading = document.createElement("div");
  heading.className = "layer-controls-heading";
  const title = document.createElement("p");
  title.textContent = "材料与图层";
  const actions = document.createElement("div");
  actions.className = "layer-control-actions";
  for (const action of [
    { id: "all", title: "全选图层", label: "全选图层", path: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
    { id: "invert", title: "反选图层", label: "反选图层", path: "M5 5h6v6H5zM13 13h6v6h-6zM16 4l4 4m0-4-4 4M4 16l4 4m0-4-4 4" },
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button layer-action";
    button.dataset.layerAction = action.id;
    button.title = action.title;
    button.setAttribute("aria-label", action.label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", action.path);
    svg.append(shape);
    button.append(svg);
    actions.append(button);
  }
  heading.append(title, actions);
  controls.append(heading);
  for (const [id, layer] of Object.entries(activeCase.teaching?.layers ?? {})) {
    visibleLayers.add(id);
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.dataset.layer = id;
    label.className = "layer-entry";
    const swatch = document.createElement("i");
    swatch.className = "material-swatch";
    swatch.style.background = layer.color;
    const name = document.createElement("span");
    name.className = "layer-entry-name";
    name.append(input, swatch, document.createTextNode(layer.name));
    label.append(name);
    controls.append(label);
    input.addEventListener("change", () => {
      if (input.checked) visibleLayers.add(id);
      else visibleLayers.delete(id);
      scene.setLayers(visibleLayers);
      renderLayout();
    });
  }
  actions.addEventListener("click", event => {
    const button = event.target.closest("[data-layer-action]");
    if (!button) return;
    const inputs = [...controls.querySelectorAll("input[data-layer]")];
    for (const input of inputs) {
      input.checked = button.dataset.layerAction === "all" ? true : !input.checked;
      if (input.checked) visibleLayers.add(input.dataset.layer);
      else visibleLayers.delete(input.dataset.layer);
    }
    scene.setLayers(visibleLayers);
    renderLayout();
  });
}

function selectEntity(entityId) {
  showPanel("objects");
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


elements.group.addEventListener("change", () => {
  populateGroupCases();
  loadCase(elements.select.value);
});
elements.select.addEventListener("change", () => loadCase(elements.select.value));
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
initializeLibrary(requestJson);
