/** A manual check (the settings button) always answers; an automatic one is
 * throttled. */
export type UpdateCheckOptions = { manual: boolean };

/** Latest published plugin release, as served by `GET /latest-release`. */
export type LatestPluginRelease = {
  version: string;
  notes: string;
};
