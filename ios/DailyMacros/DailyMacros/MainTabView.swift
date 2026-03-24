import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        TabView {
            MacrosView()
                .tabItem {
                    Label("Macros", systemImage: "fork.knife")
                }

            WeightView()
                .tabItem {
                    Label("Weight", systemImage: "scalemass")
                }

            WorkoutsView()
                .tabItem {
                    Label("Workouts", systemImage: "figure.run")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .tint(.cyan)
    }
}
