import SwiftUI

struct ContentView: View {
    @StateObject private var light = FirebaseLight()
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        ZStack {
            Color(red: 0.04, green: 0.07, blue: 0.12).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("◉ LightLink").font(.headline)
                    Text("YOUR CONNECTED SPACE").font(.caption).foregroundStyle(.blue)
                    Text("A little switch.\nA bright idea.")
                        .font(.system(size: 42, weight: .bold))
                    VStack(spacing: 28) {
                        Toggle("Indicator active", isOn: Binding(get: { light.on }, set: { value in
                            Task { await light.exchange(value: value) }
                        })).disabled(true).tint(.blue)
                        Image(systemName: light.on ? "lightbulb.fill" : "lightbulb")
                            .font(.system(size: 100))
                            .foregroundStyle(light.on ? .yellow : .gray)
                            .shadow(color: light.on ? .yellow.opacity(0.6) : .clear, radius: 35)
                        Text(light.signedIn ? (light.on ? "Light is on" : "Light is off") : "Waiting for sign-in")
                            .font(.title3.bold())
                        Text(light.status).font(.caption).foregroundStyle(.secondary)
                    }.padding(28).frame(maxWidth: .infinity)
                        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 28))
                    if light.signedIn {
                        Button("Sign out") { light.signOut() }.disabled(light.busy)
                    } else {
                        TextField("Demo account email", text: $email)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .keyboardType(.emailAddress).textContentType(.username)
                            .textFieldStyle(.roundedBorder)
                        SecureField("Password", text: $password)
                            .textContentType(.password).textFieldStyle(.roundedBorder)
                        Button("Sign in") {
                            Task {
                                await light.signIn(email: email, password: password)
                                if light.signedIn { password = "" }
                            }
                        }.buttonStyle(.borderedProminent)
                            .disabled(light.busy || email.isEmpty || password.isEmpty)
                        Text("Use the same demo account on the browser light page.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text("Connected through Firebase · lightlink-cbe74")
                        .font(.caption2).foregroundStyle(.secondary)
                }.padding(28)
            }
        }.preferredColorScheme(.dark)
        .task {
            while !Task.isCancelled {
                await light.exchange()
                do { try await Task.sleep(nanoseconds: 800_000_000) } catch { break }
            }
        }
    }
}
