import { renderTeachingViews } from "./teaching.js";
import { TeachingScene } from "./scene.js";
import { teachingObjects, polyCards, cycleCard } from "./objects.js";

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
let selectedGroupId = null;
let selectedIds = new Set();
let objectGroups = [];
let cards = [];
let cardIndex = 0;
let caseRequestVersion = 0;
const visibleLayers = new Set();
const visibleEntities = new Set();
const scene = new TeachingScene(document.querySelector("#model-view"), selectEntity);
const TOUR_INTERVAL_MS = 1000;
const tour = { active: false, playing: false, index: -1, timer: null };
let pendingRevealIds = null;
const tourButtons = {
  play: document.querySelector("#tour-play"),
  restart: document.querySelector("#tour-restart"),
  pause: document.querySelector("#tour-pause"),
  previous: document.querySelector("#tour-previous"),
  next: document.querySelector("#tour-next"),
};

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
    button.setAttribute("aria-label", `${visible ? "隐藏" : "显示"}${button.dataset.diagramText === "layout-view" ? "单元版图" : "棍图"}文字`);
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
document.querySelector("[data-panel='objects']").addEventListener("click", () => setSidebarCollapsed(false));
tourButtons.play.addEventListener("click", playTour);
tourButtons.restart.addEventListener("click", restartTour);
tourButtons.pause.addEventListener("click", pauseTour);
tourButtons.previous.addEventListener("click", () => stepTour(-1));
tourButtons.next.addEventListener("click", () => stepTour(1));

function tourGroups() {
  return objectGroups.filter(group => group.ids.length > 0);
}

function stopTourTimer() {
  if (tour.timer !== null) clearTimeout(tour.timer);
  tour.timer = null;
}

function updateTourControls() {
  const groups = activeCase?.teaching ? tourGroups() : [];
  const available = groups.length > 0;
  tourButtons.play.disabled = !available || tour.playing;
  tourButtons.restart.disabled = !available;
  tourButtons.pause.disabled = !tour.playing;
  tourButtons.pause.setAttribute("aria-pressed", String(tour.playing));
  tourButtons.previous.disabled = !tour.active || tour.index <= 0;
  tourButtons.next.disabled = !available || (tour.active && tour.index >= groups.length - 1);
  document.querySelector("#tour-status").textContent = tour.active
    ? `第 ${tour.index + 1} / ${groups.length} 步：${groups[tour.index]?.name ?? ""}`
    : "";
}

function exitTour() {
  stopTourTimer();
  tour.active = false;
  tour.playing = false;
  tour.index = -1;
  pendingRevealIds = null;
  updateTourControls();
}

function prepareTour() {
  if (!activeCase?.teaching || !tourGroups().length) return false;
  // 逐步讲解需要右栏可见，展开后才能看到当前对象对应的说明。
  if (document.querySelector("#inspector-toggle").getAttribute("aria-expanded") === "false") toggleInspector();
  // 演示从完整对象集开始，保证此前关闭的图层不会导致某一步看不到对象。
  visibleEntities.clear();
  for (const entity of activeCase.entities ?? []) visibleEntities.add(entity.id);
  for (const input of elements.visibilityControls.querySelectorAll("input[data-visibility-group]")) {
    input.checked = !input.disabled;
  }
  scene.setEntityVisibility(visibleEntities);
  tour.active = true;
  return true;
}

function showTourStep(index) {
  const group = tourGroups()[index];
  if (!group) return;
  tour.index = index;
  pendingRevealIds = new Set(group.ids);
  selectObject(group, null, true);
  document.querySelector(".inspector").scrollTop = 0;
  updateTourControls();
}

function scheduleTourStep() {
  stopTourTimer();
  if (!tour.playing) return;
  tour.timer = setTimeout(() => {
    tour.timer = null;
    const nextIndex = tour.index + 1;
    if (nextIndex >= tourGroups().length) {
      tour.playing = false;
      updateTourControls();
      return;
    }
    showTourStep(nextIndex);
    scheduleTourStep();
  }, TOUR_INTERVAL_MS);
}

function playTour() {
  if (!activeCase?.teaching || tour.playing) return;
  if (!tour.active || tour.index >= tourGroups().length - 1) {
    if (!prepareTour()) return;
    showTourStep(0);
  }
  tour.playing = tour.index < tourGroups().length - 1;
  updateTourControls();
  scheduleTourStep();
}

function restartTour() {
  stopTourTimer();
  tour.playing = false;
  if (!prepareTour()) return;
  showTourStep(0);
  tour.playing = tourGroups().length > 1;
  updateTourControls();
  scheduleTourStep();
}

function pauseTour() {
  stopTourTimer();
  tour.playing = false;
  updateTourControls();
}

function stepTour(direction) {
  pauseTour();
  if (!tour.active && !prepareTour()) return;
  const nextIndex = Math.min(tourGroups().length - 1, Math.max(0, tour.index + direction));
  if (nextIndex !== tour.index) showTourStep(nextIndex);
}

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
  pauseTour();
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
  exitTour();
  activeCase = loaded;
  selectedGroupId = null;
  selectedIds = new Set();
  objectGroups = teachingObjects(activeCase);
  cards = [];
  cardIndex = 0;
  elements.select.value = activeCase.id;
  elements.title.textContent = activeCase.title;
  elements.stage.textContent = `阶段：${activeCase.stage}`;
  elements.status.textContent = activeCase.availability === "ready" ? "可浏览" : "等待环境核验";
  elements.status.classList.toggle("pending", activeCase.availability !== "ready");
  elements.sourceBadge.textContent = activeCase.sourceLabel;
  elements.sourceBadge.className = `source-badge ${activeCase.sourceKind}`;
  renderVisibilityControls();
  initializeVisibleLayers();
  renderObjectList();
  scene.setCase(activeCase);
  scene.setLayers(visibleLayers);
  scene.setEntityVisibility(visibleEntities);
  renderLayout();
  renderCaseInspector();
  updateTourControls();
}

function renderObjectList() {
  elements.objectList.replaceChildren();
  const groups = objectGroups;
  if (groups.length === 0) {
    elements.objectList.textContent = "该案例暂无可选对象。";
    return;
  }
  for (const group of groups) {
    const button = document.createElement("button");
    button.className = `object-button ${group.id === selectedGroupId ? "selected" : ""}`;
    button.setAttribute("aria-pressed", String(group.id === selectedGroupId));
    button.type = "button";
    button.dataset.objectId = group.id;
    button.disabled = group.ids.length === 0;
    const name = document.createElement("strong");
    name.textContent = group.name;
    button.append(name);
    const note = document.createElement("small");
    note.textContent = group.note;
    button.append(note);
    button.addEventListener("click", () => selectObject(group));
    elements.objectList.append(button);
  }
}

function renderVisibilityControls() {
  const controls = elements.visibilityControls;
  controls.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "visibility-heading";
  const title = document.createElement("p");
  title.textContent = "材料与图层";
  const actions = document.createElement("div");
  actions.className = "layer-control-actions";
  for (const action of [
    { id: "all", title: "全选对象", label: "全选对象", path: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
    { id: "invert", title: "反选对象", label: "反选对象", path: "M5 5h6v6H5zM13 13h6v6h-6zM16 4l4 4m0-4-4 4M4 16l4 4m0-4-4 4" },
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button layer-action";
    button.dataset.visibilityAction = action.id;
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
  const entities = activeCase.entities ?? [];
  const groups = objectGroups;
  visibleEntities.clear();
  entities.forEach(entity => visibleEntities.add(entity.id));
  for (const group of groups) {
    const label = document.createElement("label");
    label.className = "visibility-entry";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = group.ids.length > 0;
    input.disabled = group.ids.length === 0;
    input.dataset.visibilityGroup = group.ids.join(",");
    input.dataset.objectId = group.id;
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
      if (tour.active) exitTour();
      for (const id of group.ids) {
        if (input.checked) visibleEntities.add(id);
        else visibleEntities.delete(id);
      }
      scene.setEntityVisibility(visibleEntities);
      renderLayout();
    });
  }
  actions.addEventListener("click", event => {
    const button = event.target.closest("[data-visibility-action]");
    if (!button) return;
    if (tour.active) exitTour();
    for (const input of controls.querySelectorAll("input[data-visibility-group]")) {
      if (input.disabled) continue;
      input.checked = button.dataset.visibilityAction === "all" ? true : !input.checked;
      for (const id of input.dataset.visibilityGroup.split(",").filter(Boolean)) {
        if (input.checked) visibleEntities.add(id);
        else visibleEntities.delete(id);
      }
    }
    scene.setEntityVisibility(visibleEntities);
    renderLayout();
  });
}

function renderLayout() {
  const shown = tour.active
    ? new Set(tourGroups().slice(0, tour.index + 1).flatMap(group => group.ids))
    : visibleEntities;
  const revealIds = pendingRevealIds ?? new Set();
  pendingRevealIds = null;
  renderTeachingViews(activeCase, selectedIds, visibleLayers, shown, selectEntity, revealIds);
}

function initializeVisibleLayers() {
  visibleLayers.clear();
  for (const id of Object.keys(activeCase.teaching?.layers ?? {})) visibleLayers.add(id);
}

function selectEntity(entityId) {
  const group = objectGroups.find(item => item.ids.includes(entityId));
  if (group) selectObject(group, entityId);
}

function applySelection(ids) {
  selectedIds = new Set(ids);
  scene.setSelection(selectedIds);
  renderLayout();
}

function selectObject(group, entityId = null, fromTour = false) {
  if (!fromTour && tour.active) exitTour();
  selectedGroupId = group.id;
  cards = group.id === "poly" ? polyCards(activeCase, group) : [];
  // 画布点击定位相应说明卡；侧栏点击始终回到完整对象组。
  cardIndex = entityId && cards.length
    ? Math.max(0, cards.findIndex((card, index) => index > 0 && card.ids.includes(entityId))) : 0;
  applySelection(cards.length ? cards[cardIndex].ids : group.ids);
  renderObjectList();
  elements.inspector.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = group.name;
  const description = document.createElement("p");
  description.textContent = group.explanation;
  elements.inspector.append(heading, description);
  if (cards.length) renderPolyCarousel();
  const source = document.createElement("p");
  source.className = "object-source";
  source.textContent = `来源：${activeCase.sourceLabel}`;
  elements.inspector.append(source);
}

function renderPolyCarousel() {
  const carousel = document.createElement("section");
  carousel.className = "poly-carousel";
  carousel.tabIndex = 0;
  carousel.setAttribute("aria-label", "多晶硅详情，滚轮或左右方向键循环切换");
  const viewport = document.createElement("div");
  viewport.className = "poly-card-viewport";
  const card = document.createElement("article");
  card.className = "poly-card";
  card.setAttribute("aria-live", "polite");
  const title = document.createElement("h4");
  const note = document.createElement("p");
  card.append(title, note);
  viewport.append(card);
  const navigation = document.createElement("div");
  navigation.className = "poly-card-navigation";
  const counter = document.createElement("span");
  const previous = document.createElement("button");
  const next = document.createElement("button");
  for (const [button, text, label] of [[previous, "‹", "上一张多晶硅说明"], [next, "›", "下一张多晶硅说明"]]) {
    button.type = "button";
    button.className = "icon-button";
    button.textContent = text;
    button.setAttribute("aria-label", label);
  }
  navigation.append(previous, counter, next);
  const hint = document.createElement("small");
  hint.textContent = "滚轮切换 · 首尾循环";
  carousel.append(viewport, navigation, hint);
  elements.inspector.append(carousel);
  const update = (direction = 0) => {
    if (direction && tour.active) exitTour();
    cardIndex = cycleCard(cardIndex, direction, cards.length);
    title.textContent = cards[cardIndex].name;
    note.textContent = cards[cardIndex].note;
    counter.textContent = `${cardIndex + 1} / ${cards.length}`;
    card.dataset.cardId = cards[cardIndex].id;
    if (direction) applySelection(cards[cardIndex].ids);
    if (direction && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      card.getAnimations().forEach(animation => animation.cancel());
      card.animate([{ opacity: 0, transform: `translateX(${Math.sign(direction) * 25}%)` },
        { opacity: 1, transform: "translateX(0)" }], { duration: 200, easing: "ease-out" });
    }
  };
  previous.addEventListener("click", () => update(-1));
  next.addEventListener("click", () => update(1));
  carousel.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    update(event.key === "ArrowRight" ? 1 : -1);
  });
  let lastWheel = -Infinity;
  let wheelDistance = 0;
  let wheelLocked = false;
  carousel.addEventListener("wheel", event => {
    // 仅说明卡区域接管滚轮；合并触控板的小增量，防止一次惯性滚动跳过多张卡片。
    if (event.ctrlKey) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheel > 180) { wheelDistance = 0; wheelLocked = false; }
    lastWheel = now;
    if (wheelLocked) return;
    const distance = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? carousel.clientHeight : 1);
    if (Math.sign(distance) !== Math.sign(wheelDistance)) wheelDistance = 0;
    wheelDistance += distance;
    if (Math.abs(wheelDistance) < 24) return;
    update(Math.sign(wheelDistance));
    wheelDistance = 0;
    wheelLocked = true;
  }, { passive: false });
  update();
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

updateTourControls();
boot();
