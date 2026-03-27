import Foundation
import AuthenticationServices
import SwiftUI

@MainActor
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var user: User?
    @Published var isLoading = true

    private let api = APIClient.shared

    init() {
        Task { await checkAuth() }
    }

    func checkAuth() async {
        guard api.token != nil else {
            isLoading = false
            return
        }

        do {
            user = try await api.getMe()
            isAuthenticated = user != nil
        } catch {
            isAuthenticated = false
            user = nil
        }
        isLoading = false
    }

    /// Sign in by entering an API token generated from the web app.
    func signIn(token: String) async throws {
        api.token = token
        let fetchedUser = try await api.getMe()
        guard fetchedUser != nil else {
            api.token = nil
            throw APIError.notAuthenticated
        }
        user = fetchedUser
        isAuthenticated = true
    }

    /// Sign in with Apple — sends the identity token to the backend for verification.
    func signInWithApple(authorization: ASAuthorization) async throws {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8) else {
            throw APIError.serverError("Invalid Apple credential.")
        }

        let fullName = credential.fullName
        let email = credential.email

        let result = try await api.signInWithApple(
            identityToken: identityToken,
            fullName: fullName,
            email: email
        )

        api.token = result.token
        user = User(
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            picture: nil,
            provider: "apple"
        )
        isAuthenticated = true
    }

    /// Handle callback URL from Google OAuth (via ASWebAuthenticationSession)
    func handleGoogleCallback(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else { return }

        let params = Dictionary(uniqueKeysWithValues: queryItems.compactMap { item in
            item.value.map { (item.name, $0) }
        })

        if let token = params["token"], !token.isEmpty {
            api.token = token
            user = User(
                id: params["id"] ?? "",
                name: params["name"],
                email: params["email"],
                picture: nil,
                provider: "google"
            )
            isAuthenticated = true
        }
    }

    func signOut() {
        api.token = nil
        user = nil
        isAuthenticated = false
    }
}
