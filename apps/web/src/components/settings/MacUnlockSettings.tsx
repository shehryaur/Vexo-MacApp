import type { DesktopMacUnlockBridge } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { T, useGT } from "gt-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsUnavailableGroup,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

type UnlockStatus = {
  readonly passwordStored: boolean;
  readonly askBeforeUnlock: boolean;
};

const DEFAULT_STATUS: UnlockStatus = { passwordStored: false, askBeforeUnlock: true };

function saveFailure(reason: string, gt: ReturnType<typeof useGT>): string {
  if (reason === "empty") return gt("Enter the Mac login password.");
  if (reason === "password_mismatch") return gt("That password does not match this Mac account.");
  if (reason === "not_macos") return gt("Mac unlock only works on this Mac.");
  if (reason === "keychain_save_failed") return gt("Couldn't save the password to the keychain.");
  if (reason === "keychain_delete_failed") return gt("Couldn't remove the saved password.");
  return gt("Couldn't update Mac unlock.");
}

export function MacUnlockSettings() {
  const gt = useGT();
  const setting = useSearchableSetting();
  // The desktop bridge is a stable Electron global, not reactive state: derive it in render.
  const bridge: DesktopMacUnlockBridge | null =
    typeof window === "undefined" ? null : (window.desktopBridge?.macUnlock ?? null);
  const bridgeReady = typeof window !== "undefined";
  const [status, setStatus] = useState<UnlockStatus>(DEFAULT_STATUS);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs with the desktop bridge: fetches the stored-password status once the bridge is known
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge.status().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {
        if (!cancelled) setError(gt("Couldn't check Mac unlock."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bridge, gt]);

  const refresh = async () => {
    if (!bridge) return;
    setStatus(await bridge.status());
  };

  const save = async () => {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.savePassword(password);
      if (result.ok) {
        setPassword("");
        await refresh();
      } else {
        setError(saveFailure(result.reason, gt));
      }
      setBusy(false);
    } catch {
      setError(gt("Couldn't save the password to the keychain."));
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.clearPassword();
      if (!result.ok) setError(saveFailure(result.reason, gt));
      setPassword("");
      await refresh();
      setBusy(false);
    } catch {
      setError(gt("Couldn't remove the saved password."));
      setBusy(false);
    }
  };

  const setAsk = async (askBeforeUnlock: boolean) => {
    if (!bridge) return;
    setStatus((current) => ({ ...current, askBeforeUnlock }));
    setError(null);
    try {
      const result = await bridge.setAskBeforeUnlock(askBeforeUnlock);
      if (!result.ok) {
        setError(saveFailure(result.reason, gt));
        await refresh();
      }
    } catch {
      setError(gt("Couldn't update Mac unlock."));
      await refresh();
    }
  };

  const unlockNow = async () => {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Unlock now leaves the session unlocked. runMacUnlockTask would relock
      // immediately, because the crash marker has no desktop lease.
      const result = await bridge.unlockForTask();
      if (!result.ok) {
        if (result.reason === "denied") {
          setError(gt("Unlock was denied."));
        } else if (result.reason === "not_locked") {
          setError(gt("This Mac is already unlocked."));
        } else if (result.reason === "password_not_stored") {
          setError(gt("Save a login password before unlocking."));
        } else {
          setError(gt("Couldn't unlock this Mac."));
        }
      }
      setBusy(false);
    } catch {
      setError(gt("Couldn't unlock this Mac."));
      setBusy(false);
    }
  };

  const unavailable =
    bridgeReady && !bridge
      ? gt("Mac unlock is available in the Mac app. The login password is never shown.")
      : undefined;

  return (
    <SettingsPageContainer>
      <SettingsSection id="mac-unlock" title={gt("Mac unlock")}>
        <SettingsUnavailableGroup message={unavailable}>
          <SettingsRow
            id="mac-unlock-status"
            title={gt("Status")}
            description={
              status.passwordStored ? (
                <T>Password saved in the login keychain.</T>
              ) : (
                <T>No password saved.</T>
              )
            }
          />
          <SettingsRow {...setting("mac-unlock-password")} description={error}>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="password"
                size="sm"
                className="max-w-64"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={password}
                disabled={!bridge || busy}
                aria-label={gt("Mac login password")}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void save();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={!bridge || busy || password.length === 0}
                onClick={() => void save()}
              >
                <T>Save</T>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!bridge || busy || !status.passwordStored}
                onClick={() => void clear()}
              >
                <T>Clear</T>
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow
            {...setting("mac-unlock-ask")}
            description={
              <T>
                When on, agents cannot unlock this Mac. Use Unlock now (or turn this off) so a
                confirmed task can unlock. On by default.
              </T>
            }
            control={
              <Switch
                checked={status.askBeforeUnlock}
                disabled={!bridge}
                aria-label={gt("Ask before unlocking")}
                onCheckedChange={(checked) => {
                  void setAsk(checked);
                }}
              />
            }
          />
          <SettingsRow
            id="mac-unlock-now"
            title={gt("Unlock now")}
            description={
              <T>
                Shows the confirm prompt when Ask before unlocking is on, then unlocks this Mac.
              </T>
            }
            control={
              <Button
                type="button"
                size="sm"
                disabled={!bridge || busy || !status.passwordStored}
                onClick={() => void unlockNow()}
              >
                <T>Unlock now</T>
              </Button>
            }
          />
        </SettingsUnavailableGroup>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
