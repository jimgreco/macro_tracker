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
        defer { isLoading = false }

        if api.token != nil {
            do {
                user = try await api.getMe()
                isAuthenticated = user != nil
                if isAuthenticated {
                    return
                }
            } catch {
                api.token = nil
                isAuthenticated = false
                user = nil
            }
        }

        #if DEBUG
        guard shouldAttemptLocalDevBypass else { return }

        do {
            try await signInWithDevBypass()
        } catch {
            isAuthenticated = false
            user = nil
        }
        #endif
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

    func signInWithDevBypass() async throws {
        let result = try await api.signInWithDevBypass()
        api.token = result.token
        user = User(
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            picture: nil,
            provider: "local-dev"
        )
        isAuthenticated = true
    }

    func signInWithGoogle(code: String, redirectURI: String, codeVerifier: String) async throws {
        let result = try await api.signInWithGoogle(code: code, redirectURI: redirectURI, codeVerifier: codeVerifier)
        api.token = result.token
        user = User(
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            picture: nil,
            provider: "google"
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

    private var shouldAttemptLocalDevBypass: Bool {
        guard let host = api.baseURL.host?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }
}
