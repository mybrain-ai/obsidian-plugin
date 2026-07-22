export type FolderNode = { path: string; name: string; parent: string | null };

export type AttachmentRef = {
  path: string;
  ext: string;
  size: number;
  mtime: number;
  hash: string;
};

export type UpsertEvent = {
  op: "upsert";
  path: string;
  name: string;
  ext: "md";
  content: string;
  frontmatter: Record<string, unknown> | null;
  mtime: number;
  size: number;
  hash: string;
  wikilinks: string[];
  mdLinks: string[];
  attachments: AttachmentRef[];
};

export type DeleteEvent = { op: "delete"; path: string };
export type RenameEvent = { op: "rename"; oldPath: string; newPath: string };
export type IngestEvent = UpsertEvent | DeleteEvent | RenameEvent;

export type IngestResponse = {
  accepted: number;
  rejected: Array<{ path: string; reason: string }>;
  attachmentsNeeded: string[];
};

export const API_VERSION = 1;
