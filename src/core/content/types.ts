import type {
  ContentMissing,
  ContentNote,
  ResolvedAttachment,
} from "@/core/sync/types";

export type ContentReadResult =
  | {
      kind: "note";
      note: Omit<ContentNote, "requestId">;
      resolved: ResolvedAttachment[];
    }
  | { kind: "missing"; reason: ContentMissing["reason"] };
