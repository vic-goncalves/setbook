// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SetbookKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "Domain", targets: ["Domain"]),
        .library(name: "Metrics", targets: ["Metrics"]),
        .library(name: "Persistence", targets: ["Persistence"]),
        .library(name: "Workflow", targets: ["Workflow"]),
        .library(name: "Sync", targets: ["Sync"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .target(name: "Domain"),
        .target(name: "Metrics", dependencies: ["Domain"]),
        .target(
            name: "Persistence",
            dependencies: ["Domain", "Metrics", .product(name: "GRDB", package: "GRDB.swift")]
        ),
        .target(name: "Workflow", dependencies: ["Domain", "Persistence"]),
        .target(name: "Sync", dependencies: ["Domain", "Persistence"]),
        .testTarget(name: "SyncTests", dependencies: ["Sync", "Persistence", "Domain"]),
        .testTarget(name: "WorkflowTests", dependencies: ["Workflow", "Persistence", "Domain"]),
        .testTarget(name: "DomainTests", dependencies: ["Domain"]),
        .testTarget(name: "MetricsTests", dependencies: ["Metrics", "Domain"]),
        .testTarget(name: "PersistenceTests", dependencies: ["Persistence", "Domain", "Metrics"]),
    ]
)
