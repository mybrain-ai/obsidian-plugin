import type { ObsidianProtocolData } from "obsidian";

import { TOKEN_RE, diffSettings } from "@/core/sync/deep-link-settings";
import { parseHttpsEndpoint } from "@/core/sync/endpoint";
import type { DeepLinkSettings } from "@/core/sync/types";
import { confirm } from "@/ui/confirm-modal";
import type { AppWithSettings, PluginFacade } from "@/ui/types";

/** `obsidian://mybrain/install`: checks the link, shows what it would change,
 * and applies it once the user confirms. */
export function registerInstallProtocolHandler(plugin: PluginFacade): void {
  plugin.registerObsidianProtocolHandler(
    "mybrain/install",
    async (params: ObsidianProtocolData) => {
      const { token, endpoint, vault_id, vault_name } = params;

      if (!token) {
        plugin.notifier.notice("MyBrain: deep-link missing token");

        return;
      }

      const trimmedToken = token.trim();

      if (!TOKEN_RE.test(trimmedToken)) {
        plugin.notifier.notice("MyBrain: deep-link token has invalid format");

        return;
      }

      let normalizedEndpoint: string | null = null;

      if (endpoint) {
        const parsed = parseHttpsEndpoint(endpoint);

        if (!parsed) {
          plugin.notifier.notice(
            "MyBrain: deep-link endpoint must be a valid HTTPS URL",
          );

          return;
        }

        normalizedEndpoint = parsed.href.replace(/\/$/, "");
      }

      const incoming: DeepLinkSettings = {
        token: trimmedToken,
        endpoint: normalizedEndpoint,
        vaultId: vault_id ?? null,
        vaultName: vault_name ?? null,
      };

      const diff = diffSettings(plugin.settings, incoming);

      if (diff.length === 0) {
        plugin.notifier.notice("MyBrain: deep-link settings already match");
        _openPluginSettings(plugin);

        return;
      }

      const confirmed = await confirm(plugin.app, {
        title: "MyBrain: confirm deep-link",
        body: (el) => {
          el.createEl("p", {
            text: "A deep link is requesting to update these settings:",
          });

          const list = el.createEl("ul");

          for (const entry of diff) {
            const li = list.createEl("li");

            li.createEl("strong", { text: `${entry.label}: ` });
            li.createSpan({ text: `${entry.oldValue} → ${entry.newValue}` });
          }
        },
        confirmText: "Apply",
      });

      if (!confirmed) return;

      try {
        await plugin.applyDeepLinkSettings(incoming);
        plugin.notifier.notice(
          "MyBrain: token installed — open settings → MyBrain to check the connection.",
        );

        _openPluginSettings(plugin);
      } catch (e) {
        console.error("MyBrain: failed to save deep-link settings", e);
        plugin.notifier.notice(
          "MyBrain: couldn't save the settings from the link. Open the link again.",
        );
      }
    },
  );
}

/** `obsidian://mybrain/open`: opens this plugin's settings. */
export function registerOpenProtocolHandler(plugin: PluginFacade): void {
  plugin.registerObsidianProtocolHandler("mybrain/open", () => {
    _openPluginSettings(plugin);
  });
}

function _openPluginSettings(plugin: PluginFacade): void {
  function openSettings(): void {
    try {
      const setting = (plugin.app as unknown as AppWithSettings).setting;

      setting?.open?.();
      setting?.openTabById?.(plugin.manifest.id);
    } catch (e) {
      console.warn("MyBrain: could not open plugin settings", e);
    }
  }

  // Deferred: opening settings synchronously from the handler can silently
  // no-op, especially right after a deep-link launch.
  plugin.app.workspace.onLayoutReady(() => window.setTimeout(openSettings, 0));
}
