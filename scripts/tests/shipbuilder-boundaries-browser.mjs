// Run against this checkout's Vite server.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2]).href);
  await page.evaluate(async () => {
    const { mountShipbuilderReview, controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await mountShipbuilderReview();
  });
  await page.waitForFunction(() => window.shipbuilderViewport?.props.scene.result?.definition, undefined, { timeout: 45000 });
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await controls.tab('Internals');
  });
  for (const tool of ['Deck', 'Bulkhead', 'Split']) {
    const point = await page.evaluate(async tool => {
      const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
      await controls.tool(tool);
      return controls.screen([2, 1, -17]);
    }, tool);
    await page.mouse.move(...point);
    await page.waitForFunction(() => window.shipbuilderViewport.ghost.visible && window.shipbuilderViewport.ghost.children[0]?.geometry.attributes.position.count > 0);
    await page.evaluate(async tool => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const view = window.shipbuilderViewport;
      const cells = view.props.scene.result.definition.hull.volume.cells;
      const inside = point => cells.some(cell => cell.faces.every(face => {
        const [a, b, c] = face.vertices.map(p => new THREE.Vector3(...p));
        const normal = b.sub(a).cross(c.sub(a)).normalize();
        return point.clone().sub(a).dot(normal) < .002;
      }));
      const planes = [...view.details.children.filter(n => view.props.scene.source.construction.boundaries.some(b => b.id === n.userData.sourceId)), view.ghost.children[0]];
      view.scene.updateMatrixWorld(true);
      for (const plane of planes) {
        const positions = plane.geometry.attributes.position;
        if (!positions.count) throw new Error(`${tool}: empty boundary`);
        for (let i = 0; i < positions.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(plane.matrixWorld);
          if (!inside(point)) throw new Error(`${tool}: boundary extends beyond hull at ${point.toArray()}`);
        }
      }
      if (view.details.children.some(n => n.geometry?.type === 'BoxGeometry' && !n.userData.sourceId)) throw new Error('Room bounding box is visible');
    }, tool);
    await mkdir('.build/boundary-review', { recursive: true });
    await page.screenshot({ path: `.build/boundary-review/${tool.toLowerCase()}.png` });
  }
  if (errors.length) throw new Error(errors.join('; '));
  console.log('Deck, Bulkhead and Split: placed/preview geometry stays inside the hull; no room bounding boxes or browser errors.');
} finally { await browser.close(); }
