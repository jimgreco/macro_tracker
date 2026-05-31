import SwiftUI

@main
struct DailyMacrosApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("onboarding_complete") private var onboardingComplete = false
    @AppStorage("last_setup_tutorial_reset_at") private var lastSetupTutorialResetAt = ""
    @AppStorage(FeaturePreferenceKeys.sexualActivityPageVisible) private var sexualActivityPageVisible = true
    @StateObject private var auth = AuthManager()
    @StateObject private var api = APIClient.shared
    @StateObject private var healthKitAutoSync = HealthKitAutoSync()

    private var autoSyncKey: String {
        "\(auth.isAuthenticated)-\(shouldIncludeSexualActivity)"
    }

    private var shouldIncludeSexualActivity: Bool {
        auth.user?.sexualActivityEnabled == true && sexualActivityPageVisible
    }

    private var shouldShowOnboarding: Bool {
        #if DEBUG
        if auth.isLocalDevUser {
            return false
        }
        #endif
        return !onboardingComplete
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isLoading {
                    ProgressView("Loading...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.systemBackground))
                } else if auth.isAuthenticated, shouldShowOnboarding {
                    OnboardingView(isComplete: $onboardingComplete)
                        .environmentObject(auth)
                        .environmentObject(api)
                        .task {
                            Diagnostics.shared.record(category: "app", message: "Showing onboarding")
                        }
                } else if auth.isAuthenticated {
                    MainTabView()
                        .environmentObject(auth)
                        .environmentObject(api)
                        .task(id: autoSyncKey) {
                            await healthKitAutoSync.start(
                                api: api,
                                includeSexualActivity: shouldIncludeSexualActivity
                            )
                        }
                } else {
                    LoginView()
                        .environmentObject(auth)
                }
            }
            .preferredColorScheme(.dark)
            .onChange(of: auth.isAuthenticated) { _, isAuthenticated in
                if !isAuthenticated {
                    healthKitAutoSync.stop()
                } else {
                    completeLocalDevOnboardingIfNeeded()
                    Diagnostics.shared.record(category: "auth", message: "Authenticated")
                    applySetupTutorialReset(auth.user?.setupTutorialResetAt)
                    Task { try? await api.flushPendingMutations() }
                }
            }
            .onChange(of: auth.user?.provider) { _, _ in
                completeLocalDevOnboardingIfNeeded()
            }
            .onChange(of: auth.user?.setupTutorialResetAt) { _, resetAt in
                applySetupTutorialReset(resetAt)
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, auth.isAuthenticated else { return }
                Task {
                    await auth.refreshUser()
                    await MainActor.run {
                        applySetupTutorialReset(auth.user?.setupTutorialResetAt)
                    }
                    try? await api.flushPendingMutations()
                    await healthKitAutoSync.start(
                        api: api,
                        includeSexualActivity: shouldIncludeSexualActivity
                    )
                }
            }
        }
    }

    private func completeLocalDevOnboardingIfNeeded() {
        #if DEBUG
        guard auth.isLocalDevUser, !onboardingComplete else { return }
        onboardingComplete = true
        Diagnostics.shared.record(category: "onboarding", message: "Skipped setup for local dev user")
        #endif
    }

    private func applySetupTutorialReset(_ resetAt: String?) {
        let marker = resetAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !marker.isEmpty, marker != lastSetupTutorialResetAt else { return }
        lastSetupTutorialResetAt = marker
        onboardingComplete = false
        Diagnostics.shared.record(category: "onboarding", message: "Applied admin setup tutorial reset")
    }
}
