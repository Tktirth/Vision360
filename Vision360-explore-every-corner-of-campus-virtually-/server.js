import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Firebase Admin SDK ──────────────────────────────────
// Uses Application Default Credentials from Firebase CLI (gcloud auth).
// If not already initialized, initialise now.
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'virtualcampusexplorer'
    });
}
const adminAuth = admin.auth();
const adminDb   = admin.firestore();
// ────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json()); // needed to parse JSON bodies

// ── Image Upload ──────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
    filename:    (req, file, cb) => {
        const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + suffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

app.post('/upload', upload.single('panorama'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `images/${req.file.filename}` });
});

// ── Create Admin User ─────────────────────────────────────
// POST /create-admin  { email, password, displayName? }
// 1. Creates a Firebase Auth account with email + password
// 2. Stores the email in Firestore /admins/<email>
app.post('/create-admin', async (req, res) => {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
        // 1️⃣  Create Firebase Auth user  (fails if email already exists)
        let userRecord;
        try {
            userRecord = await adminAuth.createUser({
                email,
                password,
                displayName: displayName || email.split('@')[0],
                emailVerified: false
            });
        } catch (authErr) {
            // If already exists in Auth, still grant Firestore access
            if (authErr.code === 'auth/email-already-exists') {
                userRecord = await adminAuth.getUserByEmail(email);
                // Update password to the new one provided
                await adminAuth.updateUser(userRecord.uid, { password });
            } else {
                throw authErr;
            }
        }

        // 2️⃣  Write to Firestore /admins/<email>
        await adminDb.collection('admins').doc(email.toLowerCase()).set({
            uid:       userRecord.uid,
            role:      'admin',
            addedAt:   new Date().toISOString(),
            createdBy: 'admin-panel'
        });

        res.json({
            success: true,
            message: `Admin account created for ${email}`,
            uid:     userRecord.uid
        });

    } catch (error) {
        console.error('create-admin error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── Revoke Admin User ─────────────────────────────────────
// DELETE /revoke-admin  { email }
// Removes from Firestore (Auth account kept in case they signed in before)
app.delete('/revoke-admin', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });

    try {
        // Remove from Firestore
        await adminDb.collection('admins').doc(email.toLowerCase()).delete();

        // Optionally disable the Auth account (not delete — keeps email free)
        try {
            const user = await adminAuth.getUserByEmail(email);
            await adminAuth.updateUser(user.uid, { disabled: true });
        } catch (_) { /* user might not exist in Auth */ }

        res.json({ success: true, message: `Access revoked for ${email}` });
    } catch (error) {
        console.error('revoke-admin error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => console.log('✅  Server running on http://localhost:3000'));
