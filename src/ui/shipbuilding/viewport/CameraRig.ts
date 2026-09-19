import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BuilderScene, BuilderView } from '../builderScene';

/** The orthographic and perspective cameras behind one set of orbit controls, framed per construction view. */
export class CameraRig {
  readonly ortho = new THREE.OrthographicCamera(-50, 50, 35, -35, 0.1, 6000);
  readonly perspectiveCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = this.ortho;
  controls!: OrbitControls;
  span = 70;
  currentView: BuilderView = 'orbit';
  private fitExtent = 70;

  attach(canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.minZoom = 0.08;
    this.controls.maxZoom = 100;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.camera.position.set(65, 45, -75);
    this.controls.update();
  }

  measure(renderer: THREE.WebGLRenderer, host: HTMLElement) {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    this.span = this.fitExtent / Math.min(1, width / height);
    renderer.setSize(width, height);
    this.ortho.left = (-this.span * width) / height / 2;
    this.ortho.right = -this.ortho.left;
    this.ortho.top = this.span / 2;
    this.ortho.bottom = -this.ortho.top;
    this.ortho.updateProjectionMatrix();
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
  }

  /** Frame `bounds` for the chosen view: plan and profile need the length upright, the bow view only the section. */
  frame(bounds: THREE.Box3, view: BuilderView, renderer: THREE.WebGLRenderer, host: HTMLElement) {
    const size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    const aspect = Math.max(1, host.clientWidth / Math.max(1, host.clientHeight));
    // Frame the ship for the chosen view: plan and profile need the length upright, the bow view only the section.
    const framed =
      view === 'top'
        ? Math.max(size.z, size.x * aspect)
        : view === 'side'
          ? Math.max(size.z, size.y * aspect)
          : view === 'bow'
            ? Math.max(size.x, size.y * aspect)
            : size.length() * 0.95;
    this.fitExtent = Math.max(15, framed * 1.12);
    this.controls.target.copy(center);
    this.camera.zoom = 1;
    this.measure(renderer, host);
    this.setView(view);
  }

  setView(view: BuilderView) {
    const direction = view === 'top' ? [0, 1, 0.0001] : view === 'side' ? [1, 0, 0] : view === 'bow' ? [0, 0, -1] : [1, 0.7, -1.15];
    this.camera.position
      .copy(this.controls.target)
      .add(
        new THREE.Vector3(...direction)
          .normalize()
          .multiplyScalar(
            this.camera instanceof THREE.PerspectiveCamera
              ? this.span / (2 * Math.tan((20 * Math.PI) / 180))
              : Math.max(200, this.span * 3),
          ),
      );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.controls.target);
    this.controls.enableRotate = view === 'orbit';
    this.controls.update();
    this.currentView = view;
  }

  /** Swap cameras in place, keeping the framed extent. */
  setPerspective(perspective: boolean) {
    if (perspective !== this.camera instanceof THREE.PerspectiveCamera) {
      const previous = this.camera,
        distance = previous.position.distanceTo(this.controls.target);
      this.camera = perspective ? this.perspectiveCamera : this.ortho;
      const extent =
        previous instanceof THREE.PerspectiveCamera
          ? (2 * distance * Math.tan((20 * Math.PI) / 180)) / previous.zoom
          : this.span / previous.zoom;
      this.camera.position.copy(previous.position);
      this.camera.quaternion.copy(previous.quaternion);
      if (this.camera instanceof THREE.PerspectiveCamera) {
        this.camera.zoom = 1;
        this.camera.position
          .sub(this.controls.target)
          .setLength(extent / (2 * Math.tan((20 * Math.PI) / 180)))
          .add(this.controls.target);
      } else this.camera.zoom = this.span / extent;
      this.controls.object = this.camera;
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  configure(scene: BuilderScene) {
    // The primary button orbits (pans in construction views) and the secondary button pans. A primary press on the hull while placing lays pieces instead; `down` holds the controls for that drag.
    this.controls.mouseButtons = {
      LEFT: scene.perspective || scene.view === 'orbit' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.enableRotate = scene.view === 'orbit' || !!scene.perspective;
  }
}
