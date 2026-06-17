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

        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            ScreenshotSeedData.prepareRuntimeStateIfNeeded()
            api.token = nil
            api.endLocalDevOfflineSession()
            user = ScreenshotSeedData.user
            isAuthenticated = true
            return
        }
        #endif

        if api.token != nil {
            do {
                user = try await api.getMe()
                isAuthenticated = user != nil
                if isAuthenticated {
                    return
                }
            } catch {
                Diagnostics.shared.record(level: "warning", category: "auth", message: "Stored token refresh failed", details: ["error": error.localizedDescription])
                api.token = nil
                isAuthenticated = false
                user = nil
            }
        }

        #if DEBUG
        guard localDevBypassAvailable else { return }

        await signInWithLocalDevUser()
        #endif
    }

    func refreshUser() async {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            user = ScreenshotSeedData.user
            isAuthenticated = true
            return
        }
        #endif

        #if DEBUG
        if api.isLocalDevOfflineSession, localDevBypassAvailable {
            do {
                try await signInWithDevBypass()
            } catch {
                Diagnostics.shared.record(level: "warning", category: "auth", message: "Local dev token refresh unavailable", details: ["error": error.localizedDescription])
            }
            return
        }
        #endif

        guard api.token != nil else { return }
        do {
            user = try await api.getMe()
            isAuthenticated = user != nil
        } catch {
            Diagnostics.shared.record(level: "warning", category: "auth", message: "User refresh failed", details: ["error": error.localizedDescription])
        }
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
        user = (try? await api.getMe()) ?? User(
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            picture: nil,
            provider: "apple"
        )
        isAuthenticated = true
        Diagnostics.shared.record(category: "auth", message: "Signed in with Apple")
    }

    func signInWithDevBypass() async throws {
        let result = try await api.signInWithDevBypass()
        api.token = result.token
        api.endLocalDevOfflineSession()
        user = (try? await api.getMe()) ?? User(
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            picture: nil,
            provider: "local-dev"
        )
        isAuthenticated = true
        Diagnostics.shared.record(category: "auth", message: "Signed in with local dev bypass")
    }

    #if DEBUG
    func signInWithLocalDevUser() async {
        guard localDevBypassAvailable else { return }

        do {
            try await signInWithDevBypass()
        } catch {
            signInWithOfflineLocalDevUser(fallbackError: error)
        }
    }

    private func signInWithOfflineLocalDevUser(fallbackError: Error) {
        api.beginLocalDevOfflineSession()
        user = User(
            id: "local-dev-user",
            name: "Local Preview User",
            email: "local-preview@example.com",
            picture: nil,
            provider: "local-dev"
        )
        isAuthenticated = true
        Diagnostics.shared.record(
            level: "warning",
            category: "auth",
            message: "Launched local dev user without backend",
            details: ["error": fallbackError.localizedDescription]
        )
    }
    #endif

    func signInWithGoogle(code: String, redirectURI: String, codeVerifier: String) async throws {
        let result = try await api.signInWithGoogle(code: code, redirectURI: redirectURI, codeVerifier: codeVerifier)
        api.token = result.token
        user = (try? await api.getMe()) ?? User(
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            picture: nil,
            provider: "google"
        )
        isAuthenticated = true
        Diagnostics.shared.record(category: "auth", message: "Signed in with Google")
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
            Diagnostics.shared.record(category: "auth", message: "Handled Google callback")
            Task {
                if let refreshed = try? await api.getMe() {
                    user = refreshed
                }
            }
        }
    }

    func signOut() {
        api.token = nil
        api.endLocalDevOfflineSession()
        user = nil
        isAuthenticated = false
        Diagnostics.shared.record(category: "auth", message: "Signed out")
    }

    func signOutEverywhere() async throws {
        if api.token != nil {
            try await api.deleteAllTokens()
        }
        api.endLocalDevOfflineSession()
        user = nil
        isAuthenticated = false
        Diagnostics.shared.record(category: "auth", message: "Signed out everywhere")
    }

    var isLocalDevUser: Bool {
        user?.provider == "local-dev"
    }

    var localDevBypassAvailable: Bool {
        #if DEBUG
        guard let host = api.baseURL.host?.lowercased() else { return false }
        if host == "localhost" || host == "127.0.0.1" || host == "::1" || host.hasSuffix(".local") {
            return true
        }
        if host.hasPrefix("10.") || host.hasPrefix("192.168.") {
            return true
        }

        let parts = host.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 172 && (16...31).contains(parts[1])
        #else
        return false
        #endif
    }
}
