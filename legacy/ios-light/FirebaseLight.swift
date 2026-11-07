import Foundation
import Combine

/// Uses Firebase's HTTPS REST APIs so this prototype needs no additional iOS packages.
@MainActor
final class FirebaseLight: ObservableObject {
    @Published private(set) var on = false
    @Published private(set) var signedIn = false
    @Published private(set) var busy = false
    @Published private(set) var connected = false
    @Published private(set) var status = "Sign in with your demo account"

    private let apiKey = "AIzaSyBmXRWv0t4go2_394LsK3OBY4FXC6h5rIw"
    private let databaseURL = "https://lightlink-cbe74-default-rtdb.firebaseio.com"
    private var idToken = ""
    private var refreshToken = ""
    private var uid = ""
    private var expiresAt = Date.distantPast
    private var session = UUID()

    private struct Login: Decodable {
        let idToken: String
        let refreshToken: String
        let localId: String
        let expiresIn: String
    }
    private struct Refresh: Decodable {
        let id_token: String
        let refresh_token: String
        let expires_in: String
    }
    private enum Failure: LocalizedError {
        case message(String)
        var errorDescription: String? {
            if case .message(let text) = self { return text }
            return nil
        }
    }

    private func fetch(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            if request.url?.host == "identitytoolkit.googleapis.com" {
                throw Failure.message("Sign-in failed. Check your email, password, and Firebase Email/Password setup.")
            }
            if request.url?.host == "securetoken.googleapis.com" {
                throw Failure.message("Session expired. Sign out and sign in again.")
            }
            throw Failure.message("Database access denied. Check the deployed rules and your account.")
        }
        return data
    }

    func signIn(email: String, password: String) async {
        guard !busy else { return }
        busy = true
        status = "Signing in…"
        defer { busy = false }
        do {
            let url = URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=\(apiKey)")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 10
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
                "password": password, "returnSecureToken": true
            ])
            let data = try await fetch(request)
            let login = try JSONDecoder().decode(Login.self, from: data)
            idToken = login.idToken
            refreshToken = login.refreshToken
            uid = login.localId
            expiresAt = Date().addingTimeInterval(Double(login.expiresIn) ?? 3600)
            session = UUID()
            signedIn = true
            status = "Loading light…"
        } catch { status = error.localizedDescription }
    }

    func signOut() {
        session = UUID()
        signedIn = false
        connected = false
        on = false
        idToken = ""
        refreshToken = ""
        uid = ""
        status = "Sign in with your demo account"
    }

    private func refreshCredentials() async throws {
        guard expiresAt.timeIntervalSinceNow < 60 else { return }
        let expected = session
        var request = URLRequest(url: URL(string: "https://securetoken.googleapis.com/v1/token?key=\(apiKey)")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token"),
                           URLQueryItem(name: "refresh_token", value: refreshToken)]
        request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        let data = try await fetch(request)
        guard expected == session else { throw CancellationError() }
        let refresh = try JSONDecoder().decode(Refresh.self, from: data)
        idToken = refresh.id_token
        refreshToken = refresh.refresh_token
        expiresAt = Date().addingTimeInterval(Double(refresh.expires_in) ?? 3600)
    }

    func exchange(value: Bool? = nil) async {
        guard signedIn, !busy else { return }
        let expected = session
        busy = true
        defer { busy = false }
        do {
            try await refreshCredentials()
            guard expected == session else { return }
            var parts = URLComponents(string: "\(databaseURL)/signal/value.json")!
            parts.queryItems = [URLQueryItem(name: "auth", value: idToken)]
            var request = URLRequest(url: parts.url!)
            request.timeoutInterval = 10
            request.cachePolicy = .reloadIgnoringLocalCacheData
            if let value {
                request.httpMethod = "PUT"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                throw Failure.message("Indicator commands are controlled by Smart Laundry. This prototype is read-only.")
            }
            let data = try await fetch(request)
            guard expected == session else { return }
            let light = try JSONDecoder().decode(String?.self, from: data)
            guard light == nil || light == "a" || light == "b" || light == "c" || light == "d" else {
                throw Failure.message("Unexpected indicator data. Expected a, b, c, or d.")
            }
            on = light != nil
            connected = true
            status = "Indicator: \(light ?? "none")"
        } catch {
            guard expected == session else { return }
            connected = false
            status = error.localizedDescription
        }
    }
}
