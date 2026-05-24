import SwiftUI
import PhotosUI
import UIKit
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

private struct QuickAddTemplate: Identifiable {
    let id: String
    let savedItemId: Int?
    let name: String
    let quantity: Double
    let unit: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let lastUsedAt: String?

    var isSaved: Bool { savedItemId != nil }
}

struct MacrosView: View {
    @EnvironmentObject var api: APIClient
    @State private var dashboard: DashboardResponse?
    @State private var savedItems: [SavedItem] = []
    @State private var mealText = ""
    @State private var consumedAt = Date()
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var mealImageDataUrl = ""
    @State private var mealPreviewImage: UIImage?
    @State private var isLoadingImage = false
    @State private var showCamera = false
    @FocusState private var isMealDescriptionFocused: Bool
    @State private var parsedItems: [ParsedMealItem] = []
    @State private var parsedMealName: String?
    @State private var parsedMealQuantity = "1"
    @State private var parsedMealUnit = "serving"
    @State private var saveParsedAsQuickAdd = false
    @State private var isParsing = false
    @State private var isSaving = false
    @State private var showParsed = false
    @State private var showAddSheet = false
    @State private var showEditTargets = false
    @State private var showEditEntry = false
    @State private var showEditMeal = false
    @State private var showEditParsedItem = false
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
    @State private var editEntryDate = Date()
    @State private var saveEditedEntryAsQuickAdd = false
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
    @State private var saveEditedMealAsQuickAdd = false
    @State private var origMealQuantity: Double = 0

    // Parsed item editing state
    @State private var editingParsedIndex: Int?
    @State private var editParsedName = ""
    @State private var editParsedQuantity = ""
    @State private var editParsedUnit = ""
    @State private var editParsedCal = ""
    @State private var editParsedProtein = ""
    @State private var editParsedCarbs = ""
    @State private var editParsedFat = ""
    @State private var origParsedQuantity: Double = 0
    @State private var origParsedCal: Double = 0
    @State private var origParsedProtein: Double = 0
    @State private var origParsedCarbs: Double = 0
    @State private var origParsedFat: Double = 0

    // Quick add editing state
    @State private var quickMultiplier = "1"
    @State private var quickSearchText = ""
    @State private var isLoadingSavedItems = false
    @State private var hasLoadedSavedItems = false
    @State private var editingQuickTemplate: QuickAddTemplate?
    @State private var editQuickName = ""
    @State private var editQuickQuantity = ""
    @State private var editQuickUnit = ""
    @State private var editQuickCal = ""
    @State private var editQuickProtein = ""
    @State private var editQuickCarbs = ""
    @State private var editQuickFat = ""

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
    private let addSheetTopAnchor = "add-sheet-top"

    private var hasMealImage: Bool {
        !mealImageDataUrl.isEmpty
    }

    private var mealDescriptionPlaceholder: String {
        hasMealImage ? "Optional: add a description, or parse from photo only." : "Describe your meal..."
    }

    private var quickTemplates: [QuickAddTemplate] {
        var templates = savedItems.map { item in
            QuickAddTemplate(
                id: "saved-\(item.id)",
                savedItemId: item.id,
                name: item.name,
                quantity: item.quantity,
                unit: item.unit ?? "serving",
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
                lastUsedAt: nil
            )
        }

        guard let entries = dashboard?.entries else { return templates }

        let savedSignatures = Set(savedItems.map { savedSignature(
            name: $0.name,
            quantity: $0.quantity,
            unit: $0.unit ?? "serving",
            calories: $0.calories,
            protein: $0.protein,
            carbs: $0.carbs,
            fat: $0.fat
        ) })

        let cutoff = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        var historyBySignature: [String: QuickAddTemplate] = [:]
        for entry in entries {
            let loggedAt = parseISO(entry.consumedAt)
            guard loggedAt >= cutoff else { continue }

            let signature = savedSignature(
                name: entry.itemName,
                quantity: entry.quantity,
                unit: entry.unit ?? "serving",
                calories: entry.calories,
                protein: entry.protein,
                carbs: entry.carbs,
                fat: entry.fat
            )
            guard !savedSignatures.contains(signature) else { continue }

            let existing = historyBySignature[signature]
            if let existing, let existingLast = existing.lastUsedAt, parseISO(existingLast) >= loggedAt {
                continue
            }

            historyBySignature[signature] = QuickAddTemplate(
                id: "history-\(signature.hashValue)",
                savedItemId: nil,
                name: entry.itemName,
                quantity: entry.quantity,
                unit: entry.unit ?? "serving",
                calories: entry.calories,
                protein: entry.protein,
                carbs: entry.carbs,
                fat: entry.fat,
                lastUsedAt: entry.consumedAt
            )
        }

        templates.append(contentsOf: historyBySignature.values.sorted {
            parseISO($0.lastUsedAt ?? "") > parseISO($1.lastUsedAt ?? "")
        })
        return templates
    }

    private var filteredQuickTemplates: [QuickAddTemplate] {
        let query = quickSearchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return quickTemplates }

        let tokens = query.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return quickTemplates.filter { template in
            let haystack = [
                template.name,
                template.unit,
                "\(Int(template.calories))",
                "\(Int(template.protein))",
                "\(Int(template.carbs))",
                "\(Int(template.fat))",
                "kcal",
                "protein",
                "carbs",
                "fat"
            ].joined(separator: " ").lowercased()

            return tokens.allSatisfy { haystack.contains($0) }
        }
    }

    private var dateString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/New_York")
        return f.string(from: selectedDate)
    }

    private var isoTimestamp: String {
        let f = ISO8601DateFormatter()
        f.timeZone = TimeZone(identifier: "America/New_York")
        return f.string(from: consumedAt)
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
                        consumedAt = selectedDate
                        quickSearchText = ""
                        clearMealImage()
                        if !hasLoadedSavedItems {
                            Task { await loadSavedItems() }
                        }
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
            .onChange(of: selectedPhotoItem) { _, newItem in
                Task { await loadSelectedPhoto(newItem) }
            }
            .onChange(of: mealImageDataUrl) { oldValue, newValue in
                if oldValue.isEmpty && !newValue.isEmpty {
                    focusMealDescriptionIfEmpty()
                }
            }
            .task {
                Task { await loadSavedItems(showErrors: false) }
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
        SwipeToDeleteRow(actionTint: Color.neonPink) {
            Task { await deleteEntry(entry.id) }
        } content: {
            entryRowContent(entry)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.panelBg)
                .cornerRadius(10)
                .contentShape(Rectangle())
                .onTapGesture { beginEditEntry(entry) }
                .dropDestination(for: EntryDragData.self) { items, _ in
                    guard let dropped = items.first, dropped.entryId != entry.id else { return false }
                    Task { await combineEntries(ids: [entry.id, dropped.entryId]) }
                    return true
                } isTargeted: { _ in
                    // Visual feedback handled by overlay
                }
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
                    Text(macroBreakdownText(protein: totalP, carbs: totalC, fat: totalF))
                        .font(.caption2)
                        .foregroundStyle(Color.mutedText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
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
        SwipeToDeleteRow(actionTint: Color.neonPink) {
            Task { await deleteEntry(entry.id) }
        } content: {
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
                Text(macroBreakdownText(protein: entry.protein, carbs: entry.carbs, fat: entry.fat))
                    .font(.caption2)
                    .foregroundStyle(Color.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
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
        editEntryDate = parseISO(entry.consumedAt)
        saveEditedEntryAsQuickAdd = false
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
                VStack(spacing: 10) {
                    compactEditEntryField("Item Name", text: $editItemName, keyboard: .default)

                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Quantity")
                                .font(.caption2)
                                .foregroundStyle(Color.mutedText)
                            TextField("Quantity", text: $editQuantity)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                                .onChange(of: editQuantity) { _, newValue in
                                    scaleEntryMacros(newQuantityStr: newValue)
                                }
                        }
                        compactEditEntryField("Unit", text: $editUnit, keyboard: .default)
                    }

                    compactMacroFieldGrid(
                        calories: $editEntryCal,
                        protein: $editEntryProtein,
                        carbs: $editEntryCarbs,
                        fat: $editEntryFat,
                        keyboard: .numberPad
                    )

                    DatePicker("Logged At", selection: $editEntryDate)
                        .datePickerStyle(.compact)
                        .font(.subheadline)

                    Toggle("Save as Quick Add", isOn: $saveEditedEntryAsQuickAdd)
                        .font(.subheadline)
                        .tint(Color.neonGreen)

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

                    HStack(spacing: 10) {
                        Button(role: .destructive) {
                            if let entry = editingEntry {
                                Task {
                                    await deleteEntry(entry.id)
                                    showEditEntry = false
                                    editingEntry = nil
                                }
                            }
                        } label: {
                            Text("Delete")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(Color.neonPink)

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
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
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
        .presentationContentInteraction(.scrolls)
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

    private func compactEditEntryField(_ label: String, text: Binding<String>, keyboard: UIKeyboardType) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(Color.mutedText)
            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(keyboard)
        }
    }

    private func compactMacroFieldGrid(
        calories: Binding<String>,
        protein: Binding<String>,
        carbs: Binding<String>,
        fat: Binding<String>,
        keyboard: UIKeyboardType
    ) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                compactEditEntryField("Calories", text: calories, keyboard: keyboard)
                compactEditEntryField("Protein (g)", text: protein, keyboard: keyboard)
            }

            HStack(spacing: 10) {
                compactEditEntryField("Carbs (g)", text: carbs, keyboard: keyboard)
                compactEditEntryField("Fat (g)", text: fat, keyboard: keyboard)
            }
        }
    }

    private func macroFieldGrid(
        calories: Binding<String>,
        protein: Binding<String>,
        carbs: Binding<String>,
        fat: Binding<String>,
        keyboard: UIKeyboardType
    ) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                editEntryField("Calories", text: calories, keyboard: keyboard)
                editEntryField("Protein (g)", text: protein, keyboard: keyboard)
            }

            HStack(spacing: 12) {
                editEntryField("Carbs (g)", text: carbs, keyboard: keyboard)
                editEntryField("Fat (g)", text: fat, keyboard: keyboard)
            }
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
        saveEditedMealAsQuickAdd = false
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

                    Toggle("Save as Quick Add", isOn: $saveEditedMealAsQuickAdd)
                        .font(.subheadline)
                        .tint(Color.neonGreen)

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
            .scrollDismissesKeyboard(.interactively)
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
        .presentationContentInteraction(.scrolls)
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

    private func macroBreakdownText(protein: Double, carbs: Double, fat: Double) -> String {
        "Protein \(Int(protein))g | Carbs \(Int(carbs))g | Fat \(Int(fat))g"
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
        let xLabelIndices = trendXAxisLabelIndices(count: trendData.count)
        let xLabelWidth: CGFloat = trendData.count <= 7 ? 34 : 44

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

            HStack(spacing: 0) {
                Color.clear
                    .frame(width: axisLabelWidth)
                    .padding(.trailing, 4)

                HStack(spacing: 0) {
                    ForEach(Array(xLabelIndices.enumerated()), id: \.element) { position, index in
                        if position > 0 {
                            Spacer(minLength: 0)
                        }

                        Text(trendDateLabel(trendData[index].day))
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(Color.mutedText)
                            .frame(
                                width: xLabelWidth,
                                alignment: trendXAxisLabelAlignment(position: position, count: xLabelIndices.count)
                            )
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .accessibilityHidden(true)

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
            ScrollView {
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

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Edit Targets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditTargets = false }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
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
            ScrollViewReader { proxy in
                ScrollView {
                    Color.clear
                        .frame(height: 1)
                        .id(addSheetTopAnchor)

                    Group {
                        if showParsed {
                            parsedResultsView
                                .padding()
                        } else {
                            addInputView
                        }
                    }
                    .background(Color.deepBg)
                    .onChange(of: showParsed) { _, _ in
                        resetAddSheetScroll(proxy)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
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
                .sheet(isPresented: $showEditParsedItem) {
                    editParsedItemSheet
                }
                .sheet(item: $editingQuickTemplate) { template in
                    editQuickAddSheet(template)
                }
                .sheet(isPresented: $showCamera) {
                    CameraPicker(image: $mealPreviewImage, imageDataUrl: $mealImageDataUrl) { message in
                        errorMessage = message
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationContentInteraction(.scrolls)
    }

    private func resetAddSheetScroll(_ proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.16)) {
                proxy.scrollTo(addSheetTopAnchor, anchor: .top)
            }
        }
    }

    private var addInputView: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                DatePicker("Logged At", selection: $consumedAt)
                    .datePickerStyle(.compact)
                    .foregroundStyle(.white)

                if !hasMealImage {
                    mealDescriptionField
                }

                HStack(spacing: 10) {
                    PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                        Label("Photo", systemImage: "photo")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(Color.neonCyan)

                    Button {
                        showCamera = true
                    } label: {
                        Label("Camera", systemImage: "camera")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(Color.neonCyan)
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                }

                if isLoadingImage {
                    ProgressView("Preparing photo...")
                        .font(.caption)
                        .foregroundStyle(Color.mutedText)
                } else if let mealPreviewImage {
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: mealPreviewImage)
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity)
                            .frame(height: 160)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        Button {
                            clearMealImage()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title3)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, Color.neonPink)
                        }
                        .padding(8)
                    }
                }

                if hasMealImage {
                    mealDescriptionField
                }

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
                .disabled((mealText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && mealImageDataUrl.isEmpty) || isParsing || isLoadingImage)
            }
            .padding()

            if isLoadingSavedItems || !quickTemplates.isEmpty || !quickSearchText.isEmpty {
                quickItemsSection
            }
        }
    }

    private var mealDescriptionField: some View {
        TextField(mealDescriptionPlaceholder, text: $mealText, axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .lineLimit(3...6)
            .focused($isMealDescriptionFocused)
    }

    @ViewBuilder
    private var quickItemsSection: some View {
        let visibleTemplates = filteredQuickTemplates

        VStack(spacing: 0) {
            Divider()

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Text("Quick Items")
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.mutedText)

                    Spacer()

                    Text("Multiplier")
                        .font(.caption)
                        .foregroundStyle(Color.mutedText)

                    TextField("1", text: $quickMultiplier)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.center)
                        .frame(width: 58)
                }

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.subheadline)
                        .foregroundStyle(Color.mutedText)

                    TextField("Search quick entries", text: $quickSearchText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.panelBg.opacity(0.8))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .padding(.horizontal)
            .padding(.vertical, 10)

            if isLoadingSavedItems && visibleTemplates.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Loading quick entries...")
                        .font(.caption)
                        .foregroundStyle(Color.mutedText)
                }
                .frame(maxWidth: .infinity)
                .padding()
            } else if visibleTemplates.isEmpty {
                Text(quickSearchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No quick entries yet." : "No matching quick entries.")
                    .font(.caption)
                    .foregroundStyle(Color.mutedText)
                    .frame(maxWidth: .infinity)
                    .padding()
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(visibleTemplates) { template in
                        quickAddRow(template)

                        if template.id != visibleTemplates.last?.id {
                            Divider()
                                .padding(.leading, 16)
                        }
                    }
                }
            }
        }
        .padding(.bottom, 12)
    }

    private func quickAddRow(_ template: QuickAddTemplate) -> some View {
        HStack(spacing: 10) {
            Button {
                Task { await quickAddItem(template) }
            } label: {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 5) {
                            Text(template.name)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                                .lineLimit(1)

                            if !template.isSaved {
                                Text("recent")
                                    .font(.caption2.bold())
                                    .foregroundStyle(Color.neonYellow)
                                    .lineLimit(1)
                            }
                        }

                        Text("\(Int(template.calories)) kcal | \(macroBreakdownText(protein: template.protein, carbs: template.carbs, fat: template.fat))")
                            .font(.caption2)
                            .foregroundStyle(Color.mutedText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }

                    Spacer(minLength: 8)

                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                        .foregroundStyle(Color.neonCyan)
                }
            }
            .buttonStyle(.plain)

            Button {
                beginEditQuickAdd(template)
            } label: {
                Image(systemName: "pencil")
                    .font(.subheadline)
                    .foregroundStyle(Color.neonYellow)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .frame(minHeight: 54)
    }

    private var parsedResultsView: some View {
        VStack(spacing: 12) {
            if parsedItems.count > 1 {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("Meal name", text: Binding(
                        get: { parsedMealName ?? "" },
                        set: { parsedMealName = $0 }
                    ))
                    .textFieldStyle(.roundedBorder)

                    HStack(spacing: 12) {
                        editEntryField("Quantity", text: $parsedMealQuantity, keyboard: .decimalPad)
                        editEntryField("Unit", text: $parsedMealUnit, keyboard: .default)
                    }
                }
                .padding()
                .background(Color.panelBg)
                .cornerRadius(12)
            } else if let name = parsedMealName {
                Text(name)
                    .font(.headline)
                    .foregroundStyle(Color.neonGreen)
            }

            ForEach(Array(parsedItems.enumerated()), id: \.offset) { index, item in
                HStack {
                    VStack(alignment: .leading) {
                        Text(item.itemName).font(.subheadline)
                        Text("\(Int(item.quantity)) \(item.unit ?? "serving")")
                            .font(.caption).foregroundStyle(Color.mutedText)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("\(Int(item.calories)) kcal").font(.subheadline)
                        Text(macroBreakdownText(protein: item.protein, carbs: item.carbs, fat: item.fat))
                            .font(.caption2).foregroundStyle(Color.mutedText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    Button {
                        beginEditParsedItem(at: index)
                    } label: {
                        Image(systemName: "pencil")
                            .foregroundStyle(Color.neonYellow)
                    }
                    .buttonStyle(.borderless)
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
                Text("\(Int(totalCal)) kcal | \(macroBreakdownText(protein: totalP, carbs: totalC, fat: totalF))")
                    .font(.caption)
                    .foregroundStyle(Color.neonGreen)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }

            Toggle("Save as Quick Add", isOn: $saveParsedAsQuickAdd)
                .font(.subheadline)
                .tint(Color.neonGreen)

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

    // MARK: - Edit Parsed Item Sheet

    private func beginEditParsedItem(at index: Int) {
        guard parsedItems.indices.contains(index) else { return }
        let item = parsedItems[index]
        editingParsedIndex = index
        editParsedName = item.itemName
        editParsedQuantity = "\(item.quantity)"
        editParsedUnit = item.unit ?? "serving"
        editParsedCal = "\(Int(item.calories))"
        editParsedProtein = "\(Int(item.protein))"
        editParsedCarbs = "\(Int(item.carbs))"
        editParsedFat = "\(Int(item.fat))"
        origParsedQuantity = item.quantity
        origParsedCal = item.calories
        origParsedProtein = item.protein
        origParsedCarbs = item.carbs
        origParsedFat = item.fat
        showEditParsedItem = true
    }

    private var editParsedItemSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    editEntryField("Item Name", text: $editParsedName, keyboard: .default)

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Quantity")
                                .font(.caption)
                                .foregroundStyle(Color.mutedText)
                            TextField("Quantity", text: $editParsedQuantity)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                                .onChange(of: editParsedQuantity) { _, newValue in
                                    scaleParsedMacros(newQuantityStr: newValue)
                                }
                        }
                        editEntryField("Unit", text: $editParsedUnit, keyboard: .default)
                    }

                    macroFieldGrid(
                        calories: $editParsedCal,
                        protein: $editParsedProtein,
                        carbs: $editParsedCarbs,
                        fat: $editParsedFat,
                        keyboard: .decimalPad
                    )

                    Button {
                        saveEditedParsedItem()
                    } label: {
                        Text("Save").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.neonCyan)
                    .disabled(editParsedName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.deepBg)
            .navigationTitle("Edit Parsed Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditParsedItem = false; editingParsedIndex = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationContentInteraction(.scrolls)
    }

    private func scaleParsedMacros(newQuantityStr: String) {
        guard let newQty = Double(newQuantityStr), origParsedQuantity > 0 else { return }
        let scale = newQty / origParsedQuantity
        editParsedCal = "\(Int(origParsedCal * scale))"
        editParsedProtein = "\(Int(origParsedProtein * scale))"
        editParsedCarbs = "\(Int(origParsedCarbs * scale))"
        editParsedFat = "\(Int(origParsedFat * scale))"
    }

    private func saveEditedParsedItem() {
        guard let index = editingParsedIndex, parsedItems.indices.contains(index) else { return }
        parsedItems[index] = ParsedMealItem(
            itemName: editParsedName.trimmingCharacters(in: .whitespacesAndNewlines),
            quantity: Double(editParsedQuantity) ?? parsedItems[index].quantity,
            unit: editParsedUnit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "serving" : editParsedUnit,
            calories: Double(editParsedCal) ?? parsedItems[index].calories,
            protein: Double(editParsedProtein) ?? parsedItems[index].protein,
            carbs: Double(editParsedCarbs) ?? parsedItems[index].carbs,
            fat: Double(editParsedFat) ?? parsedItems[index].fat
        )
        showEditParsedItem = false
        editingParsedIndex = nil
    }

    // MARK: - Edit Quick Add Sheet

    private func beginEditQuickAdd(_ template: QuickAddTemplate) {
        editingQuickTemplate = template
        editQuickName = template.name
        editQuickQuantity = "\(template.quantity)"
        editQuickUnit = template.unit
        editQuickCal = "\(Int(template.calories))"
        editQuickProtein = "\(Int(template.protein))"
        editQuickCarbs = "\(Int(template.carbs))"
        editQuickFat = "\(Int(template.fat))"
    }

    private func editQuickAddSheet(_ template: QuickAddTemplate) -> some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    editEntryField("Name", text: $editQuickName, keyboard: .default)

                    HStack(spacing: 12) {
                        editEntryField("Quantity", text: $editQuickQuantity, keyboard: .decimalPad)
                        editEntryField("Unit", text: $editQuickUnit, keyboard: .default)
                    }

                    macroFieldGrid(
                        calories: $editQuickCal,
                        protein: $editQuickProtein,
                        carbs: $editQuickCarbs,
                        fat: $editQuickFat,
                        keyboard: .decimalPad
                    )

                    Button {
                        Task { await saveQuickAdd(template) }
                    } label: {
                        if isSaving {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text(template.isSaved ? "Save Quick Add" : "Save as Quick Add")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.neonCyan)
                    .disabled(editQuickName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)

                    if let savedItemId = template.savedItemId {
                        Button(role: .destructive) {
                            Task { await deleteQuickAdd(id: savedItemId) }
                        } label: {
                            Text("Delete Quick Add")
                                .font(.subheadline)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.deepBg)
            .navigationTitle(template.isSaved ? "Edit Quick Add" : "Recent Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingQuickTemplate = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationContentInteraction(.scrolls)
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

    private func loadSavedItems(showErrors: Bool = true) async {
        guard !isLoadingSavedItems else { return }
        isLoadingSavedItems = true
        defer { isLoadingSavedItems = false }

        do {
            savedItems = try await api.getSavedItems()
            hasLoadedSavedItems = true
        } catch {
            if showErrors {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func parseMeal() async {
        isParsing = true
        defer { isParsing = false }
        do {
            let response = try await api.parseMeal(
                text: mealText,
                consumedAt: isoTimestamp,
                imageDataUrl: mealImageDataUrl.isEmpty ? nil : mealImageDataUrl
            )
            parsedItems = response.items
            parsedMealName = response.mealName
            parsedMealQuantity = "\(response.mealQuantity ?? 1)"
            parsedMealUnit = response.mealUnit ?? "serving"
            saveParsedAsQuickAdd = false
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
            let shouldSaveQuickAdd = saveParsedAsQuickAdd
            let saveItems = shouldSaveQuickAdd ? parsedQuickAddPayload() : []
            try await api.saveMealEntries(
                items: items,
                consumedAt: isoTimestamp,
                mealName: parsedMealName,
                mealQuantity: Double(parsedMealQuantity),
                mealUnit: parsedMealUnit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : parsedMealUnit,
                saveItems: saveItems
            )
            showAddSheet = false
            mealText = ""
            clearMealImage()
            showParsed = false
            parsedItems = []
            parsedMealName = nil
            saveParsedAsQuickAdd = false
            await loadDashboard()
            if shouldSaveQuickAdd {
                await loadSavedItems()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func quickAddItem(_ template: QuickAddTemplate) async {
        do {
            let multiplier = Double(quickMultiplier) ?? 1
            if let savedItemId = template.savedItemId {
                try await api.quickAdd(savedItemId: savedItemId, multiplier: multiplier, consumedAt: isoTimestamp)
            } else {
                let item: [String: Any] = [
                    "itemName": template.name,
                    "quantity": template.quantity * multiplier,
                    "unit": template.unit,
                    "calories": template.calories * multiplier,
                    "protein": template.protein * multiplier,
                    "carbs": template.carbs * multiplier,
                    "fat": template.fat * multiplier,
                    "consumedAt": isoTimestamp
                ]
                try await api.saveMealEntries(items: [item], consumedAt: isoTimestamp)
            }
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
                fat: Double(editEntryFat) ?? entry.fat,
                consumedAt: isoString(from: editEntryDate)
            )
            if saveEditedEntryAsQuickAdd {
                _ = try await api.addSavedItem(
                    name: editItemName,
                    quantity: Double(editQuantity) ?? entry.quantity,
                    unit: editUnit,
                    calories: Double(editEntryCal) ?? entry.calories,
                    protein: Double(editEntryProtein) ?? entry.protein,
                    carbs: Double(editEntryCarbs) ?? entry.carbs,
                    fat: Double(editEntryFat) ?? entry.fat
                )
                await loadSavedItems()
            }
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
            if saveEditedMealAsQuickAdd {
                let scale = origMealQuantity > 0 ? newQty / origMealQuantity : 1
                let totals = editingMealItems.reduce((calories: 0.0, protein: 0.0, carbs: 0.0, fat: 0.0)) { acc, item in
                    (
                        calories: acc.calories + item.calories,
                        protein: acc.protein + item.protein,
                        carbs: acc.carbs + item.carbs,
                        fat: acc.fat + item.fat
                    )
                }
                _ = try await api.addSavedItem(
                    name: editMealName,
                    quantity: newQty,
                    unit: editMealUnit,
                    calories: totals.calories * scale,
                    protein: totals.protein * scale,
                    carbs: totals.carbs * scale,
                    fat: totals.fat * scale
                )
                await loadSavedItems()
            }
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

    private func saveQuickAdd(_ template: QuickAddTemplate) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let name = editQuickName.trimmingCharacters(in: .whitespacesAndNewlines)
            let quantity = Double(editQuickQuantity) ?? template.quantity
            let unit = editQuickUnit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "serving" : editQuickUnit
            let calories = Double(editQuickCal) ?? template.calories
            let protein = Double(editQuickProtein) ?? template.protein
            let carbs = Double(editQuickCarbs) ?? template.carbs
            let fat = Double(editQuickFat) ?? template.fat

            if let savedItemId = template.savedItemId {
                try await api.updateSavedItem(
                    id: savedItemId,
                    name: name,
                    quantity: quantity,
                    unit: unit,
                    calories: calories,
                    protein: protein,
                    carbs: carbs,
                    fat: fat
                )
            } else {
                _ = try await api.addSavedItem(
                    name: name,
                    quantity: quantity,
                    unit: unit,
                    calories: calories,
                    protein: protein,
                    carbs: carbs,
                    fat: fat
                )
            }

            editingQuickTemplate = nil
            await loadSavedItems()
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteQuickAdd(id: Int) async {
        do {
            try await api.deleteSavedItem(id: id)
            editingQuickTemplate = nil
            await loadSavedItems()
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

    private func parsedQuickAddPayload() -> [[String: Any]] {
        guard !parsedItems.isEmpty else { return [] }

        if parsedItems.count == 1, let item = parsedItems.first {
            let quantity = max(item.quantity, 0.0001)
            return [[
                "name": item.itemName,
                "quantity": 1,
                "unit": item.unit ?? "serving",
                "calories": (item.calories / quantity).rounded(toPlaces: 2),
                "protein": (item.protein / quantity).rounded(toPlaces: 2),
                "carbs": (item.carbs / quantity).rounded(toPlaces: 2),
                "fat": (item.fat / quantity).rounded(toPlaces: 2)
            ]]
        }

        let mealQuantity = max(Double(parsedMealQuantity) ?? 1, 0.0001)
        let totals = parsedItems.reduce((calories: 0.0, protein: 0.0, carbs: 0.0, fat: 0.0)) { acc, item in
            (
                calories: acc.calories + item.calories,
                protein: acc.protein + item.protein,
                carbs: acc.carbs + item.carbs,
                fat: acc.fat + item.fat
            )
        }
        return [[
            "name": (parsedMealName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? parsedMealName! : "Meal"),
            "quantity": 1,
            "unit": parsedMealUnit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "serving" : parsedMealUnit,
            "calories": (totals.calories / mealQuantity).rounded(toPlaces: 2),
            "protein": (totals.protein / mealQuantity).rounded(toPlaces: 2),
            "carbs": (totals.carbs / mealQuantity).rounded(toPlaces: 2),
            "fat": (totals.fat / mealQuantity).rounded(toPlaces: 2)
        ]]
    }

    private func isoString(from date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.timeZone = TimeZone(identifier: "America/New_York")
        return f.string(from: date)
    }

    private func trendXAxisLabelIndices(count: Int) -> [Int] {
        guard count > 0 else { return [] }
        let desired = count <= 7 ? count : 4
        guard count > desired else { return Array(0..<count) }

        return (0..<desired).reduce(into: [Int]()) { indices, labelIndex in
            let index = Int((Double(labelIndex) * Double(count - 1) / Double(desired - 1)).rounded())
            if indices.last != index {
                indices.append(index)
            }
        }
    }

    private func trendXAxisLabelAlignment(position: Int, count: Int) -> Alignment {
        if position == 0 {
            return .leading
        }
        if position == count - 1 {
            return .trailing
        }
        return .center
    }

    private func trendDateLabel(_ day: String) -> String {
        let inputFormatter = DateFormatter()
        inputFormatter.dateFormat = "yyyy-MM-dd"

        guard let date = inputFormatter.date(from: day) else {
            return String(day.prefix(5))
        }

        let outputFormatter = DateFormatter()
        outputFormatter.setLocalizedDateFormatFromTemplate("M/d")
        return outputFormatter.string(from: date)
    }

    private func parseISO(_ iso: String) -> Date {
        let isoFormatter = ISO8601DateFormatter()
        if let date = isoFormatter.date(from: iso) {
            return date
        }

        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return f.date(from: iso) ?? Date.distantPast
    }

    private func savedSignature(name: String, quantity: Double, unit: String, calories: Double, protein: Double, carbs: Double, fat: Double) -> String {
        [
            name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            unit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            String(format: "%.3f", quantity),
            String(format: "%.3f", calories),
            String(format: "%.3f", protein),
            String(format: "%.3f", carbs),
            String(format: "%.3f", fat)
        ].joined(separator: "|")
    }

    private func loadSelectedPhoto(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isLoadingImage = true
        defer { isLoadingImage = false }

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw APIError.serverError("Unable to read selected image.")
            }
            let mimeType = item.supportedContentTypes.first?.preferredMIMEType ?? inferredImageMimeType(from: data)
            mealImageDataUrl = "data:\(mimeType);base64,\(data.base64EncodedString())"
            mealPreviewImage = UIImage(data: data)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func clearMealImage() {
        selectedPhotoItem = nil
        mealImageDataUrl = ""
        mealPreviewImage = nil
    }

    private func focusMealDescriptionIfEmpty() {
        guard mealText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            isMealDescriptionFocused = true
        }
    }

    private func inferredImageMimeType(from data: Data) -> String {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if bytes.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
        if bytes.count >= 12,
           String(bytes: bytes[8..<12], encoding: .ascii) == "WEBP" {
            return "image/webp"
        }
        if bytes.count >= 12 {
            let brand = String(bytes: bytes[4..<12], encoding: .ascii) ?? ""
            if brand.contains("ftypheic") || brand.contains("ftypheif") || brand.contains("ftypmif1") {
                return "image/heic"
            }
        }
        return "image/jpeg"
    }

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

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let divisor = pow(10.0, Double(places))
        return (self * divisor).rounded() / divisor
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Binding var imageDataUrl: String
    var onError: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        private let parent: CameraPicker

        init(parent: CameraPicker) {
            self.parent = parent
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            defer { parent.dismiss() }
            guard let pickedImage = info[.originalImage] as? UIImage else {
                parent.onError("Unable to capture photo.")
                return
            }
            guard let data = pickedImage.jpegData(compressionQuality: 0.82) else {
                parent.onError("Unable to prepare captured photo.")
                return
            }
            parent.image = pickedImage
            parent.imageDataUrl = "data:image/jpeg;base64,\(data.base64EncodedString())"
        }
    }
}
