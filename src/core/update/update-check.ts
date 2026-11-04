import {
  NOT_CONFIGURED_NOTICE,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_LAST_CHECK_KEY,
  UPDATE_LATEST_VERSION_KEY,
  UPDATE_SKIPPED_VERSION_KEY,
} from "@/core/constants";
import { TokenRejectedError } from "@/core/errors";
import type { UpdateCheckDeps } from "@/core/ports";
import type { UpdateCheckOptions } from "@/core/update/types";
import { compareVersions } from "@/core/update/version";

/** Automatic checks are throttled, honor the skipped version and speak only
 * of updates or a rejected token; manual checks bypass both, always answer. */
export class UpdateCheck {
  constructor(private readonly _deps: UpdateCheckDeps) {}

  /** Look up the latest release and offer it when it is newer. */
  async run({ manual }: UpdateCheckOptions): Promise<void> {
    const { api, device, notifier, prompt, installedVersion } = this._deps;

    if (!this._deps.canSync()) {
      if (manual) notifier.notice(NOT_CONFIGURED_NOTICE);

      return;
    }

    if (!manual && !this._isDue()) return;

    // Record the attempt, not the success — a failing lookup must wait for the
    // next daily window, not retry on every hourly tick.
    device.save(UPDATE_LAST_CHECK_KEY, String(this._deps.clock()));

    let release;

    try {
      release = await api.latestRelease();
    } catch (e) {
      if (!(e instanceof TokenRejectedError)) throw e;

      this._deps.onTokenRejected();

      return;
    }

    if (!release) {
      if (manual) {
        notifier.notice("MyBrain: update check failed — try again later");
      }

      return;
    }

    // Remembered so the settings tab can show an out-of-date note even when
    // the user skipped this version's prompt.
    device.save(UPDATE_LATEST_VERSION_KEY, release.version);

    if (compareVersions(installedVersion, release.version) >= 0) {
      if (manual) notifier.notice("MyBrain: you're on the latest version");

      return;
    }

    if (
      !manual &&
      device.load(UPDATE_SKIPPED_VERSION_KEY) === release.version
    ) {
      return;
    }

    notifier.notice(
      `MyBrain: update available (${installedVersion} → ${release.version})`,
    );
    prompt.show(installedVersion, release, () =>
      device.save(UPDATE_SKIPPED_VERSION_KEY, release.version),
    );
  }

  private _isDue(): boolean {
    const raw = this._deps.device.load(UPDATE_LAST_CHECK_KEY);
    const lastCheck = raw === null ? 0 : Number(raw);

    if (Number.isNaN(lastCheck)) return true;

    return this._deps.clock() - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
  }
}
