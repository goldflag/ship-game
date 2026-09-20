import type { ReviewView } from '../../tools/construction/review';

/** The fixed review views. Kept apart from the pipeline so the CLI can name them without loading a browser. */
export const REVIEW_VIEWS: ReviewView[] = ['profile', 'plan', 'bow', 'stern', 'quarter'];
