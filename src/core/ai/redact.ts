/** Keep API keys out of anything shown or stored (errors, test messages, chat history). */

export const REDACTED_KEY = "[redacted API key]";
/** Dummy local keys (`ollama`, `lm-studio`) are too short/common to redact from text. */
const MIN_REDACT_LENGTH = 8;

/**
 * Replace an API key in text before it is shown or kept anywhere (error
 * details from a provider, connection-test messages), so a key echoed back by
 * a provider never reaches chat history, logs or exports.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  const key = secret?.trim();
  if (!key || key.length < MIN_REDACT_LENGTH) return text;
  return text.split(key).join(REDACTED_KEY);
}
