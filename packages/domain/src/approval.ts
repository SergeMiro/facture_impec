// A person's answer to an action (BTP plan §10 `ApprovalDecision`), from whichever channel carried
// it. `revision` is the action's revision the person saw: an answer to an older version of the
// action (its text was edited, or another person already answered) is refused, not applied. Who
// answered is not in the body: it is the signed-in person, the bound Telegram chat or the signed
// e-mail link. No `timeout` decision: a draft nobody answers stays a draft (docs/DECISIONS.md D6).
import { z } from 'zod';

export const DECISIONS = ['approve', 'reject', 'edit', 'snooze'] as const;
export const Decision = z.enum(DECISIONS);
export type Decision = z.infer<typeof Decision>;

/**
 * excel: « À valider » in the task pane, in Excel or Google Sheets (as `DocumentSource` names it).
 * WhatsApp waits for Meta (docs/DECISIONS.md D3).
 */
export const APPROVAL_CHANNELS = ['excel', 'email', 'telegram', 'whatsapp'] as const;
export const ApprovalChannel = z.enum(APPROVAL_CHANNELS);
export type ApprovalChannel = z.infer<typeof ApprovalChannel>;

/** What a link in the weekly e-mail can decide (stage 3C): the others need the pane (a text, a date). */
export const LINK_DECISIONS = ['approve', 'reject'] as const;
export type LinkDecision = (typeof LINK_DECISIONS)[number];
/** Where a one-time link was given: the weekly e-mail, or a Telegram button (memory M4). */
export const LINK_CHANNELS = ['email', 'telegram'] as const;
export type LinkChannel = (typeof LINK_CHANNELS)[number];

/** The longest a person can put an action aside: past it, the deadline it serves is gone anyway. */
export const MAX_SNOOZE_DAYS = 30;

export const ApprovalDecision = z
  .object({
    actionId: z.uuid(),
    revision: z.int().min(0),
    decision: Decision,
    /** For `edit`, the new text of the message; for the others, an optional note. */
    comment: z.string().trim().min(1).max(2000).optional(),
    /** For `edit`: the recipient's address, when the draft had none or the wrong one (D8). */
    to: z.email().max(254).optional(),
    snoozeUntil: z.iso.datetime({ offset: true }).optional(),
    channel: ApprovalChannel,
  })
  .superRefine((d, ctx) => {
    if (d.decision === 'edit' && !d.comment) {
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'edit_needs_text' });
    }
    if (d.decision === 'snooze' && !d.snoozeUntil) {
      ctx.addIssue({ code: 'custom', path: ['snoozeUntil'], message: 'snooze_needs_date' });
    }
    if (d.decision !== 'snooze' && d.snoozeUntil) {
      ctx.addIssue({ code: 'custom', path: ['snoozeUntil'], message: 'snooze_only' });
    }
    if (d.decision !== 'edit' && d.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'recipient_edit_only' });
    }
  });
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;
