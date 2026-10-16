// swift-tools-version: 6.0
import PackageDescription
import Foundation

// Les Command Line Tools livrent Swift Testing sans XCTest.
let clt = "/Library/Developer/CommandLineTools"
let plugin = clt + "/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib"
let testingFlags: [SwiftSetting] = FileManager.default.fileExists(atPath: plugin) ? [.unsafeFlags(["-load-plugin-library", plugin])] : []
let package = Package(name: "BanxoCore", platforms: [.iOS(.v17), .macOS(.v14)], products: [.library(name: "BanxoCore", targets: ["BanxoCore"])], targets: [.target(name: "BanxoCore"), .testTarget(name: "BanxoCoreTests", dependencies: ["BanxoCore"], swiftSettings: testingFlags)])
