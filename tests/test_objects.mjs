/** 使用实际案例生成数据核验分组覆盖、二维高亮及隐藏行为，避免只验证列表文字。 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { teachingObjects, polyCards, cycleCard } from "../frontend/src/objects.js";
import { renderTeachingViews } from "../frontend/src/teaching.js";
import { TeachingScene } from "../frontend/src/scene.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cases = JSON.parse(execFileSync(process.env.DLL_TEST_PYTHON ?? "python", ["-c", [
  "import json",
  "from pathlib import Path",
  "from backend.teaching import build_teaching_case",
  "c = json.loads(Path('backend/data/cases.json').read_text(encoding='utf-8'))",
  "print(json.dumps([build_teaching_case(v,c['teachingDefaults']) for v in c['cases'] if 'teaching' in v]))",
].join("\n")], { cwd: root, encoding: "utf8" }));

// 只模拟 SVG 渲染所需的 DOM 接口；断言实际渲染结果，不复制分组实现。
class Element {
  constructor() { this.children = []; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
  classList = { toggle: (name, enabled) => {
    const values = new Set((this.attributes.class ?? "").split(" "));
    if (enabled) values.add(name); else values.delete(name);
    this.attributes.class = [...values].join(" ");
  } };
}
function render(data, selection, hidden = []) {
  const nodes = new Map();
  globalThis.document = {
    createElementNS: () => new Element(), createElement: () => new Element(),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
    // 即使旧开关状态为隐藏，03/04 的文字也必须保持显示。
    querySelector: () => ({ getAttribute: () => "false" }),
  };
  const visible = new Set(data.entities.map(e => e.id).filter(id => !hidden.includes(id)));
  renderTeachingViews(data, new Set(selection), new Set(Object.keys(data.teaching.layers)), visible, () => {});
  const ids = (view, selectedOnly) => nodes.get(view).children
    .filter(e => e.attributes?.["data-entity-id"] && (!selectedOnly || e.attributes.class.includes("is-selected")))
    .map(e => e.attributes["data-entity-id"]).sort();
  return { nodes, ids };
}

for (const data of cases) {
  test(`${data.title}：11 组完整且互斥，电源支线与电源轨分别选择`, () => {
    const groups = teachingObjects(data);
    assert.equal(groups.length, 11);
    const ids = groups.flatMap(g => g.ids);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), data.entities.map(e => e.id).sort());
    for (const net of ["VDD", "GND"]) {
      assert.deepEqual(groups.find(g => g.id === net.toLowerCase()).ids, [`rail-${net}`]);
      assert.ok(groups.find(g => g.id === "wires").ids.includes(`metal-${net}`));
    }
  });

  test(`${data.title}：各组所有可见实体在 01/02 同步高亮，隐藏组不残留`, () => {
    for (const group of teachingObjects(data)) {
      const expected = data.entities.filter(e => group.ids.includes(e.id) && e.planar !== false).map(e => e.id).sort();
      const displayed = render(data, group.ids);
      const hidden = render(data, group.ids, group.ids);
      for (const view of ["layout-view", "stick-view"]) {
        assert.deepEqual(displayed.ids(view, true), expected, `${group.name} ${view}`);
        assert.deepEqual(hidden.ids(view, true), []);
        assert.equal(hidden.ids(view, false).some(id => group.ids.includes(id)), false);
      }
    }
  });

  test(`${data.title}：多晶硅卡片覆盖全部实体，输入去重，切换同步高亮`, () => {
    const group = teachingObjects(data).find(g => g.id === "poly");
    const cards = polyCards(data, group);
    assert.deepEqual(cards[0].ids, group.ids);
    assert.deepEqual(cards.slice(1).flatMap(c => c.ids).sort(), [...group.ids].sort());
    assert.equal(cards.length, 1 + data.teaching.devices.length + new Set(data.teaching.gates.map(g => g.net)).size);
    for (const card of cards) {
      const displayed = render(data, card.ids);
      const expected = data.entities.filter(e => card.ids.includes(e.id) && e.layer === "POLY").map(e => e.id).sort();
      for (const view of ["layout-view", "stick-view"]) assert.deepEqual(displayed.ids(view, true), expected);
    }
    const duplicatedGate = { ...data, teaching: { ...data.teaching, gates: [...data.teaching.gates, data.teaching.gates[0]] } };
    assert.equal(polyCards(duplicatedGate, group).length, cards.length);
    assert.equal(cycleCard(0, -1, cards.length), cards.length - 1);
    assert.equal(cycleCard(cards.length - 1, 1, cards.length), 0);
  });

  test(`${data.title}：隐藏支线后仍保留两条电源轨，电路图文字始终显示`, () => {
    const wires = teachingObjects(data).find(g => g.id === "wires");
    const displayed = render(data, ["rail-VDD"], wires.ids);
    for (const view of ["layout-view", "stick-view"]) {
      assert.ok(displayed.ids(view, false).includes("rail-VDD"));
      assert.ok(displayed.ids(view, false).includes("rail-GND"));
      assert.deepEqual(displayed.ids(view, true), ["rail-VDD"]);
    }
    for (const view of ["positional-view", "circuit-view"]) {
      assert.ok(!displayed.nodes.get(view).attributes.class.includes("text-hidden"));
    }
  });
}

test("三维高亮支持多实体集合，重新选择时清除旧高亮", () => {
  const materials = new Map(["contact-VDD", "contact-GND", "rail-VDD"].map(id =>
    [id, { emissive: { set() {} }, emissiveIntensity: 0 }]));
  const scene = { entityMeshes: new Map([...materials].map(([id, material]) =>
    [id, { traverse: callback => callback({ material }) }])), labels: new Map(), render() {} };
  TeachingScene.prototype.setSelection.call(scene, new Set(["contact-VDD", "contact-GND"]));
  assert.ok(materials.get("contact-VDD").emissiveIntensity > 0);
  assert.ok(materials.get("contact-GND").emissiveIntensity > 0);
  assert.equal(materials.get("rail-VDD").emissiveIntensity, 0);
  TeachingScene.prototype.setSelection.call(scene, new Set(["rail-VDD"]));
  assert.equal(materials.get("contact-VDD").emissiveIntensity, 0);
  assert.equal(materials.get("contact-GND").emissiveIntensity, 0);
});
