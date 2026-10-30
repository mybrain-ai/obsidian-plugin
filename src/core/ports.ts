import type { ContentReadResult } from "@/core/content/types";
import type {
  AuthState,
  BinaryFile,
  ContentBody,
  ContentMissing,
  ContentNote,
  FolderNode,
  IngestBody,
  IngestResponse,
  ManifestV1Body,
  ManifestV2Body,
  MyBrainSettings,
  NoteSnapshot,
  NoteStamp,
  PingReply,
  PushOptions,
  ResolvedAttachment,
  StoredData,
  UploadFailure,
  UploadResult,
  WsClientMessage,
} from "@/core/sync/types";
import type { LatestPluginRelease } from "@/core/update/types";

export type ConfigReader = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
};

export interface VaultPort {
  vaultName(): string;
  configDir(): string;
  /** Reads the files in the config folder. */
  configReader(): ConfigReader;
  markdownPaths(): NoteStamp[];
  /** The note's path as the vault stores it; null when there is no note. */
  notePath(path: string): string | null;
  /** Hash of the note text, the same as `read(path).hash`, without the rest of
   * the snapshot. Throws when the note can't be read. */
  contentHash(path: string): Promise<string>;
  /** Throws when the note can't be read. */
  read(path: string): Promise<NoteSnapshot>;
  /** Read a few at a time; a note that can't be read is left out. */
  readMany(paths: readonly string[]): Promise<NoteSnapshot[]>;
  folderTree(): FolderNode[];
  /** A file that is not a note, by path; null when there is none. */
  binaryFile(path: string): BinaryFile | null;
}

export interface AttachmentUploader {
  /** Keep the attachments a sent payload referenced, with the files they were
   * read from, so the ones the server asks for can be uploaded. */
  remember(resolved: readonly ResolvedAttachment[]): void;
  /** Upload the remembered attachments among `hashes`; one failure doesn't
   * stop the others. Uploaded and failed ones are forgotten. */
  upload(hashes: readonly string[]): Promise<UploadResult>;
  /** Whether this device uploads attachments now (off on mobile unless the
   * user allowed it). */
  canUpload(): boolean;
  /** Upload one attachment; throws when it fails. */
  send(resolved: ResolvedAttachment): Promise<void>;
}

/** Takes the uploads that failed, to try them again later. */
export interface FailedUploadRecorder {
  record(failures: readonly UploadFailure[]): void;
}

/** The notice that stays on screen while uploads keep failing. */
export interface UploadFailurePrompt {
  /** Show it with a Retry button, or update its count when it is open. */
  show(count: number, onRetry: () => void): void;
  /** Update the count when it is open; nothing otherwise. */
  update(count: number): void;
  close(): void;
}

/** The file part of an attachment upload. */
export type AttachmentFile = {
  name: string;
  bytes: ArrayBuffer;
  contentType: string;
};

export interface MyBrainApi {
  postManifest(
    body: ManifestV1Body | ManifestV2Body,
  ): Promise<IngestResponse | undefined>;
  postIngest(body: IngestBody): Promise<IngestResponse | undefined>;
  postContent(body: ContentBody): Promise<IngestResponse | undefined>;
  uploadAttachment(
    fields: Record<string, string>,
    file: AttachmentFile,
  ): Promise<void>;
  /** Undefined when the server replies with an empty body. */
  ping(): Promise<PingReply | undefined>;
  /** Null on any failure but a rejected token, which throws. */
  latestRelease(): Promise<LatestPluginRelease | null>;
}

export interface DeviceStore {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

export interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

/** The plugin's synced `data.json`: settings plus the edit queue. */
export interface PluginDataPort {
  load(): Promise<StoredData>;
  save(data: StoredData): Promise<void>;
}

export interface Notifier {
  notice(message: string): void;
}

export interface UpdatePrompt {
  show(
    installed: string,
    release: LatestPluginRelease,
    onSkip: () => void,
  ): void;
}

export type ChannelHandlers = {
  onManifestRequest: () => Promise<void> | void;
  onScopeChanged: (folders: string[]) => Promise<void> | void;
  onTokenRejected: () => void;
  onContentRequested: (requestId: string, paths: string[]) => void;
  onOpen: () => void;
};

export interface ServerChannel {
  start(handlers: ChannelHandlers): void;
  stop(): void;
  send(message: WsClientMessage): void;
}

// What each core use case is given. They name the ports above, so they live
// here: in a types.ts they would import ports.ts back and close a cycle.

/** Everything the sync use cases share: the ports, live settings and auth. */
export type SyncDeps = {
  vault: VaultPort;
  api: MyBrainApi;
  attachments: AttachmentUploader;
  failedUploads: FailedUploadRecorder;
  notifier: Notifier;
  timers: Timers;
  clock: () => number;
  settings: () => MyBrainSettings;
  save(): Promise<void>;
  pluginVersion: string;
  auth: AuthState;
};

/** A full sync as the other use cases trigger it. */
export type FullSyncTrigger = { push(options: PushOptions): Promise<boolean> };

export type AttachmentUploadDeps = {
  api: Pick<MyBrainApi, "uploadAttachment">;
  settings: () => { vaultId: string; syncAttachmentsOnMobile: boolean };
  isMobile: () => boolean;
};

export type AttachmentRetryDeps = Pick<
  SyncDeps,
  "timers" | "clock" | "auth" | "notifier"
> & {
  uploader: Pick<AttachmentUploader, "canUpload" | "send">;
  vault: Pick<VaultPort, "binaryFile">;
  device: DeviceStore;
  prompt: UploadFailurePrompt;
  canSync(): boolean;
  onTokenRejected(): void;
};

export interface ContentQueueDeps {
  read(path: string): Promise<ContentReadResult>;
  send(
    notes: ContentNote[],
    missing: ContentMissing[],
  ): Promise<IngestResponse | undefined>;
  uploadAttachments(
    hashes: string[],
    resolved: ResolvedAttachment[],
  ): Promise<void>;
  onTokenRejected(): void;
  timers: Timers;
}

export type ServerEventDeps = Pick<
  SyncDeps,
  "settings" | "save" | "auth" | "notifier" | "pluginVersion"
> & {
  channel: Pick<ServerChannel, "send">;
  fullSync: FullSyncTrigger;
  contentQueue: { request(requestId: string, paths: string[]): void };
};

export type SyncControllerDeps = Pick<
  SyncDeps,
  "settings" | "auth" | "save"
> & {
  editSync: { catchUp(): Promise<void> };
  fullSync: FullSyncTrigger;
  restartChannel(): void;
};

export type UpdateCheckDeps = {
  api: MyBrainApi;
  device: DeviceStore;
  notifier: Notifier;
  prompt: UpdatePrompt;
  canSync(): boolean;
  installedVersion: string;
  clock: () => number;
  onTokenRejected(): void;
};
