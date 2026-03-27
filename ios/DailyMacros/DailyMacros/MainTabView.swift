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
