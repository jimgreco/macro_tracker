import SwiftUI

struct WeightView: View {
    @EnvironmentObject var api: APIClient
    @State private var entries: [WeightEntry] = []
    @State private var target: WeightTarget?
    @State private var scope = "month"
    @State private var newWeight = ""
    @State private var showAddSheet = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let scopes = ["month", "quarter", "year", "all"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    scopePicker
                    if let target, let tw = target.targetWeight {
                        targetCard(tw, date: target.targetDate)
                    }
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

    private func targetCard(_ weight: Double, date: String?) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Target Weight")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(String(format: "%.1f lbs", weight))
                    .font(.title2.bold())
            }
            Spacer()
            if let date {
                VStack(alignment: .trailing, spacing: 4) {
                    Text("Target Date")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(date)
                        .font(.subheadline)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - Chart

    private var chartView: some View {
        Group {
            if entries.count >= 2 {
                Canvas { context, size in
                    let weights = entries.map(\.weight)
                    let minW = (weights.min() ?? 0) - 2
                    let maxW = (weights.max() ?? 0) + 2
                    let range = max(maxW - minW, 1)

                    let stepX = size.width / CGFloat(max(entries.count - 1, 1))

                    var path = Path()
                    for (i, entry) in entries.enumerated() {
                        let x = CGFloat(i) * stepX
                        let y = size.height - ((CGFloat(entry.weight) - CGFloat(minW)) / CGFloat(range)) * size.height
                        if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                        else { path.addLine(to: CGPoint(x: x, y: y)) }
                    }
                    context.stroke(path, with: .color(.cyan), lineWidth: 2)

                    // Draw dots
                    for (i, entry) in entries.enumerated() {
                        let x = CGFloat(i) * stepX
                        let y = size.height - ((CGFloat(entry.weight) - CGFloat(minW)) / CGFloat(range)) * size.height
                        context.fill(Circle().path(in: CGRect(x: x - 3, y: y - 3, width: 6, height: 6)), with: .color(.cyan))
                    }
                }
                .frame(height: 200)
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
            }
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
}
