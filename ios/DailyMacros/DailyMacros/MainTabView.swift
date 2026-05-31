import SwiftUI

enum FeaturePreferenceKeys {
    static let sexualActivityPageVisible = "sexual_activity_page_visible"
}

struct MainTabView: View {
    @EnvironmentObject var auth: AuthManager
    @AppStorage(FeaturePreferenceKeys.sexualActivityPageVisible) private var sexualActivityPageVisible = true

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

            SleepView()
                .tabItem {
                    Label("Sleep", systemImage: "moon.zzz.fill")
                }

            if auth.user?.sexualActivityEnabled == true && sexualActivityPageVisible {
                SexualActivityView()
                    .tabItem {
                        Label("Sexual Activity", systemImage: "heart.fill")
                    }
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
