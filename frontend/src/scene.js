import * as THREE from "../vendor/three.module.js";

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
    this.selectedId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.layers = new Set(["M1", "M2", "VIA1"]);

    const ambient = new THREE.HemisphereLight("#eaf3ff", "#8198b8", 2.2);
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.5);
    keyLight.position.set(5, 10, 7);
    this.scene.add(ambient, keyLight);
    this.scene.add(new THREE.GridHelper(18, 18, theme.getPropertyValue("--scene-grid-major").trim(), theme.getPropertyValue("--scene-grid-minor").trim()));

    this.renderer.domElement.addEventListener("pointerdown", (event) => this.pick(event));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.render();
  }

  setCase(caseData) {
    for (const mesh of this.entityMeshes.values()) this.scene.remove(mesh);
    this.entityMeshes.clear();
    this.selectedId = null;
    const entities = caseData.entities ?? [];
    entities.forEach((entity) => {
      const mesh = this.createEntityMesh(entity);
      this.entityMeshes.set(entity.id, mesh);
      this.scene.add(mesh);
    });
    this.applyLayerVisibility();
    this.setExplode(0);
  }

  createEntityMesh(entity) {
    const dimensions = this.dimensionsFor(entity);
    const geometry = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
    const material = new THREE.MeshStandardMaterial({
      color: entity.color,
      transparent: entity.type === "route" || entity.type === "net",
      opacity: entity.type === "route" || entity.type === "net" ? 0.8 : 1,
      metalness: entity.type === "route" || entity.type === "via" ? 0.62 : 0.18,
      roughness: 0.38,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.entity = entity;
    mesh.userData.basePosition = new THREE.Vector3((entity.x - 130) / 17, this.baseHeight(entity), (entity.y - 65) / 17);
    mesh.position.copy(mesh.userData.basePosition);
    mesh.name = entity.id;
    return mesh;
  }

  dimensionsFor(entity) {
    if (entity.type === "route") return { x: entity.width / 17, y: 0.16, z: 0.22 };
    if (entity.type === "via") return { x: 0.42, y: 0.8, z: 0.42 };
    if (entity.type === "net") return { x: entity.width / 17, y: 0.18, z: 0.34 };
    return { x: entity.width / 17, y: 0.72, z: entity.height / 17 };
  }

  baseHeight(entity) {
    if (entity.layer === "M2") return 1.3;
    if (entity.layer === "VIA1") return 0.72;
    if (entity.type === "net") return 0.18;
    return 0.48;
  }

  setLayers(layers) {
    this.layers = layers;
    this.applyLayerVisibility();
  }

  applyLayerVisibility() {
    for (const mesh of this.entityMeshes.values()) {
      mesh.visible = this.layers.has(mesh.userData.entity.layer);
    }
  }

  setSelection(entityId) {
    this.selectedId = entityId;
    for (const [id, mesh] of this.entityMeshes) {
      const material = mesh.material;
      material.emissive.set(id === entityId ? "#1c4e9a" : "#000000");
      material.emissiveIntensity = id === entityId ? 0.9 : 0;
    }
    this.render();
  }

  setExplode(amount) {
    const ratio = amount / 100;
    for (const mesh of this.entityMeshes.values()) {
      const entity = mesh.userData.entity;
      const base = mesh.userData.basePosition;
      const layerOffset = entity.layer === "M2" ? 2.1 : entity.layer === "VIA1" ? 1.0 : 0;
      mesh.position.set(base.x, base.y + ratio * layerOffset, base.z);
    }
    this.render();
  }

  pick(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects([...this.entityMeshes.values()].filter((mesh) => mesh.visible));
    if (intersections[0]) this.onPick(intersections[0].object.userData.entity.id);
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    // 窄画布扩大垂直视角，保留完整对象的横向取景；只调整显示，不改模型尺寸。
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(38) / 2) / Math.min(1, this.camera.aspect / 1.9)));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
