import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var api: APIClient
    @State private var subscription: SubscriptionResponse?
    @State private var version: VersionResponse?
    @State private var showDeleteConfirm = false
    @State private var isExporting = false
    @State private var errorMessage: String?
    private let buildHashDigits = 7

    var body: some View {
        NavigationStack {
            List {
                accountSection
                supportPrivacySection
                subscriptionSection
                dataSection
                buildInfoSection
                dangerSection
            }
            .navigationTitle("Settings")
            .task { await loadSettings() }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .alert("Delete Account", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) { }
                Button("Delete Everything", role: .destructive) {
                    Task { await deleteAccount() }
                }
            } message: {
                Text("This will permanently delete your account and all associated data. This cannot be undone.")
            }
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        Section("Account") {
            if let user = auth.user {
                if let name = user.name {
                    HStack {
                        Text("Name")
                        Spacer()
                        Text(name).foregroundStyle(.secondary)
                    }
                }
                if let email = user.email {
                    HStack {
                        Text("Email")
                        Spacer()
                        Text(email).foregroundStyle(.secondary)
                    }
                }
            }

            Button("Sign Out", role: .destructive) {
                auth.signOut()
            }
        }
    }

    private var supportPrivacySection: some View {
        Section("Privacy & Support") {
            VStack(alignment: .leading, spacing: 8) {
                Text("Support")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Text("Contact the person who invited you. Include any request reference shown in an error message and the build details below.")
                    .font(.subheadline)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Data")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Text("Daily Macros stores nutrition, weight, workouts, sleep, sexual activity entries, meal photos submitted for parsing, account details, and beta usage data. You can export a JSON copy of your data or permanently delete your account from this screen.")
                    .font(.subheadline)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("AI Processing")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Text("Meal text, workout text, and meal photos may be sent to OpenAI only when you ask the app to parse or analyze them.")
                    .font(.subheadline)
            }
        }
    }

    // MARK: - Subscription

    private var subscriptionSection: some View {
        Section("Subscription") {
            if let sub = subscription {
                HStack {
                    Text("Plan")
                    Spacer()
                    Text(sub.subscription.plan.capitalized)
                        .foregroundStyle(sub.subscription.plan == "pro" ? .cyan : .secondary)
                        .fontWeight(sub.subscription.plan == "pro" ? .bold : .regular)
                }

                HStack {
                    Text("Status")
                    Spacer()
                    Text(sub.subscription.status.capitalized)
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Daily Parses")
                    Spacer()
                    Text("\(sub.limits.dailyParses)")
                        .foregroundStyle(.secondary)
                }

                if sub.subscription.plan == "free" {
                    Button("Upgrade to Pro") {
                        Task { await openCheckout() }
                    }
                    .foregroundStyle(.cyan)
                } else {
                    Button("Manage Subscription") {
                        Task { await openPortal() }
                    }
                }
            } else {
                ProgressView()
            }
        }
    }

    // MARK: - Data

    private var dataSection: some View {
        Section("Data") {
            Button {
                Task { await exportData() }
            } label: {
                HStack {
                    Text("Export All Data")
                    Spacer()
                    if isExporting {
                        ProgressView()
                    } else {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
        }
    }

    private var buildInfoSection: some View {
        Section {
            HStack {
                Text("App")
                Spacer()
                Text(appBuildLabel)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            HStack {
                Text("API")
                Spacer()
                Text(apiBuildLabel)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        } header: {
            Text("Build")
        } footer: {
            Text("These details help diagnose beta issues.")
        }
    }

    // MARK: - Danger Zone

    private var dangerSection: some View {
        Section {
            Button("Delete Account", role: .destructive) {
                showDeleteConfirm = true
            }
        } header: {
            Text("Danger Zone")
        } footer: {
            Text("Permanently deletes your account and all data.")
        }
    }

    // MARK: - Actions

    private func loadSettings() async {
        await loadSubscription()
        await loadVersion()
    }

    private func loadSubscription() async {
        do {
            subscription = try await api.getSubscription()
        } catch {
            // Non-critical, just show empty state
        }
    }

    private func loadVersion() async {
        do {
            version = try await api.getVersion()
        } catch {
            // Non-critical troubleshooting metadata.
        }
    }

    private func openCheckout() async {
        do {
            let urlString = try await api.createCheckoutSession()
            if let url = URL(string: urlString) {
                await MainActor.run { UIApplication.shared.open(url) }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func openPortal() async {
        do {
            let urlString = try await api.createPortalSession()
            if let url = URL(string: urlString) {
                await MainActor.run { UIApplication.shared.open(url) }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func exportData() async {
        isExporting = true
        defer { isExporting = false }
        do {
            let data = try await api.exportData()
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("dailymacros-export.json")
            try data.write(to: tempURL)
            await MainActor.run {
                let controller = UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
                if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let root = scene.windows.first?.rootViewController {
                    root.present(controller, animated: true)
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteAccount() async {
        do {
            try await api.deleteAccount()
            auth.signOut()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var appBuildLabel: String {
        let bundleVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "AppBuild") as? String
        let hash = Bundle.main.object(forInfoDictionaryKey: "GitCommitHash") as? String
        let cleanBuild = shortBuildIdentifier(build)
        let cleanHash = shortBuildIdentifier(hash)
        return [bundleVersion, cleanBuild, cleanHash].compactMap { $0 }.joined(separator: " / ")
    }

    private var apiBuildLabel: String {
        guard let version else { return "Unavailable" }
        return [version.packageVersion, shortBuildIdentifier(version.appBuild)].compactMap { $0 }.joined(separator: " / ")
    }

    private func shortBuildIdentifier(_ value: String?) -> String? {
        guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.isEmpty == false,
              raw.contains("$(") == false
        else {
            return nil
        }

        if raw.range(of: "^[0-9a-fA-F]{8,40}$", options: .regularExpression) != nil {
            return String(raw.prefix(buildHashDigits))
        }

        return raw
    }
}
