import { contextFacets } from '../accounting/context-facets';
import type { ContextFacets, ContextItem, ContextManifest, ContextResult, ManifestConsent } from '../shared/context-manifests';

export interface OwnedItem {
  id: string; origin: ContextItem['origin']; text: string;
  estimate?: ContextItem['estimate']; operations?: ContextItem['operations'];
  facets?: ContextFacets;
}

/** Call only at an owned boundary, after its final client-side transformations. */
export async function observeOwnedRequest<T extends { responseId: string | null }>(input: {
  consent: ManifestConsent; clientId: string; requestId: string; threadId: string; turnId: string | null;
  schema?: ContextManifest['schema']; contextEpoch?: string | null;
  items: OwnedItem[]; persist: (record: ContextManifest | ContextResult) => Promise<void>;
  send: (items: readonly OwnedItem[], requestId: string) => Promise<T>;
}): Promise<T> {
  // Detach the final ordered content from subsequent mutations by the caller.
  const items = structuredClone(input.items);
  const schema = input.schema ?? 'owned-context/1';
  if (!['owned-context/1', 'owned-context/2'].includes(schema)) throw new Error('INVALID_CONTEXT_FACETS');
  if (schema === 'owned-context/2') for (const item of items) item.facets = contextFacets(item.facets);
  if (schema === 'owned-context/1' && items.some(item => item.facets) || schema === 'owned-context/2' && items.some(item => !item.facets || item.facets.included === false && item.text !== '')) throw new Error('INVALID_CONTEXT_FACETS');
  const manifest: ContextManifest = {
    schema, clientId: input.clientId, requestId: input.requestId, consentId: input.consent.id,
    workspaceId: input.consent.workspaceId, machineId: input.consent.machineId, threadId: input.threadId, turnId: input.turnId,
    capturedAt: new Date().toISOString(), capture: 'client_visible_before_send',
    items: items.map((item, order) => ({ id: item.id, order, origin: item.origin, bytes: item.facets?.included === false ? '0' : item.facets && item.facets.media !== 'text' ? null : String(Buffer.byteLength(item.text, 'utf8')),
      estimate: item.facets?.included === false || item.facets && item.facets.media !== 'text' ? null : item.estimate ?? null, operations: item.operations ?? [], ...(schema === 'owned-context/2' ? { facets: item.facets } : {}) })),
    ...(schema === 'owned-context/2' ? { contextEpoch: input.contextEpoch ?? null } : {}),
  };
  await input.persist(manifest);
  let response: T;
  try { response = await input.send(items.filter(item => item.facets?.included !== false), input.requestId); }
  catch (error) {
    await input.persist({ schema: 'owned-result/1', clientId: input.clientId, requestId: input.requestId, consentId: input.consent.id,
      completedAt: new Date().toISOString(), status: error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed', responseId: null });
    throw error;
  }
  await input.persist({ schema: 'owned-result/1', clientId: input.clientId, requestId: input.requestId, consentId: input.consent.id,
    completedAt: new Date().toISOString(), status: 'completed', responseId: response.responseId });
  return response;
}
