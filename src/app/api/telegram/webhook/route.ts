import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '@/lib/env';
import { connectDb } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/api';
import { guarded, ok, toResponse, type Result } from '@/lib/result';
import { nextOpenAt } from '@/lib/hours';
import { handlePartnerReply } from '@/agents/orchestrator';
import { loadRecipient } from '@/agents/orchestrator/blackboard';
import { answerCallback, decodeCallback, sendPlain } from '@/agents/partner/telegram';
import type { PartnerDecision } from '@/agents/partner/types';
import { Match } from '@/models/match';
import { RecipientProfile } from '@/models/recipient-profile';

/**
 * Inbound Telegram updates.
 *
 * Two jobs: bind a chat to a recipient account via `/start <linkCode>`, and turn an inline button
 * tap into a partner decision. Always answers 200 — Telegram retries non-2xx responses
 * aggressively, and a retry storm on a webhook is worse than a dropped update we can see in logs.
 */

const updateSchema = z.object({
  message: z
    .object({
      chat: z.object({ id: z.union([z.number(), z.string()]) }),
      text: z.string().optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      message: z.object({ chat: z.object({ id: z.union([z.number(), z.string()]) }) }).optional(),
    })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  const result = await guarded('telegram/webhook', async (): Promise<Result<unknown>> => {
    const secret = env().TELEGRAM_WEBHOOK_SECRET;

    // Without a configured secret the endpoint stays shut rather than accepting anything.
    if (secret.length === 0) return ok({ ignored: 'not-configured' });

    if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
      // Deliberately a bare 401 with no detail: an unverified caller learns nothing.
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Not permitted.' } };
    }

    const limited = rateLimit(clientKey(request, 'telegram'), 120, 60_000);
    if (!limited.ok) return ok({ ignored: 'rate-limited' });

    const body: unknown = await request.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return ok({ ignored: 'unparseable' });

    await connectDb();

    const update = parsed.data;

    // --- /start <linkCode>: bind this chat to a recipient profile. ---
    const text = update.message?.text?.trim();
    if (text?.startsWith('/start')) {
      const chatId = String(update.message?.chat.id ?? '');
      const linkCode = text.split(/\s+/)[1];

      if (!linkCode || !Types.ObjectId.isValid(linkCode)) {
        await sendPlain(
          chatId,
          'Send the link code from your ReLoop partner page, like /start <code>, and this chat will start receiving pickup offers.'
        );
        return ok({ handled: 'start-without-code' });
      }

      const profile = await RecipientProfile.findByIdAndUpdate(
        new Types.ObjectId(linkCode),
        { $set: { 'contact.telegramChatId': chatId, isSimulated: false } },
        { new: true }
      );

      if (!profile) {
        await sendPlain(chatId, 'That link code does not match a partner profile.');
        return ok({ handled: 'start-bad-code' });
      }

      await sendPlain(
        chatId,
        `Linked to ${profile.orgName}. You will get a message when surplus nearby needs a home — reply with the buttons and that is all it takes.`
      );
      return ok({ handled: 'linked', orgName: profile.orgName });
    }

    // --- Inline button tap: a real partner decision. ---
    const callback = update.callback_query;
    if (callback?.data) {
      const decoded = decodeCallback(callback.data);
      if (!decoded || !Types.ObjectId.isValid(decoded.matchId)) {
        await answerCallback(callback.id, 'That offer has expired.');
        return ok({ ignored: 'bad-callback' });
      }

      const matchId = new Types.ObjectId(decoded.matchId);
      const match = await Match.findById(matchId).lean();
      if (!match) {
        await answerCallback(callback.id, 'That offer is no longer active.');
        return ok({ ignored: 'match-missing' });
      }

      const recipient = match.recipientId ? await loadRecipient(match.recipientId) : null;
      const now = new Date();

      let decision: PartnerDecision;

      if (decoded.action === 'accept') {
        decision = { kind: 'ACCEPT', message: 'Yes, we can take this.' };
      } else if (decoded.action === 'decline') {
        decision = {
          kind: 'DECLINE',
          reason: 'declined-by-recipient',
          message: 'We cannot take this one.',
        };
      } else {
        // "Another time" becomes a real counter-offer at their next opening, so the Negotiation
        // Agent can judge it against the freshness deadline exactly as it would a simulated one.
        const start = recipient
          ? nextOpenAt(
              recipient.operatingHours,
              new Date(now.getTime() + 30 * 60_000),
              Math.max(1, (match.freshnessDeadlineAt.getTime() - now.getTime()) / 3_600_000)
            )
          : null;

        decision = {
          kind: 'COUNTER',
          reason: 'timing',
          message: start
            ? 'Not at that time, but we could do our next opening.'
            : 'That timing does not work for us.',
          altWindow: start ? { start, end: new Date(start.getTime() + 30 * 60_000) } : undefined,
        };
      }

      const outcome = await handlePartnerReply(matchId, decision, now);

      await answerCallback(
        callback.id,
        outcome.advanced
          ? decoded.action === 'accept'
            ? 'Thank you — the donor has been told.'
            : 'Noted, thanks.'
          : 'That offer has already been settled.'
      );

      return ok({ handled: 'callback', action: decoded.action, advanced: outcome.advanced });
    }

    return ok({ ignored: 'no-op' });
  });

  // Telegram gets a 2xx for anything it can retry into a storm; only auth failure returns non-2xx.
  return toResponse(result);
}
