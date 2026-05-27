import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var api: APIClient
    @AppStorage("onboarding_complete") private var onboardingComplete = true
    @AppStorage(CoachSettingKeys.enabled) private var legacyAICoachEnabled = true
    @AppStorage(CoachSettingKeys.mode) private var aiCoachModeRaw = CoachMode.localModelWithTemplates.rawValue
    @StateObject private var offlineQueue = OfflineMutationStore.shared
    @StateObject private var diagnostics = Diagnostics.shared
    @StateObject private var coachDismissals = CoachDismissalStore.shared
    @State private var subscription: SubscriptionResponse?
    @State private var version: VersionResponse?
    @State private var showDeleteConfirm = false
    @State private var isExporting = false
    @State private var isExportingDiagnostics = false
    @State private var isFlushingPending = false
    @State private var remindersEnabled = ReminderScheduler.shared.isEnabled
    @State private var reminderDate = ReminderScheduler.shared.reminderDate
    @State private var errorMessage: String?
    @State private var showAccountDetails = false

    var body: some View {
        NavigationStack {
            List {
                accountSection
                supportPrivacySection
                compassSection
                remindersSection
                subscriptionSection
                dataSection
                tutorialSection
                pendingSyncSection
                diagnosticsSection
                buildInfoSection
                dangerSection
            }
            .navigationTitle("Settings")
            .task { await loadSettings() }
            .onChange(of: reminderDate) { _, newValue in
                Task { await updateReminderTime(newValue) }
            }
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
            .sheet(isPresented: $showAccountDetails) {
                AccountDetailsView()
                    .environmentObject(auth)
                    .environmentObject(api)
            }
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        Section {
            Button {
                showAccountDetails = true
            } label: {
                HStack(spacing: 14) {
                    AccountAvatarView(user: auth.user, size: 44)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(accountDisplayName)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        Text(accountEmail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } header: {
            Text("Account")
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

            Link(destination: api.baseURL.appendingPathComponent("privacy")) {
                HStack {
                    Text("Privacy Policy")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var remindersSection: some View {
        Section("Daily Reminder") {
            Toggle("Log reminder", isOn: Binding(
                get: { remindersEnabled },
                set: { enabled in
                    remindersEnabled = enabled
                    Task { await updateReminderEnabled(enabled) }
                }
            ))
            DatePicker("Time", selection: $reminderDate, displayedComponents: .hourAndMinute)
                .disabled(!remindersEnabled)
        }
    }

    private var compassSection: some View {
        Section {
            Picker("Mode", selection: compassModeBinding) {
                ForEach(CoachMode.allCases) { mode in
                    Text(mode.label).tag(mode.rawValue)
                }
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(currentCompassMode.detail)
                    .font(.subheadline)
                    .foregroundStyle(.primary)

                Text(CoachNarrator.availabilitySummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button("Reset Dismissed Suggestions") {
                coachDismissals.resetDismissals()
                Diagnostics.shared.record(category: "coach", message: "Reset \(CoachBrand.name) dismissals")
                Task {
                    do {
                        try await api.resetSyncedCoachDismissals()
                    } catch {
                        Diagnostics.shared.record(
                            level: "warning",
                            category: "coach",
                            message: "Synced \(CoachBrand.name) dismissal reset skipped",
                            details: ["error": error.localizedDescription]
                        )
                    }
                }
            }
        } header: {
            Text(CoachBrand.name)
        } footer: {
            Text("\(CoachBrand.name) always uses local rule confidence gates first. Local AI can rank and phrase eligible cards, but it cannot invent facts or override the rule evidence.")
        }
    }

    private var currentCompassMode: CoachMode {
        CoachMode.resolved(rawValue: aiCoachModeRaw, legacyEnabled: legacyAICoachEnabled)
    }

    private var compassModeBinding: Binding<String> {
        Binding(
            get: { currentCompassMode.rawValue },
            set: { newValue in
                let mode = CoachMode(rawValue: newValue) ?? .localModelWithTemplates
                aiCoachModeRaw = mode.rawValue
                legacyAICoachEnabled = mode != .off
                Diagnostics.shared.record(
                    category: "coach",
                    message: "Set \(CoachBrand.name) mode",
                    details: ["mode": mode.rawValue]
                )
            }
        )
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

    private var tutorialSection: some View {
        Section {
            Button {
                Diagnostics.shared.record(category: "onboarding", message: "Reset setup tutorial")
                onboardingComplete = false
            } label: {
                HStack {
                    Text("Reset Setup Tutorial")
                    Spacer()
                    Image(systemName: "arrow.counterclockwise")
                }
            }
        } header: {
            Text("Setup Tutorial")
        } footer: {
            Text("Shows the first-run setup again so you can revisit goals, reminders, and starting preferences.")
        }
    }

    private var pendingSyncSection: some View {
        Section("Offline Queue") {
            HStack {
                Text("Pending Logs")
                Spacer()
                Text("\(offlineQueue.pendingCount)")
                    .foregroundStyle(.secondary)
            }

            Button {
                Task { await flushPendingLogs() }
            } label: {
                HStack {
                    Text("Sync Pending Logs")
                    Spacer()
                    if isFlushingPending {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
            }
            .disabled(offlineQueue.pendingCount == 0 || isFlushingPending)
        }
    }

    private var diagnosticsSection: some View {
        Section("Diagnostics") {
            HStack {
                Text("Recent Events")
                Spacer()
                Text("\(diagnostics.events.count)")
                    .foregroundStyle(.secondary)
            }

            Button {
                Task { await exportDiagnostics() }
            } label: {
                HStack {
                    Text("Export Diagnostics")
                    Spacer()
                    if isExportingDiagnostics {
                        ProgressView()
                    } else {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }

            Button("Clear Diagnostics", role: .destructive) {
                diagnostics.clear()
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

    private func updateReminderEnabled(_ enabled: Bool) async {
        do {
            try await ReminderScheduler.shared.setEnabled(enabled, at: reminderDate)
            remindersEnabled = ReminderScheduler.shared.isEnabled
            Diagnostics.shared.record(category: "reminder", message: enabled ? "Enabled daily reminder" : "Disabled daily reminder")
        } catch {
            remindersEnabled = ReminderScheduler.shared.isEnabled
            errorMessage = error.localizedDescription
        }
    }

    private func updateReminderTime(_ date: Date) async {
        do {
            try await ReminderScheduler.shared.updateTime(date)
            Diagnostics.shared.record(category: "reminder", message: "Updated daily reminder time")
        } catch {
            remindersEnabled = ReminderScheduler.shared.isEnabled
            errorMessage = error.localizedDescription
        }
    }

    private func flushPendingLogs() async {
        isFlushingPending = true
        defer { isFlushingPending = false }
        do {
            try await api.flushPendingMutations()
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

    private func exportDiagnostics() async {
        isExportingDiagnostics = true
        defer { isExportingDiagnostics = false }
        do {
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("dailymacros-diagnostics.txt")
            try diagnostics.exportText().write(to: tempURL, atomically: true, encoding: .utf8)
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
        SettingsBuildLabel.appBuildLabel
    }

    private var apiBuildLabel: String {
        guard let version else { return "Unavailable" }
        return [version.packageVersion, shortBuildIdentifier(version.appBuild)].compactMap { $0 }.joined(separator: " / ")
    }

    private func shortBuildIdentifier(_ value: String?) -> String? {
        SettingsBuildLabel.shortIdentifier(value)
    }

    private var accountDisplayName: String {
        SettingsAccountText.displayName(for: auth.user)
    }

    private var accountEmail: String {
        SettingsAccountText.email(for: auth.user)
    }
}

private struct AccountDetailsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var api: APIClient
    @StateObject private var offlineQueue = OfflineMutationStore.shared
    @State private var isFlushingPending = false
    @State private var isExporting = false
    @State private var isSigningOutEverywhere = false
    @State private var showSignOutEverywhereConfirm = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    profileCard

                    groupedSection(title: "Sync") {
                        syncStatusRow
                        accountDivider
                        syncNowButton
                    }

                    groupedSection(title: "Data") {
                        exportDataRow
                    }

                    signOutCard

                    Text(SettingsBuildLabel.accountVersionLabel)
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 22)
                }
                .padding(.horizontal, 24)
                .padding(.top, 32)
                .padding(.bottom, 40)
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .font(.headline.weight(.medium))
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 9)
                    .background(.regularMaterial, in: Capsule())
                }
            }
            .alert("Sign Out Everywhere?", isPresented: $showSignOutEverywhereConfirm) {
                Button("Cancel", role: .cancel) { }
                Button("Sign Out", role: .destructive) {
                    Task { await signOutEverywhere() }
                }
            } message: {
                Text("This revokes DailyMacros API tokens on every device and signs you out here.")
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private var profileCard: some View {
        HStack(spacing: 16) {
            AccountAvatarView(user: auth.user, size: 64)

            VStack(alignment: .leading, spacing: 4) {
                Text(SettingsAccountText.displayName(for: auth.user))
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Text(SettingsAccountText.email(for: auth.user))
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var syncStatusRow: some View {
        HStack(spacing: 14) {
            Text("Status")
                .font(.body)
                .foregroundStyle(.primary)

            Spacer()

            Image(systemName: syncStatusIcon)
                .font(.title3.weight(.semibold))
                .foregroundStyle(syncStatusColor)

            Text(syncStatusText)
                .font(.body.weight(.medium))
                .foregroundStyle(syncStatusColor)
                .lineLimit(1)
        }
        .padding(.horizontal, 24)
        .frame(minHeight: 58)
    }

    private var syncNowButton: some View {
        Button {
            Task { await flushPendingLogs() }
        } label: {
            HStack(spacing: 10) {
                Spacer()

                if isFlushingPending {
                    ProgressView()
                }

                Text("Sync Now")
                    .font(.body.weight(.medium))

                Spacer()
            }
            .frame(minHeight: 58)
        }
        .foregroundStyle(.cyan)
        .disabled(isFlushingPending || api.token == nil)
    }

    private var exportDataRow: some View {
        Button {
            Task { await exportData() }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "square.and.arrow.up")
                    .font(.title3)
                    .foregroundStyle(.cyan)
                    .frame(width: 28)

                Text("Export All Data")
                    .font(.body)
                    .foregroundStyle(.primary)

                Spacer()

                if isExporting {
                    ProgressView()
                } else {
                    Image(systemName: "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 20)
            .frame(minHeight: 58)
        }
        .buttonStyle(.plain)
        .disabled(isExporting)
    }

    private var signOutCard: some View {
        VStack(spacing: 0) {
            Button {
                showSignOutEverywhereConfirm = true
            } label: {
                HStack(spacing: 10) {
                    Spacer()

                    if isSigningOutEverywhere {
                        ProgressView()
                    }

                    Text("Sign Out Everywhere")
                        .font(.body.weight(.medium))

                    Spacer()
                }
                .frame(minHeight: 58)
            }
            .foregroundStyle(.red)
            .disabled(isSigningOutEverywhere)

            accountDivider

            Button(role: .destructive) {
                auth.signOut()
                dismiss()
            } label: {
                Text("Sign Out")
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 58)
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var accountDivider: some View {
        Divider()
            .padding(.leading, 24)
            .padding(.trailing, 24)
    }

    private func groupedSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 24)

            VStack(spacing: 0) {
                content()
            }
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }

    private func flushPendingLogs() async {
        isFlushingPending = true
        defer { isFlushingPending = false }
        do {
            try await api.flushPendingMutations()
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

    private func signOutEverywhere() async {
        isSigningOutEverywhere = true
        defer { isSigningOutEverywhere = false }
        do {
            try await auth.signOutEverywhere()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var syncStatusText: String {
        guard api.token != nil, auth.isAuthenticated else { return "Disconnected" }
        if offlineQueue.pendingCount > 0 {
            return "\(offlineQueue.pendingCount) Pending"
        }
        return "Connected"
    }

    private var syncStatusIcon: String {
        guard api.token != nil, auth.isAuthenticated else { return "xmark.circle.fill" }
        return offlineQueue.pendingCount > 0 ? "exclamationmark.circle.fill" : "checkmark.circle.fill"
    }

    private var syncStatusColor: Color {
        guard api.token != nil, auth.isAuthenticated else { return .red }
        return offlineQueue.pendingCount > 0 ? .orange : .green
    }
}

private struct AccountAvatarView: View {
    let user: User?
    let size: CGFloat

    var body: some View {
        Group {
            if let pictureURL {
                AsyncImage(url: pictureURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        initialsAvatar
                    }
                }
            } else {
                initialsAvatar
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initialsAvatar: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color.cyan.opacity(0.75), Color.blue.opacity(0.65)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            Text(initials)
                .font(.system(size: max(size * 0.34, 13), weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
        }
    }

    private var pictureURL: URL? {
        guard let raw = user?.picture?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.isEmpty == false
        else {
            return nil
        }
        return URL(string: raw)
    }

    private var initials: String {
        let source = user?.name?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? user?.name : user?.email
        let parts = (source ?? "DM")
            .split { $0.isWhitespace || $0 == "@" || $0 == "." }
            .prefix(2)
        let letters = parts.compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "DM" : letters.uppercased()
    }
}

private enum SettingsAccountText {
    static func displayName(for user: User?) -> String {
        clean(user?.name) ?? "DailyMacros Account"
    }

    static func email(for user: User?) -> String {
        clean(user?.email) ?? clean(user?.provider).map { "\($0.capitalized) sign-in" } ?? "Signed in"
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              trimmed.isEmpty == false
        else {
            return nil
        }
        return trimmed
    }
}

private enum SettingsBuildLabel {
    private static let buildHashDigits = 7

    static var appBuildLabel: String {
        let bundleVersion = clean(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
        let build = shortIdentifier(Bundle.main.object(forInfoDictionaryKey: "AppBuild") as? String)
        let hash = shortIdentifier(Bundle.main.object(forInfoDictionaryKey: "GitCommitHash") as? String)
        return [bundleVersion, build, hash].compactMap { $0 }.joined(separator: " / ")
    }

    static var accountVersionLabel: String {
        let bundleVersion = clean(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
        let build = shortIdentifier(Bundle.main.object(forInfoDictionaryKey: "AppBuild") as? String)
        let hash = shortIdentifier(Bundle.main.object(forInfoDictionaryKey: "GitCommitHash") as? String)

        let base: String
        if let bundleVersion, let build {
            base = "Version \(bundleVersion) (\(build))"
        } else if let bundleVersion {
            base = "Version \(bundleVersion)"
        } else if let build {
            base = "Build \(build)"
        } else {
            base = "Version unavailable"
        }

        if let hash {
            return "\(base) - \(hash)"
        }
        return base
    }

    static func shortIdentifier(_ value: String?) -> String? {
        guard let raw = clean(value),
              raw.contains("$(") == false
        else {
            return nil
        }

        if raw.range(of: "^[0-9a-fA-F]{8,40}$", options: .regularExpression) != nil {
            return String(raw.prefix(buildHashDigits))
        }

        return raw
    }

    private static func clean(_ value: String?) -> String? {
        guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.isEmpty == false,
              raw.contains("$(") == false
        else {
            return nil
        }
        return raw
    }
}
