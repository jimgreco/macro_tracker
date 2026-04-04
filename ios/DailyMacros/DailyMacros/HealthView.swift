import SwiftUI

struct HealthView: View {
    @EnvironmentObject var api: APIClient

    // Sexual activity state
    @State private var healthEntries: [HealthEntry] = []
    @State private var dailyTypes: [HealthDailyTypes] = []
    @State private var healthScope = "week"
    @State private var showLogHealth = false
    @State private var selectedActivityType = "masturbation"
    @State private var healthLogDate = Date()
    @State private var isSavingHealth = false

    // Sleep state
    @State private var sleepEntries: [SleepEntry] = []
    @State private var sleepDailyTotals: [SleepDailyTotals] = []
    @State private var sleepScope = "week"
    @State private var showLogSleep = false
    @State private var sleepHours = "7.5"
    @State private var sleepWakeUps = "0"
    @State private var sleepLogDate = Date()
    @State private var isSavingSleep = false

    // Edit state
    @State private var editingHealth: HealthEntry?
    @State private var editingSleep: SleepEntry?
    @State private var editHealthType = "masturbation"
    @State private var editHealthDate = Date()
    @State private var editSleepHours = ""
    @State private var editSleepWakeUps = ""
    @State private var editSleepDate = Date()

    @State private var errorMessage: String?

    private let activityTypes = ["masturbation", "oral sex", "vaginal sex", "other"]
    private let scopes = ["week", "month", "year"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    sexualActivitySection
                    sleepSection
                }
                .padding()
            }
            .navigationTitle("Health")
            .sheet(isPresented: $showLogHealth) { logHealthSheet }
            .sheet(isPresented: $showLogSleep) { logSleepSheet }
            .sheet(item: $editingHealth) { entry in editHealthSheet(entry) }
            .sheet(item: $editingSleep) { entry in editSleepSheet(entry) }
            .task {
                await loadHealth()
                await loadSleep()
            }
            .refreshable {
                await loadHealth()
                await loadSleep()
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Sexual Activity Section

    private var sexualActivitySection: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Sexual Activity")
                    .font(.title3.bold())
                Spacer()
                Button { showLogHealth = true } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                }
            }

            Picker("Scope", selection: $healthScope) {
                ForEach(scopes, id: \.self) { s in
                    Text(s.capitalized).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: healthScope) { _, _ in
                Task { await loadHealth() }
            }

            healthChart

            healthStats

            healthEntriesList
        }
    }

    private var healthChart: some View {
        VStack(spacing: 4) {
            if dailyTypes.isEmpty {
                Text("No data for this period")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(height: 80)
            } else {
                Canvas { context, size in
                    drawHealthChart(context: context, size: size)
                }
                .frame(height: 80)
            }

            HStack(spacing: 12) {
                ForEach(activityTypes, id: \.self) { type in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(activityColor(type))
                            .frame(width: 8, height: 8)
                        Text(type.capitalized)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func drawHealthChart(context: GraphicsContext, size: CGSize) {
        let days = dailyTypes
        guard !days.isEmpty else { return }

        let dotRadius: CGFloat = 4
        let rowHeight: CGFloat = 16
        let padding: CGFloat = 4

        let dayCount = days.count
        let stepX = dayCount > 1 ? (size.width - padding * 2) / CGFloat(dayCount - 1) : size.width / 2

        for (i, day) in days.enumerated() {
            let x = dayCount > 1 ? padding + CGFloat(i) * stepX : size.width / 2
            for (j, type) in day.types.enumerated() {
                let y = padding + CGFloat(j) * rowHeight + dotRadius
                let rect = CGRect(x: x - dotRadius, y: y, width: dotRadius * 2, height: dotRadius * 2)
                context.fill(Path(ellipseIn: rect), with: .color(activityColor(type)))
            }
        }
    }

    private var healthStats: some View {
        let totalDays: Int = {
            switch healthScope {
            case "week": return 7
            case "month": return 30
            case "year": return 365
            default: return 7
            }
        }()
        let activeDays = dailyTypes.count

        return HStack {
            Text("\(activeDays) active day\(activeDays == 1 ? "" : "s") out of \(totalDays)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }

    private var healthEntriesList: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Recent Entries")
                    .font(.subheadline.bold())
                Spacer()
            }

            if healthEntries.isEmpty {
                ContentUnavailableView("No Entries", systemImage: "heart", description: Text("Tap + to log activity."))
            } else {
                ForEach(healthEntries.prefix(20)) { entry in
                    healthEntryCard(entry)
                        .onTapGesture {
                            editHealthType = entry.type
                            editHealthDate = parseISO(entry.loggedAt)
                            editingHealth = entry
                        }
                }
            }
        }
    }

    private func healthEntryCard(_ entry: HealthEntry) -> some View {
        HStack {
            Circle()
                .fill(activityColor(entry.type))
                .frame(width: 10, height: 10)
            Text(entry.type.capitalized)
                .font(.subheadline.bold())
            Spacer()
            Text(formatDate(entry.loggedAt))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
    }

    // MARK: - Sleep Section

    private var sleepSection: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Sleep")
                    .font(.title3.bold())
                Spacer()
                Button { showLogSleep = true } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                }
            }

            Picker("Scope", selection: $sleepScope) {
                ForEach(scopes, id: \.self) { s in
                    Text(s.capitalized).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: sleepScope) { _, _ in
                Task { await loadSleep() }
            }

            sleepChart

            sleepEntriesList
        }
    }

    private var sleepChart: some View {
        VStack(spacing: 4) {
            if sleepDailyTotals.isEmpty {
                Text("No data for this period")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(height: 120)
            } else {
                Canvas { context, size in
                    drawSleepChart(context: context, size: size)
                }
                .frame(height: 120)
            }

            if !sleepDailyTotals.isEmpty {
                HStack(spacing: 16) {
                    let avg = sleepDailyTotals.reduce(0.0) { $0 + $1.totalHours } / Double(sleepDailyTotals.count)
                    HStack(spacing: 4) {
                        Rectangle().fill(.white.opacity(0.5)).frame(width: 16, height: 2)
                        Text(String(format: "Avg: %.1fh", avg))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HStack(spacing: 4) {
                        Rectangle().fill(.green.opacity(0.5)).frame(width: 16, height: 2)
                        Text("Target: 8h")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func drawSleepChart(context: GraphicsContext, size: CGSize) {
        let data = sleepDailyTotals
        guard data.count >= 2 else {
            if let single = data.first {
                let x = size.width / 2
                let y = size.height / 2
                let rect = CGRect(x: x - 4, y: y - 4, width: 8, height: 8)
                context.fill(Path(ellipseIn: rect), with: .color(.cyan))
                let text = Text(String(format: "%.1fh", single.totalHours)).font(.caption)
                context.draw(text, at: CGPoint(x: x, y: y - 14))
            }
            return
        }

        let maxHours = max(data.map(\.totalHours).max() ?? 10, 10)
        let minHours: Double = 0
        let padding: CGFloat = 8

        let chartW = size.width - padding * 2
        let chartH = size.height - padding * 2
        let stepX = chartW / CGFloat(data.count - 1)

        func yPos(_ hours: Double) -> CGFloat {
            let ratio = (hours - minHours) / (maxHours - minHours)
            return padding + chartH * (1 - CGFloat(ratio))
        }

        // Target line at 8h
        let targetY = yPos(8)
        var targetPath = Path()
        targetPath.move(to: CGPoint(x: padding, y: targetY))
        targetPath.addLine(to: CGPoint(x: size.width - padding, y: targetY))
        context.stroke(targetPath, with: .color(.green.opacity(0.4)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))

        // Average line
        let avg = data.reduce(0.0) { $0 + $1.totalHours } / Double(data.count)
        let avgY = yPos(avg)
        var avgPath = Path()
        avgPath.move(to: CGPoint(x: padding, y: avgY))
        avgPath.addLine(to: CGPoint(x: size.width - padding, y: avgY))
        context.stroke(avgPath, with: .color(.white.opacity(0.3)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))

        // Data line
        var linePath = Path()
        for (i, d) in data.enumerated() {
            let x = padding + CGFloat(i) * stepX
            let y = yPos(d.totalHours)
            if i == 0 {
                linePath.move(to: CGPoint(x: x, y: y))
            } else {
                linePath.addLine(to: CGPoint(x: x, y: y))
            }
        }
        context.stroke(linePath, with: .color(.cyan), lineWidth: 2)

        // Dots
        for (i, d) in data.enumerated() {
            let x = padding + CGFloat(i) * stepX
            let y = yPos(d.totalHours)
            let rect = CGRect(x: x - 3, y: y - 3, width: 6, height: 6)
            context.fill(Path(ellipseIn: rect), with: .color(.cyan))
        }
    }

    private var sleepEntriesList: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Sleep Log")
                    .font(.subheadline.bold())
                Spacer()
            }

            if sleepEntries.isEmpty {
                ContentUnavailableView("No Sleep Data", systemImage: "moon.zzz", description: Text("Tap + to log sleep."))
            } else {
                ForEach(sleepEntries.prefix(20)) { entry in
                    sleepEntryCard(entry)
                        .onTapGesture {
                            editSleepHours = String(format: "%.2g", entry.durationHours)
                            editSleepWakeUps = "\(entry.wakeUps)"
                            editSleepDate = parseISO(entry.loggedAt)
                            editingSleep = entry
                        }
                }
            }
        }
    }

    private func sleepEntryCard(_ entry: SleepEntry) -> some View {
        HStack {
            Image(systemName: "moon.zzz.fill")
                .foregroundStyle(.indigo)
            VStack(alignment: .leading, spacing: 2) {
                Text(String(format: "%.1f hours", entry.durationHours))
                    .font(.subheadline.bold())
                if entry.wakeUps > 0 {
                    Text("\(entry.wakeUps) wake-up\(entry.wakeUps == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(formatDate(entry.loggedAt))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
    }

    // MARK: - Log Health Sheet

    private var logHealthSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Activity Type")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("Type", selection: $selectedActivityType) {
                        ForEach(activityTypes, id: \.self) { type in
                            Text(type.capitalized).tag(type)
                        }
                    }
                    .pickerStyle(.menu)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Date & Time")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    DatePicker("", selection: $healthLogDate)
                        .labelsHidden()
                }

                Button {
                    Task { await saveHealthEntry() }
                } label: {
                    if isSavingHealth {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Log Entry").font(.headline).frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
                .disabled(isSavingHealth)

                Spacer()
            }
            .padding()
            .navigationTitle("Log Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showLogHealth = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Log Sleep Sheet

    private var logSleepSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Hours")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("7.5", text: $sleepHours)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Wake-ups")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("0", text: $sleepWakeUps)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.numberPad)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Date & Time")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    DatePicker("", selection: $sleepLogDate)
                        .labelsHidden()
                }

                Button {
                    Task { await saveSleepEntry() }
                } label: {
                    if isSavingSleep {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Log Sleep").font(.headline).frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
                .disabled(isSavingSleep)

                Spacer()
            }
            .padding()
            .navigationTitle("Log Sleep")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showLogSleep = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Edit Health Sheet

    private func editHealthSheet(_ entry: HealthEntry) -> some View {
        NavigationStack {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Activity Type")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("Type", selection: $editHealthType) {
                        ForEach(activityTypes, id: \.self) { type in
                            Text(type.capitalized).tag(type)
                        }
                    }
                    .pickerStyle(.menu)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Date & Time")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    DatePicker("", selection: $editHealthDate)
                        .labelsHidden()
                }

                Button {
                    Task { await updateHealth(entry) }
                } label: {
                    Text("Save").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)

                Button(role: .destructive) {
                    Task { await deleteHealth(entry) }
                } label: {
                    Text("Delete Entry").font(.headline).frame(maxWidth: .infinity)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Edit Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingHealth = nil }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Edit Sleep Sheet

    private func editSleepSheet(_ entry: SleepEntry) -> some View {
        NavigationStack {
            VStack(spacing: 16) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Hours")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("7.5", text: $editSleepHours)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Wake-ups")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("0", text: $editSleepWakeUps)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.numberPad)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Date & Time")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    DatePicker("", selection: $editSleepDate)
                        .labelsHidden()
                }

                Button {
                    Task { await updateSleep(entry) }
                } label: {
                    Text("Save").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)

                Button(role: .destructive) {
                    Task { await deleteSleep(entry) }
                } label: {
                    Text("Delete Entry").font(.headline).frame(maxWidth: .infinity)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Edit Sleep")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingSleep = nil }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Actions

    private func loadHealth() async {
        do {
            let response = try await api.getHealthEntries(scope: healthScope)
            healthEntries = response.entries
            dailyTypes = response.dailyTypes
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadSleep() async {
        do {
            let response = try await api.getSleepEntries(scope: sleepScope)
            sleepEntries = response.entries
            sleepDailyTotals = response.dailyTotals
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveHealthEntry() async {
        isSavingHealth = true
        defer { isSavingHealth = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addHealthEntry(type: selectedActivityType, loggedAt: f.string(from: healthLogDate))
            showLogHealth = false
            healthLogDate = Date()
            await loadHealth()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveSleepEntry() async {
        isSavingSleep = true
        defer { isSavingSleep = false }
        do {
            guard let hours = Double(sleepHours), hours > 0, hours <= 24 else {
                errorMessage = "Hours must be between 0 and 24."
                return
            }
            let wakeUps = Int(sleepWakeUps) ?? 0
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addSleepEntry(durationHours: hours, wakeUps: wakeUps, loggedAt: f.string(from: sleepLogDate))
            showLogSleep = false
            sleepHours = "7.5"
            sleepWakeUps = "0"
            sleepLogDate = Date()
            await loadSleep()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateHealth(_ entry: HealthEntry) async {
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateHealthEntry(id: entry.id, type: editHealthType, loggedAt: f.string(from: editHealthDate))
            editingHealth = nil
            await loadHealth()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteHealth(_ entry: HealthEntry) async {
        do {
            try await api.deleteHealthEntry(id: entry.id)
            editingHealth = nil
            await loadHealth()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateSleep(_ entry: SleepEntry) async {
        do {
            guard let hours = Double(editSleepHours), hours > 0, hours <= 24 else {
                errorMessage = "Hours must be between 0 and 24."
                return
            }
            let wakeUps = Int(editSleepWakeUps) ?? 0
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateSleepEntry(id: entry.id, durationHours: hours, wakeUps: wakeUps, loggedAt: f.string(from: editSleepDate))
            editingSleep = nil
            await loadSleep()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteSleep(_ entry: SleepEntry) async {
        do {
            try await api.deleteSleepEntry(id: entry.id)
            editingSleep = nil
            await loadSleep()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func activityColor(_ type: String) -> Color {
        switch type.lowercased() {
        case "masturbation": return .pink
        case "oral sex": return .cyan
        case "vaginal sex": return .green
        case "other": return .purple
        default: return .gray
        }
    }

    private func formatDate(_ iso: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        if let date = f.date(from: iso) {
            f.dateStyle = .medium
            f.timeStyle = .short
            return f.string(from: date)
        }
        return String(iso.prefix(10))
    }

    private func parseISO(_ iso: String) -> Date {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return f.date(from: iso) ?? Date()
    }
}
