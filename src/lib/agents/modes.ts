import type { AgentMode } from "@/lib/types";

export const AGENT_MODES: {
  id: AgentMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "tool-free",
    label: "Tool-free",
    hint: "Keywords plus a JSON classifier. The model does not call tools.",
  },
  {
    id: "handwritten",
    label: "Hand-written tools",
    hint: "The model calls list_recent_commits, list_open_cards, move_card_to_done, and no_match. This file runs them.",
  },
];

const LEGACY_AGENT_MODES: Record<string, AgentMode> = {
  current: "tool-free",
  loop: "handwritten",
};

export function parseAgentMode(value: string | undefined): AgentMode {
  if (!value) return "tool-free";
  if (value in LEGACY_AGENT_MODES) return LEGACY_AGENT_MODES[value];
  if (AGENT_MODES.some((mode) => mode.id === value)) return value as AgentMode;
  return "tool-free";
}

export function agentModeLabel(id: AgentMode) {
  return AGENT_MODES.find((mode) => mode.id === id)?.label ?? id;
}

export function agentModeNote(id: AgentMode, extra?: string) {
  const note = `agentMode=${id}`;
  return extra ? `${extra}; ${note}` : note;
}
