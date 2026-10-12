import * as THREE from "../vendor/three.module.js";
import { bindMiddleOrbit, frameCameraToBounds } from "./orbit.js";

/**
 * 只负责浏览器中的教学三维视图。
 * 实体几何来自案例的抽象对象，不等同于 GDS/PDK 的完整三维制造结构。
 */
export class TeachingScene {
  constructor(container, onPick) {
    this.container = container;
    this.onPick = onPick;
    this.scene = new THREE.Scene();
    // 三维画布沿用页面的视觉色板；对象配色与源几何保持案例定义。
    const theme = getComputedStyle(document.documentElement);
    this.scene.background = new THREE.Color(theme.getPropertyValue("--scene-background").trim());
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    this.camera.position.set(9, 8, 13);
    this.camera.lookAt(0, 0, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.append(this.renderer.domElement);
    this.entityMeshes = new Map();
    this.target = new THREE.Vector3();
    this.zoomEnabled = false;
    this.labelsVisible = true;
    this.homeView = true;
    this.zoomLimits = { min: 1, max: 100 };
    this.labels = new Map();
    this.labelOverlay = document.createElement("div");
    this.labelOverlay.className = "model-labels";
    this.labelOverlay.setAttribute("aria-hidden", "true");
    this.container.append(this.labelOverlay);
    this.selectedId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.layers = new Set(["M1", "M2", "VIA1"]);

    const ambient = new THREE.HemisphereLight("#eaf3ff", "#8198b8", 2.2);
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.5);
    keyLight.position.set(5, 10, 7);
    this.scene.add(ambient, keyLight);
    this.grid = new THREE.GridHelper(18, 18, theme.getPropertyValue("--scene-grid-major").trim(), theme.getPropertyValue("--scene-grid-minor").trim());
    this.scene.add(this.grid);

    bindMiddleOrbit(this.renderer.domElement, this.camera, () => {
      this.homeView = false;
      this.render();
    }, { target: this.target, zoomEnabled: () => this.zoomEnabled, zoomLimits: () => this.zoomLimits });
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      // 中键只观察，左键仍用于二维/三维对象联动选取。
      if (event.button === 0 && !(event.buttons & 4)) this.pick(event);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.render();
  }

  setCase(caseData) {
    for (const mesh of this.entityMeshes.values()) {
      this.scene.remove(mesh);
      mesh.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
    }
    this.entityMeshes.clear();
    for (const label of this.labels.values()) label.remove();
    this.labels.clear();
    this.selectedId = null;
    this.spec = caseData.teaching;
    const entities = caseData.entities ?? [];
    if (this.spec) {
      const scale = this.spec.render.scale;
      this.grid.position.y = this.spec.layers.SUBSTRATE.bottom / scale - 0.03;
      this.grid.scale.setScalar(Math.max(this.spec.viewBox[2], this.spec.viewBox[3]) / scale / 18 * 1.2);
    }
    entities.forEach((entity) => {
      const mesh = this.createEntityMesh(entity);
      this.entityMeshes.set(entity.id, mesh);
      this.scene.add(mesh);
      const label = document.createElement("span");
      label.className = "model-label";
      label.textContent = entity.name;
      label.dataset.defaultVisible = String(entity.list !== false && !["FIELD", "CONTACT"].includes(entity.layer));
      this.labelOverlay.append(label);
      this.labels.set(entity.id, label);
    });
    this.applyLayerVisibility();
    this.resetView();
  }

  createEntityMesh(entity) {
    const group = new THREE.Group();
    group.userData.entity = entity;
    group.name = entity.id;
    const spec = this.spec;
    const layer = spec.layers[entity.layer];
    const scale = spec.render.scale;
    // 二维矩形坐标表示左上角，三维盒体使用中心；全部视图共享相同平面坐标。
    for (const [x, y, width, height] of entity.modelRects ?? entity.rects) {
      const geometry = new THREE.BoxGeometry(width / scale, (layer.top - layer.bottom) / scale, height / scale);
      const material = new THREE.MeshStandardMaterial({
        color: entity.color, transparent: layer.opacity < 1, opacity: layer.opacity,
        depthWrite: layer.opacity >= 1, metalness: entity.layer === "M1" ? .2 : .02, roughness: .7,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.entity = entity;
      mesh.position.set((x + width / 2 - spec.viewBox[2] / 2) / scale,
        (layer.bottom + layer.top) / 2 / scale,
        (y + height / 2 - spec.viewBox[3] / 2) / scale);
      group.add(mesh);
    }
    return group;
  }

  setLayers(layers) {
    this.layers = layers;
    this.applyLayerVisibility();
  }

  applyLayerVisibility() {
    for (const mesh of this.entityMeshes.values()) {
      mesh.visible = this.layers.has(mesh.userData.entity.layer);
    }
    this.render();
  }

  setSelection(entityId) {
    this.selectedId = entityId;
    for (const [id, mesh] of this.entityMeshes) {
      mesh.traverse(child => {
        if (!child.material) return;
        child.material.emissive.set(id === entityId ? "#1c4e9a" : "#000000");
        child.material.emissiveIntensity = id === entityId ? 0.55 : 0;
      });
      this.labels.get(id)?.classList.toggle("selected", id === entityId);
    }
    this.render();
  }

  resetView() {
    const bounds = new THREE.Box3();
    // 即使临时隐藏图层，也以完整结构恢复取景，避免复原按钮改变展示对象范围。
    for (const mesh of this.entityMeshes.values()) {
      bounds.expandByObject(mesh);
    }
    this.zoomLimits = frameCameraToBounds(this.camera, bounds, this.target);
    this.homeView = true;
    this.render();
  }

  setZoomEnabled(enabled) { this.zoomEnabled = enabled; }

  setDisplay(option, visible) {
    if (option === "grid") this.grid.visible = visible;
    if (option === "labels") this.labelsVisible = visible;
    this.render();
  }

  pick(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects([...this.entityMeshes.values()].filter((mesh) => mesh.visible), true);
    if (intersections[0]) this.onPick(intersections[0].object.userData.entity.id);
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.homeView) this.resetView();
    else this.render();
  }

  updateLabels() {
    const { width, height } = this.container.getBoundingClientRect();
    const placed = [];
    const point = new THREE.Vector3();
    const positionLabel = (label, position, visible) => {
      point.copy(position).project(this.camera);
      label.hidden = !visible || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      if (label.hidden) return;
      const labelWidth = label.offsetWidth;
      const x = THREE.MathUtils.clamp((point.x + 1) * width / 2 - labelWidth / 2, 4, Math.max(4, width - labelWidth - 4));
      let y = Math.max(4, (1 - point.y) * height / 2 - 22);
      // 标注只在屏幕空间错开，不移动实体；图层隐藏时相应标注同步隐藏。
      while (y > 20 && placed.some((box) => x < box.right && x + labelWidth > box.left && Math.abs(y - box.y) < 18)) y -= 18;
      placed.push({ left: x, right: x + labelWidth, y });
      label.style.transform = `translate(${x}px, ${y}px)`;
    };
    for (const [id, mesh] of this.entityMeshes) {
      const bounds = new THREE.Box3().setFromObject(mesh);
      const anchor = bounds.getCenter(new THREE.Vector3());
      anchor.y = bounds.max.y;
      const label = this.labels.get(id);
      positionLabel(label, anchor, this.labelsVisible && mesh.visible && (label.dataset.defaultVisible === "true" || id === this.selectedId));
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }
}
