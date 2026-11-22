# vexo-mac

Local computer-use for this Mac. One desktop lease, window capture, and a confirmed lock-screen unlock. No network port. Keystrokes and passwords are never logged.

## Lease

`acquire(threadId)` takes the only lease. Another thread gets `{ok:false, reason:"held", owner}` until `release`, `abort`, or 120 seconds without activity.
The same thread may acquire again; that refreshes the idle timer. `release(threadId)` frees the lease, and only the holder can release it.
`current()` returns `{owner, acquiredAt, lastActiveAt}` or null. `touch(threadId)` moves the idle deadline forward. Clicks and typing call it too.
`abort()` is the human override. It clears the holder immediately so later clicks and keystrokes are refused.

## Observe

`listWindows()` returns on-screen windows, front to back: `windowId`, `title`, `app`, and `bounds` in screen points (origin top-left).
`observeFront()` captures the front window with `/usr/sbin/screencapture -l<id>` and returns `{windowId, title, app, imagePath, bounds}`.
`imagePath` is a temp JPEG. Image bytes are not logged. `captureFrame()` returns `{imagePath}` for the whole display.
If unlock is in progress or the session is locked, `captureFrame()` returns `{redacted:true}` and does not run screencapture.

## Act

`click(threadId, {x, y}, target?)` requires the lease, raises `target.windowId`, then posts a CoreGraphics move and left click.
`typeText(threadId, text, target?)` types Unicode. `key(threadId, name, target?)` presses return, escape, tab, space, delete, or an arrow.
The text is written to the helper's stdin. It is not placed on the command line and it is not logged.
`isPasswordField(target)` is true for a secure-text role or a title of password, passcode, or passwd.
Click, type, and key then return `{ok:false, reason:"password_field"}` and post nothing. No lease returns `lease_required`.

## Unlock

`savePassword(password)` checks the local account when it can, then runs `security add-generic-password` for service `com.vexo.mac.unlock` and the current user.
A clear mismatch is not saved. If the check cannot run, the save still proceeds. `passwordStored()` and `clearPassword()` never return the secret.
`unlock()` returns `{ok:false, reason:"confirmation_required"}`. `unlock({confirmed:true})` types the stored password only into a locked session.
Before typing, it writes `~/Library/Application Support/VexoMac/unlock.json` with `{unlocked:true, at}`.
`relock()` runs `CGSession -suspend` when that binary exists. Otherwise it tells System Events to keystroke `q` using `{control down, command down}` (Lock Screen; needs Accessibility). If that cannot run, the result is `{ok:false, reason:"relock_unavailable"}`.
`relockIfAbandoned()` calls relock when that file exists and `current()` is null, including after a crash or `abort()`.

## Awake

`setAwake(true)` holds idle sleep with `/usr/bin/caffeinate -dims -w <pid>`. `awakeStatus()` reports whether that hold is running.
`pmset` is read-only here (`-g`, `-g batt`, `-g therm`). The hold stays off below 20% battery, when the thermal text says critical, when the battery percent cannot be read, and after 7 days.
A closed lid on battery still sleeps. `scripts/awake-root-helper.sh` only documents that root path and exits 64. Nothing in this package runs it, and nothing calls a private power API.

## Band

`bandStatus()` reads `system_profiler SPBluetoothDataType` for radios whose name contains "vexo" or whose service text contains `a8e9`.
`bandScan()` adds a few seconds of public CoreBluetooth discovery (`scripts/ble-scan.swift`) and does not connect.
`connected` means macOS already has a connection. Pairing is not implemented.

## How a thread calls it

Acquire, then `observeFront` or `captureFrame`, then `click`, `typeText`, or `key`, then `release`. Call `touch` while choosing the next point.
If the person at the Mac takes over, call `abort()`, then `relockIfAbandoned()` when this package unlocked the session.
Screen Recording is prompted by `screencapture`. Accessibility is prompted once per input call; if it is still missing, input returns one error and does not retry. The password stays in the login keychain.
