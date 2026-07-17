import Foundation
import AuthenticationServices

enum APIError: LocalizedError {
    case notAuthenticated
    case serverError(String)
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not authenticated. Please sign in."
        case .serverError(let message):
            return message
        case .networkError(let error):
            return error.localizedDescription
        case .decodingError(let error):
            return "Failed to parse response: \(error.localizedDescription)"
        }
    }
}

@MainActor
class APIClient: ObservableObject {
    static let shared = APIClient()

    private let session = URLSession.shared
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    var baseURL: URL {
        let stored = UserDefaults.standard.string(forKey: "api_base_url") ?? ""
        if !stored.isEmpty, let url = URL(string: stored) {
            return url
        }

        if let configured = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String {
            let trimmed = configured.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.contains("$("), let url = URL(string: trimmed) {
                return url
            }
        }

        #if DEBUG
        return URL(string: "http://localhost:3000")!
        #else
        fatalError("APIBaseURL must be configured for release builds.")
        #endif
    }

    @Published var token: String? {
        didSet {
            if let token {
                isLocalDevOfflineSession = false
                KeychainHelper.save(key: "api_token", value: token)
            } else {
                KeychainHelper.delete(key: "api_token")
            }
        }
    }
    @Published private(set) var isLocalDevOfflineSession = false

    init() {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            ScreenshotSeedData.prepareRuntimeStateIfNeeded()
            self.token = nil
            return
        }
        #endif

        self.token = KeychainHelper.load(key: "api_token")
    }

    private func apiURL(_ path: String) -> URL {
        baseURL.appendingPathComponent("api/v1\(path)")
    }

    private func authorizedRequest(_ url: URL, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let token = token ?? (isLocalDevOfflineSession ? "local-dev-offline" : nil) else {
            throw APIError.notAuthenticated
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }

    func beginLocalDevOfflineSession() {
        token = nil
        isLocalDevOfflineSession = true
    }

    func endLocalDevOfflineSession() {
        isLocalDevOfflineSession = false
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            Diagnostics.shared.record(
                level: "error",
                category: "api",
                message: "Network request failed",
                details: ["url": request.url?.absoluteString ?? "", "error": error.localizedDescription]
            )
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            token = nil
            throw APIError.notAuthenticated
        }

        if httpResponse.statusCode >= 400 {
            if let errorResponse = try? decoder.decode(ErrorResponse.self, from: data) {
                let suffix = errorResponse.requestId.map { " Reference: \($0)" } ?? ""
                Diagnostics.shared.record(
                    level: "error",
                    category: "api",
                    message: errorResponse.error,
                    details: [
                        "status": "\(httpResponse.statusCode)",
                        "url": request.url?.absoluteString ?? "",
                        "requestId": errorResponse.requestId ?? ""
                    ]
                )
                throw APIError.serverError(errorResponse.error + suffix)
            }
            Diagnostics.shared.record(
                level: "error",
                category: "api",
                message: "Request failed",
                details: ["status": "\(httpResponse.statusCode)", "url": request.url?.absoluteString ?? ""]
            )
            throw APIError.serverError("Request failed with status \(httpResponse.statusCode)")
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func performData(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            Diagnostics.shared.record(
                level: "error",
                category: "api",
                message: "Network request failed",
                details: ["url": request.url?.absoluteString ?? "", "error": error.localizedDescription]
            )
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            token = nil
            throw APIError.notAuthenticated
        }

        if httpResponse.statusCode >= 400 {
            if let errorResponse = try? decoder.decode(ErrorResponse.self, from: data) {
                let suffix = errorResponse.requestId.map { " Reference: \($0)" } ?? ""
                Diagnostics.shared.record(
                    level: "error",
                    category: "api",
                    message: errorResponse.error,
                    details: [
                        "status": "\(httpResponse.statusCode)",
                        "url": request.url?.absoluteString ?? "",
                        "requestId": errorResponse.requestId ?? ""
                    ]
                )
                throw APIError.serverError(errorResponse.error + suffix)
            }
            Diagnostics.shared.record(
                level: "error",
                category: "api",
                message: "Request failed",
                details: ["status": "\(httpResponse.statusCode)", "url": request.url?.absoluteString ?? ""]
            )
            throw APIError.serverError("Request failed with status \(httpResponse.statusCode)")
        }

        return data
    }

    private func shouldQueueMutation(after error: Error) -> Bool {
        if case APIError.networkError = error {
            return true
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorCannotFindHost,
            NSURLErrorCannotConnectToHost,
            NSURLErrorTimedOut,
            NSURLErrorDNSLookupFailed
        ].contains(nsError.code)
    }

    private func queueMutation(path: String, method: String, body: Data?, summary: String) {
        OfflineMutationStore.shared.enqueue(method: method, path: path, body: body, summary: summary)
        Diagnostics.shared.record(
            level: "warning",
            category: "offline",
            message: "Queued mutation",
            details: ["path": path, "summary": summary, "pending": "\(OfflineMutationStore.shared.pendingCount)"]
        )
    }

    func flushPendingMutations() async throws {
        let pending = OfflineMutationStore.shared.snapshot()
        guard !pending.isEmpty else { return }

        for mutation in pending {
            let request = try authorizedRequest(
                apiURL(mutation.path),
                method: mutation.method,
                body: mutation.body
            )
            do {
                _ = try await performData(request)
                OfflineMutationStore.shared.remove(id: mutation.id)
                Diagnostics.shared.record(
                    category: "offline",
                    message: "Flushed pending mutation",
                    details: ["path": mutation.path, "summary": mutation.summary]
                )
            } catch {
                Diagnostics.shared.record(
                    level: "warning",
                    category: "offline",
                    message: "Pending mutation flush paused",
                    details: ["path": mutation.path, "error": error.localizedDescription]
                )
                throw error
            }
        }
    }

    // MARK: - Auth

    func getMe() async throws -> User? {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.user
        }
        #endif

        let request = try authorizedRequest(apiURL("/me"))
        let response: MeResponse = try await perform(request)
        return response.user
    }

    func updateAccountPreferences(timezone: String) async throws -> User? {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.user
        }
        #endif

        let payload: [String: Any] = ["timezone": timezone]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/account/preferences"), method: "PATCH", body: body)
        let response: AccountPreferencesResponse = try await perform(request)
        return response.user
    }

    func getVersion() async throws -> VersionResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.version()
        }
        #endif

        let request = try authorizedRequest(apiURL("/version"))
        return try await perform(request)
    }

    /// Exchange an Apple identity token for an API token via the backend.
    func signInWithApple(identityToken: String, fullName: PersonNameComponents?, email: String?) async throws -> AppleSignInResponse {
        var payload: [String: Any] = ["identityToken": identityToken]
        if let email { payload["email"] = email }
        if let fullName {
            var nameDict: [String: String] = [:]
            if let givenName = fullName.givenName { nameDict["givenName"] = givenName }
            if let familyName = fullName.familyName { nameDict["familyName"] = familyName }
            if !nameDict.isEmpty { payload["fullName"] = nameDict }
        }
        let body = try JSONSerialization.data(withJSONObject: payload)

        let url = baseURL.appendingPathComponent("auth/apple/mobile")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try await perform(request)
    }

    /// Exchange a native Google OAuth authorization code for an API token via the backend.
    func signInWithGoogle(code: String, redirectURI: String, codeVerifier: String) async throws -> AppleSignInResponse {
        let payload: [String: Any] = [
            "code": code,
            "redirectUri": redirectURI,
            "codeVerifier": codeVerifier
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)

        let url = baseURL.appendingPathComponent("auth/google/mobile")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try await perform(request)
    }

    func signInWithDevBypass() async throws -> AppleSignInResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            let user = ScreenshotSeedData.user
            return AppleSignInResponse(
                ok: true,
                token: "screenshot-token",
                user: AppleSignInUser(id: user.id, name: user.name, email: user.email)
            )
        }
        #endif

        let url = baseURL.appendingPathComponent("auth/dev/mobile")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await perform(request)
    }

    // MARK: - Dashboard

    func getDashboard(date: String? = nil, limit: Int = 100, offset: Int = 0) async throws -> DashboardResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.dashboard(date: date, limit: limit, offset: offset)
        }
        #endif

        var components = URLComponents(url: apiURL("/dashboard"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = []
        if let date { queryItems.append(.init(name: "date", value: date)) }
        if limit != 100 { queryItems.append(.init(name: "limit", value: "\(limit)")) }
        if offset > 0 { queryItems.append(.init(name: "offset", value: "\(offset)")) }
        if !queryItems.isEmpty { components.queryItems = queryItems }

        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    // MARK: - Coach Dismissals

    func getCoachDismissals() async throws -> CoachDismissalsResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.coachDismissals()
        }
        #endif

        let request = try authorizedRequest(apiURL("/coach/dismissals"))
        return try await perform(request)
    }

    func syncCoachDismissals(_ dismissals: [CoachDismissalRecord]) async throws -> CoachDismissalsResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.coachDismissals()
        }
        #endif

        let payload = ["dismissals": dismissals.map { record -> [String: Any] in
            var item: [String: Any] = [
                "type": record.type,
                "key": record.key
            ]
            if let dismissedUntil = record.dismissedUntil {
                item["dismissedUntil"] = dismissedUntil
            }
            return item
        }]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/coach/dismissals"), method: "PUT", body: body)
        return try await perform(request)
    }

    func resetSyncedCoachDismissals() async throws {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return
        }
        #endif

        let request = try authorizedRequest(apiURL("/coach/dismissals"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Meal Parsing

    func parseMeal(text: String, consumedAt: String? = nil, imageDataUrl: String? = nil, imageDataUrls: [String] = []) async throws -> ParseMealResponse {
        var payload: [String: Any] = ["text": text]
        if let consumedAt { payload["consumedAt"] = consumedAt }
        var images = imageDataUrls
        if let imageDataUrl { images.append(imageDataUrl) }
        if !images.isEmpty { payload["imageDataUrls"] = images }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/parse-meal"), method: "POST", body: body)
        return try await perform(request)
    }

    func lookupBarcode(_ barcode: String) async throws -> BarcodeLookupResponse {
        let encoded = barcode.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? barcode
        let request = try authorizedRequest(apiURL("/barcode/\(encoded)"))
        return try await perform(request)
    }

    func saveMealEntries(
        items: [[String: Any]],
        consumedAt: String,
        mealName: String? = nil,
        mealQuantity: Double? = nil,
        mealUnit: String? = nil,
        itemsAreMealUnit: Bool = false,
        source: String? = nil,
        sourceDetail: String? = nil,
        saveItems: [[String: Any]] = []
    ) async throws {
        var payload: [String: Any] = ["items": items, "consumedAt": consumedAt]
        if let mealName { payload["mealName"] = mealName }
        if let mealQuantity { payload["mealQuantity"] = mealQuantity }
        if let mealUnit { payload["mealUnit"] = mealUnit }
        if itemsAreMealUnit { payload["itemsAreMealUnit"] = true }
        if let source { payload["source"] = source }
        if let sourceDetail { payload["sourceDetail"] = sourceDetail }
        if !saveItems.isEmpty { payload["saveItems"] = saveItems }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/entries/bulk"), method: "POST", body: body)
        do {
            let _: OkResponse = try await perform(request)
        } catch {
            if shouldQueueMutation(after: error) {
                queueMutation(path: "/entries/bulk", method: "POST", body: body, summary: mealName ?? "Meal entry")
                return
            }
            throw error
        }
    }

    func updateEntry(
        id: Int,
        itemName: String,
        quantity: Double,
        unit: String,
        calories: Double,
        protein: Double,
        carbs: Double,
        fat: Double,
        consumedAt: String? = nil
    ) async throws {
        var payload: [String: Any] = [
            "itemName": itemName,
            "quantity": quantity,
            "unit": unit,
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fat": fat
        ]
        if let consumedAt { payload["consumedAt"] = consumedAt }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/entries/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteEntry(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/entries/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    func copyEntryToToday(entryId: Int) async throws -> CopyEntriesResponse {
        let payload: [String: Any] = ["entryId": entryId]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/entries/copy-to-today"), method: "POST", body: body)
        return try await perform(request)
    }

    // MARK: - Meal Groups

    func combineEntries(entryIds: [Int], mealName: String = "Meal") async throws {
        let payload: [String: Any] = ["entryIds": entryIds, "mealName": mealName]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/entries/combine"), method: "POST", body: body)
        let _: CombineResponse = try await perform(request)
    }

    func removeFromGroup(entryId: Int) async throws {
        let request = try authorizedRequest(apiURL("/entries/\(entryId)/remove-from-group"), method: "POST")
        let _: OkResponse = try await perform(request)
    }

    func splitMealGroup(mealGroup: String) async throws {
        let request = try authorizedRequest(apiURL("/meal-group/\(mealGroup)/split"), method: "POST")
        let _: OkResponse = try await perform(request)
    }

    func scaleMealGroup(mealGroup: String, quantity: Double, unit: String = "serving", name: String? = nil) async throws {
        var payload: [String: Any] = ["quantity": quantity, "unit": unit]
        if let name { payload["name"] = name }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/meal-group/\(mealGroup)/scale"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func copyMealToToday(mealGroup: String) async throws -> CopyEntriesResponse {
        let payload: [String: Any] = ["mealGroup": mealGroup]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/entries/copy-to-today"), method: "POST", body: body)
        return try await perform(request)
    }

    // MARK: - Saved Items

    func getSavedItems() async throws -> [SavedItem] {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.savedItems()
        }
        #endif

        let request = try authorizedRequest(apiURL("/saved-items"))
        return try await perform(request)
    }

    func addSavedItem(name: String, quantity: Double, unit: String, calories: Double, protein: Double, carbs: Double, fat: Double, components: [[String: Any]] = []) async throws -> Int {
        var payload: [String: Any] = [
            "name": name,
            "quantity": quantity,
            "unit": unit,
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fat": fat
        ]
        if !components.isEmpty { payload["components"] = components }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/saved-items"), method: "POST", body: body)
        let response: CreatedIdResponse = try await perform(request)
        return response.id
    }

    func updateSavedItem(id: Int, name: String, quantity: Double, unit: String, calories: Double, protein: Double, carbs: Double, fat: Double, components: [[String: Any]]? = nil) async throws {
        var payload: [String: Any] = [
            "name": name,
            "quantity": quantity,
            "unit": unit,
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fat": fat
        ]
        if let components { payload["components"] = components }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/saved-items/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteSavedItem(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/saved-items/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    func addStarterQuickAdds() async throws -> StarterQuickAddsResponse {
        let request = try authorizedRequest(apiURL("/starter-quick-adds"), method: "POST")
        return try await perform(request)
    }

    func quickAdd(savedItemId: Int, multiplier: Double = 1, consumedAt: String) async throws {
        let payload: [String: Any] = [
            "savedItemId": savedItemId,
            "multiplier": multiplier,
            "consumedAt": consumedAt
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/quick-add"), method: "POST", body: body)
        do {
            let _: OkResponse = try await perform(request)
        } catch {
            if shouldQueueMutation(after: error) {
                queueMutation(path: "/quick-add", method: "POST", body: body, summary: "Quick add item")
                return
            }
            throw error
        }
    }

    // MARK: - Daily Totals

    func getDailyTotals(scope: String = "week") async throws -> DailyTotalsResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.dailyTotalsResponse(scope: scope)
        }
        #endif

        var components = URLComponents(url: apiURL("/daily-totals"), resolvingAgainstBaseURL: false)!
        components.queryItems = [.init(name: "scope", value: scope)]
        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    // MARK: - Macro Targets

    func setMacroTarget(macro: String, target: Double) async throws {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        let payload: [String: Any] = [
            "target": target,
            "effectiveDate": formatter.string(from: Date())
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/macro-targets/\(macro)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Weight

    func getWeights(scope: String = "month", limit: Int? = nil, offset: Int = 0) async throws -> WeightEntriesResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.weights(scope: scope, limit: limit, offset: offset)
        }
        #endif

        var components = URLComponents(url: apiURL("/weights"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = [.init(name: "scope", value: scope)]
        if let limit { queryItems.append(.init(name: "limit", value: "\(limit)")) }
        if offset > 0 { queryItems.append(.init(name: "offset", value: "\(offset)")) }
        components.queryItems = queryItems
        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    @discardableResult
    func addWeight(_ weight: Double, loggedAt: String, source: String? = nil, externalId: String? = nil) async throws -> EntryMutationResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.mutationOK(id: 9001)
        }
        #endif

        var payload: [String: Any] = ["weight": weight, "loggedAt": loggedAt]
        if let source { payload["source"] = source }
        if let externalId { payload["externalId"] = externalId }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/weights"), method: "POST", body: body)
        do {
            return try await perform(request)
        } catch {
            if shouldQueueMutation(after: error) {
                queueMutation(path: "/weights", method: "POST", body: body, summary: "Weight entry")
                return EntryMutationResponse(ok: true, id: nil, created: true)
            }
            throw error
        }
    }

    func updateWeight(id: Int, weight: Double, loggedAt: String) async throws {
        let payload: [String: Any] = ["weight": weight, "loggedAt": loggedAt]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/weights/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteWeight(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/weights/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    func getWeightTarget() async throws -> WeightTarget {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.weightTarget()
        }
        #endif

        let request = try authorizedRequest(apiURL("/weight-target"))
        return try await perform(request)
    }

    func setWeightTarget(targetWeight: Double?, targetDate: String?) async throws {
        var payload: [String: Any] = [:]
        if let targetWeight { payload["targetWeight"] = targetWeight }
        if let targetDate { payload["targetDate"] = targetDate }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        payload["effectiveDate"] = formatter.string(from: Date())
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/weight-target"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Workouts

    func getWorkouts(limit: Int = 100, offset: Int = 0, scope: String = "week") async throws -> WorkoutsResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.workouts(limit: limit, offset: offset, scope: scope)
        }
        #endif

        var components = URLComponents(url: apiURL("/workouts"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = [.init(name: "scope", value: scope)]
        if limit != 100 { queryItems.append(.init(name: "limit", value: "\(limit)")) }
        if offset > 0 { queryItems.append(.init(name: "offset", value: "\(offset)")) }
        components.queryItems = queryItems

        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    func parseWorkout(text: String) async throws -> ParseWorkoutResponse {
        let payload = ["text": text]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/parse-workout"), method: "POST", body: body)
        return try await perform(request)
    }

    @discardableResult
    func addWorkout(
        description: String,
        intensity: String,
        durationHours: Double,
        caloriesBurned: Double,
        loggedAt: String,
        source: String? = nil,
        externalId: String? = nil
    ) async throws -> WorkoutMutationResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return WorkoutMutationResponse(ok: true, id: 9002, created: true)
        }
        #endif

        var payload: [String: Any] = [
            "description": description,
            "intensity": intensity,
            "durationHours": durationHours,
            "caloriesBurned": caloriesBurned,
            "loggedAt": loggedAt
        ]
        if let source { payload["source"] = source }
        if let externalId { payload["externalId"] = externalId }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/workouts"), method: "POST", body: body)
        do {
            return try await perform(request)
        } catch {
            if shouldQueueMutation(after: error) {
                queueMutation(path: "/workouts", method: "POST", body: body, summary: description)
                return WorkoutMutationResponse(ok: true, id: nil, created: true)
            }
            throw error
        }
    }

    func updateWorkout(id: Int, description: String, intensity: String, durationHours: Double, caloriesBurned: Double, loggedAt: String) async throws {
        let payload: [String: Any] = [
            "description": description,
            "intensity": intensity,
            "durationHours": durationHours,
            "caloriesBurned": caloriesBurned,
            "loggedAt": loggedAt
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/workouts/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteWorkout(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/workouts/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    func syncWorkouts() async throws -> SyncWorkoutsResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return SyncWorkoutsResponse(message: "Screenshot mode", syncedCount: 0)
        }
        #endif

        let request = try authorizedRequest(apiURL("/sync-workouts"), method: "POST")
        return try await perform(request)
    }

    // MARK: - Analysis

    func getLatestAnalysis() async throws -> AnalysisReport? {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.latestAnalysis()
        }
        #endif

        let request = try authorizedRequest(apiURL("/analysis/latest"))
        let response: AnalysisReportResponse = try await perform(request)
        return response.report
    }

    func generateAnalysis(days: Int = 90) async throws -> AnalysisReport? {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.latestAnalysis()
        }
        #endif

        let payload: [String: Any] = ["days": days]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/analysis"), method: "POST", body: body)
        let response: AnalysisReportResponse = try await perform(request)
        return response.report
    }

    // MARK: - Sexual Activity

    func getHealthEntries(scope: String = "week", limit: Int = 100, offset: Int = 0) async throws -> HealthEntriesResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.healthEntries(scope: scope, limit: limit, offset: offset)
        }
        #endif

        var components = URLComponents(url: apiURL("/sexual-activity"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = [.init(name: "scope", value: scope)]
        if limit != 100 { queryItems.append(.init(name: "limit", value: "\(limit)")) }
        if offset > 0 { queryItems.append(.init(name: "offset", value: "\(offset)")) }
        components.queryItems = queryItems
        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    @discardableResult
    func addHealthEntry(type: String, loggedAt: String, source: String? = nil, externalId: String? = nil) async throws -> EntryMutationResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.mutationOK(id: 9003)
        }
        #endif

        var payload: [String: Any] = ["type": type, "loggedAt": loggedAt]
        if let source { payload["source"] = source }
        if let externalId { payload["externalId"] = externalId }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/sexual-activity"), method: "POST", body: body)
        do {
            return try await perform(request)
        } catch {
            if shouldQueueMutation(after: error) {
                queueMutation(path: "/sexual-activity", method: "POST", body: body, summary: "Sexual activity entry")
                return EntryMutationResponse(ok: true, id: nil, created: true)
            }
            throw error
        }
    }

    func updateHealthEntry(id: Int, type: String, loggedAt: String) async throws {
        let payload: [String: Any] = ["type": type, "loggedAt": loggedAt]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/sexual-activity/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteHealthEntry(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/sexual-activity/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Sleep

    func getSleepEntries(scope: String = "week", limit: Int = 100, offset: Int = 0) async throws -> SleepEntriesResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.sleepEntries(scope: scope, limit: limit, offset: offset)
        }
        #endif

        var components = URLComponents(url: apiURL("/sleep"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = [.init(name: "scope", value: scope)]
        if limit != 100 { queryItems.append(.init(name: "limit", value: "\(limit)")) }
        if offset > 0 { queryItems.append(.init(name: "offset", value: "\(offset)")) }
        components.queryItems = queryItems
        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    @discardableResult
    func addSleepEntry(durationHours: Double, wakeUps: Int, quality: Int? = nil, notes: String? = nil, loggedAt: String, source: String? = nil, externalId: String? = nil) async throws -> EntryMutationResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.mutationOK(id: 9004)
        }
        #endif

        var payload: [String: Any] = ["durationHours": durationHours, "wakeUps": wakeUps, "loggedAt": loggedAt]
        if let quality { payload["quality"] = quality }
        if let notes { payload["notes"] = notes }
        if let source { payload["source"] = source }
        if let externalId { payload["externalId"] = externalId }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/sleep"), method: "POST", body: body)
        do {
            return try await perform(request)
        } catch {
            if shouldQueueMutation(after: error) {
                queueMutation(path: "/sleep", method: "POST", body: body, summary: "Sleep entry")
                return EntryMutationResponse(ok: true, id: nil, created: true)
            }
            throw error
        }
    }

    func updateSleepEntry(id: Int, durationHours: Double, wakeUps: Int, quality: Int?, notes: String?, loggedAt: String) async throws {
        var payload: [String: Any] = ["durationHours": durationHours, "wakeUps": wakeUps, "loggedAt": loggedAt]
        payload["quality"] = quality.map { $0 as Any } ?? NSNull()
        payload["notes"] = notes.map { $0 as Any } ?? NSNull()
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/sleep/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteSleepEntry(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/sleep/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Subscription

    func getSubscription() async throws -> SubscriptionResponse {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.subscription()
        }
        #endif

        let request = try authorizedRequest(apiURL("/subscription"))
        return try await perform(request)
    }

    func createCheckoutSession() async throws -> String {
        let request = try authorizedRequest(apiURL("/subscription/checkout"), method: "POST")
        let response: CheckoutResponse = try await perform(request)
        return response.url
    }

    func createPortalSession() async throws -> String {
        let request = try authorizedRequest(apiURL("/subscription/portal"), method: "POST")
        let response: CheckoutResponse = try await perform(request)
        return response.url
    }

    // MARK: - Account

    func exportData() async throws -> Data {
        let request = try authorizedRequest(apiURL("/account/export"))
        return try await performData(request)
    }

    func deleteAccount() async throws {
        let request = try authorizedRequest(apiURL("/account"), method: "DELETE")
        let _: OkResponse = try await perform(request)
        token = nil
    }

    // MARK: - API Tokens

    func createToken(name: String) async throws -> ApiToken {
        let payload = ["name": name]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/auth/tokens"), method: "POST", body: body)
        return try await perform(request)
    }

    func listTokens() async throws -> [ApiToken] {
        let request = try authorizedRequest(apiURL("/auth/tokens"))
        let response: ApiTokenListResponse = try await perform(request)
        return response.tokens
    }

    func deleteToken(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/auth/tokens/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    func deleteAllTokens() async throws {
        let request = try authorizedRequest(apiURL("/auth/tokens"), method: "DELETE")
        let _: OkResponse = try await perform(request)
        token = nil
    }
}

// MARK: - Keychain Helper

enum KeychainHelper {
    static func save(key: String, value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)

        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
