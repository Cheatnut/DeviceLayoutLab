/** 四种二维表达共享案例几何与 MOS 拓扑；绘图不修改器件连接。 */
const NS = "http://www.w3.org/2000/svg";
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
function selectable(parent, id, selected, pick) {
  const group = node(parent, "g", { "data-entity-id": id, class: `diagram-part ${id === selected ? "is-selected" : ""}`, tabindex: 0, role: "button" });
  group.addEventListener("click", () => pick(id));
  group.addEventListener("keydown", e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); pick(id); } });
  return group;
}

function layout(svg, data, selected, layers, pick) {
  const s = data.teaching;
  for (const entity of data.entities) {
    if (entity.planar === false || !layers.has(entity.layer)) continue;
    const g = selectable(svg, entity.id, selected, pick);
    g.setAttribute("aria-label", entity.name);
    const area = ["PAA", "NAA"].includes(entity.layer);
    const region = ["SUBSTRATE", "NWELL", "FIELD"].includes(entity.layer);
    for (const [x, y, width, height] of entity.rects) {
      node(g, "rect", { x, y, width, height, fill: entity.layer === "FIELD" ? "none" : entity.color,
        "fill-opacity": region ? .25 : .93, stroke: s.boundaryColor, "stroke-width": area ? 1.2 : .7,
        "stroke-dasharray": entity.layer === "FIELD" ? "5 4" : "none" });
      if (entity.layer === "CONTACT") {
        line(g, [[x+2,y+2],[x+width-2,y+height-2]], "#edf1f4", 1);
        line(g, [[x+width-2,y+2],[x+2,y+height-2]], "#edf1f4", 1);
      }
    }
  }
  if (layers.has("NWELL")) text(svg, s.well[0]+s.well[2]-8, s.well[1]+s.well[3]-9, "N-well", { "text-anchor": "end" });
  if (layers.has("SUBSTRATE")) text(svg, 370, 312, "P 衬底", { "text-anchor": "end" });
  for (const active of s.active) if (layers.has(active.layer)) text(svg, active.rect[0], active.rect[1]-8, active.name);
  pins(svg, s, layers);
}

function pins(svg, s, layers = null) {
  if (!layers || layers.has("M1")) {
    text(svg, s.rails.VDD[0][0], s.rails.VDD[0][1]-12, "VDD");
    text(svg, s.rails.GND[0][0], s.rails.GND[0][1]+22, "GND");
    const out = s.wires.Y.at(-1).at(-1);
    text(svg, out[0]+9, out[1]+5, "Y");
  }
  if (!layers || layers.has("POLY")) for (const gate of s.gates) text(svg, gate.x, gate.top-10, gate.net, { "text-anchor": "middle" });
}

function sticks(svg, data, selected, layers, pick) {
  const s = data.teaching;
  if (layers.has("NWELL")) node(svg, "rect", { x:s.well[0], y:s.well[1], width:s.well[2], height:s.well[3], fill:"none", stroke:s.layers.NWELL.color, "stroke-dasharray":"5 4" });
  for (const active of [...s.active, ...s.taps]) {
    if (!layers.has(active.layer)) continue;
    const [x,y,w,h] = active.rect;
    const g = selectable(svg, active.id, selected, pick);
    line(g, [[x,y+h/2],[x+w,y+h/2]], s.layers[active.layer].color, s.render.stickStroke);
    text(svg, x, y-3, active.name, { "font-size":11 });
  }
  if (layers.has("POLY")) for (const gate of s.gates) {
    const g = selectable(svg, gate.id, selected, pick);
    line(g, [[gate.x,gate.top],[gate.x,gate.bottom]], s.layers.POLY.color, s.render.stickStroke);
  }
  if (layers.has("M1")) for (const entity of data.entities.filter(e => e.paths)) {
    const g = selectable(svg, entity.id, selected, pick);
    for (const path of entity.paths) line(g, path, entity.color, s.render.stickStroke);
  }
  if (layers.has("CONTACT")) for (const [net, points] of Object.entries(s.contacts)) {
    const g = selectable(svg, `contact-${net}`, selected, pick);
    for (const [x,y] of points) node(g,"rect",{x:x-3.5,y:y-3.5,width:7,height:7,fill:s.layers.CONTACT.color});
  }
  pins(svg,s,layers);
}

/** 三端简化 MOS 符号：PMOS 栅端带圆圈，体端连接在卡片说明和对象面板中注明。 */
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
    const crossing=s.wires.Y.at(-1)[0][1];
    // 跳线弧明确表示栅线与输出线交叉但不相接。
    node(svg,"path",{d:`M${gate.x} ${p.at[1]+34} V${crossing-5} a5 5 0 0 1 0 10 V${n.at[1]-34}`,fill:"none",stroke:s.layers.POLY.color,"stroke-width":2});
    text(svg,gate.x+9,crossing+27,gate.net);
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

export function renderTeachingViews(data, selected, layers, pick) {
  const ids=["layout-view","stick-view","positional-view","circuit-view"];
  for(const id of ids) {
    const svg=document.getElementById(id);
    svg.replaceChildren();
    svg.setAttribute("viewBox",(data.teaching?.viewBox ?? [0,0,420,330]).join(" "));
    if(!data.teaching) text(svg,210,165,"此案例暂无版图数据",{"text-anchor":"middle"});
  }
  document.getElementById("logic-formula").textContent=data.teaching?.formula ?? "等待案例数据";
  document.getElementById("logic-note").textContent=data.teaching?.logicNote ?? "";
  if(!data.teaching) return;
  layout(document.getElementById(ids[0]),data,selected,layers,pick);
  sticks(document.getElementById(ids[1]),data,selected,layers,pick);
  positionalCircuit(document.getElementById(ids[2]),data,selected,pick);
  standardCircuit(document.getElementById(ids[3]),data,selected,pick);
}
