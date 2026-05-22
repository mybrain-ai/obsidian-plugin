import { Notice, type ObsidianProtocolData } from "obsidian";
import type MyBrainPlugin from "@/main";
import { confirm } from "@/ui";
import { parseHttpsEndpoint } from "@/url";

const TOKEN_RE = /^[A-Za-z0-9_.-]{16,512}$/;

type Incoming = {
  token: string;
  endpoint: string | null;
  vaultId: string | null;
  vaultName: string | null;
};

type DiffEntry = { label: string; oldValue: string; newValue: string };

export function registerInstallProtocolHandler(plugin: MyBrainPlugin): void {
  plugin.registerObsidianProtocolHandler(
    "mybrain/install",
    async (params: ObsidianProtocolData) => {
      const { token, endpoint, vault_id, vault_name } = params;

      if (!token) {
        new Notice("MyBrain: deep-link missing token");
        return;
      }

      const trimmedToken = token.trim();

      if (!TOKEN_RE.test(trimmedToken)) {
        new Notice("MyBrain: deep-link token has invalid format");
        return;
      }

      let normalizedEndpoint: string | null = null;

      if (endpoint) {
        const parsed = parseHttpsEndpoint(endpoint);

        if (!parsed) {
          new Notice("MyBrain: deep-link endpoint must be a valid https URL");
          return;
        }

        normalizedEndpoint = parsed.href.replace(/\/$/, "");
      }

      const incoming: Incoming = {
        token: trimmedToken,
        endpoint: normalizedEndpoint,
        vaultId: vault_id ?? null,
        vaultName: vault_name ?? null,
      };

      const diff = _diffSettings(plugin, incoming);

      if (diff.length === 0) {
        new Notice("MyBrain: deep-link settings already match");
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
        new Notice("MyBrain: token installed");
      } catch (e) {
        console.error("MyBrain: failed to save deep-link settings", e);
        new Notice("MyBrain: failed to save settings — see console");
      }
    },
  );
}

function _diffSettings(plugin: MyBrainPlugin, incoming: Incoming): DiffEntry[] {
  const diff: DiffEntry[] = [];
  if (plugin.settings.token !== incoming.token) {
    diff.push({
      label: "Token",
      oldValue: _mask(plugin.settings.token),
      newValue: _mask(incoming.token),
    });
  }

  if (incoming.endpoint && plugin.settings.endpoint !== incoming.endpoint) {
    diff.push({
      label: "Endpoint",
      oldValue: plugin.settings.endpoint || "(empty)",
      newValue: incoming.endpoint,
    });
  }

  if (incoming.vaultId && plugin.settings.vaultId !== incoming.vaultId) {
    diff.push({
      label: "Vault ID",
      oldValue: plugin.settings.vaultId || "(empty)",
      newValue: incoming.vaultId,
    });
  }

  if (incoming.vaultName && plugin.settings.vaultName !== incoming.vaultName) {
    diff.push({
      label: "Vault name",
      oldValue: plugin.settings.vaultName || "(empty)",
      newValue: incoming.vaultName,
    });
  }

  return diff;
}

function _mask(token: string): string {
  if (!token) return "(empty)";
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
