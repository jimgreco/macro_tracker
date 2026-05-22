import SwiftUI
import AuthenticationServices
import CryptoKit

struct LoginView: View {
    @EnvironmentObject var auth: AuthManager
    private let api = APIClient.shared
    @State private var errorMessage: String?
    @State private var isSigningIn = false
    @State private var webAuthSession: ASWebAuthenticationSession?

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 8) {
                    DailyMacrosLogoMark()
                        .frame(width: 72, height: 72)

                    Text("DailyMacros")
                        .font(.largeTitle.bold())

                    Text("Track your nutrition, weight, and workouts")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 12) {
                    // Sign in with Apple button
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.fullName, .email]
                    } onCompletion: { result in
                        Task { await handleAppleSignIn(result) }
                    }
                    .signInWithAppleButtonStyle(.white)
                    .frame(height: 50)
                    .cornerRadius(12)

                    // Sign in with Google button
                    Button {
                        Task { await signInWithGoogle() }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "g.circle.fill")
                                .font(.title2)
                            Text("Sign in with Google")
                                .font(.body.weight(.medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(.white)
                        .foregroundStyle(.black.opacity(0.85))
                        .cornerRadius(12)
                    }
                }
                .padding(.horizontal)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                Spacer()
                Spacer()
            }
        }
    }

    // MARK: - Actions

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) async {
        errorMessage = nil
        isSigningIn = true
        defer { isSigningIn = false }

        switch result {
        case .success(let authorization):
            do {
                try await auth.signInWithApple(authorization: authorization)
            } catch {
                errorMessage = error.localizedDescription
            }
        case .failure(let error):
            // Don't show error if user cancelled
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            errorMessage = error.localizedDescription
        }
    }

    private func signInWithGoogle() async {
        errorMessage = nil
        isSigningIn = true
        defer { isSigningIn = false }

        guard let googleClientID = Bundle.main.object(forInfoDictionaryKey: "GoogleIOSClientID") as? String,
              !googleClientID.isEmpty,
              let googleRedirectScheme = googleRedirectScheme(for: googleClientID) else {
            errorMessage = "Google sign-in is not configured."
            return
        }

        let redirectURI = "\(googleRedirectScheme):/oauth2redirect"
        let codeVerifier = makeCodeVerifier()
        let codeChallenge = codeChallenge(for: codeVerifier)
        let state = makeCodeVerifier()

        guard var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth") else {
            errorMessage = "Invalid Google sign-in URL."
            return
        }
        components.queryItems = [
            URLQueryItem(name: "client_id", value: googleClientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "prompt", value: "select_account")
        ]

        guard let url = components.url else {
            errorMessage = "Invalid Google sign-in URL."
            return
        }

        do {
            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let session = ASWebAuthenticationSession(
                    url: url,
                    callbackURLScheme: googleRedirectScheme
                ) { [self] callbackURL, error in
                    self.webAuthSession = nil
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let callbackURL {
                        continuation.resume(returning: callbackURL)
                    } else {
                        continuation.resume(throwing: APIError.serverError("Google sign-in failed."))
                    }
                }
                session.prefersEphemeralWebBrowserSession = false
                session.presentationContextProvider = GoogleSignInContextProvider.shared
                self.webAuthSession = session  // retain the session
                session.start()
            }

            guard let callbackComponents = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                  let queryItems = callbackComponents.queryItems else {
                errorMessage = "Google sign-in failed. No callback received."
                return
            }

            if let error = queryItems.first(where: { $0.name == "error" })?.value {
                errorMessage = "Sign-in failed: \(error)"
                return
            }

            guard queryItems.first(where: { $0.name == "state" })?.value == state else {
                errorMessage = "Google sign-in failed. Invalid callback."
                return
            }

            guard let code = queryItems.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
                errorMessage = "Google sign-in failed. No code received."
                return
            }

            try await auth.signInWithGoogle(code: code, redirectURI: redirectURI, codeVerifier: codeVerifier)
        } catch {
            // ASWebAuthenticationSessionError.canceledLogin = user dismissed
            if (error as NSError).domain == "com.apple.AuthenticationServices.WebAuthenticationSession",
               (error as NSError).code == 1 {
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    private func googleRedirectScheme(for clientID: String) -> String? {
        let suffix = ".apps.googleusercontent.com"
        guard clientID.hasSuffix(suffix) else { return nil }
        let idPart = String(clientID.dropLast(suffix.count))
        guard !idPart.isEmpty else { return nil }
        return "com.googleusercontent.apps.\(idPart)"
    }

    private func makeCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            return UUID().uuidString.replacingOccurrences(of: "-", with: "")
        }
        return Data(bytes).base64URLEncodedString()
    }

    private func codeChallenge(for verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64URLEncodedString()
    }

}

private struct DailyMacrosLogoMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.06, green: 0.14, blue: 0.25),
                            Color(red: 0.03, green: 0.07, blue: 0.12),
                            Color(red: 0.07, green: 0.09, blue: 0.17)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(.white.opacity(0.08), lineWidth: 1)
                }
                .overlay(alignment: .topLeading) {
                    Capsule()
                        .fill(.white.opacity(0.12))
                        .frame(width: 46, height: 16)
                        .rotationEffect(.degrees(14))
                        .offset(x: 9, y: 7)
                }

            Circle()
                .fill(Color(red: 0.05, green: 0.09, blue: 0.16))
                .overlay {
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [
                                    .white.opacity(0.82),
                                    Color(red: 0, green: 0.81, blue: 1).opacity(0.52),
                                    Color(red: 0.02, green: 1, blue: 0.63).opacity(0.62)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 3
                        )
                }
                .frame(width: 45, height: 45)
                .offset(y: 2)

            HStack(alignment: .bottom, spacing: 4) {
                Capsule()
                    .fill(Color(red: 0.02, green: 1, blue: 0.63))
                    .frame(width: 8, height: 17)
                Capsule()
                    .fill(Color(red: 0, green: 0.81, blue: 1))
                    .frame(width: 8, height: 25)
                Capsule()
                    .fill(Color(red: 1, green: 0.18, blue: 0.47))
                    .frame(width: 8, height: 20)
            }
            .offset(y: 9)

            Capsule()
                .fill(.white.opacity(0.34))
                .frame(width: 30, height: 3)
                .offset(y: 25)

            Circle()
                .fill(Color(red: 1, green: 0.79, blue: 0.16))
                .frame(width: 8, height: 8)
                .offset(x: 17, y: -20)
        }
        .shadow(color: Color(red: 0, green: 0.81, blue: 1).opacity(0.24), radius: 18, y: 9)
        .shadow(color: Color(red: 0.02, green: 1, blue: 0.63).opacity(0.14), radius: 10, y: 3)
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - ASWebAuthenticationSession Context Provider

class GoogleSignInContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleSignInContextProvider()

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return ASPresentationAnchor()
        }
        return window
    }
}
