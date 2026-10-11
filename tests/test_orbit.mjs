import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../frontend/vendor/three.module.js";
import { bindMiddleOrbit } from "../frontend/src/orbit.js";

// 使用真实 Three.js 相机与最小 DOM 事件替身验证运动约束，无需 WebGL 或外部依赖。
function setup() {
  const canvas = new EventTarget();
  const capture = new Set();
  const classes = new Set();
  canvas.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name) };
  canvas.getBoundingClientRect = () => ({ height: 400 });
  canvas.setPointerCapture = (id) => capture.add(id);
  canvas.hasPointerCapture = (id) => capture.has(id);
  canvas.releasePointerCapture = (id) => capture.delete(id);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(9, 8, 13);
  const events = new EventTarget();
  let renders = 0;
  const dispose = bindMiddleOrbit(canvas, camera, () => renders++, { events });
  const send = (type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 7, button: 1, buttons: 4, clientX: 100, clientY: 100 }, properties);
    canvas.dispatchEvent(event);
    return event;
  };
  return { camera, events, send, dispose, classes, capture, renders: () => renders };
}

test("中键环绕改变视角并保持观察距离；左右键与滚轮不被拦截", () => {
  const state = setup();
  const initial = state.camera.position.clone();
  for (const button of [0, 2]) {
    assert.equal(state.send("pointerdown", { button }).defaultPrevented, false);
    state.send("pointermove", { clientX: 200, buttons: button === 0 ? 1 : 2 });
    assert.ok(state.camera.position.equals(initial));
  }
  assert.equal(state.send("wheel", { deltaY: 100 }).defaultPrevented, false);
  assert.equal(state.send("pointerdown").defaultPrevented, true);
  state.send("pointermove", { clientX: 180, clientY: 120 });
  assert.ok(!state.camera.position.equals(initial));
  assert.ok(Math.abs(state.camera.position.length() - initial.length()) < 1e-10);
  const direction = state.camera.getWorldDirection(new THREE.Vector3());
  assert.ok(direction.dot(state.camera.position.clone().normalize().negate()) > 0.999999);
  assert.equal(state.renders(), 1);
  state.dispose();
});

test("极端垂直拖动保持有限坐标，松键、取消、失焦和丢失捕获均结束旋转", () => {
  for (const ending of ["pointerup", "pointercancel", "lostpointercapture", "blur", "released-buttons", "dispose"]) {
    const state = setup();
    state.send("pointerdown");
    state.send("pointermove", { clientY: 1e6 });
    assert.ok(state.camera.position.toArray().every(Number.isFinite));
    assert.ok(Math.abs(state.camera.position.y) < state.camera.position.length());
    if (ending === "blur") state.events.dispatchEvent(new Event("blur"));
    else if (ending === "released-buttons") state.send("pointermove", { buttons: 0 });
    else if (ending === "dispose") state.dispose();
    else state.send(ending);
    const position = state.camera.position.clone();
    state.send("pointermove", { clientX: 300 });
    assert.ok(state.camera.position.equals(position), ending);
    assert.equal(state.classes.has("orbiting"), false, ending);
    assert.equal(state.capture.size, 0, ending);
    state.dispose();
  }
});

test("其它指针不会干扰当前拖动，结束后可再次拖动", () => {
  const state = setup();
  state.send("pointerdown");
  const position = state.camera.position.clone();
  state.send("pointermove", { pointerId: 8, clientX: 200 });
  state.send("pointerup", { pointerId: 8 });
  assert.ok(state.camera.position.equals(position));
  assert.equal(state.classes.has("orbiting"), true);
  state.send("pointerup");
  state.send("pointerdown");
  state.send("pointermove", { clientX: 150 });
  assert.ok(!state.camera.position.equals(position));
  state.dispose();
});
