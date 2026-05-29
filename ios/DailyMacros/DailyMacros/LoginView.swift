import SwiftUI
import AuthenticationServices
import CryptoKit

struct LoginView: View {
    @EnvironmentObject var auth: AuthManager
    private let api = APIClient.shared
    private let buildHashDigits = 7
    @State private var errorMessage: String?
    @State private var isSigningIn = false
    @State private var webAuthSession: ASWebAuthenticationSession?

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                ZStack {
                    LoginBackground()
                        .ignoresSafeArea()

                    ScrollView {
                        VStack {
                            loginCard
                        }
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: proxy.size.height)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 32)
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var loginCard: some View {
        VStack(spacing: 22) {
            loginBrand

            Text("Sign in to continue to the app.")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(LoginPalette.muted)
                .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 14) {
                googleButton
                LoginDivider()
                appleButton

                #if DEBUG
                if auth.localDevBypassAvailable {
                    LoginDivider()
                    devBypassButton
                }
                #endif
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(LoginPalette.error)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }

            if let loginBuildLabel {
                Text(loginBuildLabel)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(LoginPalette.muted)
                    .frame(maxWidth: .infinity)
                    .textSelection(.enabled)
            }
        }
        .padding(20)
        .frame(maxWidth: 420)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(LoginPalette.card)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(LoginPalette.line, lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.55), radius: 32, y: 20)
        .shadow(color: LoginPalette.cyan.opacity(0.08), radius: 26)
    }

    private var loginBrand: some View {
        HStack(spacing: 10) {
            DailyMacrosLogoMark()
                .frame(width: 42, height: 42)

            Text("DailyMacros")
                .font(.system(size: 34, weight: .heavy))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            Color(red: 0.92, green: 0.96, blue: 1),
                            LoginPalette.cyan,
                            LoginPalette.green
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("DailyMacros")
    }

    private var googleButton: some View {
        Button {
            Task { await signInWithGoogle() }
        } label: {
            HStack(spacing: 14) {
                GoogleLogoMark()
                    .frame(width: 28, height: 28)

                Text("Continue with Google")
                    .font(.system(size: 19, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .foregroundStyle(LoginPalette.cyan)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LoginPalette.googleButton)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(LoginPalette.googleBorder, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(isSigningIn)
        .opacity(isSigningIn ? 0.72 : 1)
    }

    private var appleButton: some View {
        SignInWithAppleButton(.continue) { request in
            request.requestedScopes = [.fullName, .email]
        } onCompletion: { result in
            Task { await handleAppleSignIn(result) }
        }
        .signInWithAppleButtonStyle(.black)
        .frame(height: 58)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        }
        .disabled(isSigningIn)
        .opacity(isSigningIn ? 0.72 : 1)
    }

    #if DEBUG
    private var devBypassButton: some View {
        Button {
            Task { await signInWithLocalDevUser() }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "hammer.circle.fill")
                    .font(.system(size: 26, weight: .semibold))

                Text("Continue as Local Dev User")
                    .font(.system(size: 18, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .foregroundStyle(LoginPalette.green)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LoginPalette.devButton)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(LoginPalette.devBorder, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(isSigningIn)
        .opacity(isSigningIn ? 0.72 : 1)
    }
    #endif

    private var loginBuildLabel: String? {
        let build = Bundle.main.object(forInfoDictionaryKey: "AppBuild") as? String
        let hash = Bundle.main.object(forInfoDictionaryKey: "GitCommitHash") as? String
        guard let value = shortBuildIdentifier(hash) ?? shortBuildIdentifier(build) else {
            return nil
        }
        return "Build \(value)"
    }

    // MARK: - Actions

    #if DEBUG
    private func signInWithLocalDevUser() async {
        errorMessage = nil
        isSigningIn = true
        defer { isSigningIn = false }

        await auth.signInWithLocalDevUser()
    }
    #endif

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

    private func shortBuildIdentifier(_ value: String?) -> String? {
        guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.isEmpty == false,
              raw.contains("$(") == false
        else {
            return nil
        }

        if raw.range(of: "^[0-9a-fA-F]{8,40}$", options: .regularExpression) != nil {
            return String(raw.prefix(buildHashDigits))
        }

        return raw
    }

}

private enum LoginPalette {
    static let background = Color(red: 0.027, green: 0.035, blue: 0.059)
    static let card = Color(red: 0.051, green: 0.067, blue: 0.118).opacity(0.95)
    static let line = Color(red: 0, green: 0.81, blue: 1).opacity(0.18)
    static let text = Color(red: 0.86, green: 0.91, blue: 1)
    static let muted = Color(red: 0.35, green: 0.43, blue: 0.54)
    static let cyan = Color(red: 0, green: 0.81, blue: 1)
    static let green = Color(red: 0.02, green: 1, blue: 0.63)
    static let googleButton = Color(red: 0.055, green: 0.16, blue: 0.22).opacity(0.9)
    static let googleBorder = Color(red: 0.56, green: 0.82, blue: 1).opacity(0.2)
    static let devButton = Color(red: 0.03, green: 0.19, blue: 0.13).opacity(0.9)
    static let devBorder = Color(red: 0.02, green: 1, blue: 0.63).opacity(0.22)
    static let error = Color(red: 1, green: 0.18, blue: 0.47)
}

private struct LoginBackground: View {
    var body: some View {
        ZStack {
            LoginPalette.background

            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.11, blue: 0.18).opacity(0.7),
                    .clear,
                    Color(red: 0, green: 0.16, blue: 0.1).opacity(0.5)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [
                    Color(red: 0, green: 0.24, blue: 0.39).opacity(0.45),
                    .clear
                ],
                center: UnitPoint(x: 0.18, y: 0.08),
                startRadius: 8,
                endRadius: 360
            )

            RadialGradient(
                colors: [
                    Color(red: 0, green: 0.31, blue: 0.2).opacity(0.3),
                    .clear
                ],
                center: UnitPoint(x: 0.82, y: 0.92),
                startRadius: 8,
                endRadius: 320
            )
        }
    }
}

private struct LoginDivider: View {
    var body: some View {
        HStack(spacing: 12) {
            Rectangle()
                .fill(LoginPalette.line)
                .frame(height: 1)

            Text("or")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(LoginPalette.muted)

            Rectangle()
                .fill(LoginPalette.line)
                .frame(height: 1)
        }
        .accessibilityHidden(true)
    }
}

private struct GoogleLogoMark: View {
    var body: some View {
        ZStack {
            Circle()
                .trim(from: 0.02, to: 0.25)
                .stroke(Color(red: 0.26, green: 0.52, blue: 0.96), style: StrokeStyle(lineWidth: 5, lineCap: .butt))
                .rotationEffect(.degrees(-8))

            Circle()
                .trim(from: 0.25, to: 0.42)
                .stroke(Color(red: 0.2, green: 0.66, blue: 0.33), style: StrokeStyle(lineWidth: 5, lineCap: .butt))
                .rotationEffect(.degrees(-8))

            Circle()
                .trim(from: 0.42, to: 0.62)
                .stroke(Color(red: 0.98, green: 0.74, blue: 0.02), style: StrokeStyle(lineWidth: 5, lineCap: .butt))
                .rotationEffect(.degrees(-8))

            Circle()
                .trim(from: 0.62, to: 0.88)
                .stroke(Color(red: 0.92, green: 0.26, blue: 0.21), style: StrokeStyle(lineWidth: 5, lineCap: .butt))
                .rotationEffect(.degrees(-8))

            Path { path in
                path.move(to: CGPoint(x: 14, y: 14))
                path.addLine(to: CGPoint(x: 25, y: 14))
                path.addLine(to: CGPoint(x: 25, y: 11))
                path.addLine(to: CGPoint(x: 14, y: 11))
            }
            .stroke(Color(red: 0.26, green: 0.52, blue: 0.96), style: StrokeStyle(lineWidth: 5, lineCap: .butt, lineJoin: .round))
        }
        .frame(width: 28, height: 28)
        .accessibilityHidden(true)
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
