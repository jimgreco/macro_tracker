import SwiftUI

enum FeaturePreferenceKeys {
    static let sexualActivityPageVisible = "sexual_activity_page_visible"
}

struct MainTabView: View {
    @EnvironmentObject var auth: AuthManager
    @AppStorage(FeaturePreferenceKeys.sexualActivityPageVisible) private var sexualActivityPageVisible = true
    @StateObject private var offlineQueue = OfflineMutationStore.shared

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
        .safeAreaInset(edge: .top, spacing: 0) {
            if offlineQueue.pendingCount > 0 {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.icloud.fill")
                        .foregroundStyle(.green)
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
                .background(.ultraThinMaterial)
                .overlay(alignment: .bottom) {
                    Divider()
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    "Saved offline. \(offlineQueue.pendingCount) pending for this account."
                )
            }
        }
    }
}
