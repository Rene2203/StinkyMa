#!/usr/bin/env bash
# Erzeugt aus dem Projekt ein App-Playground (StinkyMa.swiftpm) für Swift Playgrounds auf dem iPad.
# Playgrounds kann keine Xcode-Projekte und keine lokalen Pakete öffnen; deshalb werden alle
# Module in ein einziges App-Target kopiert und die internen `import`s entfernt.
set -euo pipefail

OUT=${1:-build/playground/StinkyMa.swiftpm}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$OUT"
mkdir -p "$OUT/Sources"

for module in MailCore MailStore PlatformServices AppFeature; do
  mkdir -p "$OUT/Sources/$module"
  cp "$ROOT/Packages/StinkyMaKit/Sources/$module/"*.swift "$OUT/Sources/$module/"
done
mkdir -p "$OUT/Sources/App"
cp "$ROOT/App/Sources/"*.swift "$OUT/Sources/App/"

# Interne Modul-Importe entfernen – im Playground ist alles ein Modul.
find "$OUT/Sources" -name '*.swift' -print0 | xargs -0 sed -i.bak -E '/^import (MailCore|MailStore|PlatformServices|AppFeature)$/d'
find "$OUT/Sources" -name '*.bak' -delete

cat > "$OUT/Package.swift" <<'SWIFT'
// swift-tools-version: 6.0
// Automatisch erzeugt von scripts/make-playground.sh – nicht von Hand ändern.
import AppleProductTypes
import PackageDescription

let package = Package(
    name: "StinkyMa",
    platforms: [
        .iOS("18.0"),
    ],
    products: [
        .iOSApplication(
            name: "StinkyMa",
            targets: ["AppModule"],
            bundleIdentifier: "de.stinkyma.playground",
            displayVersion: "0.1",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .mail),
            accentColor: .presetColor(.blue),
            supportedDeviceFamilies: [
                .pad,
                .phone,
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad])),
            ]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", "7.0.0"..<"8.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Sources"
        ),
    ]
)
SWIFT

echo "App-Playground erzeugt: $OUT"
