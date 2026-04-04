import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        TabView {
            MacrosView()
                .tabItem {
                    Label("Macros", systemImage: "fork.knife")
                }

            WorkoutsView()
                .tabItem {
                    Label("Workouts", systemImage: "figure.run")
                }

            WeightView()
                .tabItem {
                    Label("Weight", systemImage: "scalemass")
                }

            HealthView()
                .tabItem {
                    Label("Health", systemImage: "heart.fill")
                }

            AnalysisView()
                .tabItem {
                    Label("Analysis", systemImage: "chart.bar")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .tint(.cyan)
    }
}
