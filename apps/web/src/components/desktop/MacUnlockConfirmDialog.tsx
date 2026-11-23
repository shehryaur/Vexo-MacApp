import { T } from "gt-react";
import { useSyncExternalStore } from "react";

import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  readMacUnlockConfirm,
  respondMacUnlockConfirm,
  subscribeMacUnlockConfirm,
} from "../../lib/macUnlock";

export function MacUnlockConfirmDialog() {
  const prompt = useSyncExternalStore(
    subscribeMacUnlockConfirm,
    readMacUnlockConfirm,
    readMacUnlockConfirm,
  );
  if (!prompt) return null;

  const deny = () => {
    void respondMacUnlockConfirm(false);
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) deny();
      }}
    >
      <AlertDialogPopup className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>Allow unlocking this Mac for this task?</T>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <T>The saved password stays in the keychain and is not shown.</T>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={deny}>
            <T>Deny</T>
          </Button>
          <Button
            type="button"
            onClick={() => {
              void respondMacUnlockConfirm(true);
            }}
          >
            <T>Approve</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
