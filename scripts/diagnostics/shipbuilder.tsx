import { mountShipbuilderReview } from '../tests/shipbuilder-browser';

/** Production editor fixtures; shaping exercises the same native worker and controls. */
const shaping = new URLSearchParams(location.search).get('shaping');
if (shaping) {
  void import('../tests/freeform-shaping-browser').then(async module => {
    if (shaping === 'check') {
      const status = window as unknown as { shapeTest: unknown };
      status.shapeTest = { state: 'running' };
      try { status.shapeTest = { state: 'passed', checks: await module.checkFreeformShaping() }; }
      catch (error) { status.shapeTest = { state: 'failed', error: String(error) }; }
    } else await module.mountShapingReview();
  });
} else void mountShipbuilderReview().then(info => console.log('shipbuilder review mounted', JSON.stringify(info)));
