/** 11 个教学对象的唯一目录：两侧栏、说明和选择均从此处取得语义映射。 */
export function teachingObjects(data) {
  const entities = data.entities ?? [];
  const definitions = [
    ["substrate", "P衬底", "NMOS 所在的衬底与隔离场区", "P 型衬底承载 NMOS，其体端通过 P 衬底接触接至 GND。本组同时包含有源区外的隔离场区；场区是绝缘结构，并非衬底掺杂层。", e => e.id === "substrate" || e.layer === "FIELD"],
    ["nwell", "N-well", "PMOS 所在的 N 型阱区", "N 阱为 PMOS 提供体区，通过 N 阱接触接至 VDD。阱与 P 型衬底形成 PN 结；图示阱深与边界采用教学参数。", e => e.id === "nwell"],
    ["substrate-tap", "P衬底接触", "P+ 体接触，连接 GND", "P+ 掺杂区为 P 衬底提供体接触。它通过接触孔与 M1 支线接至 GND，用于固定衬底电位；本项高亮掺杂接触区，孔和支线可分别选择。", e => e.id === "substrate-tap"],
    ["well-tap", "N阱接触", "N+ 体接触，连接 VDD", "N+ 掺杂区为 N 阱提供体接触。它通过接触孔与 M1 支线接至 VDD，用于固定阱电位；它不是逻辑晶体管的源漏区。", e => e.id === "well-tap"],
    ["paa", "P型有源区", "PMOS 源漏及栅下沟道所在区域", "N 阱中的 P 型有源区包含 PMOS 的源漏区域；多晶硅跨越处对应栅下沟道。二维用连续区域表示版图范围，三维在栅下保留沟道，避免将其画成重掺杂源漏。", e => e.id === "paa"],
    ["naa", "N型有源区", "NMOS 源漏及栅下沟道所在区域", "P 衬底中的 N 型有源区包含 NMOS 的源漏区域；多晶硅跨越处对应栅下沟道。源漏由栅控制的沟道连接，不能理解为整块有源区始终导通。", e => e.id === "naa"],
    ["vdd", "VDD", "正电源轨", "沿单元上边缘延伸的 M1 正电源轨。通向 PMOS 和 N 阱接触的支线归入 M1 金属连线，可独立显示与选择。", e => e.metalRole === "rail" && e.net === "VDD"],
    ["gnd", "GND", "接地电源轨", "沿单元下边缘延伸的 M1 接地轨。通向 NMOS 和 P 衬底接触的支线归入 M1 金属连线，可独立显示与选择。", e => e.metalRole === "rail" && e.net === "GND"],
    ["poly", "多晶硅", "器件栅极与输入连接段", "多晶硅跨越有源区形成器件栅极，其余部分连接同一输入的各个栅。下方卡片可查看全部、单个器件栅或同一输入的连接段；三维栅氧随对应栅极显示，但栅氧不是多晶硅。", e => e.layer === "POLY" || e.layer === "OXIDE"],
    ["contacts", "接触孔", "有源区与 M1 之间的全部接触孔", "本组包含所有网络的接触孔，包括源漏接触和阱、衬底体接触。它们把下方有源区接到上方 M1；这里没有 M1 与 M2 之间的通孔。", e => e.layer === "CONTACT"],
    ["wires", "M1金属连线", "信号连线及 VDD、GND 支线", "本组包含输出等信号连线，以及从 VDD、GND 电源轨通向器件和体接触的 M1 支线。不同网络不相连；同层连续金属导通，跨越多晶硅且无接触时不连接。", e => e.layer === "M1" && e.metalRole !== "rail"],
  ];
  return definitions.map(([id, name, note, explanation, matches]) => ({
    id, name, note, explanation, ids: entities.filter(matches).map(e => e.id),
  }));
}

/** 默认“全部”保证首次选择能看到完整分组；输入连接段按网络去重。 */
export function polyCards(data, group) {
  const entities = data.entities ?? [];
  const cards = [{ id: "all", name: "全部多晶硅", note: "器件栅极与输入连接段一起高亮。", ids: group.ids }];
  for (const device of data.teaching?.devices ?? []) {
    cards.push({ id: device.id, name: `${device.name} · 多晶硅栅`,
      note: `${device.type.toUpperCase()}，栅接输入 ${device.gate}；源 ${device.source}，漏 ${device.drain}，体 ${device.body}。高亮多晶硅与有源区交叠的栅区域。`,
      ids: entities.filter(e => e.id === device.id || e.ownerId === device.id).map(e => e.id) });
  }
  const nets = [...new Set((data.teaching?.gates ?? []).map(gate => gate.net))];
  for (const net of nets) {
    const names = (data.teaching?.devices ?? []).filter(d => d.gate === net).map(d => d.name).join("、");
    cards.push({ id: `input-${net}`, name: `输入 ${net} · 多晶硅连接段`,
      note: `连接 ${names} 的栅极。这里高亮有源区之外的多晶硅连接段；同一输入的连接段合并为一张卡片。`,
      ids: entities.filter(e => e.layer === "POLY" && !e.device && e.net === net).map(e => e.id) });
  }
  return cards;
}

export function cycleCard(index, direction, count) {
  return count ? (index + direction % count + count) % count : 0;
}
