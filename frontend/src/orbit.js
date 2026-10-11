import * as THREE from "../vendor/three.module.js";

/**
 * 中键环绕观察控制器。仅修改相机，不移动教学对象。
 * 仅在页面固定时截获画布滚轮缩放，其余状态交给页面滚动。
 */
export function bindMiddleOrbit(canvas, camera, render, {
  target = new THREE.Vector3(), events = window, zoomEnabled = () => false,
  zoomLimits = () => ({ min: 1, max: 100 }),
} = {}) {
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

  function wheel(event) {
    if (!zoomEnabled() || event.ctrlKey) return;
    event.preventDefault();
    // 统一像素、行和页三种滚轮单位；限制单次倍率，避免触控板或高精度鼠标跳变。
    const height = Math.max(canvas.getBoundingClientRect().height, 1);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    const delta = THREE.MathUtils.clamp(event.deltaY * unit, -200, 200);
    const limits = zoomLimits();
    offset.copy(camera.position).sub(target);
    const distance = THREE.MathUtils.clamp(offset.length() * Math.exp(delta * 0.002), limits.min, limits.max);
    camera.position.copy(target).add(offset.setLength(distance));
    camera.lookAt(target);
    render();
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);
  canvas.addEventListener("auxclick", preventMiddleClick);
  canvas.addEventListener("wheel", wheel, { passive: false });
  events.addEventListener("blur", finish);
  return () => {
    finish();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", end);
    canvas.removeEventListener("pointercancel", end);
    canvas.removeEventListener("lostpointercapture", end);
    canvas.removeEventListener("auxclick", preventMiddleClick);
    canvas.removeEventListener("wheel", wheel);
    events.removeEventListener("blur", finish);
  };
}

/** 按真实场景包围球和画布横纵视角取景，网格、坐标和文本不参与范围计算。 */
export function frameCameraToBounds(camera, bounds, target) {
  const sphere = bounds.isEmpty()
    ? new THREE.Sphere(new THREE.Vector3(), 1)
    : bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.01);
  target.copy(sphere.center);
  const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
  camera.position.copy(target).add(new THREE.Vector3(9, 8, 13).normalize().multiplyScalar(distance));
  camera.near = radius / 1000;
  camera.far = distance * 100;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return { min: radius * 0.2, max: distance * 8 };
}
