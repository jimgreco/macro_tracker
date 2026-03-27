import SwiftUI

struct WeightView: View {
    @EnvironmentObject var api: APIClient
    @State private var entries: [WeightEntry] = []
    @State private var target: WeightTarget?
    @State private var scope = "month"
    @State private var newWeight = ""
    @State private var showAddSheet = false
    @State private var showEditTarget = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    // Target editing state
    @State private var editTargetWeight = ""
    @State private var editTargetDate = Date()

    private let scopes = ["week", "month", "year"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    scopePicker
                    targetCard
                    chartView
                    entriesList
                }
                .padding()
            }
            .navigationTitle("Weight")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showAddSheet = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                addWeightSheet
            }
            .sheet(isPresented: $showEditTarget) {
                editTargetSheet
            }
            .task { await loadData() }
            .refreshable { await loadData() }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Scope Picker

    private var scopePicker: some View {
        Picker("Scope", selection: $scope) {
            ForEach(scopes, id: \.self) { s in
                Text(s.capitalized).tag(s)
            }
        }
        .pickerStyle(.segmented)
        .onChange(of: scope) { _, _ in
            Task { await loadEntries() }
        }
    }

    // MARK: - Target Card

    private var targetCard: some View {
        Group {
            if let target, let tw = target.targetWeight {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Target Weight")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(String(format: "%.1f lbs", tw))
                            .font(.title2.bold())
                    }
                    Spacer()
                    if let date = target.targetDate {
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("Target Date")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(formatShortDate(date))
                                .font(.subheadline)
                        }
                    }
                    Button("edit") {
                        editTargetWeight = String(format: "%.1f", tw)
                        if let dateStr = target.targetDate {
                            let f = DateFormatter()
                            f.dateFormat = "yyyy-MM-dd"
                            editTargetDate = f.date(from: dateStr) ?? Date()
                        }
                        showEditTarget = true
                    }
                    .font(.caption)
                    .foregroundStyle(.cyan)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
            } else {
                Button {
                    editTargetWeight = ""
                    editTargetDate = Date()
                    showEditTarget = true
                } label: {
                    HStack {
                        Image(systemName: "target")
                        Text("Set Weight Target")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.cyan)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(12)
                }
            }
        }
    }

    // MARK: - Chart

    private var chartView: some View {
        Group {
            if entries.count >= 2 {
                VStack(alignment: .leading, spacing: 8) {
                    Canvas { context, size in
                        let weights = entries.map(\.weight)
                        let targetW = target?.targetWeight
                        var allValues = weights
                        if let tw = targetW { allValues.append(tw) }
                        let minW = (allValues.min() ?? 0) - 2
                        let maxW = (allValues.max() ?? 0) + 2
                        let range = max(maxW - minW, 1)

                        let stepX = size.width / CGFloat(max(entries.count - 1, 1))

                        // Target line
                        if let tw = targetW {
                            let y = size.height - ((CGFloat(tw) - CGFloat(minW)) / CGFloat(range)) * size.height
                            var targetPath = Path()
                            targetPath.move(to: CGPoint(x: 0, y: y))
                            targetPath.addLine(to: CGPoint(x: size.width, y: y))
                            context.stroke(targetPath, with: .color(.green.opacity(0.5)), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                        }

                        // Average line
                        let avg = weights.reduce(0, +) / Double(weights.count)
                        let avgY = size.height - ((CGFloat(avg) - CGFloat(minW)) / CGFloat(range)) * size.height
                        var avgPath = Path()
                        avgPath.move(to: CGPoint(x: 0, y: avgY))
                        avgPath.addLine(to: CGPoint(x: size.width, y: avgY))
                        context.stroke(avgPath, with: .color(.white.opacity(0.2)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))

                        // Data line
                        var path = Path()
                        for (i, entry) in entries.enumerated() {
                            let x = CGFloat(i) * stepX
                            let y = size.height - ((CGFloat(entry.weight) - CGFloat(minW)) / CGFloat(range)) * size.height
                            if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                            else { path.addLine(to: CGPoint(x: x, y: y)) }
                        }
                        context.stroke(path, with: .color(.cyan), lineWidth: 2)

                        // Dots
                        for (i, entry) in entries.enumerated() {
                            let x = CGFloat(i) * stepX
                            let y = size.height - ((CGFloat(entry.weight) - CGFloat(minW)) / CGFloat(range)) * size.height
                            context.fill(Circle().path(in: CGRect(x: x - 3, y: y - 3, width: 6, height: 6)), with: .color(.cyan))
                        }
                    }
                    .frame(height: 200)

                    // Legend
                    HStack(spacing: 16) {
                        legendItem("Avg: \(String(format: "%.1f", entries.map(\.weight).reduce(0, +) / Double(entries.count)))", color: .white.opacity(0.4))
                        if let tw = target?.targetWeight {
                            legendItem("Target: \(String(format: "%.1f", tw))", color: .green.opacity(0.7))
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
            }
        }
    }

    private func legendItem(_ text: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Rectangle()
                .fill(color)
                .frame(width: 12, height: 2)
            Text(text)
        }
    }

    // MARK: - Entries List

    private var entriesList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("History")
                .font(.headline)

            ForEach(entries) { entry in
                HStack {
                    Text(formatDate(entry.loggedAt))
                        .font(.subheadline)
                    Spacer()
                    Text(String(format: "%.1f lbs", entry.weight))
                        .font(.subheadline.bold())
                }
                .padding(.vertical, 4)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await deleteWeight(entry.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }

            if entries.isEmpty {
                Text("No weight entries")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
            }
        }
    }

    // MARK: - Add Weight Sheet

    private var addWeightSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextField("Weight (lbs)", text: $newWeight)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.decimalPad)

                Button {
                    Task { await addWeight() }
                } label: {
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Log Weight").font(.headline).frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
                .disabled(newWeight.isEmpty || isLoading)

                Spacer()
            }
            .padding()
            .navigationTitle("Log Weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showAddSheet = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Edit Target Sheet

    private var editTargetSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Target Weight (lbs)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("Target Weight", text: $editTargetWeight)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.decimalPad)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Target Date")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    DatePicker("", selection: $editTargetDate, displayedComponents: .date)
                        .datePickerStyle(.compact)
                        .labelsHidden()
                }

                Button {
                    Task { await saveTarget() }
                } label: {
                    Text("Save Target").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
                .disabled(editTargetWeight.isEmpty)

                Spacer()
            }
            .padding()
            .navigationTitle("Weight Target")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditTarget = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Actions

    private func loadData() async {
        await loadEntries()
        do {
            target = try await api.getWeightTarget()
        } catch { /* target is optional */ }
    }

    private func loadEntries() async {
        do {
            entries = try await api.getWeights(scope: scope)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func addWeight() async {
        guard let weight = Double(newWeight) else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addWeight(weight, loggedAt: f.string(from: Date()))
            newWeight = ""
            showAddSheet = false
            await loadEntries()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteWeight(_ id: Int) async {
        do {
            try await api.deleteWeight(id: id)
            await loadEntries()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveTarget() async {
        guard let weight = Double(editTargetWeight) else { return }
        do {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            let dateStr = f.string(from: editTargetDate)
            try await api.setWeightTarget(targetWeight: weight, targetDate: dateStr)
            showEditTarget = false
            await loadData()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func formatDate(_ iso: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        if let date = f.date(from: iso) {
            f.dateStyle = .medium
            f.timeStyle = .none
            return f.string(from: date)
        }
        return String(iso.prefix(10))
    }

    private func formatShortDate(_ dateStr: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        if let date = f.date(from: dateStr) {
            f.dateStyle = .medium
            f.timeStyle = .none
            return f.string(from: date)
        }
        return dateStr
    }
}
