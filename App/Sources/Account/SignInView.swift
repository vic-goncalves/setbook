import SwiftUI

struct SignInView: View {
    @Environment(AccountModel.self) private var account
    @State private var devName = ""

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(alignment: .leading, spacing: Spacing.m) {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Theme.onPrimary)
                    .frame(width: 64, height: 64)
                    .background(Theme.primaryFill, in: .rect(cornerRadius: 18))
                    .accessibilityHidden(true)
                Text("Setbook")
                    .font(.system(size: 44, weight: .bold))
                    .tracking(-1)
                    .foregroundStyle(Theme.ink)
                Text("Know what to do today, log it in seconds, and see whether you're getting stronger.")
                    .font(.title3)
                    .foregroundStyle(Theme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer()

            VStack(spacing: Spacing.s) {
                if let error = account.signInError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.destructive)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button {
                    Task { await account.signInWithGoogle() }
                } label: {
                    HStack(spacing: Spacing.xs) {
                        if account.isSigningIn { ProgressView().tint(Theme.onPrimary) }
                        Text("Continue with Google")
                    }
                }
                .buttonStyle(.primary)
                .disabled(account.isSigningIn)

                #if DEBUG
                HStack(spacing: Spacing.xs) {
                    TextField("", text: $devName, prompt: Text("Dev name").foregroundStyle(Theme.tertiaryInk))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, Spacing.s)
                        .frame(minHeight: 44)
                        .background(Theme.surface, in: .rect(cornerRadius: Radius.control))
                    Button("Dev sign-in") { Task { await account.devSignIn(name: devName) } }
                        .buttonStyle(.quietPill)
                        .disabled(devName.trimmingCharacters(in: .whitespaces).isEmpty || account.isSigningIn)
                }
                Text("Debug builds only. Works against a local server with DEV_AUTH=true.")
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryInk)
                    .frame(maxWidth: .infinity, alignment: .leading)
                #endif

                Text("Your log works offline and syncs with the Setbook web app.")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryInk)
                    .padding(.top, Spacing.xs)
            }
        }
        .padding(.horizontal, Spacing.page)
        .padding(.bottom, Spacing.l)
        .background(Theme.background)
    }
}
