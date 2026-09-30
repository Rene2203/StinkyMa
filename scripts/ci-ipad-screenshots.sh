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

# Screenshots auch bei fehlgeschlagenem Test exportieren – gerade dann helfen sie bei der Fehlersuche.
TEST_STATUS=0
xcodebuild test \
  -project StinkyMa.xcodeproj \
  -scheme StinkyMa-iOS \
  -destination "id=$UDID" \
  -resultBundlePath "$OUT/UITests.xcresult" \
  CODE_SIGNING_ALLOWED=NO || TEST_STATUS=$?

# Screenshots mit sprechenden Namen aus dem Ergebnis-Bundle holen.
xcrun xcresulttool export attachments --path "$OUT/UITests.xcresult" --output-path "$OUT/screenshots"
python3 - "$OUT/screenshots" <<'PY'
import json, os, re, sys
folder = sys.argv[1]
manifest = json.load(open(os.path.join(folder, "manifest.json")))
for test in manifest:
    for attachment in test.get("attachments", []):
        exported = os.path.join(folder, attachment["exportedFileName"])
        name = attachment.get("suggestedHumanReadableName", "")
        # Eigene Screenshots („01-Posteingang_0_<UUID>.png“) und die Bildschirmaufnahme behalten,
        # alles andere (Debug-Texte, UI-Hierarchie) verwerfen.
        match = re.match(r"^(\d\d-[A-Za-z0-9-]+)_0_", name)
        if match:
            target = match.group(1) + ".png"
        elif name.startswith("Screen Recording") and name.endswith(".mp4"):
            target = "Bildschirmaufnahme.mp4"
        else:
            os.remove(exported)
            continue
        os.replace(exported, os.path.join(folder, target))
        print("Behalten:", target)
os.remove(os.path.join(folder, "manifest.json"))
PY

exit $TEST_STATUS
