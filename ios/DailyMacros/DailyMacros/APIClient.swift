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
        if stored.isEmpty {
            #if DEBUG
            return URL(string: "http://localhost:3000")!
            #else
            return URL(string: "https://yourdomain.com")!
            #endif
        }
        return URL(string: stored) ?? URL(string: "http://localhost:3000")!
    }

    @Published var token: String? {
        didSet {
            if let token {
                KeychainHelper.save(key: "api_token", value: token)
            } else {
                KeychainHelper.delete(key: "api_token")
            }
        }
    }

    init() {
        self.token = KeychainHelper.load(key: "api_token")
    }

    private func apiURL(_ path: String) -> URL {
        baseURL.appendingPathComponent("api/v1\(path)")
    }

    private func authorizedRequest(_ url: URL, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let token else { throw APIError.notAuthenticated }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.notAuthenticated
        }

        if httpResponse.statusCode >= 400 {
            if let errorResponse = try? decoder.decode(ErrorResponse.self, from: data) {
                throw APIError.serverError(errorResponse.error)
            }
            throw APIError.serverError("Request failed with status \(httpResponse.statusCode)")
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // MARK: - Auth

    func getMe() async throws -> User? {
        let request = try authorizedRequest(apiURL("/me"))
        let response: MeResponse = try await perform(request)
        return response.user
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

    // MARK: - Dashboard

    func getDashboard(date: String? = nil, limit: Int = 100, offset: Int = 0) async throws -> DashboardResponse {
        var components = URLComponents(url: apiURL("/dashboard"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = []
        if let date { queryItems.append(.init(name: "date", value: date)) }
        if limit != 100 { queryItems.append(.init(name: "limit", value: "\(limit)")) }
        if offset > 0 { queryItems.append(.init(name: "offset", value: "\(offset)")) }
        if !queryItems.isEmpty { components.queryItems = queryItems }

        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    // MARK: - Meal Parsing

    func parseMeal(text: String, consumedAt: String? = nil) async throws -> ParseMealResponse {
        var payload: [String: Any] = ["text": text]
        if let consumedAt { payload["consumedAt"] = consumedAt }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/parse-meal"), method: "POST", body: body)
        return try await perform(request)
    }

    func saveMealEntries(items: [[String: Any]], consumedAt: String, mealName: String? = nil) async throws {
        var payload: [String: Any] = ["items": items, "consumedAt": consumedAt]
        if let mealName { payload["mealName"] = mealName }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/entries/bulk"), method: "POST", body: body)
        let _: OkResponse = try await perform(request)
    }

    func updateEntry(id: Int, itemName: String, quantity: Double, unit: String, calories: Double, protein: Double, carbs: Double, fat: Double) async throws {
        let payload: [String: Any] = [
            "itemName": itemName,
            "quantity": quantity,
            "unit": unit,
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fat": fat
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/entries/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteEntry(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/entries/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
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

    // MARK: - Saved Items

    func getSavedItems() async throws -> [SavedItem] {
        let request = try authorizedRequest(apiURL("/saved-items"))
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
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Daily Totals

    func getDailyTotals(scope: String = "week") async throws -> DailyTotalsResponse {
        var components = URLComponents(url: apiURL("/daily-totals"), resolvingAgainstBaseURL: false)!
        components.queryItems = [.init(name: "scope", value: scope)]
        let request = try authorizedRequest(components.url!)
        return try await perform(request)
    }

    // MARK: - Macro Targets

    func setMacroTarget(macro: String, target: Double) async throws {
        let payload: [String: Any] = ["target": target]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/macro-targets/\(macro)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Weight

    func getWeights(scope: String = "month") async throws -> [WeightEntry] {
        var components = URLComponents(url: apiURL("/weights"), resolvingAgainstBaseURL: false)!
        components.queryItems = [.init(name: "scope", value: scope)]
        let request = try authorizedRequest(components.url!)
        let response: WeightEntriesResponse = try await perform(request)
        return response.entries
    }

    func addWeight(_ weight: Double, loggedAt: String) async throws {
        let payload: [String: Any] = ["weight": weight, "loggedAt": loggedAt]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/weights"), method: "POST", body: body)
        let _: OkResponse = try await perform(request)
    }

    func deleteWeight(id: Int) async throws {
        let request = try authorizedRequest(apiURL("/weights/\(id)"), method: "DELETE")
        let _: OkResponse = try await perform(request)
    }

    func getWeightTarget() async throws -> WeightTarget {
        let request = try authorizedRequest(apiURL("/weight-target"))
        return try await perform(request)
    }

    func setWeightTarget(targetWeight: Double?, targetDate: String?) async throws {
        var payload: [String: Any] = [:]
        if let targetWeight { payload["targetWeight"] = targetWeight }
        if let targetDate { payload["targetDate"] = targetDate }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/weight-target"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Workouts

    func getWorkouts(limit: Int = 100, offset: Int = 0, scope: String = "week") async throws -> WorkoutsResponse {
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

    func addWorkout(description: String, intensity: String, durationHours: Double, caloriesBurned: Double, loggedAt: String) async throws {
        let payload: [String: Any] = [
            "description": description,
            "intensity": intensity,
            "durationHours": durationHours,
            "caloriesBurned": caloriesBurned,
            "loggedAt": loggedAt
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/workouts"), method: "POST", body: body)
        let _: OkResponse = try await perform(request)
    }

    func updateWorkout(id: Int, description: String, intensity: String, durationHours: Double, caloriesBurned: Double) async throws {
        let payload: [String: Any] = [
            "description": description,
            "intensity": intensity,
            "durationHours": durationHours,
            "caloriesBurned": caloriesBurned
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/workouts/\(id)"), method: "PUT", body: body)
        let _: OkResponse = try await perform(request)
    }

    // MARK: - Analysis

    func getLatestAnalysis() async throws -> AnalysisReport? {
        let request = try authorizedRequest(apiURL("/analysis/latest"))
        let response: AnalysisReportResponse = try await perform(request)
        return response.report
    }

    func generateAnalysis(days: Int = 90) async throws -> AnalysisReport? {
        let payload: [String: Any] = ["days": days]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let request = try authorizedRequest(apiURL("/analysis"), method: "POST", body: body)
        let response: AnalysisReportResponse = try await perform(request)
        return response.report
    }

    // MARK: - Subscription

    func getSubscription() async throws -> SubscriptionResponse {
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
        let (data, _) = try await session.data(for: request)
        return data
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
