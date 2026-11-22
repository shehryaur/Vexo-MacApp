import { createFileRoute } from "@tanstack/react-router";

import { TimelineSettings } from "../components/settings/TimelineSettings";

export const Route = createFileRoute("/_chat/settings/timeline")({
  component: TimelineSettings,
});
