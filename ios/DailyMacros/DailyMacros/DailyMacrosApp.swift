import SwiftUI

@main
struct DailyMacrosApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var auth = AuthManager()
    @StateObject private var api = APIClient.shared
    @StateObject private var healthKitAutoSync = HealthKitAutoSync()

    private var autoSyncKey: String {
        "\(auth.isAuthenticated)-\(auth.user?.sexualActivityEnabled == true)"
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isLoading {
                    ProgressView("Loading...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.systemBackground))
                } else if auth.isAuthenticated {
                    MainTabView()
                        .environmentObject(auth)
                        .environmentObject(api)
                        .task(id: autoSyncKey) {
                            await healthKitAutoSync.start(
                                api: api,
                                includeSexualActivity: auth.user?.sexualActivityEnabled == true
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
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, auth.isAuthenticated else { return }
                Task {
                    await healthKitAutoSync.start(
                        api: api,
                        includeSexualActivity: auth.user?.sexualActivityEnabled == true
                    )
                }
            }
        }
    }
}
