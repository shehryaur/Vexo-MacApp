#!/bin/sh
# SCAFFOLD ONLY. Not installed. Not launched. The vexo-mac package never executes this file.
#
# User-space caffeinate cannot keep a MacBook awake with the lid closed on battery.
# The shipped Vexo app used a root helper for that case. A future helper would run:
#   pmset sleepdisabled 1
# and would restore sleep with:
#   pmset sleepdisabled 0
#
# SAFETY cutoffs any such helper must enforce before and during a hold:
# - batteryFloor: restore sleep when the battery percent is under 20.
# - thermalCritical: restore sleep when the thermal state is critical.
# - batteryUnreadable: restore sleep when the battery percent cannot be read.
# - clientTimeout: restore sleep when the client has been gone for more than 60 seconds.
# - maxHold: 604800 seconds (7 days), then restore sleep.
# - bootSession mismatch: restore sleep after a restart.
# Never call a private power API. Never leave sleep disabled after the helper exits.
# This scaffold does not install a LaunchDaemon and does not call sudo.
exit 64
