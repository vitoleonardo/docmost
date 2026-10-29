import { atom } from "jotai";
import type { IExtractionRequest } from "@/features/ai-assistant/types/ai-assistant.types.ts";

export const extractionRequestAtom = atom(null as IExtractionRequest | null);
