import { createFileRoute } from "@tanstack/react-router";

import { MacUnlockSettings } from "../components/settings/MacUnlockSettings";

export const Route = createFileRoute("/_chat/settings/mac-unlock")({
  component: MacUnlockSettings,
});
