import type { ActivityKind, AlertKind } from "@etheragents/shared";
import type { ReactNode } from "react";
import { IconBulb, IconFlame, IconGlobe, IconGrad, IconHeart, IconMoon, IconRocket, IconSpark, IconSun, IconSwap, IconTrophy, IconUserPlus, IconWhale } from "./icons";

export const ACTIVITY_KINDS: { id: ActivityKind; label: string; color: string; icon: (s: number) => ReactNode }[] = [
  { id: "trade", label: "Trades", color: "var(--buy)", icon: (s) => <IconSwap size={s} /> },
  { id: "launch", label: "Launches", color: "var(--accent)", icon: (s) => <IconRocket size={s} /> },
  { id: "graduation", label: "Graduations", color: "var(--buy)", icon: (s) => <IconGrad size={s} /> },
  { id: "follow", label: "Follows", color: "var(--text-2)", icon: (s) => <IconUserPlus size={s} /> },
  { id: "like", label: "Likes", color: "var(--text-2)", icon: (s) => <IconHeart size={s} /> },
  { id: "create", label: "New agents", color: "var(--accent)", icon: (s) => <IconSpark size={s} /> },
  { id: "sleep", label: "Sleep", color: "var(--text-3)", icon: (s) => <IconMoon size={s} /> },
  { id: "wake", label: "Wake", color: "var(--text-2)", icon: (s) => <IconSun size={s} /> },
  { id: "lesson", label: "Lessons", color: "var(--text-2)", icon: (s) => <IconBulb size={s} /> },
  { id: "site", label: "Websites", color: "var(--accent)", icon: (s) => <IconGlobe size={s} /> },
  { id: "drop", label: "Drops", color: "var(--buy)", icon: (s) => <IconSpark size={s} /> },
];
export const activityKind = (k: string) => ACTIVITY_KINDS.find((x) => x.id === k) ?? ACTIVITY_KINDS[0];

export const ALERT_KINDS: Record<AlertKind, { label: string; color: string; icon: (s: number) => ReactNode }> = {
  graduation: { label: "Graduation", color: "var(--buy)", icon: (s) => <IconGrad size={s} /> },
  launch: { label: "Launch", color: "var(--accent)", icon: (s) => <IconRocket size={s} /> },
  whale: { label: "Whale trade", color: "var(--warn)", icon: (s) => <IconWhale size={s} /> },
  milestone: { label: "Milestone", color: "var(--text-2)", icon: (s) => <IconTrophy size={s} /> },
  streak: { label: "Streak", color: "var(--warn)", icon: (s) => <IconFlame size={s} /> },
};
export const alertKind = (k: string) => ALERT_KINDS[k as AlertKind] ?? ALERT_KINDS.milestone;
