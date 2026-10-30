/** `null` when the core plugin is off or unreadable, or the Templates folder
 * unset; unset Daily notes fields fall back to `""` (root) and `YYYY-MM-DD`. */
export type NativeNoteSettings = {
  templatesFolder: string | null;
  dailyNotesFolder: string | null;
  dailyNotesFormat: string | null;
};
