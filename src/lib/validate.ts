import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from './schema/resume.schema.json' with { type: 'json' };

// The published JSON Resume schema is draft-04; its keywords used here are compatible with draft-07,
// which is what ajv 8 speaks, so we only retarget the $schema URI.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile({ ...schema, $schema: 'http://json-schema.org/draft-07/schema#' });

/** Returns human-readable schema problems. An empty array means the document is valid. */
export function validateResume(doc: unknown): string[] {
  if (validateFn(doc)) return [];
  return (validateFn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
}
