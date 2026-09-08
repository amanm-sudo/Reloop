import { env } from '@/lib/env';
import { formatIst, type Window } from '@/lib/hours';
import { formatMass } from '@/lib/units';

/**
 * Telegram delivery for the recipient side.
 *
 * This channel exists because the people who most need ReLoop are the least likely to install
 * anything: an NGO coordinator can accept a pickup by tapping a button in a chat they already
 * have open, without ever seeing the web app. It is deliberately the same message contract the
 * simulated partner uses, so the orchestrator cannot tell which kind of counterparty answered.
 *
 * Never throws. A messaging outage degrades to the simulated partner with a visible label rather
 * than stalling a run.
 */

const API_BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 5000;

export type CallbackAction = 'accept' | 'later' | 'decline';

export function encodeCallback(matchId: string, action: CallbackAction): string {
  // Telegram caps callback_data at 64 bytes; a 24-char ObjectId plus a short verb fits.
  return `m:${matchId}:${action}`;
}

export function decodeCallback(
  data: string
): { matchId: string; action: CallbackAction } | null {
  const parts = data.split(':');
  if (parts.length !== 3 || parts[0] !== 'm') return null;
  const [, matchId, action] = parts;
  if (!matchId || (action !== 'accept' && action !== 'later' && action !== 'decline')) return null;
  return { matchId, action };
}

function botToken(): string | null {
  const token = env().TELEGRAM_BOT_TOKEN;
  return token.length > 0 ? token : null;
}

async function call(method: string, body: unknown): Promise<boolean> {
  const token = botToken();
  if (!token) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Log the method and status, never the token.
      console.error(`[telegram] ${method} responded ${response.status}`);
      return false;
    }
    return true;
  } catch (cause) {
    console.error(`[telegram] ${method} failed`, cause instanceof Error ? cause.message : cause);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendOffer(input: {
  chatId: string;
  matchId: string;
  message: string;
  quantityKg: number;
  windows: readonly Window[];
}): Promise<boolean> {
  const times =
    input.windows.length > 0
      ? input.windows.map((w) => formatIst(w.start)).join(' / ')
      : 'flexible';

  const text = [
    input.message,
    '',
    `Quantity: ${formatMass(input.quantityKg)}`,
    `Suggested times: ${times}`,
  ].join('\n');

  return call('sendMessage', {
    chat_id: input.chatId,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Accept', callback_data: encodeCallback(input.matchId, 'accept') },
          { text: 'Another time', callback_data: encodeCallback(input.matchId, 'later') },
        ],
        [{ text: 'Cannot take it', callback_data: encodeCallback(input.matchId, 'decline') }],
      ],
    },
  });
}

export async function sendPlain(chatId: string, text: string): Promise<boolean> {
  return call('sendMessage', { chat_id: chatId, text });
}

/** Clears the button spinner in the client. Cosmetic, but its absence looks broken. */
export async function answerCallback(callbackQueryId: string, text: string): Promise<boolean> {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

export function isConfigured(): boolean {
  return botToken() !== null;
}
