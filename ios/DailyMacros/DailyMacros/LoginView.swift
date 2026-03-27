import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @EnvironmentObject var auth: AuthManager
    private let api = APIClient.shared
    @State private var token = ""
    @State private var serverURL = ""
    @State private var errorMessage: String?
    @State private var isSigningIn = false
    @State private var showTokenLogin = false
    @State private var webAuthSession: ASWebAuthenticationSession?

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 8) {
                    Image(systemName: "chart.bar.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(.cyan)

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

                    // Token-based sign in toggle
                    Button {
                        withAnimation { showTokenLogin.toggle() }
                    } label: {
                        HStack {
                            Image(systemName: "key.fill")
                            Text("Sign in with API Token")
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.top, 4)
                }
                .padding(.horizontal)

                if showTokenLogin {
                    tokenLoginSection
                }

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

    private var tokenLoginSection: some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Server URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("https://yourdomain.com", text: $serverURL)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("API Token")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                SecureField("Paste your API token", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }

            Text("Generate a token at your DailyMacros web app under Settings.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                Task { await signInWithToken() }
            } label: {
                if isSigningIn {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Sign In")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(token.isEmpty || isSigningIn)
        }
        .padding(.horizontal)
        .transition(.opacity.combined(with: .move(edge: .top)))
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

        let authURL = api.baseURL.appendingPathComponent("auth/google")
        guard var components = URLComponents(url: authURL, resolvingAgainstBaseURL: false) else {
            errorMessage = "Invalid server URL."
            return
        }
        components.queryItems = [URLQueryItem(name: "mobile", value: "1")]

        guard let url = components.url else {
            errorMessage = "Invalid server URL."
            return
        }

        do {
            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let session = ASWebAuthenticationSession(
                    url: url,
                    callbackURLScheme: "dailymacros"
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

            auth.handleGoogleCallback(url: callbackURL)
            if !auth.isAuthenticated {
                // Check for error in callback
                if let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                   let error = components.queryItems?.first(where: { $0.name == "error" })?.value {
                    errorMessage = "Sign-in failed: \(error)"
                } else {
                    errorMessage = "Google sign-in failed. No token received."
                }
            }
        } catch {
            // ASWebAuthenticationSessionError.canceledLogin = user dismissed
            if (error as NSError).domain == "com.apple.AuthenticationServices.WebAuthenticationSession",
               (error as NSError).code == 1 {
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    private func signInWithToken() async {
        errorMessage = nil
        isSigningIn = true
        defer { isSigningIn = false }

        if !serverURL.isEmpty {
            UserDefaults.standard.set(serverURL, forKey: "api_base_url")
        }

        do {
            try await auth.signIn(token: token)
        } catch {
            errorMessage = error.localizedDescription
        }
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
