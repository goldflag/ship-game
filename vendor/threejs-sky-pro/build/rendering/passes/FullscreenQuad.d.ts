import * as THREE from 'three/webgpu';
/** Shared ortho camera + `PlaneGeometry(2,2)` for fullscreen-quad passes; each pass owns its own Scene + Mesh. */
export declare class FullscreenQuad {
    /** NDC ortho camera shared by every fullscreen pass. */
    static readonly camera: THREE.OrthographicCamera;
    private static _geometry;
    /** Lazily-allocated singleton plane geometry. */
    static geometry(): THREE.PlaneGeometry;
    /** Wrap a material in a fresh scene + mesh ready for `renderer.render`. */
    static makeScene(material: THREE.Material): {
        scene: THREE.Scene;
        mesh: THREE.Mesh;
    };
}
