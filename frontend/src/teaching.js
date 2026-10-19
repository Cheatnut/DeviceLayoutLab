/** 四种二维表达共享案例几何与 MOS 拓扑；绘图不修改器件连接。 */
const NS = "http://www.w3.org/2000/svg";
let activeEntities = new Map();
function node(parent, tag, attrs = {}, text = null) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text !== null) element.textContent = text;
  parent.append(element);
  return element;
}
function line(parent, points, color, width = 2, extra = {}) {
  return node(parent, "polyline", { points: points.map(p => p.join(",")).join(" "), fill: "none", stroke: color, "stroke-width": width, "stroke-linejoin": "round", ...extra });
}
function text(parent, x, y, value, extra = {}) {
  return node(parent, "text", { x, y, class: "diagram-text", ...extra }, value);
}
function selectable(parent, id, selected, pick, variant = "", revealing = false) {
  const entity = activeEntities.get(id);
  const color = entity?.color ?? "#536179";
  const group = node(parent, "g", { "data-entity-id": id, class: `diagram-part ${variant} ${selected.has(id) ? "is-selected" : ""} ${revealing ? "is-revealing" : ""}`, "style": `--selection-color:${darken(color)}`, tabindex: 0, role: "button", "aria-label": entity?.name ?? id, "aria-pressed": selected.has(id) });
  group.addEventListener("click", () => pick(id));
  group.addEventListener("keydown", e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); pick(id); } });
  return group;
}
function stickSelectionOutline(group) {
  // 棍图中的线段本身保留材料色；选中时以包围全部几何的轮廓说明对象范围。
  // 契约测试使用的轻量 SVG 替身不提供 getBBox；真实浏览器始终会提供该接口。
  if (typeof group.getBBox !== "function") return;
  const { x, y, width, height } = group.getBBox();
  const padding = 5;
  const outline = node(group, "rect", {
    x: x - padding, y: y - padding, width: width + padding * 2, height: height + padding * 2,
    rx: 3, fill: "none", class: "stick-selection-outline", "pointer-events": "none"
  });
  group.insertBefore(outline, group.firstChild);
}
function darken(color) {
  // 选中框保留对象色相，只降低明度；颜色来源始终是当前案例的材料色表。
  const channel = value => Math.max(0, Math.round(Number.parseInt(value, 16) * 0.58)).toString(16).padStart(2, "0");
  return `#${channel(color.slice(1,3))}${channel(color.slice(3,5))}${channel(color.slice(5,7))}`;
}

function layout(svg, data, selected, layers, visibleEntities, pick, revealIds) {
  const s = data.teaching;
  for (const entity of data.entities) {
    if (entity.planar === false || !layers.has(entity.layer) || !visibleEntities.has(entity.id)) continue;
    const g = selectable(svg, entity.id, selected, pick, "", revealIds.has(entity.id));
    g.setAttribute("aria-label", entity.name);
    const region = ["SUBSTRATE", "NWELL", "FIELD"].includes(entity.layer);
    for (const [x, y, width, height] of entity.rects) {
      node(g, "rect", { x, y, width, height, fill: entity.color,
        "fill-opacity": region ? .25 : .93, stroke: "none" });
      if (entity.layer === "CONTACT") {
        line(g, [[x+2,y+2],[x+width-2,y+height-2]], "#edf1f4", 1);
        line(g, [[x+width-2,y+2],[x+2,y+height-2]], "#edf1f4", 1);
      }
    }
  }
  if (layers.has("NWELL") && visibleEntities.has("nwell")) text(svg, s.well[0]+s.well[2]-8, s.well[1]+s.well[3]-9, s.layers.NWELL.name, { "text-anchor": "end" });
  if (layers.has("SUBSTRATE") && visibleEntities.has("substrate")) text(svg, 370, 312, "P 衬底", { "text-anchor": "end" });
  for (const active of s.active) if (layers.has(active.layer) && visibleEntities.has(active.id)) text(svg, active.rect[0], active.rect[1]-8, active.id.toUpperCase());
  pins(svg, s, layers, visibleEntities);
}

function pins(svg, s, layers = null, visibleEntities = null) {
  if (!layers || layers.has("M1")) {
    if (!visibleEntities || visibleEntities.has("rail-VDD")) text(svg, s.rails.VDD[0][0], s.rails.VDD[0][1]-12, "VDD");
    if (!visibleEntities || visibleEntities.has("rail-GND")) text(svg, s.rails.GND[0][0], s.rails.GND[0][1]+22, "GND");
    if (!visibleEntities || visibleEntities.has("metal-Y")) {
      const out = s.wires.Y.at(-1).at(-1);
      text(svg, out[0]+9, out[1]+5, "Y");
    }
  }
  if (!layers || layers.has("POLY")) for (const gate of s.gates) {
    if (visibleEntities && !visibleEntities.has(gate.id)) continue;
    text(svg, gate.x, gate.top-10, gate.net, { "text-anchor": "middle" });
  }
}

function sticks(svg, data, selected, layers, visibleEntities, pick, revealIds) {
  const s = data.teaching;
  const selectedStickGroups = [];
  for (const id of ["substrate", "field", "nwell"]) {
    const entity = activeEntities.get(id);
    if (!entity || !layers.has(entity.layer) || !visibleEntities.has(id)) continue;
    const group = selectable(svg, id, selected, pick, "stick-part", revealIds.has(id));
    if (selected.has(id)) selectedStickGroups.push(group);
    for (const [x,y,width,height] of entity.rects) {
      node(group, "rect", { x, y, width, height, fill: "none", stroke: id === "nwell" ? entity.color : "none",
        "stroke-dasharray": id === "nwell" ? "5 4" : "none" });
    }
  }
  for (const active of [...s.active, ...s.taps]) {
    if (!layers.has(active.layer) || !visibleEntities.has(active.id)) continue;
    const [x,y,w,h] = active.rect;
    const g = selectable(svg, active.id, selected, pick, "stick-part", revealIds.has(active.id));
    if (selected.has(active.id)) selectedStickGroups.push(g);
    line(g, [[x,y+h/2],[x+w,y+h/2]], s.layers[active.layer].color, s.render.stickStroke);
    text(svg, x, y-3, active.id.toUpperCase(), { "font-size":11 });
  }
  // 棍图沿用与版图相同的多晶硅分段，器件栅和输入连接段不再互相覆盖。
  if (layers.has("POLY")) for (const entity of data.entities.filter(e => e.layer === "POLY")) {
    if (!visibleEntities.has(entity.id)) continue;
    const group = selectable(svg, entity.id, selected, pick, "stick-part", revealIds.has(entity.id));
    if (selected.has(entity.id)) selectedStickGroups.push(group);
    for (const [x,y,width,height] of entity.rects) {
      line(group, [[x+width/2,y],[x+width/2,y+height]], entity.color, s.render.stickStroke);
    }
  }
  if (layers.has("M1")) for (const entity of data.entities.filter(e => e.paths && visibleEntities.has(e.id))) {
    const g = selectable(svg, entity.id, selected, pick, "stick-part", revealIds.has(entity.id));
    if (selected.has(entity.id)) selectedStickGroups.push(g);
    for (const path of entity.paths) line(g, path, entity.color, s.render.stickStroke);
  }
  if (layers.has("CONTACT")) for (const [net, points] of Object.entries(s.contacts)) {
    if (!visibleEntities.has(`contact-${net}`)) continue;
    const g = selectable(svg, `contact-${net}`, selected, pick, "stick-part", revealIds.has(`contact-${net}`));
    if (selected.has(`contact-${net}`)) selectedStickGroups.push(g);
    for (const [x,y] of points) node(g,"rect",{x:x-3.5,y:y-3.5,width:7,height:7,fill:s.layers.CONTACT.color});
  }
  for (const group of selectedStickGroups) stickSelectionOutline(group);
  pins(svg,s,layers,visibleEntities);
}

/** 三端简化 MOS 符号：PMOS 栅端带圆圈，体端连接在对象说明卡中注明。 */
function mos(svg, device, position, angle, selected, pick, ink) {
  const root = selectable(svg, device.id, selected, pick);
  root.setAttribute("aria-label", `${device.name} ${device.type}，栅 ${device.gate}`);
  const g = node(root,"g",{transform:`translate(${position.join(" ")}) rotate(${angle})`});
  // 宽透明命中区使细线符号也能方便地点击。
  node(g,"rect",{x:-36,y:-29,width:48,height:58,fill:"transparent",stroke:"none"});
  line(g,[[-7,-14],[-7,14]],ink,2.3);
  line(g,[[0,-26],[0,-14],[-7,-14]],ink);
  line(g,[[-7,14],[0,14],[0,26]],ink);
  line(g,[[-14,-13],[-14,13]],ink);
  line(g,[[-34,0],[device.type === "pmos" ? -23 : -14,0]],ink);
  if(device.type === "pmos") node(g,"circle",{cx:-19,cy:0,r:4,fill:"white",stroke:ink,"stroke-width":1.8});
  return root;
}

function positionalCircuit(svg, data, selected, pick) {
  const s=data.teaching, ink=s.boundaryColor;
  for(const entity of data.entities.filter(e=>e.paths)) for(const path of entity.paths) line(svg,path,s.layers.M1.color,s.render.diagramStroke);
  for(const active of s.active) {
    const y=active.rect[1]+active.rect[3]/2;
    const devices=s.devices.filter(d=>d.at[1]===y).sort((a,b)=>a.at[0]-b.at[0]);
    let from=active.rect[0]+20;
    for(const d of devices) { line(svg,[[from,y],[d.at[0]-26,y]],ink); from=d.at[0]+26; }
    line(svg,[[from,y],[active.rect[0]+active.rect[2]-20,y]],ink);
  }
  for(const gate of s.gates) {
    const p=s.devices.find(d=>d.gate===gate.net && d.type==="pmos");
    const n=s.devices.find(d=>d.gate===gate.net && d.type==="nmos");
    const crossings=new Set();
    for(const paths of Object.values(s.wires)) for(const path of paths) for(let i=1;i<path.length;i++) {
      const [a,b]=[path[i-1],path[i]];
      if(a[1]===b[1] && Math.min(a[0],b[0])<gate.x && Math.max(a[0],b[0])>gate.x
        && a[1]>p.at[1]+39 && a[1]<n.at[1]-39) crossings.add(a[1]);
    }
    // 只在实际交叉处画跳线弧，INV 无交叉的输入线保持直线。
    let gatePath=`M${gate.x} ${p.at[1]+34}`;
    for(const crossing of [...crossings].sort((a,b)=>a-b)) gatePath+=` V${crossing-5} a5 5 0 0 1 0 10`;
    gatePath+=` V${n.at[1]-34}`;
    node(svg,"path",{d:gatePath,fill:"none",stroke:s.layers.POLY.color,"stroke-width":2});
    text(svg,gate.x+9,(p.at[1]+n.at[1])/2+23,gate.net);
  }
  for(const d of s.devices) {
    mos(svg,d,d.at,d.type==="pmos"?-90:90,selected,pick,ink);
    text(svg,d.at[0],d.at[1]+(d.type==="pmos"?-21:32),d.name,{"text-anchor":"middle"});
  }
  for(const points of Object.values(s.contacts)) for(const [x,y] of points) node(svg,"circle",{cx:x,cy:y,r:3,fill:ink});
  const junction=s.wires.Y.at(-1)[0];
  node(svg,"circle",{cx:junction[0],cy:junction[1],r:3,fill:ink});
  pins(svg,s,new Set(["M1"]));
  if(s.kind==="NAND2") text(svg,222,258,"X",{"text-anchor":"middle"});
}

function standardCircuit(svg,data,selected,pick) {
  const s=data.teaching, ink=s.boundaryColor;
  for(const path of s.standardWires) line(svg,path,ink);
  for(const d of s.devices) {
    mos(svg,d,d.standard,0,selected,pick,ink);
    text(svg,d.standard[0]-41,d.standard[1]+5,d.gate,{"text-anchor":"end"});
    text(svg,d.standard[0]+16,d.standard[1]+5,d.name);
  }
  const output=s.standardWires.at(-1);
  node(svg,"circle",{cx:output[0][0],cy:output[0][1],r:3.5,fill:ink});
  text(svg,210,24,"VDD",{"text-anchor":"middle"});
  text(svg,350,output[1][1]+5,"Y");
  line(svg,[[198,310],[222,310]],ink);
  line(svg,[[203,315],[217,315]],ink);
  text(svg,236,315,"GND");
  if(s.kind==="NAND2") {
    text(svg,229,239,"X");
    node(svg,"circle",{cx:210,cy:46,r:3,fill:ink});
    text(svg,340,91,"并联",{"text-anchor":"middle",class:"diagram-note"});
    text(svg,308,243,"串联",{"text-anchor":"middle",class:"diagram-note"});
  }
}

export function renderTeachingViews(data, selected, layers, visibleEntities, pick, revealIds = new Set()) {
  activeEntities = new Map((data.entities ?? []).map(entity => [entity.id, entity]));
  const ids=["layout-view","stick-view","positional-view","circuit-view"];
  for(const id of ids) {
    const svg=document.getElementById(id);
    svg.replaceChildren();
    svg.setAttribute("viewBox",(data.teaching?.viewBox ?? [0,0,420,330]).join(" "));
    svg.classList.toggle("text-hidden", ids.indexOf(id) < 2 && document.querySelector(`[data-diagram-text="${id}"]`)?.getAttribute("aria-pressed") === "false");
    if(!data.teaching) text(svg,210,165,"此案例暂无版图数据",{"text-anchor":"middle"});
  }
  document.getElementById("logic-case-name").textContent = data.title ?? "案例";
  document.getElementById("logic-kind").textContent = data.teaching?.kind === "NAND2" ? "与非门" : "非门";
  renderLogicFormula(document.getElementById("logic-formula"), data.teaching?.formula ?? "等待案例数据");
  if(!data.teaching) return;
  layout(document.getElementById(ids[0]),data,selected,layers,visibleEntities,pick,revealIds);
  sticks(document.getElementById(ids[1]),data,selected,layers,visibleEntities,pick,revealIds);
  positionalCircuit(document.getElementById(ids[2]),data,selected,pick);
  standardCircuit(document.getElementById(ids[3]),data,selected,pick);
}

function renderLogicFormula(container, formula) {
  container.replaceChildren();
  const negation = formula.match(/^(.*?)¬(.+)$/);
  if (!negation) {
    container.textContent = formula;
    return;
  }
  container.append(document.createTextNode(negation[1]));
  const overbar = document.createElement("span");
  overbar.className = "logic-overbar";
  overbar.textContent = negation[2];
  container.append(overbar);
}
