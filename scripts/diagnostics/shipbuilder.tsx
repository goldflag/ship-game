import { mountShipbuilderReview } from '../tests/shipbuilder-browser';

/** Mounts the editor alone on the patrol starter for layout review and browser checks. */
void mountShipbuilderReview().then(info => console.log('shipbuilder review mounted', JSON.stringify(info)));
