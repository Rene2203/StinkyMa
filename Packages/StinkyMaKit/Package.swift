// swift-tools-version: 6.0
import PackageDescription

// Kernmodule der App. Regel (Spezifikation, Abschnitt 10): MailCore, MailSync,
// MailStore und AIKit importieren weder SwiftUI noch UIKit und bauen auch unter
// Linux. Apple-spezifisches (Keychain, EventKit, …) liegt in PlatformServices.
let package = Package(
    name: "StinkyMaKit",
    platforms: [
        .iOS("26.0"),
        .macOS("26.0"),
    ],
    products: [
        .library(name: "MailCore", targets: ["MailCore"]),
        .library(name: "MailStore", targets: ["MailStore"]),
        .library(name: "PlatformServices", targets: ["PlatformServices"]),
        .library(name: "AppFeature", targets: ["AppFeature"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .target(name: "MailCore"),
        .target(
            name: "MailStore",
            dependencies: [
                "MailCore",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .target(
            name: "PlatformServices",
            dependencies: ["MailCore"]
        ),
        .target(
            name: "AppFeature",
            dependencies: ["MailCore", "MailStore", "PlatformServices"]
        ),
        .testTarget(name: "MailCoreTests", dependencies: ["MailCore"]),
        .testTarget(name: "MailStoreTests", dependencies: ["MailStore"]),
        .testTarget(name: "PlatformServicesTests", dependencies: ["PlatformServices"]),
        .testTarget(name: "AppFeatureTests", dependencies: ["AppFeature", "MailStore"]),
    ],
    swiftLanguageModes: [.v6]
)
