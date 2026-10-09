/**
 * 显示后端按唯一配置读取的真实库抽象。
 * 只把 LEF 引脚图形解释为抽象几何；不从二维重叠推断电气连接或器件结构。
 */
export async function initializeLibrary(requestJson) {
  const selector = document.querySelector("#library-pdk");
  const list = document.querySelector("#library-cells");
  const detail = document.querySelector("#library-detail");
  const status = document.querySelector("#library-status");
  let catalog;
  let selectionVersion = 0;

  function message(text) {
    detail.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    detail.append(paragraph);
  }

  async function selectCell(pdkId, registration) {
    const version = ++selectionVersion;
    message("正在读取单元资料…");
    try {
      const cell = await requestJson(`/api/library/${encodeURIComponent(pdkId)}/cells/${encodeURIComponent(registration.name)}`);
      if (version !== selectionVersion) return;
      renderCell(detail, cell);
    } catch (error) {
      if (version === selectionVersion) message(error.message);
    }
  }

  function selectPdk() {
    selectionVersion += 1;
    const pdk = catalog.find((item) => item.id === selector.value);
    list.replaceChildren();
    status.textContent = pdk.abstract_available ? "真实单元 LEF 可读" : "库路径待配置或核验";
    message("选择单元查看 LEF 和 Liberty。GDS 内部结构将在后续接入。");
    for (const registration of pdk.cells) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "object-button";
      button.textContent = `${registration.role} · ${registration.name}`;
      button.addEventListener("click", () => selectCell(pdk.id, registration));
      list.append(button);
    }
  }

  try {
    const response = await requestJson("/api/library/pdks");
    catalog = response.pdks;
    for (const pdk of catalog) {
      const option = document.createElement("option");
      option.value = pdk.id;
      option.textContent = pdk.title;
      selector.append(option);
    }
    selector.addEventListener("change", selectPdk);
    selectPdk();
  } catch (error) {
    status.textContent = "工艺库不可用";
    message(error.message);
  }
}

function addText(parent, tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderCell(parent, cell) {
  parent.replaceChildren();
  addText(parent, "h3", cell.name);
  addText(parent, "p", `${cell.role} · ${cell.role_evidence}`);
  if (!cell.lef) {
    addText(parent, "p", "登记的单元未在该 LEF 中找到。请核对库版本与单元身份。");
    return;
  }
  const lef = cell.lef;
  addText(parent, "p", `边界 ${lef.width} × ${lef.height} ${lef.unit} · SITE ${lef.site ?? "未声明"} · CLASS ${lef.class ?? "未声明"}`);
  const geometryView = createPinView(lef);
  parent.append(geometryView);
  const layerControls = document.createElement("div");
  layerControls.className = "library-layer-controls";
  const layers = [...new Set(lef.pins.flatMap((pin) => pin.geometry.map((shape) => shape.layer)))];
  for (const layer of layers) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      for (const shape of geometryView.querySelectorAll("[data-layer]")) {
        if (shape.dataset.layer === layer) shape.style.display = checkbox.checked ? "" : "none";
      }
    });
    label.append(checkbox, document.createTextNode(layer));
    layerControls.append(label);
  }
  parent.append(layerControls);
  addText(parent, "p", lef.scope);
  const table = document.createElement("table");
  table.className = "library-pin-table";
  const header = document.createElement("tr");
  ["引脚", "用途 / 方向", "几何图层"].forEach((text) => addText(header, "th", text));
  table.append(header);
  for (const pin of lef.pins) {
    const row = document.createElement("tr");
    addText(row, "td", pin.name);
    addText(row, "td", `${pin.use ?? "—"} / ${pin.direction ?? "—"}`);
    addText(row, "td", [...new Set(pin.geometry.map((shape) => shape.layer))].join(", ") || "未提取");
    table.append(row);
  }
  parent.append(table);
  if (lef.unsupported_geometry.length) addText(parent, "p", `当前未提取的引脚几何：${lef.unsupported_geometry.join(", ")}`);
  for (const corner of cell.liberty) {
    addText(parent, "h4", `Liberty · ${corner.source.file}`);
    for (const condition of corner.operating_conditions) {
      addText(parent, "p", `${condition.name} · 电压 ${condition.voltage ?? "未声明"}（${corner.units.voltage_unit ?? "单位未声明"}） · 温度 ${condition.temperature ?? "未声明"} °C`);
    }
    for (const pin of corner.pins) {
      if (pin.function) addText(parent, "p", `${pin.name} = ${pin.function}`);
    }
    addText(parent, "p", corner.scope);
  }
  if (!cell.liberty.length) addText(parent, "p", "此单元没有读取到 Liberty 条目；物理单元可能本就没有逻辑功能。");
  addText(parent, "p", `来源 ${cell.sources.cell_lef.file} · SHA-256 ${cell.sources.cell_lef.sha256.slice(0, 12)}…`);
  for (const file of cell.gds) addText(parent, "p", `GDS ${file.file}：${file.available ? "文件可读，内部几何尚未解析" : "文件不可读"}`);
}

function createPinView(lef) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const margin = Math.max(lef.width, lef.height) * 0.12;
  svg.setAttribute("viewBox", `${-margin} ${-margin} ${lef.width + 2 * margin} ${lef.height + 2 * margin}`);
  svg.setAttribute("class", "library-pin-view");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "真实 LEF 单元边界和引脚矩形");
  const boundary = document.createElementNS(namespace, "rect");
  boundary.setAttribute("class", "library-boundary");
  Object.entries({x: 0, y: 0, width: lef.width, height: lef.height, "stroke-width": Math.max(lef.width, lef.height) / 130}).forEach(([key, value]) => boundary.setAttribute(key, String(value)));
  svg.append(boundary);
  lef.pins.forEach((pin, index) => {
    for (const shape of pin.geometry) {
      const [x1, y1, x2, y2] = shape.rect;
      const rectangle = document.createElementNS(namespace, "rect");
      rectangle.dataset.layer = shape.layer;
      // LEF 原点在左下角，SVG 原点在左上角。只变换显示坐标，不改源矩形。
      Object.entries({x: x1, y: lef.height - y2, width: x2 - x1, height: y2 - y1, fill: `hsl(${index * 67 % 360} 78% 64%)`, opacity: 0.64}).forEach(([key, value]) => rectangle.setAttribute(key, String(value)));
      const title = document.createElementNS(namespace, "title");
      title.textContent = `${pin.name} · ${shape.layer} · [${shape.rect.join(", ")}] ${lef.unit}`;
      rectangle.append(title);
      svg.append(rectangle);
    }
  });
  return svg;
}
