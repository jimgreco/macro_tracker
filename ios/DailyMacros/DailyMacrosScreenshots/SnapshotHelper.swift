import Foundation
import XCTest
import UIKit

@MainActor
func setupSnapshot(_ app: XCUIApplication, waitForAnimations: Bool = true) {
    Snapshot.setupSnapshot(app, waitForAnimations: waitForAnimations)
}

@MainActor
func snapshot(_ name: String, timeWaitingForIdle timeout: TimeInterval = 20) {
    Snapshot.snapshot(name, timeWaitingForIdle: timeout)
}

enum SnapshotError: Error, CustomDebugStringConvertible {
    case cannotFindSimulatorHomeDirectory
    case cannotRunOnPhysicalDevice

    var debugDescription: String {
        switch self {
        case .cannotFindSimulatorHomeDirectory:
            return "Couldn't find simulator home location. Please check SIMULATOR_HOST_HOME."
        case .cannotRunOnPhysicalDevice:
            return "Can't use Snapshot on a physical device."
        }
    }
}

@objcMembers
@MainActor
final class Snapshot: NSObject {
    static var app: XCUIApplication?
    private static var waitForAnimations = true
    private static var cacheDirectory: URL?
    private static var screenshotsDirectory: URL? {
        cacheDirectory?.appendingPathComponent("screenshots", isDirectory: true)
    }

    static func setupSnapshot(_ app: XCUIApplication, waitForAnimations: Bool = true) {
        Snapshot.app = app
        Snapshot.waitForAnimations = waitForAnimations

        do {
            let cacheDir = try getCacheDirectory()
            Snapshot.cacheDirectory = cacheDir
            setLanguage(app)
            setLocale(app)
            setLaunchArguments(app)
        } catch {
            NSLog(error.localizedDescription)
        }
    }

    static func snapshot(_ name: String, timeWaitingForIdle timeout: TimeInterval = 20) {
        if timeout > 0 {
            waitForLoadingIndicatorToDisappear(within: timeout)
        }

        NSLog("snapshot: \(name)")

        if Snapshot.waitForAnimations {
            sleep(1)
        }

        guard let screenshotsDir = screenshotsDirectory,
              var simulator = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] else {
            return
        }

        do {
            try FileManager.default.createDirectory(at: screenshotsDir, withIntermediateDirectories: true)
            let regex = try NSRegularExpression(pattern: "Clone [0-9]+ of ")
            let range = NSRange(location: 0, length: simulator.count)
            simulator = regex.stringByReplacingMatches(in: simulator, range: range, withTemplate: "")

            let screenshot = XCUIScreen.main.screenshot()
            let image = XCUIDevice.shared.orientation.isLandscape ? fixLandscapeOrientation(image: screenshot.image) : screenshot.image
            let path = screenshotsDir.appendingPathComponent("\(simulator)-\(name).png")
            try image.pngData()?.write(to: path, options: .atomic)
        } catch {
            NSLog("Problem writing screenshot: \(name) to \(screenshotsDir)")
            NSLog(error.localizedDescription)
        }
    }

    private static func setLanguage(_ app: XCUIApplication) {
        guard let cacheDirectory else { return }
        let path = cacheDirectory.appendingPathComponent("language.txt")
        if let language = try? String(contentsOf: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           !language.isEmpty {
            app.launchArguments += ["-AppleLanguages", "(\(language))"]
        }
    }

    private static func setLocale(_ app: XCUIApplication) {
        guard let cacheDirectory else { return }
        let path = cacheDirectory.appendingPathComponent("locale.txt")
        if let locale = try? String(contentsOf: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           !locale.isEmpty {
            app.launchArguments += ["-AppleLocale", "\"\(locale)\""]
        }
    }

    private static func setLaunchArguments(_ app: XCUIApplication) {
        guard let cacheDirectory else { return }
        let path = cacheDirectory.appendingPathComponent("snapshot-launch_arguments.txt")
        app.launchArguments += ["-FASTLANE_SNAPSHOT", "YES", "-ui_testing"]

        guard let launchArguments = try? String(contentsOf: path, encoding: .utf8) else {
            return
        }

        do {
            let regex = try NSRegularExpression(pattern: "(\\\".+?\\\"|\\S+)")
            let matches = regex.matches(in: launchArguments, range: NSRange(location: 0, length: launchArguments.count))
            app.launchArguments += matches.map { (launchArguments as NSString).substring(with: $0.range) }
        } catch {
            NSLog("Couldn't parse snapshot launch arguments.")
        }
    }

    private static func waitForLoadingIndicatorToDisappear(within timeout: TimeInterval) {
        guard let app else { return }
        let networkLoadingIndicator = app.otherElements.deviceStatusBars.networkLoadingIndicators.element
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: networkLoadingIndicator
        )
        _ = XCTWaiter.wait(for: [expectation], timeout: timeout)
    }

    private static func getCacheDirectory() throws -> URL {
        let cachePath = "Library/Caches/tools.fastlane"

        #if os(OSX)
        return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(cachePath)
        #elseif arch(i386) || arch(x86_64) || arch(arm64)
        guard let simulatorHostHome = ProcessInfo.processInfo.environment["SIMULATOR_HOST_HOME"] else {
            throw SnapshotError.cannotFindSimulatorHomeDirectory
        }
        return URL(fileURLWithPath: simulatorHostHome).appendingPathComponent(cachePath)
        #else
        throw SnapshotError.cannotRunOnPhysicalDevice
        #endif
    }

    private static func fixLandscapeOrientation(image: UIImage) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }
}

private extension XCUIElementAttributes {
    var isNetworkLoadingIndicator: Bool {
        if hasAllowListedIdentifier { return false }

        let hasOldLoadingIndicatorSize = frame.size == CGSize(width: 10, height: 20)
        let hasNewLoadingIndicatorSize = frame.size.width.isBetween(46, and: 47) && frame.size.height.isBetween(2, and: 3)
        return hasOldLoadingIndicatorSize || hasNewLoadingIndicatorSize
    }

    var hasAllowListedIdentifier: Bool {
        ["GeofenceLocationTrackingOn", "StandardLocationTrackingOn"].contains(identifier)
    }

    func isStatusBar(_ deviceWidth: CGFloat) -> Bool {
        if elementType == .statusBar { return true }
        guard frame.origin == .zero else { return false }

        let oldStatusBarSize = CGSize(width: deviceWidth, height: 20)
        let newStatusBarSize = CGSize(width: deviceWidth, height: 44)
        return [oldStatusBarSize, newStatusBarSize].contains(frame.size)
    }
}

private extension XCUIElementQuery {
    var networkLoadingIndicators: XCUIElementQuery {
        let predicate = NSPredicate { object, _ in
            guard let element = object as? XCUIElementAttributes else { return false }
            return element.isNetworkLoadingIndicator
        }
        return containing(predicate)
    }

    @MainActor
    var deviceStatusBars: XCUIElementQuery {
        guard let app = Snapshot.app else {
            fatalError("XCUIApplication is not set. Call setupSnapshot(app) before snapshot().")
        }

        let deviceWidth = app.windows.firstMatch.frame.width
        let predicate = NSPredicate { object, _ in
            guard let element = object as? XCUIElementAttributes else { return false }
            return element.isStatusBar(deviceWidth)
        }
        return containing(predicate)
    }
}

private extension CGFloat {
    func isBetween(_ numberA: CGFloat, and numberB: CGFloat) -> Bool {
        numberA...numberB ~= self
    }
}

// Please don't remove the lines below.
// They are used by fastlane to detect outdated configuration files.
// SnapshotHelperVersion [1.30]
