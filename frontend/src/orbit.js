import * as THREE from "../vendor/three.module.js";

/**
 * 中键环绕观察控制器。仅修改相机，不移动教学对象，不注册 wheel 监听，
 * 普通滚轮始终交给页面滚动。指针捕获确保拖出画布后仍能正常结束操作。
 */
export function bindMiddleOrbit(canvas, camera, render, { target = new THREE.Vector3(), events = window } = {}) {
  let drag = null;
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();

  function finish() {
    if (!drag) return;
    const pointerId = drag.id;
    drag = null;
    canvas.classList.remove("orbiting");
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  function down(event) {
    if (event.button !== 1 || drag) return;
    // 阻止 Windows 浏览器的中键自动滚屏，保留普通滚轮行为。
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.classList.add("orbiting");
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 4)) { finish(); return; }
    const height = Math.max(canvas.getBoundingClientRect().height, 1);
    spherical.setFromVector3(offset.copy(camera.position).sub(target));
    spherical.theta -= (event.clientX - drag.x) * 2 * Math.PI / height;
    spherical.phi -= (event.clientY - drag.y) * 2 * Math.PI / height;
    // 在上下极点附近留出余量，避免相机上方向翻转或视图退化。
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.05, Math.PI - 0.05);
    camera.position.copy(target).add(offset.setFromSpherical(spherical));
    camera.lookAt(target);
    drag.x = event.clientX;
    drag.y = event.clientY;
    render();
  }

  function end(event) {
    if (event.pointerId === drag?.id) finish();
  }
  function preventMiddleClick(event) {
    if (event.button === 1) event.preventDefault();
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);
  canvas.addEventListener("auxclick", preventMiddleClick);
  events.addEventListener("blur", finish);
  return () => {
    finish();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", end);
    canvas.removeEventListener("pointercancel", end);
    canvas.removeEventListener("lostpointercapture", end);
    canvas.removeEventListener("auxclick", preventMiddleClick);
    events.removeEventListener("blur", finish);
  };
}
