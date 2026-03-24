import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var api: APIClient
    @State private var subscription: SubscriptionResponse?
    @State private var showDeleteConfirm = false
    @State private var isExporting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                accountSection
                subscriptionSection
                dataSection
                dangerSection
            }
            .navigationTitle("Settings")
            .task { await loadSubscription() }
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

    private func loadSubscription() async {
        do {
            subscription = try await api.getSubscription()
        } catch {
            // Non-critical, just show empty state
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
}
