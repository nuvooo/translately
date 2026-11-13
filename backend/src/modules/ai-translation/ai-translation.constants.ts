export const DEFAULT_AI_MODEL = 'claude-haiku-5-5'
/** Texts per request to the model. */
export const AI_CHUNK_SIZE = 40
/** Source characters per request (sum of text lengths); a longer single text gets its own chunk. */
export const AI_CHUNK_CHARS = 12_000
export const AI_DISABLED_CODE = 'ai_translation_disabled'
/** Provider token for the Anthropic SDK client (null without an API key). */
export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT'
