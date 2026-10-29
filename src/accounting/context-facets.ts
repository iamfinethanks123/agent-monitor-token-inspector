import { integer } from './integers';
import { CONTEXT_ORIGINS, CONTEXT_TRANSPORTS, CONTEXT_STATES, type ContextFacets } from '../shared/context-manifests';

export function contextFacets(value: unknown): ContextFacets {
  const input = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; const keys = ['origin', 'transport', 'state', 'media', 'contentId', 'originalBytes', 'included', 'serializationIncluded'];
  if (!input || Object.keys(input).some(key => !keys.includes(key)) || !CONTEXT_ORIGINS.includes(input.origin as ContextFacets['origin']) || !CONTEXT_TRANSPORTS.includes(input.transport as ContextFacets['transport']) || !CONTEXT_STATES.includes(input.state as ContextFacets['state'])
    || !['text', 'image', 'audio', 'other'].includes(String(input.media)) || typeof input.included !== 'boolean' || input.serializationIncluded !== null && typeof input.serializationIncluded !== 'boolean') throw new Error('INVALID_MANIFEST');
  if (input.state === 'removed' && input.included !== false || input.included === false && input.state !== 'removed' || input.contentId !== null && (typeof input.contentId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,256}$/.test(input.contentId))) throw new Error('INVALID_MANIFEST');
  return { origin: input.origin as ContextFacets['origin'], transport: input.transport as ContextFacets['transport'], state: input.state as ContextFacets['state'], media: input.media as ContextFacets['media'],
    contentId: input.contentId as string | null, originalBytes: input.originalBytes === null ? null : integer(input.originalBytes), included: input.included, serializationIncluded: input.serializationIncluded as boolean | null };
}
