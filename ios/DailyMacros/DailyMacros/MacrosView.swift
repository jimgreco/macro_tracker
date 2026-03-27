import SwiftUI
import UniformTypeIdentifiers

// MARK: - Neon Color Palette (matches web app)
private extension Color {
    static let neonGreen = Color(red: 5/255, green: 255/255, blue: 161/255)      // #05ffa1
    static let neonCyan = Color(red: 0/255, green: 207/255, blue: 255/255)        // #00cfff
    static let neonPink = Color(red: 255/255, green: 45/255, blue: 120/255)       // #ff2d78
    static let neonYellow = Color(red: 255/255, green: 202/255, blue: 40/255)     // #ffca28
    static let panelBg = Color(red: 13/255, green: 17/255, blue: 30/255)          // #0d111e
    static let deepBg = Color(red: 7/255, green: 9/255, blue: 15/255)            // #07090f
    static let mutedText = Color(red: 90/255, green: 110/255, blue: 138/255)      // #5a6e8a
}

// MARK: - Drag/Drop transferable for entry IDs

struct EntryDragData: Codable, Transferable {
    let entryId: Int
    let mealGroup: String?

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .entryDrag)
    }
}

extension UTType {
    static let entryDrag = UTType(exportedAs: "com.dailymacros.entry-drag")
}

struct MacrosView: View {
    @EnvironmentObject var api: APIClient
    @State private var dashboard: DashboardResponse?
    @State private var savedItems: [SavedItem] = []
    @State private var mealText = ""
    @State private var parsedItems: [ParsedMealItem] = []
    @State private var parsedMealName: String?
    @State private var isParsing = false
    @State private var isSaving = false
    @State private var showParsed = false
    @State private var showAddSheet = false
    @State private var showEditTargets = false
    @State private var showEditEntry = false
    @State private var showEditMeal = false
    @State private var errorMessage: String?
    @State private var selectedDate = Date()

    // Entry editing state
    @State private var editingEntry: Entry?
    @State private var editItemName = ""
    @State private var editQuantity = ""
    @State private var editUnit = ""
    @State private var editEntryCal = ""
    @State private var editEntryProtein = ""
    @State private var editEntryCarbs = ""
    @State private var editEntryFat = ""
    // Store originals for scaling
    @State private var origQuantity: Double = 0
    @State private var origCal: Double = 0
    @State private var origProtein: Double = 0
    @State private var origCarbs: Double = 0
    @State private var origFat: Double = 0

    // Meal editing state
    @State private var editingMealGroup: String?
    @State private var editingMealItems: [Entry] = []
    @State private var editMealName = ""
    @State private var editMealQuantity = ""
    @State private var editMealUnit = ""
    @State private var origMealQuantity: Double = 0

    // Drag state
    @State private var isDragging = false

    // Trend chart state
    @State private var trendPeriod = "week"
    @State private var trendData: [DailyTotals] = []
    @State private var trendTargets: MacroTargets?
    @State private var selectedTrendMacro = "calories"

    // Target editing state
    @State private var editCalories = ""
    @State private var editProtein = ""
    @State private var editCarbs = ""
    @State private var editFat = ""

    private let trendPeriods = ["week", "month", "year"]
    private let macroOptions = ["calories", "protein", "carbs", "fat"]

    private var dateString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/New_York")
        return f.string(from: selectedDate)
    }

    private var isoTimestamp: String {
        let f = ISO8601DateFormatter()
        f.timeZone = TimeZone(identifier: "America/New_York")
        return f.string(from: selectedDate)
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                ScrollView {
                    VStack(spacing: 20) {
                        datePicker

                        if let dash = dashboard {
                            macroSummaryCard(dash)
                            let dayEntries = dash.entries.filter { $0.day == dateString }
                            entriesList(dayEntries)
                        }

                        trendSection

                        // Extra space for trash zone
                        if isDragging {
                            Spacer().frame(height: 100)
                        }
                    }
                    .padding()
                }
                .background(Color.deepBg)

                // Trash drop zone
                if isDragging {
                    trashDropZone
                }
            }
            .navigationTitle("Macros")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showParsed = false
                        mealText = ""
                        Task { await loadSavedItems() }
                        showAddSheet = true
                    } label: {
                        Image(systemName: "plus")
                            .foregroundStyle(Color.neonCyan)
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                addSheet
            }
            .sheet(isPresented: $showEditTargets) {
                editTargetsSheet
            }
            .sheet(isPresented: $showEditEntry) {
                editEntrySheet
            }
            .sheet(isPresented: $showEditMeal) {
                editMealSheet
            }
            .task {
                await loadDashboard()
                await loadTrend()
            }
            .refreshable {
                await loadDashboard()
                await loadTrend()
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Trash Drop Zone

    private var trashDropZone: some View {
        VStack(spacing: 4) {
            Image(systemName: "trash.fill")
                .font(.title2)
            Text("Drop to delete")
                .font(.caption2)
        }
        .foregroundStyle(Color.neonPink)
        .frame(maxWidth: .infinity)
        .frame(height: 80)
        .background(Color.neonPink.opacity(0.15))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.neonPink.opacity(0.4), style: StrokeStyle(lineWidth: 2, dash: [8, 4]))
        )
        .cornerRadius(16)
        .padding(.horizontal)
        .padding(.bottom, 8)
        .dropDestination(for: EntryDragData.self) { items, _ in
            guard let item = items.first else { return false }
            Task { await deleteEntry(item.entryId) }
            return true
        } isTargeted: { _ in }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .animation(.easeOut(duration: 0.2), value: isDragging)
    }

    // MARK: - Date Picker

    private var datePicker: some View {
        HStack {
            Button { selectedDate = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate)!; Task { await loadDashboard() } } label: {
                Image(systemName: "chevron.left")
                    .foregroundStyle(Color.neonCyan)
            }
            Spacer()
            Text(selectedDate, style: .date)
                .font(.headline)
            Spacer()
            Button { selectedDate = Calendar.current.date(byAdding: .day, value: 1, to: selectedDate)!; Task { await loadDashboard() } } label: {
                Image(systemName: "chevron.right")
                    .foregroundStyle(Color.neonCyan)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Macro Summary

    private func macroSummaryCard(_ dash: DashboardResponse) -> some View {
        let totals = dash.currentDayTotals
        let targets = dash.targets

        return VStack(spacing: 12) {
            HStack {
                Text("Daily Totals")
                    .font(.subheadline.bold())
                Spacer()
                Button("edit targets") {
                    editCalories = "\(Int(targets.calories))"
                    editProtein = "\(Int(targets.protein))"
                    editCarbs = "\(Int(targets.carbs))"
                    editFat = "\(Int(targets.fat))"
                    showEditTargets = true
                }
                .font(.caption)
                .foregroundStyle(Color.neonCyan)
            }

            macroRow("Calories", value: totals.calories, target: targets.calories, unit: "kcal", color: .neonYellow)
            macroRow("Protein", value: totals.protein, target: targets.protein, unit: "g", color: .neonGreen)
            macroRow("Carbs", value: totals.carbs, target: targets.carbs, unit: "g", color: .neonCyan)
            macroRow("Fat", value: totals.fat, target: targets.fat, unit: "g", color: .neonPink)
        }
        .padding()
        .background(Color.panelBg)
        .cornerRadius(14)
    }

    private func macroRow(_ label: String, value: Double, target: Double, unit: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.subheadline.bold())
                Spacer()
                Text("\(Int(value)) / \(Int(target)) \(unit)")
                    .font(.subheadline)
                    .foregroundStyle(Color.mutedText)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.08)).frame(height: 8)
                    Capsule().fill(color).frame(width: min(geo.size.width * (target > 0 ? value / target : 0), geo.size.width), height: 8)
                }
            }
            .frame(height: 8)
        }
    }

    // MARK: - Entries List

    private func entriesList(_ entries: [Entry]) -> some View {
        let grouped = Dictionary(grouping: entries, by: { $0.mealGroup ?? "single_\($0.id)" })
        let keys = entries.map { $0.mealGroup ?? "single_\($0.id)" }
        let orderedKeys = keys.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }

        return VStack(alignment: .leading, spacing: 8) {
            ForEach(orderedKeys, id: \.self) { key in
                if let items = grouped[key] {
                    if items.count > 1 {
                        mealGroupCard(items: items)
                    } else {
                        singleEntryCard(items[0], allEntries: entries)
                    }
                }
            }

            if entries.isEmpty {
                Text("No entries yet today")
                    .foregroundStyle(Color.mutedText)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
            }
        }
    }

    // MARK: - Single Entry Card

    private func singleEntryCard(_ entry: Entry, allEntries: [Entry]) -> some View {
        entryRowContent(entry)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.panelBg)
            .cornerRadius(10)
            .contentShape(Rectangle())
            .onTapGesture { beginEditEntry(entry) }
            .draggable(EntryDragData(entryId: entry.id, mealGroup: nil)) {
                // Drag preview
                Text(entry.itemName)
                    .font(.subheadline)
                    .padding(8)
                    .background(Color.panelBg)
                    .cornerRadius(8)
                    .onAppear { isDragging = true }
            }
            .dropDestination(for: EntryDragData.self) { items, _ in
                guard let dropped = items.first, dropped.entryId != entry.id else { return false }
                Task { await combineEntries(ids: [entry.id, dropped.entryId]) }
                return true
            } isTargeted: { targeted in
                // Visual feedback handled by overlay
            }
    }

    // MARK: - Meal Group Card

    private func mealGroupCard(items: [Entry]) -> some View {
        let totalCal = items.reduce(0) { $0 + $1.calories }
        let totalP = items.reduce(0) { $0 + $1.protein }
        let totalC = items.reduce(0) { $0 + $1.carbs }
        let totalF = items.reduce(0) { $0 + $1.fat }

        return VStack(alignment: .leading, spacing: 0) {
            // Meal header — tappable to edit meal
            HStack {
                Text(items.first?.mealName ?? "Meal")
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.neonGreen)
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(Int(totalCal)) kcal")
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.neonGreen)
                    Text("P:\(Int(totalP)) C:\(Int(totalC)) F:\(Int(totalF))")
                        .font(.caption2)
                        .foregroundStyle(Color.mutedText)
                }
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(Color.mutedText)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .onTapGesture { beginEditMeal(items: items) }
            // Drop onto meal header to add to this meal
            .dropDestination(for: EntryDragData.self) { droppedItems, _ in
                guard let dropped = droppedItems.first else { return false }
                // Don't drop onto own meal
                if dropped.mealGroup == items.first?.mealGroup { return false }
                Task { await addToMealGroup(entryId: dropped.entryId, existingItems: items) }
                return true
            } isTargeted: { _ in }

            // Divider
            Rectangle()
                .fill(Color.white.opacity(0.08))
                .frame(height: 1)
                .padding(.horizontal, 8)

            // Sub-items
            VStack(alignment: .leading, spacing: 0) {
                ForEach(items) { entry in
                    subItemRow(entry: entry, items: items)

                    if entry.id != items.last?.id {
                        Rectangle()
                            .fill(Color.white.opacity(0.04))
                            .frame(height: 1)
                            .padding(.leading, 24)
                            .padding(.trailing, 12)
                    }
                }
            }
        }
        .background(Color.panelBg)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.neonGreen.opacity(0.2), lineWidth: 1)
        )
        .cornerRadius(10)
    }

    private func subItemRow(entry: Entry, items: [Entry]) -> some View {
        entryRowContent(entry, isSubItem: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture { beginEditEntry(entry) }
            .contextMenu {
                Button { beginEditEntry(entry) } label: {
                    Label("Edit Item", systemImage: "pencil")
                }
                Button {
                    Task { await removeFromGroup(entryId: entry.id) }
                } label: {
                    Label("Remove from Meal", systemImage: "arrow.up.right.square")
                }
                Button(role: .destructive) {
                    Task { await deleteEntry(entry.id) }
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
            .draggable(EntryDragData(entryId: entry.id, mealGroup: entry.mealGroup)) {
                Text(entry.itemName)
                    .font(.caption)
                    .padding(8)
                    .background(Color.panelBg)
                    .cornerRadius(8)
                    .onAppear { isDragging = true }
            }
    }

    private func entryRowContent(_ entry: Entry, isSubItem: Bool = false) -> some View {
        HStack {
            if isSubItem {
                Circle()
                    .fill(Color.neonGreen.opacity(0.4))
                    .frame(width: 4, height: 4)
                    .padding(.trailing, 4)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.itemName)
                    .font(isSubItem ? .caption : .subheadline)
                    .foregroundStyle(isSubItem ? Color.white.opacity(0.75) : Color.white)
                Text("\(Int(entry.quantity)) \(entry.unit ?? "serving")")
                    .font(.caption2)
                    .foregroundStyle(Color.mutedText)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(entry.calories)) kcal")
                    .font(isSubItem ? .caption : .subheadline)
                    .foregroundStyle(isSubItem ? Color.white.opacity(0.6) : Color.white)
                Text("P:\(Int(entry.protein)) C:\(Int(entry.carbs)) F:\(Int(entry.fat))")
                    .font(.caption2)
                    .foregroundStyle(Color.mutedText)
            }
        }
    }

    // MARK: - Edit Entry Sheet

    private func beginEditEntry(_ entry: Entry) {
        editingEntry = entry
        editItemName = entry.itemName
        editQuantity = "\(entry.quantity)"
        editUnit = entry.unit ?? "serving"
        editEntryCal = "\(Int(entry.calories))"
        editEntryProtein = "\(Int(entry.protein))"
        editEntryCarbs = "\(Int(entry.carbs))"
        editEntryFat = "\(Int(entry.fat))"
        origQuantity = entry.quantity
        origCal = entry.calories
        origProtein = entry.protein
        origCarbs = entry.carbs
        origFat = entry.fat
        showEditEntry = true
    }

    private var editEntrySheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    editEntryField("Item Name", text: $editItemName, keyboard: .default)

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Quantity")
                                .font(.caption)
                                .foregroundStyle(Color.mutedText)
                            TextField("Quantity", text: $editQuantity)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                                .onChange(of: editQuantity) { _, newValue in
                                    scaleEntryMacros(newQuantityStr: newValue)
                                }
                        }
                        editEntryField("Unit", text: $editUnit, keyboard: .default)
                    }

                    editEntryField("Calories", text: $editEntryCal, keyboard: .numberPad)

                    HStack(spacing: 12) {
                        editEntryField("Protein (g)", text: $editEntryProtein, keyboard: .numberPad)
                        editEntryField("Carbs (g)", text: $editEntryCarbs, keyboard: .numberPad)
                        editEntryField("Fat (g)", text: $editEntryFat, keyboard: .numberPad)
                    }

                    Button {
                        Task { await saveEditedEntry() }
                    } label: {
                        if isSaving {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Save").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.neonCyan)
                    .disabled(editItemName.isEmpty || isSaving)

                    // Remove from meal button (if in a meal group)
                    if editingEntry?.mealGroup != nil {
                        Button {
                            if let entry = editingEntry {
                                Task {
                                    await removeFromGroup(entryId: entry.id)
                                    showEditEntry = false
                                    editingEntry = nil
                                }
                            }
                        } label: {
                            Label("Remove from Meal", systemImage: "arrow.up.right.square")
                                .font(.subheadline)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(Color.neonYellow)
                    }

                    Button(role: .destructive) {
                        if let entry = editingEntry {
                            Task {
                                await deleteEntry(entry.id)
                                showEditEntry = false
                                editingEntry = nil
                            }
                        }
                    } label: {
                        Text("Delete Entry")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(Color.neonPink)
                }
                .padding()
            }
            .background(Color.deepBg)
            .navigationTitle("Edit Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditEntry = false; editingEntry = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// When quantity changes, auto-scale macros proportionally
    private func scaleEntryMacros(newQuantityStr: String) {
        guard let newQty = Double(newQuantityStr), origQuantity > 0 else { return }
        let scale = newQty / origQuantity
        editEntryCal = "\(Int(origCal * scale))"
        editEntryProtein = "\(Int(origProtein * scale))"
        editEntryCarbs = "\(Int(origCarbs * scale))"
        editEntryFat = "\(Int(origFat * scale))"
    }

    private func editEntryField(_ label: String, text: Binding<String>, keyboard: UIKeyboardType) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Color.mutedText)
            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(keyboard)
        }
    }

    // MARK: - Edit Meal Sheet

    private func beginEditMeal(items: [Entry]) {
        guard let first = items.first, let mealGroup = first.mealGroup else { return }
        editingMealGroup = mealGroup
        editingMealItems = items
        editMealName = first.mealName ?? "Meal"
        editMealQuantity = "\(first.mealQuantity ?? 1)"
        editMealUnit = first.mealUnit ?? "serving"
        origMealQuantity = first.mealQuantity ?? 1
        showEditMeal = true
    }

    private var editMealSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    editEntryField("Meal Name", text: $editMealName, keyboard: .default)

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Quantity")
                                .font(.caption)
                                .foregroundStyle(Color.mutedText)
                            TextField("Quantity", text: $editMealQuantity)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                        }
                        editEntryField("Unit", text: $editMealUnit, keyboard: .default)
                    }

                    // Preview scaled totals
                    if let scale = mealScaleFactor {
                        let totalCal = editingMealItems.reduce(0) { $0 + $1.calories }
                        let totalP = editingMealItems.reduce(0) { $0 + $1.protein }
                        let totalC = editingMealItems.reduce(0) { $0 + $1.carbs }
                        let totalF = editingMealItems.reduce(0) { $0 + $1.fat }

                        VStack(spacing: 8) {
                            if abs(scale - 1.0) > 0.001 {
                                HStack {
                                    Text("Scaled totals")
                                        .font(.caption.bold())
                                        .foregroundStyle(Color.mutedText)
                                    Spacer()
                                    Text("\(String(format: "%.1f", scale))x")
                                        .font(.caption.bold())
                                        .foregroundStyle(Color.neonYellow)
                                }
                            }
                            HStack(spacing: 16) {
                                scaledChip("Cal", value: totalCal * scale, color: .neonYellow)
                                scaledChip("P", value: totalP * scale, color: .neonGreen)
                                scaledChip("C", value: totalC * scale, color: .neonCyan)
                                scaledChip("F", value: totalF * scale, color: .neonPink)
                            }
                        }
                        .padding()
                        .background(Color.panelBg)
                        .cornerRadius(10)
                    }

                    // Sub-items list
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Items in this meal")
                            .font(.caption.bold())
                            .foregroundStyle(Color.mutedText)
                        ForEach(editingMealItems) { entry in
                            HStack {
                                Circle()
                                    .fill(Color.neonGreen.opacity(0.4))
                                    .frame(width: 4, height: 4)
                                Text(entry.itemName)
                                    .font(.caption)
                                Spacer()
                                Text("\(Int(entry.calories)) kcal")
                                    .font(.caption2)
                                    .foregroundStyle(Color.mutedText)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .padding()
                    .background(Color.panelBg)
                    .cornerRadius(10)

                    Button {
                        Task { await saveEditedMeal() }
                    } label: {
                        if isSaving {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Save Meal").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.neonGreen)
                    .disabled(editMealName.isEmpty || isSaving)

                    Button {
                        if let mg = editingMealGroup {
                            Task {
                                await splitMeal(mealGroup: mg)
                                showEditMeal = false
                            }
                        }
                    } label: {
                        Label("Split into Individual Items", systemImage: "rectangle.split.3x1")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(Color.neonYellow)
                }
                .padding()
            }
            .background(Color.deepBg)
            .navigationTitle("Edit Meal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditMeal = false; editingMealGroup = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var mealScaleFactor: Double? {
        guard let newQty = Double(editMealQuantity), origMealQuantity > 0 else { return nil }
        return newQty / origMealQuantity
    }

    private func scaledChip(_ label: String, value: Double, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(Color.mutedText)
            Text("\(Int(value))")
                .font(.subheadline.bold())
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Trend Section

    private var trendSection: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Trend")
                    .font(.headline)
                Spacer()
            }

            Picker("Period", selection: $trendPeriod) {
                ForEach(trendPeriods, id: \.self) { p in
                    Text(p.capitalized).tag(p)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: trendPeriod) { _, _ in
                Task { await loadTrend() }
            }

            // Macro selector chips with averages
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(macroOptions, id: \.self) { macro in
                        macroChip(macro)
                    }
                }
            }

            if trendData.count >= 2 {
                trendChart
            } else if !trendData.isEmpty {
                Text("Need at least 2 days of data for chart")
                    .font(.caption)
                    .foregroundStyle(Color.mutedText)
                    .padding(.vertical, 20)
            }
        }
    }

    private func macroChip(_ macro: String) -> some View {
        let isSelected = selectedTrendMacro == macro
        let avg = trendData.isEmpty ? 0 : trendData.reduce(0) { $0 + valueForMacro($1, macro: macro) } / Double(trendData.count)
        let unit = macro == "calories" ? "cal" : "g"

        return Button {
            selectedTrendMacro = macro
        } label: {
            VStack(spacing: 2) {
                Text(macro.capitalized)
                    .font(.caption2.bold())
                    .foregroundStyle(isSelected ? .white : Color.mutedText)
                if !trendData.isEmpty {
                    Text("\(Int(avg)) \(unit)")
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundStyle(isSelected ? Color.neonGreen : Color.mutedText)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(isSelected ? Color.white.opacity(0.08) : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(isSelected ? macroColor(macro).opacity(0.5) : Color.white.opacity(0.08), lineWidth: 1)
            )
            .cornerRadius(10)
        }
    }

    private var trendChart: some View {
        let values = trendData.map { valueForMacro($0, macro: selectedTrendMacro) }
        let targetValue = targetForMacro(selectedTrendMacro)
        let allValues = values + (targetValue > 0 ? [targetValue] : [])
        let minV = max(0, (allValues.min() ?? 0) * 0.8)
        let maxV = (allValues.max() ?? 0) * 1.1
        let range = max(maxV - minV, 1)
        let avg = values.reduce(0, +) / Double(max(values.count, 1))
        let unit = selectedTrendMacro == "calories" ? "cal" : "g"
        let axisLabelWidth: CGFloat = 36

        let tickCount = 4
        let tickValues = (0...tickCount).map { i in
            minV + range * Double(i) / Double(tickCount)
        }

        return VStack(spacing: 8) {
            HStack(alignment: .top, spacing: 0) {
                VStack {
                    ForEach(tickValues.reversed(), id: \.self) { tick in
                        Text("\(Int(tick))")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(Color.mutedText)
                            .frame(maxHeight: .infinity, alignment: .trailing)
                    }
                }
                .frame(width: axisLabelWidth)
                .padding(.trailing, 4)

                Canvas { context, size in
                    let chartWidth = size.width
                    let chartHeight = size.height
                    let stepX = chartWidth / CGFloat(max(values.count - 1, 1))

                    for tick in tickValues {
                        let y = chartHeight - ((tick - minV) / range) * chartHeight
                        var gridPath = Path()
                        gridPath.move(to: CGPoint(x: 0, y: y))
                        gridPath.addLine(to: CGPoint(x: chartWidth, y: y))
                        context.stroke(gridPath, with: .color(.white.opacity(0.04)), lineWidth: 0.5)
                    }

                    if targetValue > 0 {
                        let targetY = chartHeight - ((targetValue - minV) / range) * chartHeight
                        var targetPath = Path()
                        targetPath.move(to: CGPoint(x: 0, y: targetY))
                        targetPath.addLine(to: CGPoint(x: chartWidth, y: targetY))
                        context.stroke(targetPath, with: .color(Color.neonYellow.opacity(0.6)), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                    }

                    let avgY = chartHeight - ((avg - minV) / range) * chartHeight
                    var avgPath = Path()
                    avgPath.move(to: CGPoint(x: 0, y: avgY))
                    avgPath.addLine(to: CGPoint(x: chartWidth, y: avgY))
                    context.stroke(avgPath, with: .color(Color.neonGreen.opacity(0.5)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))

                    var path = Path()
                    for (i, val) in values.enumerated() {
                        let x = CGFloat(i) * stepX
                        let y = chartHeight - ((val - minV) / range) * chartHeight
                        if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                        else { path.addLine(to: CGPoint(x: x, y: y)) }
                    }
                    context.stroke(path, with: .color(macroColor(selectedTrendMacro)), lineWidth: 2)

                    for (i, val) in values.enumerated() {
                        let x = CGFloat(i) * stepX
                        let y = chartHeight - ((val - minV) / range) * chartHeight
                        context.fill(Circle().path(in: CGRect(x: x - 3, y: y - 3, width: 6, height: 6)), with: .color(macroColor(selectedTrendMacro)))
                    }
                }
                .frame(height: 180)
            }
            .frame(height: 180)

            HStack(spacing: 16) {
                HStack(spacing: 6) {
                    legendSwatch(color: Color.neonGreen, dashed: true)
                    Text("Avg: \(Int(avg)) \(unit)")
                        .font(.caption2)
                        .foregroundStyle(Color.neonGreen)
                }

                if targetValue > 0 {
                    HStack(spacing: 6) {
                        legendSwatch(color: Color.neonYellow, dashed: true)
                        Text("Target: \(Int(targetValue)) \(unit)")
                            .font(.caption2)
                            .foregroundStyle(Color.neonYellow)
                    }
                }
            }
        }
        .padding()
        .background(Color.panelBg)
        .cornerRadius(14)
    }

    private func legendSwatch(color: Color, dashed: Bool) -> some View {
        Canvas { context, size in
            var path = Path()
            path.move(to: CGPoint(x: 0, y: size.height / 2))
            path.addLine(to: CGPoint(x: size.width, y: size.height / 2))
            let style = dashed ? StrokeStyle(lineWidth: 2, dash: [3, 2]) : StrokeStyle(lineWidth: 2)
            context.stroke(path, with: .color(color), style: style)
        }
        .frame(width: 14, height: 10)
    }

    // MARK: - Edit Targets Sheet

    private var editTargetsSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                targetField("Calories (kcal)", text: $editCalories)
                targetField("Protein (g)", text: $editProtein)
                targetField("Carbs (g)", text: $editCarbs)
                targetField("Fat (g)", text: $editFat)

                Button {
                    Task { await saveTargets() }
                } label: {
                    Text("Save Targets").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.neonCyan)

                Spacer()
            }
            .padding()
            .navigationTitle("Edit Targets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditTargets = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func targetField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Color.mutedText)
            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
        }
    }

    // MARK: - Add Sheet (combined meal entry + quick add)

    private var addSheet: some View {
        NavigationStack {
            Group {
                if showParsed {
                    ScrollView {
                        parsedResultsView
                            .padding()
                    }
                } else {
                    addInputView
                }
            }
            .background(Color.deepBg)
            .navigationTitle(showParsed ? "Confirm Meal" : "Log Meal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(showParsed ? "Back" : "Cancel") {
                        if showParsed {
                            showParsed = false
                            parsedItems = []
                            parsedMealName = nil
                        } else {
                            showAddSheet = false
                            mealText = ""
                        }
                    }
                }
            }
        }
        .presentationDetents([.large])
    }

    private var addInputView: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                TextField("Describe your meal...", text: $mealText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)

                Button {
                    Task { await parseMeal() }
                } label: {
                    if isParsing {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Parse Meal").font(.headline).frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.neonCyan)
                .disabled(mealText.isEmpty || isParsing)
            }
            .padding()

            if !savedItems.isEmpty {
                Divider()
                HStack {
                    Text("Quick Items")
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.mutedText)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top, 12)
                .padding(.bottom, 4)

                List(savedItems) { item in
                    Button {
                        Task { await quickAddItem(item) }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name).font(.subheadline)
                                Text("\(Int(item.calories)) kcal \u{00B7} P:\(Int(item.protein)) C:\(Int(item.carbs)) F:\(Int(item.fat))")
                                    .font(.caption2).foregroundStyle(Color.mutedText)
                            }
                            Spacer()
                            Image(systemName: "plus.circle.fill")
                                .foregroundStyle(Color.neonCyan)
                        }
                    }
                    .tint(.primary)
                }
                .listStyle(.plain)
            }
        }
    }

    private var parsedResultsView: some View {
        VStack(spacing: 12) {
            if let name = parsedMealName {
                Text(name)
                    .font(.headline)
                    .foregroundStyle(Color.neonGreen)
            }

            ForEach(Array(parsedItems.enumerated()), id: \.offset) { _, item in
                HStack {
                    VStack(alignment: .leading) {
                        Text(item.itemName).font(.subheadline)
                        Text("\(Int(item.quantity)) \(item.unit ?? "serving")")
                            .font(.caption).foregroundStyle(Color.mutedText)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("\(Int(item.calories)) kcal").font(.subheadline)
                        Text("P:\(Int(item.protein)) C:\(Int(item.carbs)) F:\(Int(item.fat))")
                            .font(.caption2).foregroundStyle(Color.mutedText)
                    }
                }
                .padding(.vertical, 2)
            }

            let totalCal = parsedItems.reduce(0) { $0 + $1.calories }
            let totalP = parsedItems.reduce(0) { $0 + $1.protein }
            let totalC = parsedItems.reduce(0) { $0 + $1.carbs }
            let totalF = parsedItems.reduce(0) { $0 + $1.fat }

            Divider()
            HStack {
                Text("Total").font(.subheadline.bold())
                Spacer()
                Text("\(Int(totalCal)) kcal \u{00B7} P:\(Int(totalP)) C:\(Int(totalC)) F:\(Int(totalF))")
                    .font(.caption)
                    .foregroundStyle(Color.neonGreen)
            }

            Button {
                Task { await saveParsedMeal() }
            } label: {
                if isSaving {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Save").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.neonGreen)
            .disabled(isSaving)
        }
    }

    // MARK: - Actions

    private func loadDashboard() async {
        do {
            dashboard = try await api.getDashboard(date: dateString)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadTrend() async {
        do {
            let response = try await api.getDailyTotals(scope: trendPeriod)
            trendData = response.dailyTotals
            trendTargets = response.targets
        } catch {
            // Non-critical
        }
    }

    private func loadSavedItems() async {
        do {
            savedItems = try await api.getSavedItems()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func parseMeal() async {
        isParsing = true
        defer { isParsing = false }
        do {
            let response = try await api.parseMeal(text: mealText, consumedAt: isoTimestamp)
            parsedItems = response.items
            parsedMealName = response.mealName
            showParsed = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveParsedMeal() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let items: [[String: Any]] = parsedItems.map { item in
                var dict: [String: Any] = [
                    "itemName": item.itemName,
                    "quantity": item.quantity,
                    "calories": item.calories,
                    "protein": item.protein,
                    "carbs": item.carbs,
                    "fat": item.fat
                ]
                if let unit = item.unit { dict["unit"] = unit }
                return dict
            }
            try await api.saveMealEntries(items: items, consumedAt: isoTimestamp, mealName: parsedMealName)
            showAddSheet = false
            mealText = ""
            showParsed = false
            parsedItems = []
            parsedMealName = nil
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func quickAddItem(_ item: SavedItem) async {
        do {
            try await api.quickAdd(savedItemId: item.id, consumedAt: isoTimestamp)
            showAddSheet = false
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveEditedEntry() async {
        guard let entry = editingEntry else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.updateEntry(
                id: entry.id,
                itemName: editItemName,
                quantity: Double(editQuantity) ?? entry.quantity,
                unit: editUnit,
                calories: Double(editEntryCal) ?? entry.calories,
                protein: Double(editEntryProtein) ?? entry.protein,
                carbs: Double(editEntryCarbs) ?? entry.carbs,
                fat: Double(editEntryFat) ?? entry.fat
            )
            showEditEntry = false
            editingEntry = nil
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveEditedMeal() async {
        guard let mealGroup = editingMealGroup else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let newQty = Double(editMealQuantity) ?? origMealQuantity
            try await api.scaleMealGroup(
                mealGroup: mealGroup,
                quantity: newQty,
                unit: editMealUnit,
                name: editMealName
            )
            showEditMeal = false
            editingMealGroup = nil
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteEntry(_ id: Int) async {
        isDragging = false
        do {
            try await api.deleteEntry(id: id)
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func combineEntries(ids: [Int]) async {
        isDragging = false
        do {
            try await api.combineEntries(entryIds: ids, mealName: "Meal")
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func addToMealGroup(entryId: Int, existingItems: [Entry]) async {
        isDragging = false
        guard let mealGroup = existingItems.first?.mealGroup else { return }
        // To add to an existing meal: split the meal, combine all IDs together
        let allIds = existingItems.map(\.id) + [entryId]
        let mealName = existingItems.first?.mealName ?? "Meal"
        do {
            // First split the existing meal
            try await api.scaleMealGroup(mealGroup: mealGroup, quantity: existingItems.first?.mealQuantity ?? 1)
            // Actually we need to: split then recombine with the new entry
            // Simpler: remove all from group, then combine all together
            // But the API doesn't support adding to a group directly
            // Split first, then combine all
            for item in existingItems {
                try await api.removeFromGroup(entryId: item.id)
            }
            try await api.combineEntries(entryIds: allIds, mealName: mealName)
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func removeFromGroup(entryId: Int) async {
        do {
            try await api.removeFromGroup(entryId: entryId)
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func splitMeal(mealGroup: String) async {
        do {
            try await api.splitMealGroup(mealGroup: mealGroup)
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveTargets() async {
        do {
            if let cal = Double(editCalories) { try await api.setMacroTarget(macro: "calories", target: cal) }
            if let prot = Double(editProtein) { try await api.setMacroTarget(macro: "protein", target: prot) }
            if let carbs = Double(editCarbs) { try await api.setMacroTarget(macro: "carbs", target: carbs) }
            if let fat = Double(editFat) { try await api.setMacroTarget(macro: "fat", target: fat) }
            showEditTargets = false
            await loadDashboard()
            await loadTrend()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func valueForMacro(_ totals: DailyTotals, macro: String) -> Double {
        switch macro {
        case "calories": return totals.calories
        case "protein": return totals.protein
        case "carbs": return totals.carbs
        case "fat": return totals.fat
        default: return totals.calories
        }
    }

    private func targetForMacro(_ macro: String) -> Double {
        guard let targets = trendTargets else { return 0 }
        switch macro {
        case "calories": return targets.calories
        case "protein": return targets.protein
        case "carbs": return targets.carbs
        case "fat": return targets.fat
        default: return targets.calories
        }
    }

    private func macroColor(_ macro: String) -> Color {
        switch macro {
        case "calories": return .neonYellow
        case "protein": return .neonGreen
        case "carbs": return .neonCyan
        case "fat": return .neonPink
        default: return .neonCyan
        }
    }
}
