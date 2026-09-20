/** Kept apart from `constructionEditor.ts` so geometry helpers can mint IDs without importing storage. */
export const newConstructionId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
