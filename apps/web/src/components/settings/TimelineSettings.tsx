import type { VexoTimelineSettings } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Memory plug-in used by the home Timeline. */
export function TimelineSettings() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const timeline = useScopedSettings((settings) => settings.vexoTimeline);
  const updateSettings = useUpdateScopedSettings();
  const save = (patch: Partial<VexoTimelineSettings>) => {
    updateSettings({ vexoTimeline: { ...timeline, ...patch } });
  };
  const activitiesPath =
    timeline.activitiesPath.trim().length > 0 ? timeline.activitiesPath : timeline.dayPathTemplate;

  return (
    <SettingsPageContainer>
      <SettingsSection id="timeline" title={gt("Timeline")}>
        <SettingsRow
          serverScoped
          {...setting("vexo-timeline")}
          settingKeys={["vexoTimeline"]}
          description={gt(
            "Read one day of activities from a memory plug-in into the home Timeline.",
          )}
          control={
            <Switch
              checked={timeline.enabled}
              onCheckedChange={(checked) => save({ enabled: Boolean(checked) })}
              aria-label={gt("Timeline memory plug-in")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...setting("vexo-timeline-base-url")}
          settingKeys={["vexoTimeline"]}
          title={gt("Base URL")}
          description={gt("Origin of the memory plug-in.")}
        >
          <DraftInput
            className="mb-3 max-w-xl"
            size="sm"
            value={timeline.baseUrl}
            spellCheck={false}
            autoCapitalize="off"
            aria-label={gt("Timeline base URL")}
            onCommit={(baseUrl) => save({ baseUrl })}
          />
        </SettingsRow>
        <SettingsRow
          serverScoped
          {...setting("vexo-timeline-auth-header")}
          settingKeys={["vexoTimeline"]}
          title={gt("Auth header")}
          description={gt("Header name for the API key. Authorization adds Bearer.")}
        >
          <DraftInput
            className="mb-3 max-w-xl"
            size="sm"
            value={timeline.authHeader}
            spellCheck={false}
            autoCapitalize="off"
            aria-label={gt("Timeline auth header")}
            onCommit={(authHeader) => save({ authHeader })}
          />
        </SettingsRow>
        <SettingsRow
          serverScoped
          {...setting("vexo-timeline-api-key")}
          settingKeys={["vexoTimeline"]}
          title={gt("API key")}
          description={gt("Secret sent in the auth header. Leave blank for an open plug-in.")}
        >
          <DraftInput
            className="mb-3 max-w-xl"
            size="sm"
            type="password"
            value={timeline.apiKey}
            autoComplete="off"
            spellCheck={false}
            aria-label={gt("Timeline API key")}
            onCommit={(apiKey) => save({ apiKey })}
          />
        </SettingsRow>
        <SettingsRow
          serverScoped
          {...setting("vexo-timeline-activities-path")}
          settingKeys={["vexoTimeline"]}
          title={gt("Activities path")}
          description={gt("Path template. {day} becomes the date, like 2026-11-22.")}
        >
          <DraftInput
            className="mb-3 max-w-xl"
            size="sm"
            value={activitiesPath}
            spellCheck={false}
            autoCapitalize="off"
            aria-label={gt("Timeline activities path")}
            onCommit={(activitiesPath) => save({ activitiesPath })}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
