#!/usr/bin/env bash
# Startet die iPad-App im Simulator, führt die UI-Tests aus und legt die Screenshots
# unter build/screenshots ab. Läuft in der CI (macOS) und lokal auf jedem Mac mit Xcode.
set -euo pipefail

OUT=build
rm -rf "$OUT/UITests.xcresult" "$OUT/screenshots"
mkdir -p "$OUT/screenshots"

# Neuestes iPad Pro und neueste iOS-Laufzeit wählen, damit das Skript nicht an Gerätenamen hängt.
DEVICE_TYPE=$(xcrun simctl list devicetypes -j | python3 -c '
import json, sys
types = [t["identifier"] for t in json.load(sys.stdin)["devicetypes"] if "iPad-Pro" in t["identifier"] and "13" in t["identifier"]]
print(types[-1])')
RUNTIME=$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
runtimes = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS" and r["isAvailable"]]
print(runtimes[-1]["identifier"])')
echo "Simulator: $DEVICE_TYPE / $RUNTIME"
UDID=$(xcrun simctl create "StinkyMa CI iPad" "$DEVICE_TYPE" "$RUNTIME")
trap 'xcrun simctl delete "$UDID" >/dev/null 2>&1 || true' EXIT
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null

xcodebuild test \
  -project StinkyMa.xcodeproj \
  -scheme StinkyMa-iOS \
  -destination "id=$UDID" \
  -resultBundlePath "$OUT/UITests.xcresult" \
  CODE_SIGNING_ALLOWED=NO

# Screenshots mit sprechenden Namen aus dem Ergebnis-Bundle holen.
xcrun xcresulttool export attachments --path "$OUT/UITests.xcresult" --output-path "$OUT/screenshots"
python3 - "$OUT/screenshots" <<'PY'
import json, os, sys
folder = sys.argv[1]
manifest = json.load(open(os.path.join(folder, "manifest.json")))
for test in manifest:
    for attachment in test.get("attachments", []):
        name = attachment.get("suggestedHumanReadableName") or attachment["exportedFileName"]
        # Xcode hängt z. B. „_0_<UUID>.png“ an; den Anfang bis zum ersten Unterstrich nach dem Namen behalten.
        base = name.split("_0_")[0]
        if not base.endswith(".png"):
            base += ".png"
        os.replace(os.path.join(folder, attachment["exportedFileName"]), os.path.join(folder, base))
        print("Screenshot:", base)
PY
