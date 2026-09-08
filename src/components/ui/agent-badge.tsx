import { AGENT_DISPLAY_NAMES, type AgentId } from '@/lib/domain';

/**
 * Per-agent attribution in the feed.
 *
 * Colour plus the agent's name in text, never colour alone — the same rule the map pins follow.
 * A reader who cannot distinguish the hues still knows which agent acted.
 */

const DOT: Record<AgentId, string> = {
  perception: 'bg-agent-perception',
  prediction: 'bg-agent-prediction',
  negotiation: 'bg-agent-negotiation',
  logistics: 'bg-agent-logistics',
  impact: 'bg-agent-impact',
  partner: 'bg-agent-partner',
};

const TEXT: Record<AgentId, string> = {
  perception: 'text-agent-perception',
  prediction: 'text-agent-prediction',
  negotiation: 'text-agent-negotiation',
  logistics: 'text-agent-logistics',
  impact: 'text-agent-impact',
  partner: 'text-agent-partner',
};

export function AgentBadge({ agentId }: { agentId: AgentId }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[agentId]}`} />
      <span className={`text-[11px] font-semibold tracking-wide uppercase ${TEXT[agentId]}`}>
        {AGENT_DISPLAY_NAMES[agentId]}
      </span>
    </span>
  );
}

export function agentDotClass(agentId: AgentId): string {
  return DOT[agentId];
}

/** Relative time, kept short so a feed card reads as one line. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Human label for a degraded path. Every fallback is named in the UI, never hidden. */
export function fallbackLabel(fallback: string): string {
  switch (fallback) {
    case 'manual_entry':
      return 'could not read it — add by hand';
    case 'vision_unavailable':
      return 'vision service unavailable';
    case 'shelf_life_generalised':
      return 'shelf life is a category estimate';
    case 'routing_straight_line':
      return 'straight-line distance';
    case 'routing_cached':
      return 'cached road distance';
    case 'no_viable_window':
      return 'no collection slot fits';
    case 'no_eligible_recipient':
      return 'no recipient in range';
    case 'factor_proxy':
      return 'proxy emission factor';
    case 'factor_not_available':
      return 'footprint not quantified';
    case 'simulated_recipient':
      return 'simulated recipient';
    case 'no_diversion_route':
      return 'no diversion route';
    default:
      return fallback.replace(/_/g, ' ');
  }
}
