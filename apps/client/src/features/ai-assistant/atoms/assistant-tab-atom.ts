import { atom } from "jotai";

export type AssistantTab = "ask" | "task";

export const assistantTabAtom = atom<AssistantTab>("ask");
