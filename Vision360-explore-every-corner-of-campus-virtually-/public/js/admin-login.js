import { auth } from "./firebase-init.js";
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const ADMIN_EMAIL = "admin@vision360.com";
const db = getFirestore();

document.addEventListener("DOMContentLoaded", () => {
    const loginForm     = document.getElementById("login-form");
    const googleBtn     = document.getElementById("google-login-btn");
    const errorMsg      = document.getElementById("error-msg");
    const emailInput    = document.getElementById("email");
    const passwordInput = document.getElementById("password");

    const showError = (msg) => {
        errorMsg.textContent = msg;
        errorMsg.style.display = "block";
    };

    const hideError = () => { errorMsg.style.display = "none"; };

    // If already signed in, re-check authorization and redirect
    onAuthStateChanged(auth, (user) => {
        if (user) checkAuthorization(user);
    });

    // Check master admin email OR Firestore co-admin record
    const checkAuthorization = async (user) => {
        // 1. Master admin — always allowed
        if (user.email === ADMIN_EMAIL) {
            window.location.href = "dashboard.html";
            return;
        }

        // 2. Check Firestore /admins/<email> for co-admins
        try {
            const snap = await getDoc(doc(db, "admins", user.email.toLowerCase()));
            if (snap.exists()) {
                window.location.href = "dashboard.html";
                return;
            }
        } catch (err) {
            console.error("Firestore auth check failed:", err);
        }

        // 3. Not authorised — sign out and show message
        showError("You are not authorized to access the admin panel.");
        await signOut(auth);
    };

    // ── Email / Password login ────────────────────────────
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        const email    = emailInput.value.trim();
        const password = passwordInput.value;

        try {
            const cred = await signInWithEmailAndPassword(auth, email, password);
            await checkAuthorization(cred.user);
        } catch (error) {
            console.error(error);
            let msg = "Login failed. Please try again.";
            if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
                msg = "Incorrect email or password.";
            } else if (error.code === "auth/user-not-found") {
                msg = "No account found with that email.";
            } else if (error.code === "auth/too-many-requests") {
                msg = "Too many failed attempts. Please try again later.";
            }
            showError(msg);
        }
    });

    // ── Google login ──────────────────────────────────────
    googleBtn && googleBtn.addEventListener("click", async () => {
        hideError();
        try {
            const result = await signInWithPopup(auth, new GoogleAuthProvider());
            await checkAuthorization(result.user);
        } catch (error) {
            console.error(error);
            showError("Google login failed: " + error.message);
        }
    });
});
