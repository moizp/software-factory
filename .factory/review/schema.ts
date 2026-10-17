import Ajv from 'ajv';
import { LensOutput } from './types';

export const LENS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'risk_assessment', 'claims_check', 'findings', 'needs_context'],
  properties: {
    verdict: { enum: ['approve', 'request_changes', 'block'] },
    risk_assessment: { type: 'string' },
    claims_check: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'supported', 'evidence'],
        properties: { claim: { type: 'string' }, supported: { type: 'boolean' }, evidence: { type: 'string' } }
      }
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'category', 'file', 'line', 'evidence_quote', 'explanation', 'suggested_fix', 'confidence'],
        properties: {
          severity: { enum: ['blocker', 'major', 'minor'] },
          category: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          evidence_quote: { type: 'string' },
          explanation: { type: 'string' },
          suggested_fix: { type: 'string' },
          confidence: { enum: ['low', 'medium', 'high'] }
        }
      }
    },
    needs_context: { type: 'array', items: { type: 'string' } }
  }
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(LENS_SCHEMA);

/** Pulls the JSON object out of model text (tolerates a code fence) and validates it. Throws on anything else. */
export function parseLensOutput(text: string): LensOutput {
  let body = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(body);
  if (fence) body = fence[1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('review output is not valid JSON');
  }
  if (!validate(parsed)) {
    throw new Error(`review output failed schema validation: ${ajv.errorsText(validate.errors)}`);
  }
  return parsed as unknown as LensOutput;
}
