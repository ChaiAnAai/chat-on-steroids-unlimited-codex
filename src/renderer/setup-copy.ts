import { translate } from './i18n.js';

/** Translate only recognized application-authored status envelopes; preserve diagnostics. */
export function setupStatusDetail(detail: string): string {
  const connected = /^Connected\. Last verified handshake with OpenAI (.+)\. Pick the tunnel in ChatGPT\.$/.exec(detail);
  if (connected) return translate('Connected. Last verified handshake with OpenAI {age}. Pick the tunnel in ChatGPT.', { age: setupAge(connected[1]!) });
  const offline = /^This PC cannot reach OpenAI — (.+)\. Last verified handshake (.+)\. ChatGPT cannot use the connector until it is back; the tunnel keeps retrying on its own\.$/.exec(detail);
  if (offline) return translate('This PC cannot reach OpenAI — {reason}. Last verified handshake {age}. ChatGPT cannot use the connector until it is back; the tunnel keeps retrying on its own.', { reason: offline[1]!, age: setupAge(offline[2]!) });
  return translate(detail);
}

export function setupAge(age: string): string {
  const match = /^(\d+)([smh]) ago$/.exec(age);
  return match ? translate({ s: '{count}s ago', m: '{count}m ago', h: '{count}h ago' }[match[2] as 's' | 'm' | 'h'], { count: match[1]! }) : translate(age);
}
