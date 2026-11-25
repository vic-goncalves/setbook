import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Runs Google sign-in through the system browser sheet. The app keeps a PKCE verifier and
/// only its hash leaves the device, so the one-time code returned via setbook:// is useless
/// to anything else that might receive it.
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    struct Result {
        let code: String
        let verifier: String
    }

    enum Failure: LocalizedError {
        case cancelled
        case server(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: nil
            case .server("google_not_configured"): "Google sign-in isn't set up on the server yet."
            case .server(let reason): "Google sign-in didn't complete (\(reason))."
            }
        }
    }

    func start(origin: URL) async throws -> Result {
        let verifier = Self.randomVerifier()
        let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        var components = URLComponents(url: origin.appending(path: "v1/auth/google/start"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "platform", value: "ios"), URLQueryItem(name: "challenge", value: challenge)]
        guard let url = components?.url else { throw Failure.server("bad_url") }

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme("setbook")) { url, error in
                if let url {
                    continuation.resume(returning: url)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: Failure.cancelled)
                } else {
                    continuation.resume(throwing: error ?? Failure.cancelled)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value { throw Failure.server(error) }
        guard let code = items.first(where: { $0.name == "code" })?.value else { throw Failure.server("no_code") }
        return Result(code: code, verifier: verifier)
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }

    private static func randomVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 48)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64url(Data(bytes))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
