import SwiftUI

@main
struct DailyMacrosApp: App {
    @StateObject private var auth = AuthManager()
    @StateObject private var api = APIClient.shared

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
                } else {
                    LoginView()
                        .environmentObject(auth)
                }
            }
            .preferredColorScheme(.dark)
        }
    }
}
