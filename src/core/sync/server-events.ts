import { PROTOCOL_VERSION } from "@/core/constants";
import type { ChannelHandlers, ServerEventDeps } from "@/core/ports";
import { markTokenRejected } from "@/core/sync/sync-steps";

/** What the plugin does for each message the server channel delivers. */
export function serverEventHandlers(deps: ServerEventDeps): ChannelHandlers {
  return {
    onManifestRequest: async () => {
      await deps.fullSync.push({ initial: false });
    },
    onScopeChanged: async (folders) => {
      deps.settings().inScopeFolders = folders;

      await deps.save();
      await deps.fullSync.push({ initial: false });
    },
    onTokenRejected: () => markTokenRejected(deps),
    onContentRequested: (requestId, paths) => {
      deps.contentQueue.request(requestId, paths);
    },
    /** Announces protocol 2; the server replies with its open content requests. */
    onOpen: () => {
      deps.channel.send({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        pluginVersion: deps.pluginVersion,
      });
    },
  };
}
