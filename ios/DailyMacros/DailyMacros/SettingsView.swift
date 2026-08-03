import SwiftUI
import AuthenticationServices

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var auth: AuthManager
    @EnvironmentObject var api: APIClient
    @EnvironmentObject private var integrationDataAccess: IntegrationDataAccessStore
    @AppStorage("onboarding_complete") private var onboardingComplete = true
    @AppStorage(CoachSettingKeys.enabled) private var legacyAICoachEnabled = true
    @AppStorage(CoachSettingKeys.mode) private var aiCoachModeRaw = CoachMode.localModelWithTemplates.rawValue
    @AppStorage(CoachSettingKeys.disabledCategories) private var disabledCompassCategoriesRaw = "[]"
    @AppStorage(FeaturePreferenceKeys.sexualActivityPageVisible) private var sexualActivityPageVisible = true
    @StateObject private var offlineQueue = OfflineMutationStore.shared
    @StateObject private var diagnostics = Diagnostics.shared
    @StateObject private var coachDismissals = CoachDismissalStore.shared
    @State private var subscription: SubscriptionResponse?
    @State private var version: VersionResponse?
    @State private var showDeleteConfirm = false
    @State private var isExporting = false
    @State private var isExportingDiagnostics = false
    @State private var isFlushingPending = false
    @State private var isAddingStarterQuickAdds = false
    @State private var isSavingTimezone = false
    @State private var isSavingOptionalDiagnostics = false
    @State private var selectedTimezone = SettingsTimezoneOptions.deviceTimezone
    @State private var optionalDiagnosticsEnabled = true
    @State private var remindersEnabled = ReminderScheduler.shared.isEnabled
    @State private var reminderDate = ReminderScheduler.shared.reminderDate
    @State private var errorMessage: String?
    @State private var settingsMessage: String?
    @State private var showAccountDetails = false
    @State private var ouraStatus: OuraStatusResponse?
    @State private var isLoadingOura = false
    @State private var ouraAuthenticationSession: ASWebAuthenticationSession?
    @State private var showOuraDisconnectConfirm = false
    @State private var showOuraDataAccess = false

    var body: some View {
        NavigationStack {
            List {
                accountSection
                supportPrivacySection
                dataSourcesSection
                ouraSection
                preferencesSection
                if auth.user?.sexualActivityEnabled == true {
                    sexualActivitySection
                }
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
            .scrollContentBackground(.hidden)
            .appScreenBackground()
            .tint(AppVisualSystem.ColorToken.accent)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .task {
                selectedTimezone = currentAccountTimezone
                optionalDiagnosticsEnabled = auth.user?.optionalDiagnosticsEnabled != false
                await loadSettings()
            }
            .onChange(of: auth.user?.timezone) { _, _ in
                selectedTimezone = currentAccountTimezone
            }
            .onChange(of: auth.user?.optionalDiagnosticsEnabled) { _, newValue in
                optionalDiagnosticsEnabled = newValue != false
            }
            .onChange(of: reminderDate) { _, newValue in
                Task { await updateReminderTime(newValue) }
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .alert("Settings", isPresented: Binding(get: { settingsMessage != nil }, set: { if !$0 { settingsMessage = nil } })) {
                Button("OK") { settingsMessage = nil }
            } message: {
                Text(settingsMessage ?? "")
            }
            .alert("Delete Account", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) { }
                Button("Delete Everything", role: .destructive) {
                    Task { await deleteAccount() }
                }
            } message: {
                Text("This permanently deletes your account, server data, and any protected pending work on this device. This cannot be undone.")
            }
            .alert("Disconnect Oura", isPresented: $showOuraDisconnectConfirm) {
                Button("Cancel", role: .cancel) { }
                Button("Disconnect & Delete Data", role: .destructive) {
                    Task { await disconnectOura() }
                }
            } message: {
                Text("This revokes macrovana access and permanently deletes imported Oura data from macrovana.")
            }
            .sheet(isPresented: $showAccountDetails) {
                AccountDetailsView()
                    .environmentObject(auth)
                    .environmentObject(api)
            }
            .fullScreenCover(isPresented: $showOuraDataAccess) {
                NavigationStack {
                    IntegrationDataAccessView(sourceID: "oura", isRequired: true)
                }
                .environmentObject(api)
            }
            .onChange(of: ouraNeedsDataAccess) { _, needsAccess in
                if !needsAccess {
                    showOuraDataAccess = false
                    integrationDataAccess.endPresentation(for: "oura")
                }
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
                Text("macrovana stores nutrition, weight, workouts, sleep, optional Oura aggregate metrics, sexual activity entries, meal photos submitted for parsing, account details, and beta usage data. Optional browser diagnostics use a strict metadata allowlist and are retained for 30 days. You can stop future optional uploads, export a JSON copy of your data, or permanently delete your account from this screen.")
                    .font(.subheadline)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("AI Processing")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Text(aiProcessingCopy)
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

    private var ouraSection: some View {
        Section {
            if let status = ouraStatus {
                HStack {
                    Text("Connection")
                    Spacer()
                    Text(ouraConnectionLabel(status))
                        .foregroundStyle(ouraConnectionColor(status))
                }

                if let lastSyncedAt = status.lastSyncedAt {
                    HStack {
                        Text("Last Data Sync")
                        Spacer()
                        Text(formatOuraTimestamp(lastSyncedAt))
                            .foregroundStyle(.secondary)
                    }
                }

                if let lastWebhookAt = status.lastWebhookAt {
                    HStack {
                        Text("Last Oura Update")
                        Spacer()
                        Text(formatOuraTimestamp(lastWebhookAt))
                            .foregroundStyle(.secondary)
                    }
                }

                if let lastError = status.lastError, !lastError.isEmpty {
                    Text(lastError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                if !status.configured {
                    Text("The Oura integration still needs server credentials before it can be connected.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else if !status.connected {
                    Button("Connect Oura") {
                        Task { await connectOura() }
                    }
                    .disabled(isLoadingOura)
                } else {
                    if status.state == "reauthorization_required" || status.state == "error" {
                        Button("Reconnect Oura") {
                            Task { await connectOura() }
                        }
                        .disabled(isLoadingOura)
                    }

                    if ouraNeedsDataAccess {
                        Button("Choose Oura Data Access") {
                            presentOuraDataAccess()
                        }
                        .disabled(isLoadingOura)
                    }

                    Button {
                        Task { await syncOura() }
                    } label: {
                        HStack {
                            Text("Sync Now")
                            Spacer()
                            if isLoadingOura {
                                ProgressView()
                            } else {
                                Image(systemName: "arrow.triangle.2.circlepath")
                            }
                        }
                    }
                    .disabled(isLoadingOura || !ouraAccessConfigured)

                    Button("Disconnect & Delete Oura Data", role: .destructive) {
                        showOuraDisconnectConfirm = true
                    }
                    .disabled(isLoadingOura)
                }
            } else if isLoadingOura {
                ProgressView()
            } else {
                Button("Load Oura Status") {
                    Task { await loadOuraStatus(showErrors: true) }
                }
            }
        } header: {
            Text("Oura Ring")
        } footer: {
            if ouraStatus?.connected != true {
                Text("After connecting, macrovana will ask which Oura data types it may read. Oura does not support writing these records. Oura API data is never provided to AI models. The personal scope is used only for Oura's opaque routing ID; other profile fields are discarded.")
            } else if ouraStatus?.updateMode == "webhook" {
                Text("For data types you allow macrovana to read, new cloud data should arrive about 30 seconds after your ring syncs to Oura. Imported records remain until you disconnect Oura or delete your account and may be combined with your app history for deterministic trends and coaching, never AI-model input.")
            } else {
                Text("For data types you allow macrovana to read, scheduled reconciliation is used while signed webhook delivery is unavailable. Raw sample arrays are not stored; imported records remain until you disconnect Oura or delete your account and are never AI-model input.")
            }
        }
    }

    private var dataSourcesSection: some View {
        Section {
            if integrationDataAccess.sources.isEmpty {
                switch integrationDataAccess.loadState {
                case .idle, .loading:
                    HStack {
                        Text("Loading Data Sources")
                        Spacer()
                        ProgressView()
                    }
                case .failed(let message):
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Data access is unavailable", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Retry") {
                            Task { await refreshIntegrationDataAccess() }
                        }
                    }
                case .loaded:
                    Text("No data sources are available for this account.")
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(integrationDataAccess.sources) { source in
                    NavigationLink {
                        IntegrationDataAccessView(sourceID: source.id, isRequired: false)
                    } label: {
                        IntegrationDataSourceRow(source: source)
                    }
                }
            }
        } header: {
            Text("Data Sources")
        } footer: {
            Text("Choose what macrovana may read from or write to each connected source. Provider and device limitations are shown for each data type.")
        }
    }

    private func ouraConnectionLabel(_ status: OuraStatusResponse) -> String {
        if !status.configured { return "Not Configured" }
        if !status.connected { return "Not Connected" }
        switch status.state {
        case "syncing": return "Syncing"
        case "permissions_required": return "Data Choices Required"
        case "reauthorization_required": return "Reconnect Required"
        case "error": return "Needs Attention"
        default: return "Connected"
        }
    }

    private func ouraConnectionColor(_ status: OuraStatusResponse) -> Color {
        switch status.state {
        case "connected": return .green
        case "syncing": return .cyan
        case "permissions_required": return .orange
        case "error", "reauthorization_required": return .red
        default: return .secondary
        }
    }

    private func formatOuraTimestamp(_ value: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private var preferencesSection: some View {
        Section {
            Toggle("Share Optional Diagnostics", isOn: $optionalDiagnosticsEnabled)
                .disabled(isSavingOptionalDiagnostics)
                .onChange(of: optionalDiagnosticsEnabled) { oldValue, newValue in
                    guard oldValue != newValue,
                          newValue != (auth.user?.optionalDiagnosticsEnabled != false) else { return }
                    Task { await saveOptionalDiagnostics(enabled: newValue, fallback: oldValue) }
                }

            Picker("Timezone", selection: $selectedTimezone) {
                ForEach(timezoneOptions, id: \.self) { timezone in
                    Text(timezone).tag(timezone)
                }
            }
            .pickerStyle(.menu)

            Button {
                selectedTimezone = SettingsTimezoneOptions.deviceTimezone
            } label: {
                HStack {
                    Text("Use Current Timezone")
                    Spacer()
                    Text(SettingsTimezoneOptions.deviceTimezone)
                        .foregroundStyle(.secondary)
                }
            }

            Button {
                Task { await saveTimezone() }
            } label: {
                HStack {
                    Text("Save Timezone")
                    Spacer()
                    if isSavingTimezone {
                        ProgressView()
                    } else {
                        Image(systemName: "checkmark.circle")
                    }
                }
            }
            .disabled(isSavingTimezone || selectedTimezone == currentAccountTimezone)
        } header: {
            Text("Preferences")
        } footer: {
            Text("Optional diagnostics contain generic browser error metadata only. They exclude bodies, meal or health values, tokens, URLs, stacks, and full user agents. Essential security records stay enabled. iOS diagnostics remain on this device until you export them.")
        }
    }

    private var currentAccountTimezone: String {
        SettingsTimezoneOptions.normalized(auth.user?.timezone)
    }

    private var timezoneOptions: [String] {
        SettingsTimezoneOptions.options(
            selected: selectedTimezone,
            saved: currentAccountTimezone,
            device: SettingsTimezoneOptions.deviceTimezone
        )
    }

    private func saveTimezone() async {
        let timezone = SettingsTimezoneOptions.normalized(selectedTimezone)
        guard timezone != currentAccountTimezone else { return }

        isSavingTimezone = true
        defer { isSavingTimezone = false }

        do {
            if let user = try await api.updateAccountPreferences(timezone: timezone) {
                auth.user = user
            } else {
                await auth.refreshUser()
            }
            selectedTimezone = timezone
            Diagnostics.shared.record(
                category: "settings",
                message: "Updated timezone",
                details: ["timezone": timezone]
            )
            settingsMessage = "Timezone saved."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveOptionalDiagnostics(enabled: Bool, fallback: Bool) async {
        isSavingOptionalDiagnostics = true
        defer { isSavingOptionalDiagnostics = false }

        do {
            if let user = try await api.updateAccountPreferences(
                optionalDiagnosticsEnabled: enabled
            ) {
                auth.user = user
            } else {
                await auth.refreshUser()
            }
            settingsMessage = enabled
                ? "Optional diagnostics enabled."
                : "Optional diagnostics disabled."
        } catch {
            optionalDiagnosticsEnabled = fallback
            errorMessage = error.localizedDescription
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

    private var sexualActivitySection: some View {
        Section {
            Toggle("Show page", isOn: $sexualActivityPageVisible)
        } header: {
            Text("Sexual Activity")
        } footer: {
            Text("Shows or hides the Sexual Activity tab on this device.")
        }
    }

    private var compassSection: some View {
        Section {
            if canViewCoachSourceDetails {
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
            } else {
                Toggle("Show cards", isOn: compassEnabledBinding)

                Text("Choose whether \(CoachBrand.name) cards appear in the app.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(CoachCategoryPreference.allCases) { preference in
                Toggle(preference.label, isOn: compassCategoryBinding(for: preference))
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
            Text(coachSettingsFooterCopy)
        }
    }

    private var currentCompassMode: CoachMode {
        CoachMode.effective(
            rawValue: aiCoachModeRaw,
            legacyEnabled: legacyAICoachEnabled,
            isAdmin: canViewCoachSourceDetails
        )
    }

    private var disabledCompassCategoryIDs: Set<String> {
        CoachCategoryPreference.disabledIDs(from: disabledCompassCategoriesRaw)
    }

    private func compassCategoryBinding(for preference: CoachCategoryPreference) -> Binding<Bool> {
        Binding(
            get: { !disabledCompassCategoryIDs.contains(preference.rawValue) },
            set: { enabled in
                setCompassCategory(preference, enabled: enabled)
            }
        )
    }

    private func setCompassCategory(_ preference: CoachCategoryPreference, enabled: Bool) {
        var disabledIDs = disabledCompassCategoryIDs
        if enabled {
            disabledIDs.remove(preference.rawValue)
        } else {
            disabledIDs.insert(preference.rawValue)
        }
        disabledCompassCategoriesRaw = CoachCategoryPreference.encoded(disabledIDs)
        Diagnostics.shared.record(
            category: "coach",
            message: "Set \(CoachBrand.name) category",
            details: ["category": preference.rawValue, "enabled": "\(enabled)"]
        )
    }

    private var canViewCoachSourceDetails: Bool {
        auth.user?.isAdmin == true
    }

    private var aiProcessingCopy: String {
        if canViewCoachSourceDetails {
            return "Meal text, workout text, and meal photos may be sent to OpenAI only when you ask the app to parse or analyze them. \(CoachBrand.name) uses local rule gates and, when available, the on-device Apple model to rank or phrase eligible cards."
        }
        return "Meal text, workout text, and meal photos may be sent to OpenAI only when you ask the app to parse or analyze them. \(CoachBrand.name) suggestions are generated from your app data for routine coaching, not sent to OpenAI."
    }

    private var coachSettingsFooterCopy: String {
        if canViewCoachSourceDetails {
            return "\(CoachBrand.name) always uses local rule confidence gates first. Local AI can rank and phrase eligible cards, but it cannot invent facts or override the rule evidence."
        }
        return "Choose which types of \(CoachBrand.name) cards can appear. You can reset dismissed suggestions at any time."
    }

    private var compassEnabledBinding: Binding<Bool> {
        Binding(
            get: { currentCompassMode != .off },
            set: { enabled in
                let mode: CoachMode = enabled ? .localModelWithTemplates : .off
                aiCoachModeRaw = mode.rawValue
                legacyAICoachEnabled = enabled
                Diagnostics.shared.record(
                    category: "coach",
                    message: "Set \(CoachBrand.name) visibility",
                    details: ["enabled": "\(enabled)"]
                )
            }
        )
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

            Button {
                Task { await addStarterQuickAdds() }
            } label: {
                HStack {
                    Text("Add Starter Quick Adds")
                    Spacer()
                    if isAddingStarterQuickAdds {
                        ProgressView()
                    } else {
                        Image(systemName: "plus.circle")
                    }
                }
            }
            .disabled(isAddingStarterQuickAdds)
        } header: {
            Text("Setup Tutorial")
        } footer: {
            Text("Shows the first-run setup again so you can revisit goals, reminders, and starting preferences. Starter Quick Adds create a small reusable food set if they are not already present.")
        }
    }

    private func addStarterQuickAdds() async {
        isAddingStarterQuickAdds = true
        defer { isAddingStarterQuickAdds = false }

        do {
            let response = try await api.addStarterQuickAdds()
            Diagnostics.shared.record(
                category: "settings",
                message: "Added starter quick adds",
                details: ["addedCount": "\(response.addedCount)"]
            )
            settingsMessage = response.addedCount > 0
                ? "Added \(response.addedCount) starter Quick Add\(response.addedCount == 1 ? "" : "s")."
                : "Starter Quick Adds already exist."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var pendingSyncSection: some View {
        Section("Offline Queue") {
            HStack {
                Text("Pending for This Account")
                Spacer()
                Text("\(offlineQueue.pendingCount)")
                    .foregroundStyle(.secondary)
            }

            Button {
                Task { await flushPendingLogs() }
            } label: {
                HStack {
                    Text("Sync Pending Work")
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
        await integrationDataAccess.loadIfNeeded(
            api: api,
            userID: auth.user?.id ?? ""
        )
        await loadSubscription()
        await loadVersion()
        await loadOuraStatus()
    }

    private func loadOuraStatus(showErrors: Bool = false) async {
        isLoadingOura = true
        defer { isLoadingOura = false }
        do {
            ouraStatus = try await api.getOuraStatus()
        } catch {
            if showErrors {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func connectOura() async {
        isLoadingOura = true
        defer { isLoadingOura = false }

        do {
            let authorizationURL = try await api.createOuraAuthorization(returnTo: "ios")
            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let session = ASWebAuthenticationSession(
                    url: authorizationURL,
                    callbackURLScheme: "dailymacros"
                ) { callbackURL, error in
                    self.ouraAuthenticationSession = nil
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let callbackURL {
                        continuation.resume(returning: callbackURL)
                    } else {
                        continuation.resume(throwing: APIError.serverError("Oura connection failed."))
                    }
                }
                session.prefersEphemeralWebBrowserSession = false
                session.presentationContextProvider = OuraAuthenticationContextProvider.shared
                self.ouraAuthenticationSession = session
                if !session.start() {
                    self.ouraAuthenticationSession = nil
                    continuation.resume(throwing: APIError.serverError("Unable to open Oura authorization."))
                }
            }

            let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)
            let result = components?.queryItems?.first(where: { $0.name == "oura" })?.value
            if result == "error" {
                let message = components?.queryItems?.first(where: { $0.name == "message" })?.value
                let readableMessage = message?.replacingOccurrences(of: "+", with: " ")
                throw APIError.serverError(readableMessage ?? "Oura connection failed.")
            }

            await loadOuraStatus()
            integrationDataAccess.beginPresentation(for: "oura")
            await integrationDataAccess.refresh(
                api: api,
                userID: auth.user?.id ?? "",
                prioritizing: "oura"
            )
            if ouraNeedsDataAccess {
                showOuraDataAccess = true
            } else {
                integrationDataAccess.endPresentation(for: "oura")
                if let accessError = integrationDataAccess.errorMessage {
                    throw APIError.serverError(accessError)
                }
                settingsMessage = "Oura connected."
            }
            Diagnostics.shared.record(category: "oura", message: "Connected Oura")
        } catch {
            if (error as NSError).domain == "com.apple.AuthenticationServices.WebAuthenticationSession",
               (error as NSError).code == 1 {
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    private func syncOura() async {
        guard ouraAccessConfigured else {
            errorMessage = "Choose Oura data access before syncing."
            return
        }
        isLoadingOura = true
        defer { isLoadingOura = false }
        do {
            _ = try await api.syncOura(days: 14)
            ouraStatus = try await api.getOuraStatus()
            settingsMessage = "Oura data synced."
            Diagnostics.shared.record(category: "oura", message: "Synced Oura data")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func disconnectOura() async {
        isLoadingOura = true
        defer { isLoadingOura = false }
        do {
            try await api.disconnectOura()
            ouraStatus = try await api.getOuraStatus()
            await refreshIntegrationDataAccess()
            settingsMessage = "Oura disconnected and imported data deleted."
            Diagnostics.shared.record(category: "oura", message: "Disconnected Oura and deleted imported data")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshIntegrationDataAccess() async {
        await integrationDataAccess.refresh(
            api: api,
            userID: auth.user?.id ?? ""
        )
    }

    private var ouraNeedsDataAccess: Bool {
        integrationDataAccess.source(id: "oura")?.needsAccessConfiguration == true
    }

    private var ouraAccessConfigured: Bool {
        guard let source = integrationDataAccess.source(id: "oura") else { return false }
        return source.connected && !source.needsAccessConfiguration
    }

    private func presentOuraDataAccess() {
        guard integrationDataAccess.source(id: "oura") != nil else {
            Task { await refreshIntegrationDataAccess() }
            return
        }
        integrationDataAccess.beginPresentation(for: "oura")
        showOuraDataAccess = true
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
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("macrovana-export.json")
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
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("macrovana-diagnostics.txt")
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
    @State private var authSessions: [AuthSession] = []
    @State private var isLoadingAuthSessions = false
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

                    groupedSection(title: "Signed-in Devices") {
                        authSessionInventory
                    }

                    groupedSection(title: "Data") {
                        exportDataRow
                    }

                    signOutCard
                    if offlineQueue.pendingCount > 0 {
                        Text("Signing out keeps pending work protected and hidden until you sign back in to this same account. It is never sent through another account.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                    }

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
            .appScreenBackground()
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
                Text("This revokes every browser session and mobile credential, then signs you out here. Protected pending work stays with this account until you sign in again.")
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .task {
                await loadAuthSessions()
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
        .appSurface(
            .tinted(AppVisualSystem.ColorToken.accent),
            cornerRadius: AppVisualSystem.Radius.hero,
            padding: 22
        )
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
        .foregroundStyle(AppVisualSystem.ColorToken.accent)
        .disabled(isFlushingPending || api.token == nil)
    }

    private var exportDataRow: some View {
        Button {
            Task { await exportData() }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "square.and.arrow.up")
                    .font(.title3)
                    .foregroundStyle(AppVisualSystem.ColorToken.accent)
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

    @ViewBuilder
    private var authSessionInventory: some View {
        if isLoadingAuthSessions {
            HStack {
                Spacer()
                ProgressView()
                Spacer()
            }
            .frame(minHeight: 58)
        } else if authSessions.isEmpty {
            Text("No active credentials found.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
        } else {
            ForEach(Array(authSessions.enumerated()), id: \.element.id) { index, session in
                if index > 0 {
                    accountDivider
                }
                HStack(spacing: 14) {
                    Image(systemName: session.kind == "web" ? "globe" : "iphone")
                        .font(.title3)
                        .foregroundStyle(AppVisualSystem.ColorToken.accent)
                        .frame(width: 28)

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(session.name)
                                .font(.body.weight(.medium))
                            if session.current {
                                Text("Current")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.green)
                            }
                        }
                        Text(authSessionDetail(session))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }
                .padding(.horizontal, 20)
                .frame(minHeight: 64)
            }
        }
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
        .background(
            AppVisualSystem.ColorToken.surface,
            in: RoundedRectangle(cornerRadius: AppVisualSystem.Radius.card, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: AppVisualSystem.Radius.card, style: .continuous)
                .stroke(AppVisualSystem.ColorToken.border, lineWidth: 1)
        }
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
            .background(
                AppVisualSystem.ColorToken.surface,
                in: RoundedRectangle(cornerRadius: AppVisualSystem.Radius.card, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: AppVisualSystem.Radius.card, style: .continuous)
                    .stroke(AppVisualSystem.ColorToken.border, lineWidth: 1)
            }
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
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("macrovana-export.json")
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

    private func loadAuthSessions() async {
        guard api.token != nil else { return }
        isLoadingAuthSessions = true
        defer { isLoadingAuthSessions = false }
        do {
            authSessions = try await api.listAuthSessions()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func authSessionDetail(_ session: AuthSession) -> String {
        guard let lastUsedAt = session.lastUsedAt else {
            return session.kind == "web" ? "Web session" : "Mobile credential"
        }
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: lastUsedAt) else {
            return session.kind == "web" ? "Web session" : "Mobile credential"
        }
        return "Active \(date.formatted(date: .abbreviated, time: .shortened))"
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

private enum SettingsTimezoneOptions {
    static let fallbackTimezone = "America/New_York"

    private static let fallbackTimezones = [
        "UTC",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Phoenix",
        "America/Los_Angeles",
        "America/Anchorage",
        "Pacific/Honolulu",
        "America/Toronto",
        "America/Vancouver",
        "America/Mexico_City",
        "America/Bogota",
        "America/Lima",
        "America/Santiago",
        "America/Sao_Paulo",
        "Europe/London",
        "Europe/Dublin",
        "Europe/Paris",
        "Europe/Berlin",
        "Europe/Madrid",
        "Europe/Rome",
        "Europe/Amsterdam",
        "Europe/Stockholm",
        "Europe/Athens",
        "Europe/Istanbul",
        "Africa/Cairo",
        "Africa/Johannesburg",
        "Asia/Jerusalem",
        "Asia/Dubai",
        "Asia/Kolkata",
        "Asia/Bangkok",
        "Asia/Singapore",
        "Asia/Shanghai",
        "Asia/Tokyo",
        "Asia/Seoul",
        "Australia/Perth",
        "Australia/Adelaide",
        "Australia/Sydney",
        "Pacific/Auckland"
    ]

    static var deviceTimezone: String {
        normalized(TimeZone.current.identifier)
    }

    static func normalized(_ value: String?) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return fallbackTimezone }
        if trimmed == "GMT" { return "UTC" }
        return TimeZone(identifier: trimmed) == nil ? fallbackTimezone : trimmed
    }

    static func options(selected: String, saved: String, device: String) -> [String] {
        Array(Set(fallbackTimezones + [selected, saved, device].map(normalized)))
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
}

private enum SettingsAccountText {
    static func displayName(for user: User?) -> String {
        clean(user?.name) ?? "macrovana Account"
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

private final class OuraAuthenticationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = OuraAuthenticationContextProvider()

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return ASPresentationAnchor()
        }
        return window
    }
}
