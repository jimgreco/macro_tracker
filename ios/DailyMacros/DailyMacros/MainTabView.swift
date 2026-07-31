import SwiftUI

enum FeaturePreferenceKeys {
    static let sexualActivityPageVisible = "sexual_activity_page_visible"
}

enum AppDestination: String, CaseIterable {
    case today
    case macros
    case workouts
    case health
    case insights
}

enum HealthArea: String, CaseIterable {
    case weight
    case sleep
    case sexualActivity

    var label: String {
        switch self {
        case .weight: return "Weight"
        case .sleep: return "Sleep"
        case .sexualActivity: return "Sexual Activity"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .sexualActivity: return "Sexual Activity"
        default: return label
        }
    }
}

enum AppQuickAction: String {
    case logMeal
    case logWorkout
    case logWeight
    case logSleep
}

@MainActor
final class AppNavigationModel: ObservableObject {
    @Published var selectedDestination: AppDestination = .today
    @Published var healthArea: HealthArea = .sleep
    @Published private(set) var pendingQuickAction: AppQuickAction?
    @Published private(set) var coachActionRevision = 0
    private(set) var pendingCoachAction: CoachAction?
    private var pendingCoachSurface: CoachSurface?

    func request(_ action: AppQuickAction) {
        pendingQuickAction = nil
        pendingCoachAction = nil
        pendingCoachSurface = nil
        switch action {
        case .logMeal:
            selectedDestination = .macros
        case .logWorkout:
            selectedDestination = .workouts
        case .logWeight:
            healthArea = .weight
            selectedDestination = .health
        case .logSleep:
            healthArea = .sleep
            selectedDestination = .health
        }
        pendingQuickAction = action
    }

    @discardableResult
    func consume(_ action: AppQuickAction) -> Bool {
        guard pendingQuickAction == action, isActive(for: action) else { return false }
        pendingQuickAction = nil
        return true
    }

    func request(_ action: CoachAction, from surface: CoachSurface) {
        pendingQuickAction = nil
        pendingCoachAction = nil
        pendingCoachSurface = nil

        switch action.type {
        case .openLogMeal, .openQuickAdd, .logMealItem:
            selectedDestination = .macros
        case .openLogWorkout, .logWorkoutEntry:
            selectedDestination = .workouts
        case .openLogWeight:
            healthArea = .weight
            selectedDestination = .health
        case .openLogSleep:
            healthArea = .sleep
            selectedDestination = .health
        case .editTargets:
            switch surface {
            case .macros:
                selectedDestination = .macros
            case .workouts:
                selectedDestination = .workouts
            case .weight:
                healthArea = .weight
                selectedDestination = .health
            case .sleep:
                healthArea = .sleep
                selectedDestination = .health
            }
        }

        pendingCoachAction = action
        pendingCoachSurface = surface
        coachActionRevision &+= 1
    }

    func consumeCoachAction(
        for surface: CoachSurface,
        matching types: [CoachActionType]
    ) -> CoachAction? {
        guard pendingCoachSurface == surface,
              isActive(for: surface),
              let pendingCoachAction,
              types.contains(pendingCoachAction.type) else {
            return nil
        }
        self.pendingCoachAction = nil
        pendingCoachSurface = nil
        return pendingCoachAction
    }

    func open(_ destination: AppDestination) {
        pendingQuickAction = nil
        pendingCoachAction = nil
        pendingCoachSurface = nil
        selectedDestination = destination
    }

    func handle(url: URL) {
        let route = ([url.host ?? ""] + url.pathComponents)
            .map { $0.lowercased() }
            .joined(separator: "/")

        if route.contains("health/weight") || route.hasSuffix("/weight") {
            healthArea = .weight
            open(.health)
        } else if route.contains("health/sleep") || route.hasSuffix("/sleep") {
            healthArea = .sleep
            open(.health)
        } else if route.contains("sexual") || route.contains("health/activity") {
            healthArea = .sexualActivity
            open(.health)
        } else if route.contains("workout") {
            open(.workouts)
        } else if route.contains("macro") {
            open(.macros)
        } else if route.contains("insight") || route.contains("analysis") {
            open(.insights)
        } else if route.contains("health") {
            open(.health)
        } else {
            open(.today)
        }
    }

    private func isActive(for action: AppQuickAction) -> Bool {
        switch action {
        case .logMeal:
            return selectedDestination == .macros
        case .logWorkout:
            return selectedDestination == .workouts
        case .logWeight:
            return selectedDestination == .health && healthArea == .weight
        case .logSleep:
            return selectedDestination == .health && healthArea == .sleep
        }
    }

    private func isActive(for surface: CoachSurface) -> Bool {
        switch surface {
        case .macros:
            return selectedDestination == .macros
        case .workouts:
            return selectedDestination == .workouts
        case .weight:
            return selectedDestination == .health && healthArea == .weight
        case .sleep:
            return selectedDestination == .health && healthArea == .sleep
        }
    }
}

private struct PresentSettingsActionKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    var presentSettings: () -> Void {
        get { self[PresentSettingsActionKey.self] }
        set { self[PresentSettingsActionKey.self] = newValue }
    }
}

struct AccountToolbarButton: View {
    @EnvironmentObject private var auth: AuthManager
    @Environment(\.presentSettings) private var presentSettings

    var body: some View {
        Button(action: presentSettings) {
            Group {
                if let rawURL = auth.user?.picture,
                   let url = URL(string: rawURL),
                   url.scheme == "https" {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        fallbackAvatar
                    }
                } else {
                    fallbackAvatar
                }
            }
            .frame(width: 32, height: 32)
            .clipShape(Circle())
            .overlay {
                Circle()
                    .stroke(AppVisualSystem.ColorToken.accent.opacity(0.42), lineWidth: 1)
            }
            .shadow(color: AppVisualSystem.ColorToken.accent.opacity(0.12), radius: 7)
            .contentShape(Circle())
        }
        .accessibilityLabel("Open Settings")
        .accessibilityHint("Opens account and app settings")
    }

    private var fallbackAvatar: some View {
        Image(systemName: "person.crop.circle.fill")
            .resizable()
            .scaledToFit()
            .foregroundStyle(
                LinearGradient(
                    colors: [
                        AppVisualSystem.ColorToken.accent,
                        AppVisualSystem.ColorToken.protein
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
    }
}

struct MainTabView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var integrationDataAccess: IntegrationDataAccessStore
    @StateObject private var offlineQueue = OfflineMutationStore.shared
    @StateObject private var coachDismissals = CoachDismissalStore.shared
    @StateObject private var navigation = AppNavigationModel()
    @State private var showSettings = false

    var body: some View {
        TabView(selection: $navigation.selectedDestination) {
            TodayView()
                .tag(AppDestination.today)
                .tabItem {
                    Label("Today", systemImage: "sun.max.fill")
                }

            MacrosView()
                .tag(AppDestination.macros)
                .tabItem {
                    Label("Macros", systemImage: "fork.knife")
                }

            WorkoutsView()
                .tag(AppDestination.workouts)
                .tabItem {
                    Label("Workouts", systemImage: "figure.run")
                }

            HealthHubView()
                .tag(AppDestination.health)
                .tabItem {
                    Label("Health", systemImage: "heart.text.square.fill")
                }

            AnalysisView()
                .tag(AppDestination.insights)
                .tabItem {
                    Label("Insights", systemImage: "chart.bar.fill")
                }
        }
        .environmentObject(navigation)
        .environment(\.presentSettings) {
            showSettings = true
        }
        .tint(AppVisualSystem.ColorToken.accent)
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(auth)
                .environmentObject(integrationDataAccess)
        }
        .onOpenURL { url in
            navigation.handle(url: url)
        }
        .task(id: auth.user?.id) {
            await syncCoachDismissals()
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if offlineQueue.pendingCount > 0 {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.icloud.fill")
                        .foregroundStyle(AppVisualSystem.ColorToken.success)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Saved offline")
                            .font(.subheadline.weight(.semibold))
                        Text("\(offlineQueue.pendingCount) pending for this account")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .background(AppVisualSystem.ColorToken.surfaceRaised.opacity(0.97))
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(AppVisualSystem.ColorToken.border)
                        .frame(height: 1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    "Saved offline. \(offlineQueue.pendingCount) pending for this account."
                )
            }
        }
    }

    @MainActor
    private func syncCoachDismissals() async {
        guard auth.user != nil else { return }

        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return
        }
        #endif

        do {
            let response = try await api.getCoachDismissals()
            guard !Task.isCancelled else { return }
            coachDismissals.mergeSyncedRecords(response.dismissals)

            let mergedRecords = coachDismissals.syncedRecords()
            if !mergedRecords.isEmpty {
                let synced = try await api.syncCoachDismissals(mergedRecords)
                guard !Task.isCancelled else { return }
                coachDismissals.mergeSyncedRecords(synced.dismissals)
            }

            Diagnostics.shared.record(
                category: "coach",
                message: "\(CoachBrand.name) synced dismissals",
                details: ["count": "\(mergedRecords.count)"]
            )
        } catch {
            guard !Task.isCancelled else { return }
            Diagnostics.shared.record(
                level: "warning",
                category: "coach",
                message: "\(CoachBrand.name) dismissal sync skipped",
                details: ["error": error.localizedDescription]
            )
        }
    }
}

private struct HealthHubView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var navigation: AppNavigationModel
    @AppStorage(FeaturePreferenceKeys.sexualActivityPageVisible) private var sexualActivityPageVisible = true

    private var showsSexualActivity: Bool {
        auth.user?.sexualActivityEnabled == true && sexualActivityPageVisible
    }

    private var availableAreas: [HealthArea] {
        showsSexualActivity ? [.weight, .sleep, .sexualActivity] : [.weight, .sleep]
    }

    private var visibleHealthArea: HealthArea {
        availableAreas.contains(navigation.healthArea) ? navigation.healthArea : .sleep
    }

    private var healthAreaSelection: Binding<HealthArea> {
        Binding(
            get: { visibleHealthArea },
            set: { area in
                guard availableAreas.contains(area) else { return }
                navigation.healthArea = area
            }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Health section", selection: healthAreaSelection) {
                ForEach(availableAreas, id: \.self) { area in
                    Text(area.label)
                        .tag(area)
                        .accessibilityLabel(area.accessibilityLabel)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)
            .accessibilityLabel("Health section")

            Group {
                switch visibleHealthArea {
                case .weight:
                    WeightView()
                case .sleep:
                    SleepView()
                case .sexualActivity:
                    SexualActivityView()
                }
            }
            /*
             Keep Health as one primary destination without nesting a dynamic
             page-style TabView. A conditional page can otherwise disappear
             while its tag is still selected, leaving UIKit to reconcile an
             invalid page index during an outer tab transition.
             */
            .clipped()
        }
        .appScreenBackground(accent: AppVisualSystem.ColorToken.recovery)
        .onAppear {
            keepHealthAreaVisible()
        }
        .onChange(of: showsSexualActivity) { _, _ in
            keepHealthAreaVisible()
        }
        .onChange(of: navigation.healthArea) { _, _ in
            keepHealthAreaVisible()
        }
    }

    private func keepHealthAreaVisible() {
        if !availableAreas.contains(navigation.healthArea) {
            navigation.healthArea = .sleep
        }
    }
}
